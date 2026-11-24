import { useMemo } from 'react'
import {
  activeEnd, activeMin, addDays, addItem, addSpan, breakCfg, breakIn, breakMinLeft, breakMs, completeTask, cpBonus, dateKey, DEVICE, deleteSpan, editItem, editSpan, ensureToday, fmtMin, getState, keyToDate, liveSpans, logWork, nowMin, onAnyChange, openBreak, patchToday, sameHandle, setAfterReconcile, setCp, startSpan, stopSpan, taskMinutes, toast, toMin, useStore,
  type BlockSess, type CpActive, type CpMode, type CpAttempt, type Span, type CpEvent, type CpSession, type CpTest, type SessSpec, type Task, type CpPlan, type RealRound,
} from './store'
import {
  bandStart, buildPlan, cfStatus, clearUser, computeSkill, defaultSpecs, findProblem, getCfUser, getProb, getProbMap, hasProblems,
  hasPendingIn, internalRating, loadContests, loadPastContests, loadProblems, mockOffsetRule, nextProblem, performance, pickRealRound, practiceOffsetRule, probUrl, refreshUser,
  settledRating, solveXp, stepBand, TAG_SET, timeFor, useCf, virtualProbs, virtualUrl, weakest, type CfSub, type RealPick, type Skill, topicShift,
  deepSpec, learnSpec, leverSpec, posAtLevel, posSpec, isVoidTest, isContestRec, contestInfo, contestProblems, getContests, getPastContests, type CfContest } from './cf'
import { APP_DEL, FREE_RE, matchCpBlocks, type CpMatch } from './cpblocks'
import { cleanRate, compactEvents, eventsByPid } from './cptime'
import { loadContestData, placeInto, scoreFor, virtualResult, without, type ContestData } from './leverage'
import { LIGHT, NORMAL_MOCK, targetFor } from './season'
import { contestFor, isTakingNow } from './contests'

/* ═════════ trainer: event capture, adaptive practice sessions, mock rounds, queues ═════════ */

export const skillNow = (): Skill => computeSkill(getState().cp, getCfUser(), getProbMap())
export function useSkill() {
  const cf = useCf(), cp = useStore(s => s.cp)
  return useMemo(() => computeSkill(cp, cf.user, cf.byId), [cp, cf.user, cf.byId])
}
export const activeTest = (): CpTest | undefined => Object.values(getState().cp.tests).find(t => !t.finishedAt)
const now = () => Date.now()
const handle = () => getState().cp.handle || undefined

/* ───────── event log ───────── */
export function logEvent(e: Omit<CpEvent, 'h'> & { h?: string }) {
  setCp(c => c.events[e.id] ? c : { ...c, events: { ...c.events, [e.id]: { ...e, h: e.h ?? (c.handle || undefined), ing: Date.now() } } })
}
const sessId = () => activeTest()?.id ?? getState().cp.active?.id
const lastOpen = new Map<string, number>()
/** problem links call this (never blocks navigation): when you first looked at a problem */
export function openProblem(pid: string) {
  const t = now()
  if ((lastOpen.get(pid) || 0) > t - 120000) return
  lastOpen.set(pid, t)
  logEvent({ id: `o:${pid}:${DEVICE}:${t}`, pid, k: 'open', at: t, sess: sessId() })
  const a = getState().cp.active
  if (a?.cur === pid && !a.curAt) setCp(c => c.active ? { ...c, active: { ...c.active, curAt: t }, activeU: t } : c)
}
export function revealHint(pid: string, level: 1 | 2 | 3) {
  const t = now()
  logEvent({ id: `h:${pid}:${level}:${sessId() || dateKey()}`, pid, k: 'hint', at: t, hl: level, sess: sessId() })
  if (level === 3) logEvent({ id: `e:${pid}:${DEVICE}:${t}`, pid, k: 'editorial', at: t, sess: sessId() })
}
export const editorialUrl = (pid: string) => { const m = pid.match(/^(\d+)/); return m ? `https://codeforces.com/contest/${m[1]}` : probUrl(pid) }
export function logResource(resId: string, mins: number) {
  const t = now()
  logEvent({ id: `r:${resId}:${DEVICE}:${t}`, pid: 'res:' + resId, k: 'resource', at: t, mins: Math.round(mins) })
}
export function debrief(pid: string, d: { blk?: string; ed?: string; felt?: string; n?: string }) {
  const t = now()
  logEvent({ id: `d:${pid}:${sessId() || dateKey()}:${t}`, pid, k: 'debrief', at: t, sess: sessId(), ...d })
}
export function addNote(pid: string, n: string) { const t = now(); logEvent({ id: `n:${pid}:${DEVICE}:${t}`, pid, k: 'note', at: t, n: n.slice(0, 280) }) }

/** copy fresh Codeforces submissions (verdict, tests passed, time, memory, contest time) for problems we track into the synced log */
function syncSubEvents() {
  const u = getCfUser(); if (!u?.list) return
  const cp = getState().cp, since = now() - 14 * 864e5
  const tracked = new Set<string>([...Object.keys(cp.attempts), ...(cp.active?.pids || []), ...Object.values(cp.tests).flatMap(t => t.pids)])
  for (const e of Object.values(cp.events)) tracked.add(e.pid)
  const fresh: Record<string, CpEvent> = {}
  for (const s of u.list) {
    if (s.at < since || !tracked.has(s.pid) || cp.events['s:' + s.id]) continue
    const sess = Object.values(cp.tests).find(t => t.pids.includes(s.pid) && s.at >= t.startedAt && s.at <= (t.finishedAt ?? t.startedAt + t.dur * 60000))?.id
      ?? Object.values(cp.sessions).find(x => x.kind !== 'mock' && s.at >= x.startedAt && s.at <= x.endedAt)?.id
      ?? (cp.active && s.at >= cp.active.startedAt ? cp.active.id : undefined)
    fresh['s:' + s.id] = { id: 's:' + s.id, pid: s.pid, k: 'sub', at: s.at, ing: now(), v: s.v, tn: s.tn, ms: s.ms, mem: s.mem, rel: s.rel ?? undefined, pt: s.pt, sess, h: cp.handle || undefined }
  }
  if (Object.keys(fresh).length) setCp(c => ({ ...c, events: { ...c.events, ...fresh } }))
}

/* ───────── plan of the day ───────── */
export function planStarted(k = dateKey()) {
  const cp = getState().cp
  return Object.values(cp.tests).some(t => t.date === k) || Object.values(cp.sessions).some(s => s.date === k) || (!!cp.active && dateKey(new Date(cp.active.startedAt)) === k)
}
/** due queues: upsolves (unsolved mock problems within reach, 72h deadline) and spaced re-solves */
export function queues(sk = skillNow()) {
  const cp = getState().cp, k = dateKey(), t0 = now()
  const solvedNow = (pid: string) => cp.attempts[pid]?.status === 'solved' || !!getCfUser()?.subs[pid]?.ok
  const upsolve: { pid: string; due: number; overdue: boolean; tid: string }[] = []
  for (const t of Object.values(cp.tests)) {
    if (!t.finishedAt || t0 - t.finishedAt > 14 * 864e5 || !sameHandle(t.h, cp.handle) || (t.real && !t.real.vStart) || isVoidTest(t, cp)) continue
    const live = isContestRec(t), cid = t.real ? String(t.real.contestId) : ''
    // a rated round: unsolved problems within reach — rated ≤ level + 300, or up to one past the last one you solved
    // (fresh rounds have no problem ratings yet, so position is what's known)
    const lastSolved = live ? Math.max(-1, ...t.pids.map((p, i) => t.solved[p] !== undefined ? i : -1)) : -1
    // a syllabus mock: only problems you opened or submitted are misses (an untouched one isn't evidence of anything)
    const touched = !t.real ? touchedIn(t) : null
    for (const [i, pid] of t.pids.entries()) {
      const p = getProb(pid)
      if (solvedNow(pid) || t.solved[pid] !== undefined) continue
      if (live) { if (!(p && p.r <= sk.level + 300) && i > lastSolved + 1) continue }
      else if (!p || p.r > sk.level + 500) continue
      if (touched && !touched.has(pid)) continue
      // real rounds run long (up to 8 problems): upsolve what you tried, plus what's within reach — not the whole set
      if (t.real && !live && !t.real.probs[pid.slice(cid.length)]?.wa && p!.r > Math.max(sk.level, t.perf || 0) + 200) continue
      const due = t.finishedAt + 72 * 36e5
      upsolve.push({ pid, due, overdue: t0 > due, tid: t.id })
    }
  }
  const resolve = Object.entries(cp.resolve || {}).filter(([, r]) => r.due <= k && r.wins < 2).map(([pid]) => pid).slice(0, 2)
  return { upsolve, resolve, debt: upsolve.filter(x => x.overdue).length }
}
export function ensurePlan(force = false) {
  const k = dateKey(), cp = getState().cp
  if (!hasProblems()) return
  voidPhantomMocks()
  if (cp.plans[k] && !force) { lightenPlan(); syncCpBlocks(); return }
  if (force && planStarted(k)) { toast("Today's practice plan already started — changes apply tomorrow.", 'event_repeat'); return }
  const sk = computeSkill(cp, getCfUser(), getProbMap()), tg = targetFor(k)
  // nightly controllers: practice difficulty from clean rate, mock difficulty from proven performance
  const cr = cleanRate(cp, eventsByPid(cp))
  const newestMock = Object.values(cp.tests).filter(t => t.finishedAt && t.perf && !isVoidTest(t, cp) && !isContestRec(t)).reduce((m, t) => Math.max(m, t.startedAt), 0)
  const offsets = { practice: practiceOffsetRule(cp, cr.clean, cr.n), mock: mockOffsetRule(cp, sk.level), u: now(), lastMock: Math.max(cp.offsets.lastMock || 0, newestMock), practiceDay: cr.n >= 6 ? k : cp.offsets.practiceDay }
  const q = queues(sk)
  const designed = cp.designs.forDate >= addDays(k, -1) && cp.designs.specs.length ? cp.designs.specs : []
  let specs = designed.length ? designed : defaultSpecs(sk, { ...cp, offsets }, { resolve: q.resolve.length, upsolve: q.upsolve.length }, tg.cpMin)
  // upsolve debt ≥ 3 blocks new push problems until it's cleared
  if (q.debt >= 3 && tg.cpMin > 0) specs = [{ mode: 'upsolve', tags: [], lo: sk.level - 300, hi: sk.level + 500, minutes: Math.min(90, tg.cpMin), timebox: 1, by: 'default', why: `${q.debt} overdue upsolves — clear them first` }, ...specs.filter(s => s.mode !== 'drill' && s.mode !== 'mixed')]
  // the season's target is the day's budget: a coach design or the debt session never stretch an exam day back to 4.5 h
  specs = fitTo(specs, tg.cpMin)
  const light = lightDay(k)
  if (light) specs = lighten(specs)
  const rev = force ? (cp.plans[k]?.rev || 0) + 1 : 0
  const plan: CpPlan & { light?: string } = { ...buildPlan(k, sk, { ...cp, offsets }, rev, specs, offsets.mock), ...(light ? { light } : {}) }
  setCp(c => ({ ...c, offsets: c.offsets.u > offsets.u ? c.offsets : offsets, plans: { ...c.plans, [k]: plan } }))
  syncCpBlocks()
  if (force) toast(`New plan: ${specs.length} practice sessions${tg.mock ? ` + ${plan.test.length}-problem mock at ~${plan.level + plan.mockOffset!}` : ''}`, 'auto_awesome')
}
/** trim a plan to the day's practice budget (30 min of slack, so a normal 4.5 h design isn't nibbled at): sessions in order until
 *  the budget is spent, the last one cut to what's left */
