// data-store: pruning that sticks across devices, storage failures, field-level merges, midnight split
// two devices = two instances of store.js (separate module URLs), each with its own localStorage stub and device id
globalThis.document = { addEventListener() {}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}
globalThis.window = { setTimeout: () => 0, clearTimeout() {}, open() {} }
const R = Date, t0 = new R(); t0.setHours(9, 0, 0, 0); let T = t0.getTime()
globalThis.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(T) } static now() { return T } }
const min = m => { T += m * 60000 }
const mkLs = (dev, extra = []) => { const mem = new Map([['momentum.device', dev], ...extra]); const ls = { mem, getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size } }; return ls }
const lsA = mkLs('devA', [['momentum.cf.problems', '{"at":1,"list":[]}']]), lsB = mkLs('devB')
globalThis.localStorage = lsA; const A = await import('./store.js?dev=a')
globalThis.localStorage = lsB; const B = await import('./store.js?dev=b')
const on = (ls, f) => { globalThis.localStorage = ls; return f() }
const clone = x => JSON.parse(JSON.stringify(x)), J = x => JSON.stringify(x)
// key order may differ between merge orders (same content): compare with sorted keys
const JS = x => JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([p], [q]) => p < q ? -1 : 1)) : v)
let ok = 0, bad = 0; const check = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n) }
const S = A, M = (x, y) => clone(S.mergeStates(clone(x), clone(y))), DAY = 864e5
const k = S.dateKey(), ky = S.addDays(k, -1)
// a shared start on both devices
on(lsA, () => { A.resetAll(); A.ensureToday() })
const base = clone(A.getState())
on(lsB, () => B.replaceFromSync(clone(base)))

/* ── 1. pruning: proposals, agenda, tombstones, coachLog ── */
{
  const s = clone(base), now = Date.now()
  const prop = (i, ageDays) => ({ id: 'p' + i, at: now - ageDays * DAY - i, prompt: '', summary: 's' + i, questions: [], range: { from: k, to: k }, days: [], routine: [], status: 'applied', u: now - ageDays * DAY, undo: { agenda: [], added: ['x' + i], blocks: [], addedBlocks: [] } })
  s.planner.proposals = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`p${i}`, prop(i, i < 3 ? 0 : i * 0.5)]))
  const old = S.addDays(k, -20), oldId = `ai:gym:${old}`
  s.agenda = [{ id: oldId, date: old, title: 'Gym', start: '07:00', dur: 30, cat: 'health', kind: 'task', plan: 'p1', u: now - 25 * DAY }, { id: `ai:cp:${k}`, date: k, title: 'CP', start: '10:00', dur: 30, cat: 'deep', kind: 'task', plan: 'p1', u: now }]
  s.del = { ...s.del, [`ai:old:${S.addDays(k, -40)}`]: now - 40 * DAY, 'g-deep': now - 40 * DAY, [`ai:new:${k}`]: now - 40 * DAY }
  s.cp.coachLog = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`c${i}`, { id: `c${i}`, at: now - i * 60000, kind: 'ask', q: 'q' + i }]))
  const full = clone(s), P = clone(S.pruneState(clone(s)))
  const ids = Object.keys(P.planner.proposals)
  check('prune: newest 10 proposals kept', ids.length === 10 && ['p0', 'p1', 'p2'].every(x => ids.includes(x)) && !ids.includes('p14'))
  check('prune: undo snapshots older than 2 days dropped, recent kept', P.planner.proposals.p0.undo && !P.planner.proposals.p9.undo && P.planner.proposals.p9.summary === 's9')
  check('prune: agenda older than 14 days dropped', !P.agenda.some(a => a.id === oldId) && P.agenda.length === 1)
  check('prune: old dated agenda tombstone dropped, block/goal and recent-date tombstones kept', !(`ai:old:${S.addDays(k, -40)}` in P.del) && 'g-deep' in P.del && `ai:new:${k}` in P.del)
  check('prune: coachLog capped at the newest 30', Object.keys(P.cp.coachLog).length === 30 && P.cp.coachLog.c0 && !P.cp.coachLog.c30)
  // the other device still has everything: merge both orders, no resurrection, converges, idempotent
  const m1 = M(P, full), m2 = M(full, P)
  check('merge: pruned proposals/agenda/coachLog never come back (both orders)', Object.keys(m1.planner.proposals).length === 10 && Object.keys(m2.planner.proposals).length === 10 && !m1.agenda.some(a => a.id === oldId) && !m2.agenda.some(a => a.id === oldId) && Object.keys(m1.cp.coachLog).length === 30 && !m1.planner.proposals.p9.undo)
  check('merge: both orders converge on the same pruned collections', JS(m1.planner) === JS(m2.planner) && JS(m1.agenda) === JS(m2.agenda) && JS(m1.cp.coachLog) === JS(m2.cp.coachLog) && JS(m1.del) === JS(m2.del))
  const m3 = M(m1, full)
  check('merge: idempotent (merging the old copy again / itself changes nothing)', J(m3.planner) === J(m1.planner) && J(m3.cp.coachLog) === J(m1.cp.coachLog) && J(M(m1, m1).planner) === J(m1.planner))
  // coachLog cap is deterministic even when the two sides hold different turns
  const x = clone(base), y = clone(base)
  x.cp.coachLog = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`x${i}`, { id: `x${i}`, at: 1000 + i * 2, kind: 'ask' }]))
  y.cp.coachLog = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`y${i}`, { id: `y${i}`, at: 1001 + i * 2, kind: 'ask' }]))
  const c1 = M(x, y).cp.coachLog, c2 = M(y, x).cp.coachLog
  check('coachLog: union capped to the newest 30 by time, same set in both orders', Object.keys(c1).length === 30 && J(Object.keys(c1).sort()) === J(Object.keys(c2).sort()) && c1.x29 && c1.y29 && !c1.x0)
}

