import fs from 'fs'
// fake clock (09:00 today, never crosses midnight); shims copied from ../worklog/t.mjs
const R = Date, base = new R(); base.setHours(9, 0, 0, 0); let T = base.getTime()
globalThis.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(T) } static now() { return T } }
const raw = JSON.parse(fs.readFileSync('./fixtures/problems.json')).result
const list = raw.problems.filter(p => p.rating && p.contestId).map(p => ({ id: p.contestId + p.index, c: p.contestId, i: p.index, n: p.name, r: p.rating, t: p.tags, s: 1000 }))
const mem = new Map([['momentum.cf.problems', JSON.stringify({ at: T, list })]])
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: () => null, length: 0 }
globalThis.document = { addEventListener() {}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}
globalThis.window = { setTimeout: () => 0, clearTimeout() {}, open() {} }
const S = await import('./store.js'), Tr = await import('./train.js')
let ok = 0, bad = 0; const check = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n) }
const day = () => S.getState().days[S.dateKey()], spans = () => S.spansOf(day())
const M = m => Math.round(m)
/** the session screen / background loop: tick every minute for m minutes */
const run = m => { for (let i = 0; i < m; i++) { T += 60000; Tr.checkExpiry() } }
const show = ss => ss.map(s => `${s.cat}${s.taskId ? '@' + s.taskId : ''}:${M(S.spanMin(s))}${s.end === null ? '(open)' : ''}`).join(' ')
S.resetAll(); S.ensureToday()
S.setCp(c => ({ ...c, calib: 1200, calibU: 1 }))
check('defaults: auto breaks on, 55 / 5', S.getState().settings.autoBreak === true && S.getState().settings.breakEvery === 55 && S.getState().settings.breakLen === 5)

// 1. planned 90-min CP block, free solve with the app ticking every minute
S.addTaskToday({ id: 'p1', title: 'CF practice', start: null, dur: 90, cat: 'deep', k: 'cp_practice', u: 1, done: false })
const w0 = S.workMin(day()), t0 = T
Tr.startFree(90)
run(54)
check('no break before 55 min', !S.openBreak(S.getState().cp.active) && spans().length === 1)
run(1)
let a = S.getState().cp.active
check('at 55 min work: a break starts', !!S.openBreak(a) && a.breaks.length === 1 && a.breaks[0].start === t0 + 55 * 60000)
let ss = spans(); console.log('    @55', show(ss))
check('work span closed at 55, break span open (cat break, src cp, no task)', ss.length === 2 && ss[0].end === t0 + 55 * 60000 && ss[0].taskId === 'p1' && ss[1].cat === 'break' && ss[1].src === 'cp' && !ss[1].taskId && ss[1].end === null && ss[1].title === 'Break')
run(3)
check('during the break the session clock is stopped (55 min worked at 58 wall)', M(S.activeMin(S.getState().cp.active)) === 55)
check('during the break workMin stays at 55', S.workMin(day()) - w0 === 55)
run(2)
a = S.getState().cp.active; ss = spans(); console.log('    @60', show(ss))
check('break ends at 60 by itself; a new work span runs (same task)', !S.openBreak(a) && a.breaks[0].end === t0 + 60 * 60000 && ss.length === 3 && ss[1].end === t0 + 60 * 60000 && ss[2].end === null && ss[2].taskId === 'p1' && ss[2].start === t0 + 60 * 60000)
run(30)
check('at 90 wall min the session is still running (end moved to 95)', !!S.getState().cp.active && S.activeEnd(S.getState().cp.active) === t0 + 95 * 60000)
run(5)
const sess = Object.values(S.getState().cp.sessions).find(x => x.startedAt === t0)
ss = spans(); console.log('    end', show(ss), JSON.stringify({ mins: sess?.mins, brk: sess?.brk, wall: sess && (sess.endedAt - sess.startedAt) / 60000 }))
check('session ends at 95 min wall time', !S.getState().cp.active && sess && sess.endedAt - t0 === 95 * 60000)
check('session record: 90 practice minutes, 5 break', sess.mins === 90 && sess.brk === 5)
check('log: work 55 + break 5 + work 35', ss.length === 3 && M(S.spanMin(ss[0])) === 55 && ss[1].cat === 'break' && M(S.spanMin(ss[1])) === 5 && M(S.spanMin(ss[2])) === 35 && ss.every(s => s.end !== null))
const p1 = day().tasks.find(x => x.id === 'p1')
check('workMin counts 90, not 95', S.workMin(day()) - w0 === 90)
check('planned block done; tracked minutes (XP basis) 90', p1.done && M(S.taskMinutes(day(), 'p1')) === 90)
const mult = S.streakMult(S.streakOf ? S.streakOf(S.getState()) : 0)
console.log('    xp', p1.xp, 'xpm', p1.xpm)
check(`block XP is priced on 90 min (xp ${p1.xp})`, p1.xpm !== undefined ? p1.xp === Math.round(Math.min(90, p1.dur * 2) * p1.xpm) : p1.xp <= Math.round(95 * 0.6 * mult))
check('break span is never tied to a task', !ss[1].taskId)

