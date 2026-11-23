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
import shutil; shutil.rmtree(tmp, ignore_errors=True)  # noqa: E402,E702
print(f'\n{ok} passed, {bad} failed')
sys.exit(1 if bad else 0)
