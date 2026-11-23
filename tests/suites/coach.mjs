// coach: to-do hygiene (dedupe, expiry, Today cap, time in title, future due), rated-round ids, exam-season throttles, payload size
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
// coach.ts isn't in tests/build.sh: compile it (with its imports) into its own subdir so the shared build stays untouched
const APP = path.dirname(fs.realpathSync('node_modules')), OUT = path.resolve('coachbuild')
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT)
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', '--outDir', OUT, '--noEmit', 'false', '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler', '--lib', 'ES2022,DOM,DOM.Iterable', '--skipLibCheck', '--strict', '--types', 'vite/client', 'src/coach.ts', 'src/coachdata.ts'], { cwd: APP, stdio: 'ignore' })
} catch { /* type errors in files being edited elsewhere still emit */ }
for (const f of fs.readdirSync(OUT).filter(f => f.endsWith('.js'))) {
  const p = path.join(OUT, f); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/(from '\.\/[A-Za-z0-9_]+)'/g, "$1.js'").replace(/(import\('\.\/[A-Za-z0-9_]+)'\)/g, "$1.js')"))
}
fs.writeFileSync(path.join(OUT, 'package.json'), '{"type":"module"}')

// fake clock: Date.now() and new Date() follow T (09:00 today)
const R = Date, base = new R(); base.setHours(9, 0, 0, 0); let T = base.getTime()
globalThis.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(T) } static now() { return T } }
const min = m => { T += m * 60000 }
const raw = JSON.parse(fs.readFileSync('./fixtures/problems.json')).result
const list = raw.problems.filter(p => p.rating && p.contestId).map(p => ({ id: p.contestId + p.index, c: p.contestId, i: p.index, n: p.name, r: p.rating, t: p.tags, s: 1000 }))
// a CF user who took a rated round yesterday (contest 2288: not in the problemset fixture, like a just-finished round)
const sub = (id, pid, v, rel) => ({ id, pid, at: T - 864e5 + rel * 1000, v, tn: 1, ms: 15, mem: 0, rel, pt: 'CONTESTANT', lang: 'C++', cid: 2288 })
const user = { handle: 'tester', rating: 900, maxRating: 900, rank: 'newbie', fetchedAt: T, subs: {}, lastSubId: 3, contests: 1,
  rated: [{ cid: 2288, name: 'Codeforces Round 1136 (Div. 2)', rank: 9000, old: 0, new: 900, at: T - 864e5 + 3 * 36e5 }],
  list: [sub(1, '2288A', 'WRONG_ANSWER', 600), sub(2, '2288A', 'OK', 900), sub(3, '2288B1', 'WRONG_ANSWER', 3000)] }
const mem = new Map([['momentum.cf.problems', JSON.stringify({ at: T, list })], ['momentum.cf.user', JSON.stringify(user)], ['momentum.sync', JSON.stringify({ url: 'http://laptop.invalid', token: 'x' })]])
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: () => null, length: 0 }
globalThis.document = { addEventListener() {}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}
globalThis.window = { setTimeout: () => 0, clearTimeout() {}, open() {} }
globalThis.fetch = () => Promise.reject(new Error('offline')) // turns stay queued
const S = await import('./coachbuild/store.js'), C = await import('./coachbuild/coach.js'), Se = await import('./coachbuild/season.js')
await import('./coachbuild/coachdata.js'); const RES = await import('./coachbuild/resources.js')
let ok = 0, bad = 0; const check = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n) }
S.resetAll(); S.ensureToday()
S.setCp(c => ({ ...c, handle: 'tester', handleU: 1, calib: 1000, calibU: 1 }))
const k = () => S.dateKey(), day = () => S.getState().days[k()]
const todos = () => Object.values(S.getState().cp.coachTodos)
const open = () => C.openTodos()
const coachTasks = () => day().tasks.filter(t => t.k === 'coach')
let n = 0
const turn = (todo, extra = {}) => { const id = `turn${String(++n).padStart(4, '0')}-xxxxxxxx`; C.applyCoach({ id, meta: { kind: 'ask', message: 'q' } }, { structured: { message: 'ok', todo, ...extra }, gen: 1, at: Date.now() }); return id }
const td = (title, kind = 'reflect', o = {}) => ({ title, kind, minutes: 15, ref: '', why: 'because', due: k(), ...o })