// 2. skipped break: no break span, the clock never stopped (ends at 90)
const w1 = S.workMin(day()), t1 = T, n1 = spans().length
Tr.startFree(90); run(55)
check('skip test: break started at 55', !!S.openBreak(S.getState().cp.active))
T += 20000; Tr.skipBreak()
a = S.getState().cp.active
check('skipped break: recorded zero-length, clock not moved', !S.openBreak(a) && a.breaks[0].end === a.breaks[0].start && S.activeEnd(a) === t1 + 90 * 60000)
run(35)
const ss2 = spans().slice(n1), sess2 = Object.values(S.getState().cp.sessions).find(x => x.startedAt === t1)
console.log('    skip', show(ss2))
check('skipped break leaves no break span', ss2.every(s => s.cat !== 'break') && !S.spansOf(day()).some(s => s.cat === 'break' && s.start > t1))
check('skipped: session 90 min, workMin +90', sess2 && sess2.mins === 90 && !sess2.brk && S.workMin(day()) - w1 === 90)

// 3. a 40-min session never breaks
const t2 = T, n2 = spans().length
Tr.startFree(40); run(40)
const ss3 = spans().slice(n2), sess3 = Object.values(S.getState().cp.sessions).find(x => x.startedAt === t2)
check('40-min session: no break, one 40-min span, ends at 40', !S.getState().cp.active && ss3.length === 1 && M(S.spanMin(ss3[0])) === 40 && sess3.mins === 40 && !(sess3.brk) && sess3.endedAt - t2 === 40 * 60000)

// 4. a 60-min session doesn't break for its last 5 minutes
const t4 = T, n4 = spans().length
Tr.startFree(60); run(60)
check('60-min session: no break at 55 with only 5 left', spans().slice(n4).length === 1 && Object.values(S.getState().cp.sessions).find(x => x.startedAt === t4).endedAt - t4 === 60 * 60000)

// 5. app asleep through the break and the end: wall-clock catch-up logs exactly 55 + 5 + 35
const t5 = T, n5 = spans().length, w5 = S.workMin(day())
Tr.startFree(90); T += 120 * 60000; Tr.checkExpiry()
const ss5 = spans().slice(n5), sess5 = Object.values(S.getState().cp.sessions).find(x => x.startedAt === t5)
console.log('    asleep', show(ss5))
check('asleep: 55 work + 5 break + 35 work, session 90 min', ss5.length === 3 && M(S.spanMin(ss5[0])) === 55 && ss5[1].cat === 'break' && M(S.spanMin(ss5[1])) === 5 && M(S.spanMin(ss5[2])) === 35 && sess5.mins === 90)
check('asleep: workMin +90', S.workMin(day()) - w5 === 90)

// 6. quitting during a break closes the break there; it doesn't count as work
const t6 = T, n6 = spans().length, w6 = S.workMin(day())
Tr.startFree(90); run(57); Tr.finishActive('quit')
const ss6 = spans().slice(n6), sess6 = Object.values(S.getState().cp.sessions).find(x => x.startedAt === t6)
console.log('    quit', show(ss6))
check('quit in a break: work 55 + break 2, no work span after', ss6.length === 2 && M(S.spanMin(ss6[0])) === 55 && ss6[1].cat === 'break' && M(S.spanMin(ss6[1])) === 2 && ss6.every(s => s.end !== null))
check('quit in a break: 55 practice minutes, workMin +55', sess6.mins === 55 && S.workMin(day()) - w6 === 55)

// 7. end the break early: break 2 min, end moves by 2
const t7 = T, n7 = spans().length
Tr.startFree(90); run(57); Tr.endBreakEarly()
check('ended early: end moves by 2 min', S.activeEnd(S.getState().cp.active) === t7 + 92 * 60000)
run(35)
const ss7 = spans().slice(n7)
check('ended early: work 55 + break 2 + work 35, ends at 92', ss7.length === 3 && M(S.spanMin(ss7[1])) === 2 && M(S.spanMin(ss7[2])) === 35 && Object.values(S.getState().cp.sessions).find(x => x.startedAt === t7).endedAt - t7 === 92 * 60000)

// 8. auto breaks off: no breaks
S.setSettings({ autoBreak: false })
const t8 = T, n8 = spans().length
Tr.startFree(90); run(90)
check('auto breaks off: one 90-min span', spans().slice(n8).length === 1 && Object.values(S.getState().cp.sessions).find(x => x.startedAt === t8).endedAt - t8 === 90 * 60000)
S.setSettings({ autoBreak: true })

// 9. mock rounds never break
const pids = list.filter(p => p.r >= 800 && p.r <= 1600).slice(0, 5).map(p => p.id)
S.setCp(c => ({ ...c, plans: { ...c.plans, [S.dateKey()]: { ...(c.plans[S.dateKey()] || { specs: [] }), test: pids } } }))
const n9 = spans().length
Tr.startTest(); run(120)
const ss9 = spans().slice(n9)
check('mock round: no break, one 120-min span', ss9.length === 1 && ss9[0].src === 'mock' && M(S.spanMin(ss9[0])) === 120)
console.log(ok + ' passed, ' + bad + ' failed')
