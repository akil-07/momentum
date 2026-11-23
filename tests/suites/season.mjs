// season: per-day targets (exam weeks), overlap, 2-device merge, discipline against the day's target, planner context + season proposals
globalThis.document = { addEventListener() {}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}
globalThis.window = { setTimeout: () => 0, clearTimeout() {}, open() {} }
const R = Date, t0 = new R(); t0.setHours(10, 0, 0, 0); let T = t0.getTime()
globalThis.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(T) } static now() { return T } }
const tick = (ms = 1000) => { T += ms }
const mem = new Map([['momentum.device', 'devA']])
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size } }
const S = await import('./store.js'), Z = await import('./season.js'), D = await import('./discipline.js'), P = await import('./planner.js')
const clone = x => JSON.parse(JSON.stringify(x)); let ok = 0, bad = 0
const check = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n) }
S.resetAll(); S.ensureToday()
const base = clone(S.getState()), k = S.dateKey(), add = n => S.addDays(k, n)
const sea = (id, from, until, u, o = {}) => ({ id, kind: 'exam', from, until, cpMin: 45, mock: false, contests: 'optional', u, ...o })
const withSeasons = (...xs) => ({ ...clone(base), seasons: Object.fromEntries(xs.map(x => [x.id, x])) })

/* ── 1. targetFor: normal vs exam ── */
{ const s = withSeasons(sea('e1', add(2), add(5), 1))
  const n = Z.targetFor(k, s), e = Z.targetFor(add(3), s), edge = [Z.targetFor(add(2), s).kind, Z.targetFor(add(5), s).kind, Z.targetFor(add(6), s).kind]
  check('targetFor: a normal day = 270 min + 120 min mock, every rated round', n.cpMin === 270 && n.mock && n.mockMin === 120 && n.contests === 'all' && n.kind === 'normal' && n.season === null)
  check('targetFor: an exam day = the season\'s light target (45 min, no mock, rounds optional)', e.cpMin === 45 && !e.mock && e.mockMin === 0 && e.contests === 'optional' && e.kind === 'exam' && e.season?.id === 'e1')
  check('targetFor: from/until are inclusive', edge.join() === 'exam,exam,normal')
  check('targetFor: a state with no seasons field (old copy) is all normal', Z.targetFor(k, { ...clone(base), seasons: undefined }).cpMin === 270)
  const ex = Z.makeSeason({ from: add(9), until: add(3) })
  check('makeSeason: exam defaults and swapped dates fixed', ex.kind === 'exam' && ex.cpMin === 45 && !ex.mock && ex.contests === 'optional' && ex.from === add(3) && ex.until === add(9)) }

/* ── 2. overlap: the most recently edited season wins, deleted ones never apply ── */
{ const s = withSeasons(sea('old', add(0), add(10), 100, { cpMin: 60 }), sea('new', add(3), add(4), 200, { cpMin: 0, contests: 'none' }), sea('gone', add(0), add(10), 300, { cpMin: 999, del: true }))
  check('overlap: newer season wins inside the overlap', Z.targetFor(add(3), s).cpMin === 0 && Z.targetFor(add(3), s).contests === 'none')
  check('overlap: the older one still covers the rest', Z.targetFor(add(1), s).cpMin === 60 && Z.targetFor(add(6), s).cpMin === 60)
  check('overlap: a deleted season is ignored', Z.seasonsOf(s).length === 2 && !Z.seasonsOf(s).some(x => x.id === 'gone'))
  check('upcomingSeasons: soonest first, past ones dropped', Z.upcomingSeasons(withSeasons(sea('p', add(-9), add(-2), 1), sea('b', add(5), add(6), 1), sea('a', add(1), add(2), 1)), k).map(x => x.id).join() === 'a,b') }