// 1. dedupe: the pre-submit checklist issued three times (three wordings) is one to-do
turn([td('Write a 3-line pre-submit checklist: meaning of pref[i], count of items (m vs m+1), run all samples')])
min(30); turn([td('Write a 3-line pre-submit checklist (meaning of pref[i], item count m vs m+1, all samples match) and keep it next to your editor')])
min(30); turn([td('Write the pre-submit checklist NOW (restate in one line, sample 1 by hand, boundaries, all samples match)')])
let chk = todos().filter(t => /checklist/i.test(t.title))
check('pre-submit checklist x3 -> 1 open to-do', chk.length === 1 && open().length === 1)
check('the duplicate refreshed it (seen 3, fresh stamp)', chk[0].seen === 3 && chk[0].fresh > chk[0].at)
check('the merged turns point at the kept to-do', Object.values(S.getState().cp.coachLog).filter(m => m.out?.todo_merged?.[0]?.into === chk[0].id).length === 2)
// not duplicates: a different checklist line, two different problems with the same wording, same resource twice is one
min(5); turn([td('Add checklist line: copy the constraints line into a comment before coding'), td('Upsolve 2288A (30-min timebox, then editorial); write the key idea in one line', 'upsolve', { ref: '2288A' }), td('Upsolve 2288B1 (30-min timebox, then editorial); write the key idea in one line', 'upsolve', { ref: '2288B1' })])
min(5); turn([td('Read Contest Strategy before tonight', 'read', { ref: 'usaco-general-contest-strategy' })]); min(5); turn([td('Actually read Contest Strategy (15 min, not just open it)', 'read', { ref: 'usaco-general-contest-strategy' })])
check('distinct to-dos stay distinct; same resource read twice is one', open().length === 5 && todos().filter(t => t.ref === 'usaco-general-contest-strategy').length === 1)

// 2. Today cap: at most 3 open coach to-dos in Today, the next one moves in when one is done
check('Today holds at most 3 open coach to-dos', coachTasks().filter(t => !t.done).length === 3)
const first = coachTasks()[0].id
S.completeTask(first)
C.reconcileTodos()
check('ticking one off in Today completes the to-do and lets the next one in', S.getState().cp.coachTodos[first].done === true && coachTasks().filter(t => !t.done).length === 3 && coachTasks().length === 4)
check('todo_open sends only open to-dos', C.buildCoachData('ask').data.todo_open.length === open().length && !C.buildCoachData('ask').data.todo_open.some(r => r[0] === S.getState().cp.coachTodos[first].title))

// 3. time in the title -> the task's start; a dated one waits for its day
const tom = S.addDays(k(), 1), md = tom.slice(5)
for (const t of coachTasks().filter(t => !t.done)) S.completeTask(t.id) // make room
C.reconcileTodos(); for (const t of coachTasks().filter(t => !t.done)) S.completeTask(t.id); C.reconcileTodos()
turn([td('06:00 Upsolve R1136 B2: 30-min timebox, then editorial', 'upsolve'), td(`${md} 08:00: upsolve R1137 C (30-min timebox, then editorial)`, 'upsolve')])
const six = todos().find(t => /R1136 B2/.test(t.title)), fut = todos().find(t => /R1137 C/.test(t.title))
check('"06:00 Upsolve…" -> start 06:00, time stripped from the title', six.start === '06:00' && six.title.startsWith('Upsolve R1136 B2'))
check('the Today task carries the start time', day().tasks.find(t => t.id === six.id)?.start === '06:00')
check(`"${md} 08:00: upsolve…" -> due ${tom}, start 08:00, title "Upsolve…"`, fut.due === tom && fut.start === '08:00' && fut.title.startsWith('Upsolve R1137 C'))
check('a future-dated to-do is not in Today yet', !day().tasks.some(t => t.id === fut.id))
const parsed = C.parseTodoTitle('2288A: fix the WA')
check('a problem id at the start is not a time', parsed.title === '2288A: fix the WA' && !parsed.start)

