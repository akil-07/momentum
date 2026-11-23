import fs from 'fs'
const raw = JSON.parse(fs.readFileSync('./fixtures/problems.json')).result
const list = raw.problems.filter(p => p.rating && p.contestId).map(p => ({ id: p.contestId + p.index, c: p.contestId, i: p.index, n: p.name, r: p.rating, t: p.tags, s: 1000 }))
const realNow = Date.now(); let clock = realNow; Date.now = () => clock
const mem = new Map([['momentum.cf.problems', JSON.stringify({ at: realNow, list })]])
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: () => null, length: 0 }
globalThis.document = { addEventListener(){}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}; globalThis.window = { setTimeout, clearTimeout, open() {} }
const S = await import('./store.js'), T = await import('./train.js'), P = await import('./planner.js'), B = await import('./cpblocks.js'), CU = await import('./curriculum.js')
let ok = 0, bad = 0; const check = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n) }
const clone = x => JSON.parse(JSON.stringify(x)), tick = (ms = 1) => { clock += ms }
const k = S.dateKey(), k1 = S.addDays(k, 1)
const tasks = () => S.getState().days[k].tasks, get = id => tasks().find(t => t.id === id), prac = () => tasks().filter(t => t.k === 'cp_practice')
const blk = (id, title, start, dur = 90, extra = {}) => ({ id, title, start, dur, cat: 'deep', k: 'cp_practice', done: false, u: 1, ...extra })

S.resetAll(); S.ensureToday()
// today's schedule: a done legacy block, two generic untyped blocks, a warm-up and an upsolve block (planner titles), no plan yet
for (const t of [blk('old', 'CP practice', '06:00', 60, { done: true, doneAt: 1 }), blk('b1', 'CP practice', '08:30'), blk('b2', 'CP practice (2/2)', '13:00'),
  blk('w', 'Warm-up for Codeforces Round 999', '19:00', 25), blk('up', 'Upsolve Codeforces Round 998', '21:00', 60)]) S.addTaskToday(t)
T.ensurePlan()
const specs = S.getState().cp.plans[k]?.specs || []
console.log('specs:', specs.map(s => `${s.mode}${s.sub ? '/' + s.sub : ''}${s.tags.length ? '[' + s.tags.join(',') + ']' : ''} ${s.minutes}m`).join(' | '))
check('plan has ≥ 3 sessions', specs.length >= 3)
check('warm-up / upsolve titles map to their sessions', get('w').cp?.mode === 'warmup' && get('up').cp?.mode === 'upsolve' && !get('w').cp.auto)
check('done block never typed', !get('old').cp)
check(`untyped blocks typed in time order: b1=${B.cpLabel(get('b1').cp)} b2=${B.cpLabel(get('b2').cp)}`, get('b1').cp?.mode === specs[0].mode && get('b2').cp?.mode === specs[1].mode && get('b1').cp.auto)
check(`generic titles retitled: "${get('b1').title}" / "${get('b2').title}"`, /^CP · /.test(get('b1').title) && /^CP · .*\(2\/2\)$/.test(get('b2').title) && get('w').title.startsWith('Warm-up'))
const added = specs.slice(2).map((s, i) => `cp:${s.mode}:${i + 2}:${k}`)
check(`missing sessions added as any-time blocks: ${added.join(', ')}`, added.every((id, i) => { const t = get(id); return t && t.start === null && t.dur === specs[i + 2].minutes && t.cp?.mode === specs[i + 2].mode && t.cat === 'deep' }))
const m0 = T.cpMatchToday()
check('every spec has its block (Train card ↔ schedule)', m0.bySpec.every(Boolean) && m0.bySpec[0] === 'b1' && m0.bySpec[1] === 'b2')
// idempotent
const snap = JSON.stringify(tasks()); T.ensurePlan(); T.syncCpBlocks(); S.reconcileToday()
check('rerun: nothing changes', JSON.stringify(tasks()) === snap)