/* ── 3. two devices: lww per id, deletes are a flag that wins ── */
{ const M = (a, b) => S.mergeStates(clone(a), clone(b)).seasons
  const A = withSeasons(sea('x', add(1), add(5), 100)), B = withSeasons(sea('x', add(1), add(9), 200, { cpMin: 30 }))
  check('merge: the newer edit wins in both orders', M(A, B).x.cpMin === 30 && M(B, A).x.until === add(9))
  const Bd = withSeasons({ ...sea('x', add(1), add(9), 300), del: true }), Ae = withSeasons(sea('x', add(1), add(5), 250, { cpMin: 90 }))
  check('merge: a later delete beats an earlier edit (both orders) and stays a tombstone', M(Ae, Bd).x.del && M(Bd, Ae).x.del && Z.seasonsOf({ ...base, seasons: M(Ae, Bd) }).length === 0)
  const Tie = withSeasons({ ...sea('x', add(1), add(5), 300), del: true }), Tie2 = withSeasons(sea('x', add(1), add(5), 300, { cpMin: 10 }))
  check('merge: a same-u tie prefers the delete (deterministic)', M(Tie, Tie2).x.del && M(Tie2, Tie).x.del)
  const C = withSeasons(sea('y', add(2), add(3), 5))
  check('merge: different ids union; an old copy without seasons keeps them', Object.keys(M(A, C)).sort().join() === 'x,y' && M({ ...clone(base), seasons: undefined }, A).x.cpMin === 45)
  // through the store helpers: set on this device, delete, then the other device's stale copy merges in
  S.replaceFromSync(clone(base)); tick(); S.setSeason(sea('z', add(1), add(4), 0)); const afterSet = clone(S.getState())
  tick(); S.deleteSeason('z'); const afterDel = clone(S.getState())
  check('setSeason / deleteSeason: stamped, delete keeps a del-flagged record', afterSet.seasons.z.u === T - 1000 && afterDel.seasons.z.del === true && afterDel.seasons.z.u > afterSet.seasons.z.u && afterDel.seasons.z.from === add(1))
  check('merge: the stale copy (before the delete) does not bring the season back', S.mergeStates(clone(afterSet), clone(afterDel)).seasons.z.del && S.mergeStates(clone(afterDel), clone(afterSet)).seasons.z.del)
  const mig = S.mergeStates({ ...clone(base), seasons: undefined }, { ...clone(base), seasons: undefined })
  check('merge: two old copies → seasons = {}', mig.seasons && Object.keys(mig.seasons).length === 0) }

/* ── 4. discipline against the day's target ── */
const blank = d => ({ date: d, tasks: [], del: {}, goals: {}, goalsU: {}, goalsHit: [], locked: false, perfect: false, quests: [], focusBy: {}, bonus: {}, combo: 0, maxCombo: 0, xp: 0, focusMin: 0 })
// the same 10-day history as core.mjs's discipline case (+ optional seasons, + optional extra study per day)
const mk = (practice, mock, done, seasons = {}, studyMin = 60) => { const s = clone(base); s.days = {}; s.cp.sessions = {}; s.cp.tests = {}; s.seasons = seasons
  { const d0 = S.addDays(k, -11); s.days[d0] = { ...blank(d0), tasks: [{ id: 'x0', title: 'started', start: null, dur: 10, cat: 'study', done: true, u: 1 }] } }
  for (let i = 10; i >= 1; i--) { const d = S.addDays(k, -i); s.days[d] = { ...blank(d), tasks: [{ id: 'x' + i, title: 'study', start: null, dur: studyMin, cat: 'study', done, u: 1 }] }
    if (practice) s.cp.sessions['p' + i] = { id: 'p' + i, kind: 'practice', date: d, startedAt: 0, endedAt: 1, mins: practice, pids: [], solved: [] }
    if (mock) s.cp.sessions['m' + i] = { id: 'm' + i, kind: 'mock', date: d, startedAt: 0, endedAt: 1, mins: 120, pids: [], solved: [] } }
  return s }
{ // the pre-season formula, replayed by hand: normal days must score exactly as before
  const old = (p, m, pl) => 0.6 * Math.min(1, p / 270) + 0.25 * (m ? 1 : 0) + 0.15 * pl
  const replay = (p, m, done) => { let Dv = 50; const st = x => x * (x >= 0 ? 30 : 12); Dv = Math.max(0, Math.min(100, Dv + st(old(0, false, 1) - 0.85))); for (let i = 0; i < 10; i++) Dv = Math.max(0, Math.min(100, Dv + st(old(p, m, done ? 1 : 0) - 0.85))); return Math.round(Dv) }
  const all = D.discipline(mk(270, true, true)).score, noMock = D.discipline(mk(270, false, true)).score, nothing = D.discipline(mk(0, false, false)).score
  console.log('   normal days: all', all, '· no mock', noMock, '· nothing', nothing)
  check('discipline normal days: unchanged vs the old formula (core.mjs numbers)', all === replay(270, true, true) && noMock === replay(270, false, true) && nothing === replay(0, false, false))
  check('discipline normal days: everything rises, no mock falls, nothing collapses', all > 50 && noMock < 50 && nothing < noMock)
  const farSeason = { f: sea('f', add(20), add(30), 1) }
  check('discipline: a season on other dates changes nothing', D.discipline(mk(270, true, true, farSeason)).score === all)
  // exam season over the whole history (set "today", it rescoring the past days: discipline recomputes from history)
  const ex = { e: sea('e', S.addDays(k, -11), add(3), 1) }
  const sFull = mk(45, false, true, ex), full = D.discipline(sFull)
  const dayFull = D.dayScore(sFull, S.addDays(k, -3))
  console.log('   exam days: full study + 45 min CP', full.score, '· day score', dayFull.score.toFixed(2))
  check('discipline exam day: all planned study done + the 45 min CP target met ≈ 1.0', Math.abs(dayFull.score - 1) < 1e-9 && dayFull.cpMin === 45)
  check('discipline exam days: full study days rise like perfect normal days (no mock needed)', full.score > 50 && full.score >= all)
  const sNone = mk(0, false, false, ex), none = D.dayScore(sNone, S.addDays(k, -3))
  check('discipline exam day: nothing done ≈ 0', none.score < 0.01 && D.discipline(sNone).score < 10)
  const studyOnly = D.dayScore(mk(0, false, true, ex), S.addDays(k, -3)).score, cpOnly = D.dayScore(mk(45, false, false, ex), S.addDays(k, -3)).score
  check('discipline exam day: the study carries most of the score (study only 0.7 > CP only 0.3)', Math.abs(studyOnly - 0.7) < 1e-9 && Math.abs(cpOnly - 0.3) < 1e-9)
  check('discipline: the same history without the season would have collapsed (retroactive rescoring)', D.discipline(mk(45, false, true)).score < 20)
  const empty = mk(45, false, true, ex); empty.days[S.addDays(k, -2)].tasks = []
  check('discipline exam day with nothing planned: scored by the practice, not a free 70%', Math.abs(D.dayScore(empty, S.addDays(k, -2)).score - 1) < 1e-9 && D.dayScore({ ...empty, cp: { ...empty.cp, sessions: {} } }, S.addDays(k, -2)).score === 0)
  check('dayWeights: normal 60/25/15, exam 30/0/70, exam with mock 30/15/55', JSON.stringify(D.dayWeights({ kind: 'normal', mock: true })) === JSON.stringify({ practice: 0.6, mock: 0.25, planned: 0.15 }) && D.dayWeights({ kind: 'exam', mock: false }).planned === 0.7 && Math.abs(D.dayWeights({ kind: 'exam', mock: true }).planned - 0.55) < 1e-9) }