export function fitTo(specs: SessSpec[], cpMin: number): SessSpec[] {
  if (cpMin <= 0) return [] // a season with no CP ("none"): no session, no block
  if (specs.reduce((a, s) => a + s.minutes, 0) <= cpMin + 30) return specs
  const out: SessSpec[] = []; let left = cpMin
  for (const s of specs) { if (left < 15) break; out.push({ ...s, minutes: Math.min(s.minutes, left) }); left -= Math.min(s.minutes, left) }
  return out.length ? out : [{ ...specs[0], minutes: cpMin }]
}
/* ───────── light day: a short night or a flat morning (today's check-in) scales today's practice ×0.6 ───────── */
export { LIGHT }
/** the one-line reason today is light, or null (sleep ≤ 5 h or energy ≤ 2 in today's morning check) */
export function lightDay(k = dateKey()): string | null {
  const e = getState().cp.energy?.[k]; if (!e) return null
  if (e.sleep !== undefined && e.sleep <= 5) return `Light day: slept ${e.sleep}h`
  if (e.energy !== undefined && e.energy <= 2) return `Light day: energy ${e.energy}/5`
  return null
}
const lighten = (specs: SessSpec[]) => specs.map(s => ({ ...s, minutes: Math.max(15, Math.round(s.minutes * LIGHT / 5) * 5) }))
/** the check-in came after today's plan was built: lighten it once, only while nothing of it has started (rev + 1 so the
 *  lighter plan wins the merge on every device) */
export function lightenPlan(k = dateKey()) {
  const plan = getState().cp.plans[k] as (CpPlan & { light?: string }) | undefined, light = lightDay(k)
  if (!plan?.specs?.length || plan.light || !light || planStarted(k)) return
  setCp(c => ({ ...c, plans: { ...c.plans, [k]: { ...plan, specs: lighten(plan.specs!), light, rev: plan.rev + 1 } as CpPlan } }))
  syncCpBlocks()
  if (k === dateKey()) lightenBlocks()
}
/** the blocks already in Today keep their length (a session runs for its block's dur): the ones the sync matched to a plan spec,
 *  not done, not started, not running, get the lightened length — the app's own (cp:*) take the spec's minutes, any other
 *  (planner / the student's) is scaled ×0.6 the same way, since the check-in came after it was made */
function lightenBlocks() {
  const k = dateKey(), d = getState().days[k], specs = getState().cp.plans[k]?.specs, m = cpMatchToday()
  if (!d || !specs || !m) return
  const dur = new Map<string, number>()
  m.bySpec.forEach((id, i) => {
    const t = id ? d.tasks.find(x => x.id === id) : undefined
    if (!t || t.done || t.k !== 'cp_practice' || taskMinutes(d, t.id) || getState().cp.active?.blockId === t.id || liveSpans(d).some(s => s.taskId === t.id)) return
    const n = t.id.startsWith('cp:') ? Math.max(10, specs[i].minutes) : Math.max(15, Math.round(t.dur * LIGHT / 5) * 5)
    if (n < t.dur) dur.set(t.id, n)
  })
  if (dur.size) patchToday(x => ({ ...x, tasks: x.tasks.map(t => dur.has(t.id) ? { ...t, dur: dur.get(t.id)!, u: t.u + 1 } : t) }))
}
/** today's practice target in minutes: the season's, ×0.6 on a light day */
export function practiceTarget(k = dateKey()) {
  const tg = targetFor(k), plan = getState().cp.plans[k] as (CpPlan & { light?: string }) | undefined
  return { minutes: Math.round(tg.cpMin * (plan?.light ? LIGHT : 1)), light: plan?.light || null, target: tg }
}

/* ───────── every planned session has a block in today's schedule (and every CP block says what it runs) ───────── */
/** today's CP practice blocks matched to today's plan (pure: what the sync would do / did) */
export function cpMatchToday(): CpMatch | null {
  const st = getState(), k = dateKey(), specs = st.cp.plans[k]?.specs, d = st.days[k]
  if (!specs?.length || !d) return null
  const today = Object.values(st.cp.sessions).filter(s => s.date === k && s.kind === 'practice' && s.specIdx !== undefined)
  const done = new Set(today.map(s => s.specIdx!))
  // the remainder of a block a session finished only part of (completePlanned's `you:rest-<session>`) continues that session's spec
  const hold = new Map(today.map(s => [restId(s.id, k), { spec: s.specIdx!, from: s.blockId }] as const))
  // typed blocks the student deleted / merged away today (deleteTask's `cpx:<mode>:<id>` marks)
  const declined = new Map<CpMode, number>()
  for (const [key, at] of Object.entries(d.del)) { const m = key.match(/^cpx:([a-z]+):/); if (m && studentDeleted(at)) declined.set(m[1] as CpMode, (declined.get(m[1] as CpMode) || 0) + 1) }
  return matchCpBlocks(k, d.tasks, specs, { done, hold, declined, gone: id => studentDeleted(d.del[id] ?? st.del[id]),
    busy: id => st.cp.active?.blockId === id || liveSpans(d).some(s => s.taskId === id) })
}
/** a block the app drops is tombstoned at its u + 1 (tiny: it can come back later, at u above it); the student's delete is a real
 *  clock time and is final */
const studentDeleted = (del: number | undefined) => del !== undefined && del >= APP_DEL
/** write the match: sessions onto blocks (u + 1: deterministic on every device, and any real edit beats it) and missing blocks
 *  (u 0, fixed ids: two devices add one record, and the student's edit of it always wins). Idempotent: writes only a difference. */
export function syncCpBlocks() {
  if (!getState().cp.plans[dateKey()]?.specs?.length) return
  ensureToday()
  const m = cpMatchToday(); if (!m || (!m.set.length && !m.add.length && !m.drop.length)) return
  patchToday(d => {
    const set = new Map(m.set.map(x => [x.id, x])), del = { ...d.del }
    for (const id of m.drop) { const t = d.tasks.find(x => x.id === id); if (t) del[id] = Math.max(del[id] ?? 0, t.u + 1) }
    const tasks = d.tasks.filter(t => !m.drop.includes(t.id)).map(t => { const w = set.get(t.id); return w ? { ...t, cp: w.cp, ...(w.title ? { title: w.title } : {}), u: t.u + 1 } : t })
    // re-added after the app dropped it: just above that tombstone (still below any real edit)
    const adds: Task[] = m.add.filter(a => !tasks.some(t => t.id === a.id) && !studentDeleted(del[a.id])).map(a => ({ id: a.id, title: a.title, start: null, dur: Math.max(10, a.spec.minutes ?? 60), cat: 'deep', k: 'cp_practice', cp: a.cp, done: false, u: del[a.id] !== undefined ? del[a.id] + 1 : 0 }))
    return { ...d, tasks: [...tasks, ...adds], del }
  })
}
setAfterReconcile(() => syncCpBlocks())

/** the session a typed block runs, for its length: today's plan spec of the same mode fills the details (band, tags, sub, why),
 *  else they're derived. null = a free-solve block (no spec: startFree). */
export function blockSpec(cp: BlockSess, minutes: number, blockId?: string): { spec: SessSpec; specIdx?: number } | null {
  if (cp.mode === 'free') return null
  const sk = skillNow(), c = getState().cp, L = sk.level, off = c.offsets?.practice || 0, specs = todaySpecs()
  // the plan spec this block holds (the sync's match), else the first of the same mode (a learn block naming another sub-topic: derived)
  const bySpec = cpMatchToday()?.bySpec || []
  let idx = blockId ? bySpec.indexOf(blockId) : -1
  if (idx >= 0 && specs[idx]?.mode !== cp.mode) idx = -1
  // not the block the sync matched to a spec: a spec of the same mode is only a template (band, tags, why) — the session
  // counts as that spec only when no other block holds it
  let own = idx >= 0
  if (idx < 0) idx = specs.findIndex(s => s.mode === cp.mode && (cp.mode !== 'learn' || !cp.sub || !s.sub || s.sub === cp.sub))
  if (idx >= 0 && cp.mode === 'learn' && cp.sub && specs[idx].sub && specs[idx].sub !== cp.sub) idx = -1
  if (idx >= 0 && !own) own = !bySpec[idx] || bySpec[idx] === blockId
  let spec: SessSpec | null = idx >= 0 ? { ...specs[idx], tags: [...specs[idx].tags] } : null
  const user = (x: Omit<SessSpec, 'minutes' | 'by'>): SessSpec => ({ ...x, minutes, by: 'user' })
  if (!spec) switch (cp.mode) {
    case 'learn': spec = learnSpec(sk, c, cp.sub) || user({ mode: 'learn', tags: cp.tags?.length ? cp.tags : weakest(sk, c.focusTags).slice(0, 1).map(t => t.tag), lo: L - 300, hi: L + 100, timebox: 1.25, why: 'Learn: a topic just below your level' }); break
    case 'drill': spec = user({ mode: 'drill', tags: weakest(sk, c.focusTags).slice(0, 3).map(t => t.tag), lo: L + off, hi: L + 200 + off, timebox: 1, why: 'Weak spots just above your level' }); break
    case 'mixed': spec = user({ mode: 'mixed', tags: [], lo: L + off, hi: L + 300 + off, timebox: 1, why: 'Contest-style mixed problems' }); break
    case 'position': spec = cp.pos ? posSpec(sk, cp.pos) : leverSpec(sk) || posSpec(sk, posAtLevel(L)); break
    case 'upsolve': spec = user({ mode: 'upsolve', tags: [], lo: L - 300, hi: L + 500, timebox: 1.25, why: 'Upsolve the problems you missed in mocks / rounds' }); break
    case 'resolve': spec = user({ mode: 'resolve', tags: [], lo: 800, hi: 3500, timebox: 1, why: 'Spaced re-solves of problems you failed' }); break
    case 'deep': spec = deepSpec(L, minutes); break
    case 'speed': spec = user({ mode: 'speed', tags: cp.tags || [], lo: Math.max(800, L - 200), hi: L + 100, timebox: 0.75, why: 'Speed: problems you can solve, fast' }); break
    case 'warmup': spec = user({ mode: 'speed', tags: [], lo: Math.max(800, L - 400), hi: Math.max(900, L - 200), timebox: 0.75, why: 'Warm-up: easy problems, fast — get the hands moving' }); break
  }
  if (!spec) return null
  // the block's own details win over the plan's
  if (cp.mode === 'drill' && cp.tags?.length) spec.tags = cp.tags.slice(0, 4)
  if (cp.mode === 'position' && cp.pos && spec.pos !== cp.pos) spec = posSpec(sk, cp.pos)
  return { spec: { ...spec, minutes }, specIdx: idx >= 0 && own ? idx : undefined }
}
/** a CP practice block's play button (and its row in Train): a typed block runs exactly its session for its length; an untyped
 *  one keeps the old rule (a free-solve title → free solve, else the next planned session). Either way the session remembers
 *  the block, so finishing completes that block. */
