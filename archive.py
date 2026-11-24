"""Momentum archive: the permanent record of every mock, rated round, virtual and practice session, every problem
and its attempts, flashcards, statements and links to the student's own code files (standard library only).

Lives in <DATA>/archive/ (schema ver 1), separate from state.json: state.json is pruned, the archive never is.
Every write is an upsert (records and keys are never deleted) and atomic (tmp + rename); the first write of a day
snapshots the folder to <DATA>/backups/archive-YYYY-MM-DD.tar.gz (the newest 14 are kept).

  meta.json        {ver, codeDir, createdAt, cards:{day, n}}
  activities.json  {id: Activity}
  problems.json    {pid: {pid, name, rating, tags, contestId, index, firstAt, lastAt, status, attempts[]}}
  statements/<pid>.txt, cards/<pid>.json
  links.json       {relpath: {pid|null, by:'auto'|'user', u}}   user links always win over auto
  srs.json         {pid: {ef, ivl, reps, lapses, due, last}}      SM-2, same as src/ideas.ts schedule()
  work/            scratch for the flashcard worker (queue, cwd of the one-shot claude runs)
"""
import datetime, json, math, os, re, shutil, signal, subprocess, tarfile, tempfile, threading, time

import prompts

VER = 1
PID_RE = re.compile(r'^\d{1,4}[A-Z]\d?$')
ACT_ID_RE = re.compile(r'^(test|sess|cf|cfv|free):[A-Za-z0-9:_.\-]{1,80}$')
DAY_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
KINDS = ('mock', 'virtual', 'contest', 'practice', 'free')
STATUS_RANK = {'tried': 0, 'failed': 1, 'solved': 2}
CODE_EXT = ('.cpp', '.cc', '.c', '.py', '.java', '.kt', '.rs', '.go')
CODE_MAX_FILES, CODE_MAX_SIZE, CODE_HEAD, CODE_TEXT_CAP = 5000, 1024 * 1024, 400, 60 * 1024
BACKUP_KEEP = 14
EF0, EF_MIN, IVL_MAX, QUALITY = 2.5, 1.3, 365, (1, 3, 4, 5)


def _now_ms():
    return int(time.time() * 1000)


def _write_json(path, obj):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix='.tmp-')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _write_text(path, text):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix='.tmp-')
    with os.fdopen(fd, 'w') as f:
        f.write(text)
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)


def _read_json(path, default):
    try:
        with open(path) as f:
            v = json.load(f)
        return v if isinstance(v, type(default)) else default
    except (OSError, json.JSONDecodeError):
        return default


class StoreError(Exception):
    """an archive file exists but could not be read back (I/O error, damaged or wrong-type JSON)"""


def _read_strict(path, default):
    """for read-modify-write: the default only when the file does not exist yet; anything else raises StoreError so a
    transient read failure or a damaged file is never mistaken for an empty archive and overwritten"""
    try:
        with open(path) as f:
            v = json.load(f)
    except FileNotFoundError:
        return default
    except (OSError, ValueError) as e:
        raise StoreError(f'cannot read {os.path.basename(path)}: {e}') from e
    if not isinstance(v, type(default)):
        raise StoreError(f'{os.path.basename(path)} is not a JSON {type(default).__name__}')
    return v


def _today():
    return time.strftime('%Y-%m-%d')


def _add_days(day, n):
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=n)).isoformat()


def _str(v, cap):
    return v[:cap] if isinstance(v, str) else ''


def _int(v):
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _jround(x):
    """Math.round (halves go up; Python's round() rounds halves to even)"""
    return math.floor(x + 0.5)


def schedule(c, grade, today, at=None):
    """pure SM-2 step, identical to src/ideas.ts schedule()"""
    c = {'ef': EF0, 'ivl': 0, 'reps': 0, 'lapses': 0, **(c or {})}
    q = QUALITY[grade]
    ef = max(EF_MIN, float(f"{c['ef'] + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02):.3f}"))
    reps, lapses = c['reps'] + 1, c['lapses']
    if grade == 0:
        reps, ivl, lapses = 0, 1, lapses + 1
    elif grade == 1:
        ivl = 1 if c['reps'] == 0 else max(c['ivl'] + 1, _jround(c['ivl'] * 1.2))
    else:
        good = 1 if c['reps'] == 0 else 6 if c['reps'] == 1 else _jround(c['ivl'] * ef)
        ivl = max(good + 1, _jround(good * 1.3)) if grade == 3 else good
    ivl = min(IVL_MAX, max(1, ivl))
    return {'ef': ef, 'ivl': ivl, 'reps': reps, 'lapses': lapses, 'due': _add_days(today, ivl), 'last': at if at is not None else _now_ms()}


