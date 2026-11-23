globalThis.localStorage = { m: new Map(), getItem(k){return this.m.get(k)??null}, setItem(k,v){this.m.set(k,String(v))}, removeItem(k){this.m.delete(k)}, key:()=>null, length:0 }
globalThis.document = { addEventListener(){}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}; globalThis.window = { setTimeout, clearTimeout, open() {} }
const C = await import('./contests.js')
let ok=0,bad=0; const check=(n,c)=>{c?ok++:bad++;console.log((c?'PASS ':'FAIL ')+n)}
const day = new Date(); day.setHours(0,0,0,0); const at = (h,m=0)=>day.getTime()+(h*60+m)*60000
const list = [{ id: 2100, name: 'Codeforces Round 999 (Div. 2)', start: at(20,5), dur: 7200, type: 'CF' }, { id: 2101, name: 'Educational Codeforces Round 180 (Rated for Div. 2)', start: at(14,35), dur: 7200, type: 'ICPC' }]
const f = t => C.contestFor(t, list, day)?.id ?? null
check('planner title "CF: <name>" → that round', f({ title: 'CF: Codeforces Round 999 (Div. 2)', start: '20:05', k: 'cp_mock' }) === 2100)
check('name match even if moved in time', f({ title: 'CF: Educational Codeforces Round 180 (Rated for Div. 2)', start: '09:00', k: 'cp_mock' }) === 2101)
check('plain mock at another time → not a contest', f({ title: 'Mock contest', start: '16:00', k: 'cp_mock' }) === null)
check('mock block sitting on a rated round start → that round', f({ title: 'CP mock', start: '20:00', k: 'cp_mock' }) === 2100)
check('user-typed "Div 2 round" other-kind block at start → round', f({ title: 'div 2 round', start: '20:10', k: 'other' }) === 2100)
check('unrelated other task at that time → none', f({ title: 'Dinner', start: '20:00', k: 'other' }) === null)
check('warm-up block naming the round → not the round', f({ title: 'Warm-up for Codeforces Round 999 (Div. 2)', start: '19:25', k: 'cp_practice' }) === null)
check('upsolve block naming the round (other kind) → not the round', f({ title: 'Upsolve Codeforces Round 999 (Div. 2)', start: '21:00', k: 'other' }) === null)
check('no start, no name → none', f({ title: 'CP mock', start: null, k: 'cp_mock' }) === null)
console.log(`${ok} passed, ${bad} failed`); process.exit(bad?1:0)
