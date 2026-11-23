globalThis.document = { addEventListener(){}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}
const S = await import('./store.js'), P = await import('./planner.js'), D = await import('./discipline.js'), C = await import('./cf.js'), T = await import('./cptime.js')
const clone = x => JSON.parse(JSON.stringify(x)); let ok = 0, bad = 0
const check = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n) }
const base = clone(S.getState()), k = S.dateKey(), k1 = S.addDays(k, 1), k2 = S.addDays(k, 2)
const sortK = o => JSON.stringify(Object.keys(o).sort().map(x => [x, o[x]]))
// 1 events union + evCut
{ const A = clone(base), B = clone(base)
  A.cp.events = { 'o:1A:d1:5': { id: 'o:1A:d1:5', pid: '1A', k: 'open', at: 5 }, 's:9': { id: 's:9', pid: '1A', k: 'sub', at: 900, v: 'WRONG_ANSWER' } }
  B.cp.events = { 's:9': { id: 's:9', pid: '1A', k: 'sub', at: 900, v: 'WRONG_ANSWER' }, 's:10': { id: 's:10', pid: '1A', k: 'sub', at: 1000, v: 'OK' } }; B.cp.evCut = 100
  const m1 = S.mergeStates(A, B).cp, m2 = S.mergeStates(B, A).cp
  check('events: union, cut drops old, converges', Object.keys(m1.events).length === 2 && !m1.events['o:1A:d1:5'] && sortK(m1.events) === sortK(m2.events)) }
// 2 coachLog keeps the answered copy
{ const A = clone(base), B = clone(base)
  A.cp.coachLog = { t1: { id: 't1', at: 10, kind: 'ask', q: 'hi', out: { message: 'yo' } } }; B.cp.coachLog = { t1: { id: 't1', at: 20, kind: 'ask', q: 'hi' } }
  check('coachLog: answered copy survives a newer placeholder', S.mergeStates(A, B).cp.coachLog.t1.out && S.mergeStates(B, A).cp.coachLog.t1.out) }
// 3 projectDay with from/until/skip
{ const s = clone(base); const wd = S.keyToDate(k1).getDay()
  s.template = [{ id: 'b1', title: 'Class', start: '09:00', dur: 60, cat: 'study', days: [wd], u: 1, from: k1, until: k1 }, { id: 'b2', title: 'Gym', start: '07:00', dur: 60, cat: 'health', days: [wd], u: 1 }, { id: 'b3', title: 'Old', start: '10:00', dur: 30, cat: 'admin', days: [wd], u: 1, until: k }]
  s.agenda = [{ id: `ai:skip-b2:${k1}`, date: k1, title: 'skip', start: null, dur: 0, cat: 'break', kind: 'skip', skip: 'b2', plan: 'p', u: 1 }, { id: `ai:exam:${k1}`, date: k1, title: 'Exam', start: '13:00', dur: 180, cat: 'study', kind: 'task', plan: 'p', u: 1 }]
  const titles = S.projectDay(s, k1).map(t => t.title).sort().join(',')
  const dayAfter = S.projectDay(s, k2).map(t => t.title).join(',')
  check('projectDay: from/until respected, skip applied, agenda added', titles === 'Class,Exam' && !dayAfter.includes('Class')) }
// 4 planner apply on two devices converges, undo propagates
{ S.resetAll()
  const prop = { id: 'p1', at: Date.now(), prompt: 'x', summary: 's', questions: [], range: { from: k, to: k1 }, routine: [{ op: 'add', key: 'gym', block_id: '', title: 'Gym', start: '07:00', dur: 60, cat: 'health', days: [1, 3], from: k, until: '' }],
    days: [{ date: k1, skip_blocks: [], tasks: [{ key: 'cp-a', title: 'CP practice', start: '14:00', dur: 90, cat: 'deep', kind: 'cp_practice', note: '' }, { key: 'cp-a', title: 'CP practice 2', start: '16:00', dur: 90, cat: 'deep', kind: 'cp_practice', note: '' }] }], status: 'pending', u: 1 }
  S.setPlannerState(s => ({ ...s, planner: { ...s.planner, proposals: { p1: prop } } }))
  const pre = clone(S.getState())
  P.applyProposal('p1'); const A = clone(S.getState())
  S.replaceFromSync(S.migrate ? pre : pre); S.setPlannerState(() => clone(pre)); P.applyProposal('p1'); const B = clone(S.getState())
  const m = S.mergeStates(A, B)
  const ids = m.agenda.filter(a => a.kind === 'task').map(a => a.id)
  check('planner: same proposal applied on 2 devices → no duplicate agenda items', new Set(ids).size === ids.length && ids.length === 2)
  check('planner: duplicate keys on one day get distinct ids', ids.includes(`ai:cp-a:${k1}`) && ids.includes(`ai:cp-a-2:${k1}`))
  check('planner: recurring item became a dated routine block', m.template.some(b => b.id === 'ai-gym' && b.from === k))
  S.setPlannerState(() => clone(A)); P.undoProposal('p1'); const U = clone(S.getState())
  const mu = S.mergeStates(U, B), mu2 = S.mergeStates(B, U)
  check('planner: undo on one device wins after merge (both orders)', mu.agenda.length === 0 && mu2.agenda.length === 0 && !mu.template.some(b => b.id === 'ai-gym') && !mu2.template.some(b => b.id === 'ai-gym')) }