# ───────── module-level helpers (sessions.py uses these without an Archive instance) ─────────
def archive_dir(data_dir):
    return os.path.join(data_dir, 'archive')


def code_dir_refusal(d, data_dir):
    """why `d` (absolute) can't be the code folder, or '': not '/', not the home folder itself, not a folder that holds
    the server's data (the code folder is readable through the API and by the coach)"""
    real = os.path.realpath(d)
    home = os.path.realpath(os.path.expanduser('~'))
    data = os.path.realpath(data_dir)
    if real == os.sep or real == os.path.dirname(real):
        return 'the filesystem root cannot be the code folder'
    if real == home:
        return 'pick the folder with your solutions, not your whole home folder'
    if data == real or data.startswith(real.rstrip(os.sep) + os.sep):
        return "that folder contains Momentum's own data"
    return ''


def code_dir(data_dir):
    """the student's code folder: meta.codeDir, else $MOMENTUM_CODE, else '' (an existing, allowed directory or '')"""
    d = _read_json(os.path.join(archive_dir(data_dir), 'meta.json'), {}).get('codeDir') or os.environ.get('MOMENTUM_CODE') or ''
    d = os.path.abspath(os.path.expanduser(d)) if d else ''
    return d if d and os.path.isdir(d) and not code_dir_refusal(d, data_dir) else ''


def _month(ms):
    return time.strftime('%Y-%m', time.localtime(ms / 1000)) if ms else ''


def digest(data_dir, max_lines=60):
    """compact deterministic long-term digest for a restarted coach: one row per month (older years folded into one
    row per year so it stays <= ~60 lines even after 5 years)"""
    root = archive_dir(data_dir)
    acts = _read_json(os.path.join(root, 'activities.json'), {})
    probs = _read_json(os.path.join(root, 'problems.json'), {})
    if not acts and not probs:
        return ''
    rows = {}

    def row(k):
        return rows.setdefault(k, {'kinds': {}, 'solved': 0, 'failed': 0, 'rsum': 0, 'rn': 0, 'perf': [], 'tags': {}})

    for a in acts.values():
        if not isinstance(a, dict):
            continue
        k = (a.get('date') or '')[:7] or _month(a.get('at'))
        if not k:
            continue
        r = row(k)
        r['kinds'][a.get('kind', '?')] = r['kinds'].get(a.get('kind', '?'), 0) + 1
        if a.get('kind') in ('mock', 'virtual', 'contest') and _int(a.get('perf')):
            r['perf'].append(a['perf'])
    for p in probs.values():
        if not isinstance(p, dict):
            continue
        att = [x for x in p.get('attempts') or [] if isinstance(x, dict)]
        won = [x['at'] for x in att if x.get('status') == 'solved' and _int(x.get('at'))]
        if won:
            r = row(_month(min(won)))
            r['solved'] += 1
            if _int(p.get('rating')):
                r['rsum'] += p['rating']; r['rn'] += 1
            for t in p.get('tags') or []:
                r['tags'][t] = r['tags'].get(t, 0) + 1
        elif p.get('status') == 'failed' and _int(p.get('lastAt')):
            row(_month(p['lastAt']))['failed'] += 1
    keys = sorted(k for k in rows if k)
    budget = max_lines - 2  # header + totals
    keep = len(keys)
    while keep > 0 and keep + len({k[:4] for k in keys[:len(keys) - keep]}) > budget:
        keep -= 1  # fold the oldest months into one row per year until it fits
    blank = lambda: {'kinds': {}, 'solved': 0, 'failed': 0, 'rsum': 0, 'rn': 0, 'perf': [], 'tags': {}}
    folded = {}
    for k in keys[:len(keys) - keep]:
        y, r = folded.setdefault(k[:4], blank()), rows[k]
        for f in ('kinds', 'tags'):
            for kk, n in r[f].items():
                y[f][kk] = y[f].get(kk, 0) + n
        for f in ('solved', 'failed', 'rsum', 'rn'):
            y[f] += r[f]
        y['perf'] += r['perf']
    out_rows = [(y + ' (year)', folded[y]) for y in sorted(folded)] + [(k, rows[k]) for k in keys[len(keys) - keep:]]
    lines = ['month | activities | solved/failed | avg rating solved | mock/contest perf avg | top tags']
    for k, r in out_rows[-budget:]:
        kinds = ' '.join(f'{kk}:{n}' for kk, n in sorted(r['kinds'].items())) or '-'
        avg = str(int(r['rsum'] / r['rn'] + 0.5)) if r['rn'] else '-'
        perf = str(int(sum(r['perf']) / len(r['perf']) + 0.5)) if r['perf'] else '-'
        tags = ', '.join(t for t, _ in sorted(r['tags'].items(), key=lambda x: (-x[1], x[0]))[:3]) or '-'
        lines.append(f'{k} | {kinds} | {r["solved"]}/{r["failed"]} | {avg} | {perf} | {tags}')
    n_cards = len([f for f in os.listdir(os.path.join(root, 'cards')) if f.endswith('.json')]) if os.path.isdir(os.path.join(root, 'cards')) else 0
    lines.append(f'totals: {len(acts)} activities, {len(probs)} problems, {sum(1 for p in probs.values() if isinstance(p, dict) and p.get("status") == "solved")} solved, {n_cards} flashcards')
    return '\n'.join(lines)


