import fs from 'fs'
// training: rated rounds → contest records, mock void rules (+ the phantom-mock migration), mock time → the right block,
// season targets, the coach's speed directive, light days. Fake clock; Codeforces is offline (navigator.onLine = false).
const R = Date, base = new R(); base.setHours(7, 30, 0, 0); let T = base.getTime()
globalThis.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(T) } static now() { return T } }
const min = m => { T += m * 60000 }
const at = (h, m = 0, dd = 0) => { const d = new R(base); d.setHours(h, m, 0, 0); return d.getTime() + dd * 864e5 }
const raw = JSON.parse(fs.readFileSync('./fixtures/problems.json')).result
const list = raw.problems.filter(p => p.rating && p.contestId).map(p => ({ id: p.contestId + p.index, c: p.contestId, i: p.index, n: p.name, r: p.rating, t: p.tags, s: 1000 }))
const CID = 1950, ROUND = 'Codeforces Round 999 (Div. 2)', START = at(7, 0)
const user = { handle: 'tester', rating: 0, maxRating: 0, rank: 'unrated', fetchedAt: T, subs: {}, lastSubId: 0, contests: 0, contestsAt: T, rated: [], list: [] }
const mem = new Map([['momentum.cf.problems', JSON.stringify({ at: T, list })], ['momentum.cf.user', JSON.stringify(user)],
  // an upcoming rated round later today (a schedule block on it must never take a mock's time)
  ['momentum.cf.contests', JSON.stringify({ at: T, list: [{ id: 2999, name: 'Codeforces Round 1000 (Div. 2)', start: at(11, 5), dur: 7200, type: 'CF' }] })]])
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: () => null, length: 0 }
globalThis.document = { addEventListener() {}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}
globalThis.window = { setTimeout: () => 0, clearTimeout() {}, open() {} }
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true })
const S = await import('./store.js'), Tr = await import('./train.js'), Cf = await import('./cf.js'), Se = await import('./season.js'), D = await import('./discipline.js')
let ok = 0, bad = 0; const check = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n) }
const k = () => S.dateKey(), day = () => S.getState().days[k()], cp = () => S.getState().cp
const total = specs => specs.reduce((a, s) => a + s.minutes, 0)
const fresh = () => { S.resetAll(); S.ensureToday(); S.setCp(c => ({ ...c, calib: 1200, calibU: 1, handle: 'tester', handleU: 1 })); Cf.getCfUser().list = [] }
const sub = (pid, rel, v, id) => ({ id, pid: CID + pid, at: START + rel * 1000, v, tn: v === 'OK' ? 20 : 3, ms: 15, mem: 1, rel, pt: 'CONTESTANT', lang: 'C++', cid: CID, vs: START })