/* ── 2. old span tombstones fold into del; old days slim; nothing the UI reads changes ── */
{
  const s = clone(base), now = Date.now(), dk = S.addDays(k, -40), st = S.keyToDate(dk).getTime() + 10 * 3600e3
  const sp = (id, extra) => ({ id, title: 'Work ' + id, cat: 'deep', src: 'focus', start: st, end: st + 3600e3, dev: 'devA', beat: st + 3600e3, u: st + 3600e3, ...extra })
  s.days[dk] = { date: dk, tasks: [{ id: 't1', title: 'Read', start: '10:00', dur: 60, cat: 'study', done: true, doneAt: st, xp: 20, u: st }, { id: 't2', title: 'Essay', start: '12:00', dur: 45, cat: 'study', done: true, xp: 15, u: st }], del: {}, goals: {}, goalsU: {}, goalsHit: [], locked: false, perfect: false, quests: [], focusBy: {}, bonus: {}, combo: 0, maxCombo: 0, xp: 0, focusMin: 0,
    spans: { live: sp('live'), dead: sp('dead', { del: true, u: st + 7200e3 }), deadT: sp('deadT', { del: true, taskId: 't2', u: st + 7200e3 }) } }
  const stale = clone(s); stale.days[dk].spans.dead = sp('dead') // the other device never saw the delete
  on(lsA, () => A.replaceFromSync(clone(s)))
  const w0 = A.workMin(A.getState().days[dk]), xp0 = A.getState().xp
  const P = clone(S.pruneState(clone(A.getState())))
  const d = P.days[dk]
  check('tombstones: an old deleted span folds into the day del map', !d.spans.dead && d.del.dead === st + 7200e3)
  check('tombstones: a deleted span tied to a task shrinks to a stub (task still counts as logged at 0)', d.spans.deadT.del && d.spans.deadT.taskId === 't2' && d.spans.deadT.title === '')
  on(lsA, () => A.replaceFromSync(clone(P)))
  check('tombstones: work minutes and XP of that day unchanged', A.workMin(A.getState().days[dk]) === w0 && A.getState().xp === xp0)
  const m1 = M(P, stale), m2 = M(stale, P)
  check('tombstones: the stale live copy is not resurrected (both orders)', !m1.days[dk].spans.dead && !m2.days[dk].spans.dead && JS(m1.days[dk].spans) === JS(m2.days[dk].spans))
  check('tombstones: prune is idempotent', J(S.pruneState(clone(P))) === J(P))
  // slim: a day older than 120 days
  const s2 = clone(base), ok2 = S.addDays(k, -130), st2 = S.keyToDate(ok2).getTime() + 9 * 3600e3
  s2.days[ok2] = { ...clone(s.days[dk]), date: ok2, tasks: [{ id: `${ok2}:d-cp`, title: 'CP', start: '09:00', dur: 60, cat: 'deep', done: true, xp: 30, u: st2, tpl: 'd-cp', ai: 'p1', k: 'cp_practice', cp: { mode: 'drill', tags: ['dp'] } }], spans: { a: { ...sp('a'), start: st2, end: st2 + 3600e3, taskId: `${ok2}:d-cp` } } }
  on(lsA, () => A.replaceFromSync(clone(s2)))
  const wS = A.workMin(A.getState().days[ok2]), xS = A.getState().xp
  const P2 = clone(S.pruneState(clone(A.getState()))), d2 = P2.days[ok2]
  on(lsA, () => A.replaceFromSync(clone(P2)))
  check('slim: >120-day-old day drops session spec / planner link / heartbeat, keeps title, kind, minutes, XP', !d2.tasks[0].cp && !d2.tasks[0].tpl && !d2.spans.a.beat && !d2.spans.a.dev && d2.tasks[0].title === 'CP' && d2.tasks[0].k === 'cp_practice' && d2.spans.a.title === 'Work a' && A.workMin(A.getState().days[ok2]) === wS && A.getState().xp === xS)
  on(lsA, () => A.replaceFromSync(clone(base)))
}