/* ── 5. planner context: per-day commitment + seasons ── */
{ S.replaceFromSync(clone(base)); tick(); S.setSeason(sea('e', add(2), add(4), 0, { note: 'endsems' }))
  const c = P.buildPlannerContext()
  const by = Object.fromEntries(c.commitment.map(x => [x.date, x]))
  check('planner context: 7 per-day commitments', c.commitment.length === 7 && c.commitment[0].date === k)
  check('planner context: normal day 270 + 120, rounds all', by[k].cp_practice_min === 270 && by[k].cp_mock_min === 120 && by[k].rated_rounds === 'all' && by[k].season === 'normal')
  check('planner context: exam day 45 + 0, rounds optional', by[add(3)].cp_practice_min === 45 && by[add(3)].cp_mock_min === 0 && by[add(3)].rated_rounds === 'optional' && by[add(3)].season === 'exam')
  check('planner context: seasons list (compact form)', c.seasons.length === 1 && c.seasons[0].from === add(2) && c.seasons[0].cp_min === 45 && c.seasons[0].note === 'endsems')
  check('planner context: no fixed 270/120 commitment object left', !('cp_practice_min_per_day' in JSON.parse(JSON.stringify(c)))) }

/* ── 6. planner proposal with a season: sanitize, apply, undo ── */
{ const raw = { summary: 'exams', questions: [], range: { from: '', to: '' }, days: [], routine_changes: [], season: { kind: 'exam', from: add(4), until: add(12), cp_min: 30, mock: false, contests: 'optional', note: 'endsems' } }
  const clean = P.sanitizeProposal(raw)
  check('sanitize: season kept, numbers clamped', clean.season && clean.season.from === add(4) && clean.season.cpMin === 30 && !clean.season.mock && clean.season.contests === 'optional')
  check('sanitize: kind "" = no season', !P.sanitizeProposal({ ...raw, season: { kind: '', from: '', until: '', cp_min: 0, mock: false, contests: '', note: '' } }).season)
  check('sanitize: a season that already ended / bad dates is dropped', !P.sanitizeProposal({ ...raw, season: { ...raw.season, from: add(-9), until: add(-1) } }).season && !P.sanitizeProposal({ ...raw, season: { ...raw.season, until: 'soon' } }).season)
  check('sanitize: absurd cp_min clamped', P.sanitizeProposal({ ...raw, season: { ...raw.season, cp_min: 5000 } }).season.cpMin === 600)
  // a season-only proposal: applying it must not wipe today's planned items
  S.replaceFromSync(clone(base)); tick()
  S.setPlannerState(s => ({ ...s, agenda: [{ id: `ai:read:${k}`, date: k, title: 'Read', start: '18:00', dur: 30, cat: 'study', kind: 'task', plan: 'p0', u: T }] }))
  tick()
  const prop = { id: 'ps', at: T, prompt: 'exams from ... to ...', ...clean, status: 'pending', u: T }
  S.setPlannerState(s => ({ ...s, planner: { ...s.planner, proposals: { ps: prop } } }))
  check('hasChanges: a season-only proposal counts as a change', P.hasChanges(prop) && !P.hasChanges({ days: [], routine: [] }))
  tick(); P.applyProposal('ps'); const A = clone(S.getState())
  check('apply: the season is set as plan-<id> and drives targetFor', A.seasons['plan-ps'] && !A.seasons['plan-ps'].del && Z.targetFor(add(5), A).cpMin === 30 && Z.targetFor(add(3), A).cpMin === 270)
  check('apply: a season-only plan keeps today\'s planned items', A.agenda.some(a => a.id === `ai:read:${k}`) && A.planner.proposals.ps.status === 'applied' && A.planner.proposals.ps.undo.season === 'plan-ps')
  tick(); P.undoProposal('ps'); const U = clone(S.getState())
  check('undo: the season is tombstoned, targets back to normal', U.seasons['plan-ps'].del === true && Z.targetFor(add(5), U).cpMin === 270 && U.planner.proposals.ps.status === 'undone')
  check('undo: merged with the applied copy, the undo wins', S.mergeStates(clone(A), clone(U)).seasons['plan-ps'].del && S.mergeStates(clone(U), clone(A)).seasons['plan-ps'].del)
  // edited in Settings after applying: undo leaves the student's version alone
  S.replaceFromSync(clone(base)); S.setPlannerState(s => ({ ...s, planner: { ...s.planner, proposals: { ps: { ...prop, u: T } } } }))
  tick(); P.applyProposal('ps'); tick(); S.setSeason({ ...S.getState().seasons['plan-ps'], cpMin: 60 }); tick(); P.undoProposal('ps')
  check('undo: a season the student edited since stays', !S.getState().seasons['plan-ps'].del && S.getState().seasons['plan-ps'].cpMin === 60) }

