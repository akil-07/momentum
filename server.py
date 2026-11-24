#!/usr/bin/env python3
"""Momentum sync server — zero dependencies (Python 3 standard library only).

Serves the built app from ./dist and a tiny sync API:
  GET /api/state[?since=rev] -> {"rev": int, "doc": object|null}, ETag "rev"; 304 when since / If-None-Match is current
  PUT /api/state {rev, doc}  -> 200 {"rev": new} | 409 if someone pushed first (client re-pulls and re-merges)
                               | 413 {"error": "..."} when the doc exceeds MAX_BODY (the app shows the message)
Both require  Authorization: Bearer <sync key>.  The merge logic lives in the client, so the server only
stores one JSON document and refuses stale writes.

Claude sessions (run on the local Claude Code CLI, i.e. your Claude subscription):
  POST /api/coach/turn   {turn_id, kind, message?, data, pid?} -> 202 {job}
         kind 'review' also takes {pid, code, want_fix, hint, solved}; with a pid the server adds the problem statement
  POST /api/planner/turn {turn_id, prompt, context}            -> 202 {job}
  GET  /api/job/<turn_id>                                      -> {state, result?|error?}
  GET  /api/session/<coach|planner>[/log?after=ms]             -> info / transcript
  POST /api/session/<coach|planner>/reset {keep_notebook}

Archive (archive.py: permanent record in data/archive/, never pruned; flashcards via one-shot claude -p):
  GET  /api/archive                 everything (activities, problems, card index, srs, links, cardJobs)
  GET  /api/archive/problem/<pid>   {meta, statement, card, srs, code:[{path, text, mtime}]}
  GET  /api/archive/code            scan of the code folder
  POST /api/archive/ingest {activities, problems, attempts, drop, full}   idempotent upsert; queues cards on its own
  POST /api/archive/config {codeDir}   POST /api/archive/link {links:[{path, pid, by}]}
  POST /api/archive/cards {pids, force?}   POST /api/archive/review {pid, grade, today}
  POST /api/archive/organize {apply?} -> {moves, kept}   POST /api/archive/organize/undo   POST /api/archive/config {organize}

Usage:  python3 server.py [--port 8787]
Listens on 127.0.0.1 only; open http://localhost:8787 in a browser on the same machine.
The sync key is read from $MOMENTUM_KEY or ./data/sync_key.txt (generated on first run and printed).
"""
import shutil
import signal, argparse, hmac, html, json, mimetypes, os, re, secrets, sys, tempfile, threading, time, urllib.request
from html.parser import HTMLParser
import archive, prompts
from sessions import Sessions
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.environ.get('MOMENTUM_DIST') or os.path.join(ROOT, 'dist')
DATA = os.environ.get('MOMENTUM_DATA') or os.path.join(ROOT, 'data')
STATE_FILE = os.path.join(DATA, 'state.json')
KEY_FILE = os.path.join(DATA, 'sync_key.txt')
MAX_BODY = 8 * 1024 * 1024
LOCK = threading.Lock()
mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('text/javascript', '.js')


def load_key():
    if os.environ.get('MOMENTUM_KEY'):
        return os.environ['MOMENTUM_KEY'].strip()
    os.makedirs(DATA, exist_ok=True)
    if not os.path.exists(KEY_FILE):
        with open(KEY_FILE, 'w') as f:
            f.write(secrets.token_urlsafe(24))
        os.chmod(KEY_FILE, 0o600)
    with open(KEY_FILE) as f:
        return f.read().strip()


def read_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {'rev': 0, 'doc': None}


_rev_cache = [None, 0]  # (mtime_ns, size) -> rev: the revision poll must not parse the ~1 MB document every 30 s


def current_rev():
    try:
        st = os.stat(STATE_FILE)
        sig = (st.st_mtime_ns, st.st_size)
    except OSError:
        return 0
    if _rev_cache[0] != sig:
        _rev_cache[:] = [sig, int(read_state().get('rev') or 0)]
    return _rev_cache[1]