/* ── 3. storage: quota and corrupt load ── */
{
  const real = lsA.setItem; let fails = 1
  lsA.setItem = (key, v) => { if (key === 'momentum.v2' && fails-- > 0) throw new Error('QuotaExceededError'); return real(key, v) }
  on(lsA, () => A.setSettings({ name: 'x1' }))
  check('quota once: caches freed, state saved on retry, no warning', !lsA.mem.has('momentum.cf.problems') && JSON.parse(lsA.mem.get('momentum.v2')).settings.name === 'x1' && A.getStorageError() === null)
  let pings = 0; const off = A.onStorageError(() => pings++)
  lsA.setItem = (key, v) => { if (key === 'momentum.v2') throw new Error('QuotaExceededError'); return real(key, v) }
  on(lsA, () => A.setSettings({ name: 'x2' }))
  check('quota always: a persistent quota warning is raised and subscribers hear it', A.getStorageError()?.kind === 'quota' && pings === 1 && A.getState().settings.name === 'x2')
  on(lsA, () => A.setSettings({ name: 'x3' }))
  check('quota always: the warning stays while saves keep failing', A.getStorageError()?.kind === 'quota' && pings === 1)
  lsA.setItem = real
  on(lsA, () => A.setSettings({ name: 'x4' }))
  check('quota: the next good save clears the warning', A.getStorageError() === null && pings === 2 && JSON.parse(lsA.mem.get('momentum.v2')).settings.name === 'x4')
  off()
  const lsC = mkLs('devC', [['momentum.v2', '{"v":2,"days":{broken']])
  globalThis.localStorage = lsC; const C = await import('./store.js?dev=c')
  const bk = [...lsC.mem.keys()].find(x => x.startsWith('momentum.state.corrupt.'))
  check('corrupt load: raw copy kept under momentum.state.corrupt.<ts>, warning raised, app starts fresh', !!bk && lsC.mem.get(bk) === '{"v":2,"days":{broken' && C.getStorageError()?.kind === 'corrupt' && C.getStorageError()?.key === bk && typeof C.getState().days === 'object')
  globalThis.localStorage = lsA
}