class Archive:
    def __init__(self, data_dir, fetch_statement=None, stmt_cache_dir=None, cli=None):
        """fetch_statement(pid) -> text|'' (server.fetch_statement); stmt_cache_dir: its refetchable cache to copy from;
        cli() -> path of the claude binary or None"""
        self.data = data_dir
        self.root = archive_dir(data_dir)
        self.backups = os.path.join(data_dir, 'backups')
        self.fetch = fetch_statement or (lambda pid: '')
        self.stmt_cache = stmt_cache_dir
        self.cli = cli or (lambda: None)
        self.lock = threading.RLock()
        for d in ('statements', 'cards', 'work'):
            os.makedirs(os.path.join(self.root, d), exist_ok=True)
        if not os.path.exists(self.p('meta.json')):
            _write_json(self.p('meta.json'), {'ver': VER, 'codeDir': '', 'createdAt': _now_ms(), 'cards': {'day': '', 'n': 0}})
        self._card_index = {}
        for f in os.listdir(self.p('cards')):
            if f.endswith('.json'):
                c = _read_json(self.p('cards', f), {})
                if c.get('pid'):
                    self._card_index[c['pid']] = {'at': c.get('at'), 'key_idea': c.get('key_idea', '')}
        self._stmts = {f[:-4] for f in os.listdir(self.p('statements')) if f.endswith('.txt')}
        # flashcard worker
        self.cv = threading.Condition(self.lock)
        self.queue = [p for p in _read_json(self.p('work', 'queue.json'), []) if isinstance(p, str) and PID_RE.match(p)]
        self.running, self.errors, self.proc, self.closing = None, {}, None, False
        self.worker = None
        self._kill_orphan()

    def p(self, *parts):
        return os.path.join(self.root, *parts)

    # ───────── storage ─────────
    def meta(self):
        m = _read_json(self.p('meta.json'), {})
        m.setdefault('ver', VER); m.setdefault('codeDir', ''); m.setdefault('cards', {'day': '', 'n': 0})
        return m

    def _meta_strict(self):
        m = _read_strict(self.p('meta.json'), {})
        m.setdefault('ver', VER); m.setdefault('codeDir', ''); m.setdefault('cards', {'day': '', 'n': 0})
        return m

    def code_dir(self):
        return code_dir(self.data)

    def _backup(self):
        """first write of the day: snapshot the archive as it was (work/ excluded); keep the newest 14"""
        try:
            os.makedirs(self.backups, exist_ok=True)
            dst = os.path.join(self.backups, f'archive-{_today()}.tar.gz')
            if os.path.exists(dst):
                return
            fd, tmp = tempfile.mkstemp(dir=self.backups, prefix='.archive-')
            os.close(fd)
            with tarfile.open(tmp, 'w:gz') as t:
                t.add(self.root, arcname='archive', filter=lambda ti: None if ti.name.startswith('archive/work') else ti)
            os.replace(tmp, dst)
            old = sorted(f for f in os.listdir(self.backups) if f.startswith('archive-') and f.endswith('.tar.gz'))
            for f in old[:-BACKUP_KEEP]:
                os.remove(os.path.join(self.backups, f))
        except (OSError, tarfile.TarError) as e:
            print('archive backup failed:', e, flush=True)

    def _save(self, name, obj):
        self._backup()
        _write_json(self.p(name), obj)

    def _keep_statement(self, pid, text=None):
        """permanent copy of a statement (from the given text or the refetchable cache); never pruned"""
        if pid in self._stmts:
            return True
        if text is None and self.stmt_cache:
            try:
                with open(os.path.join(self.stmt_cache, pid + '.txt')) as f:
                    text = f.read()
            except OSError:
                text = None
        if text and len(text) >= 80:
            self._backup()
            _write_text(self.p('statements', pid + '.txt'), text)
            self._stmts.add(pid)
            return True
        return False

    def statement(self, pid, fetch=False):
        try:
            with open(self.p('statements', pid + '.txt')) as f:
                return f.read()
        except OSError:
            pass
        with self.lock:
            kept = self._keep_statement(pid)
        if kept:
            return self.statement(pid)
        if fetch:
            t = self.fetch(pid) or ''
            if t:
                with self.lock:
                    self._keep_statement(pid, t)
            return t
        return ''

    # ───────── ingest ─────────
    @staticmethod
    def _clean_activity(a):
        if not isinstance(a, dict) or not isinstance(a.get('id'), str) or not ACT_ID_RE.match(a['id']):
            return None
        if a.get('kind') not in KINDS or not isinstance(a.get('date'), str) or not DAY_RE.match(a['date']):
            return None
        o = {'id': a['id'], 'kind': a['kind'], 'date': a['date']}
        for k in ('at', 'end', 'perf', 'rank', 'delta', 'mins', 'contestId'):
            if _int(a.get(k)) is not None:
                o[k] = _int(a[k])
        for k, cap in (('title', 200), ('mode', 60), ('note', 2000)):
            if isinstance(a.get(k), str):
                o[k] = a[k][:cap]
        for k in ('pids', 'solved'):
            if isinstance(a.get(k), list):
                o[k] = [p for p in a[k] if isinstance(p, str) and PID_RE.match(p)][:200]
        return o

    @staticmethod
    def _merge_list(new, old):
        return list(new) + [x for x in old if x not in new]  # never lose an item the client has since pruned

    @staticmethod
    def _recompute(p):
        """status: solved wins over failed over tried; firstAt / lastAt = min / max attempt time"""
        att = p.get('attempts') or []
        ats = [a['at'] for a in att if _int(a.get('at')) is not None]
        if ats:
            p['firstAt'], p['lastAt'] = min(ats), max(ats)
        p['status'] = max((a.get('status') for a in att if a.get('status') in STATUS_RANK), key=STATUS_RANK.get, default='tried')

    def ingest(self, body):
        acts_in = body.get('activities') if isinstance(body.get('activities'), list) else []
        probs_in = body.get('problems') if isinstance(body.get('problems'), list) else []
        att_in = body.get('attempts') if isinstance(body.get('attempts'), list) else []
        na = np = 0
        with self.lock:
            acts = _read_strict(self.p('activities.json'), {})
            probs = _read_strict(self.p('problems.json'), {})
            ca = cp = False
            for raw in acts_in:
                a = self._clean_activity(raw)
                if not a:
                    continue
                na += 1
                old = acts.get(a['id']) if isinstance(acts.get(a['id']), dict) else {}
                new = {**old, **a}
                if _int(old.get('at')) is not None and _int(a.get('at')) is not None and a['at'] > old['at']:
                    new['at'] = old['at']  # a re-sent group the client has partly pruned starts later: keep the true start
                    if isinstance(old.get('date'), str):
                        new['date'] = old['date']
                for k in ('pids', 'solved'):
                    if isinstance(old.get(k), list):
                        new[k] = self._merge_list(a.get(k, []), old[k])
                if new != old:
                    acts[a['id']], ca = new, True
            for raw in probs_in:
                if not isinstance(raw, dict) or not isinstance(raw.get('pid'), str) or not PID_RE.match(raw['pid']):
                    continue
                np += 1
                pid = raw['pid']
                old = probs.get(pid) if isinstance(probs.get(pid), dict) else {'pid': pid, 'name': '', 'rating': None, 'tags': [], 'attempts': [], 'status': 'tried'}
                new = dict(old)
                if isinstance(raw.get('name'), str) and raw['name'].strip():
                    new['name'] = raw['name'][:200]
                for k in ('rating', 'contestId'):
                    if _int(raw.get(k)) is not None:
                        new[k] = _int(raw[k])
                if isinstance(raw.get('index'), str) and raw['index']:
                    new['index'] = raw['index'][:4]
                if isinstance(raw.get('tags'), list) and raw['tags']:
                    new['tags'] = [t[:40] for t in raw['tags'] if isinstance(t, str)][:20]
                if new != old:
                    probs[pid], cp = new, True
            touched = set()
            for raw in att_in:
                if not isinstance(raw, dict) or not isinstance(raw.get('pid'), str) or not PID_RE.match(raw['pid']) or _int(raw.get('at')) is None:
                    continue
                pid = raw['pid']
                p = probs.get(pid) if isinstance(probs.get(pid), dict) else None
                if p is None:
                    m = re.match(r'^(\d+)(.+)$', pid)
                    p = probs[pid] = {'pid': pid, 'name': '', 'rating': None, 'tags': [], 'contestId': int(m.group(1)), 'index': m.group(2), 'attempts': [], 'status': 'tried'}
                    cp = True
                a = {'at': _int(raw['at']), 'status': raw.get('status') if raw.get('status') in STATUS_RANK else 'tried', 'src': _str(raw.get('src'), 20) or 'app'}
                if _int(raw.get('secs')) is not None:
                    a['secs'] = _int(raw['secs'])
                clear_act = raw.get('act') == ''  # explicit "no activity": replaces a stale one
                if isinstance(raw.get('act'), str) and raw['act']:
                    a['act'] = raw['act'][:90]
                att = p.setdefault('attempts', [])
                i = next((i for i, x in enumerate(att) if x.get('at') == a['at'] and x.get('src') == a['src']), None)
                if i is None:
                    att.append(a); cp = True
                else:
                    merged = {**att[i], **a}
                    if clear_act:
                        merged.pop('act', None)
                    if merged != att[i]:
                        att[i] = merged; cp = True
                touched.add(pid)
            for pid in touched:
                p = probs[pid]
                p['attempts'].sort(key=lambda x: x.get('at') or 0)
                before = (p.get('firstAt'), p.get('lastAt'), p.get('status'))
                self._recompute(p)
                cp = cp or before != (p.get('firstAt'), p.get('lastAt'), p.get('status'))
            if ca:
                self._save('activities.json', acts)
            if cp:
                self._save('problems.json', probs)
            for pid in probs:  # capture statements from the 30-day cache before it is pruned
                if pid not in self._stmts:
                    self._keep_statement(pid)
        return {'ok': True, 'activities': na, 'problems': np, 'createdAt': self.meta().get('createdAt'),
                'nActivities': len(acts), 'nProblems': len(probs)}

    # ───────── reads ─────────
    def summary(self):
        with self.lock:
            m = self.meta()
            return {'ver': VER, 'createdAt': m.get('createdAt'), 'codeDir': self.code_dir(), 'activities': _read_json(self.p('activities.json'), {}),
                    'problems': _read_json(self.p('problems.json'), {}), 'cards': dict(self._card_index),
                    'srs': _read_json(self.p('srs.json'), {}), 'links': _read_json(self.p('links.json'), {}),
                    'hasStatement': {pid: True for pid in sorted(self._stmts)}, 'cardJobs': self.jobs(m)}

    def jobs(self, m=None):
        m = m or self.meta()
        c = m.get('cards') or {}
        return {'running': self.running, 'queue': list(self.queue), 'doneToday': c.get('n', 0) if c.get('day') == _today() else 0,
                'cap': self.cap(), 'errors': dict(self.errors)}

    def card(self, pid):
        c = _read_json(self.p('cards', pid + '.json'), {})
        return c or None

    def _safe_path(self, rel):
        """absolute path of `rel` inside the code folder, or None (absolute paths, '..', or a symlink escaping it)"""
        base = self.code_dir()
        if not base or not isinstance(rel, str) or not rel or len(rel) > 1000 or '\0' in rel or '\\' in rel:
            return None
        if rel.startswith('/') or os.path.isabs(rel) or any(seg in ('..', '') or seg.startswith('.') for seg in rel.split('/')):
            return None
        if not rel.lower().endswith(CODE_EXT):
            return None
        full = os.path.realpath(os.path.join(base, rel))
        root = os.path.realpath(base)
        return full if full.startswith(root + os.sep) else None

    def code_for(self, pid):
        out = []
        for rel, l in sorted(_read_json(self.p('links.json'), {}).items()):
            if not isinstance(l, dict) or l.get('pid') != pid:
                continue
            full = self._safe_path(rel)
            if not full or not os.path.isfile(full):
                continue
            try:
                with open(full, errors='replace') as f:
                    text = f.read(CODE_TEXT_CAP + 1)
                if len(text) > CODE_TEXT_CAP:
                    text = text[:CODE_TEXT_CAP] + '\n// [… truncated]'
                out.append({'path': rel, 'text': text, 'mtime': int(os.path.getmtime(full) * 1000)})
            except OSError:
                pass
        return out

    def problem(self, pid):
        meta = _read_json(self.p('problems.json'), {}).get(pid)
        st = self.statement(pid, fetch=True)
        m = re.match(r'##\s*[A-Z]\d?\.\s*(.+)', st or '')
        if meta is not None and not meta.get('name') and m:
            # unrated problems are missing from the problemset the app ingests from: take the name off the statement
            with self.lock:
                allp = _read_json(self.p('problems.json'), {})
                if pid in allp and not allp[pid].get('name'):
                    allp[pid]['name'] = m.group(1).strip()[:200]
                    self._save('problems.json', allp)
                    meta = allp[pid]
        return {'meta': meta, 'statement': st or '', 'card': self.card(pid), 'srs': _read_json(self.p('srs.json'), {}).get(pid),
                'code': self.code_for(pid)}

    def scan_code(self):
        base = self.code_dir()
        if not base:
            return {'dir': self.meta().get('codeDir') or os.environ.get('MOMENTUM_CODE') or '', 'ok': False, 'files': []}
        files = []
        for dp, dns, fns in os.walk(base):
            dns[:] = sorted(d for d in dns if not d.startswith('.'))
            for fn in sorted(fns):
                if fn.startswith('.') or not fn.lower().endswith(CODE_EXT):
                    continue
                full = os.path.join(dp, fn)
                rel = os.path.relpath(full, base).replace(os.sep, '/')
                if '\\' in rel or self._safe_path(rel) is None:
                    continue  # a backslash in the name, or a symlink out of the folder: it could never be linked
                try:
                    st = os.stat(full)
                    if not os.path.isfile(full) or st.st_size > CODE_MAX_SIZE:
                        continue
                    with open(full, errors='replace') as f:
                        head = f.read(CODE_HEAD)
                except OSError:
                    continue
                files.append({'path': rel, 'mtime': int(st.st_mtime * 1000), 'size': st.st_size, 'head': head})
                if len(files) >= CODE_MAX_FILES:
                    return {'dir': base, 'ok': True, 'files': files}
        return {'dir': base, 'ok': True, 'files': files}

    # ───────── writes ─────────
    def set_code_dir(self, d):
        if not isinstance(d, str):
            return False, 'codeDir must be a string'
        d = d.strip()
        full = os.path.abspath(os.path.expanduser(d)) if d else ''
        if full and not os.path.isdir(full):
            return False, 'not an existing directory'
        why = code_dir_refusal(full, self.data) if full else ''
        if why:
            return False, why
        with self.lock:
            m = self._meta_strict()
            if m.get('codeDir') != full:
                m['codeDir'] = full
                self._save('meta.json', m)
        return True, self.code_dir()

    def link(self, items):
        """-> (ok, error, changed, skipped). Invalid entries are skipped, not fatal, so one odd file never blocks the
        rest of a batch; the call fails only when nothing in it was valid."""
        if not isinstance(items, list):
            return False, 'links must be a list', 0, 0
        with self.lock:
            links = _read_strict(self.p('links.json'), {})
            n, changed, valid, skipped, first_err = 0, False, 0, 0, ''
            for it in items[:10000]:
                if not isinstance(it, dict):
                    skipped += 1
                    continue
                rel, pid, by = it.get('path'), it.get('pid'), it.get('by')
                err = '' if by in ('auto', 'user') else f'bad by: {str(by)[:20]}'
                if not err and not self._safe_path(rel):
                    err = f'bad path: {str(rel)[:200]}'
                if not err and pid is not None and (not isinstance(pid, str) or not PID_RE.match(pid)):
                    err = f'bad pid: {str(pid)[:20]}'
                if err:
                    skipped += 1; first_err = first_err or err
                    continue
                valid += 1
                old = links.get(rel)
                if by == 'auto' and isinstance(old, dict) and old.get('by') == 'user':
                    continue  # the user's choice (including an explicit unlink) always wins
                if isinstance(old, dict) and old.get('pid') == pid and old.get('by') == by:
                    continue
                links[rel] = {'pid': pid, 'by': by, 'u': _now_ms()}
                n, changed = n + 1, True
            if changed:
                self._save('links.json', links)
        if skipped and not valid:
            return False, first_err or 'no valid links', 0, skipped
        return True, '', n, skipped

    def review(self, pid, grade, today):
        with self.lock:
            srs = _read_strict(self.p('srs.json'), {})
            old = srs.get(pid) if isinstance(srs.get(pid), dict) else None
            s = schedule(old, grade, today)
            if old is None:
                s['first'] = today  # the day of the first review (the client's new-cards-per-day allowance)
            elif isinstance(old.get('first'), str):
                s['first'] = old['first']
            srs[pid] = s
            self._save('srs.json', srs)
        return s

    # ───────── flashcard worker: one problem at a time, one-shot `claude -p` (never the coach session) ─────────
    def cap(self):
        try:
            return max(0, int(os.environ.get('MOMENTUM_CARD_MAX_DAY') or 60))
        except ValueError:
            return 60

    def model(self):
        return os.environ.get('MOMENTUM_CARD_MODEL') or 'sonnet'

    def _save_queue(self):
        try:
            _write_json(self.p('work', 'queue.json'), list(self.queue))
        except OSError:
            pass

    def queue_cards(self, pids, force=False):
        if not isinstance(pids, list):
            return 0
        n = 0
        with self.cv:
            for pid in pids[:5000]:
                if not isinstance(pid, str) or not PID_RE.match(pid) or pid in self.queue or pid == self.running:
                    continue
                if pid in self._card_index and not force:
                    continue
                self.queue.append(pid); self.errors.pop(pid, None); n += 1
            if n:
                self._save_queue()
                self.cv.notify_all()
        if n:
            self.start()
        return n

    def start(self):
        with self.lock:
            if self.queue and not self.closing and self.worker is None:
                self.worker = threading.Thread(target=self._work, daemon=True, name='archive-cards')
                self.worker.start()

    def _take(self):
        """next pid when under today's cap, else None after waiting a while (the cap resets at midnight)"""
        with self.cv:
            while not self.closing:
                if not self.queue:
                    self.worker = None  # decided under the lock: a pid queued from now on starts a new worker
                    return None
                m = self.meta()
                c = m.get('cards') or {}
                done = c.get('n', 0) if c.get('day') == _today() else 0
                if done < self.cap():
                    self.running = self.queue[0]
                    return self.running
                self.cv.wait(300)
            self.worker = None
            return None

    def _count(self):
        with self.lock:
            m = self._meta_strict()
            c = m.get('cards') or {}
            m['cards'] = {'day': _today(), 'n': (c.get('n', 0) if c.get('day') == _today() else 0) + 1}
            self._save('meta.json', m)

    def _work(self):
        while True:
            pid = self._take()
            if pid is None:
                return
            try:
                err = self._make_card(pid)
            except Exception as ex:  # never let the worker die
                err = f'internal error: {ex}'
            with self.cv:
                if self.closing:
                    self.running = None
                    self.worker = None
                    return  # killed mid-run: stays queued for the next server
                if pid in self.queue:
                    self.queue.remove(pid)
                if err:
                    self.errors[pid] = err[:400]
                self.running = None
                self._save_queue()

    def _card_cmd(self):
        return [self.cli(), '-p', '--output-format', 'json', '--model', self.model(),
                '--json-schema', json.dumps(prompts.CARD_SCHEMA), '--tools', 'WebFetch',
                '--allowedTools', 'WebFetch(domain:codeforces.com)', 'WebFetch(domain:cp-algorithms.com)',
                '--strict-mcp-config', '--setting-sources', 'user', '--disable-slash-commands',
                '--system-prompt', prompts.CARD_SYS]

    def _timeout(self):
        try:
            return int(os.environ.get('MOMENTUM_CLAUDE_TIMEOUT') or 600)
        except ValueError:
            return 600

    def _kill_orphan(self):
        """a card run left over from a server that died hard (its cwd is our work dir)"""
        run = os.path.realpath(self.p('work', 'run'))
        for pid in _read_json(self.p('work', 'running.json'), []) or []:
            try:
                if os.path.realpath(f'/proc/{int(pid)}/cwd') == run:
                    print(f'Stopping a flashcard run left over from the last run (pid {pid})', flush=True)
                    self._killgroup(int(pid))
            except (OSError, ValueError):
                pass
        try:
            _write_json(self.p('work', 'running.json'), [])
        except OSError:
            pass

    @staticmethod
    def _killgroup(pgid):
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(pgid, sig)
            except (ProcessLookupError, PermissionError):
                return
            for _ in range(30):
                time.sleep(0.1)
                try:
                    os.killpg(pgid, 0)
                except (ProcessLookupError, PermissionError):
                    return

    def _make_card(self, pid):
        if not self.cli():
            return 'Claude Code is not installed on the server machine'
        meta = _read_json(self.p('problems.json'), {}).get(pid) or {'pid': pid}
        st = self.statement(pid, fetch=True)
        files, total = [], 0
        for c in self.code_for(pid)[:4]:
            t = c['text'][:20000]
            if total + len(t) > 45000:
                break
            files.append((c['path'], t)); total += len(t)
        attempts = [{k: a.get(k) for k in ('at', 'status', 'src', 'secs') if a.get(k) is not None} for a in meta.get('attempts') or []]
        for a in attempts:
            a['at'] = time.strftime('%Y-%m-%d %H:%M', time.localtime(a['at'] / 1000)) if a.get('at') else ''
        prompt = prompts.build_card_prompt(meta, st, attempts, files)
        run = self.p('work', 'run')
        os.makedirs(run, exist_ok=True)
        with self.lock:
            if self.closing:
                return None
            p = subprocess.Popen(self._card_cmd(), cwd=run, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, start_new_session=True)
            self.proc = p
            try:
                _write_json(self.p('work', 'running.json'), [p.pid])
            except OSError:
                pass
        try:
            so, se = p.communicate(input=prompt, timeout=self._timeout())
        except subprocess.TimeoutExpired:
            self._killgroup(p.pid)
            p.wait()
            if self.closing:
                return None
            self._count()  # a run killed at the timeout used the most usage of all
            return f'timed out after {self._timeout()}s'
        finally:
            with self.lock:
                self.proc = None
                try:
                    _write_json(self.p('work', 'running.json'), [])
                except OSError:
                    pass
        if self.closing:
            return None
        self._count()  # every finished run counts against the daily cap (failed ones cost usage too)
        try:
            res = json.loads(so)
        except (json.JSONDecodeError, TypeError):
            lines = [l for l in ((so or '') + '\n' + (se or '')).strip().splitlines() if l.strip()]
            return 'Claude Code failed: ' + (lines[-1][:300] if lines else f'exit {p.returncode}')
        so_ = res.get('structured_output') if isinstance(res, dict) else None
        if not isinstance(res, dict) or res.get('is_error') or not isinstance(so_, dict):
            return 'Claude Code: ' + str((res or {}).get('result') or (res or {}).get('subtype') or 'no structured answer')[:300]
        card = {'pid': pid, 'at': _now_ms(), 'model': self.model(), 'ver': VER,
                'summary': _str(so_.get('summary'), 3000), 'key_idea': _str(so_.get('key_idea'), 500),
                'intended': _str(so_.get('intended'), 8000), 'mine': _str(so_.get('mine'), 6000), 'compare': _str(so_.get('compare'), 4000),
                'pitfalls': [x[:300] for x in so_.get('pitfalls') or [] if isinstance(x, str)][:8],
                'tags': [x[:40] for x in so_.get('tags') or [] if isinstance(x, str)][:12]}
        if not card['summary'] and not card['intended']:
            return 'Claude Code returned an empty card'
        with self.lock:
            self._backup()
            _write_json(self.p('cards', pid + '.json'), card)
            self._card_index[pid] = {'at': card['at'], 'key_idea': card['key_idea']}
        return None

    def shutdown(self):
        with self.cv:
            self.closing = True
            p = self.proc
            self.cv.notify_all()
        if p:
            self._killgroup(p.pid)

    def digest(self):
        return digest(self.data)