def write_state(obj):
    os.makedirs(DATA, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DATA, prefix='.state-')
    with os.fdopen(fd, 'w') as f:
        json.dump(obj, f, separators=(',', ':'))
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, STATE_FILE)  # atomic: a crash never leaves a half-written file
    backup_state()


BACKUP_DIR, BACKUP_KEEP = os.path.join(DATA, 'backups'), 14


def backup_state():
    """one copy of state.json per day (the first write of the day keeps yesterday's end state); the newest 14 days are kept"""
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        day = time.strftime('%Y-%m-%d')
        dst = os.path.join(BACKUP_DIR, f'state-{day}.json')
        shutil.copyfile(STATE_FILE, dst)  # overwritten through the day: each file is that day's last state
        old = sorted(f for f in os.listdir(BACKUP_DIR) if f.startswith('state-') and f.endswith('.json'))
        for f in old[:-BACKUP_KEEP]:
            os.remove(os.path.join(BACKUP_DIR, f))
    except OSError as e:
        print('backup failed:', e, flush=True)


# ───────── problem statements (for the coach): codeforces.com/contest/<cid>/problem/<idx>, cached on disk ─────────
PID_RE = re.compile(r'^(\d{1,4})([A-Z]\d?)$')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
STMT_DIR = os.path.join(DATA, 'claude', 'statements')
STMT_CAP, STMT_NEG_TTL = 8000, 3600
_stmt_lock, _stmt_last = threading.Lock(), [0.0]


class _StatementText(HTMLParser):
    """plain text of <div class="problem-statement">: paragraphs, bullets, $$$math$$$ kept as text, sample tests verbatim"""
    BLOCK = {'p', 'div', 'ul', 'ol', 'table', 'tr', 'h1', 'h2', 'h3', 'center'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth, self.pre, self.skip, self.out, self.prop = 0, 0, 0, [], False

    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get('class') or ''
        if not self.depth:
            if tag == 'div' and 'problem-statement' in cls.split():
                self.depth = 1
            return
        if tag == 'div':
            self.depth += 1
        if tag in ('script', 'style'):
            self.skip += 1
        elif tag == 'pre':
            self.pre += 1; self.out.append('\n')
        elif tag == 'br':
            self.out.append('\n')
        elif tag == 'li':
            self.out.append('\n- ')
        elif tag in self.BLOCK and not self.pre:
            self.out.append('\n')
        if 'property-title' in cls:
            self.prop = True
        if tag == 'div' and ('section-title' in cls or (cls == 'title' and self.depth > 2)):
            self.out.append('\n## ')

    def handle_endtag(self, tag):
        if not self.depth:
            return
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)
        elif tag == 'pre':
            self.pre = max(0, self.pre - 1); self.out.append('\n')
        elif tag == 'div':
            if self.pre:
                self.out.append('\n')  # test-example-line
            elif self.prop:
                self.out.append(': '); self.prop = False
            else:
                self.out.append('\n')
            self.depth -= 1
        elif tag in self.BLOCK and not self.pre:
            self.out.append('\n')

    def handle_data(self, d):
        if self.depth and not self.skip:
            self.out.append(d if self.pre else re.sub(r'\s+', ' ', d))

    def text(self):
        t = ''.join(self.out)
        t = '\n'.join(l.strip() for l in t.split('\n'))
        return re.sub(r'\n{2,}', '\n', t).strip()


def statement_text(page):
    p = _StatementText()
    p.feed(page)
    return p.text()


