// sync engine: cheap revision polls (304), uploads only on real change, conflict retry, backoff with jitter (fake fetch + fake clock)
const R = Date, b0 = new R(); b0.setHours(10, 0, 0, 0); let T = b0.getTime()
globalThis.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(T) } static now() { return T } }
const mem = new Map([['momentum.sync', JSON.stringify({ url: 'http://srv', token: 'k' })]])
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: () => null, length: 0 }
globalThis.document = { addEventListener() {}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}
globalThis.window = { setTimeout: () => 0, clearTimeout() {}, open() {} }
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })

// fake server: same contract as server.py (rev check on PUT, ?since -> 304)
const srv = { rev: 0, doc: null, log: [], fail: null, beforePut: null, reorder: false }
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
globalThis.fetch = async (url, o = {}) => {
  const since = new URL(url).searchParams.get('since'), m = o.method || 'GET'
  srv.log.push({ m, since, bytes: o.body ? o.body.length : 0 })
  if (srv.fail) { const f = srv.fail; if (f === 'net') throw new TypeError('Failed to fetch'); return res(f.status, f.body) }
  if (m === 'GET') {
    if (since != null && +since === srv.rev) return res(304, null)
    let doc = srv.doc && JSON.parse(srv.doc)
    if (doc && srv.reorder) doc = Object.fromEntries(Object.entries(doc).reverse()) // same content, other key order
    return res(200, { rev: srv.rev, doc })
  }
  srv.beforePut?.(); srv.beforePut = null
  const b = JSON.parse(o.body)
  if (b.rev !== srv.rev) return res(409, { rev: srv.rev })
  srv.rev++; srv.doc = JSON.stringify(b.doc)
  return res(200, { rev: srv.rev })
}

const S = await import('./store.js'), Y = await import('./sync.js')
Y._syncTest.setSleep(async () => {})
let ok = 0, bad = 0; const check = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n) }
const puts = () => srv.log.filter(x => x.m === 'PUT').length
const today = () => S.getState().days[S.dateKey()]
S.resetAll(); S.ensureToday()

// 1. empty server: full GET, then the device's doc is uploaded once
await Y.syncNow()
check('first sync: full GET without since, then one PUT', srv.log[0].m === 'GET' && srv.log[0].since === null && puts() === 1 && srv.rev === 1)
check('status ok', Y.syncStatusRef().state === 'ok')

// 2. nothing changed anywhere: a 304 poll and no upload
srv.log = []
await Y.syncNow(); await Y.syncNow(); await Y.syncNow()
check('idle polls send ?since=rev and get 304', srv.log.length === 3 && srv.log.every(x => x.m === 'GET' && x.since === '1'))
check('idle polls upload nothing (rev stays 1)', puts() === 0 && srv.rev === 1)

// 3. local edit: 304 poll, then exactly one PUT carrying the edit
srv.log = []; T += 60000
S.addTaskToday({ id: 'loc1', title: 'local edit', start: null, dur: 30, cat: 'study', u: T, done: false })
await Y.syncNow()
check('after a local edit: one PUT', puts() === 1 && srv.rev === 2)
check('the uploaded doc carries the edit', JSON.parse(srv.doc).days[S.dateKey()].tasks.some(t => t.id === 'loc1'))
srv.log = []; await Y.syncNow()
check('next poll after the upload: 304, no PUT (no echo upload)', srv.log.length === 1 && srv.log[0].since === '2' && puts() === 0)

// 4. another device pushed: full doc pulled and merged; nothing new to send back
const snap = S.getState(); T += 60000
S.addTaskToday({ id: 'rem1', title: 'remote edit', start: null, dur: 20, cat: 'study', u: T, done: false })
srv.doc = JSON.stringify(S.getState()); srv.rev = 3
S.replaceFromSync(snap) // this device never saw rem1
srv.log = []; await Y.syncNow()
check('remote change: GET returns 200 and the merge brings it in', srv.log[0].since === '2' && today().tasks.some(t => t.id === 'rem1') && today().tasks.some(t => t.id === 'loc1'))
check('merged doc equals the server doc: no PUT', puts() === 0 && srv.rev === 3)
srv.log = []; await Y.syncNow()
check('then back to 304 polls', srv.log.length === 1 && srv.log[0].since === '3' && puts() === 0)

// 5. same content, different key order (a fresh full GET): the canonical hash sees no change
Y._syncTest.reset(); srv.reorder = true; srv.log = []
await Y.syncNow()
check('full GET with reordered keys: no PUT', srv.log.length === 1 && srv.log[0].since === null && puts() === 0)
srv.reorder = false
check('docHash ignores key order but not values', Y.docHash({ a: 1, b: [1, { c: 2, d: 3 }] }) === Y.docHash({ b: [1, { d: 3, c: 2 }], a: 1 }) && Y.docHash({ a: 1 }) !== Y.docHash({ a: 2 }))

// 6. 409: someone pushes between our poll and our PUT -> re-pull, re-merge, PUT again
T += 60000; S.addTaskToday({ id: 'loc2', title: 'edit 2', start: null, dur: 15, cat: 'study', u: T, done: false })
srv.log = []
srv.beforePut = () => { const d = JSON.parse(srv.doc); d.days[S.dateKey()].tasks.push({ id: 'rem2', title: 'raced', start: null, dur: 10, cat: 'study', u: T, done: false }); srv.doc = JSON.stringify(d); srv.rev++ }
await Y.syncNow()
const ms = srv.log.map(x => x.m + (x.since === null ? '' : '?' + x.since)).join(' ')
check(`conflict: GET(304) PUT(409) GET(full) PUT(ok)  [${ms}]`, ms === 'GET?3 PUT GET PUT' && Y.syncStatusRef().state === 'ok')
const sd = JSON.parse(srv.doc).days[S.dateKey()].tasks
check('both the raced remote task and the local edit survive', sd.some(t => t.id === 'rem2') && sd.some(t => t.id === 'loc2') && today().tasks.some(t => t.id === 'rem2'))

