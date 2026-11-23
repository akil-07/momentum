// data resilience: Codeforces retry/backoff, Claude turn retry policy, offline trainer start, IndexedDB cache migration
import fs from 'fs'
import { spawnSync } from 'child_process'
const R = Date, base = new R(); base.setHours(10, 0, 0, 0); let T = base.getTime()
globalThis.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(T) } static now() { return T } }
const fixture = JSON.parse(fs.readFileSync('./fixtures/problems.json'))
const list = fixture.result.problems.filter(p => p.rating && p.contestId).map(p => ({ id: p.contestId + p.index, c: p.contestId, i: p.index, n: p.name, r: p.rating, t: p.tags, s: 1000 }))
// problemset cached but 4 days old: initTrainer has to try the network for it
const mem = new Map([['momentum.cf.problems', JSON.stringify({ at: T - 4 * 864e5, list })], ['momentum.sync', JSON.stringify({ url: 'http://laptop', token: 't' })]])
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: () => null, length: 0 }
const listeners = {}
globalThis.document = { addEventListener() {}, visibilityState: 'visible' }
globalThis.addEventListener = (n, f) => { (listeners[n] ||= new Set()).add(f) }
globalThis.removeEventListener = (n, f) => { listeners[n]?.delete(f) }
globalThis.window = { setTimeout: () => 0, clearTimeout() {}, open() {} }
// timers: short waits (rate gate, backoff, pump rounds) fire at once and move the clock; long ones (≥ 1 min retry schedule) are held for manual firing
const realST = setTimeout, delays = [], held = new Map(); let hid = 0
globalThis.setTimeout = (f, ms = 0) => { if (ms >= 60000) { held.set(++hid, { f, ms }); return hid } delays.push(ms); T += ms; return realST(f, 0) }
globalThis.clearTimeout = id => { held.delete(id) }
const fireHeld = async () => { const [[id, h]] = [...held]; held.delete(id); T += h.ms; h.f(); await idle() }
const settle = (n = 30) => new Promise(r => { const go = k => k ? setImmediate(() => go(k - 1)) : r(); go(n) })
// wait for the trainer's network retry to finish (it chains many short timers)
const idle = async () => { await settle(5); for (let i = 0; i < 2000 && Tr.netRetry.busy; i++) await settle(5); await settle(50) }
// fake fetch: a per-test router; every request is logged
let route = () => { throw new TypeError('fetch failed') }, reqs = []
const res = (status, body) => ({ status, json: async () => body })
globalThis.fetch = async (url, init = {}) => { reqs.push({ url: String(url), method: init.method || 'GET' }); return route(String(url), init) }

const S = await import('./store.js'), C = await import('./cf.js'), CL = await import('./claude.js'), Tr = await import('./train.js')
let ok = 0, bad = 0; const check = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n) }
await C.cacheReady

// ── 1. Codeforces call(): transient failures retry with exponential backoff inside the rate gate ──
{
  let n = 0; reqs = []; delays.length = 0
  route = () => ++n === 1 ? res(429, { status: 'FAILED', comment: 'Call limit exceeded' }) : res(200, { status: 'OK', result: [{ handle: 'x' }] })
  const r = await C.call('user.info', { handles: 'x' })
  check('CF: 429 then success → result returned after 1 retry', r[0].handle === 'x' && reqs.length === 2)
  check(`CF: retry waited a backoff (2–3 s), not a busy loop: ${delays.filter(d => d !== 2100)}`, delays.some(d => d >= 2000 && d < 3000))
}
{
  let n = 0; reqs = []; delays.length = 0
  route = () => { if (++n <= 2) throw new TypeError('fetch failed'); return res(200, { status: 'OK', result: 7 }) }
  const r = await C.call('contest.list')
  const bo = delays.filter(d => d !== 2100)
  check('CF: network errors ×2 then success → result after 2 retries', r === 7 && reqs.length === 3)
  check(`CF: backoff grows (${bo.join(', ')})`, bo.length === 2 && bo[0] >= 2000 && bo[0] < 3000 && bo[1] >= 4000 && bo[1] < 5000)
}
{
  reqs = []; route = () => res(503, null)
  let err; try { await C.call('problemset.problems') } catch (e) { err = e }
  check(`CF: persistent 5xx gives up after 3 retries (4 requests: ${reqs.length}) with an error`, err && reqs.length === 4 && /503/.test(err.message))
}
{
  reqs = []; route = () => res(400, { status: 'FAILED', comment: 'handles: User with handle nobody not found' })
  let err; try { await C.call('user.info', { handles: 'nobody' }) } catch (e) { err = e }
  check('CF: a real error (bad handle) is not retried', err && reqs.length === 1 && /not found/.test(err.message))
}
{
  reqs = []; route = () => { throw new TypeError('fetch failed') }
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true })
  let err; try { await C.call('user.info', { handles: 'x' }) } catch (e) { err = e }
  check('CF: offline (navigator.onLine false) fails fast, no retries', err && reqs.length === 1)
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
}
{
  // the rate gate still holds: the call after a retried one waits its 2.1 s
  let n = 0; delays.length = 0
  route = () => ++n === 1 ? res(500, null) : res(200, { status: 'OK', result: n })
  const a = C.call('a'), b = C.call('b'); const [x, y] = await Promise.all([a, b])
  check(`CF: queued calls stay serialised behind a retry (gate waits seen: ${delays.filter(d => d === 2100).length})`, x === 2 && y === 3 && delays.includes(2100))
}