/* ── 4. merges for two devices offline ── */
{
  on(lsA, () => { A.replaceFromSync(clone(base)); A.addTaskToday({ id: 'tk', title: 'Read ch. 3', start: '09:00', dur: 30, cat: 'study', u: Date.now(), done: false }) })
  const shared = clone(A.getState())
  on(lsB, () => B.replaceFromSync(clone(shared)))
  min(30); on(lsA, () => A.completeTask('tk'))
  min(5); on(lsB, () => B.saveTask({ id: 'tk', title: 'Read chapter 3', start: '09:15', dur: 30, cat: 'study' }))
  const a = clone(A.getState()), b = clone(B.getState()), m1 = M(a, b), m2 = M(b, a)
  const t1 = m1.days[k].tasks.find(t => t.id === 'tk'), t2 = m2.days[k].tasks.find(t => t.id === 'tk'), ta = a.days[k].tasks.find(t => t.id === 'tk')
  check('task: completion survives a later title/time edit on the other device (both orders)', t1.done && t2.done && t1.xp === ta.xp && t1.doneAt === ta.doneAt && t1.title === 'Read chapter 3' && t1.start === '09:15' && JS(t1) === JS(t2))
  check('task: day XP keeps the completion after merge', m1.days[k].xp >= ta.xp && m1.days[k].xp === m2.days[k].xp)
  // undone later on B wins over the earlier completion on A
  on(lsB, () => B.replaceFromSync(clone(m1))); min(1); on(lsB, () => B.uncompleteTask('tk'))
  const m3 = M(a, clone(B.getState())), m4 = M(clone(B.getState()), a)
  check('task: a later undo beats the earlier completion (both orders)', !m3.days[k].tasks.find(t => t.id === 'tk').done && !m4.days[k].tasks.find(t => t.id === 'tk').done)
  // an old copy without doneU: done counts from its u
  const old = clone(a); for (const t of old.days[k].tasks) delete t.doneU
  const m5 = M(old, b)
  check('task: a copy without doneU (old client) still keeps its completion', m5.days[k].tasks.find(t => t.id === 'tk').done)

  // goal counters
  on(lsA, () => A.replaceFromSync(clone(base))); on(lsB, () => B.replaceFromSync(clone(base)))
  on(lsA, () => { A.bumpGoal('g-water', 1); A.bumpGoal('g-water', 1) }); on(lsB, () => B.bumpGoal('g-water', 1))
  const g1 = M(A.getState(), B.getState()).days[k], g2 = M(B.getState(), A.getState()).days[k]
  check('goals: per-device counts sum (2 on A + 1 on B = 3, both orders)', g1.goals['g-water'] === 3 && g2.goals['g-water'] === 3 && JS(g1.gc) === JS(g2.gc))
  check('goals: merging again does not double count', M(M(A.getState(), B.getState()), B.getState()).days[k].goals['g-water'] === 3)
  on(lsB, () => { B.replaceFromSync(M(A.getState(), B.getState())); B.bumpGoal('g-water', -1) })
  check('goals: a decrement on one device after sync subtracts once', M(A.getState(), B.getState()).days[k].goals['g-water'] === 2)
  // migration: a legacy value (both devices have 2) is not double counted
  const leg = clone(base); leg.days[k].goals = { 'g-water': 2 }; leg.days[k].goalsU = { 'g-water': 5 }; delete leg.days[k].gc
  on(lsA, () => A.replaceFromSync(clone(S.pruneState(clone(leg))))); on(lsB, () => B.replaceFromSync(clone(S.pruneState(clone(leg)))))
  on(lsA, () => A.bumpGoal('g-water', 1)); on(lsB, () => B.bumpGoal('g-water', 1))
  check('goals: migrated legacy value counted once (2 + 1 + 1 = 4)', M(A.getState(), B.getState()).days[k].goals['g-water'] === 4 && M(leg, B.getState()).days[k].goals['g-water'] === 3)

  // cp.sessions per entry
  const sa = clone(base), sb = clone(base), ses = (mins, u, endedAt) => ({ id: 's1', kind: 'practice', date: k, startedAt: 1, endedAt, mins, pids: [], solved: [], ...(u ? { u } : {}) })
  sa.cp.sessions = { s1: ses(45, 200, 100), s2: { ...ses(10, 0, 50), id: 's2' } }; sb.cp.sessions = { s1: ses(30, 100, 100), s3: { ...ses(5, 0, 60), id: 's3' } }
  const c1 = M(sa, sb).cp.sessions, c2 = M(sb, sa).cp.sessions
  check('sessions: merged per id, the newer edit wins whichever side is the server (both orders)', c1.s1.mins === 45 && c2.s1.mins === 45 && c1.s2 && c1.s3 && JS(c1) === JS(c2))
  sa.cp.sessions = { s1: ses(30, 0, 100) }; sb.cp.sessions = { s1: ses(40, 0, 120) }
  check('sessions: without u the later endedAt wins', M(sa, sb).cp.sessions.s1.mins === 40 && M(sb, sa).cp.sessions.s1.mins === 40)
}