/* ── 1. a rated round you took → one contest record ── */
fresh()
Cf.setPastContests([{ id: CID, name: ROUND, type: 'CF', phase: 'FINISHED', durationSeconds: 7200, startTimeSeconds: START / 1000 }])
S.addTaskToday({ id: 'cf1', title: 'CF: ' + ROUND, start: '07:00', dur: 120, cat: 'deep', k: 'cp_mock', u: 1, done: false })
Tr.startFree(150) // a free-solve timer left running through the round must not swallow its accepts
Cf.getCfUser().list.push(sub('A', 600, 'OK', 1), sub('B', 1200, 'WRONG_ANSWER', 2), sub('B', 1800, 'OK', 3), sub('C', 2400, 'WRONG_ANSWER', 4), sub('D', 3600, 'OK', 5))
min(40); await Tr.detect() // 08:10, round still live
check('no record while the round is still running', !cp().tests['contest:' + CID])
check('free solve does not take the CONTESTANT accepts', cp().active && cp().active.pids.length === 0)
min(60); await Tr.detect() // 09:10, over
const rec = cp().tests['contest:' + CID]
check('contest record created once the round is over', !!rec && rec.real?.live === true && rec.real.contestId === CID && rec.real.name === ROUND)
check('per-problem solve times from relativeTimeSeconds', rec && rec.solved[CID + 'A'] === 600 && rec.solved[CID + 'B'] === 1800 && rec.solved[CID + 'D'] === 3600 && rec.solved[CID + 'C'] === undefined)
check('rejections counted (B 1 WA, C 1 WA)', rec && rec.real.probs.B.wa === 1 && rec.real.probs.C.wa === 1)
check('window = the round (start, 120 min, finished at its end)', rec && rec.startedAt === START && rec.dur === 120 && rec.finishedAt === START + 120 * 60000 && rec.date === k())
check('perf left undefined without standings (never guessed)', rec && rec.perf === undefined)
const blk = day().tasks.find(t => t.id === 'cf1')
check('the round\'s schedule block is ticked with the round\'s real 120 min', blk.done && Math.round(S.taskMinutes(day(), 'cf1')) === 120)
check('solves booked as test attempts, the tried-and-missed C as failed', cp().attempts[CID + 'A']?.src === 'test' && cp().attempts[CID + 'D']?.status === 'solved' && cp().attempts[CID + 'C']?.status === 'failed')
check('untouched problems are not failures', !cp().attempts[CID + 'E'] && !cp().attempts[CID + 'F'])
const nTests = Object.keys(cp().tests).length, att = JSON.stringify(cp().attempts), bonus = JSON.stringify(day().bonus)
min(5); await Tr.detect(); await Tr.detect()
check('idempotent: no second record, attempts and XP unchanged', Object.keys(cp().tests).length === nTests && JSON.stringify(cp().attempts) === att && JSON.stringify(day().bonus) === bonus)
const q = Tr.queues()
check('upsolve queue: tried C and next-position E', q.upsolve.some(x => x.pid === CID + 'C') && q.upsolve.some(x => x.pid === CID + 'E'))
check('upsolve queue: out-of-reach F / G left out', !q.upsolve.some(x => x.pid === CID + 'F' || x.pid === CID + 'G'))
Tr.finishActive('quit')
const fs1 = Object.values(cp().sessions).find(s => s.spec?.mode === 'free')
check('free session booked no contest problem (no double count)', !!fs1 && !fs1.pids.some(p => p.startsWith(String(CID))) && fs1.solved.length === 0)
// (fix2) the free timer ran 07:30–09:15 through the 07:00–09:00 round: the round is the mock, its 90 min are not practice too
{ const sc = D.dayScore(S.getState(), k()), brk = (fs1.brks || []).reduce((t, [a, b]) => t + Math.max(0, Math.min(b, START + 7200e3) - Math.max(a, fs1.startedAt)), 0) / 60000
  check(`free session overlapping the round: practice = ${fs1.mins} − the overlap (${sc.practice} min), the round still the mock`, sc.mock && sc.practice === Math.max(0, fs1.mins - Math.round(90 - brk)) && sc.practice < fs1.mins)
  check('the session record itself keeps its minutes (never drop data)', cp().sessions[fs1.id].mins === fs1.mins) }
// (fix2) a rated round's perf: once its rating change is out it is in the CF rating — never counted again in the level
{ const lv0 = Tr.skillNow().level
  Cf.getCfUser().rated.push({ cid: CID, name: ROUND, rank: 100, old: 0, new: 1000, at: START + 3 * 36e5 }); Cf.getCfUser().contests = 1
  const lvR = Tr.skillNow().level
  S.setCp(c => ({ ...c, tests: { ...c.tests, ['contest:' + CID]: { ...c.tests['contest:' + CID], perf: 2600 } } }))
  check(`rated round perf 2600 with its rating out: level unchanged (${lvR})`, Tr.skillNow().level === lvR && lv0 > 0)
  const two = { r1: { ...cp().tests['contest:' + CID], id: 'r1', perf: 2600 }, r2: { ...cp().tests['contest:' + CID], id: 'r2', startedAt: START - 864e5, perf: 2600 } }
  check('two strong rated rounds never step the syllabus-mock offset', Cf.mockOffsetRule({ ...cp(), tests: two }, 1000) === (cp().offsets?.mock || 0))
  Cf.getCfUser().rated.length = 0; Cf.getCfUser().contests = 0 }
check('a rated round today: no mock offered, "it counts as your mock"', Tr.mockChoice().offer === false && /counts as your mock/.test(Tr.mockChoice().why))
check('startTest refuses: the round was today\'s mock', (Tr.startTest(), !Tr.activeTest()))