export function startBlock(t: Pick<Task, 'id' | 'title' | 'dur' | 'cp'>) {
  if (getState().cp.active || activeTest()) { toast('A session is already running', 'timer'); return }
  if (t.cp) {
    const b = blockSpec(t.cp, t.dur, t.id)
    if (!b) return startFree(t.dur, `Free solve: ${t.title}`, t.id)
    return startPractice(b.spec, t.dur, { blockId: t.id, specIdx: b.specIdx })
  }
  if (FREE_RE.test(t.title)) return startFree(t.dur, `Free solve: ${t.title}`, t.id)
  startPractice(undefined, t.dur, { blockId: t.id })
}

/** start-up: the local parts (event compaction, today's plan from cached problems) always run; the Codeforces parts
 *  are retried when the device comes back online and every few minutes, a handful of times */
export async function initTrainer() {
  const c = compactEvents(getState().cp)
  if (c) setCp(cp => ({ ...cp, ...c }))
  voidPhantomMocks()
  if (await trainerNet()) return
  toast(hasProblems() ? 'Codeforces is unreachable — using the cached problemset, retrying in the background' : 'Could not reach Codeforces — retrying in the background', 'cloud_off')
  if (hasProblems()) ensurePlan()
  netRetry.arm()
}
/** the network half of initTrainer; false when Codeforces couldn't be reached (problemset or account pull failed) */
async function trainerNet(): Promise<boolean> {
  try { await loadProblems() } catch { return false }
  const h = getState().cp.handle
  if (h) await refreshUser(h)
  void loadContests().catch(() => { /* calendar is optional */ })
  void loadPastContests().catch(() => { /* real-round mocks fall back to the syllabus mock */ })
  ensurePlan(); void detect()
  return !(h && cfStatus().err)
}
/** retry schedule after an offline start: on 'online' and every NET_EVERY ms, at most NET_TRIES times, stops once through */
const NET_EVERY = 3 * 60000, NET_TRIES = 5
export const netRetry = {
  tries: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined, armed: false, busy: false,
  arm() {
    if (!this.armed) { this.armed = true; this.tries = 0; if (typeof addEventListener === 'function') addEventListener('online', this.onOnline) }
    clearTimeout(this.timer); this.timer = setTimeout(() => void this.run(), NET_EVERY)
  },
  onOnline: () => void netRetry.run(),
  async run() {
    if (!this.armed || this.busy) return
    this.busy = true; this.tries++
    const ok = await trainerNet().catch(() => false)
    this.busy = false
    if (ok || this.tries >= NET_TRIES) this.stop()
    else { clearTimeout(this.timer); this.timer = setTimeout(() => void this.run(), NET_EVERY) }
  },
  stop() { this.armed = false; clearTimeout(this.timer); this.timer = undefined; if (typeof removeEventListener === 'function') removeEventListener('online', this.onOnline) },
}

export async function setHandle(h: string) {
  h = h.trim()
  if (!h) { clearUser(); setCp(c => ({ ...c, handle: '', handleU: now() })); return }
  await refreshUser(h, true)
  const u = getCfUser()
  if (!u || u.handle.toLowerCase() !== h.toLowerCase()) { toast('Codeforces handle not found (or Codeforces is unreachable)', 'error'); return }
  setCp(c => ({ ...c, handle: u.handle, handleU: now() }))
  toast(`Linked ${u.handle} — ${Object.keys(u.subs).length} problems in your history`, 'link')
  if (getState().cp.plans[dateKey()] && !planStarted()) ensurePlan(true)
  else ensurePlan()
}
export function setCalib(level: number) {
  if (getState().cp.calib === level) return
  const before = skillNow().level
  setCp(c => ({ ...c, calib: level, calibU: now() }))
  if (skillNow().level === before || !hasProblems()) return
  if (!planStarted()) ensurePlan(true)
  else toast("Starting level saved — today's practice plan already started, so it applies from tomorrow", 'tune')
}
export function setTopic(tag: string, st: 'learning' | 'learned' | 'mastered' | null) {
  setCp(c => {
    const topics = { ...c.topics }
    if (st) topics[tag] = { st, since: now(), u: now() }
    else topics[tag] = { st: 'paused', since: now(), u: now() } // stop learning it (a record, so the choice syncs to your other devices)
    return { ...c, topics }
  })
}

/* ───────── attempts, rewards, re-solve queue ───────── */
function record(pid: string, status: CpAttempt['status'], src: CpAttempt['src'], secs?: number, at = now(), pay = true) {
  const prev = getState().cp.attempts[pid]
  if (prev?.status === 'solved') return
  setCp(c => ({ ...c, attempts: { ...c.attempts, [pid]: { pid, status, src, at, secs, u: now(), h: c.handle || undefined } } }))
  if (status === 'solved' && pay) {
    const p = getProb(pid), lvl = getState().cp.plans[dateKey()]?.level || 1200
    cpBonus('cp:' + pid, solveXp(p?.r || lvl, lvl), `Solved ${pid}${p ? ` · ${p.r}` : ''}`)
  }
}
const RESOLVE_STEPS = [3, 10, 30]
function enqueueResolve(pid: string) {
  setCp(c => c.resolve[pid] && c.resolve[pid].wins < 2 ? c : { ...c, resolve: { ...c.resolve, [pid]: { due: addDays(dateKey(), RESOLVE_STEPS[0]), step: 0, wins: 0, u: now() } } })
}
function resolveOutcome(pid: string, success: boolean) {
  setCp(c => {
    const r = c.resolve[pid]; if (!r) return c
    const step = success ? Math.min(r.step + 1, RESOLVE_STEPS.length - 1) : 0
    return { ...c, resolve: { ...c.resolve, [pid]: { due: addDays(dateKey(), RESOLVE_STEPS[step]), step, wins: success ? r.wins + 1 : 0, u: now() } } }
  })
}
export function markSolved(pid: string, src: CpAttempt['src'] = 'practice') {
  logEvent({ id: `a:${pid}:${sessId() || dateKey()}`, pid, k: 'ac', at: now(), sess: sessId() })
  const a = getState().cp.active
  if (a?.kind === 'practice' && a.cur === pid) { onSessionResult(pid, true); return }
  record(pid, 'solved', src)
}
export function giveUp(pid: string, src: CpAttempt['src'] = 'practice') {
  logEvent({ id: `g:${pid}:${sessId() || dateKey()}`, pid, k: 'giveup', at: now(), sess: sessId() })
  const a = getState().cp.active
  if (a?.kind === 'practice' && a.cur === pid) { onSessionResult(pid, false); return }
  record(pid, 'failed', src); enqueueResolve(pid)
  toast('Logged as failed — it will come back as a re-solve', 'replay')
}

/* ───────── open-ended adaptive practice session ───────── */
export const todaySpecs = (): SessSpec[] => getState().cp.plans[dateKey()]?.specs || []
export function startPractice(spec?: SessSpec, minutes?: number, o: { blockId?: string; specIdx?: number } = {}) {
  const cp = getState().cp
  if (cp.active || activeTest()) { toast('A session is already running', 'timer'); return }
  const sk = skillNow()
  const done = Object.values(cp.sessions).filter(s => s.date === dateKey() && s.kind === 'practice' && s.spec?.mode !== 'free').length
  const specs = todaySpecs(), sp: SessSpec = spec || specs[done] || defaultSpecs(sk, cp, { resolve: 0, upsolve: 0 })[0]
  const specIdx = o.specIdx ?? (specs.indexOf(sp) >= 0 ? specs.indexOf(sp) : undefined)
  // started without a block (Train's buttons, Curriculum, the coach, a contest warm-up): the block this session belongs to —
  // its spec's block, else an open block of the same session, else an untyped one; none: the time is logged as unplanned
  const blockId = o.blockId ?? blockFor(sp, specIdx)
  const dur = Math.max(10, Math.min(240, minutes || sp.minutes || 90))
  const id = 'practice:' + now()
  const t0 = now()
  setCp(c => ({ ...c, active: { id, kind: 'practice', pids: [], startedAt: t0, dur, spec: sp, cur: null, band: bandStart(sp), skipped: [], specIdx, ...(blockId ? { blockId } : {}) }, activeU: t0 }))
  logSpan('cp', `CF practice · ${sp.mode}`, t0, blockId)
  serveNext()
}
/** today's open CP block a session started without one belongs to (undefined: none fits — never an unrelated typed block) */
function blockFor(sp: SessSpec | undefined, specIdx?: number): string | undefined {
  const open = (getState().days[dateKey()]?.tasks || []).filter(t => t.k === 'cp_practice' && !t.done)
    .sort((a, b) => (a.start ? toMin(a.start) : 9999) - (b.start ? toMin(b.start) : 9999))
  const bySpec = cpMatchToday()?.bySpec || []
  const held = specIdx !== undefined ? bySpec[specIdx] : null
  if (held && open.some(t => t.id === held)) return held
  const fits = (t: Task) => !!sp && !!t.cp && (t.cp.mode === sp.mode || (t.cp.mode === 'warmup' && sp.mode === 'speed'))
  // a same-session block no other spec holds first
  const free = (t: Task) => { const i = bySpec.indexOf(t.id); return i < 0 || i === specIdx }
  return (open.find(t => fits(t) && free(t)) ?? open.find(fits) ?? open.find(t => !t.cp))?.id
}
/** serve the next problem as soon as the current one is solved or skipped — no cap on how many */
/** solve whatever you like on Codeforces while the timer runs: no problems are picked for you, every Accepted is
 *  detected and pays XP, and the minutes count as practice */