def fetch_statement(pid):
    """text of problem `pid` (e.g. 1900A), <= ~8 KB, or '' when unavailable. Never raises."""
    m = PID_RE.match(pid or '')
    if not m:
        return ''
    path, neg = os.path.join(STMT_DIR, pid + '.txt'), os.path.join(STMT_DIR, pid + '.fail')
    try:
        with open(path) as f:
            t = f.read()
        if len(t) >= 80:  # a short/empty file is a broken cache entry: refetch
            return t
    except OSError:
        pass
    try:
        if time.time() - os.path.getmtime(neg) < STMT_NEG_TTL:
            return ''
    except OSError:
        pass
    url = f'https://codeforces.com/contest/{m.group(1)}/problem/{m.group(2)}'
    try:
        with _stmt_lock:  # one fetch at a time, >= 2.1 s apart (Codeforces rate limits)
            wait = 2.1 - (time.time() - _stmt_last[0])
            if wait > 0:
                time.sleep(wait)
            try:
                req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en'})
                with urllib.request.urlopen(req, timeout=15) as r:
                    page = r.read(2_000_000).decode('utf-8', 'replace')
            finally:
                _stmt_last[0] = time.time()
        text = statement_text(page)
        if len(text) < 80:
            raise ValueError('no statement on the page')
        if len(text) > STMT_CAP:
            text = text[:STMT_CAP].rsplit('\n', 1)[0] + '\n[… statement truncated]'
        os.makedirs(STMT_DIR, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=STMT_DIR, prefix='.stmt-')
        try:
            with os.fdopen(fd, 'w') as f:
                f.write(text)
            os.replace(tmp, path)  # atomic: a crash mid-write never leaves a truncated cache entry
        except OSError as ex:
            print(f'statement {pid}: cache write failed: {ex}', file=sys.stderr, flush=True)
            try:
                os.unlink(tmp)
            except OSError:
                pass
        return text
    except Exception as ex:
        print(f'statement {pid}: {ex}', file=sys.stderr, flush=True)
        try:
            os.makedirs(STMT_DIR, exist_ok=True)
            with open(neg, 'w') as f:
                f.write(str(ex)[:200])
        except OSError:
            pass
        return ''


STMT_KEEP_DAYS = 30


def prune_statements():
    """the statement cache is refetchable: drop entries older than 30 days (the coach logs/notebooks are never touched)"""
    cutoff, n = time.time() - STMT_KEEP_DAYS * 86400, 0
    try:
        names = os.listdir(STMT_DIR)
    except OSError:
        return 0
    for f in names:
        p = os.path.join(STMT_DIR, f)
        try:
            if os.path.isfile(p) and os.path.getmtime(p) < cutoff:
                os.remove(p); n += 1
        except OSError:
            pass
    return n


def _coach_prompt(kind, message, data, pid, code):
    """deferred: runs on the coach worker thread, so a slow statement fetch never blocks the HTTP request"""
    def build():
        st = fetch_statement(pid) if pid else ''
        return prompts.build_coach_prompt(kind, message, data, (pid, st) if st else None, code)
    return build


