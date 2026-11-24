#!/usr/bin/env python3
"""server.py / sessions.py checks: starts the server on a random localhost port with a temp data dir and probes the sync API.
Usage: python3 tests/server_check.py   (prints PASS/FAIL lines, exit 1 on any failure)"""
import http.client, json, os, socket, subprocess, sys, tempfile, time

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP)
ok = bad = 0


def check(name, cond):
    global ok, bad
    ok, bad = ok + bool(cond), bad + (not cond)
    print(('PASS ' if cond else 'FAIL ') + name, flush=True)


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def lan_ip():  # a non-loopback address of this machine, if any (no packet is sent)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('10.255.255.255', 1)); ip = s.getsockname()[0]; s.close()
        return None if ip.startswith('127.') else ip
    except OSError:
        return None


tmp = tempfile.mkdtemp(prefix='momentum-srv-')
data, dist = os.path.join(tmp, 'data'), os.path.join(tmp, 'dist')
os.makedirs(dist); open(os.path.join(dist, 'index.html'), 'w').write('<!doctype html><title>t</title>')
# seed: statement cache (one stale entry), a coach log with cumulative per-turn costs, and an inflated registry total
stm = os.path.join(data, 'claude', 'statements'); os.makedirs(stm)
for f, age in (('1A.txt', 40), ('2B.txt', 2), ('3C.fail', 31)):
    p = os.path.join(stm, f); open(p, 'w').write('x' * 100); t = time.time() - age * 86400; os.utime(p, (t, t))
cdir = os.path.join(data, 'claude', 'coach'); os.makedirs(cdir)
costs = [(1, 0.2), (1, 0.45), (1, 0.7), (2, 0.1), (2, 0.35)]  # gen 1 ends at 0.70, gen 2 at 0.35 -> true total 1.05
with open(os.path.join(cdir, 'log.jsonl'), 'w') as f:
    for i, (g, c) in enumerate(costs):
        f.write(json.dumps({'turn_id': f't{i}', 'at': i + 1, 'kind': 'ask', 'gen': g, 'cost_usd': c}) + '\n')
old_log = os.path.join(cdir, 'log.jsonl'); t = time.time() - 90 * 86400; os.utime(old_log, (t, t))
json.dump({'coach': {'gen': 2, 'id': 'x', 'turns': 2, 'cost_usd': sum(c for _, c in costs), 'history': []}}, open(os.path.join(data, 'claude', 'sessions.json'), 'w'))