/* ── 2. mock guards ── */
fresh(); T = at(10, 0)
S.setCp(c => ({ ...c, plans: {} })); Tr.ensurePlan()
const pids = cp().plans[k()].test
S.addTaskToday({ id: 'm1', title: 'Mock contest', start: '06:00', dur: 120, cat: 'deep', k: 'cp_mock', u: 1, done: false })
S.addTaskToday({ id: 'cfx', title: 'CF: Codeforces Round 1000 (Div. 2)', start: '11:05', dur: 120, cat: 'deep', k: 'cp_mock', u: 1, done: false })
S.addTaskToday({ id: 'm2', title: 'Mock contest', start: '12:00', dur: 120, cat: 'deep', k: 'cp_mock', u: 1, done: false })
// 2a. a false start: 4 minutes, nothing opened
Tr.startTest(); const id1 = Tr.activeTest().id; min(4); Tr.finishTest()
check('under 10 min → voided (no perf, marked void)', Cf.isVoidTest(cp().tests[id1]) && cp().tests[id1].perf === undefined)
check('voided mock: no failures, no upsolve debt', !pids.some(p => cp().attempts[p]) && !Tr.queues().upsolve.length)
// 2b. discard a running mock at any time (a problem was opened, 20 min in)
Tr.startTest(); const id2 = Tr.activeTest()?.id
check('a voided mock never blocks a fresh one today', !!id2 && id2 !== id1)
Tr.openProblem(pids[0]); min(20); Tr.discardMock()
check('discard: finished, void, no perf, no session, no span, no failures', !Tr.activeTest() && Cf.isVoidTest(cp().tests[id2]) && cp().tests[id2].perf === undefined
  && !cp().sessions['mock:' + id2] && !S.spansOf(day()).some(s => s.src === 'mock' && s.start === cp().tests[id2].startedAt) && !cp().attempts[pids[0]])
// 2c. a real mock: 2 problems opened, 1 solved
Tr.startTest(); const id3 = Tr.activeTest().id
check('mock time goes to the nearest mock block by start (12:00), never the rated-round block at 11:05', cp().tests[id3].blockId === 'm2')
Tr.openProblem(pids[0]); Tr.openProblem(pids[1]); min(30); Tr.markTestSolved(pids[0]); min(30); Tr.finishTest()
const t3 = cp().tests[id3]
check('worked mock counts: perf set, not void', t3.perf > 0 && !Cf.isVoidTest(t3))
check('only opened problems fail (B yes, C–F no)', cp().attempts[pids[1]]?.status === 'failed' && pids.slice(2).every(p => !cp().attempts[p]))
check('upsolve queue holds only the opened miss', Tr.queues().upsolve.every(x => x.pid === pids[1]))
const m2 = day().tasks.find(t => t.id === 'm2'), sp3 = S.spansOf(day()).find(s => s.src === 'mock' && s.start === t3.startedAt)
check('the span and the completion land on block m2 (m1 and the round block untouched)', m2.done && sp3?.taskId === 'm2' && !day().tasks.find(t => t.id === 'm1').done && !day().tasks.find(t => t.id === 'cfx').done)
// 2d. a mock spanning midnight books on the day it started
fresh(); T = at(23, 0)
S.setCp(c => ({ ...c, plans: {} })); Tr.ensurePlan(); const d0 = k()
S.addTaskToday({ id: 'late', title: 'Mock contest', start: '23:00', dur: 120, cat: 'deep', k: 'cp_mock', u: 1, done: false })
Tr.startTest(); const id4 = Tr.activeTest().id; Tr.openProblem(cp().plans[d0].test[0]); min(90); Tr.finishTest()
const lateT = S.getState().days[d0].tasks.find(t => t.id === 'late'), sp4 = S.spansOf(S.getState().days[d0]).find(s => s.src === 'mock')
check('midnight: the block of the start day is completed, the span stays on that day', k() !== d0 && lateT.done && sp4?.taskId === 'late' && cp().tests[id4].perf > 0)