export function startFree(minutes = 60, why = 'Free solve: pick your own problems', blockId?: string) {
  startPractice({ mode: 'free', tags: [], lo: 0, hi: 0, minutes, timebox: 1, by: 'user', why }, minutes, { blockId })
}
export { FREE_RE }
export function serveNext() {
  const a = getState().cp.active; if (!a || a.kind !== 'practice' || !a.spec || a.spec.mode === 'free') return
  const sk = skillNow(), q = queues(sk)
  const served = new Set(a.pids) // (solved problems are already excluded by the picker; re-solves must stay servable)
  const pick = nextProblem(sk, getState().cp, a.spec, a.band ?? bandStart(a.spec), served, `${a.id}|${a.pids.length}`, { resolve: q.resolve, upsolve: q.upsolve.map(x => x.pid) })
  if (!pick) {
    // queue modes run dry → fall back to mixed practice at the same band
    if (a.spec.mode === 'resolve' || a.spec.mode === 'upsolve') {
      const spec: SessSpec = { ...a.spec, mode: 'mixed', why: 'Queue cleared — mixed practice' }
      setCp(c => c.active ? { ...c, active: { ...c.active, spec }, activeU: now() } : c)
      return serveNext()
    }
    toast('No fresh problem found at this band — widen the session or finish', 'search_off'); return
  }
  setCp(c => c.active ? { ...c, active: { ...c.active, pids: [...c.active.pids, pick.p.id], cur: pick.p.id, curAt: 0, servedAt: now() }, activeU: now() } : c)
  whyServed.set(pick.p.id, pick.why)
}
export const whyServed = new Map<string, string>()
export const timeboxOf = (pid: string) => {
  const a = getState().cp.active, p = getProb(pid), T = Math.round(timeFor(p?.r || 1200, skillNow().level) * (a?.spec?.timebox || 1))
  return a?.spec?.mode === 'deep' ? Math.max(60, Math.min(90, T)) : T
}
/** deep mode: no hints for the first hour */
export const DEEP_LOCK = 60
/** hint escalation for the problem on screen. Normal: work → nudge (½T) → tags (T) → editorial hint (1.5T) → full editorial (2T), fail at 3T.
 *  Deep: locked until 60 min → tags → editorial hint (1.25T) → full editorial (1.5T), fail at 2T. */
export function hintStage(mode: string | undefined, mins: number, T: number, opened = true): 'open' | 'locked' | 'work' | 'nudge' | 'h1' | 'h2' | 'h3' {
  if (!opened) return 'open'
  if (mode === 'deep') return mins < DEEP_LOCK ? 'locked' : mins < 1.25 * T ? 'h1' : mins < 1.5 * T ? 'h2' : 'h3'
  return mins < 0.5 * T ? 'work' : mins < T ? 'nudge' : mins < 1.5 * T ? 'h1' : mins < 2 * T ? 'h2' : 'h3'
}
export const failAfter = (mode: string | undefined, T: number) => mode === 'deep' ? Math.max(2 * T, DEEP_LOCK + 30) : 3 * T
/** hints used on THIS attempt only (earlier attempts' hints don't spoil a re-solve) */
export const hintIn = (pid: string, sess?: string) => Object.values(getState().cp.events).filter(e => e.pid === pid && e.k === 'hint' && (!sess || e.sess === sess)).reduce((m, e) => Math.max(m, e.hl || 0), 0)
function onSessionResult(pid: string, solved: boolean, skipped = false, endAt = now()) {
  const a = getState().cp.active; if (!a || !a.spec) return
  // the time-box clock doesn't run during a break
  const t0 = a.curAt || a.servedAt || a.startedAt, t1 = Math.min(endAt, now()), mins = Math.max(0, (t1 - t0 - breakIn(a, t0, t1)) / 60000), T = timeboxOf(pid)
  const hint = hintIn(pid, a.id)
  const outcome = !solved ? (skipped ? 'skip' : 'fail') : hint >= 2 ? 'hinted' : mins <= 0.5 * T ? 'fast' : 'ok'
  const inResolve = !!getState().cp.resolve[pid]
  if (solved) {
    record(pid, 'solved', 'practice', Math.round(mins * 60))
    if (hint >= 2) enqueueResolve(pid)
    if (inResolve) resolveOutcome(pid, hint === 0 && mins <= 0.5 * T)
  } else {
    if (!skipped) record(pid, 'failed', 'practice')
    if (inResolve) resolveOutcome(pid, false); else enqueueResolve(pid)
  }
  setCp(c => c.active ? { ...c, active: { ...c.active, band: stepBand(c.active.spec!, c.active.band ?? bandStart(c.active.spec!), outcome), cur: null, skipped: skipped ? [...(c.active.skipped || []), pid] : c.active.skipped }, activeU: now() } : c)
  if (now() < activeEnd(a)) serveNext()
}
export function skipCurrent() {
  const a = getState().cp.active, pid = a?.cur; if (!pid) return
  logEvent({ id: `k:${pid}:${a!.id}`, pid, k: 'skip', at: now(), sess: a!.id })
  onSessionResult(pid, false, true)
}

/* ───────── detection loop ───────── */
let lastRetry = 0, closing: string | null = null
/** a real round that runs out: pull the last submissions first, and wait (≤ 3 min) for any still being judged, before booking it */
function closeRealRound(t: CpTest) {
  if (closing === t.id) return
  closing = t.id
  void detect(true).catch(() => {}).then(() => {
    closing = null
    const x = activeTest(); if (!x || x.id !== t.id || now() < testEnd(x)) return
    if (hasPendingIn(x.real!.contestId) && now() < testEnd(x) + 3 * 60000) { window.setTimeout(checkExpiry, 15000); return }
    finishTest()
  })
}
export function checkExpiry() {
  tickBreaks()
  const t = activeTest(), a = getState().cp.active
  if (t && now() >= testEnd(t)) t.real ? closeRealRound(t) : finishTest()
  if (a && now() >= activeEnd(a)) finishActive('time')
  // time-box: a practice problem open for 3× its time (deep: 2×) is a fail — move on (break time doesn't count; never during a break)
  if (a?.kind === 'practice' && a.cur && getState().cp.active?.id === a.id && !openBreak(a)) {
    const T = timeboxOf(a.cur), since = a.curAt || a.servedAt || a.startedAt
    if (now() - since - breakIn(a, since, now()) > failAfter(a.spec?.mode, T) * 60000) {
      const ok = getCfUser()?.list?.find(x => x.pid === a.cur && x.v === 'OK' && x.at >= since - 60000)
      if (ok) onSessionResult(a.cur, true, false, ok.at) // it was solved — the AC just hadn't been seen yet
      else { toast(`Time-box over on ${a.cur} — counted as a fail, it will come back as a re-solve`, 'timer_off'); onSessionResult(a.cur, false) }
    }
  }
  // the picker came up empty earlier: try again (at most once a minute)
  if (a?.kind === 'practice' && !a.cur && getState().cp.active?.id === a.id && now() < activeEnd(a) && now() - lastRetry > 60000) { lastRetry = now(); serveNext() }
}
export async function detect(pull = false) {
  const h = getState().cp.handle
  if (pull && h) await refreshUser(h)
  const k = dateKey()
  for (const t of Object.values(getState().cp.tests)) if (t.finishedAt && t.date >= addDays(k, -1)) {
    for (const pid of Object.keys(t.solved)) if (getState().cp.attempts[pid]?.status !== 'solved') record(pid, 'solved', 'test', t.solved[pid], t.startedAt + t.solved[pid] * 1000)
  }
  const u = h ? getCfUser() : null
  if (!u) { checkExpiry(); return }
  // rated rounds you took become contest records first, so their submissions are booked to them (not as free solves)
  if (sameHandle(u.handle, h!)) syncContestRecords(u.list || [])
  syncSubEvents()
  const cp = getState().cp
  const t = activeTest()
  if (t?.real) syncRealRound(t, u.list || [])
  else if (t) {
    const solved = { ...t.solved }
    for (const pid of t.pids) { const x = u.subs[pid]; if (x?.ok && x.okAt && x.okAt >= t.startedAt - 60000 && solved[pid] === undefined) solved[pid] = Math.round((x.okAt - t.startedAt) / 1000) }
    if (Object.keys(solved).length !== Object.keys(t.solved).length) {
      const fresh = Object.keys(solved).filter(p => t.solved[p] === undefined)
      setCp(c => ({ ...c, tests: { ...c.tests, [t.id]: { ...c.tests[t.id], solved } } }))
      fresh.forEach(p => toast(`Accepted: ${p} (${Math.round(solved[p] / 60)} min in)`, 'check_circle'))
    }
  }
  const a = cp.active
  if (a) {
    for (const pid of a.pids) {
      const x = u.subs[pid]
      if (!x?.ok || !x.okAt || x.okAt < a.startedAt - 60000 || getState().cp.attempts[pid]?.status === 'solved') continue
      if (a.kind === 'practice' && getState().cp.active?.cur === pid) onSessionResult(pid, true, false, x.okAt)
      else record(pid, 'solved', a.kind === 'drill' ? 'drill' : 'practice', Math.round((x.okAt - a.startedAt - breakIn(a, a.startedAt, x.okAt)) / 1000))
    }
    if (a.kind === 'drill' && a.pids.every(p => getState().cp.attempts[p]?.status === 'solved')) finishActive('cleared')
  }
  // free solve: every problem you get Accepted during the session counts (and pays), whatever it is
  const fa = getState().cp.active
  if (fa?.kind === 'practice' && fa.spec?.mode === 'free') {
    // a rated round's accepts belong to its contest record, a virtual round's to the mock — never to free practice
    const got = (u.list || []).filter(x => x.v === 'OK' && x.at >= fa.startedAt - 60000 && x.pt !== 'VIRTUAL' && x.pt !== 'CONTESTANT' && getState().cp.attempts[x.pid]?.status !== 'solved')
    const fresh = [...new Set(got.map(x => x.pid))]
    if (fresh.length) {
      setCp(c => c.active?.id === fa.id ? { ...c, active: { ...c.active, pids: [...new Set([...c.active.pids, ...fresh])] }, activeU: now() } : c)
      for (const pid of fresh) { const x = got.find(y => y.pid === pid)!; record(pid, 'solved', 'practice', Math.round((x.at - fa.startedAt - breakIn(fa, fa.startedAt, x.at)) / 1000), x.at) }
    }
  }
  // solving on your own, outside any session, earns the same XP: any NEW accept today (history from before you linked never pays)
  {
    const c0 = getState().cp, since = Math.max(keyToDate(k).getTime(), c0.handleU || 0)
    const own = (u.list || []).filter(x => x.v === 'OK' && x.at >= since && x.pt !== 'VIRTUAL' && x.pt !== 'CONTESTANT' && !c0.attempts[x.pid] && !c0.active?.pids.includes(x.pid) && !Object.values(c0.tests).some(t => !t.finishedAt && t.pids.includes(x.pid)))
    for (const pid of [...new Set(own.map(x => x.pid))]) { const x = own.find(y => y.pid === pid)!; record(pid, 'solved', 'free', undefined, x.at) }
  }
  // a practice problem solved outside any session still counts (and pays only if solved today)
  // re-solves done outside a session: a NEW accepted submission after it was queued counts
  for (const [pid, r] of Object.entries(cp.resolve)) {
    if (r.wins >= 2 || r.due > k) continue
    const ac = u.list?.find(x => x.pid === pid && x.v === 'OK' && x.at > r.u)
    if (!ac) continue
    if (cp.attempts[pid]?.status !== 'solved') record(pid, 'solved', 'practice', undefined, ac.at, ac.at >= keyToDate(k).getTime())
    if (!cp.active?.pids.includes(pid)) resolveOutcome(pid, hintIn(pid) < 2)
  }
  snapshotToday()
  checkExpiry()
}
let lastSnap = 0
function snapshotToday() {
  if (now() - lastSnap < 10 * 60000) return
  lastSnap = now()
  const sk = skillNow(), u = getCfUser(), k = dateKey()
  const topics: Record<string, number> = {}
  for (const t of sk.tags) if (t.n) topics[t.tag] = t.theta
  setCp(c => ({ ...c, daily: { ...c.daily, [k]: { level: sk.level, internal: internalRating(u), cf: u?.rating || 0, topics, u: now() } } }))
}

