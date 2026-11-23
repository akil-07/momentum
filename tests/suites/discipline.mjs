// Needs one specific recorded state (MOMENTUM_STATE, default ../../data/state.json) with activity on 2026-11-21/22; it skips when the file is absent.
import fs from 'fs'
globalThis.localStorage = { m: new Map(), getItem(k){return this.m.get(k)??null}, setItem(k,v){this.m.set(k,String(v))}, removeItem(k){this.m.delete(k)}, key:()=>null, length:0 }
globalThis.document = { addEventListener(){}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}; globalThis.window = { setTimeout, clearTimeout, open() {} }
const D = await import('./discipline.js')
const SRC = process.env.MOMENTUM_STATE || '../../data/state.json'
if (!fs.existsSync(SRC)) { console.log('SKIP no real state file (set MOMENTUM_STATE)'); process.exit(0) }
let doc = JSON.parse(fs.readFileSync(SRC)).doc; if (typeof doc === 'string') doc = JSON.parse(doc)
doc.days = Object.fromEntries(Object.entries(doc.days).map(([k, d]) => [k, { ...d, tasks: d.tasks.filter(t => !t.del) }]))
let ok=0,bad=0; const check=(n,c)=>{c?ok++:bad++;console.log((c?'PASS ':'FAIL ')+n)}
const at = s => new Date(s)
const show = (lbl, r) => console.log(lbl.padEnd(18), 'score', r.score, 'live', r.live, 'Δ', r.liveDelta, 'pace', r.pace.toFixed(2), 'today', r.today.score, 'hist', r.history.map(h => h.date + ':' + h.D).join(' '))
check('first active day is Nov 21 (template Nov 20 skipped)', D.firstActiveDay(doc) === '2026-11-21')
const m = D.discipline(doc, at('2026-11-21T05:00')); show('Nov21 05:00', m)
const e = D.discipline(doc, at('2026-11-21T21:50')); show('Nov21 21:50', e)
const n = D.discipline(doc, at('2026-11-22T00:05')); show('Nov22 00:05', n)
check('no penalty for the unused template day: base 50 today', e.score === 50)
check('live moves with today\'s work (above 50 tonight)', e.live > 50)
check('after midnight, finished-day score = last night\'s live (±1)', Math.abs(n.score - D.discipline(doc, at('2026-11-21T23:59')).live) <= 1)
// an empty morning: nothing due yet → no drop
const blank = JSON.parse(JSON.stringify(doc)); for (const [id, x] of Object.entries(blank.cp.sessions || {})) if (x.date === '2026-11-22') delete blank.cp.sessions[id]; for (const [id, x] of Object.entries(blank.cp.tests || {})) if (x.date === '2026-11-22') delete blank.cp.tests[id]; blank.days['2026-11-22'] = { ...doc.days['2026-11-21'], date: '2026-11-22', spans: {}, tasks: doc.days['2026-11-21'].tasks.map(t => ({ ...t, done: false })) }
const b6 = D.discipline(blank, at('2026-11-22T05:00')), b23 = D.discipline(blank, at('2026-11-22T23:30'))
show('blank Nov22 05:00', b6); show('blank Nov22 23:30', b23)
check('blank day before anything is due: live = score', b6.live === b6.score)
check('blank day at night: live drops for undone work', b23.live < b23.score - 5)
console.log(`${ok} passed, ${bad} failed`); process.exit(bad?1:0)