/* ── 5. midnight: a 23:00–01:00 span gives 60 min to each day ── */
{
  on(lsA, () => { A.replaceFromSync(clone(base)); A.ensureToday() })
  const mid = S.keyToDate(k).getTime(), w0 = A.workMin(A.getState().days[k])
  on(lsA, () => {
    A.addSpan({ title: 'late', cat: 'deep', start: mid - 3600e3, end: mid + 3600e3 })
    A.setPlannerState(s => ({ ...s, days: { ...s.days, [ky]: { ...s.days[ky], tasks: [...s.days[ky].tasks, { id: 'lt', title: 'Late block', start: '23:00', dur: 120, cat: 'deep', done: false, u: 1 }] } } }))
  })
  const st = A.getState()
  check('midnight: the span is stored on its start day', Object.values(st.days[ky].spans).some(s => s.title === 'late') && !Object.values(st.days[k].spans || {}).some(s => s.title === 'late'))
  check('midnight: 60 min to yesterday, 60 min to today', A.workMin(st.days[ky]) === 60 && A.workMin(st.days[k]) - w0 === 60)
  check('midnight: unionMin with a day window splits the span', Math.round(A.unionMin(Object.values(st.days[ky].spans), Date.now(), ...A.dayWindow(ky))) === 60 && Math.round(A.unionMin(Object.values(st.days[ky].spans), Date.now(), ...A.dayWindow(k))) === 60)
  // completing yesterday's block after midnight, with a 23:00–01:00 log
  on(lsA, () => A.addSpan({ taskId: 'lt', title: 'Late block', cat: 'deep', start: mid - 3600e3, end: mid + 3600e3 }))
  on(lsA, () => A.completeTask('lt', undefined, undefined, ky))
  const lt = A.getState().days[ky].tasks.find(t => t.id === 'lt')
  check('completeTask(date): yesterday\'s block completes after midnight, on its own day', lt.done && lt.doneU === lt.doneAt && !A.getState().days[k].tasks.some(t => t.id === 'lt'))
  check('completeTask(date): whole task minutes (120) priced, per-day share clipped (60), on time', Math.round(A.taskMinutes(A.getState().days[ky], 'lt')) === 120 && Math.round(A.taskMinutes(A.getState().days[ky], 'lt', Date.now(), true)) === 60 && lt.ontime === true && lt.xp > 0)
}
/* ── 6. clients from before doneU / goal counters (an older client not updated yet) mixed with this one ── */
{
  const day = (tasks, extra = {}) => { const s = clone(base); s.days[k] = { ...s.days[k], tasks, ...extra }; return s }
  const task = extra => ({ id: 'ot', title: 'Old', start: '09:00', dur: 30, cat: 'study', done: false, u: 50, ...extra })
  const pick = st => st.days[k].tasks.find(t => t.id === 'ot')
  // old device completes (no doneU); this client holds it in memory unmigrated; the old device then uncompletes it
  const doneOld = day([task({ done: true, doneAt: 100, xp: 40, u: 100 })]), undoneOld = day([task({ done: false, u: 200 })])
  const u1 = pick(M(doneOld, undoneOld)), u2 = pick(M(undoneOld, doneOld))
  check('old client: an uncomplete without doneU beats its earlier completion (both orders, XP gone)', !u1.done && !u2.done && u1.xp === undefined && JS(u1) === JS(u2))
  // the completion was migrated here (doneU = 100) before the old device's uncomplete arrived
  const mig = clone(S.pruneState(clone(doneOld)))
  check('old client: an uncomplete beats a completion migrated to doneU (both orders)', pick(mig).doneU === 100 && !pick(M(mig, undoneOld)).done && !pick(M(undoneOld, mig)).done)
  // old client edits a record that carries doneU (its spread keeps the field): the completion stays
  const newDone = day([task({ done: true, doneAt: 100, xp: 40, u: 100, doneU: 100 })]), oldEdit = day([task({ done: true, doneAt: 100, xp: 40, u: 300, doneU: 100, title: 'Renamed' })])
  const e1 = pick(M(newDone, oldEdit))
  check('old client: a title edit on a copy carrying doneU keeps the completion and takes the title', e1.done && e1.xp === 40 && e1.title === 'Renamed' && JS(e1) === JS(pick(M(oldEdit, newDone))))
  // old client uncompletes a copy carrying doneU (spread keeps doneU = 100, u moves on): the newer u decides
  const oldUndo = day([task({ done: false, u: 300, doneU: 100 })])
  check('old client: an uncomplete of a copy carrying doneU wins (both orders)', !pick(M(newDone, oldUndo)).done && !pick(M(oldUndo, newDone)).done)
  // this client: a title edit on a never-completed task is stamped, so the other device's later completion survives it
  on(lsA, () => { A.replaceFromSync(clone(base)); A.addTaskToday({ id: 'nt', title: 'New', start: null, dur: 20, cat: 'study', u: Date.now(), done: false }) })
  const sh = clone(A.getState()); on(lsB, () => B.replaceFromSync(clone(sh)))
  min(10); on(lsB, () => B.completeTask('nt')); min(10); on(lsA, () => A.saveTask({ id: 'nt', title: 'New renamed', start: null, dur: 20, cat: 'study' }))
  const na = A.getState().days[k].tasks.find(t => t.id === 'nt'), nm = M(A.getState(), B.getState()).days[k].tasks.find(t => t.id === 'nt')
  check('stamp: a local edit stamps doneU on the edited task (0: never completed)', na.doneU === 0 && nm.done && nm.title === 'New renamed')
  check('stamp: untouched tasks are not rewritten by an edit elsewhere in the day', A.getState().days[k].tasks.filter(t => t.id !== 'nt').every(t => J(t) === J(sh.days[k].tasks.find(x => x.id === t.id))))

  // goals: A (new) has counters, B (old) passes the day along
  const W = 'g-water', g = (goals, goalsU, gc) => { const s = clone(base); s.days[k] = { ...s.days[k], goals: { [W]: goals }, goalsU: { [W]: goalsU } }; if (gc) s.days[k].gc = { [W]: gc }; else delete s.days[k].gc; return s }
  const gA = g(4, 100, { legacy: [3, 0], devA: [1, 0] })
  const val = (x, y) => [M(x, y).days[k].goals[W], M(y, x).days[k].goals[W]]
  check('goals/old: a round trip through an old client that dropped gc adds nothing (4, both orders)', J(val(gA, g(4, 100))) === '[4,4]')
  check('goals/old: an old client\'s bump (gc dropped) is kept by last-write-wins (5, both orders)', J(val(gA, g(5, 200))) === '[5,5]')
  const stale = g(5, 200, { legacy: [3, 0], devA: [1, 0] }) // old client kept A's gc but bumped goals only
  check('goals/old: an old client\'s bump with a stale gc is kept (5, both orders)', J(val(gA, stale)) === '[5,5]')
  check('goals/old: merge results are the same in both orders and idempotent', JS(M(gA, stale).days[k]) === JS(M(stale, gA).days[k]) && JS(M(M(gA, stale), stale).days[k]) === JS(M(gA, stale).days[k]))
  check('goals/old: an older old-client value loses to a newer counter bump', J(val(g(3, 50), gA)) === '[4,4]')
  // a new client bumps the inconsistent day: counters re-base on the shown value, then add up with another new device again
  on(lsA, () => { A.replaceFromSync(M(gA, stale)); A.bumpGoal(W, 1) })
  const reb = A.getState().days[k]
  check('goals/old: a bump after an old client\'s write counts from the shown value (5 + 1 = 6) and adds up again', reb.goals[W] === 6 && A.goalTotal(reb.gc[W]) === 6)
  const gC = g(5, 150, { legacy: [3, 0], devA: [1, 0], devC: [1, 0] }) // C bumped (consistent) before seeing B's write
  check('goals/old: after the re-base two new devices sum by counters again', M(A.getState(), gC).days[k].goals[W] === 7 && M(gC, A.getState()).days[k].goals[W] === 7)
  // devices that migrated different pre-counter values: no max of the two legacy values, the newer write wins
  const l1 = g(3, 100, { legacy: [3, 0] }), l2 = g(2, 200, { legacy: [2, 0] })
  check('goals/legacy clash: the newer pre-counter value wins, not the max (both orders)', J(val(l1, l2)) === '[2,2]')
  check('goals: two plain old copies (no gc anywhere) merge last-write-wins as before', J(val(g(2, 100), g(1, 200))) === '[1,1]')
}