// two devices running the sync from the same pre-sync state converge (no duplicates)
{
  S.setPlannerState(s => ({ ...s, days: { ...s.days, [k]: { ...s.days[k], tasks: s.days[k].tasks.filter(t => !t.id.startsWith('cp:')).map(t => { const o = { ...t }; if (o.cp?.auto) delete o.cp; return o }) } } }))
  const pre = clone(S.getState())
  tick(50); T.syncCpBlocks(); const A = clone(S.getState())
  S.setPlannerState(() => clone(pre)); tick(70); T.syncCpBlocks(); const Bs = clone(S.getState())
  const m1 = S.mergeStates(A, Bs), m2 = S.mergeStates(Bs, A)
  const ids = m1.days[k].tasks.map(t => t.id), sort = x => JSON.stringify([...x].sort((a, b) => a.id < b.id ? -1 : 1))
  check('two devices: same blocks, no duplicates, both merge orders agree', new Set(ids).size === ids.length && sort(m1.days[k].tasks) === sort(m2.days[k].tasks) && sort(A.days[k].tasks) === sort(m1.days[k].tasks))
  S.setPlannerState(() => m1); const s2 = JSON.stringify(tasks()); T.syncCpBlocks()
  check('merged state: sync is a no-op', JSON.stringify(tasks()) === s2)
}

// the student retypes b1 (pinned): never retyped; its old session gets a new block
tick(10)
S.editItem(k, 'b1', { cp: { mode: 'deep' }, dur: 120 })
T.syncCpBlocks()
check(`student-typed block kept: ${B.cpLabel(get('b1').cp)} ${get('b1').dur}m pinned=${get('b1').pin}`, get('b1').cp.mode === 'deep' && !get('b1').cp.auto && get('b1').pin && get('b1').dur === 120)
const lid = `cp:${specs[0].mode}:0:${k}`
check(`its old session (${specs[0].mode}) moved to a new block ${lid}`, get(lid)?.cp?.mode === specs[0].mode && T.cpMatchToday().bySpec[0] === lid)
{ const s3 = JSON.stringify(tasks()); T.syncCpBlocks(); check('still idempotent after the edit', JSON.stringify(tasks()) === s3) }
// a deleted session block stays deleted (no resurrection)
S.deleteTask(lid); T.syncCpBlocks()
check('a block the student deleted is not re-added', !get(lid))

// play: a typed block runs exactly its session for its own length
T.startBlock(get('b1'))
let a = S.getState().cp.active
check(`typed block → its session: ${a?.spec?.mode} ${a?.dur}m block=${a?.blockId}`, a.spec.mode === 'deep' && a.dur === 120 && a.blockId === 'b1' && a.spec.minutes === 120)
const sp = Object.values(S.getState().days[k].spans || {}).find(x => x.end === null)
check('the work-log span is tied to that block', sp?.taskId === 'b1')
// complete it: ticks b1, not the first unfinished block (b2 is earlier in the list order, untouched)
tick(100 * 60000); T.finishActive('quit')
check(`completing ticks its own block: b1 done=${get('b1').done}, b2 done=${get('b2').done}`, get('b1').done && !get('b2').done && !get('w').done)
check('the session span sits on that block', Object.values(S.getState().days[k].spans).some(x => x.taskId === 'b1' && x.end))
const sess = Object.values(S.getState().cp.sessions).find(s => s.blockId === 'b1')
check('the finished session remembers its block', !!sess)
// a learn block with the plan's sub-topic gets the plan's band; a drill block with its own topics uses them; warm-up is an easy speed session
{
  const learn = specs.find(s => s.mode === 'learn')
  if (learn) { const r = T.blockSpec({ mode: 'learn' }, 75); check(`learn block fills from the plan spec (${r.spec.sub} ${r.spec.lo}-${r.spec.hi})`, r.spec.sub === learn.sub && r.spec.lo === learn.lo && r.spec.minutes === 75 && r.specIdx === specs.indexOf(learn)) }
  const dr = T.blockSpec({ mode: 'drill', tags: ['greedy'] }, 40)
  check('drill block with chosen topics', dr.spec.mode === 'drill' && dr.spec.tags.join() === 'greedy' && dr.spec.minutes === 40)
  const L = T.skillNow().level, wu = T.blockSpec({ mode: 'warmup' }, 25)
  check(`warm-up = speed around level−300 (${wu.spec.lo}-${wu.spec.hi}, L=${L})`, wu.spec.mode === 'speed' && wu.spec.hi <= Math.max(900, L - 200) && wu.spec.minutes === 25)
  const ps = T.blockSpec({ mode: 'position', pos: 'C' }, 60)
  check('position block at its letter', ps.spec.mode === 'position' && ps.spec.pos === 'C')
  check('free block → free solve (no spec)', T.blockSpec({ mode: 'free' }, 60) === null)
}
// free block plays a free session for its length
T.startBlock(get('up')) // upsolve queue empty: an upsolve session (falls back to mixed when the queue is dry)
a = S.getState().cp.active
check(`upsolve block → ${a?.spec?.mode} (${a?.dur}m)`, a && (a.spec.mode === 'upsolve' || a.spec.mode === 'mixed') && a.dur === 60 && a.blockId === 'up')
T.finishActive('quit') // 0 min: nothing booked
check('a quit under 3 min completes nothing', !get('up').done)
// untyped legacy block keeps the old behaviour
T.startBlock({ id: 'zz', title: 'Revisit unsolved problems', dur: 45 })
a = S.getState().cp.active
check('untyped free-solve title → free session', a.spec.mode === 'free' && a.dur === 45); T.finishActive('quit')
T.startBlock({ id: 'zz', title: 'CP practice', dur: 50 })
a = S.getState().cp.active
const doneN = Object.values(S.getState().cp.sessions).filter(s => s.date === k && s.kind === 'practice' && s.spec?.mode !== 'free').length
check(`untyped block → next planned session (${a.spec.mode} = specs[${doneN}].mode)`, a.spec.mode === (specs[doneN] || specs[0]).mode && a.dur === 50); T.finishActive('quit')

