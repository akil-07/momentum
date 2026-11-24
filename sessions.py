"""Persistent Claude Code sessions for Momentum (standard library only).

Each named session (coach, planner) is ONE long-lived Claude Code conversation:
  first turn  : claude -p --session-id <uuid> ...
  later turns : claude -p --resume <uuid> ...
run from a fixed working directory (Claude Code stores sessions per cwd). Turns are serialized per session by a
worker thread; clients submit jobs with their own turn_id (idempotent) and poll for the result.
If the conversation is lost (file deleted, system prompt changed, repeated failures) the session is rotated to a new
id and re-seeded with the model's own notebook plus the last few exchanges, so memory survives.
"""
import glob, json, os, queue, re, shutil, signal, subprocess, tempfile, threading, time, uuid

import archive, prompts

TURN_ID_RE = re.compile(r'^[A-Za-z0-9-]{8,64}$')


class Shutdown(Exception):
    """the server is stopping: the running turn was killed and must not be recorded (the app re-sends it)"""


def _now_ms():
    return int(time.time() * 1000)


def _write_json(path, obj):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix='.tmp-')
    with os.fdopen(fd, 'w') as f:
        json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)


def _read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


class Job:
    __slots__ = ('turn_id', 'session', 'kind', 'prompt', 'meta', 'state', 'enq_at', 'started_at', 'finished_at', 'result', 'error', 'done')

    def __init__(self, turn_id, session, kind, prompt, meta):
        self.turn_id, self.session, self.kind, self.prompt, self.meta = turn_id, session, kind, prompt, meta
        self.state, self.enq_at, self.started_at, self.finished_at = 'queued', _now_ms(), None, None
        self.result, self.error = None, None
        self.done = threading.Event()

    def public(self, position=None):
        o = {'job': self.turn_id, 'session': self.session, 'kind': self.kind, 'state': self.state,
             'enq_at': self.enq_at, 'started_at': self.started_at, 'finished_at': self.finished_at}
        if position is not None:
            o['position'] = position
        if self.result is not None:
            o['result'] = self.result
        if self.error is not None:
            o['error'] = self.error
        return o