KEY, port = 'test-key-123', free_port()
env = {**os.environ, 'MOMENTUM_DATA': data, 'MOMENTUM_KEY': KEY, 'MOMENTUM_DIST': dist, 'MOMENTUM_CLAUDE_BIN': '/nonexistent', 'PYTHONUNBUFFERED': '1'}
proc = subprocess.Popen([sys.executable, os.path.join(APP, 'server.py'), '--port', str(port)], env=env, cwd=tmp,
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
try:
    for _ in range(100):
        try:
            socket.create_connection(('127.0.0.1', port), 0.2).close(); break
        except OSError:
            time.sleep(0.05)
    line = proc.stdout.readline()
    check(f'default bind is 127.0.0.1 ({line.strip()})', '127.0.0.1' in line)
    ip = lan_ip()
    if ip:
        try:
            socket.create_connection((ip, port), 1).close(); reach = True
        except OSError:
            reach = False
        check('not reachable on a non-loopback address', not reach)
    else:
        print('SKIP no non-loopback address to probe')

    def req(method, path, body=None, headers=None, auth=True):
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=20)
        h = {**({'Authorization': 'Bearer ' + KEY} if auth else {}), **(headers or {})}
        if body is not None:
            h['Content-Type'] = 'application/json'
        c.request(method, path, body=body, headers=h)
        r = c.getresponse(); raw = r.read(); c.close()
        try:
            j = json.loads(raw) if raw else None
        except ValueError:
            j = None
        return r.status, j, dict(r.getheaders())

    s, j, _ = req('GET', '/api/state', auth=False)
    check('no key -> 401', s == 401)
    s, j, h = req('GET', '/api/state')
    check('empty server: 200 {rev:0, doc:null} with ETag "0"', s == 200 and j == {'rev': 0, 'doc': None} and h.get('ETag') == '"0"')
    s, j, _ = req('GET', '/api/state?since=0')
    check('?since=current -> 304 with no body', s == 304 and j is None)
    s, _, _ = req('GET', '/api/state', headers={'If-None-Match': '"0"'})
    check('If-None-Match current ETag -> 304', s == 304)
    doc = {'v': 2, 'days': {}, 'x': 'y' * 1000}
    s, j, h = req('PUT', '/api/state', json.dumps({'rev': 0, 'doc': doc}))
    check('PUT at the current rev -> 200 rev 1', s == 200 and j == {'rev': 1} and h.get('ETag') == '"1"')
    s, j, _ = req('GET', '/api/state?since=0')
    check('?since=old -> 200 with the new doc', s == 200 and j['rev'] == 1 and j['doc'] == doc)
    s, _, _ = req('GET', '/api/state?since=1')
    check('?since=new -> 304', s == 304)
    s, j, _ = req('PUT', '/api/state', json.dumps({'rev': 0, 'doc': doc}))
    check('stale PUT -> 409 with the current rev', s == 409 and j == {'rev': 1})
    s, j, _ = req('PUT', '/api/state', json.dumps({'rev': 1, 'doc': {'v': 1}}))
    check('wrong doc version -> 400', s == 400)
    big = json.dumps({'rev': 1, 'doc': {'v': 2, 'pad': 'z' * (9 * 1024 * 1024)}})
    s, j, _ = req('PUT', '/api/state', big)
    check(f'oversized PUT -> 413 with a readable message ({(j or {}).get("error")})', s == 413 and 'too large' in (j or {}).get('error', ''))
    s, j, _ = req('GET', '/api/state?since=1')
    check('413 left the state alone (still rev 1, 304)', s == 304)
    s, _, _ = req('POST', '/api/coach', json.dumps({'summary': {}}))
    check('legacy blocking /api/coach is gone (404)', s == 404)
    check('daily backup written', any(f.startswith('state-') for f in os.listdir(os.path.join(data, 'backups'))))
    time.sleep(0.3)
    left = sorted(os.listdir(stm))
    check(f'statement cache: entries older than 30 days pruned, fresh kept ({left})', left == ['2B.txt'])
    check('coach log (memory seed) untouched even though it is old', os.path.exists(old_log))
    s, j, _ = req('GET', '/api/session/coach')
    check(f'usage: cost rebuilt from cumulative log values = max per gen summed ({j and j.get("cost_usd")})', s == 200 and abs(j['cost_usd'] - 1.05) < 1e-9)
    check('usage response shape unchanged', s == 200 and {'name', 'model', 'gen', 'turns', 'day_turns', 'max_day', 'cost_usd', 'last_at', 'last_usage', 'busy', 'queued', 'notebook', 'history'} <= set(j) and 'id' not in j and 'cost_last' not in j)
finally:
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()

# a restart must not re-apply the cost migration
from sessions import Sessions  # noqa: E402
S = Sessions(data)
check('migration runs once (total stays 1.05 after a restart)', abs(S.info('coach')['cost_usd'] - 1.05) < 1e-9)
# per-turn accounting: deltas within a conversation, a fresh conversation counts from zero
ent = {'cost_usd': 1.05, 'cost_gen': 2, 'cost_last': 0.35}
d1 = Sessions._cost_step(ent, 2, 0.6)
d2 = Sessions._cost_step(ent, 3, 0.15)
d3 = Sessions._cost_step(ent, 3, 0.4)
check(f'turn costs are deltas ({d1:.2f}, {d2:.2f}, {d3:.2f}) and the total is 1.70', abs(d1 - 0.25) < 1e-9 and abs(d2 - 0.15) < 1e-9 and abs(d3 - 0.25) < 1e-9 and abs(ent['cost_usd'] - 1.70) < 1e-9)
d4 = Sessions._cost_step(ent, 3, 0.1)  # the CLI restarted its counter inside one generation: treat as fresh
check('a drop in the reported value counts as a fresh conversation', abs(d4 - 0.1) < 1e-9 and abs(ent['cost_usd'] - 1.80) < 1e-9)
S.shutdown()