/* ───────── mock round: 6 problems, 2 hours, syllabus only ───────── */
/** when a mock ends: real rounds run from the virtual start on CF (30 min grace to start it), synthetic ones from the app's start */
export const testEnd = (t: CpTest) => t.real ? (t.real.vStart ? t.real.vStart + t.dur * 60000 : t.startedAt + (t.dur + 30) * 60000) : t.startedAt + t.dur * 60000
/** today's rated round, if the student took one (a contest record / CONTESTANT submissions today) or is taking one later today */
export function ratedRoundToday(k = dateKey()): { cid: number; name: string; took: boolean } | null {
  const cp = getState().cp
  const rec = Object.values(cp.tests).find(t => t.date === k && isContestRec(t) && !isVoidTest(t, cp))
  if (rec?.real) return { cid: rec.real.contestId, name: rec.real.name, took: true }
  const sub = (getCfUser()?.list || []).find(x => x.pt === 'CONTESTANT' && dateKey(new Date(x.at)) === k)
  if (sub) return { cid: sub.cid, name: contestInfo(sub.cid)?.name || `Codeforces round ${sub.cid}`, took: true }
  const c = getContests().find(c => dateKey(new Date(c.start)) === k && isTakingNow(c.id))
  return c ? { cid: c.id, name: c.name, took: false } : null
}
/** today's mock choice: a real past round when one fits (the finished-contest list has loaded), else the syllabus mock.
 *  offer = false: no mock today (the season has none, or a rated round is today's mock) */
export function mockChoice(sk: Skill = skillNow()) {
  const cp = getState().cp, k = dateKey(), plan = cp.plans[k], tg = targetFor(k), rated = ratedRoundToday(k)
  const pick = pickRealRound(sk, cp, undefined, { level: plan?.level, offset: plan?.mockOffset })
  const offer = tg.mock && !rated
  const why = rated ? 'Rated round today — it counts as your mock'
    : !tg.mock ? `${tg.kind === 'exam' ? 'Exam season' : 'This season'}: no mock today${tg.season?.note ? ` · ${tg.season.note}` : ''}`
    : !pick ? 'No unseen past round fits your level yet — syllabus mock today'
    : 'A real round gives your exact rank and rating delta'
  return { kind: pick ? 'real' as const : 'syllabus' as const, pick, why, offer, rated }
}
/** no mock today (the season has none, or a rated round is today's mock): every way in (Train, Today's play button on a leftover
 *  mock block, the coach's "mock" action) stops here with the reason — a 2 h mock started after the rated round on 11-21 sat there
 *  unopened all night and became failures + upsolve debt */
function mockGated(k: string) {
  const tg = targetFor(k), rated = ratedRoundToday(k)
  if (tg.mock && !rated) return false
  toast(rated ? `${rated.name}: the rated round is today's mock` : `${tg.kind === 'exam' ? 'Exam season' : 'This season'}: no mock today`, 'event_busy')
  return true
}
/** a mock's id: the date, unless that one was voided (a discarded mock never blocks a fresh one) */
const mockId = (k: string) => { const ts = getState().cp.tests; return !ts[k] ? k : `${k}~${now().toString(36)}` }
const takenToday = (k: string) => { const cp = getState().cp; return Object.values(cp.tests).some(t => t.date === k && !isVoidTest(t, cp)) }
type BlockTest = CpTest & { blockId?: string }
/** start today's mock as a real past round: the virtual participation itself runs on codeforces.com */
export function startRealRound(pick: RealPick, blockId?: string) {
  const k = dateKey(), cp = getState().cp
  if (activeTest() || mockGated(k)) return
  if (cp.active) { toast(`Finish your ${cp.active.kind} first`, 'timer'); return }
  if (takenToday(k)) { toast("You've already taken today's mock round", 'info'); return }
  const t0 = now(), id = mockId(k), blk = blockId ?? mockBlock(k, t0)?.id
  setCp(c => ({ ...c, tests: { ...c.tests, [id]: { id, date: k, pids: pick.pids, startedAt: t0, dur: pick.dur, solved: {}, h: c.handle || undefined,
    real: { contestId: pick.contestId, name: pick.name, rule: pick.rule, probs: {} }, ...(blk ? { blockId: blk } : {}) } as BlockTest } }))
  logSpan('mock', `CF virtual · ${pick.name}`, t0, blk)
  try { window.open(virtualUrl(pick.contestId), '_blank') } catch { /* popup blocked: the session shows the link */ }
  toast('Start the virtual participation on Codeforces — submissions there are tracked here', 'open_in_new')
  void contestData(pick.contestId)
}
/** standings + rating changes of a real round, cached for live scoring */
const cdCache = new Map<number, ContestData>(), cdTried = new Map<number, number>()
async function contestData(cid: number) {
  if (cdCache.get(cid)) return cdCache.get(cid)!
  cdTried.set(cid, now())
  const cd = await loadContestData(cid).catch(() => null)
  if (cd) cdCache.set(cid, cd) // a failure isn't cached: syncRealRound retries it (at most every 2 min)
  return cd
}
export const cachedContestData = (cid: number) => cdCache.get(cid) || null
/** pull the virtual participation's per-problem facts from CF submissions into the test */
function syncRealRound(t: CpTest, list: CfSub[]) {
  const r = t.real!, { vStart, probs } = virtualProbs(list, r.contestId, t.startedAt - 4 * 36e5)
  if (!cdCache.get(r.contestId) && now() - (cdTried.get(r.contestId) || 0) > 2 * 60000) void contestData(r.contestId) // retry a failed load
  if (!vStart) return
  const cid = String(r.contestId), solved: Record<string, number> = {}
  for (const [ix, x] of Object.entries(probs)) if (x.at !== undefined && t.pids.includes(cid + ix)) solved[cid + ix] = x.at
  const same = r.vStart === vStart && JSON.stringify(r.probs) === JSON.stringify(probs)
  if (same) return
  const fresh = Object.keys(solved).filter(p => t.solved[p] === undefined)
  setCp(c => { const x = c.tests[t.id]; return x?.real ? { ...c, tests: { ...c.tests, [t.id]: { ...x, solved: x.real.vStart && x.real.vStart !== vStart ? solved : { ...x.solved, ...solved }, real: { ...x.real, vStart, probs } } } } : c })
  if (!r.vStart) toast('Virtual participation detected — the clock now follows Codeforces', 'sync')
  fresh.forEach(p => toast(`Accepted: ${p.slice(cid.length)} (${Math.round(solved[p] / 60)} min in)`, 'check_circle'))
}
/* ───────── rated rounds you took → contest records (synced, once per round) ─────────
 * Built from your CONTESTANT submissions once the round is over: per-problem solve times (relativeTimeSeconds) and rejections,
 * like a virtual round's record, marked real.live. It ticks the round's schedule block, counts as the day's mock (as discipline's
 * CONTESTANT check does), and its unsolved problems within reach join the upsolve queue. perf only from the real standings. */
type LiveRound = RealRound & { live?: boolean }
const LIVE_DAYS = 14, SETTLE = 3 * 864e5
export function syncContestRecords(list: CfSub[]) {
  const t0 = now(), byC = new Map<number, CfSub[]>()
  for (const x of list) if (x.pt === 'CONTESTANT' && t0 - x.at < LIVE_DAYS * 864e5) (byC.get(x.cid) || byC.set(x.cid, []).get(x.cid)!).push(x)
  for (const [cid, subs] of byC) {
    const cp = getState().cp, id = 'contest:' + cid, old = cp.tests[id]
    if (old?.finishedAt && t0 - old.finishedAt > SETTLE) { maybeScore(old); continue } // settled: verdicts and problems won't change
    const info = contestInfo(cid), x0 = subs[0]
    const start = info?.start ?? x0.vs ?? (x0.rel !== null ? x0.at - x0.rel * 1000 : x0.at)
    const dur = info ? Math.round(info.dur / 60) : Math.max(120, ...subs.map(x => Math.ceil((x.rel ?? 0) / 60)))
    if (t0 < start + dur * 60000) continue // still running: the live overlay has it
    const { probs } = virtualProbs(list, cid, start - 36e5, 'CONTESTANT'), c = String(cid)
    // the round's problems when the problemset has them (new rounds get ratings days later), plus whatever you submitted
    const ix = (pid: string) => pid.slice(c.length)
    const pids = [...new Set([...contestProblems(cid).map(p => p.id), ...subs.map(x => x.pid)])].sort((a, b) => ix(a) < ix(b) ? -1 : ix(a) > ix(b) ? 1 : 0)
    const solved: Record<string, number> = {}
    for (const pid of pids) { const at = probs[ix(pid)]?.at; if (at !== undefined) solved[pid] = at }
    if (old) {
      if (old.pids.join() === pids.join() && JSON.stringify(old.real?.probs) === JSON.stringify(probs)) { maybeScore(old); continue }
      // verdicts settle after system tests / problems arrive: refresh the facts, keep the results
      setCp(c2 => { const x = c2.tests[id]; return x?.real ? { ...c2, tests: { ...c2.tests, [id]: { ...x, pids, solved, real: { ...x.real, probs } } } } : c2 })
      continue
    }
    const row = getCfUser()?.rated?.find(r => r.cid === cid)
    const name = info?.name || row?.name || `Codeforces round ${cid}`, end = start + dur * 60000
    const rec: CpTest = { id, date: dateKey(new Date(start)), pids, startedAt: start, dur, finishedAt: end, solved, h: getState().cp.handle || undefined,
      real: { contestId: cid, name, rule: info?.type === 'ICPC' ? 'icpc' : 'cf', vStart: start, probs, live: true } as LiveRound }
    setCp(c2 => c2.tests[id] ? c2 : { ...c2, tests: { ...c2.tests, [id]: rec } })
    for (const pid of pids) {
      const at = solved[pid]
      if (at !== undefined) record(pid, 'solved', 'test', at, start + at * 1000)
      else if (probs[ix(pid)]?.wa) record(pid, 'failed', 'test', undefined, end) // tried and missed; untouched ones aren't evidence
    }
    tickContestBlock(rec)
    toast(`Rated round booked: ${name} — ${Object.keys(solved).length} solved`, 'emoji_events')
    maybeScore(getState().cp.tests[id])
  }
}
/** the round's schedule block ("CF: <name>", or a mock-type block on its start) gets ticked with the round's real window —
 *  only when it's not done yet; a block the live overlay already logged keeps that log */