// ── 2. claude.ts: 429 / 5xx retry with backoff before the turn errors; 503 keeps it queued; 4xx errors at once ──
{
  const results = [], errors = []
  CL.onResult('coach', (t, r) => results.push(t.id), t => errors.push(t.id))
  const qOf = id => JSON.parse(mem.get('momentum.claude.q') || '[]').find(t => t.id === id)
  const waitDone = async id => { for (let i = 0; i < 3000 && CL.pending('coach').some(t => t.id === id); i++) await new Promise(r => realST(r, 1)); await settle(5); return qOf(id) }
  const done = { state: 'done', result: { structured: { reply: 'ok' }, gen: 1, at: 1 } }
  let posts = 0, seq = []
  route = (url, init) => { if (init.method !== 'POST') return res(200, { state: 'running' }); posts++; const s = seq.shift() ?? 202; return s === 202 ? res(202, done) : res(s, { error: 'busy ' + s }) }

  posts = 0; seq = [500, 429]; delays.length = 0
  let t = await waitDone(CL.submit('coach', '/api/coach', { m: 1 }, {}, 'turn-a'))
  check(`claude: 500, 429, then 202 → done after 2 backoff retries (posts ${posts}, state ${t?.state})`, t?.state === 'done' && posts === 3 && results.includes('turn-a') && !errors.includes('turn-a'))
  check('claude: retry bookkeeping cleared on success', t && t.tries === undefined && t.retryAt === undefined)

  posts = 0; seq = [502, 502, 502, 502, 502]
  t = await waitDone(CL.submit('coach', '/api/coach', { m: 2 }, {}, 'turn-b'))
  check(`claude: persistent 5xx → error after ${CL.TURN_RETRIES} retries (posts ${posts})`, t?.state === 'error' && posts === CL.TURN_RETRIES + 1 && errors.filter(x => x === 'turn-b').length === 1)

  posts = 0; seq = [503, 503, 202]
  t = await waitDone(CL.submit('coach', '/api/coach', { m: 3 }, {}, 'turn-c'))
  check('claude: 503 (laptop busy) stays queued without using retries, then completes', t?.state === 'done' && posts === 3 && !errors.includes('turn-c'))

  posts = 0; seq = [400]
  t = await waitDone(CL.submit('coach', '/api/coach', { m: 4 }, {}, 'turn-d'))
  check('claude: a 4xx errors immediately (no retry)', t?.state === 'error' && posts === 1)
  const b1 = CL.turnBackoff(1), b3 = CL.turnBackoff(3)
  check(`claude: backoff is exponential with jitter (${b1}, ${b3})`, b1 >= 3000 && b1 < 4000 && b3 >= 12000 && b3 < 13000)
}