class Handler(SimpleHTTPRequestHandler):
    server_version = 'Momentum'
    sys_version = ''

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIST, **kw)

    def log_message(self, fmt, *args):
        if self.path.startswith('/api/'):
            sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))

    # ── helpers ──
    def cors(self):  # only the local Vite dev server (npm run dev) needs this; the built app is same-origin
        origin = self.headers.get('Origin') or ''
        if re.fullmatch(r'http://(localhost|127\.0\.0\.1)(:\d+)?', origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match')
            self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
            self.send_header('Access-Control-Expose-Headers', 'ETag')

    def json(self, code, obj, etag=None):
        body = json.dumps(obj, separators=(',', ':')).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        if etag:
            self.send_header('ETag', etag)
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        got = self.headers.get('Authorization', '')
        ok = got.startswith('Bearer ') and hmac.compare_digest(got[7:].encode(), self.server.key.encode())
        if not ok:
            self.json(401, {'error': 'bad key'})
        return ok

    # ── API ──
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()

    def body(self, limit=1024 * 1024):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > limit:
            left = n if 0 < n <= 4 * limit else 0  # drain (bounded) so the client sees the 413, not a reset
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                left -= len(chunk)
            if n > 4 * limit:
                self.close_connection = True
            self.json(413, {'error': 'body size'})
            return None
        try:
            b = json.loads(self.rfile.read(n))
            assert isinstance(b, dict)
            return b
        except Exception:
            self.json(400, {'error': 'bad body'})
            return None

    def do_POST(self):
        path = self.path.split('?')[0]
        if not path.startswith('/api/'):
            return self.json(404, {'error': 'not found'})
        if not self.authed():
            return
        S = self.server.sessions
        if path == '/api/coach/turn':
            b = self.body()
            if b is None:
                return
            kind = b.get('kind') if b.get('kind') in prompts.COACH_KIND_HINTS else 'ask'
            data, message = b.get('data') or {}, str(b.get('message') or '')
            if not isinstance(data, dict):
                return self.json(400, {'error': 'bad data'})
            pid, src = b.get('pid'), None
            if pid is not None and (not isinstance(pid, str) or not PID_RE.match(pid)):
                return self.json(400, {'error': 'bad pid'})
            meta = {'message': message, 'kind': kind}
            if kind == 'review':
                src = b.get('code')
                if not pid or not isinstance(src, str) or not src.strip():
                    return self.json(400, {'error': 'review needs pid and code'})
                hint = b.get('hint', 0)
                if not isinstance(hint, int) or isinstance(hint, bool) or not 0 <= hint <= 3:
                    return self.json(400, {'error': 'bad hint'})
                if not isinstance(b.get('want_fix', False), bool) or not isinstance(b.get('solved', False), bool):
                    return self.json(400, {'error': 'bad flags'})
                n, cut = len(src), len(src) > 20000  # truncated here only: build_coach_prompt keeps the marker
                src = src[:20000] + ('\n// [… code truncated at 20000 chars]' if cut else '')
                rv = data.get('review') if isinstance(data.get('review'), dict) else {}
                # the server's validated fields win over anything in data
                want_fix = bool(b.get('want_fix')) and hint >= 3 and not b.get('solved')  # hints first: the fix unlocks at the full-editorial stage
                data = {**data, 'review': {**rv, 'pid': pid, 'hint_stage': hint, 'want_fix': want_fix,
                                           'solved': bool(b.get('solved')), 'code_chars': n}}
                meta.update(pid=pid, hint=hint, want_fix=want_fix, solved=bool(b.get('solved')))
            elif pid:
                st = data.get('stuck') if isinstance(data.get('stuck'), dict) else {}
                data = {**data, 'stuck': {**st, 'pid': pid}}
                meta['pid'] = pid
            size = len(json.dumps(data, separators=(',', ':'), ensure_ascii=False)) + len(message) + len(src or '')
            if size > 390_000:
                return self.json(413, {'error': 'coach payload too large'})
            code, obj = S.submit('coach', str(b.get('turn_id') or ''), kind, _coach_prompt(kind, message, data, pid, src), meta)
            return self.json(code, obj)
        if path == '/api/planner/turn':
            b = self.body()
            if b is None:
                return
            req, ctx = str(b.get('prompt') or '').strip(), b.get('context') or {}
            if not req or not isinstance(ctx, dict):
                return self.json(400, {'error': 'prompt required'})
            prompt = prompts.build_planner_prompt(req, ctx)
            if len(prompt) > 400_000:
                return self.json(413, {'error': 'planner payload too large'})
            code, obj = S.submit('planner', str(b.get('turn_id') or ''), 'plan', prompt, {'message': req})
            return self.json(code, obj)
        if path.startswith('/api/archive/'):
            return self.archive_post(path)
        m = re.fullmatch(r'/api/session/(coach|planner)/reset', path)
        if m:
            b = self.body(64 * 1024)
            if b is None:
                return
            gen = S.reset(m.group(1), bool(b.get('keep_notebook', True)))
            return self.json(200, {'gen': gen})
        return self.json(404, {'error': 'not found'})

    def archive_post(self, path):
        try:
            return self._archive_post(path)
        except archive.StoreError as e:  # an archive file could not be read back: refuse rather than overwrite it
            print('archive:', e, flush=True)
            return self.json(500, {'error': f'archive storage error: {e}'})

    def _archive_post(self, path):
        A = self.server.archive
        if path == '/api/archive/ingest':
            b = self.body(4 * 1024 * 1024)
            if b is None:
                return
            res = A.ingest(b)
            A.auto_queue()
            return self.json(200, res)
        if path == '/api/archive/config':
            b = self.body(64 * 1024)
            if b is None:
                return
            if 'organize' in b and 'codeDir' not in b:
                if not isinstance(b['organize'], bool):
                    return self.json(400, {'error': 'organize must be true or false'})
                return self.json(200, {'ok': True, 'organize': A.set_organize(b['organize'])})
            ok, res = A.set_code_dir(b.get('codeDir'))
            return self.json(200 if ok else 400, {'ok': True, 'codeDir': res} if ok else {'error': res})
        if path == '/api/archive/organize':
            b = self.body(64 * 1024)
            if b is None:
                return
            if not A.code_dir():
                return self.json(400, {'error': 'no code folder configured'})
            return self.json(200, A.organize(apply=b.get('apply', True) is not False))
        if path == '/api/archive/organize/undo':
            if self.body(64 * 1024) is None:
                return
            return self.json(200, A.organize_undo())
        if path == '/api/archive/link':
            b = self.body(4 * 1024 * 1024)
            if b is None:
                return
            if not A.code_dir():
                return self.json(400, {'error': 'no code folder configured'})
            ok, err, n, skipped = A.link(b.get('links'))
            if ok and n:
                A.auto_queue()  # newly linked code: cards for it (or a rewrite of one that had no "how you solved it")
            return self.json(200 if ok else 400, {'ok': True, 'changed': n, 'skipped': skipped} if ok else {'error': err})
        if path == '/api/archive/cards':
            b = self.body(256 * 1024)
            if b is None:
                return
            if not isinstance(b.get('pids'), list) or not isinstance(b.get('force', False), bool):
                return self.json(400, {'error': 'pids must be a list'})
            if not self.server.sessions.cli():
                return self.json(503, {'error': 'Claude Code is not installed on the server machine (needs the `claude` command).'})
            return self.json(200, {'queued': A.queue_cards(b['pids'], b.get('force', False)), 'cardJobs': A.jobs()})
        if path == '/api/archive/review':
            b = self.body(64 * 1024)
            if b is None:
                return
            pid, g, today = b.get('pid'), b.get('grade'), b.get('today')
            if not isinstance(pid, str) or not PID_RE.match(pid):
                return self.json(400, {'error': 'bad pid'})
            if not isinstance(g, int) or isinstance(g, bool) or not 0 <= g <= 3:
                return self.json(400, {'error': 'bad grade'})
            if not isinstance(today, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', today):
                return self.json(400, {'error': 'bad today'})
            try:
                return self.json(200, {'srs': A.review(pid, g, today)})
            except ValueError:
                return self.json(400, {'error': 'bad today'})
        return self.json(404, {'error': 'not found'})

    def do_PUT(self):
        if self.path.split('?')[0] != '/api/state':
            return self.json(404, {'error': 'not found'})
        if not self.authed():
            return
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:
            # drain (bounded) before answering: a reset mid-upload would hide the 413 from the client behind a network error
            left = n if n <= 8 * MAX_BODY else 0
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                left -= len(chunk)
            if n > 8 * MAX_BODY:
                self.close_connection = True  # unread body must not be parsed as the next request
            return self.json(413, {'error': f'Sync data is too large ({n / 1048576:.1f} MB, the server accepts up to {MAX_BODY // 1048576} MB)'})
        if n <= 0:
            return self.json(400, {'error': 'empty body'})
        try:
            body = json.loads(self.rfile.read(n))
            rev, doc = int(body['rev']), body['doc']
            assert isinstance(doc, dict) and doc.get('v') == 2
        except Exception:
            return self.json(400, {'error': 'bad body'})
        with LOCK:
            cur = read_state()
            if rev != cur['rev']:
                return self.json(409, {'rev': cur['rev']})
            write_state({'rev': rev + 1, 'doc': doc})
        self.json(200, {'rev': rev + 1}, etag=f'"{rev + 1}"')

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/state':
            if self.authed():
                q = dict(p.split('=', 1) for p in (self.path.split('?', 1)[1] if '?' in self.path else '').split('&') if '=' in p)
                with LOCK:
                    rev = current_rev()
                    tag = f'"{rev}"'
                    # cheap revision poll: nothing changed since the client's copy -> 304, no body
                    if q.get('since') == str(rev) or tag in (self.headers.get('If-None-Match') or ''):
                        self.send_response(304)
                        self.send_header('ETag', tag)
                        self.send_header('Cache-Control', 'no-store')
                        self.cors()
                        return self.end_headers()
                    st = read_state()
                    self.json(200, st, etag=f'"{st.get("rev", 0)}"')
            return
        if path == '/api/ping':
            return self.json(200, {'ok': True})
        m = re.fullmatch(r'/api/job/([A-Za-z0-9-]{8,64})', path)
        if m:
            if self.authed():
                j = self.server.sessions.get_job(m.group(1))
                self.json(200 if j else 404, j or {'error': 'unknown job'})
            return
        m = re.fullmatch(r'/api/session/(coach|planner)(/log)?', path)
        if m:
            if self.authed():
                if m.group(2):
                    q = dict(p.split('=', 1) for p in (self.path.split('?', 1)[1] if '?' in self.path else '').split('&') if '=' in p)
                    try:
                        after, limit = int(q.get('after', 0)), max(1, min(200, int(q.get('limit', 50))))
                    except ValueError:
                        return self.json(400, {'error': 'bad query'})
                    self.json(200, {'entries': self.server.sessions.read_log(m.group(1), after, limit)})
                else:
                    self.json(200, self.server.sessions.info(m.group(1)))
            return
        if path == '/api/archive' or path.startswith('/api/archive/'):
            if not self.authed():
                return
            A = self.server.archive
            if path == '/api/archive':
                return self.json(200, A.summary())
            if path == '/api/archive/code':
                return self.json(200, A.scan_code())
            m = re.fullmatch(r'/api/archive/problem/([0-9A-Z]{2,6})', path)
            if m and PID_RE.match(m.group(1)):
                return self.json(200, A.problem(m.group(1)))
            return self.json(404 if not m else 400, {'error': 'not found' if not m else 'bad pid'})
        if path.startswith('/api/'):
            return self.json(404, {'error': 'not found'})
        # static app with SPA fallback
        if not os.path.exists(os.path.join(DIST, path.lstrip('/'))) or path == '/':
            self.path = '/index.html'
        return super().do_GET()

    def end_headers(self):
        p = self.path.split('?')[0]
        if not p.startswith('/api/'):
            if p.startswith('/assets/'):
                self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
            else:
                self.send_header('Cache-Control', 'no-cache')
            self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


def main():
    ap = argparse.ArgumentParser(description='Momentum sync server')
    ap.add_argument('--port', type=int, default=8787)
    a = ap.parse_args()
    if not os.path.isdir(DIST):
        sys.exit('dist/ not found — run `npm run build` first')
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    srv.key = load_key()
    srv.sessions = Sessions(DATA)
    srv.archive = archive.Archive(DATA, fetch_statement=fetch_statement, stmt_cache_dir=STMT_DIR, cli=srv.sessions.cli)
    srv.archive.start()  # resumes a flashcard queue left by the last run

    def housekeeping():  # the server runs for weeks: prune the refetchable caches daily, not only at start
        while True:
            prune_statements()
            srv.sessions._prune_jobs()
            time.sleep(86400)
    threading.Thread(target=housekeeping, daemon=True).start()
    print(f'Momentum serving on http://127.0.0.1:{a.port}')
    print(f'Sync key: {srv.key}')
    def stop(*_):
        raise KeyboardInterrupt
    # closing the terminal (SIGHUP) or `kill` (SIGTERM) shuts down as cleanly as Ctrl+C
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, stop)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        print('Stopping running Claude turns…', flush=True)
        srv.sessions.shutdown()
        srv.archive.shutdown()
        srv.server_close()


if __name__ == '__main__':
    main()