function tickContestBlock(t: CpTest) {
  const r = t.real!, day = getState().days[t.date]; if (!day) return
  const c: CfContest = { id: r.contestId, name: r.name, start: t.startedAt, dur: t.dur * 60, type: '' }
  const blk = day.tasks.find(x => !x.done && contestFor(x, [c], keyToDate(t.date))?.id === r.contestId)
  if (!blk) return
  if (taskMinutes(day, blk.id)) completeTask(blk.id, undefined, undefined, t.date)
  else completeTask(blk.id, undefined, { start: t.startedAt, end: t.finishedAt! }, t.date)
}
const scoreTried = new Map<string, number>()
/** perf / rank for a contest record from the real standings (yourself taken out), at most every 10 min until it lands */
function maybeScore(t: CpTest | undefined) {
  if (!t || t.perf !== undefined || now() - (scoreTried.get(t.id) || 0) < 10 * 60000) return
  scoreTried.set(t.id, now()); void scoreContestRec(t.id).catch(() => {})
}
export async function scoreContestRec(id: string, force = false): Promise<boolean> {
  const t = getState().cp.tests[id], u = getCfUser()
  if (!t?.real || !isContestRec(t) || !u || (t.perf !== undefined && !force)) return false
  const cid = t.real.contestId, cd = cdCache.get(cid) || await loadContestData(cid).catch(() => null)
  if (!cd) return false // standings / rating changes not out yet: perf stays undefined, never guessed
  cdCache.set(cid, cd)
  const row = u.rated?.find(r => r.cid === cid)
  const pl = placeInto(without(cd, u.handle), row?.old || internalRating(u) || 1400, t.real.probs)
  if (!pl) return false
  setCp(c => { const x = c.tests[id]; return x?.real ? { ...c, tests: { ...c.tests, [id]: { ...x, perf: pl.perf, real: { ...x.real, rank: pl.rank, of: pl.of, perf: pl.perf, points: pl.points, penalty: pl.penalty, delta: row ? row.new - row.old : pl.delta } } } } : c })
  return true
}
/** real-round score under its own rules (CF points or ICPC solved + penalty); approximate until standings load */
export function realScore(t: CpTest): { points: number; penalty: number } {
  const r = t.real; if (!r) return { points: 0, penalty: 0 }
  const cd = cdCache.get(r.contestId)
  if (cd) return scoreFor(cd, r.probs)
  let points = 0, penalty = 0
  t.pids.forEach((pid, i) => {
    const x = r.probs[pid.slice(String(r.contestId).length)]; if (x?.at === undefined) return
    if (r.rule === 'icpc') { points++; penalty += Math.floor(x.at / 60) + 10 * x.wa }
    else { const P = 500 * (i + 1); points += Math.max(0.3 * P, P - (P / 250) * (x.at / 60) - 50 * x.wa) }
  })
  return { points: Math.round(points), penalty }
}
/** blockId: the schedule block the student pressed play on (its time goes there); else the open mock block nearest in time */
export function startTest(blockId?: string) {
  const k = dateKey(), cp = getState().cp, plan = cp.plans[k]
  if (!plan?.test.length || activeTest() || mockGated(k)) return
  if (cp.active) { toast(`Finish your ${cp.active.kind} first`, 'timer'); return }
  if (takenToday(k)) { toast("You've already taken today's mock round", 'info'); return }
  const t0 = now(), id = mockId(k), dur = targetFor(k).mockMin || NORMAL_MOCK, blk = blockId ?? mockBlock(k, t0)?.id
  setCp(c => ({ ...c, tests: { ...c.tests, [id]: { id, date: k, pids: plan.test, startedAt: t0, dur, solved: {}, h: c.handle || undefined, ...(blk ? { blockId: blk } : {}) } as BlockTest } }))
  logSpan('mock', 'Mock round', t0, blk)
  toast(`Mock round started — ${dur % 60 ? dur + ' min' : dur / 60 + (dur === 60 ? ' hour' : ' hours')}. Accepted submissions are picked up automatically.`, 'timer')
}
/* ───────── mock guards: a mock nobody worked on is no evidence ───────── */
/** problems of a mock you actually looked at: opened from the app, or submitted on CF, during its window */
export function touchedIn(t: CpTest): Set<string> {
  const end = t.finishedAt ?? testEnd(t), s = new Set<string>()
  for (const e of Object.values(getState().cp.events)) if ((e.k === 'open' || e.k === 'sub') && t.pids.includes(e.pid) && (e.sess === t.id || (e.at >= t.startedAt && e.at <= end))) s.add(e.pid)
  for (const x of getCfUser()?.list || []) if (t.pids.includes(x.pid) && x.at >= t.startedAt && x.at <= end) s.add(x.pid)
  return s
}
/** minutes a mock ran on its own clock (finished early: up to then; expired: its full length) */
const mockMins = (t: CpTest, end = t.finishedAt ?? now()) => Math.max(0, Math.min(t.dur, (end - t.startedAt) / 60000))
/** the void rule: a syllabus mock with nothing solved and either under 10 minutes or not one problem opened / submitted */
export function voidable(t: CpTest, end = t.finishedAt ?? now()) {
  return !t.real && !Object.keys(t.solved).length && (mockMins(t, end) < 10 || !touchedIn(t).size)
}
const markVoid = (id: string) => setCp(c => c.triggers['void:' + id] ? c : { ...c, triggers: { ...c.triggers, ['void:' + id]: now() } })
/** one-off, idempotent (and re-run on every device — the mark syncs through cp.triggers): finished syllabus mocks that the void
 *  rule catches (e.g. one started by accident right after a rated round, then left to expire overnight) stop counting */
export function voidPhantomMocks() {
  const cp = getState().cp, hit = Object.values(cp.tests).filter(t => t.finishedAt && !isVoidTest(t, cp) && voidable(t))
  for (const t of hit) markVoid(t.id)
  return hit.map(t => t.id)
}
/** throw the running mock away: no perf, no failures, no upsolve debt, no time booked — and today's mock is open again */
export function discardMock() {
  const t = activeTest(); if (!t) return
  const endAt = now()
  markVoid(t.id)
  setCp(c => ({ ...c, tests: { ...c.tests, [t.id]: { ...c.tests[t.id], finishedAt: endAt } } }))
  const sp = sessSpan('mock', t.startedAt); if (sp) deleteSpan(sp.id, true)
  toast('Mock discarded — it does not count', 'delete')
}
export function markTestSolved(pid: string) {
  const t = activeTest(); if (!t || t.solved[pid] !== undefined) return
  logEvent({ id: `a:${pid}:${t.id}`, pid, k: 'ac', at: now(), sess: t.id })
  setCp(c => ({ ...c, tests: { ...c.tests, [t.id]: { ...t, solved: { ...t.solved, [pid]: Math.round((now() - t.startedAt) / 1000) } } } }))
}
/** CF-style score: points decay with time, each rejected try costs 50 */
export function mockScore(t: CpTest) {
  if (t.real) return realScore(t).points
  const evs = Object.values(getState().cp.events).filter(e => e.sess === t.id && e.k === 'sub')
  return t.pids.reduce((sum, pid, i) => {
    const P = 500 * (i + 1), s = t.solved[pid]
    if (s === undefined) return sum
    const wrong = evs.filter(e => e.pid === pid && e.v !== 'OK' && e.v !== 'COMPILATION_ERROR' && e.at < t.startedAt + s * 1000).length
    return sum + Math.max(0.3 * P, P - (P / 250) * (s / 60) - 50 * wrong)
  }, 0)
}
/* ───────── the work log: every session/round is one real span (start → end) ───────── */
/** the open mock block of a day nearest in time to `at` (untimed blocks last) — never a block that is a rated round: a list-order
 *  pick once booked the morning mock onto the evening contest block */
export function mockBlock(k: string, at: number): Task | undefined {
  const day = keyToDate(k), rounds: CfContest[] = [...getContests(), ...getPastContests().filter(c => dateKey(new Date(c.start)) === k)]
  const m = (at - day.getTime()) / 60000
  return (getState().days[k]?.tasks || []).filter(t => t.k === 'cp_mock' && !t.done && !contestFor(t, rounds, day))
    .sort((a, b) => (a.start ? Math.abs(toMin(a.start) - m) : 1e6) - (b.start ? Math.abs(toMin(b.start) - m) : 1e6))[0]
}
/** start logging a session; it's tied to the block it was started from (the one completePlanned will complete) */
function logSpan(src: 'cp' | 'mock', title: string, startedAt: number, blockId?: string) {
  startSpan({ taskId: blockId, title, cat: 'deep', src }, spanKey(src, startedAt))
}
/** a session's span id comes from the session, so a session finished on two devices before they synced is one record */
const spanKey = (src: 'cp' | 'mock', startedAt: number) => `sp:${src}:${startedAt.toString(36)}`
const sessSpan = (src: 'cp' | 'mock', startedAt: number) => { const d = getState().days[dateKey(new Date(startedAt))], sp = d?.spans?.[spanKey(src, startedAt)]
  return sp ? (sp.del ? undefined : sp) : liveSpans(d).find(s => s.src === src && Math.abs(s.start - startedAt) < 5000) }
/** close a session's span at its real end (capped by the session's own clock). The session is the truth, not the heartbeat:
 *  you solve on codeforces.com while this app sits in the background. Under a minute is noise and is dropped.
 *  `title` is only used when no span exists (a session started before logging existed) and one is added. */
function endSpan(src: 'cp' | 'mock', startedAt: number, end: number, title: string, from?: number) {
  const sp = sessSpan(src, startedAt), start = Math.max(startedAt, from || 0)
  if (!sp) return end - start >= 60000 && !getState().days[dateKey(new Date(startedAt))]?.spans?.[spanKey(src, startedAt)] ? addSpan({ title, cat: 'deep', start, end, src }, spanKey(src, startedAt)) : undefined
  const e = sp.end === null ? end : Math.min(sp.end, end) // ended early (another timer took over): keep that
  if (e - start < 60000) { deleteSpan(sp.id, true); return undefined }
  editSpan(sp.id, { start: Math.max(sp.start, start), end: e })
  return sp.id
}
/** the id of the remainder block a session finished only part of (the sync keeps it on that session's spec) */
const restId = (key: string, date: string) => `you:rest-${key.replace(/[^A-Za-z0-9-]+/g, '-')}:${date}`
/** tie a span to a task (editSpan's typed patch covers start/end/title/cat; the store applies any field) */
const tieSpan = (id: string, taskId: string) => editSpan(id, { taskId } as Partial<Span>)
/** finishing a block: completes the matching planned CP block in Today instead of adding a duplicate task.
 *  The block's XP and work time come from the session's span (its real minutes), never the planned length. */