// merge: a 3h block keeps the first block's session (or the picked one); split copies it to every part
{
  const p1 = S.addItem(k1, { title: 'Pos', start: '09:00', dur: 90, cat: 'deep', k: 'cp_practice', cp: { mode: 'position', pos: 'C' } })
  const p2 = S.addItem(k1, { title: 'Dr', start: '10:30', dur: 90, cat: 'deep', k: 'cp_practice', cp: { mode: 'drill', tags: ['dp'] } })
  const pv = S.mergePreview(k1, [p1, p2])
  check('merge preview offers both sessions, first by default', pv.sessions.length === 2 && pv.cp.mode === 'position')
  const mid = S.mergeItems(k1, [p1, p2])
  const mt = S.dayItems(S.getState(), k1).find(t => t.id === mid)
  check(`merged 3h block keeps its session: ${mt.dur}m ${B.cpLabel(mt.cp)}`, mt.dur === 180 && mt.cp.mode === 'position' && mt.cp.pos === 'C')
  const parts = S.splitItem(k1, mid, 3), items = S.dayItems(S.getState(), k1)
  check('split copies the session to all parts', parts.length === 3 && parts.every(id => items.find(t => t.id === id)?.cp?.mode === 'position'))
  const q1 = S.addItem(k1, { title: 'A', start: '15:00', dur: 60, cat: 'deep', k: 'cp_practice', cp: { mode: 'learn' } })
  const q2 = S.addItem(k1, { title: 'B', start: '16:00', dur: 60, cat: 'deep', k: 'cp_practice', cp: { mode: 'deep' } })
  const pv2 = S.mergePreview(k1, [q1, q2]), mid2 = S.mergeItems(k1, [q1, q2], pv2.sessions[1])
  check('merge with the session picked in the preview', S.dayItems(S.getState(), k1).find(t => t.id === mid2).cp.mode === 'deep')
  // today: merging two blocks into 3h keeps the first's session
  const t1 = S.addItem(k, { title: 'x', start: '22:00', dur: 90, cat: 'deep', k: 'cp_practice', cp: { mode: 'mixed' } })
  const t2 = S.addItem(k, { title: 'y', start: '20:30', dur: 90, cat: 'deep', k: 'cp_practice', cp: { mode: 'resolve' } })
  const tm = S.mergeItems(k, [t1, t2])
  check(`today: merged 3h block keeps the earliest block's session (${B.cpLabel(get(tm).cp)})`, get(tm).dur === 180 && get(tm).cp.mode === 'resolve')
}
// editing a routine block on a later date keeps its session; editing the type away drops it
{
  S.saveBlock({ id: 'r-cp', title: 'Routine CP', start: '07:00', dur: 60, cat: 'deep', days: [0, 1, 2, 3, 4, 5, 6], u: 1, k: 'cp_practice', cp: { mode: 'speed' } })
  const k2 = S.addDays(k, 2), rt = S.projectDay(S.getState(), k2).find(t => t.tpl === 'r-cp')
  check('routine block carries its session into each day', rt.cp?.mode === 'speed')
  const nid = S.editItem(k2, rt.id, { dur: 45 })
  check('a routine block edited on one date keeps its session', S.dayItems(S.getState(), k2).find(t => t.id === nid).cp.mode === 'speed')
  S.editItem(k2, nid, { k: 'study' })
  check('changing the type away from CP practice drops the session', !S.dayItems(S.getState(), k2).find(t => t.id === nid).cp)
}