# ───────── archive: endpoints, upsert-only storage, links, SM-2, flashcard worker (stub claude), digest ─────────
import archive  # noqa: E402
adata, code = os.path.join(tmp, 'adata'), os.path.join(tmp, 'code')
stm2 = os.path.join(adata, 'claude', 'statements'); os.makedirs(stm2)
STMT = 'You are given an array of n integers. Find the maximum sum of a subarray. Input: n, then the array. Output: one number.'
for pid in ('1900A', '1900B', '1901C'):
    open(os.path.join(stm2, pid + '.txt'), 'w').write(STMT + ' ' + pid)
for d in ('Mock Rounds/1', 'Contests/900 (Div 2)', '.git', 'Daily/01-11-2026/Learn'):
    os.makedirs(os.path.join(code, d))
open(os.path.join(code, 'Mock Rounds/1/A.cpp'), 'w').write('// 1900A\nint main(){return 0;}\n')
open(os.path.join(code, 'Contests/900 (Div 2)/B.cpp'), 'w').write('int main(){}\n')
open(os.path.join(code, 'Daily/01-11-2026/Learn/C. Max Sum.cpp'), 'w').write('int main(){}\n')
open(os.path.join(code, '.git/x.cpp'), 'w').write('hidden')
open(os.path.join(code, 'notes.txt'), 'w').write('not code')
open(os.path.join(tmp, 'secret.cpp'), 'w').write('outside the code folder')
argv_log = os.path.join(tmp, 'stub-argv.jsonl')
stub = os.path.join(tmp, 'claude-stub')
with open(stub, 'w') as f:
    f.write(f"""#!{sys.executable}
import json, sys
prompt = sys.stdin.read()
open({argv_log!r}, 'a').write(json.dumps({{'argv': sys.argv[1:], 'prompt': prompt}}) + '\\n')
print(json.dumps({{'type': 'result', 'is_error': False, 'total_cost_usd': 0.01, 'structured_output': {{
    'summary': 'Max subarray sum.', 'key_idea': 'Kadane: best ending here', 'intended': '1. scan\\n2. keep best\\nO(n)',
    'mine': 'prefix sums', 'compare': 'same complexity', 'pitfalls': ['all negative'], 'tags': ['dp']}}}}))
""")
os.chmod(stub, 0o755)
port = free_port()
env = {**os.environ, 'MOMENTUM_DATA': adata, 'MOMENTUM_KEY': KEY, 'MOMENTUM_DIST': dist, 'MOMENTUM_CLAUDE_BIN': stub,
       'MOMENTUM_CARD_MAX_DAY': '2', 'PYTHONUNBUFFERED': '1'}
