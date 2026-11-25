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
CARD_VER = 2  # 2: math written as $…$ LaTeX (rendered with KaTeX)
PID_RE = re.compile(r'^\d{1,4}[A-Z]\d?$')
ACT_ID_RE = re.compile(r'^(test|sess|cf|cfv|free):[A-Za-z0-9:_.~\-]{1,80}$')  # app ids carry '~' (2026-11-23~mwtdgl8j)
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
        self._no_stmt = set()
        for f in os.listdir(self.p('cards')):
            if f.endswith('.json'):
                c = _read_json(self.p('cards', f), {})
                if c.get('pid'):
                    self._card_index[c['pid']] = self._card_entry(c)
        self._stmts = {f[:-4] for f in os.listdir(self.p('statements')) if f.endswith('.txt')}
        # flashcard worker
        self.cv = threading.Condition(self.lock)
        solved0 = {k for k, v in (_read_json(self.p('problems.json'), {}) or {}).items() if isinstance(v, dict) and v.get('status') == 'solved'}
        self.queue = [p for p in _read_json(self.p('work', 'queue.json'), []) if isinstance(p, str) and PID_RE.match(p) and p in solved0]
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
        # drop: app records the client knows were never real work (a mock rerolled after seconds, an abandoned one
        #   with nothing opened): the activity and its attempts go, and a tombstone keeps a stale device from re-adding it
        # full: app activities whose complete attempt list this send carries: attempts tied to them that are not in
        #   this send are stale (an earlier, wrong derivation) and are replaced, and so are their pids / solved
        drop = {x for x in (body.get('drop') or []) if isinstance(x, str) and ACT_ID_RE.match(x) and x.split(':')[0] in ('test', 'sess')}
        full = {x for x in (body.get('full') or []) if isinstance(x, str) and ACT_ID_RE.match(x) and x.split(':')[0] in ('test', 'sess')} - drop
        na = np = 0
        with self.lock:
            acts = _read_strict(self.p('activities.json'), {})
            probs = _read_strict(self.p('problems.json'), {})
            dropped = _read_json(self.p('dropped.json'), {})
            ca = cp = False
            # never tombstone real work: a record with something solved, or a failed / solved attempt, stays
            # (a device without your Codeforces submissions can mistake a mock you worked on for a reroll)
            worked = {x.get('act') for p in probs.values() if isinstance(p, dict) for x in (p.get('attempts') or [])
                      if isinstance(x, dict) and x.get('status') in ('failed', 'solved')}
            worked |= {k for k, a in acts.items() if isinstance(a, dict) and a.get('solved')}
            drop -= worked
            if drop - set(dropped):
                for x in drop:
                    dropped.setdefault(x, _now_ms())
                self._save('dropped.json', dropped)
            for x in drop:
                if acts.pop(x, None) is not None:
                    ca = True
            gone = set(dropped)
            for raw in acts_in:
                a = self._clean_activity(raw)
                if not a or a['id'] in gone:
                    continue
                na += 1
                old = acts.get(a['id']) if isinstance(acts.get(a['id']), dict) else {}
                new = {**old, **a}
                # a device without the contest list sends "Round 1772": never replace a real name with that placeholder
                if re.fullmatch(r'(Virtual · )?Round \d+', a.get('title') or '') and old.get('title') and not re.fullmatch(r'(Virtual · )?Round \d+', old['title']):
                    new['title'] = old['title']
                if _int(old.get('at')) is not None and _int(a.get('at')) is not None and a['at'] > old['at']:
                    new['at'] = old['at']  # a re-sent group the client has partly pruned starts later: keep the true start
                    if isinstance(old.get('date'), str):
                        new['date'] = old['date']
                for k in ('pids', 'solved'):
                    if isinstance(old.get(k), list) and a['id'] not in full:
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
            keep = {}  # act in full -> {(pid, at, src)} sent now
            for raw in att_in:
                if isinstance(raw, dict) and raw.get('act') in full and _int(raw.get('at')) is not None:
                    keep.setdefault(raw['act'], set()).add((raw.get('pid'), _int(raw['at']), _str(raw.get('src'), 20) or 'app'))
            for pid, p in list(probs.items()):
                att = p.get('attempts') or []
                kept = [x for x in att if not (x.get('act') in gone or (x.get('act') in full and (pid, x.get('at'), x.get('src')) not in keep.get(x['act'], set())))]
                if len(kept) != len(att):
                    p['attempts'] = kept; touched.add(pid); cp = True
            for raw in att_in:
                if isinstance(raw, dict) and raw.get('act') in gone:
                    continue
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
            used = {q for a in acts.values() for q in (a.get('pids') or [])}
            for pid in list(touched):
                p = probs[pid]
                if not p.get('attempts') and pid not in used and pid not in self._card_index:
                    del probs[pid]; touched.discard(pid); cp = True  # only ever came from a dropped record
                    continue
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
                    'hasStatement': {pid: True for pid in sorted(self._stmts)}, 'cardJobs': self.jobs(m),
                    'organize': m.get('organize', True) is not False, 'lastOrganize': self.last_organize()}

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
    # ───────── keeping the code folder organized ─────────
    # Every LINKED file goes to <Kind>/<date> <round>/<pid> <problem name>.<ext>, filed under the first round or session
    # the problem appeared in. Files edited in the last ORG_HOLD (maybe open in an editor mid-contest), unlinked files
    # and anything that would overwrite a file are left alone. Only paths change, never contents; every batch is logged
    # in organize.jsonl and the latest batch can be undone.
    ORG_HOLD_MS = 2 * 3600 * 1000
    ORG_DIRS = {'contest': 'Contests', 'virtual': 'Virtual', 'mock': 'Mocks', 'practice': 'Practice', 'free': 'Practice'}

    @staticmethod
    def _clean_name(t, cap=90):
        t = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '', str(t or ''))
        t = re.sub(r'\s+', ' ', t).strip().strip('.').strip()
        return t[:cap].rstrip()

    def _org_target(self, pid, ext, acts, probs):
        """relative folder + file name for a problem's code (no collision handling)"""
        home = None
        for a in sorted(acts.values(), key=lambda a: (a.get('at') or 0, a.get('id') or '')):
            if a.get('note') == 'voided' or pid not in (a.get('pids') or []):
                continue
            if home is None or (home.get('kind') in ('practice', 'free') and a.get('kind') in ('contest', 'virtual', 'mock') and a.get('date') == home.get('date')):
                home = a  # first place it showed up (a same-day round wins over a practice session that served it)
            if home.get('kind') not in ('practice', 'free'):
                break
        p = probs.get(pid) or {}
        if home is None:
            # code for a problem of a round you entered but never submitted: it still belongs to that round
            mc = re.match(r'^(\d+)', pid)
            cid = p.get('contestId') or (int(mc.group(1)) if mc else None)
            home = next((a for a in sorted(acts.values(), key=lambda a: a.get('at') or 0)
                         if a.get('note') != 'voided' and cid and a.get('contestId') == cid and a.get('kind') in ('contest', 'virtual', 'mock')), None)
        if home:
            kind, date, title = home.get('kind'), home.get('date') or '', home.get('title') or ''
            title = re.sub(r'^Virtual · ', '', title)
            if kind in ('contest', 'virtual'):
                folder = f"{self.ORG_DIRS[kind]}/{self._clean_name(date + ' ' + title)}"
            else:
                folder = f"{self.ORG_DIRS.get(kind, 'Practice')}/{date}"
        else:
            first = p.get('firstAt')
            folder = 'Practice/' + time.strftime('%Y-%m-%d', time.localtime(first / 1000)) if first else 'Other'
        name = self._clean_name(f"{pid} {p.get('name') or self._stmt_name(pid)}") or pid
        return folder, name + ext

    def _stmt_name(self, pid):
        """a problem's name off its kept statement ('## B1. Name'), for problems the problemset has no name for"""
        try:
            with open(self.p('statements', pid + '.txt')) as f:
                m = re.match(r'##\s*[A-Z]\d?\.\s*(.+)', f.readline())
            return m.group(1).strip() if m else ''
        except OSError:
            return ''

    def organize(self, apply=True, now=None):
        """-> {moves:[{from,to}], kept:[{path, why}]}; with apply the moves are made and logged as one batch"""
        base = self.code_dir()
        if not base:
            return {'moves': [], 'kept': [], 'error': 'no code folder configured'}
        now = now or _now_ms()
        # name the files properly: fetch (outside the lock, once) the statement of any linked problem with no name yet
        probs0 = _read_json(self.p('problems.json'), {})
        for l in _read_json(self.p('links.json'), {}).values():
            pid = l.get('pid') if isinstance(l, dict) else None
            if pid and not (probs0.get(pid) or {}).get('name') and not self._stmt_name(pid) and pid not in self._no_stmt:
                if not self.statement(pid, fetch=True):
                    self._no_stmt.add(pid)  # unreachable now: don't hold every pass up retrying it
                elif self._stmt_name(pid) and pid in probs0:
                    with self.lock:
                        allp = _read_strict(self.p('problems.json'), {})
                        if pid in allp and not allp[pid].get('name'):
                            allp[pid]['name'] = self._stmt_name(pid)[:200]
                            self._save('problems.json', allp)
        with self.lock:
            links = _read_strict(self.p('links.json'), {})
            acts = _read_json(self.p('activities.json'), {})
            probs = _read_json(self.p('problems.json'), {})
            taken = set()
            for dp, dns, fns in os.walk(base):
                dns[:] = [d for d in dns if not d.startswith('.')]
                for fn in fns:
                    taken.add(os.path.relpath(os.path.join(dp, fn), base).replace(os.sep, '/').lower())
            plan, kept = [], []
            for rel in sorted(links):
                l = links[rel]
                pid = l.get('pid') if isinstance(l, dict) else None
                if not pid:
                    continue
                full = self._safe_path(rel)
                if not full or not os.path.isfile(full):
                    continue
                if self._symlinked(base, rel):
                    kept.append({'path': rel, 'why': 'symlink (left where it is)'}); continue
                if now - os.path.getmtime(full) * 1000 < self.ORG_HOLD_MS:
                    kept.append({'path': rel, 'why': 'edited in the last 2 hours'}); continue
                ext = os.path.splitext(rel)[1].lower()
                folder, name = self._org_target(pid, ext, acts, probs)
                want = f'{folder}/{name}'
                if self._filed(rel, folder, pid):
                    continue  # already filed (a second file for the same problem keeps its " (2)" name)
                stem, i = want[:-len(ext)] if ext else want, 2
                while want.lower() in taken:
                    want = f'{stem} ({i}){ext}'; i += 1
                if self._safe_path(want) is None:
                    kept.append({'path': rel, 'why': 'no safe name'}); continue
                taken.discard(rel.lower()); taken.add(want.lower())
                plan.append({'from': rel, 'to': want, 'pid': pid})
            if not apply or not plan:
                return {'moves': [{'from': m['from'], 'to': m['to']} for m in plan], 'kept': kept}
            done = []
            for m in plan:
                src, dst = os.path.join(base, m['from']), os.path.join(base, m['to'])
                try:
                    if os.path.lexists(dst):
                        kept.append({'path': m['from'], 'why': 'target exists'}); continue
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    self._move(src, dst)
                except OSError as ex:
                    kept.append({'path': m['from'], 'why': f'could not move: {ex.strerror or ex}'}); continue
                done.append(m)
            self._org_relink(done, links)
            self._prune_dirs(base, [m['from'] for m in done])
            if done:
                self._append_batch({'at': now, 'base': os.path.realpath(base), 'moves': [{'from': m['from'], 'to': m['to']} for m in done]})
            return {'moves': [{'from': m['from'], 'to': m['to']} for m in done], 'kept': kept}

    def _org_relink(self, done, links):
        """links (and the code list of cards) follow moved files; caller holds the lock"""
        if not done:
            return
        ren = {m['from']: m['to'] for m in done}
        for a, b in ren.items():
            if a in links:
                links[b] = {**links.pop(a), 'u': _now_ms()}
        self._save('links.json', links)
        cdir = self.p('cards')
        for pid in {m.get('pid') for m in done if m.get('pid')} | set(self._card_index):
            fp = os.path.join(cdir, pid + '.json')
            card = _read_json(fp, None)
            if isinstance(card, dict) and any(c in ren for c in card.get('code') or []):
                card['code'] = sorted(ren.get(c, c) for c in card['code'])
                _write_json(fp, card)

    @staticmethod
    def _prune_dirs(base, rels):
        """remove folders the moves left empty (never the code folder itself, never a folder with anything in it)"""
        root = os.path.realpath(base)
        for rel in rels:
            d = os.path.dirname(os.path.join(base, rel))
            while os.path.realpath(d).startswith(root + os.sep):
                try:
                    os.rmdir(d)  # fails unless empty
                except OSError:
                    break
                d = os.path.dirname(d)

    def organize_undo(self):
        """move the latest batch (of THIS code folder) back: only files still where the batch put them, only onto free
        paths. Moves that cannot go back stay in the log (and are reported), so nothing loses its undo record."""
        base = self.code_dir()
        if not base:
            return {'undone': 0, 'error': 'no code folder configured'}
        with self.lock:
            lines = self._batch_lines()
            mine = [i for i, b in enumerate(lines) if b is not None and self._same_base(b, base)]
            if not mine:
                return {'undone': 0, 'skipped': []}
            idx = mine[-1]
            batch = lines[idx]
            links = _read_strict(self.p('links.json'), {})
            back, left = [], []
            for m in reversed(batch.get('moves') or []):
                cur, old = self._safe_path(m['to']), self._safe_path(m['from'])
                why = ''
                if not cur or not old or not os.path.isfile(cur):
                    why = 'no longer where it was filed'
                elif os.path.lexists(os.path.join(base, m['from'])):
                    why = 'its old place is taken again'
                else:
                    try:
                        os.makedirs(os.path.dirname(old), exist_ok=True)
                        self._move(cur, old)
                    except OSError as ex:
                        why = f'could not move: {ex.strerror or ex}'
                if why:
                    left.append({**m, 'why': why}); continue
                back.append({'from': m['to'], 'to': m['from'], 'pid': (links.get(m['to']) or {}).get('pid')})
            self._org_relink(back, links)
            self._prune_dirs(base, [m['from'] for m in back])
            rest = [{'from': m['from'], 'to': m['to']} for m in reversed(left)]
            lines[idx] = {**batch, 'moves': rest} if rest else None
            self._write_batches(lines)
            # undoing turns automatic organizing off, or the next pass would just redo it
            m = self._meta_strict(); m['organize'] = False; _write_json(self.p('meta.json'), m)
            return {'undone': len(back), 'skipped': [{'path': m['to'], 'why': m['why']} for m in left]}

    # organize.jsonl: one batch per line, each tagged with the code folder it ran in; unreadable lines are skipped
    def _batch_lines(self):
        out = []
        try:
            with open(self.p('organize.jsonl')) as f:
                for line in f:
                    if not line.strip():
                        continue
                    try:
                        b = json.loads(line)
                        out.append(b if isinstance(b, dict) and isinstance(b.get('moves'), list) else None)
                    except ValueError:
                        out.append(None)
        except OSError:
            pass
        return out

    def _write_batches(self, lines):
        _write_text(self.p('organize.jsonl'), ''.join(json.dumps(b) + '\n' for b in lines if b is not None and b.get('moves')))

    def _append_batch(self, batch):
        os.makedirs(self.root, exist_ok=True)
        fp = self.p('organize.jsonl')
        with open(fp, 'a+b') as f:
            f.seek(0, os.SEEK_END)
            if f.tell():
                f.seek(-1, os.SEEK_END)
                if f.read(1) != b'\n':
                    f.write(b'\n')  # a line cut off by a crash must not swallow this batch
            f.write((json.dumps(batch) + '\n').encode())
            f.flush(); os.fsync(f.fileno())

    @staticmethod
    def _same_base(b, base):
        return b.get('base', os.path.realpath(base)) == os.path.realpath(base)  # batches from before tagging: this folder

    def _moved(self, rel):
        """where a code path is now, following every organize batch of this code folder"""
        base = self.code_dir()
        for b in self._batch_lines():
            if b is not None and (not base or self._same_base(b, base)):
                for m in b.get('moves') or []:
                    if m.get('from') == rel:
                        rel = m['to']
        return rel

    def last_organize(self):
        base = self.code_dir()
        bs = [b for b in self._batch_lines() if b is not None and b.get('moves') and base and self._same_base(b, base)]
        b = bs[-1] if bs else None
        return {'at': b.get('at'), 'moves': b['moves'][:200], 'n': len(b['moves'])} if b else None

    @staticmethod
    def _move(src, dst):
        """rename that never replaces an existing file: hard-link then unlink (fails with EEXIST), else a checked rename"""
        try:
            os.link(src, dst, follow_symlinks=False)
        except FileExistsError:
            raise
        except OSError:
            if os.path.lexists(dst):
                raise FileExistsError(dst)
            os.rename(src, dst)
            return
        os.unlink(src)

    @staticmethod
    def _symlinked(base, rel):
        """the file or any folder on its way is a symlink (moving it would move the link, not the file)"""
        root = os.path.realpath(base)
        cur = root
        for seg in rel.split('/'):
            cur = os.path.join(cur, seg)
            if os.path.islink(cur):
                return True
        return False

    def _filed(self, rel, folder, pid):
        """already in its place: in the target folder, or for a round, in any folder of that kind for that day (a
        round renamed later must not send its files back and forth), with a name that starts with the problem id"""
        d, b = os.path.dirname(rel), os.path.basename(rel)
        if not (b.startswith(pid + ' ') or b.startswith(pid + '.') or b.startswith(pid + ' (')):
            return False
        if d == folder:
            return True
        kind, _, rest = folder.partition('/')
        date = rest[:10]
        return kind in ('Contests', 'Virtual') and len(date) == 10 and d.startswith(f'{kind}/{date} ')

    def set_organize(self, on):
        with self.lock:
            m = self._meta_strict(); m['organize'] = bool(on); _write_json(self.p('meta.json'), m)
        return bool(on)

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
                # undo history belongs to the old folder: set it aside so "Undo" can never touch the new one
                if os.path.exists(self.p('organize.jsonl')):
                    os.replace(self.p('organize.jsonl'), self.p(f'organize-{_now_ms()}.jsonl'))
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

    @staticmethod
    def _card_entry(c):
        """what the card list needs without opening every card: its front (summary), key idea and topics"""
        return {'at': c.get('at'), 'key_idea': c.get('key_idea', ''), 'summary': (c.get('summary') or '')[:700],
                'tags': [t for t in c.get('tags') or [] if isinstance(t, str)][:8], 'ver': c.get('ver', 1)}

    def auto_queue(self):
        """cards come up on their own: every problem you SOLVED gets one (newest first, the
        daily cap still applies and the rest waits in the saved queue). A card written before your code was linked is
        rewritten once the code is there, so "how you solved it" is never left blank. MOMENTUM_AUTO_CARDS=0 turns it off."""
        if os.environ.get('MOMENTUM_AUTO_CARDS', '1') == '0' or not self.cli():
            return 0
        with self.lock:
            probs = _read_json(self.p('problems.json'), {})
            linked = {}
            for rel, l in (_read_json(self.p('links.json'), {}) or {}).items():
                if isinstance(l, dict) and l.get('pid'):
                    linked.setdefault(l['pid'], set()).add(rel)
            new, redo, maybe, redo_now = [], [], [], []
            for pid, p in sorted(probs.items(), key=lambda kv: -(kv[1].get('lastAt') or 0)):
                if pid in self.errors or pid in self.queue or pid == self.running:
                    continue
                if pid in self._card_index:
                    won = [x.get('at') or 0 for x in p.get('attempts') or [] if x.get('status') == 'solved']
                    if p.get('status') == 'solved' and won and (self._card_index[pid].get('at') or 0) < min(won):
                        redo_now.append(pid)  # written before you solved it: rewrite with how you did solve it
                        continue
                    if pid in linked:
                        card = _read_json(self.p('cards', pid + '.json'), {}) or {}
                        if not card.get('mine'):
                            maybe.append((pid, set(card.get('code') or [])))
                    continue
                if p.get('status') == 'solved':  # unsolved ones wait in the upsolve list; they get a card once solved
                    new.append(pid)
        # rewrite only when the card would now be fed code it was not written from (a stale link to a deleted file,
        # or files past the 4-file / size budget, would otherwise rewrite it on every ingest)
        for pid, had in maybe:
            fed = {f for f, _ in self._card_files(pid)}
            if fed and not fed <= had:
                redo.append(pid)
        redo += redo_now
        return self.queue_cards(new) + (self.queue_cards(redo, force=True) if redo else 0)

    def queue_cards(self, pids, force=False):
        if not isinstance(pids, list):
            return 0
        n = 0
        solved = {k for k, v in (_read_json(self.p('problems.json'), {}) or {}).items() if isinstance(v, dict) and v.get('status') == 'solved'}
        with self.cv:
            for pid in pids[:5000]:
                if not isinstance(pid, str) or not PID_RE.match(pid) or pid in self.queue or pid == self.running:
                    continue
                if pid not in solved:
                    continue  # flashcards are only for problems you have solved
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
                    pid = self.queue[0]
                    if (_read_json(self.p('problems.json'), {}).get(pid) or {}).get('status') != 'solved':
                        self.queue.pop(0); self._save_queue(); continue  # flashcards are only for solved problems
                    self.running = pid
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
        if hasattr(os, 'killpg'):
            for sig in (getattr(signal, 'SIGTERM', None), getattr(signal, 'SIGKILL', None)):
                if sig is None:
                    continue
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
        else:
            try:
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(pgid)], capture_output=True)
            except Exception:
                pass

    def _card_files(self, pid):
        """the linked code a card is written from: (path, text), at most 4 files within the size budget"""
        files, total = [], 0
        for c in self.code_for(pid)[:4]:
            t = c['text'][:20000]
            if total + len(t) > 45000:
                break
            files.append((c['path'], t)); total += len(t)
        return files

    def _make_card(self, pid):
        if not self.cli():
            return 'Claude Code is not installed on the server machine'
        meta = _read_json(self.p('problems.json'), {}).get(pid) or {'pid': pid}
        st = self.statement(pid, fetch=True)
        files = self._card_files(pid)
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
        card = {'pid': pid, 'at': _now_ms(), 'model': self.model(), 'ver': CARD_VER, 'code': sorted(f for f, _ in files),
                'summary': _str(so_.get('summary'), 3000), 'key_idea': _str(so_.get('key_idea'), 500),
                'intended': _str(so_.get('intended'), 8000), 'mine': _str(so_.get('mine'), 6000), 'compare': _str(so_.get('compare'), 4000),
                'pitfalls': [x[:300] for x in so_.get('pitfalls') or [] if isinstance(x, str)][:8],
                'tags': [x[:40] for x in so_.get('tags') or [] if isinstance(x, str)][:12]}
        if not card['summary'] and not card['intended']:
            return 'Claude Code returned an empty card'
        with self.lock:
            card['code'] = sorted(self._moved(c) for c in card['code'])  # the folder may have been organized meanwhile
            self._backup()
            _write_json(self.p('cards', pid + '.json'), card)
            self._card_index[pid] = self._card_entry(card)
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