/* ── 3. the phantom-mock migration on a synthetic copy ── */
fresh(); T = at(10, 0)
const y = S.addDays(k(), -1), y0 = at(21, 18, -1), six = list.filter(p => p.c === 1850).slice(0, 6).map(p => p.id), six2 = list.filter(p => p.c === 1900).map(p => p.id)
S.setCp(c => ({ ...c, tests: {
  [y]: { id: y, date: y, pids: six, startedAt: y0, dur: 120, finishedAt: at(5, 32), solved: {}, perf: 728, h: 'tester' }, // started right after a round, left to expire
  [k()]: { id: k(), date: k(), pids: six2, startedAt: at(6, 0), dur: 120, finishedAt: at(8, 0), solved: { [six2[0]]: 900 }, perf: 1400, h: 'tester' },
  ['old']: { id: 'old', date: S.addDays(k(), -3), pids: six, startedAt: at(9, 0, -3), dur: 120, finishedAt: at(11, 0, -3), solved: {}, perf: 900, h: 'tester' }, // 0 solved but worked on
  ['virt']: { id: 'virt', date: S.addDays(k(), -2), pids: six2, startedAt: at(9, 0, -2), dur: 120, finishedAt: at(11, 0, -2), solved: {}, h: 'tester', real: { contestId: 1900, name: 'x', rule: 'cf', vStart: at(9, 0, -2), probs: {} } },
}, events: { 'o:old': { id: 'o:old', pid: six[1], k: 'open', at: at(9, 20, -3), sess: 'old' } },
  attempts: Object.fromEntries(six.slice(0, 5).map(p => [p, { pid: p, status: 'failed', src: 'test', at: at(5, 32), u: at(5, 32), h: 'tester' }])) }))
const failedBefore = Tr.skillNow().failed.filter(p => six.includes(p)).length
const voided = Tr.voidPhantomMocks()
check(`migration voids exactly the phantom (${voided.join(',')})`, voided.length === 1 && voided[0] === y)
check('migration is idempotent', Tr.voidPhantomMocks().length === 0 && Cf.isVoidTest(cp().tests[y]))
check('phantom no longer feeds the skill model (its 5 "failures" and perf 728 gone)', failedBefore === 5 && Tr.skillNow().failed.filter(p => six.includes(p)).length === 0)
check('phantom leaves nothing to upsolve', !Tr.queues().upsolve.some(x => x.tid === y))
check('the record itself is kept (never drop data)', cp().tests[y].perf === 728)

/* ── 4. season targets ── */
fresh(); T = at(10, 0)
S.setSeason(Se.makeSeason({ from: S.addDays(k(), -1), until: S.addDays(k(), 5), kind: 'exam' }))
S.setCp(c => ({ ...c, plans: {} })); Tr.ensurePlan()
const ex = cp().plans[k()].specs
check('exam season: no mock offered', Tr.mockChoice().offer === false && /Exam season/.test(Tr.mockChoice().why))
check(`exam season: specs total = cpMin (${total(ex)} = ${Se.targetFor().cpMin}), one short session`, total(ex) === Se.targetFor().cpMin && ex.length === 1 && ex[0].mode === 'speed')
check('Train target follows the season', Tr.practiceTarget().minutes === 45)
// a long coach design is trimmed to the day's budget
S.setCp(c => ({ ...c, plans: {}, designs: { specs: [90, 90, 90].map(m => ({ mode: 'mixed', tags: [], lo: 1100, hi: 1400, minutes: m, timebox: 1, by: 'coach' })), forDate: k(), at: T } }))
Tr.ensurePlan()
check('a 4.5 h coach design is fitted to the exam day', total(cp().plans[k()].specs) === 45)
S.deleteSeason(Object.keys(S.getState().seasons)[0])
check('normal day again: mock offered, 4.5 h', Tr.mockChoice().offer === true && Se.targetFor().cpMin === 270)

/* ── 5. the coach's speed directive ── */
fresh(); T = at(10, 0)
S.setCp(c => ({ ...c, speedPos: { list: ['A', 'B'], u: T },
  tests: { s1: { id: 's1', date: k(), pids: six, startedAt: at(6, 0), dur: 120, finishedAt: at(8, 0), solved: { [six[0]]: 540 }, perf: 1200, h: 'tester' } } }))