function completePlanned(kind: 'cp_practice' | 'cp_mock', title: string, mins: number, key: string, span: string | string[] | undefined, startedAt: number, blockId?: string) {
  // a session with breaks has one work span per stretch between them (break spans are never tied to a task)
  const spans = span === undefined ? [] : Array.isArray(span) ? span : [span]
  // a mock books its time on the day it started (one that ran past midnight completes that day's block); practice: only a block
  // of the day the session started on (one that began last night doesn't complete today's block)
  const sd = dateKey(new Date(startedAt)), mock = kind === 'cp_mock', sameDay = mock || sd === dateKey(), dk = mock ? sd : dateKey()
  // a session started from a block completes THAT block (gone: logged as unplanned work; already done on another device: its log just joins it)
  const blk = blockId ? getState().days[dk]?.tasks.find(t => t.id === blockId) : undefined
  if (blk?.done && sameDay) { for (const id of spans) tieSpan(id, blk.id); return }
  // practice without a block (none fitted when it started): unplanned time, never the first open (maybe differently typed) block
  const planned = !sameDay ? undefined : blockId ? blk : mock ? mockBlock(dk, startedAt) : undefined
  if (mock && planned) { for (const id of spans) tieSpan(id, planned.id); completeTask(planned.id, undefined, undefined, dk); return }
  if (planned) {
    for (const id of spans) tieSpan(id, planned.id)
    // a long (e.g. merged 4.5h) practice block: a session well short of it finishes only its share — the rest stays planned
    const did = Math.max(5, Math.round(taskMinutes(getState().days[dateKey()], planned.id) ?? mins)), rest = planned.dur - did
    if (kind === 'cp_practice' && rest > Math.max(30, planned.dur * 0.25)) {
      const date = dateKey(), at = planned.start ? fmtMin(Math.min(24 * 60 - 5, Math.max(Math.floor(nowMin()), toMin(planned.start) + did))) : null
      editItem(date, planned.id, { dur: did })
      const cp = planned.cp ? { ...planned.cp } : undefined; if (cp) delete cp.auto
      addItem(date, { title: planned.title, start: at, dur: rest, cat: planned.cat, k: 'cp_practice', cp }, restId(key, date))
    }
    completeTask(planned.id); return
  }
  // unplanned: a done task whose log is the span (workMin counts the span once, the task has a log so its length isn't added)
  for (const id of spans) tieSpan(id, 'w:' + key)
  logWork(title, mins, 'deep', undefined, key)
}
export function finishTest() {
  const t = activeTest(); if (!t) return
  if (t.real) { finishRealRound(t); return }
  const ratings = t.pids.map(p => getProb(p)?.r || 1200), k = Object.keys(t.solved).length
  const endAt = now(), mins = mockMins(t, endAt), touched = touchedIn(t)
  // void: nothing solved and under 10 min / nothing opened — no perf, no failures, no upsolve debt, not in the skill model
  const isVoid = voidable(t, endAt)
  // void is about evidence only: the time on its clock is still logged like any mock (only Discard throws the time away)
  const perf = isVoid ? undefined : performance(ratings, k)
  if (isVoid) markVoid(t.id)
  setCp(c => ({
    ...c, tests: { ...c.tests, [t.id]: { ...c.tests[t.id], finishedAt: endAt, ...(perf !== undefined ? { perf } : {}) } },
    sessions: { ...c.sessions, ['mock:' + t.id]: { id: 'mock:' + t.id, kind: 'mock', date: t.date, startedAt: t.startedAt, endedAt: endAt, mins: Math.round(mins), pids: t.pids, solved: Object.keys(t.solved), h: c.handle || undefined } },
  }))
  // only problems you actually opened or submitted are misses
  for (const pid of t.pids) {
    if (t.solved[pid] !== undefined) record(pid, 'solved', 'test', t.solved[pid])
    else if (!isVoid && touched.has(pid)) record(pid, 'failed', 'test')
  }
  if (isVoid) toast(`Mock voided — ${mins < 10 ? 'under 10 minutes' : 'no problem was opened'}, it does not count`, 'block')
  const sp = endSpan('mock', t.startedAt, t.startedAt + mins * 60000, 'Mock round')
  // a voided mock never ticks a mock block (that read as "mock done" in Today and in discipline): its time stays in the work
  // log as an untied span, and the block stays open for a real mock
  if (isVoid) { if (sp) tieSpan(sp, ''); return }
  if (mins >= 5) completePlanned('cp_mock', `CF mock round — ${k}/${t.pids.length} solved · perf ${perf}`, mins, 'test:' + t.id, sp, t.startedAt, (t as BlockTest).blockId)
  if (k > 0 || mins >= 60) cpBonus('test:' + t.id, 30 + 20 * k, `Mock round: performance ${perf}`)
  onSessionEnded?.('mock', mins, 'mock-' + t.id)
}

/** end a real round: book it now (synthetic perf as a placeholder), then re-rank into the real standings for rank / delta / performance */
function finishRealRound(t: CpTest) {
  const r = t.real!, cid = String(r.contestId), endAt = now(), sk = skillNow()
  const solvedPids = t.pids.filter(p => r.probs[p.slice(cid.length)]?.at !== undefined || t.solved[p] !== undefined)
  const started = !!r.vStart
  const k = solvedPids.length
  const head = t.pids.slice(0, Math.max(5, k + 1)).map(p => getProb(p)?.r || 1200)
  const est = started ? performance(head, k) : undefined
  const begin = r.vStart || t.startedAt, mins = Math.max(0, Math.min(t.dur, (endAt - begin) / 60000))
  setCp(c => ({
    ...c, tests: { ...c.tests, [t.id]: { ...c.tests[t.id], finishedAt: endAt, ...(est !== undefined ? { perf: est } : {}) } },
    sessions: started ? { ...c.sessions, ['mock:' + t.id]: { id: 'mock:' + t.id, kind: 'mock', date: t.date, startedAt: begin, endedAt: endAt, mins: Math.round(mins), pids: t.pids, solved: solvedPids, h: c.handle || undefined } } : c.sessions,
  }))
  // the time on codeforces counts from the virtual start; a round never started on CF logs nothing
  if (!started) { markVoid(t.id); const sp = sessSpan('mock', t.startedAt); if (sp) deleteSpan(sp.id, true); toast('No virtual submissions found for this round — nothing scored', 'info'); return }
  const sp = endSpan('mock', t.startedAt, begin + mins * 60000, `CF virtual · ${r.name}`, begin), touched = touchedIn(t)
  for (const pid of t.pids) {
    const x = r.probs[pid.slice(cid.length)], p = getProb(pid)
    if (x?.at !== undefined) record(pid, 'solved', 'test', x.at, begin + x.at * 1000)
    // only problems you actually opened or submitted count as misses (an untouched one isn't evidence of anything)
    else if ((x && x.wa > 0) || touched.has(pid)) record(pid, 'failed', 'test')
  }
  if (mins >= 5) completePlanned('cp_mock', `CF virtual: ${r.name} — ${k} solved`, mins, 'test:' + t.id, sp, t.startedAt, (t as BlockTest).blockId)
  if (k > 0 || mins >= 60) cpBonus('test:' + t.id, 30 + 20 * k, `Real round: ${k} solved`)
  onSessionEnded?.('mock', mins, 'mock-' + t.id)
  // a linked account rates as CF does (unrated → 0 → 1400 inside virtualResult); calib/level only without one
  const cu = getCfUser(), rating = cu ? internalRating(cu) : getState().cp.calib || sk.level
  void virtualResult(r.contestId, r.probs, rating).then(pl => {
    if (!pl) return
    setCp(c => { const x = c.tests[t.id]; return x?.real ? { ...c, tests: { ...c.tests, [t.id]: { ...x, perf: pl.perf, real: { ...x.real, rank: pl.rank, of: pl.of, delta: pl.delta, perf: pl.perf, points: pl.points, penalty: pl.penalty } } } } : c })
    toast(`Virtual ${r.name}: rank ${pl.rank}/${pl.of} · would-be ${pl.delta >= 0 ? '+' : ''}${pl.delta} · perf ${pl.perf}`, 'emoji_events')
  }).catch(() => { /* placeholder perf stays */ })
}
/** retry the re-rank for a finished real round whose standings weren't available at the time */
export async function rescoreRealRound(id: string) {
  const t = getState().cp.tests[id]; if (!t?.real || !t.finishedAt || !t.real.vStart) return
  if (isContestRec(t)) { if (!await scoreContestRec(id, true)) toast('Standings not available yet — try again later', 'cloud_off'); return }
  const cu = getCfUser(), rating = cu ? internalRating(cu) : getState().cp.calib || skillNow().level
  // re-read the run from the submissions now known (verdicts judged after the round ended are included)
  const v = virtualProbs(cu?.list || [], t.real.contestId, t.startedAt - 4 * 36e5), probs = v.vStart ? v.probs : t.real.probs
  const pl = await virtualResult(t.real.contestId, probs, rating).catch(() => null)
  if (!pl) { toast('Standings not available yet — try again later', 'cloud_off'); return }
  setCp(c => { const x = c.tests[id]; return x?.real ? { ...c, tests: { ...c.tests, [id]: { ...x, perf: pl.perf, real: { ...x.real, probs, rank: pl.rank, of: pl.of, delta: pl.delta, perf: pl.perf, points: pl.points, penalty: pl.penalty } } } } : c })
}