// planner: session fields are sanitized and applied; titles map warm-up / upsolve / free
{
  const sub = CU.SUBS[0].id
  const raw = { summary: 's', questions: [], range: { from: k1, to: k1 }, routine_changes: [], days: [{ date: k1, skip_blocks: [], tasks: [
    { key: 'l', title: 'CP block A', start: '08:00', dur: 90, cat: 'deep', kind: 'cp_practice', note: '', session: 'learn', sub },
    { key: 'd', title: 'CP block B', start: '10:00', dur: 90, cat: 'deep', kind: 'cp_practice', note: '', session: 'drill', sub: '' },
    { key: 'w', title: 'Warm-up for Codeforces Round 1000', start: '17:20', dur: 25, cat: 'deep', kind: 'cp_practice', note: '', session: '', sub: '' },
    { key: 'u', title: 'Upsolve Codeforces Round 999', start: '12:00', dur: 60, cat: 'deep', kind: 'cp_practice', note: '', session: '', sub: '' },
    { key: 'f', title: 'Free solve: random problems', start: '14:00', dur: 60, cat: 'deep', kind: 'cp_practice', note: '', session: '', sub: '' },
    { key: 'x', title: 'CP block C', start: '15:00', dur: 60, cat: 'deep', kind: 'cp_practice', note: '', session: 'bogus', sub: '' },
    { key: 'm', title: 'Mock', start: '18:00', dur: 120, cat: 'deep', kind: 'cp_mock', note: '', session: 'drill', sub: '' }] }] }
  const clean = P.sanitizeProposal(raw), ts = clean.days[0].tasks, by = key => ts.find(t => t.key === key)
  check('sanitize: learn + sub, drill, warmup/upsolve/free from titles, junk → untyped, mock → none',
    by('l').cp?.mode === 'learn' && by('l').cp.sub === sub && by('d').cp?.mode === 'drill' && by('w').cp?.mode === 'warmup' && by('u').cp?.mode === 'upsolve' && by('f').cp?.mode === 'free' && !by('x').cp && !by('m').cp)
  S.setPlannerState(s => ({ ...s, planner: { ...s.planner, proposals: { pp: { id: 'pp', at: Date.now(), prompt: 'p', ...clean, status: 'pending', u: 1 } } } }))
  P.applyProposal('pp')
  const day = S.projectDay(S.getState(), k1), it = key => day.find(t => t.id === `ai:${key}:${k1}`)
  check('applied proposal carries the sessions into the day', it('l').cp?.mode === 'learn' && it('l').cp.sub === sub && it('w').cp.mode === 'warmup' && it('u').cp.mode === 'upsolve' && !it('x').cp && !it('m').cp)
  check('a re-proposal that only changes a session counts as a change', P.diffProposal(S.getState(), { ...S.getState().planner.proposals.pp, id: 'pq', status: 'pending', days: [{ ...clean.days[0], tasks: clean.days[0].tasks.map(t => t.key === 'd' ? { ...t, cp: { mode: 'mixed' } } : t) }] })[0].change.length === 1)
  const ctx = P.buildPlannerContext()
  check('planner context: practice_sessions and per-block session', ctx.practice_sessions.length === specs.length && ctx.practice_sessions[0].mode === specs[0].mode && ctx.current_schedule[0].items.some(i => i.session === 'deep' && i.session_set))
  // today: a planned block with a session lands typed and the sync claims it
  tick(10)
  const today = { summary: 's', questions: [], range: { from: k, to: k }, routine_changes: [], days: [{ date: k, skip_blocks: [], tasks: [{ key: 'td', title: 'Drill block', start: '23:00', dur: 30, cat: 'deep', kind: 'cp_practice', note: '', session: 'drill', sub: '' }] }] }
  const c2 = P.sanitizeProposal(today)
  S.setPlannerState(s => ({ ...s, planner: { ...s.planner, proposals: { ...s.planner.proposals, pt: { id: 'pt', at: Date.now(), prompt: 'p', ...c2, status: 'pending', u: 1 } } } }))
  P.applyProposal('pt')
  check('today: planned session lands on the block and is not retyped by the sync', get(`ai:td:${k}`)?.cp?.mode === 'drill') // planner-set sessions stay auto by design (planner.ts: re-mappable, unlike the student's)
}
console.log(ok + ' passed, ' + bad + ' failed')