check('weakest speed position from measured times (A in 9 min, B unsolved → B)', Cf.weakestSpeedPos(cp(), ['A', 'B']) === 'B')
const ds = Cf.defaultSpecs(Tr.skillNow(), cp(), { resolve: 0, upsolve: 0 }, 270)
check('speed directive → the day opens with a position session at B', ds[0].mode === 'position' && ds[0].pos === 'B' && ds[0].timebox < 1 && total(ds) === 270)
const dsx = Cf.defaultSpecs(Tr.skillNow(), cp(), { resolve: 0, upsolve: 0 }, 45)
check('exam day + directive: the one session is that position session', dsx.length === 1 && dsx[0].mode === 'position' && dsx[0].pos === 'B' && dsx[0].minutes === 45)
S.setCp(c => ({ ...c, speedPos: { list: ['A', 'B'], u: T - 20 * 864e5 } }))
check('a stale directive (> 14 days) is ignored', !Cf.defaultSpecs(Tr.skillNow(), cp(), { resolve: 0, upsolve: 0 }, 270).some(s => s.why?.startsWith('Coach: speed')))

/* ── 6. light day ── */
fresh(); T = at(10, 0)
S.setCp(c => ({ ...c, plans: {}, energy: { [k()]: { sleep: 4, energy: 3, u: T } } })); Tr.ensurePlan()
let pl = cp().plans[k()]
check(`slept 4h → plan ×0.6 with a note (${total(pl.specs)} min)`, pl.light === 'Light day: slept 4h' && total(pl.specs) <= Math.round(270 * 0.6) + 15 && total(pl.specs) >= Math.round(270 * 0.6) - 15)
check('Train target ×0.6 (162 min)', Tr.practiceTarget().minutes === 162 && Tr.practiceTarget().light === 'Light day: slept 4h')
fresh(); T = at(10, 0)
S.setCp(c => ({ ...c, plans: {} })); Tr.ensurePlan()
const full = total(cp().plans[k()].specs), rev0 = cp().plans[k()].rev
S.setCp(c => ({ ...c, energy: { [k()]: { energy: 2, u: T } } })); Tr.lightenPlan()
pl = cp().plans[k()]
check('check-in after the plan was built: lightened once (rev + 1)', pl.light === 'Light day: energy 2/5' && total(pl.specs) < full && pl.rev === rev0 + 1)
Tr.lightenPlan(); Tr.ensurePlan()
check('lightening is idempotent', cp().plans[k()].rev === rev0 + 1 && total(cp().plans[k()].specs) === total(pl.specs))
fresh(); T = at(10, 0)
S.setCp(c => ({ ...c, plans: {} })); Tr.ensurePlan()
const full2 = total(cp().plans[k()].specs)
Tr.startFree(30); min(20); Tr.finishActive('quit')
S.setCp(c => ({ ...c, energy: { [k()]: { sleep: 3, u: T } } })); Tr.lightenPlan()
check('a plan already started is left alone', !cp().plans[k()].light && total(cp().plans[k()].specs) === full2)