env.pop('MOMENTUM_CODE', None); env.pop('MOMENTUM_CARD_MODEL', None)
proc = subprocess.Popen([sys.executable, os.path.join(APP, 'server.py'), '--port', str(port)], env=env, cwd=tmp,
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
arc = os.path.join(adata, 'archive')


def snap():
    return {f: open(os.path.join(arc, f)).read() for f in ('activities.json', 'problems.json') if os.path.exists(os.path.join(arc, f))}


try:
    for _ in range(100):
        try:
            socket.create_connection(('127.0.0.1', port), 0.2).close(); break
        except OSError:
            time.sleep(0.05)
    s, j, _ = req('GET', '/api/archive', auth=False)
    check('archive: no key -> 401', s == 401)
    s, j, _ = req('POST', '/api/archive/ingest', json.dumps({}), auth=False)
    check('archive ingest: no key -> 401', s == 401)
    s, j, _ = req('GET', '/api/archive')
    check('archive: empty shape', s == 200 and j['ver'] == 1 and j['activities'] == {} and j['problems'] == {} and j['codeDir'] == ''
          and set(j['cardJobs']) == {'running', 'queue', 'doneToday', 'cap', 'errors'} and j['cardJobs']['cap'] == 2)
    T0 = 1762000000000
    body = {'activities': [
        {'id': 'test:m1', 'kind': 'mock', 'date': '2025-11-01', 'at': T0, 'end': T0 + 7200000, 'title': 'Mock · 2025-11-01', 'pids': ['1900A', '1900B'], 'solved': ['1900A'], 'perf': 1500},
        {'id': 'cf:1901', 'kind': 'contest', 'date': '2025-11-02', 'at': T0 + 86400000, 'title': 'Round 900', 'pids': ['1901C'], 'solved': [], 'rank': 1234, 'delta': -20},
        {'id': 'bad id', 'kind': 'mock', 'date': '2025-11-01'}, {'id': 'free:2025-11-01', 'kind': 'weird', 'date': '2025-11-01'}],
        'problems': [{'pid': '1900A', 'name': 'Max Sum', 'rating': 800, 'tags': ['dp'], 'contestId': 1900, 'index': 'A'},
                     {'pid': '1900B', 'name': 'Other', 'rating': 1200, 'tags': ['greedy'], 'contestId': 1900, 'index': 'B'},
                     {'pid': 'x1', 'name': 'bad'}],
        'attempts': [{'pid': '1900A', 'at': T0 + 600000, 'status': 'failed', 'src': 'cf', 'act': 'test:m1'},
                     {'pid': '1900A', 'at': T0 + 900000, 'status': 'solved', 'src': 'cf', 'secs': 900, 'act': 'test:m1'},
                     {'pid': '1901C', 'at': T0 + 86400000 + 5, 'status': 'failed', 'src': 'cf'},
                     {'pid': '../1A', 'at': T0, 'status': 'solved', 'src': 'cf'}]}
    s, j, _ = req('POST', '/api/archive/ingest', json.dumps(body))
    check(f'ingest: invalid ids/kinds/pids dropped ({j})', s == 200 and {k: j.get(k) for k in ('ok', 'activities', 'problems', 'nActivities', 'nProblems')} == {'ok': True, 'activities': 2, 'problems': 2, 'nActivities': 2, 'nProblems': 3} and isinstance(j.get('createdAt'), int))
    s, a, _ = req('GET', '/api/archive')
    p1 = a['problems'].get('1900A') or {}
    check('ingest: attempts stored, status solved wins, first/lastAt', p1.get('status') == 'solved' and len(p1.get('attempts', [])) == 2
          and p1.get('firstAt') == T0 + 600000 and p1.get('lastAt') == T0 + 900000)
    check('ingest: attempt-only problem gets a stub record (1901C failed)', a['problems'].get('1901C', {}).get('status') == 'failed' and a['problems']['1901C'].get('contestId') == 1901)
    check('ingest: statements copied from the 30-day cache into the permanent archive', a['hasStatement'] == {'1900A': True, '1900B': True, '1901C': True}
          and os.path.exists(os.path.join(arc, 'statements', '1900A.txt')))
    before = snap()
    s, j, _ = req('POST', '/api/archive/ingest', json.dumps(body))
    check('ingest: idempotent (re-ingest leaves the files byte-identical)', s == 200 and snap() == before)
    s, j, _ = req('POST', '/api/archive/ingest', json.dumps({'activities': [{'id': 'test:m1', 'kind': 'mock', 'date': '2025-11-01', 'pids': ['1900A'], 'solved': []}],
                                                           'problems': [{'pid': '1900A', 'name': '', 'tags': []}], 'attempts': []}))
    s, a, _ = req('GET', '/api/archive')
    m1 = a['activities']['test:m1']
    check('ingest: never deletes (other activity kept, pruned pids/solved kept, perf kept, empty name ignored)',
          'cf:1901' in a['activities'] and m1['pids'] == ['1900A', '1900B'] and m1['solved'] == ['1900A'] and m1.get('perf') == 1500
          and a['problems']['1900A']['name'] == 'Max Sum' and a['problems']['1900A']['tags'] == ['dp'])
    big = json.dumps({'activities': [], 'pad': 'z' * (4 * 1024 * 1024 + 10)})
    s, j, _ = req('POST', '/api/archive/ingest', big)
    check('ingest: body over 4 MB -> 413', s == 413)

    s, j, _ = req('GET', '/api/archive/code')
    check('code: not configured -> ok false', s == 200 and j['ok'] is False and j['files'] == [])
    s, j, _ = req('POST', '/api/archive/config', json.dumps({'codeDir': os.path.join(tmp, 'nope')}))
    check('config: missing directory -> 400', s == 400)
    s, j, _ = req('POST', '/api/archive/config', json.dumps({'codeDir': code}))
    check('config: existing directory saved', s == 200 and j['codeDir'] == os.path.abspath(code))
    s, j, _ = req('GET', '/api/archive/code')
    paths = sorted(f['path'] for f in (j or {}).get('files', []))
    check(f'code: scan lists code files only, skips hidden dirs ({paths})', s == 200 and j['ok'] and paths == ['Contests/900 (Div 2)/B.cpp', 'Daily/01-11-2026/Learn/C. Max Sum.cpp', 'Mock Rounds/1/A.cpp'])
    check('code: head + mtime + size present', all(f['head'] and f['mtime'] > 0 and f['size'] > 0 for f in j['files']) and j['files'][0]['head'] is not None)

    s, j, _ = req('POST', '/api/archive/link', json.dumps({'links': [{'path': '../secret.cpp', 'pid': '1900A', 'by': 'user'}]}))
    check('link: ".." path rejected', s == 400)
    s, j, _ = req('POST', '/api/archive/link', json.dumps({'links': [{'path': os.path.join(tmp, 'secret.cpp'), 'pid': '1900A', 'by': 'user'}]}))
    check('link: absolute path rejected', s == 400)
    os.symlink(os.path.join(tmp, 'secret.cpp'), os.path.join(code, 'esc.cpp'))
    s, j, _ = req('POST', '/api/archive/link', json.dumps({'links': [{'path': 'esc.cpp', 'pid': '1900A', 'by': 'user'}]}))
    check('link: symlink escaping the code folder rejected', s == 400)
    os.remove(os.path.join(code, 'esc.cpp'))
    s, j, _ = req('POST', '/api/archive/link', json.dumps({'links': [{'path': 'Mock Rounds/1/A.cpp', 'pid': '1900A', 'by': 'auto'},
                                                                    {'path': 'Contests/900 (Div 2)/B.cpp', 'pid': '1900B', 'by': 'auto'}]}))
    check('link: auto links saved', s == 200 and j['changed'] == 2)
    req('POST', '/api/archive/link', json.dumps({'links': [{'path': 'Contests/900 (Div 2)/B.cpp', 'pid': None, 'by': 'user'}]}))
    s, j, _ = req('POST', '/api/archive/link', json.dumps({'links': [{'path': 'Contests/900 (Div 2)/B.cpp', 'pid': '1900B', 'by': 'auto'}]}))
    s, a, _ = req('GET', '/api/archive')
    lk = a['links'].get('Contests/900 (Div 2)/B.cpp') or {}
    check('link: user link (an explicit unlink) wins over a later auto link', lk.get('by') == 'user' and lk.get('pid') is None and j['changed'] == 0)
    s, j, _ = req('POST', '/api/archive/link', json.dumps({'links': [{'path': 'Contests/900 (Div 2)/B.cpp', 'pid': '1901C', 'by': 'user'}]}))
    s, a, _ = req('GET', '/api/archive')
    check('link: a user link can be changed by the user', a['links']['Contests/900 (Div 2)/B.cpp']['pid'] == '1901C')

    s, j, _ = req('GET', '/api/archive/problem/1900A')
    check('problem: meta, permanent statement, linked code text', s == 200 and j['meta']['name'] == 'Max Sum' and j['statement'].startswith('You are given')
          and [c['path'] for c in j['code']] == ['Mock Rounds/1/A.cpp'] and '1900A' in j['code'][0]['text'] and j['card'] is None and j['srs'] is None)
    s, j, _ = req('GET', '/api/archive/problem/..%2Fx')
    check('problem: bad pid rejected', s in (400, 404))

    s, j, _ = req('POST', '/api/archive/review', json.dumps({'pid': '1900A', 'grade': 2, 'today': '2026-01-10'}))
    check(f'review: new card Good -> 1 day ({j})', s == 200 and j['srs']['ivl'] == 1 and j['srs']['due'] == '2026-01-11' and j['srs']['reps'] == 1)
    s, j, _ = req('POST', '/api/archive/review', json.dumps({'pid': '1900A', 'grade': 2, 'today': '2026-01-11'}))
    check('review: second Good -> 6 days', j['srs']['ivl'] == 6 and j['srs']['due'] == '2026-01-17')
    s, j, _ = req('POST', '/api/archive/review', json.dumps({'pid': '1900A', 'grade': 0, 'today': '2026-01-17'}))
    check('review: Again -> 1 day, lapse counted, ef drops', j['srs']['ivl'] == 1 and j['srs']['lapses'] == 1 and j['srs']['reps'] == 0 and j['srs']['ef'] < 2.5)
    s, j, _ = req('POST', '/api/archive/review', json.dumps({'pid': '1900A', 'grade': 4, 'today': '2026-01-17'}))
    check('review: bad grade -> 400', s == 400)

    s, j, _ = req('POST', '/api/archive/cards', json.dumps({'pids': ['1900A', 'bad', '1901C']}))
    check(f'cards: valid pids queued ({j and j.get("queued")})', s == 200 and j['queued'] == 2)
    for _ in range(200):
        s, a, _ = req('GET', '/api/archive')
        if not a['cardJobs']['queue'] and not a['cardJobs']['running']:
            break
        time.sleep(0.05)
    card = json.load(open(os.path.join(arc, 'cards', '1900A.json'))) if os.path.exists(os.path.join(arc, 'cards', '1900A.json')) else {}
    check(f'cards: worker wrote structured cards ({a["cardJobs"]})', card.get('key_idea') == 'Kadane: best ending here' and card.get('pid') == '1900A'
          and card.get('model') == 'sonnet' and card.get('ver') == 1 and set(a['cards']) == {'1900A', '1901C'} and a['cardJobs']['doneToday'] == 2)
    runs = [json.loads(l) for l in open(argv_log)] if os.path.exists(argv_log) else []
    av = runs[0]['argv'] if runs else []
    check('cards: one-shot claude -p (no --resume / --session-id), model sonnet, schema, WebFetch only',
          len(runs) == 2 and '-p' in av and '--resume' not in av and '--session-id' not in av and av[av.index('--model') + 1] == 'sonnet'
          and '--json-schema' in av and av[av.index('--tools') + 1] == 'WebFetch' and 'WebFetch(domain:codeforces.com)' in av and '--system-prompt' in av)
    r1 = next((r for r in runs if '"1900A"' in r['prompt']), {'prompt': ''})
    check('cards: prompt carries statement, attempts and the linked code', 'You are given' in r1['prompt'] and '"failed"' in r1['prompt'] and 'Mock Rounds/1/A.cpp' in r1['prompt'])
    s, j, _ = req('POST', '/api/archive/cards', json.dumps({'pids': ['1900A']}))
    check('cards: a pid with a card is skipped without force', j['queued'] == 0)
    s, j, _ = req('POST', '/api/archive/cards', json.dumps({'pids': ['1900A'], 'force': True}))
    time.sleep(0.5)
    s, a, _ = req('GET', '/api/archive')
    check('cards: daily cap holds the queue (cap 2 reached)', j['queued'] == 1 and a['cardJobs']['queue'] == ['1900A'] and a['cardJobs']['running'] is None and len([1 for _ in open(argv_log)]) == 2)
    check('archive: daily backup tarball written', any(f.startswith('archive-') and f.endswith('.tar.gz') for f in os.listdir(os.path.join(adata, 'backups'))))
finally:
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
check('cards: the held queue persists for the next server', json.load(open(os.path.join(arc, 'work', 'queue.json'))) == ['1900A'])

dg = archive.digest(adata)
check(f'digest: month rows + totals ({len(dg.splitlines())} lines)', '2025-11 |' in dg and 'contest:1 mock:1' in dg and '| 1/1 |' in dg and 'totals: 2 activities, 3 problems, 1 solved, 2 flashcards' in dg)
# five years of monthly activity still fits in ~60 lines (old years folded)
ydata = os.path.join(tmp, 'ydata'); os.makedirs(os.path.join(ydata, 'archive'))
acts = {f'test:{y}{mo}': {'id': f'test:{y}{mo}', 'kind': 'mock', 'date': f'{y}-{mo:02d}-05', 'perf': 1200 + y} for y in range(2021, 2027) for mo in range(1, 13)}
json.dump(acts, open(os.path.join(ydata, 'archive', 'activities.json'), 'w'))
dg5 = archive.digest(ydata).splitlines()
check(f'digest: 6 years -> <= 60 lines, oldest years folded ({len(dg5)})', len(dg5) <= 60 and any('(year)' in l for l in dg5) and dg5[-2].startswith('2026-12'))

S2 = Sessions(adata)
cmd = S2._cmd('coach', 'sid', True)
ad = cmd[cmd.index('--add-dir') + 1:cmd.index('--add-dir') + 3] if '--add-dir' in cmd else []
check('coach: --add-dir is exactly the code folder and data/archive', ad == [os.path.abspath(code), os.path.abspath(arc)])
tl = cmd[cmd.index('--tools') + 1]
al = cmd[cmd.index('--allowedTools') + 1:cmd.index('--add-dir')]
check(f'coach: read-only Read/Grep/Glob added, scoped to those dirs ({tl})', tl == 'WebFetch,Read,Grep,Glob' and f'Read(/{os.path.abspath(code)}/**)' in al
      and f'Grep(/{os.path.abspath(arc)}/**)' in al and not any(t in tl for t in ('Edit', 'Write', 'Bash')) and all(not a.startswith(('Read', 'Grep', 'Glob')) or a.endswith('/**)') for a in al))
import prompts  # noqa: E402
check('coach: system prompt has LONG-TERM MEMORY + paths; sys_ver bumped to 6', 'LONG-TERM MEMORY' in prompts.COACH_SYSTEM and prompts.SPECS['coach']['sys_ver'] == 6
      and os.path.abspath(code) in cmd[cmd.index('--system-prompt') + 1])
pc = S2._cmd('planner', 'sid', False)
check('planner: no file tools, no --add-dir', '--add-dir' not in pc and pc[pc.index('--tools') + 1] == '')
seed = S2._seed('coach', 'test', 3)
check('coach restart seed carries the long-term digest', '<long_term>' in seed and '2025-11 |' in seed)
check('planner restart seed has no archive digest', '<long_term>' not in S2._seed('planner', 'test', 3))
S2.shutdown()
nodata = os.path.join(tmp, 'nodata'); os.makedirs(nodata)
os.environ.pop('MOMENTUM_CODE', None)
S3 = Sessions(nodata)
c3 = S3._cmd('coach', 'sid', True)
check('coach without code folder / archive: WebFetch only, no --add-dir', '--add-dir' not in c3 and c3[c3.index('--tools') + 1] == 'WebFetch')
S3.shutdown()
import shutil; shutil.rmtree(tmp, ignore_errors=True)  # noqa: E402,E702
print(f'\n{ok} passed, {bad} failed')
sys.exit(1 if bad else 0)