// 6b. an edit lands while the PUT is in flight (a tap, a running timer's beat): the upload still counts, the edit follows
T += 60000; S.addTaskToday({ id: 'loc5', title: 'edit 5', start: null, dur: 15, cat: 'study', u: T, done: false })
srv.log = []; let toasts = 0; const offT = S.onFx?.(f => { if (f.type === 'toast' && /failed/i.test(f.text)) toasts++ })
srv.beforePut = () => { T += 1000; S.addTaskToday({ id: 'loc6', title: 'mid-PUT edit', start: null, dur: 5, cat: 'study', u: T, done: false }) }
await Y.syncNow(true)
check('edit during the PUT: no error, no backoff, no failure toast (the follow-up cycle is already running)', Y.syncStatusRef().state !== 'error' && Y.syncBackoff().fails === 0 && Y.syncBackoff().retryAt === 0 && toasts === 0)
for (let i = 0; i < 20 && !JSON.parse(srv.doc).days[S.dateKey()].tasks.some(t => t.id === 'loc6'); i++) await new Promise(r => setTimeout(r, 0))
const sd6 = JSON.parse(srv.doc).days[S.dateKey()].tasks
check(`edit during the PUT: a follow-up cycle uploads it right away (${srv.log.map(x => x.m).join(' ')})`, sd6.some(t => t.id === 'loc5') && sd6.some(t => t.id === 'loc6') && puts() === 2)
await Y.syncNow()
check('edit during the PUT: then status ok and in sync', Y.syncStatusRef().state === 'ok' && Y.syncBackoff().fails === 0 && puts() === 2)
offT?.()

// 7. 5xx: backoff starts, non-manual syncs wait it out, the delay grows, success resets it
srv.fail = { status: 503, body: { error: 'unavailable' } }; srv.log = []
await Y.syncNow()
let bo = Y.syncBackoff()
check(`503 -> error status, fails=1, retry in 2.5–5 s (${bo.retryAt - T} ms)`, Y.syncStatusRef().state === 'error' && bo.fails === 1 && bo.retryAt - T >= 2500 && bo.retryAt - T <= 5000)
srv.log = []; await Y.syncNow()
check('an automatic sync during the backoff does not hit the server', srv.log.length === 0)
const steps = []
for (let i = 0; i < 9; i++) { T = Y.syncBackoff().retryAt + 1; await Y.syncNow(); steps.push(Y.syncBackoff().retryAt - T) }
console.log('    backoff delays (ms):', steps.join(' '))
check('fails keep counting', Y.syncBackoff().fails === 10)
check('delay window doubles: 3rd failure within 10–20 s', steps[1] >= 10000 && steps[1] <= 20000)
check('delay is capped at 5 min and never below half the cap once capped', steps.slice(6).every(d => d <= 300000 && d >= 150000))
srv.log = []; await Y.syncNow(true)
check('a manual sync ignores the backoff', srv.log.length === 1)
srv.fail = null; T = Y.syncBackoff().retryAt + 1
await Y.syncNow()
check('success resets the backoff', Y.syncBackoff().fails === 0 && Y.syncBackoff().retryAt === 0 && Y.syncStatusRef().state === 'ok')

// 8. network error and too-many-conflicts also back off
srv.fail = 'net'; await Y.syncNow()
check('network error -> backoff', Y.syncBackoff().fails === 1 && Y.syncStatusRef().state === 'error')
srv.fail = null; T = Y.syncBackoff().retryAt + 1
T += 60000; S.addTaskToday({ id: 'loc3', title: 'edit 3', start: null, dur: 15, cat: 'study', u: T, done: false })
const realFetch = globalThis.fetch; let putN = 0
globalThis.fetch = async (u, o = {}) => (o.method === 'PUT' ? (putN++, srv.rev++, realFetch(u, { ...o, body: JSON.stringify({ ...JSON.parse(o.body), rev: -1 }) })) : realFetch(u, o))
await Y.syncNow()
check(`4 conflicts in a row -> error + backoff (${putN} PUTs)`, putN === 4 && Y.syncStatusRef().state === 'error' && /conflicts/.test(Y.syncStatusRef().msg) && Y.syncBackoff().fails === 2)
globalThis.fetch = realFetch; T = Y.syncBackoff().retryAt + 1
await Y.syncNow()
check('recovers on the next cycle', Y.syncStatusRef().state === 'ok' && JSON.parse(srv.doc).days[S.dateKey()].tasks.some(t => t.id === 'loc3'))

// 9. 413: the server's message reaches the status line
T += 60000; S.addTaskToday({ id: 'loc4', title: 'edit 4', start: null, dur: 15, cat: 'study', u: T, done: false })
const f2 = globalThis.fetch
globalThis.fetch = async (u, o = {}) => o.method === 'PUT' ? res(413, { error: 'Sync data is too large (9.0 MB, the server accepts up to 8 MB)' }) : f2(u, o)
await Y.syncNow()
check(`413 message shown: "${Y.syncStatusRef().msg}"`, /too large/.test(Y.syncStatusRef().msg || ''))
globalThis.fetch = f2

// 10. the delay formula itself
check('backoffDelay: n=1 is 2.5–5 s, jitter bounds, cap', Y.backoffDelay(1, 0) === 2500 && Y.backoffDelay(1, 1) === 5000 && Y.backoffDelay(3, 1) === 20000 && Y.backoffDelay(30, 1) === 300000 && Y.backoffDelay(30, 0) === 150000)

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