/* ───────── single timed drill (kept) ───────── */
export function startDrill(tag?: string) {
  const sk = skillNow(), cp = getState().cp
  if (cp.active || activeTest()) { toast('A session is already running', 'timer'); return }
  const t = tag || weakest(sk, cp.focusTags)[0]?.tag
  const sh = t ? topicShift(sk, t) : 0
  const p = findProblem(sk, cp, { lo: sk.level + sh, hi: sk.level + sh + 200, tag: t, avoid: new Set(Object.keys(cp.attempts)), seed: 'drill' + now() })
  if (!p) { toast('No fresh problem found for that topic at your level', 'search_off'); return }
  const t0 = now()
  // a single drill only books an untyped CP block (never one typed for another session)
  const blockId = blockFor(undefined)
  setCp(c => ({ ...c, active: { id: 'drill:' + t0, kind: 'drill', pids: [p.id], startedAt: t0, dur: timeFor(p.r, sk.level), cur: p.id, ...(blockId ? { blockId } : {}) }, activeU: t0 }))
  logSpan('cp', `CF drill${t ? ' · ' + t : ''}`, t0, blockId)
}
export function finishActive(why: 'cleared' | 'time' | 'quit' = 'quit') {
  if (!getState().cp.active) return
  const endAt = now()
  // breaks up to now first; finishing during a break closes it there (its minutes are a break, never work)
  tickBreaks(endAt, true)
  if (openBreak(getState().cp.active)) endBreak(endAt)
  // whichever device finishes writes the breaks into the log (the device that logged the session may be asleep)
  syncBreakSpans(endAt, true)
  const a = getState().cp.active; if (!a) return
  const solved = a.pids.filter(p => getState().cp.attempts[p]?.status === 'solved')
  if (a.kind === 'drill') for (const p of a.pids) if (!solved.includes(p)) { record(p, 'failed', 'drill'); enqueueResolve(p) }
  const mins = activeMin(a, endAt)
  const brk = Math.round(breakMs(a, endAt) / 60000), brks = (a.breaks || []).filter(b => b.end !== null && b.end - b.start >= 15000).map(b => [b.start, b.end!] as [number, number])
  const sess: CpSession = { id: a.id, kind: a.kind, date: dateKey(new Date(a.startedAt)), startedAt: a.startedAt, endedAt: endAt, mins: Math.round(mins), pids: a.pids, solved, spec: a.spec, h: handle(), specIdx: a.specIdx, ...(a.blockId ? { blockId: a.blockId } : {}), ...(brk ? { brk, brks } : {}) }
  setCp(c => ({ ...c, active: null, activeU: endAt, sessions: mins >= 3 ? { ...c.sessions, [a.id]: sess } : c.sessions }))
  // the span is logged even when the block isn't booked (a quit) — it's time you really spent
  const sp = endCpSpans(a, Math.min(endAt, activeEnd(a, endAt)), a.kind === 'drill' ? 'CF drill' : `CF practice · ${a.spec?.mode || 'adaptive'}`)
  if (mins >= 3) completePlanned('cp_practice', `CF ${a.kind} — ${solved.length}/${a.pids.length} solved`, mins, a.id, sp, a.startedAt, a.blockId)
  if (why === 'cleared') toast(`Cleared with ${Math.round(a.dur - mins)} min to spare`, 'bolt')
  if (a.kind === 'practice' && mins >= 30) onSessionEnded?.('practice', mins, a.id)
}
/* ───────── automatic breaks: CP practice / free solve / drill (never mock rounds, real rounds or live contests — those keep real contest timing) ─────────
 * After `breakEvery` min of work since the start or the last break, the session takes a `breakLen`-min break: the session's clock (and the
 * problem's time-box) stops, the end moves later by the break, and the work log gets a Break span between two work spans. Wall-clock based:
 * a break that ended while the app was asleep resumes work exactly at its end. */
const segKey = (startedAt: number, i: number) => i ? `${spanKey('cp', startedAt)}:w${i}` : spanKey('cp', startedAt)
const brkKey = (startedAt: number, i: number) => `${spanKey('cp', startedAt)}:b${i}`
const spanById = (id: string) => { for (const d of Object.values(getState().days)) { const s = d.spans?.[id]; if (s) return s } return undefined }
/** start a span at `start` (a moment just passed: a break detected late) */
function openAt(o: { taskId?: string; title: string; cat: Span['cat']; src: Span['src'] }, id: string, start: number) {
  // it began on an earlier day (caught up across midnight): it lives on that day from the start, so a later edit never moves it
  // (a move re-ids the span, and the session would lose track of its own log)
  if (dateKey(new Date(start)) !== dateKey()) { stopSpan(); addSpan({ ...o, start, end: start }, id); editSpan(id, { end: null }); return }
  startSpan(o, id)
  if (start < now() - 1000) editSpan(id, { start })
}
/** set by the session screen: sound / haptic cue when a break starts or ends */
let breakCue: ((k: 'start' | 'end') => void) | undefined
export const setBreakCue = (f: typeof breakCue) => { breakCue = f }
function startBreak(at: number, lenMin: number) {
  setCp(c => c.active ? { ...c, active: { ...c.active, breaks: [...(c.active.breaks || []), { start: at, end: null, len: lenMin * 60000 }] }, activeU: now() } : c)
}
/** close the running break at `at` (never past its planned end); skip: as if it never happened (zero length) */
function endBreak(at: number, skip = false) {
  setCp(c => c.active?.breaks?.some(b => b.end === null) ? { ...c, active: { ...c.active, breaks: c.active.breaks.map(b => b.end === null ? { ...b, end: skip ? b.start : Math.max(b.start, Math.min(at, b.start + b.len)) } : b) }, activeU: now() } : c)
}
/** bring the running session's breaks up to `at`: end a break whose time is up, start one that's due. Called every second by the
 *  session screen and by the background loop. */
export function tickBreaks(at = now(), quiet = false) {
  for (let n = 0; n < 40; n++) {
    const a = getState().cp.active; if (!a) return
    const ob = openBreak(a)
    if (ob) {
      const due = ob.start + ob.len; if (at < due) break
      endBreak(due)
      if (!quiet && at - due < 90000) { breakCue?.('end'); toast('Break over — back to it', 'timer') }
      continue
    }
    const { on, every, len } = breakCfg(); if (!on) break
    const bs = a.breaks || [], last = bs[bs.length - 1], due = (last ? last.end! : a.startedAt) + every * 60000
    if (at < due) break
    // no break when only a little work is left (or the session is already over)
    if (a.dur * 60000 - (due - a.startedAt - breakMs(a, due)) <= breakMinLeft(len) * 60000) break
    startBreak(due, len)
    if (!quiet && at - due < 90000) { breakCue?.('start'); toast(`${every} min of work — ${len} min break. Stand up, water, look away.`, 'self_improvement') }
  }
  syncBreakSpans()
}
/** skip the running break (no break logged, the clock carries on) */
export function skipBreak() { if (!openBreak(getState().cp.active)) return; endBreak(now(), true); syncBreakSpans(); breakCue?.('end') }
/** end the running break now (the minutes so far stay a break) */
export function endBreakEarly() { if (!openBreak(getState().cp.active)) return; endBreak(now()); syncBreakSpans(); breakCue?.('end') }
/** make this device's work log match the session's breaks: each break closes the work span before it, is a Break span (no task, never
 *  work), and the next work span starts when it ends. Idempotent (fixed ids from the session, so it also follows breaks synced from
 *  another device). Only the device that logs the session does this, and only while the session still owns its log (another timer
 *  that took over stays untouched). finalAt: the session ends there, so no work span starts after a break ending then. */
function syncBreakSpans(finalAt?: number, anyDev = false) {
  const a = getState().cp.active; if (!a?.breaks?.length) return
  const base = sessSpan('cp', a.startedAt); if (!base || (!anyDev && base.dev !== DEVICE)) return
  const o = { taskId: base.taskId, title: base.title, cat: base.cat, src: 'cp' as const }
  let seg: Span | undefined = base
  for (let i = 0; i < a.breaks.length; i++) {
    const b = a.breaks[i]
    if (!seg || seg.del) return
    if (seg.end === null) editSpan(seg.id, { end: Math.max(seg.start, b.start) })
    else if (seg.end < b.start - 5000) return // another timer took over before this break
    const bid = brkKey(a.startedAt, i), tiny = b.end !== null && b.end - b.start < 15000
    let bsp = spanById(bid)
    if (tiny) { if (bsp && !bsp.del) deleteSpan(bid, true) } // skipped: no break in the log
    else if (!bsp) { if (b.end !== null) addSpan({ title: 'Break', cat: 'break', start: b.start, end: b.end, src: 'cp' }, bid); else openAt({ title: 'Break', cat: 'break', src: 'cp' }, bid, b.start) }
    else if (!bsp.del && bsp.end === null && b.end !== null) editSpan(bid, { end: b.end })
    if (b.end === null) return
    bsp = spanById(bid)
    if (!tiny && bsp && !bsp.del && bsp.end !== null && bsp.end < b.end - 5000) return // a timer took over during the break
    if (finalAt !== undefined && b.end >= finalAt - 1000) return
    const nid = segKey(a.startedAt, i + 1)
    if (!spanById(nid)) {
      if (finalAt === undefined) openAt(o, nid, b.end)
      else { // finishing: the stretch is known, write it closed (up to the next break, or the session's end)
        const e = i + 1 < a.breaks.length ? a.breaks[i + 1].start : Math.min(finalAt, activeEnd(a, finalAt))
        if (e - b.end < 60000) return
        addSpan({ ...o, start: b.end, end: e }, nid)
      }
    }
    seg = spanById(nid)
  }
}
/** close a finishing session's work log at its end: every work stretch between its breaks (returns their ids, to tie to the block) */
function endCpSpans(a: CpActive, end: number, title: string): string[] {
  const n = a.breaks?.length || 0
  if (!n) { const sp = endSpan('cp', a.startedAt, end, title); return sp ? [sp] : [] }
  const ids: string[] = []
  for (let i = 0; i <= n; i++) {
    const sp = i ? spanById(segKey(a.startedAt, i)) : sessSpan('cp', a.startedAt)
    if (!sp || sp.del) continue
    if (sp.end === null) {
      const e = Math.max(sp.start, end)
      if (e - sp.start < 60000) { deleteSpan(sp.id, true); continue }
      editSpan(sp.id, { end: e })
    }
    ids.push(sp.id)
  }
  // a break span left open (logged by another device) closes at its break's end
  a.breaks!.forEach((b, i) => { const bsp = spanById(brkKey(a.startedAt, i)); if (bsp && !bsp.del && bsp.end === null) editSpan(bsp.id, { end: b.end ?? end }) })
  return ids
}

/** set by the coach module: auto-debrief after a block */
let onSessionEnded: ((kind: 'practice' | 'mock', mins: number, id: string) => void) | undefined
export const setOnSessionEnded = (f: typeof onSessionEnded) => { onSessionEnded = f }

/* ───────── background polling ───────── */
let timer: number | undefined, due = Infinity
const HOT = 45000, COLD = 300000
const hot = () => !!activeTest() || !!getState().cp.active
function schedule(ms: number) { window.clearTimeout(timer); due = Date.now() + ms; timer = window.setTimeout(tick, ms) }
function tick() {
  if (document.visibilityState === 'visible') void detect(!!getState().cp.handle).then(() => ensurePlan()) // also rolls over at midnight
  else if (hot()) void detect(!!getState().cp.handle) // pull the last accepts BEFORE a session can expire in the background
  else checkExpiry()
  schedule(hot() ? HOT : COLD)
}
export function startTrainerLoop() {
  void initTrainer().then(() => schedule(HOT))
  onAnyChange(() => { if (hot() && due - Date.now() > HOT) schedule(HOT) })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void detect(!!getState().cp.handle).then(() => ensurePlan())
  })
}

export { settledRating, TAG_SET }