// 4. next day: the future one arrives; 3 days after, unfinished to-dos expire and leave Today (unless started)
min(24 * 60); S.ensureToday(); C.reconcileTodos()
check('future-due to-do added to Today on its day', day().tasks.some(t => t.id === fut.id && t.start === '08:00'))
const startedId = fut.id
S.startSpan({ taskId: startedId, title: 'upsolve', cat: 'deep', src: 'focus' }); min(10); S.stopSpan()
const openBefore = open().map(t => t.id)
min(4 * 24 * 60); S.ensureToday()
// carry the started one into the new day by hand so the "started" rule is visible in Today
C.addTodoToToday(startedId); S.startSpan({ taskId: startedId, title: 'upsolve', cat: 'deep', src: 'focus' }); min(5); S.stopSpan()
const r = C.reconcileTodos()
const st = id => S.getState().cp.coachTodos[id].st
check(`open to-dos expire after 3 days (${r.expired} expired)`, openBefore.every(id => st(id) === 'expired') && open().length === 0)
check('an expired one that was started stays in Today; never-started ones leave it', day().tasks.some(t => t.id === startedId) && !day().tasks.some(t => t.k === 'coach' && t.id !== startedId && !t.done))
check('expired to-dos are not sent to the coach', C.buildCoachData('ask').data.todo_open.length === 0)
check('expired records are kept (history), not deleted', openBefore.every(id => S.getState().cp.coachTodos[id]))

// 5. rated-round ids: problems of a round the student took are real even before they reach the problemset
const id5 = turn([td('Upsolve 2288B2 (30-min timebox)', 'upsolve', { ref: '2288B2' })], { message: 'Your 2288B1 WA was off-by-one; 2288C next. Not 9999Z.' })
const msg = S.getState().cp.coachLog[id5].out.message, t5 = todos().find(t => /2288B2/.test(t.title))
check('ids of the rated round are kept, unknown ones stripped', /2288B1/.test(msg) && /2288C/.test(msg) && /\[\?\]/.test(msg) && !/9999Z/.test(msg))
check('a to-do for a rated-round problem keeps its id and ref', !!t5 && t5.ref === '2288B2' && t5.pid === '2288B2')
const d5 = C.buildCoachData('ask').data
const rr = d5.recent_rounds?.find(x => x.contest === 2288)
check('data.recent_rounds has the round with per-problem results', !!rr && rr.delta === 900 && rr.problems.find(p => p.id === '2288A')?.solved === true && rr.problems.find(p => p.id === '2288A').wrong === 1 && rr.problems.find(p => p.id === '2288B1')?.solved === false)
check('round problem ids are in allowed_ids', d5.allowed_ids.includes('2288B1'))