/* ── 7. completeTask without a date finds the task's own day (callers from before the date argument) ── */
{
  on(lsA, () => { A.replaceFromSync(clone(base)); A.ensureToday() })
  const mid = S.keyToDate(k).getTime()
  on(lsA, () => {
    A.setPlannerState(s => ({ ...s, days: { ...s.days, [ky]: { ...s.days[k], date: ky, spans: {}, del: {}, tasks: [{ id: 'lt2', title: 'Round', start: '23:05', dur: 120, cat: 'deep', done: false, u: 1 }] } } }))
    A.addSpan({ taskId: 'lt2', title: 'Round', cat: 'deep', src: 'contest', start: mid - 3300e3, end: mid + 3900e3 })
  })
  check('taskDay: a task only on yesterday resolves to yesterday, a today task to today', A.taskDay('lt2') === ky && A.taskDay(A.getState().days[k].tasks[0]?.id ?? 'x') === k)
  on(lsA, () => A.completeTask('lt2'))
  const t2 = A.getState().days[ky].tasks.find(t => t.id === 'lt2')
  check('completeTask(id) after midnight completes yesterday\'s block (contest/focus callers pass no date)', t2.done && t2.xp > 0)
  on(lsA, () => A.uncompleteTask('lt2'))
  check('uncompleteTask(id) finds it there too', !A.getState().days[ky].tasks.find(t => t.id === 'lt2').done)
}
console.log(ok + ' passed, ' + bad + ' failed')