// ── 3. initTrainer offline: compacts events + plans from the cached problemset, then retries the network parts ──
{
  S.resetAll(); S.ensureToday()
  const old = T - 90 * 864e5
  S.setCp(c => ({ ...c, handle: 'tester', handleU: 1, events: { ...c.events, 'o:1A:d:1': { id: 'o:1A:d:1', pid: '1A', k: 'open', at: old }, 'a:1A:x': { id: 'a:1A:x', pid: '1A', k: 'ac', at: old + 60000 }, 'o:2A:d:2': { id: 'o:2A:d:2', pid: '2A', k: 'open', at: T - 3600e3 } } }))
  reqs = []; route = () => { throw new TypeError('fetch failed') }
  const k = S.dateKey()
  check('before: no plan today, 3 events', !S.getState().cp.plans[k] && Object.keys(S.getState().cp.events).length === 3)
  await Tr.initTrainer()
  const cp = S.getState().cp
  check('offline start: old events compacted into probStats (recent one kept)', !cp.events['o:1A:d:1'] && cp.events['o:2A:d:2'] && cp.probStats['1A']?.acAt && cp.evCut > 0)
  check('offline start: today\'s plan built from the cached problemset', !!cp.plans[k]?.specs?.length)
  check('offline start: a network retry is armed (online listener + timer)', Tr.netRetry.armed && listeners.online?.size === 1 && held.size === 1)
  check('offline start: Codeforces was attempted (with retries)', reqs.length >= 1 && reqs.every(r => r.url.includes('codeforces.com')))

  // the timer fires while still offline: tries counted, rescheduled
  await fireHeld()
  check(`timer retry while offline: still armed, rescheduled (tries ${Tr.netRetry.tries})`, Tr.netRetry.armed && Tr.netRetry.tries === 1 && held.size === 1)

  // back online: the 'online' event runs the network parts and the schedule stops
  const calls = []
  route = url => {
    const m = url.match(/api\/([\w.]+)/)[1]; calls.push(m)
    if (m === 'problemset.problems') return res(200, fixture)
    if (m === 'user.info') return res(200, { status: 'OK', result: [{ handle: 'tester', rating: 1300, maxRating: 1350, rank: 'pupil' }] })
    if (m === 'user.status') return res(200, { status: 'OK', result: [{ id: 9, creationTimeSeconds: Math.floor(T / 1000) - 60, verdict: 'OK', problem: { contestId: 1, index: 'A' }, contestId: 1 }] })
    if (m === 'user.rating' || m === 'contest.list') return res(200, { status: 'OK', result: [] })
    return res(404, { status: 'FAILED', comment: 'no' })
  }
  for (const f of [...listeners.online]) f()
  await idle()
  check(`online event: problemset + account fetched (${[...new Set(calls)].join(', ')})`, calls.includes('problemset.problems') && calls.includes('user.info') && C.getCfUser()?.handle === 'tester')
  check('online event: retry schedule stopped (no listener, no timer)', !Tr.netRetry.armed && !listeners.online?.size && held.size === 0)
  check('problemset refreshed (fresh timestamp written to localStorage — no IndexedDB in node)', JSON.parse(mem.get('momentum.cf.problems')).at === T || JSON.parse(mem.get('momentum.cf.problems')).at > T - 60000)
  check('user cache (with its submission list) still in localStorage without IndexedDB', JSON.parse(mem.get('momentum.cf.user') || '{}').list?.[0]?.id === 9)

  // a schedule that never succeeds gives up after a handful of tries
  route = () => { throw new TypeError('fetch failed') }
  Tr.netRetry.arm()
  for (let i = 0; i < 10 && held.size; i++) await fireHeld()
  check(`retries give up after ${Tr.netRetry.tries} tries`, !Tr.netRetry.armed && Tr.netRetry.tries === 5 && held.size === 0 && !listeners.online?.size)

  // problems fresh but the account pull fails → still armed for a retry
  route = url => url.includes('problemset') ? res(200, fixture) : (() => { throw new TypeError('fetch failed') })()
  await Tr.initTrainer()
  check('account pull failing (problems fine) also arms the retry', Tr.netRetry.armed)
  Tr.netRetry.stop()
}