/* ── 7. (fix2) the automatic overlap repair / a follow-up keeps the season the proposal carried ── */
{ S.replaceFromSync(clone(base)); tick()
  const seaRaw = { kind: 'exam', from: add(4), until: add(13), cp_min: 45, mock: false, contests: 'optional', note: 'endsems' }, none = { kind: '', from: '', until: '', cp_min: 0, mock: false, contests: '', note: '' }
  const res = (o) => ({ structured: { summary: 's', questions: [], range: { from: '', to: '' }, days: [], routine_changes: [], ...o }, gen: 1, at: T })
  P.onPlannerResult({ id: 'orig', meta: { message: 'endsems, plan my week' } }, res({ season: seaRaw }))
  check('a proposal with a season: pending, carries plan-orig', S.getState().planner.proposals.orig.season?.id === 'plan-orig')
  tick(); P.onPlannerResult({ id: 'fix', meta: { message: '(automatic check)', repairOf: 'orig' } }, res({ season: none }))
  const pr = S.getState().planner.proposals
  check('the repair came back with kind "": it keeps the original season (as plan-fix), the original is superseded', pr.orig.status === 'superseded' && pr.fix.season?.id === 'plan-fix' && pr.fix.season.from === add(4) && pr.fix.season.until === add(13))
  tick(); P.applyProposal('fix')
  check('applying the repaired proposal sets the exam season', Z.targetFor(add(5)).kind === 'exam' && Z.targetFor(add(5)).cpMin === 45)
  // a follow-up message after a season-carrying (unapplied) proposal
  S.replaceFromSync(clone(base)); tick()
  P.onPlannerResult({ id: 'p1', meta: { message: 'endsems' } }, res({ season: seaRaw }))
  const ctx = P.buildPlannerContext().proposal_history.find(h => h.request === 'endsems')
  check('planner context: a pending proposal\'s season is listed as not applied', ctx?.season?.from === add(4) && ctx.season_applied === false)
  tick(); P.onPlannerResult({ id: 'p2', meta: { message: 'move gym to 6pm', carryOf: 'p1' } }, res({ season: none }))
  check('a follow-up answer without the season keeps the unapplied one', S.getState().planner.proposals.p2.season?.id === 'plan-p2')
  tick(); P.onPlannerResult({ id: 'p3', meta: { message: 'x', carryOf: 'p1' } }, res({ season: { ...seaRaw, cp_min: 20 } }))
  check('a follow-up with its own season keeps its own', S.getState().planner.proposals.p3.season?.cpMin === 20) }

console.log(`\n${ok} passed, ${bad} failed`)
if (bad) process.exitCode = 1