// 5 locked today keeps tasks on reconcile
{ S.resetAll(); S.ensureToday()
  S.setPlannerState(s => ({ ...s, agenda: [{ id: `ai:x:${k}`, date: k, title: 'AI task', start: '20:00', dur: 30, cat: 'study', kind: 'task', plan: 'p', u: Date.now() }] }))
  S.reconcileToday(); const had = S.getState().days[k].tasks.some(t => t.id === `ai:x:${k}`)
  S.setPlannerState(s => ({ ...s, agenda: [{ id: `ai:y:${k}`, date: k, title: 'Done AI task', start: '21:00', dur: 30, cat: 'study', kind: 'task', plan: 'p', u: Date.now() }] }))
  S.reconcileToday(); S.setPlannerState(s => ({ ...s, days: { ...s.days, [k]: { ...s.days[k], tasks: s.days[k].tasks.map(t => t.id === `ai:y:${k}` ? { ...t, done: true } : t) } } }))
  S.setPlannerState(s => ({ ...s, agenda: [], del: { ...s.del, [`ai:x:${k}`]: Date.now() + 1, [`ai:y:${k}`]: Date.now() + 1 } }))
  S.reconcileToday(); const t2 = S.getState().days[k].tasks
  check('reconcile: agenda task lands in today; a removed one leaves (no lock), a finished one stays', had && !t2.some(t => t.id === `ai:x:${k}`) && t2.some(t => t.id === `ai:y:${k}`)) }
// 6 discipline math
{ const mk = (practice, mock, done) => { const s = clone(base); s.days = {}; s.cp.sessions = {}; s.cp.tests = {}
    { const d0 = S.addDays(k, -11); s.days[d0] = { date: d0, tasks: [{ id: 'x0', title: 'started', start: null, dur: 10, cat: 'study', done: true, u: 1 }], del: {}, goals: {}, goalsU: {}, goalsHit: [], quests: [], focusBy: {}, bonus: {}, combo: 0, maxCombo: 0, xp: 0, focusMin: 0 } }
    for (let i = 10; i >= 1; i--) { const d = S.addDays(k, -i); s.days[d] = { date: d, tasks: [{ id: 'x' + i, title: 'study', start: null, dur: 60, cat: 'study', done, u: 1 }], del: {}, goals: {}, goalsU: {}, goalsHit: [], locked: false, perfect: false, quests: [], focusBy: {}, bonus: {}, combo: 0, maxCombo: 0, xp: 0, focusMin: 0 }
      if (practice) s.cp.sessions['p' + i] = { id: 'p' + i, kind: 'practice', date: d, startedAt: 0, endedAt: 1, mins: practice, pids: [], solved: [] }
      if (mock) s.cp.sessions['m' + i] = { id: 'm' + i, kind: 'mock', date: d, startedAt: 0, endedAt: 1, mins: 120, pids: [], solved: [] } }
    return D.discipline(s).score }
  const all = mk(270, true, true), noMock = mk(270, false, true), nothing = mk(0, false, false)
  console.log('   discipline after 10 days: all done', all, '· no mock', noMock, '· nothing', nothing)
  check('discipline: everything done rises, skipping the mock falls, doing nothing collapses', all > 50 && noMock < 50 && nothing < noMock) }
// 7 controllers
{ const cp = clone(base.cp)
  check('practice offset: >70% clean → +100, <40% → −100, few samples → unchanged', C.practiceOffsetRule(cp, 0.8, 10) === 100 && C.practiceOffsetRule(cp, 0.3, 10) === -100 && C.practiceOffsetRule(cp, 0.9, 3) === 0)
  cp.tests = { a: { id: 'a', date: 'a', pids: [], startedAt: 2, dur: 120, solved: {}, finishedAt: 3, perf: 1500 }, b: { id: 'b', date: 'b', pids: [], startedAt: 1, dur: 120, solved: {}, finishedAt: 2, perf: 1450 } }
  check('mock offset: two mocks ≥ L+100 → +100', C.mockOffsetRule(cp, 1300) === 100)
  cp.tests.a.perf = 1100; check('mock offset: mixed results → unchanged', C.mockOffsetRule(cp, 1300) === 0)
  const spec = { mode: 'drill', tags: [], lo: 1200, hi: 1500, minutes: 90, timebox: 1 }
  check('adaptive band: fast→+100, fail→−100, clamped to spec', C.stepBand(spec, 1300, 'fast') === 1400 && C.stepBand(spec, 1300, 'fail') === 1200 && C.stepBand(spec, 1500, 'fast') === 1500 && C.stepBand(spec, 1200, 'skip') === 1200) }
// 8 verdict classes
{ const t = T.timeline('1A', [{ id: 'o', pid: '1A', k: 'open', at: 0 }, { id: 's1', pid: '1A', k: 'sub', at: 60000, v: 'WRONG_ANSWER', tn: 0 }, { id: 's2', pid: '1A', k: 'sub', at: 120000, v: 'TIME_LIMIT_EXCEEDED', tn: 5 }, { id: 's3', pid: '1A', k: 'sub', at: 180000, v: 'OK' }])
  check('error classes + verdict chain', T.classify(t).join() === 'sample_fail,complexity' && T.verdictChain(t) === 'WA@1m(t1), TLE@2m(t6), OK@3m') }
console.log(`\n${ok} passed, ${bad} failed`)