// ── 4. IndexedDB mode (child process with a minimal fake IndexedDB): migration out of localStorage, lossless ──
{
  const child = `
const stores = new Map()
const req = (t, f) => { const q = {}; setTimeout(() => { q.result = f(); t.oncomplete?.() }); return q }
globalThis.indexedDB = { open() { const r = {}; setTimeout(() => {
  r.result = { objectStoreNames: { contains: n => stores.has(n) }, createObjectStore: n => stores.set(n, new Map()),
    transaction(n) { const m = stores.get(n), t = {}; t.objectStore = () => ({ get: k => req(t, () => m.get(k)), put: (v, k) => req(t, () => { m.set(k, structuredClone(v)) }), delete: k => req(t, () => m.delete(k)) }); return t } }
  if (!stores.has('kv')) r.onupgradeneeded?.(); r.onsuccess?.() }); return r } }
const T = Date.now(), list = [{ id: '1A', c: 1, i: 'A', n: 'x', r: 800, t: ['math'], s: 1 }, { id: '2B', c: 2, i: 'B', n: 'y', r: 1200, t: ['dp'], s: 1 }]
const subs = [{ id: 5, pid: '1A', at: T, v: 'OK', tn: 1, ms: 1, mem: 1, rel: null, pt: 'PRACTICE', lang: 'C++', cid: 1 }]
const mem = new Map([['momentum.cf.problems', JSON.stringify({ at: T, list })], ['momentum.cf.user', JSON.stringify({ handle: 'Tester', rating: 0, maxRating: 0, rank: '', fetchedAt: T, subs: { '1A': { ok: true, first: T, okAt: T, tries: 1 } }, lastSubId: 5, list: subs })]])
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: () => null, length: 0 }
globalThis.document = { addEventListener() {}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}; globalThis.window = { setTimeout, clearTimeout, open() {} }
const check = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n)
const C = await import('./cf.js'); await C.cacheReady
check('IDB: problemset moved out of localStorage', !mem.has('momentum.cf.problems') && stores.get('kv').get('momentum.cf.problems')?.list.length === 2)
check('IDB: sync API still serves it (getProb / getProbMap / hasProblems)', C.getProb('2B')?.r === 1200 && C.getProbMap().size === 2 && C.hasProblems())
const lsU = JSON.parse(mem.get('momentum.cf.user'))
check('IDB: user record stays in localStorage, submission list moved', !lsU.list && lsU.subs['1A'] && stores.get('kv').get('momentum.cf.userlist')?.list.length === 1)
check('IDB: in-memory user keeps its list', C.getCfUser()?.list?.length === 1)
// next start: nothing big in localStorage any more — everything comes back from IndexedDB
const C2 = await import('./cf.js?restart')
check('IDB restart: memory empty before the cache loads (no localStorage copy)', !C2.hasProblems())
await C2.cacheReady
check('IDB restart: problemset + submission list restored from IndexedDB', C2.getProb('1A')?.n === 'x' && C2.getCfUser()?.list?.[0]?.id === 5 && C2.getCfUser().subs['1A'].ok)
C2.clearUser(); await new Promise(r => setTimeout(r, 20))
check('IDB: unlinking drops the stored submission list too', !stores.get('kv').has('momentum.cf.userlist'))
`
  const r = spawnSync('node', ['--input-type=module', '-e', child], { cwd: process.cwd(), encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  for (const l of out.split('\n')) if (/^(PASS|FAIL) /.test(l)) { l.startsWith('PASS') ? ok++ : bad++; console.log(l) }
  if (r.status) { bad++; console.log('FAIL IDB child process crashed\n' + out.split('\n').slice(0, 8).join('\n')) }
}

// ── 5. an IndexedDB open that never answers (WebKit first-load hang): the caches fall back after the timeout, nothing waits forever ──
{
  const child = `
globalThis.indexedDB = { open() { return {} } } // no onsuccess / onerror / onblocked, ever
const T = Date.now(), list = [{ id: '1A', c: 1, i: 'A', n: 'x', r: 800, t: ['math'], s: 1 }]
const mem = new Map([['momentum.cf.problems', JSON.stringify({ at: T, list })]])
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: () => null, length: 0 }
globalThis.document = { addEventListener() {}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}; globalThis.window = { setTimeout, clearTimeout, open() {} }
const check = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n)
const I = await import('./idb.js'), C = await import('./cf.js'), t0 = Date.now()
const r = await Promise.race([C.cacheReady.then(() => 'ready'), new Promise(r => setTimeout(() => r('hung'), I.OPEN_TIMEOUT + 2000))])
check('IDB hang: cacheReady resolves after the open timeout (' + (Date.now() - t0) + ' ms)', r === 'ready')
check('IDB hang: idbOk() is false and the localStorage problemset stays and is served', !(await I.idbOk()) && mem.has('momentum.cf.problems') && C.getProb('1A')?.n === 'x')
check('IDB hang: get/set fall back to memory', (await I.idbSet('k', 1)) === false && (await I.idbGet('k')) === 1)
`
  const r = spawnSync('node', ['--input-type=module', '-e', child], { cwd: process.cwd(), encoding: 'utf8', timeout: 20000 })
  const out = (r.stdout || '') + (r.stderr || '')
  for (const l of out.split('\n')) if (/^(PASS|FAIL) /.test(l)) { l.startsWith('PASS') ? ok++ : bad++; console.log(l) }
  if (r.status) { bad++; console.log('FAIL IDB-hang child process crashed\n' + out.split('\n').slice(0, 8).join('\n')) }
}

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
