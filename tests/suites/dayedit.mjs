const mem = new Map()
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: () => null, length: 0 }
globalThis.document = { addEventListener(){}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}
const S = await import('./store.js'), P = await import('./planner.js')
let ok = 0, bad = 0; const check = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n) }
S.resetAll(); S.ensureToday()
const k = S.dateKey(), k1 = S.addDays(k, 1), k2 = S.addDays(k, 2)
const cpT = (key, start, dur = 90, kind = 'cp_practice') => ({ key, title: 'CP ' + key, start, dur, cat: 'deep', kind, note: '' })
const mk = (id, date, tasks) => ({ id, at: Date.now(), prompt: 'p', summary: 's', questions: [], range: { from: date, to: date }, routine: [], status: 'pending', u: 1, days: [{ date, skip_blocks: [], tasks }] })
const put = p => S.setPlannerState(s => ({ ...s, planner: { ...s.planner, proposals: { ...s.planner.proposals, [p.id]: p } } }))
const day = d => S.dayItems(S.getState(), d), cpMin = d => day(d).filter(t => t.k === 'cp_practice' || t.k === 'cp_mock').reduce((a, t) => a + t.dur, 0)
// F1 undo keeps a pinned merge
put(mk('p1', k1, [cpT('cp1', '09:00'), cpT('cp2', '10:30'), cpT('cp3', '12:00')])); P.applyProposal('p1')
await new Promise(r => setTimeout(r, 5))
S.mergeItems(k1, ['ai:cp1:' + k1, 'ai:cp2:' + k1, 'ai:cp3:' + k1])
P.undoProposal('p1')
check('undo keeps merged 4.5h block, routine stays hidden: cp=' + cpMin(k1), day(k1).some(t => t.id === 'ai:cp1:' + k1 && t.dur === 270) && day(k1).filter(t => t.tpl).length === 0)
// F2 double split
put(mk('p2', k2, [cpT('big', '09:00', 180)])); P.applyProposal('p2')
S.splitItem(k2, 'ai:big:' + k2, 2); S.splitItem(k2, 'ai:big:' + k2, 2)
check('split twice keeps 180 min: ' + cpMin(k2) + ' ' + day(k2).map(t => t.start + '/' + t.dur).join(','), cpMin(k2) === 180 && day(k2).length === 3)
// F8 midnight
const late = S.addItem(k2, { title: 'late', start: '23:00', dur: 180, cat: 'deep', k: 'cp_practice' })
check('split past midnight refused', S.splitItem(k2, late, 3).length === 0)
// F6 mock kept
const m1 = S.addItem(k1, { title: 'mock', start: '20:00', dur: 120, cat: 'deep', k: 'cp_mock' }), m2 = S.addItem(k1, { title: 'prac', start: '18:00', dur: 90, cat: 'deep', k: 'cp_practice' })
const pv = S.mergePreview(k1, [m1, m2]); check('merge mock+practice keeps mock', pv.k === 'cp_mock' && pv.mixed)
// F4 diff with a pinned re-listed item: no fake conflict
const k3 = S.addDays(k, 3)
put(mk('p3', k3, [cpT('x', '09:00')])); P.applyProposal('p3'); S.editItem(k3, 'ai:x:' + k3, { dur: 120 })
const p4 = mk('p4', k3, [cpT('x', '09:00')]); put(p4)
const dd = P.diffProposal(S.getState(), p4).find(d => d.date === k3)
check('diff: pinned relisted -> no conflict/change, cp=' + dd.cpMin, dd.conflicts.length === 0 && dd.change.length === 0 && dd.cpMin === 120)
// F7 reconcile updates pinned today task from newer agenda record
const yid = S.addItem(k, { title: 'mine', start: '15:00', dur: 60, cat: 'deep' })
S.setPlannerState(s => ({ ...s, agenda: [...s.agenda, { id: yid, date: k, title: 'mine2', start: '16:00', dur: 90, cat: 'deep', kind: 'task', k: 'cp_practice', plan: 'you', pin: true, u: Date.now() + 1000 }] }))
S.reconcileToday(); const tt = S.getState().days[k].tasks.find(t => t.id === yid)
check('reconcile: newer pinned record reaches today', tt.title === 'mine2' && tt.k === 'cp_practice' && tt.dur === 90)
console.log(`${ok} passed, ${bad} failed`)