/* ── 7. (fix2) voided mocks earn nothing, light days shorten the blocks, a 'none' CP season, the no-mock gate ── */
fresh(); T = at(10, 0)
S.setCp(c => ({ ...c, plans: {} })); Tr.ensurePlan()
S.addTaskToday({ id: 'mk', title: 'Mock contest', start: '10:00', dur: 120, cat: 'deep', k: 'cp_mock', u: 1, done: false })
const sc0 = D.dayScore(S.getState(), k())
Tr.startTest(); min(3); Tr.discardMock()
check('discarded mock: no mock credit in discipline', !sc0.mock && !D.dayScore(S.getState(), k()).mock && D.dayScore(S.getState(), k()).score === sc0.score)
Tr.startTest(); const vid = Tr.activeTest().id; min(130); Tr.finishTest() // left to run out, nothing opened
const vsc = D.dayScore(S.getState(), k()), vsp = S.spansOf(day()).find(s => s.src === 'mock' && s.start === cp().tests[vid].startedAt)
check('expired untouched mock: voided, its block NOT ticked, no mock credit', Cf.isVoidTest(cp().tests[vid]) && !day().tasks.find(t => t.id === 'mk').done && !vsc.mock)
check('…its record, its session and its time in the work log are kept (untied)', !!cp().sessions['mock:' + vid] && !!vsp && !vsp.taskId && Math.round(S.spanMin(vsp)) === 120)
// a block a voided mock ticked before this fix (old data) does not count either
S.patchToday(d => ({ ...d, tasks: d.tasks.map(t => t.id === 'mk' ? { ...t, done: true } : t) }))
S.setCp(c => ({ ...c, tests: { ...c.tests, [vid]: { ...c.tests[vid], blockId: 'mk' } } }))
check('old data: a mock block ticked by a voided mock earns no mock credit', !D.dayScore(S.getState(), k()).mock)
Tr.startTest(); check('a voided mock never blocks a fresh one', !!Tr.activeTest()); Tr.discardMock()
// light day after the plan exists: the blocks shrink with the specs
fresh(); T = at(8, 0)
S.setCp(c => ({ ...c, plans: {} })); Tr.ensurePlan()
const cpb = () => day().tasks.filter(t => t.k === 'cp_practice' && t.id.startsWith('cp:'))
const durs0 = cpb().map(t => t.dur)
S.setCp(c => ({ ...c, energy: { [k()]: { sleep: 5, u: T } } })); Tr.lightenPlan()
const lsp = cp().plans[k()].specs, m7 = Tr.cpMatchToday()
const held = lsp.map((s, i) => day().tasks.find(t => t.id === m7.bySpec[i])?.dur)
check(`light day set after the plan: blocks ${durs0.join('/')} → ${held.join('/')} = the lightened specs`, held.every((d, i) => d === lsp[i].minutes) && total(lsp) < durs0.reduce((a, b) => a + b, 0))
Tr.startBlock(day().tasks.find(t => t.id === m7.bySpec[0]))
check('a session started from a lightened block runs the lightened length', cp().active?.dur === lsp[0].minutes); Tr.finishActive('quit')
check(`discipline measures the light day against the lightened target (${D.dayScore(S.getState(), k()).cpMin} = ${Tr.practiceTarget().minutes})`, D.dayScore(S.getState(), k()).cpMin === Tr.practiceTarget().minutes && Tr.practiceTarget().minutes === 162)
// an exam season with CP 'none'
fresh(); T = at(10, 0)
S.setSeason(Se.makeSeason({ from: k(), until: S.addDays(k(), 3), kind: 'exam', cpMin: 0 }))
S.setCp(c => ({ ...c, plans: {} })); Tr.ensurePlan()
check('CP "none": no practice session, no CP block in Today', cp().plans[k()].specs.length === 0 && !day().tasks.some(t => t.k === 'cp_practice') && Tr.practiceTarget().minutes === 0)
check('fitTo / defaultSpecs with cpMin 0 → nothing', Tr.fitTo([{ mode: 'mixed', tags: [], lo: 1, hi: 2, minutes: 90, timebox: 1, by: 'user' }], 0).length === 0 && Cf.defaultSpecs(Tr.skillNow(), cp(), { resolve: 0, upsolve: 0 }, 0).length === 0)
{ const st = JSON.parse(JSON.stringify(S.getState())); st.days[k()].tasks = []
  check('CP "none" exam day with nothing planned or done scores 0, not a free 1.0', D.dayScore(st, k()).score === 0)
  st.days[k()].tasks = [{ id: 'st', title: 'Study OS', start: null, dur: 120, cat: 'study', done: true, u: 1 }]
  check('…and a done study block scores the full day (the practice share moved to planned work)', Math.abs(D.dayScore(st, k()).score - 1) < 1e-9) }
// the no-mock gate holds on every way in (Today's play button / the coach call startTest / startRealRound directly)
S.addTaskToday({ id: 'mx', title: 'Mock contest', start: '12:00', dur: 120, cat: 'deep', k: 'cp_mock', u: 1, done: false })
Tr.startTest('mx')
const pick = { contestId: 1900, name: 'x', rule: 'cf', pids: ['1900A'], dur: 120, start: 0, div: 'Div. 2', ratings: [800] }
Tr.startRealRound(pick, 'mx')
check('exam season (no mock): startTest and startRealRound both refuse', !Tr.activeTest() && !Object.keys(cp().tests).length)

console.log(ok + ' passed, ' + bad + ' failed')
process.exit(bad ? 1 : 0)
