import fs from 'fs'
// fake clock: Date.now() and new Date() follow T (noon today, so a scenario never crosses midnight)
const R = Date, base = new R(); base.setHours(9, 0, 0, 0); let T = base.getTime()
globalThis.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(T) } static now() { return T } }
const min = m => { T += m * 60000 }
const raw = JSON.parse(fs.readFileSync('./fixtures/problems.json')).result
const list = raw.problems.filter(p => p.rating && p.contestId).map(p => ({ id: p.contestId + p.index, c: p.contestId, i: p.index, n: p.name, r: p.rating, t: p.tags, s: 1000 }))
const mem = new Map([['momentum.cf.problems', JSON.stringify({ at: T, list })]])
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: () => null, length: 0 }
globalThis.document = { addEventListener() {}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}
globalThis.window = { setTimeout: () => 0, clearTimeout() {}, open() {} }
const S = await import('./store.js'), Tr = await import('./train.js')
let ok = 0, bad = 0; const check = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n) }
const day = () => S.getState().days[S.dateKey()], spans = () => S.spansOf(day())
S.resetAll(); S.ensureToday()
S.setCp(c => ({ ...c, calib: 1200, calibU: 1 }))
const w0 = S.workMin(day())

// 1. planned 90-min practice block; the session really runs 47 min (app in the background, no heartbeat for most of it)
S.addTaskToday({ id: 'p1', title: 'CF practice', start: null, dur: 90, cat: 'deep', k: 'cp_practice', u: 1, done: false })
Tr.startFree(90)
check('session start opens one running cp span tied to the planned block', spans().length === 1 && spans()[0].end === null && spans()[0].src === 'cp' && spans()[0].taskId === 'p1')
min(47); Tr.finishActive('cleared')
let sp = spans()[0], t = day().tasks.find(x => x.id === 'p1')
console.log('   ', JSON.stringify({ span_min: S.spanMin(sp), task_min: S.taskMinutes(day(), 'p1'), xp: t.xp, work: S.workMin(day()) }))
check('one closed span of 47 min (session clock, not the stale heartbeat)', spans().length === 1 && sp.end !== null && Math.round(S.spanMin(sp)) === 47)
check('planned block done, its tracked minutes are the real 47', t.done && Math.round(S.taskMinutes(day(), 'p1')) === 47)
const mult = S.streakMult(S.streakOf ? S.streakOf(S.getState()) : 0)
check(`block XP is based on 47 min, not 90 (xp ${t.xp})`, t.xp === Math.round(47 * 0.6 * mult) || (t.xp < Math.round(90 * 0.6) && t.xp >= Math.round(47 * 0.6)))
check('workMin counts the session once (47)', S.workMin(day()) - w0 === 47)

// 2. no planned block: 30-min session → logWork task carries the span; still counted once
const w1 = S.workMin(day())
Tr.startFree(60); min(30); Tr.finishActive('quit')
const sp2 = spans().find(s => s.id !== sp.id), lw = day().tasks.find(x => x.id.startsWith('w:'))
const tied2 = sp2 && day().tasks.find(x => x.id === sp2.taskId)
// it lands on today's leftover practice block when there is one (partial completion), else on a logged w: task
check('unplanned session: span tied to a finished task (leftover block or logged task)', !!tied2 && tied2.done && Math.round(S.spanMin(sp2)) === 30)
check('workMin +30, not +60', S.workMin(day()) - w1 === 30)

// 3. quit after 2 min: not booked as a block, but the span stays in the log
const n3 = day().tasks.length, w2 = S.workMin(day())
Tr.startFree(60); min(2); Tr.finishActive('quit')
check('quit session still logs its span (2 min), no task booked', spans().length === 3 && Math.round(S.spanMin(spans()[2])) === 2 && day().tasks.length === n3)
check('the 2 quit minutes count as work', S.workMin(day()) - w2 === 2)

// 4. quit within seconds: dropped as noise
Tr.startFree(60); T += 20000; Tr.finishActive('quit')
check('a 20-second session leaves no span', spans().length === 3)

// 5. another timer takes over mid-session: the session span keeps its early end, no overlap
S.addTaskToday({ id: 'p2', title: 'CF practice 2', start: null, dur: 60, cat: 'deep', k: 'cp_practice', u: 1, done: false })
Tr.startFree(60); min(10); S.heartbeat() // the app beats every minute; a span taken over ends at its last beat
S.addTaskToday({ id: 'r1', title: 'Read', start: null, dur: 30, cat: 'study', u: 1, done: false })
S.startSpan({ taskId: 'r1', title: 'Read', cat: 'study', src: 'focus' }); min(15); S.stopSpan()
min(5); Tr.finishActive('time')
const sp5 = spans().filter(x => x.src === 'cp').sort((a, b) => b.start - a.start)[0]
check('session span ended when the other timer started (10 min) and its block is done', !!sp5 && Math.round(S.spanMin(sp5)) === 10 && !!day().tasks.find(x => x.id === sp5.taskId)?.done)

// 6. mock round: 120 planned, finished after 75 → planned mock block gets 75
S.addTaskToday({ id: 'm1', title: 'Mock', start: null, dur: 120, cat: 'deep', k: 'cp_mock', u: 1, done: false })
const pids = list.filter(p => p.r >= 800 && p.r <= 1600).slice(0, 5).map(p => p.id)
S.setCp(c => ({ ...c, plans: { ...c.plans, [S.dateKey()]: { ...(c.plans[S.dateKey()] || { specs: [] }), test: pids } } }))
const wm = S.workMin(day())
Tr.startTest(); min(5); Tr.openProblem(pids[0]); min(70); Tr.finishTest() // a problem opened: a real (not voided) mock
const m = day().tasks.find(x => x.id === 'm1'), msp = spans().filter(s => s.src === 'mock')
check('mock round: one mock span of 75 min tied to the planned mock', msp.length === 1 && Math.round(S.spanMin(msp[0])) === 75 && msp[0].taskId === 'm1' && m.done && Math.round(S.taskMinutes(day(), 'm1')) === 75)
check('workMin +75', S.workMin(day()) - wm === 75)
console.log(ok + ' passed, ' + bad + ' failed')