class Sessions:
    def __init__(self, data_dir, model_default='opus'):
        self.data = data_dir
        self.root = os.path.join(data_dir, 'claude')
        self.reg_path = os.path.join(self.root, 'sessions.json')
        self.jobs_dir = os.path.join(self.root, 'jobs')
        self.model = {
            'coach': os.environ.get('MOMENTUM_COACH_MODEL', model_default),
            'planner': os.environ.get('MOMENTUM_PLANNER_MODEL', model_default),
        }
        self.reg_lock = threading.Lock()
        self.jobs_lock = threading.RLock()  # re-entrant: _position() is called while holding it
        self.jobs = {}
        self.queues = {name: queue.Queue(maxsize=6) for name in prompts.SPECS}
        self.workers = {}
        self.workers_lock = threading.Lock()
        self.procs = {}  # pid -> Popen of every running `claude` turn
        self.procs_lock = threading.Lock()
        self.closing = False
        self.pids_path = os.path.join(self.root, 'running.json')
        os.makedirs(self.jobs_dir, exist_ok=True)
        self._kill_orphans()
        self._prune_jobs()
        self._fix_costs()

    # ───────── process lifecycle: no `claude` turn may outlive the server ─────────
    def _save_pids(self):
        try:
            _write_json(self.pids_path, sorted(self.procs))
        except OSError:
            pass

    @staticmethod
    def _killgroup(pgid):
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(pgid, sig)
            except (ProcessLookupError, PermissionError):
                return
            for _ in range(30):  # up to 3 s for a clean exit
                time.sleep(0.1)
                try:
                    os.killpg(pgid, 0)
                except (ProcessLookupError, PermissionError):
                    return

    def _kill_orphans(self):
        """a previous server that was killed hard (SIGKILL, crash, power loss) may have left turns running"""
        for pid in _read_json(self.pids_path, []) or []:
            try:
                with open(f'/proc/{pid}/cmdline', 'rb') as f:
                    cmd = f.read().replace(b'\0', b' ').decode(errors='replace')
            except OSError:
                continue  # already gone (or not Linux)
            if '--json-schema' in cmd and ('--resume' in cmd or '--session-id' in cmd):  # only our own claude turns
                print(f'Stopping a Claude turn left over from the last run (pid {pid})', flush=True)
                self._killgroup(pid)
        self._save_pids()

    def shutdown(self):
        """kill every running turn; their jobs are left unrecorded so the app re-sends them to the next server"""
        self.closing = True
        with self.procs_lock:
            procs = list(self.procs.values())
        for p in procs:
            self._killgroup(p.pid)
        with self.procs_lock:
            self.procs.clear()
            self._save_pids()

    # ───────── paths / registry ─────────
    def ws(self, name):
        p = os.path.join(self.root, name, 'ws')
        os.makedirs(p, exist_ok=True)
        return p

    def notebook_path(self, name):
        return os.path.join(self.root, name, 'notebook.md')

    def log_path(self, name):
        return os.path.join(self.root, name, 'log.jsonl')

    def _reg(self):
        return _read_json(self.reg_path, {})

    def _save_reg(self, reg):
        _write_json(self.reg_path, reg)

    def notebook(self, name):
        try:
            with open(self.notebook_path(name)) as f:
                return f.read()
        except FileNotFoundError:
            return ''

    def _set_notebook(self, name, text):
        os.makedirs(os.path.dirname(self.notebook_path(name)), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.notebook_path(name)), prefix='.nb-')
        with os.fdopen(fd, 'w') as f:
            f.write(text)
        os.replace(tmp, self.notebook_path(name))

    def _log(self, name, entry):
        os.makedirs(os.path.dirname(self.log_path(name)), exist_ok=True)
        with open(self.log_path(name), 'a') as f:
            f.write(json.dumps(entry, separators=(',', ':'), ensure_ascii=False) + '\n')

    def read_log(self, name, after=0, limit=50):
        out = []
        try:
            with open(self.log_path(name)) as f:
                for line in f:
                    try:
                        e = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if e.get('at', 0) > after:
                        out.append(e)
        except FileNotFoundError:
            pass
        return out[:limit]  # oldest first after the cursor; the client pages with `after`

    @staticmethod
    def _session_file_exists(sid):
        base = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')
        return bool(glob.glob(os.path.join(base, 'projects', '*', f'{sid}.jsonl')))

    def info(self, name):
        with self.reg_lock:
            e = dict(self._reg().get(name) or {})
        e.pop('id', None)  # never expose the raw session id
        q = self.queues[name]
        with self.jobs_lock:
            running = any(j.session == name and j.state == 'running' for j in self.jobs.values())
        spec = prompts.SPECS[name]
        return {'name': name, 'model': self.model[name], 'gen': e.get('gen', 0), 'created': e.get('created'),
                'turns': e.get('turns', 0), 'day': e.get('day'), 'day_turns': e.get('day_turns', 0), 'max_day': self.max_day(name),
                'cost_usd': round(e.get('cost_usd', 0.0), 4), 'last_at': e.get('last_at'), 'last_usage': e.get('last_usage'),
                'busy': running, 'queued': q.qsize(), 'notebook': self.notebook(name), 'history': e.get('history', [])[-10:]}

    def reset(self, name, keep_notebook=True):
        with self.reg_lock:
            reg = self._reg()
            self._rotate(reg, name, 'reset')
            self._save_reg(reg)
            gen = reg[name]['gen']
        if not keep_notebook:
            self._set_notebook(name, '')
        return gen

    def _rotate(self, reg, name, reason):
        e = reg.get(name) or {'gen': 0, 'history': []}
        if e.get('id'):
            e.setdefault('history', []).append({'id': e['id'], 'gen': e.get('gen', 0), 'created': e.get('created'),
                                                'ended': _now_ms(), 'turns': e.get('turns', 0), 'reason': reason})
        e.update({'id': None, 'turns': 0, 'fail_streak': 0, 'pending_first': False})
        reg[name] = e

    # ───────── cost: the CLI's total_cost_usd is cumulative per conversation (it climbs each turn, restarts with a new one) ─────────
    @staticmethod
    def _cost_step(ent, gen, c):
        """add one turn's reported cumulative cost: only the increase over the last value seen for this conversation counts"""
        last = float(ent.get('cost_last') or 0) if ent.get('cost_gen') == gen else 0.0
        ent['cost_usd'] = ent.get('cost_usd', 0.0) + (c - last if c >= last else c)  # a drop means a fresh conversation
        ent['cost_gen'], ent['cost_last'] = gen, c
        return c - last if c >= last else c

    def _fix_costs(self):
        """one-time: older servers summed the cumulative values; rebuild the total from the log (max per generation, summed)"""
        with self.reg_lock:
            reg, dirty = self._reg(), False
            for name in prompts.SPECS:
                ent = reg.get(name)
                if not ent or ent.get('cost_v') == 2:
                    continue
                per = {}
                for e in self.read_log(name, 0, 10 ** 9):
                    if e.get('cost_usd') is not None:
                        g = e.get('gen', 0)
                        per[g] = max(per.get(g, 0.0), float(e['cost_usd']))
                if per:
                    ent['cost_usd'] = sum(per.values())
                    if ent.get('gen', 0) in per:
                        ent['cost_gen'], ent['cost_last'] = ent['gen'], per[ent['gen']]
                ent['cost_v'], dirty = 2, True
            if dirty:
                self._save_reg(reg)

    # ───────── jobs ─────────
    def _prune_jobs(self):
        cutoff = time.time() - 7 * 86400
        for p in glob.glob(os.path.join(self.jobs_dir, '*.json')):
            try:
                if os.path.getmtime(p) < cutoff:
                    os.remove(p)
            except OSError:
                pass

    def _job_file(self, turn_id):
        return os.path.join(self.jobs_dir, f'{turn_id}.json')

    def get_job(self, turn_id):
        with self.jobs_lock:
            j = self.jobs.get(turn_id)
        if j:
            return j.public(self._position(j))
        stored = _read_json(self._job_file(turn_id), None)
        return stored

    def _position(self, j):
        if j.state != 'queued':
            return None
        with self.jobs_lock:
            ahead = [x for x in self.jobs.values() if x.session == j.session and x.state in ('queued', 'running') and x.enq_at < j.enq_at]
        return len(ahead)

    def submit(self, name, turn_id, kind, prompt, meta):
        """Enqueue a turn. Returns (http_code, body)."""
        if not TURN_ID_RE.match(turn_id or ''):
            return 400, {'error': 'bad turn_id'}
        existing = self.get_job(turn_id)
        if existing:
            return 202, existing
        logged = next((e for e in self.read_log(name, 0, 10_000) if e.get('turn_id') == turn_id), None)
        if logged:  # job file pruned but the turn happened: never re-run it
            return 202, {'job': turn_id, 'session': name, 'kind': logged.get('kind'), 'state': 'done' if logged.get('out') else 'error',
                         'result': {'structured': logged.get('out'), 'gen': logged.get('gen'), 'at': logged.get('at'), 'kind': logged.get('kind')} if logged.get('out') else None,
                         'error': logged.get('error')}
        if not self.cli():
            return 503, {'error': 'Claude Code is not installed on the server machine (needs the `claude` command).'}
        with self.reg_lock:
            reg = self._reg()
            e = reg.get(name) or {}
            today = time.strftime('%Y-%m-%d')
            day_turns = e.get('day_turns', 0) if e.get('day') == today else 0
        with self.jobs_lock:  # queued/running turns count against the cap too
            day_turns += sum(1 for j in self.jobs.values() if j.session == name and j.state in ('queued', 'running'))
        if day_turns >= self.max_day(name):
            return 429, {'error': f'Daily limit of {self.max_day(name)} {name} turns reached (protects your subscription usage).'}
        j = Job(turn_id, name, kind, prompt, meta)
        with self.jobs_lock:
            if turn_id in self.jobs:
                dup = self.jobs[turn_id]
            else:
                dup = None
        if dup:
            return 202, dup.public(self._position(dup))
        with self.jobs_lock:
            if turn_id in self.jobs:
                return 202, self.jobs[turn_id].public()
            try:
                self.queues[name].put_nowait(j)
            except queue.Full:
                return 429, {'error': f'The {name} already has several requests queued — wait for them to finish.'}
            self.jobs[turn_id] = j
        self._ensure_worker(name)
        return 202, j.public(self._position(j))

    def wait(self, turn_id, timeout):
        with self.jobs_lock:
            j = self.jobs.get(turn_id)
        if j:
            j.done.wait(timeout)
        return self.get_job(turn_id)

    def _ensure_worker(self, name):
        with self.workers_lock:  # exactly one worker per session, so turns stay serialized
            w = self.workers.get(name)
            if w and w.is_alive():
                return
            w = threading.Thread(target=self._work, args=(name,), daemon=True, name=f'claude-{name}')
            self.workers[name] = w
            w.start()

    def _work(self, name):
        q = self.queues[name]
        while True:
            j = q.get()
            if self.closing:
                return
            j.state, j.started_at = 'running', _now_ms()
            try:
                ok, payload = self.run_turn(name, j)
                if ok:
                    j.state, j.result = 'done', payload
                else:
                    j.state, j.error = 'error', payload
            except Shutdown:
                return  # unrecorded on purpose: the app gets a 404 from the next server and re-sends the same turn_id
            except Exception as ex:  # never let the worker die
                j.state, j.error = 'error', f'internal error: {ex}'
            j.finished_at = _now_ms()
            try:
                _write_json(self._job_file(j.turn_id), j.public())
            except OSError:
                pass
            j.done.set()
            # drop finished jobs from memory after a while (results stay on disk)
            with self.jobs_lock:
                old = [k for k, v in self.jobs.items() if v.state in ('done', 'error') and v.finished_at and _now_ms() - v.finished_at > 3600_000]
                for k in old:
                    self.jobs.pop(k, None)
            q.task_done()

    # ───────── running a turn ─────────
    def _timeout(self, name):
        return int(os.environ.get('MOMENTUM_CLAUDE_TIMEOUT') or prompts.SPECS[name]['timeout'])

    def max_day(self, name):
        return int(os.environ.get('MOMENTUM_CLAUDE_MAX_DAY') or prompts.SPECS[name]['max_day'])

    def cli(self):
        exe = os.environ.get('MOMENTUM_CLAUDE_BIN') or shutil.which('claude') or os.path.expanduser('~/.local/bin/claude')
        return exe if exe and os.path.exists(exe) else None

    def _seed(self, name, reason, gen):
        nb = self.notebook(name)
        recent = self.read_log(name, 0, 10 ** 9)[-6:]  # the LATEST 6 exchanges (read_log is oldest-first)
        digest = []
        for e in recent:
            said = (e.get('message') or e.get('kind') or '')[:300]
            out = e.get('out') or {}
            reply = (out.get('message') or out.get('summary') or '')[:500]
            digest.append(f'- [{time.strftime("%Y-%m-%d %H:%M", time.localtime(e.get("at", 0) / 1000))}] {e.get("kind")}: student/app: {said!r} -> you: {reply!r}')
        role = 'coach' if name == 'coach' else 'day planner'
        long_term = ''
        if prompts.SPECS[name].get('long_term'):
            try:
                arc = archive.digest(self.data)
            except Exception as ex:  # a damaged archive must never block a restart
                arc = f'(archive digest unavailable: {ex})'
            if arc:
                long_term = ('<long_term>\nThe whole training history by month from the archive (older years folded into one row each); '
                             'grep the archive folder for details.\n' + arc + '\n</long_term>\n')
        return (f'[SESSION RESTARTED: generation {gen}, reason: {reason}] You are continuing as this student\'s {role}. '
                f'Your memory of earlier conversations is gone except for your own notebook and a digest of the latest exchanges below. '
                f'Continue seamlessly.\n<notebook>\n{nb or "(empty)"}\n</notebook>\n<recent>\n' + ('\n'.join(digest) or '(none)') + '\n</recent>\n'
                + long_term + '\n')

    def long_term_dirs(self):
        """(code folder, archive folder) the coach may read; '' for one that doesn't exist"""
        arc = archive.archive_dir(self.data)
        return archive.code_dir(self.data), (os.path.abspath(arc) if os.path.isdir(arc) else '')

    def _cmd(self, name, sid, resume):
        spec = prompts.SPECS[name]
        # tools per session: the coach may read allow-listed sites (WebFetch) and, read-only, the student's code folder
        # and the archive (Read/Grep/Glob limited to those dirs); in -p mode every other domain/tool/path is denied
        tools, allowed, dirs, sys_prompt = spec.get('tools', ''), list(spec.get('allowed') or []), [], spec['sys']
        if spec.get('long_term'):
            code, arc = self.long_term_dirs()
            dirs = [d for d in (code, arc) if d]
            if dirs:
                tools = ','.join([t for t in tools.split(',') if t] + ['Read', 'Grep', 'Glob'])
                for d in dirs:  # '//' = an absolute path in permission rules
                    allowed += [f'{t}(/{d}/**)' for t in ('Read', 'Grep', 'Glob')]
            sys_prompt += ('\n\nLONG-TERM MEMORY paths: code folder = ' + (code or '(unavailable)') +
                           '; archive folder = ' + (arc or '(unavailable)') + '.')
        cmd = [self.cli(), '-p', '--output-format', 'json', '--model', self.model[name], '--tools', tools]
        if allowed:
            cmd += ['--allowedTools', *allowed]
        if dirs:
            cmd += ['--add-dir', *dirs]
        cmd += ['--strict-mcp-config', '--setting-sources', 'user', '--disable-slash-commands',
               '--system-prompt', sys_prompt, '--json-schema', json.dumps(spec['schema']),
               '--autocompact', str(spec['autocompact'])]
        cmd += ['--resume', sid] if resume else ['--session-id', sid]
        if os.environ.get('MOMENTUM_CLAUDE_BUDGET'):
            cmd += ['--max-budget-usd', os.environ['MOMENTUM_CLAUDE_BUDGET']]
        return cmd

    def _invoke(self, name, sid, resume, prompt):
        cmd = self._cmd(name, sid, resume)
        if self.closing:
            raise Shutdown()
        p = subprocess.Popen(cmd, cwd=self.ws(name), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             text=True, start_new_session=True)
        with self.procs_lock:
            self.procs[p.pid] = p
            self._save_pids()
        try:
            so, se = p.communicate(input=prompt, timeout=self._timeout(name))
        except subprocess.TimeoutExpired:
            if self.closing:
                raise Shutdown()
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(p.pid, sig)
                except ProcessLookupError:
                    break
                try:
                    p.wait(5)
                    break
                except subprocess.TimeoutExpired:
                    continue
            return {'ok': False, 'err': f'timed out after {self._timeout(name)}s', 'text': ''}
        finally:
            with self.procs_lock:
                if self.procs.pop(p.pid, None) is not None:
                    self._save_pids()
        if self.closing:
            raise Shutdown()
        text = (so or '') + '\n' + (se or '')
        try:
            res = json.loads(so)
        except (json.JSONDecodeError, TypeError):
            lines = [l for l in text.strip().splitlines() if l.strip()]
            return {'ok': False, 'err': 'Claude Code failed: ' + (lines[-1] if lines else f'exit {p.returncode}'), 'text': text}
        if res.get('is_error') or not isinstance(res.get('structured_output'), dict):
            return {'ok': False, 'err': 'Claude Code: ' + str(res.get('result') or res.get('subtype') or 'no structured answer')[:400],
                    'text': text, 'res': res}
        return {'ok': True, 'res': res, 'text': text}

    def run_turn(self, name, job):
        spec = prompts.SPECS[name]
        if callable(job.prompt):  # deferred build (e.g. fetches a statement): done here so the HTTP request stays fast
            try:
                job.prompt = job.prompt()
            except Exception as ex:
                return False, f'could not build the prompt: {ex}'
        with self.reg_lock:
            reg = self._reg()
            e = reg.get(name) or {'gen': 0, 'history': []}
            reg[name] = e
            today = time.strftime('%Y-%m-%d')
            if e.get('day') != today:
                e['day'], e['day_turns'] = today, 0
            reason = None
            if e.get('id') and e.get('sys_ver') != spec['sys_ver']:
                reason = 'system prompt updated'
            elif e.get('id') and not e.get('pending_first') and not self._session_file_exists(e['id']):
                reason = 'conversation file missing'
            if reason:
                self._rotate(reg, name, reason)
            first = not e.get('id')
            if first:
                e.update({'id': str(uuid.uuid4()), 'gen': e.get('gen', 0) + 1, 'created': _now_ms(), 'sys_ver': spec['sys_ver'],
                          'pending_first': True, 'turns': 0, 'fail_streak': 0, 'seed_reason': reason or ('first' if e.get('gen', 0) == 0 else 'rotated')})
            self._save_reg(reg)
            sid, gen, pending = e['id'], e['gen'], e.get('pending_first', False)

        reseeded = False
        prompt = job.prompt
        if pending:
            if gen > 1 or self.notebook(name) or self.read_log(name, 0, 1):
                prompt = self._seed(name, e.get('seed_reason') or 'restart', gen) + prompt
                reseeded = True
            out = self._invoke(name, sid, False, prompt)
            if not out['ok'] and 'already in use' in out.get('text', ''):  # crashed after creating it last time
                out = self._invoke(name, sid, True, job.prompt)
        else:
            out = self._invoke(name, sid, True, prompt)
            lost = 'No conversation found' in out.get('text', '')
            # only a broken conversation (execution error twice in a row) is rotated; transient failures such as a
            # usage-limit message must not throw the conversation's memory away
            broken = e.get('fail_streak', 0) >= 1 and (out.get('res') or {}).get('subtype') == 'error_during_execution'
            if not out['ok'] and (lost or broken):
                # lost or repeatedly failing conversation: rotate and re-seed once
                with self.reg_lock:
                    reg = self._reg()
                    self._rotate(reg, name, 'missing' if 'No conversation found' in out.get('text', '') else 'repeated failures')
                    ent = reg[name]
                    ent.update({'id': str(uuid.uuid4()), 'gen': ent.get('gen', 0) + 1, 'created': _now_ms(), 'sys_ver': spec['sys_ver'],
                                'pending_first': True, 'turns': 0, 'fail_streak': 0})
                    self._save_reg(reg)
                    sid, gen = ent['id'], ent['gen']
                prompt = self._seed(name, 'conversation lost', gen) + job.prompt
                reseeded = True
                out = self._invoke(name, sid, False, prompt)

        with self.reg_lock:
            reg = self._reg()
            ent = reg.get(name) or {}
            if ent.get('id') != sid:  # the session was reset while this turn ran: don't touch the new one
                out['stale'] = True
            elif out['ok']:
                res = out['res']
                ent['pending_first'] = False
                ent['turns'] = ent.get('turns', 0) + 1
                ent['day_turns'] = ent.get('day_turns', 0) + 1
                out['turn_cost'] = self._cost_step(ent, gen, float(res.get('total_cost_usd') or 0))
                ent['cost_v'] = 2
                ent['last_at'] = _now_ms()
                ent['last_usage'] = res.get('usage')
                ent['fail_streak'] = 0
            elif not out['ok']:
                ent['fail_streak'] = ent.get('fail_streak', 0) + 1
                ent['day_turns'] = ent.get('day_turns', 0) + (1 if (out.get('res') or {}).get('total_cost_usd') else 0)
            reg[name] = ent
            self._save_reg(reg)

        if not out['ok']:
            self._log(name, {'turn_id': job.turn_id, 'at': _now_ms(), 'kind': job.kind, 'gen': gen, 'message': job.meta.get('message', ''), 'error': out['err']})
            return False, out['err']
        res = out['res']
        so = res['structured_output']
        nb = so.get('notebook') if isinstance(so, dict) else None
        if isinstance(nb, str) and nb.strip() and not out.get('stale'):
            self._set_notebook(name, nb[:12000])
        # cost_usd stays the CLI's cumulative conversation cost (logged as before); turn_cost_usd is this turn alone
        result = {'structured': so, 'gen': gen, 'reseeded': reseeded, 'cost_usd': res.get('total_cost_usd'), 'turn_cost_usd': out.get('turn_cost'),
                  'usage': res.get('usage'), 'at': _now_ms(), 'kind': job.kind}
        self._log(name, {'turn_id': job.turn_id, 'at': result['at'], 'kind': job.kind, 'gen': gen,
                         'message': job.meta.get('message', ''), 'meta': {k: v for k, v in job.meta.items() if k != 'message'},
                         'out': so, 'cost_usd': res.get('total_cost_usd')})
        return True, result