// 6. season: data.season + targets; exam throttles (1 batched debrief, no weekly, 1 auto-add a day)
min(24 * 60); S.ensureToday()
check('normal day: targets say 270 min + mock, no season', d5.season === null && d5.targets.length === 8 && d5.targets[0].cp_min === 270 && d5.targets[0].mock === true && !('commitment' in d5.snapshot))
S.setSeason(Se.makeSeason({ id: 'ex1', kind: 'exam', from: k(), until: S.addDays(k(), 10) }))
const d6 = C.buildCoachData('ask').data
check('exam season: data.season and light targets', d6.season?.kind === 'exam' && d6.targets[0].cp_min === 45 && d6.targets[0].mock === false)
S.setCp(c => ({ ...c, sessions: { s1: { id: 's1', kind: 'practice', date: k(), startedAt: T - 36e5, endedAt: T, mins: 60, pids: [], solved: [], u: T } } }))
const logN = () => Object.keys(S.getState().cp.coachLog).length
const before6 = logN()
C.sessionEnded('practice', 50, 'practice-a'); min(60); C.sessionEnded('practice', 40, 'practice-b')
const trig = () => S.getState().cp.triggers
check('exam: no immediate debrief per block', logN() === before6 && !trig()['debrief-practice-a'] && !!trig()[`xsess:${k()}`])
min(60); C.checkTriggers()
check('exam: not before a 90-min pause', logN() === before6)
min(30); C.checkTriggers()
check('exam: one batched debrief 90 min after the last block', logN() === before6 + 1 && !!trig()[`xdebrief:${k()}`] && !Object.keys(trig()).some(x => x.startsWith('weekly:')))
C.sessionEnded('practice', 30, 'practice-c'); min(120); C.checkTriggers()
check('exam: still only one automatic debrief that day', logN() === before6 + 1)
turn([td('Read A', 'read'), td('Implement B', 'implement'), td('Reflect on C'), td('Drill D', 'speed_drill')])
check('exam: only 1 coach to-do auto-added to Today that day (the earliest due)', coachTasks().filter(t => !t.done).length === 1 && Object.keys(trig()).filter(x => x.startsWith(`tadd:${k()}:`)).length === 1 && open().length === 5)
C.reconcileTodos()
check('exam: the cap holds on later top-ups', coachTasks().filter(t => !t.done).length === 1)
S.deleteSeason('ex1'); C.reconcileTodos()
check('season over: the normal cap of 3 applies again', coachTasks().filter(t => !t.done).length === 3)
C.checkTriggers()
check('normal season: the weekly review fires', Object.keys(trig()).some(x => x.startsWith('weekly:')))

// 7. payload: static material on the first turn of a session only, deltas after
C.noteCoachGen(2) // a new session (gen 2): nothing sent to it yet (the auto turns above are still in flight to gen 1)
const a = C.buildCoachData('ask')
C.askCoach('ask', 'first turn')
const b = C.buildCoachData('ask')
const sz = o => JSON.stringify(o).length
console.log('    payload', JSON.stringify({ first: sz(a.data), later: sz(b.data) }))
check('first turn of a session carries resources, curriculum and notebook', a.full && !!a.data.resources && !!a.data.snapshot.curriculum && 'notebook' in a.data)
check('later turns drop the static material and are smaller', !b.full && !b.data.resources && !b.data.snapshot.curriculum && !!b.data.static && sz(b.data) < sz(a.data) * 0.7)
check('later turns: discipline history is the last 14 days', (b.data.snapshot.discipline.history || []).length <= 14)
for (let i = 0; i < C.STATIC_EVERY; i++) { min(1); C.askCoach('ask', 'q' + i) }
check(`static material again after ${C.STATIC_EVERY} turns (safety net)`, C.buildCoachData('ask').full === true)
C.askCoach('ask', 'x'); check('…and not on the turn after that', C.buildCoachData('ask').full === false)
C.noteCoachGen(7)
check('a rotated session (new gen) gets the static material again', C.buildCoachData('ask').full === true)
check('claude.ai copy always carries everything', /"resources"/.test(C.coachPrompt()))


// 8. (fix2) the static material reaches every NEW conversation: reset, a turn that errored, a rotation at turn time
const landed = (meta, gen) => { const id = `land${String(++n).padStart(4, '0')}-xxxxxxxx`; C.applyCoach({ id, meta: { kind: 'ask', message: 'q', ...meta } }, { structured: { message: 'ok' }, gen, at: Date.now() }); return id }
C.noteCoachGen(9); min(1); landed({ full: true }, 9)
check('a full turn answered in gen 9 marks gen 9: the next turn is a delta', C.buildCoachData('ask').full === false && !!S.getState().cp.triggers['cstatic:9'])
C.noteCoachReset(9) // the reset endpoint answers with the OLD gen
check('after a reset (which answers the old gen 9) the next turn carries resources + curriculum', (() => { const b = C.buildCoachData('ask'); return b.full && !!b.data.resources && !!b.data.snapshot.curriculum })())
min(1); const ef = C.askCoach('ask', 'first after reset')
check('…while that full turn is in flight, the one behind it is a delta', C.buildCoachData('ask').full === false)
C.onCoachError({ id: ef, err: 'usage limit' })
check('the full turn errored: the next turn carries the material again (never marked as sent)', C.buildCoachData('ask').full === true)
min(1); landed({ full: true }, 10); min(1); landed({}, 11) // a delta turn the server answered from a NEW conversation (sys_ver bump / lost file)
check('a delta turn answered by a rotated session (gen 11): the next turn is full', C.buildCoachData('ask').full === true)
min(1); landed({ full: true }, 12)
check('a full turn the server rotated (answered in gen 12) marks gen 12', C.buildCoachData('ask').full === false)

// 9. (fix2) sameTodo: different problems / resources / subtitles are never merged; real duplicates still are
const T9 = (title, kind = 'upsolve', o = {}) => ({ id: 'x', title, kind, minutes: 30, ref: '', why: '', due: k(), at: 1, ...o })
const diff = [['Upsolve Round 1136 problem D', 'Upsolve Round 1136 problem E'], ['Upsolve 1136 D', 'Upsolve 1136 E'], ['Upsolve Div 2 C from Round 1137', 'Upsolve Div 2 D from Round 1137'],
  ['Review the editorial of Round 1137 problem C and write the key idea', 'Review the editorial of Round 1137 problem D and write the key idea'], ['Upsolve problem C of Round 1137', 'Upsolve problem D of Round 1137']]
for (const [a, b] of diff) check(`different problems: "${a}" ≠ "${b}"`, !C.sameTodo(T9(a), T9(b)))
check('different subtitles: USACO Silver: Prefix Sums ≠ : Binary Search', !C.sameTodo(T9('Read USACO Guide Silver: Prefix Sums', 'read'), T9('Read USACO Guide Silver: Binary Search', 'read')))
check('different subtitles: segment tree (point update, range sum) ≠ (lazy propagation, range add)', !C.sameTodo(T9('Implement segment tree from memory (point update, range sum)', 'implement'), T9('Implement segment tree from memory (lazy propagation, range add)', 'implement')))
check('different letters: speed drill div2 A ≠ div2 B', !C.sameTodo(T9('Speed drill: 5 div2 A problems under 10 min', 'speed_drill'), T9('Speed drill: 5 div2 B problems under 20 min', 'speed_drill')))
check('different resources are never the same read', !C.sameTodo(T9('Read this before tonight', 'read', { ref: 'usaco-general-contest-strategy' }), T9('Read this before tonight', 'read', { ref: [...RES.RES_BY_ID.keys()].find(x => x !== 'usaco-general-contest-strategy') })))
check('the same slot is not "same" when one names a problem', !C.sameTodo(T9('Upsolve R1137 C', 'upsolve', { start: '08:00' }), T9('Go over your notes on DP', 'upsolve', { start: '08:00' })))
check('still the same: "Round 1137C" = "R1137 C", the checklist wordings, the same resource', C.sameTodo(T9('Upsolve Round 1137C'), T9('Upsolve R1137 C (timebox 30)')) && C.sameTodo(T9('Write a 3-line pre-submit checklist: meaning of pref[i], run all samples', 'reflect'), T9('Write the pre-submit checklist NOW (restate in one line, all samples match)', 'reflect')) && C.sameTodo(T9('Read Contest Strategy', 'read'), T9('Read Contest Strategy', 'read')))

// 10. (fix2) Done in the Coach tab ticks its Today task and frees the slot
{ const inT = () => coachTasks().filter(t => !t.done), id = inT()[0]?.id, left = open().length
  C.todoDone(id)
  check(`Done from the Coach tab: its Today task is ticked and the next to-do moves in (${left} open before)`, !!id && day().tasks.find(t => t.id === id).done && inT().length === Math.min(3, left - 1) && !inT().some(t => t.id === id)) }
console.log(`\n${ok} passed, ${bad} failed`)
