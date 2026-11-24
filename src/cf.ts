import { learningSubs, nextSubs, practicable, SUB_BY_ID, subProblem, subSkillsMemo } from './curriculum'
import { useSyncExternalStore } from 'react'
import { dateKey, getState, keyToDate, sameHandle, type CpAttempt, type CpPlan, type CpState, type CpTest, type RealRound, type SessSpec, type TopicState } from './store'
import { targetFor } from './season'
import { getLeverage } from './leverage'
import { idbDel, idbGet, idbOk, idbSet } from './idb'

/* ═════════ Codeforces data layer + personal skill model ═════════
   Everything here is deterministic: the same history always yields the same ratings and the same picks. */

export interface Prob { id: string; c: number; i: string; n: string; r: number; t: string[]; s: number }
export interface SubInfo { ok: boolean; first: number; okAt?: number; tries: number }
/** one Codeforces submission with everything the API gives us (kept per device, newest ~4000) */
export interface CfSub { id: number; pid: string; at: number; v: string; tn: number; ms: number; mem: number; rel: number | null; pt: string; lang: string; cid: number; vs?: number }
export interface CfRated { cid: number; name: string; rank: number; old: number; new: number; at: number }
export interface CfUser {
  handle: string; rating: number; maxRating: number; rank: string; fetchedAt: number; subs: Record<string, SubInfo>; lastSubId: number; seen?: number[]
  contests?: number; contestsAt?: number; list?: CfSub[]; rated?: CfRated[]
}
export interface CfContest { id: number; name: string; start: number; dur: number; type: string }
/** Codeforces shows new accounts a deflated rating that climbs through boosts over the first 6 rated contests — ignore it until then */
export const PROVISIONAL_CONTESTS = 6
// count not fetched yet (old cache): trust a nonzero rating rather than assume a brand-new account
export const isProvisional = (u: CfUser | null) => !!u && (u.contests === undefined ? !u.rating : u.contests < PROVISIONAL_CONTESTS)
export const settledRating = (u: CfUser | null) => u && !isProvisional(u) ? u.rating : 0
const BOOSTS = [500, 350, 250, 150, 100, 50]
/** a provisional account's real rating ≈ what CF displays + the boosts it hasn't received yet (CF treats new accounts as 1400) */
// (only new-system accounts, whose first rated round started from 0, get boosts; pre-2020 accounts started at 1500)
export const internalRating = (u: CfUser | null) => !u || !u.rating ? 0 : isProvisional(u) && (!u.rated?.length || u.rated[0].old === 0) ? u.rating + BOOSTS.slice(u.contests ?? 0).reduce((a, b) => a + b, 0) : u.rating

const API = 'https://codeforces.com/api/'
// L_KEY: the submission list (up to 4000 rows) lives apart from the small user record once IndexedDB is in use
const P_KEY = 'momentum.cf.problems', U_KEY = 'momentum.cf.user', L_KEY = 'momentum.cf.userlist'
export const probUrl = (id: string) => { const m = id.match(/^(\d+)(.+)$/)!; return `https://codeforces.com/problemset/problem/${m[1]}/${m[2]}` }

/* ───────── tiny reactive cache ───────── */
let problems: Prob[] = (() => { try { return JSON.parse(localStorage.getItem(P_KEY) || 'null')?.list || [] } catch { return [] } })()
let probAt: number = (() => { try { return JSON.parse(localStorage.getItem(P_KEY) || 'null')?.at || 0 } catch { return 0 } })()
let user: CfUser | null = (() => { try { return JSON.parse(localStorage.getItem(U_KEY) || 'null') } catch { return null } })()
let status: { busy: boolean; err?: string } = { busy: false }
let byId = new Map(problems.map(p => [p.id, p]))
let ver = 0
const subs = new Set<() => void>()
const bump = () => { ver++; subs.forEach(f => f()) }
export const onCf = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const useCf = () => { useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => ver); return { problems, user, status, byId } }
export const getProb = (id: string) => byId.get(id)
export const getCfUser = () => user
export const getProbMap = () => byId
/** forget the linked account's history (unlink) so it stops driving the skill model */
export function clearUser() { user = null; try { localStorage.removeItem(U_KEY) } catch { /* ignore */ } void idbDel(L_KEY); bump() }
export const hasProblems = () => problems.length > 0
/** last Codeforces fetch state (initTrainer retries the network parts when it carries an error) */
export const cfStatus = () => status

/* ───────── persistence: the big caches go to IndexedDB (localStorage is ~5 MB and holds the planner state too) ─────────
   Startup reads localStorage synchronously as before (first run after the update still has the caches there), then
   cacheReady moves them into IndexedDB and drops the localStorage copies. No IndexedDB (node tests): localStorage as before. */
let useIdb = false
export const cacheReady: Promise<void> = (async () => {
  if (!await idbOk()) return
  useIdb = true
  try {
    const lsP = localStorage.getItem(P_KEY)
    if (lsP) { if (!problems.length || await idbSet(P_KEY, { at: probAt, list: problems })) localStorage.removeItem(P_KEY) } // unreadable copy: just drop it
    else {
      const c = await idbGet<{ at: number; list: Prob[] }>(P_KEY)
      // loadProblems may have finished first: never replace a newer list with the cached one
      if (c?.list?.length && c.at > probAt) { problems = c.list; probAt = c.at; byId = new Map(problems.map(p => [p.id, p])) }
    }
    if (user?.list) {
      if (await idbSet(L_KEY, { handle: user.handle, list: user.list })) { const { list: _l, ...small } = user; localStorage.setItem(U_KEY, JSON.stringify(small)) }
    } else if (user) {
      const l = await idbGet<{ handle: string; list: CfSub[] }>(L_KEY)
      if (l?.list && l.handle.toLowerCase() === user.handle.toLowerCase()) user = { ...user, list: l.list }
    }
  } catch { /* storage hiccup: memory still has everything */ }
  bump()
})()
function saveProblems() {
  if (useIdb) { void idbSet(P_KEY, { at: probAt, list: problems }); return }
  try { localStorage.setItem(P_KEY, JSON.stringify({ at: probAt, list: problems })) } catch { /* quota: keep in memory */ }
}
function saveUser(u: CfUser) {
  if (!useIdb) { try { localStorage.setItem(U_KEY, JSON.stringify(u)) } catch { /* ignore */ } return }
  const { list, ...small } = u
  try { localStorage.setItem(U_KEY, JSON.stringify(small)) } catch { /* ignore */ }
  void idbSet(L_KEY, { handle: u.handle, list: list || [] })
}

// Codeforces asks for ≤ 1 request per 2 s; queue every call through one gate.
let gate = Promise.resolve()
export const CF_RETRIES = 3
/** wait before retry n (1-based): 2 s, 4 s, 8 s + up to 1 s jitter, so two devices/tabs don't retry in lockstep */
export const cfBackoff = (n: number) => 2000 * 2 ** (n - 1) + Math.floor(Math.random() * 1000)
export async function call<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
  const run = gate.then(async () => {
    // lang=en: without it Codeforces answers in the browser's language (old rounds come back with Russian names)
    const q = new URLSearchParams(Object.entries({ lang: 'en', ...params }).map(([k, v]) => [k, String(v)]))
    // rate limit (429, or CF's "Call limit exceeded"), 5xx and network errors are transient: retry inside the gate,
    // so the backoff also holds back every queued call. Other failures (bad handle…) throw at once.
    for (let n = 0; ; n++) {
      let r: Response | null = null, j: { status?: string; comment?: string; result?: unknown } | null = null
      try { r = await fetch(`${API}${method}?${q}`, { cache: 'no-store' }); j = await r.json().catch(() => null) } catch { /* network */ }
      if (r && j?.status === 'OK') return j.result as T
      const transient = !r || r.status === 429 || r.status >= 500 || /limit exceeded/i.test(j?.comment || '')
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      if (!transient || offline || n >= CF_RETRIES) throw new Error(j?.comment || (r ? `Codeforces ${r.status}` : 'Codeforces unreachable'))
      await new Promise(res => setTimeout(res, cfBackoff(n + 1)))
    }
  })
  gate = run.then(() => new Promise(r => setTimeout(r, 2100)), () => new Promise(r => setTimeout(r, 2100)))
  return run
}

/* ───────── upcoming contests (calendar, countdowns, coach briefs) ───────── */
const C_KEY = 'momentum.cf.contests'
let contests: CfContest[] = (() => { try { return JSON.parse(localStorage.getItem(C_KEY) || 'null')?.list || [] } catch { return [] } })()
let contestsAt: number = (() => { try { return JSON.parse(localStorage.getItem(C_KEY) || 'null')?.at || 0 } catch { return 0 } })()
export const getContests = () => contests.filter(c => c.start + c.dur * 1000 > Date.now())
/** any round we know of by id: the upcoming list keeps a round until the next refetch, the finished list has the rest */
export const contestInfo = (id: number): CfContest | undefined => contests.find(c => c.id === id) || pastById.get(id)
export async function loadContests(force = false) {
  if (!force && Date.now() - contestsAt < 6 * 36e5) return
  type RawC = { id: number; name: string; type: string; phase: string; durationSeconds: number; startTimeSeconds?: number }
  const all = await call<RawC[]>('contest.list', { gym: 'false' })
  // keep a round that is already running (CODING) until it ends, or a refetch mid-round drops the live overlay
  contests = all.filter(c => (c.phase === 'BEFORE' || c.phase === 'CODING') && c.startTimeSeconds && (c.startTimeSeconds + c.durationSeconds) * 1000 > Date.now() && c.startTimeSeconds * 1000 < Date.now() + 60 * 864e5)
    .map(c => ({ id: c.id, name: c.name, start: c.startTimeSeconds! * 1000, dur: c.durationSeconds, type: c.type }))
    .sort((a, b) => a.start - b.start)
  contestsAt = Date.now()
  try { localStorage.setItem(C_KEY, JSON.stringify({ at: contestsAt, list: contests })) } catch { /* ignore */ }
  bump()
}
/** which division a contest name advertises (for eligibility + per-position targets) */
export const divOf = (name: string) => /Div\.?\s*1\b.*Div\.?\s*2|Div\. 1 \+ 2/i.test(name) ? 'Div1+2' : /Div\.?\s*4/i.test(name) ? 'Div4' : /Div\.?\s*3/i.test(name) ? 'Div3' : /Div\.?\s*2/i.test(name) ? 'Div2' : /Div\.?\s*1/i.test(name) ? 'Div1' : /Educational/i.test(name) ? 'Edu' : 'Other'

/* ───────── finished rounds (real-round mocks + division of a problem's contest) ───────── */
const PAST_KEY = 'momentum.cf.past'
let past: CfContest[] = (() => { try { return JSON.parse(localStorage.getItem(PAST_KEY) || 'null')?.list || [] } catch { return [] } })()
let pastAt: number = (() => { try { return JSON.parse(localStorage.getItem(PAST_KEY) || 'null')?.at || 0 } catch { return 0 } })()
let pastById = new Map(past.map(c => [c.id, c]))
export const getPastContests = () => past
export const pastContest = (id: number) => pastById.get(id)
/** finished, non-gym rounds since 2020 (≈ 1 call a day) */
export async function loadPastContests(force = false) {
  if (!force && past.length && Date.now() - pastAt < 864e5) return
  type RawC = { id: number; name: string; type: string; phase: string; durationSeconds: number; startTimeSeconds?: number }
  setPastContests(await call<RawC[]>('contest.list', { gym: 'false' }))
}
/** (exported for tests) keep finished rounds since 2020, compactly */
export function setPastContests(all: { id: number; name: string; type: string; phase: string; durationSeconds: number; startTimeSeconds?: number }[], at = Date.now()) {
  past = all.filter(c => c.phase === 'FINISHED' && c.startTimeSeconds && c.startTimeSeconds >= 1577836800)
    .map(c => ({ id: c.id, name: c.name, start: c.startTimeSeconds! * 1000, dur: c.durationSeconds, type: c.type }))
  pastAt = at; pastById = new Map(past.map(c => [c.id, c]))
  try { localStorage.setItem(PAST_KEY, JSON.stringify({ at: pastAt, list: past })) } catch { /* ignore */ }
  bump()
}
const GOOD_DIV = new Set(['Div2', 'Div3', 'Div4', 'Edu'])
/** a round worth training on: Div 2/3/4 or Educational; unknown (pre-2020 / not loaded) counts as neutral */
/** divOf, but Educational rounds ("Rated for Div. 2") keep their own label */
export const divName = (name: string) => /Educational/i.test(name) ? 'Edu' : divOf(name)
const divKnown = (c: number) => { const x = pastById.get(c); return x ? divName(x.name) : undefined }
const goodDiv = (c: number) => { const d = divKnown(c); return d === undefined || GOOD_DIV.has(d) }

export async function loadProblems(force = false) {
  await cacheReady // the IndexedDB copy may be fresh enough to skip the 1.5 MB download
  // a copy fetched before lang=en may hold Russian names (they break matching your code files by name): refetch it
  const ru = problems.slice(0, 2000).some(p => /[а-яё]/i.test(p.n))
  if (!force && !ru && problems.length && Date.now() - probAt < 3 * 864e5) return
  type Raw = { problems: { contestId?: number; index: string; name: string; rating?: number; tags: string[] }[]; problemStatistics: { contestId?: number; index: string; solvedCount: number }[] }
  const res = await call<Raw>('problemset.problems')
  const sc = new Map(res.problemStatistics.map(s => [`${s.contestId}${s.index}`, s.solvedCount]))
  problems = res.problems
    .filter(p => p.contestId && p.rating && p.contestId < 100000 && !p.tags.includes('*special'))
    .map(p => ({ id: `${p.contestId}${p.index}`, c: p.contestId!, i: p.index, n: p.name, r: p.rating!, t: p.tags, s: sc.get(`${p.contestId}${p.index}`) || 0 }))
  probAt = Date.now(); byId = new Map(problems.map(p => [p.id, p]))
  saveProblems()
  bump()
}
/** (tests) swap in a problem list without the network */
export function setProblems(list: Prob[]) { problems = list; byId = new Map(list.map(p => [p.id, p])); bump() }

/* ───────── problem quality: solvedCount far below what the rating implies = odd problem (Div 1 only, broken, niche) ───────── */
let qualFor: Prob[] | null = null, qualMed = new Map<number, number>(), maxC = 0
function quality() {
  if (qualFor === problems) return
  qualFor = problems; maxC = problems.reduce((m, p) => Math.max(m, p.c), 0)
  const b = new Map<number, number[]>()
  for (const p of problems) if (p.c >= 1500 && p.c < maxC - 30) { const a = b.get(p.r) || []; a.push(Math.log10(p.s + 10)); b.set(p.r, a) }
  qualMed = new Map([...b].map(([r, a]) => { a.sort((x, y) => x - y); return [r, a[a.length >> 1]] }))
}
/** ~0.5% of modern problems (older rounds had fewer users, so they're never judged): ≥4× fewer solves than typical for their rating (the newest rounds are exempt — still collecting solves) */
export const isOutlier = (p: Prob) => { quality(); const m = qualMed.get(p.r); return m !== undefined && p.c >= 1500 && p.c < maxC - 30 && Math.log10(p.s + 10) < m - 0.6 }
/** modern, mainstream, normal problem: the default pool, with the full set as fallback */
const preferred = (p: Prob) => p.c >= 1500 && goodDiv(p.c) && !isOutlier(p)
/** the contest position letter of a problem ('C2' → 'C') */
export const posOf = (p: Prob) => p.i.charAt(0)

type RawSub = {
  id: number; creationTimeSeconds: number; verdict?: string; problem: { contestId?: number; index: string }
  relativeTimeSeconds?: number; passedTestCount?: number; timeConsumedMillis?: number; memoryConsumedBytes?: number; programmingLanguage?: string
  author?: { participantType?: string; startTimeSeconds?: number }; contestId?: number
}
/** contests with a submission still being judged as of the last pull (a real round waits for these before it's booked) */
let pendingC = new Set<number>()
export const hasPendingIn = (cid: number) => pendingC.has(cid)
function absorb(u: CfUser, list: RawSub[]) {
  // never move the high-water mark past a submission that is still being judged, or its verdict is lost forever
  const pendingSubs = list.filter(s => !s.verdict || s.verdict === 'TESTING'), pending = pendingSubs.map(s => s.id)
  pendingC = new Set(pendingSubs.map(s => s.contestId ?? s.problem.contestId ?? 0))
  const cap = pending.length ? Math.min(...pending) - 1 : Infinity
  const seen = new Set(u.seen || [])
  for (const s of [...list].sort((a, b) => a.id - b.id)) {
    if (s.id <= u.lastSubId || seen.has(s.id) || !s.problem.contestId || !s.verdict || s.verdict === 'TESTING') continue
    seen.add(s.id)
    const pid = `${s.problem.contestId}${s.problem.index}`, t = s.creationTimeSeconds * 1000
    const rel = s.relativeTimeSeconds !== undefined && s.relativeTimeSeconds < 2147483647 ? s.relativeTimeSeconds : null
    ;(u.list ||= []).push({ id: s.id, pid, at: t, v: s.verdict, tn: s.passedTestCount ?? 0, ms: s.timeConsumedMillis ?? 0, mem: s.memoryConsumedBytes ?? 0,
      rel, pt: s.author?.participantType || 'PRACTICE', lang: s.programmingLanguage || '', cid: s.contestId ?? s.problem.contestId,
      ...(s.author?.startTimeSeconds ? { vs: s.author.startTimeSeconds * 1000 } : {}) })
    const x = u.subs[pid] || { ok: false, first: t, tries: 0 }
    if (!x.ok) { x.tries++; if (s.verdict === 'OK') { x.ok = true; x.okAt = t } }
    x.first = Math.min(x.first, t); u.subs[pid] = x
  }
  const judged = list.filter(s => s.verdict && s.verdict !== 'TESTING').map(s => s.id)
  if (judged.length) u.lastSubId = Math.max(u.lastSubId, Math.min(cap, Math.max(...judged)))
  // remember ids judged above the mark so the re-scan after a pending one never double-counts tries
  u.seen = [...seen].filter(id => id > u.lastSubId)
  if (u.list && u.list.length > 4000) u.list = u.list.sort((a, b) => a.id - b.id).slice(-4000)
}
/** full history on first load / handle change, then only the newest submissions */
export async function refreshUser(handle: string, full = false) {
  if (!handle) return
  await cacheReady // the stored submission list must be attached first, or an incremental pull would replace it
  status = { busy: true }; bump()
  try {
    const [info] = await call<{ handle: string; rating?: number; maxRating?: number; rank?: string }[]>('user.info', { handles: handle })
    const fresh = full || !user || user.handle.toLowerCase() !== handle.toLowerCase()
    const u: CfUser = fresh ? { handle: info.handle, rating: 0, maxRating: 0, rank: '', fetchedAt: 0, subs: {}, lastSubId: 0 } : { ...user!, subs: { ...user!.subs } }
    const prevLast = u.lastSubId
    const list = await call<RawSub[]>('user.status', fresh ? { handle } : { handle, from: 1, count: 100 })
    // if even the oldest of the newest 100 is unseen, there may be a gap — pull everything instead
    if (!fresh && list.length === 100 && Math.min(...list.map(s => s.id)) > prevLast) absorb(u, await call<RawSub[]>('user.status', { handle }))
    else absorb(u, list)
    // rated-contest count decides whether the displayed rating means anything yet (only re-fetched when it could have changed)
    // the rated-contest count: refetch on a rating change, a manual/full refresh, or every 6 h while provisional
    // (a contest can leave the displayed rating unchanged, and user.info can update before user.rating)
    let contests = u.contests, contestsAt = u.contestsAt || 0
    const stale = (info.rating || 0) !== (user?.rating || 0) || contests === undefined || (isProvisional(u) && Date.now() - contestsAt > 6 * 36e5)
    if (fresh || full || stale || !u.rated) {
      type RawR = { contestId: number; contestName: string; rank: number; oldRating: number; newRating: number; ratingUpdateTimeSeconds: number }
      const rows = await call<RawR[]>('user.rating', { handle })
      u.rated = rows.map(r => ({ cid: r.contestId, name: r.contestName, rank: r.rank, old: r.oldRating, new: r.newRating, at: r.ratingUpdateTimeSeconds * 1000 }))
      contests = rows.length; contestsAt = Date.now()
    }
    Object.assign(u, { handle: info.handle, rating: info.rating || 0, maxRating: info.maxRating || 0, rank: info.rank || 'unrated', fetchedAt: Date.now(), contests, contestsAt })
    user = u
    saveUser(u)
    status = { busy: false }
  } catch (e) {
    status = { busy: false, err: e instanceof Error ? e.message : String(e) }
  }
  bump()
}

/* ───────── skill model ───────── */
export const TAGS: { tag: string; w: number; min: number }[] = [
  { tag: 'greedy', w: 1, min: 0 }, { tag: 'math', w: 1, min: 0 }, { tag: 'constructive algorithms', w: 1, min: 0 },
  { tag: 'implementation', w: 0.8, min: 0 }, { tag: 'brute force', w: 0.6, min: 0 }, { tag: 'sortings', w: 0.7, min: 0 },
  { tag: 'strings', w: 0.7, min: 0 }, { tag: 'binary search', w: 0.9, min: 1000 }, { tag: 'two pointers', w: 0.7, min: 1000 },
  { tag: 'number theory', w: 0.8, min: 1000 }, { tag: 'bitmasks', w: 0.7, min: 1000 }, { tag: 'dp', w: 1, min: 1000 },
  { tag: 'data structures', w: 0.9, min: 1100 }, { tag: 'graphs', w: 0.8, min: 1200 }, { tag: 'dfs and similar', w: 0.8, min: 1200 },
  { tag: 'trees', w: 0.8, min: 1300 }, { tag: 'combinatorics', w: 0.7, min: 1300 }, { tag: 'dsu', w: 0.6, min: 1400 },
  { tag: 'shortest paths', w: 0.6, min: 1500 }, { tag: 'games', w: 0.5, min: 1300 }, { tag: 'interactive', w: 0.5, min: 1400 },
  { tag: 'hashing', w: 0.4, min: 1600 }, { tag: 'probabilities', w: 0.4, min: 1800 }, { tag: 'divide and conquer', w: 0.4, min: 1800 },
  { tag: 'geometry', w: 0.3, min: 1700 },
]
export const TAG_SET = new Set(TAGS.map(t => t.tag))
const E = (r: number, th: number) => 1 / (1 + Math.pow(10, (r - th) / 400))
export const round50 = (x: number) => Math.round(x / 50) * 50
export const TIERS = [
  [0, 'Newbie'], [1200, 'Pupil'], [1400, 'Specialist'], [1600, 'Expert'], [1900, 'Candidate Master'],
  [2100, 'Master'], [2300, 'International Master'], [2400, 'Grandmaster'], [2600, 'International GM'], [3000, 'Legendary GM'],
] as const
export function tierOf(r: number) {
  let i = 0; while (i + 1 < TIERS.length && r >= TIERS[i + 1][0]) i++
  return { name: TIERS[i][1], from: TIERS[i][0], next: TIERS[i + 1]?.[0], nextName: TIERS[i + 1]?.[1] }
}

export interface TagSkill { tag: string; theta: number; n: number; solved: number; failed: number; w: number; rel: number; label: 'untested' | 'weak' | 'shaky' | 'solid' | 'strong' }
export interface Skill { level: number; base: number; events: number; tags: TagSkill[]; solved: Set<string>; touched: Set<string>; failed: string[] }

/** Elo-style ability per topic, replayed chronologically over Codeforces history + in-app attempts. */
export function computeSkill(cp: CpState, u: CfUser | null, probs: Map<string, Prob>, asOf?: number): Skill {
  if (asOf !== undefined && u) u = asOfUser(u, asOf)
  // o = outcome (1 accepted / 0 failed); m scales the gain from an accept that needed retries (never turns it negative)
  type Ev = { pid: string; at: number; o: number; m: number }
  const evs = new Map<string, Ev>()
  for (const [pid, x] of Object.entries(u?.subs || {})) evs.set(pid, { pid, at: x.okAt || x.first, o: x.ok ? 1 : 0, m: x.tries <= 1 ? 1 : x.tries <= 3 ? 0.8 : 0.6 })
  // a voided mock (nothing opened, or abandoned) is no evidence: its "failed" attempts don't count
  const voidT = Object.values(cp.tests).filter(t => isVoidTest(t, cp))
  const fromVoid = (a: CpAttempt) => a.src === 'test' && a.status === 'failed' && voidT.some(t => t.pids.includes(a.pid) && a.at >= t.startedAt && a.at <= (t.finishedAt ?? Infinity) + 5 * 60000)
  for (const a of Object.values(cp.attempts).filter(a => sameHandle(a.h, cp.handle) && !fromVoid(a))) {
    const prev = evs.get(a.pid)
    if (prev?.o && a.status === 'failed') continue // a later CF accept beats an in-app give-up
    if (prev?.o && a.status === 'solved') continue // already counted from Codeforces
    evs.set(a.pid, { pid: a.pid, at: a.at, o: a.status === 'solved' ? 1 : 0, m: 1 })
  }
  const list = [...evs.values()].filter(e => probs.has(e.pid) && (asOf === undefined || e.at <= asOf)).sort((a, b) => a.at - b.at)
  // Codeforces history is accept-heavy: problems you never tried aren't recorded as failures, so a likelihood model
  // inflates without limit. Instead: level = what you actually solve (top quarter of recent solves), pulled down by how
  // often you fail near that level. It can never exceed what you've really solved.
  const now = asOf ?? Date.now(), WINDOW = 150 * 864e5
  const est = (evs: Ev[]): { v: number; n: number } | null => {
    const recent = evs.filter(e => now - e.at < WINDOW)
    const use = recent.filter(e => e.o > 0).length >= 8 ? recent : evs
    const sr = use.filter(e => e.o > 0).map(e => probs.get(e.pid)!.r).sort((a, b) => b - a)
    if (!sr.length) {
      // only failures so far: you can't yet solve what you tried — sit just below the easiest miss
      const fr = use.filter(e => e.o === 0).map(e => probs.get(e.pid)!.r)
      return fr.length ? { v: Math.max(800, Math.min(...fr) - 200 - 100 * Math.min(1, fr.length / 10)), n: fr.length } : null // more misses, further below
    }
    const top = sr.slice(0, Math.max(3, Math.ceil(sr.length / 4)))
    const solvedLevel = top.reduce((a, b) => a + b, 0) / top.length
    const near = use.filter(e => { const r = probs.get(e.pid)!.r; return r >= solvedLevel - 100 && r <= solvedLevel + 300 }) // easy solves don't dilute misses
    const failRate = near.length ? near.filter(e => e.o === 0).length / near.length : 0
    // retries count as partial failures; 20% misses near your level is normal
    const retry = near.filter(e => e.o > 0 && e.m < 1).length / Math.max(1, near.length)
    return { v: solvedLevel - 250 * Math.max(0, failRate + 0.3 * retry - 0.2), n: use.length }
  }
  // Evidence-weighted blend: a prior (settled CF rating, else your calibration, else 1000) that fades as solves,
  // failures and mock rounds accumulate. A mock round is strong evidence, so a wrong calibration corrects fast.
  // Evidence-weighted blend. The CF rating is phased in contest by contest (10 per rated contest, 60 once settled),
  // using displayed + remaining boosts while provisional, so there's no jump when the account settles.
  // Before any contest your calibration (else 1000) stands in, fading as solves, failures and mock rounds arrive.
  const rating = internalRating(u), k = Math.min(u?.contests ?? (u?.rating ? PROVISIONAL_CONTESTS : 0), PROVISIONAL_CONTESTS)
  // a rated round you took is already in the CF rating once its rating change is out (weight 10 per contest above): its perf
  // only stands in until then, so it is never counted twice nor pushes real mocks out of the 5 newest
  const inRating = (t: CpTest) => isContestRec(t) && !!u?.rated?.some(r => r.cid === t.real!.contestId)
  const tests = Object.values(cp.tests).filter(t => t.finishedAt && t.perf && !isVoidTest(t, cp) && !inRating(t) && t.finishedAt <= now && now - t.startedAt < 60 * 864e5 && sameHandle(t.h, cp.handle))
    .sort((a, b) => b.startedAt - a.startedAt).slice(0, 5)
  const raw = est(list)
  const parts: [number, number][] = []
  if (rating) parts.push([rating, 10 * k])
  // calibration counts only until real contests take over; it's worth ~10 problems on day one
  if (k < 3) parts.push([cp.calib || 1000, 10 * 20 / (20 + list.length) * (1 - k / 3)])
  if (raw) parts.push([raw.v, Math.min(raw.n, 60)])
  for (const t of tests) parts.push([t.perf!, 8])
  const W = parts.reduce((a, [, w]) => a + w, 0)
  const all = W > 0 ? parts.reduce((a, [v, w]) => a + v * w, 0) / W : 1000
  const base = rating || Math.round(all)
  const level = Math.max(800, round50(all))
  const th = new Map<string, { t: number; n: number; s: number; f: number }>()
  for (const { tag } of TAGS) {
    const tev = list.filter(e => probs.get(e.pid)!.t.includes(tag))
    if (!tev.length) continue
    const r = est(tev), n = tev.length
    // shrink thin topics toward your overall level
    const t = r ? level + (r.v - level) * (n / (n + 8)) : level - 300 * (n / (n + 8)) // only failures: clearly weak
    th.set(tag, { t, n, s: tev.filter(e => e.o > 0).length, f: tev.filter(e => e.o === 0).length })
  }
  const tags: TagSkill[] = TAGS.filter(t => t.min <= level + 200).map(({ tag, w }) => {
    const x = th.get(tag), theta = x ? Math.round(x.t) : level, n = x?.n || 0
    const rel = theta - level
    const label: TagSkill['label'] = n < 3 ? 'untested' : rel < -150 ? 'weak' : rel < -50 ? 'shaky' : rel > 150 ? 'strong' : 'solid'
    return { tag, theta, n, solved: x?.s || 0, failed: x?.f || 0, w, rel, label }
  })
  const solved = new Set(list.filter(e => e.o > 0).map(e => e.pid))
  const failed = list.filter(e => e.o === 0).sort((a, b) => b.at - a.at).map(e => e.pid)
  return { level, base, events: list.length, tags, solved, touched: new Set(evs.keys()), failed }
}

/** a mock that doesn't count (discarded, or nothing was opened): the mark lives in cp.triggers, a max-merged map, so it syncs
 *  reliably — a field on the test itself could be lost when two copies merge (mergeTest keeps one side's extra fields) */
export const isVoidTest = (t: Pick<CpTest, 'id'>, cp: Pick<CpState, 'triggers'> = getState().cp) => !!cp.triggers?.['void:' + t.id]
/** a rated round the student really took (built from their CONTESTANT submissions), not a mock */
export const isContestRec = (t: Pick<CpTest, 'real'>) => !!(t.real as (RealRound & { live?: boolean }) | undefined)?.live

/** the account as it looked at time `t` (rating history replayed), for historical graphs */
function asOfUser(u: CfUser, t: number): CfUser {
  const rows = (u.rated || []).filter(r => r.at <= t)
  const subs: Record<string, SubInfo> = {}
  for (const [pid, x] of Object.entries(u.subs)) if (x.first <= t) subs[pid] = x.ok && x.okAt && x.okAt <= t ? x : { ...x, ok: false, okAt: undefined }
  return { ...u, subs, rating: rows.length ? rows[rows.length - 1].new : 0, contests: rows.length }
}

/* ───────── topic lifecycle: new → learning → learned → mastered ───────── */
export const GATES: [number, string[]][] = [
  [1200, ['implementation', 'math', 'greedy', 'brute force', 'sortings', 'strings', 'constructive algorithms']],
  [1400, ['binary search', 'two pointers', 'number theory', 'dp', 'bitmasks']],
  [1600, ['graphs', 'dfs and similar', 'dsu', 'trees', 'combinatorics']],
  [1900, ['data structures', 'shortest paths', 'interactive', 'games', 'hashing']],
]
/** clean solve = solved without a full editorial (hint level < 3) */
function cleanSolves(cp: CpState, sk: Skill, tag: string, minR: number) {
  let n = 0
  for (const pid of sk.solved) {
    const p = byId.get(pid); if (!p || !p.t.includes(tag) || p.r < minR) continue
    if ((cp.probStats[pid]?.hint ?? hintOf(cp, pid)) < 3) n++
  }
  return n
}
export function hintOf(cp: CpState, pid: string) { let h = 0; for (const e of Object.values(cp.events)) if (e.pid === pid && e.k === 'hint') h = Math.max(h, e.hl || 0); return h }
export function topicState(sk: Skill, cp: CpState, tag: string): Exclude<TopicState, 'paused'> | 'new' {
  const t = sk.tags.find(x => x.tag === tag), L = sk.level
  const derived: Exclude<TopicState, 'paused'> | 'new' = !t ? 'new'
    : t.theta >= L + 100 && cleanSolves(cp, sk, tag, L + 100) >= 3 ? 'mastered'
    : cleanSolves(cp, sk, tag, L - 100) >= 5 && t.theta >= L - 150 ? 'learned' : 'new'
  const ex = cp.topics[tag]?.st, explicit = ex === 'paused' ? undefined : ex // stopping a topic never undoes what your solves show
  const order = ['new', 'learning', 'learned', 'mastered']
  return order.indexOf(explicit || 'new') > order.indexOf(derived) ? explicit! : derived
}
/** mock syllabus: what you've learned, plus the basics of every tier below your level */
export function syllabus(sk: Skill, cp: CpState) {
  const s = new Set<string>()
  for (const [tier, tags] of GATES) if (tier <= sk.level) tags.forEach(t => s.add(t))
  for (const t of TAGS) { const st = topicState(sk, cp, t.tag); if (st === 'learned' || st === 'mastered') s.add(t.tag) }
  if (!s.size) GATES[0][1].forEach(t => s.add(t))
  return [...s]
}
export function gates(sk: Skill, cp: CpState) {
  const nextTier = GATES.find(([tier]) => tier > sk.level) || GATES[GATES.length - 1]
  const tags = GATES.filter(([tier]) => tier <= nextTier[0]).flatMap(([, t]) => t)
  const passed = tags.filter(t => { const st = topicState(sk, cp, t); return st === 'learned' || st === 'mastered' })
  return { tier: nextTier[0], tags, passed }
}

/** weakest topics first: distance below your level × how much the topic matters; untested topics count as mildly weak */
export function weakest(sk: Skill, focus: string[] = [], gateBoost: Set<string> = new Set()) {
  return [...sk.tags]
    .map(t => ({ t, score: (t.n < 3 ? 80 : -t.rel) * t.w + (focus.includes(t.tag) ? 400 : 0) + (gateBoost.has(t.tag) ? 150 : 0) }))
    .sort((a, b) => b.score - a.score).map(x => x.t)
}

/* ───────── deterministic picking ───────── */
function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
function pickFrom(pool: Prob[], seed: string) {
  if (!pool.length) return undefined
  // favour well-trodden, recent problems (good statements, editorials exist), then pick by seed among the best 40
  const ranked = [...pool].sort((a, b) => (Math.log10(b.s + 10) + b.c / 1500) - (Math.log10(a.s + 10) + a.c / 1500)).slice(0, 40)
  return ranked[hash(seed) % ranked.length]
}
function usedRecently(cp: CpState, exceptDate?: string) {
  const s = new Set<string>()
  for (const p of Object.values(cp.plans)) if (p.date !== exceptDate) { p.practice.forEach(x => s.add(x)); p.test.forEach(x => s.add(x)) }
  for (const t of Object.values(cp.tests)) t.pids.forEach(x => s.add(x))
  return s
}
const clampR = (r: number) => Math.max(800, Math.min(3500, Math.round(r / 100) * 100))

export function findProblem(sk: Skill, cp: CpState, opts: { lo: number; hi: number; tag?: string; avoid: Set<string>; seed: string; strict?: boolean; only?: Set<string> }): Prob | undefined {
  // `only`: every core tag of the problem must be in this set (mock rounds never test unlearned topics)
  const fresh = (p: Prob) => !sk.touched.has(p.id) && !opts.avoid.has(p.id) && (!opts.only || p.t.every(t => opts.only!.has(t)))
  const tries: ((p: Prob) => boolean)[] = [
    p => p.r >= opts.lo && p.r <= opts.hi && (!opts.tag || p.t.includes(opts.tag)) && p.c >= 1000,
    p => p.r >= opts.lo && p.r <= opts.hi && (!opts.tag || p.t.includes(opts.tag)),
    p => p.r >= opts.lo - 100 && p.r <= opts.hi + 100 && (!opts.tag || p.t.includes(opts.tag)),
    p => p.r >= opts.lo && p.r <= opts.hi && p.c >= 1000,
  ]
  if (opts.strict && opts.tag) tries.pop() // caller wants this topic or nothing
  // first: the same band, but only modern Div 2/3/4/Edu problems with normal solve counts — when that pool isn't thin
  const best = problems.filter(p => fresh(p) && preferred(p) && tries[0](p))
  if (best.length >= 3) return pickFrom(best, opts.seed)
  for (const f of tries) { const pick = pickFrom(problems.filter(p => fresh(p) && f(p)), opts.seed); if (pick) return pick }
  return undefined
}

/* ───────── topic-aware picking: right topic, right difficulty for THAT topic ───────── */
const tagOf = (sk: Skill, tag: string) => sk.tags.find(x => x.tag === tag)
/** how much practising a topic still pays off (0-1.3): untested / weak / next-rank topics high; strong & mastered low */
export function topicNeed(sk: Skill, cp: CpState, tag: string, gate?: Set<string>) {
  const t = tagOf(sk, tag); if (!t) return 0.3 // above your level's topic list: rarely worth it yet
  const st = topicState(sk, cp, tag)
  let need = t.n < 3 ? 0.9 : t.rel < -150 ? 1 : t.rel < -50 ? 0.8 : t.rel <= 150 ? 0.45 : 0.15
  if (st === 'mastered') need = Math.min(need, 0.1)
  if (gate?.has(tag) && st !== 'learned' && st !== 'mastered') need *= 1.3
  return need
}
/** difficulty shift for a topic: where you're strong you get harder problems, where weak easier — trusted as evidence grows */
export function topicShift(sk: Skill, tag: string) {
  const t = tagOf(sk, tag); if (!t || t.n < 3) return 0
  return Math.max(-200, Math.min(200, Math.round(t.rel * Math.min(1, t.n / 10) / 50) * 50))
}
const coreTags = (p: Prob) => p.t.filter(t => TAG_SET.has(t))
/** a problem is as hard for you as its weakest topic makes it */
const probShift = (sk: Skill, p: Prob) => { const c = coreTags(p); return c.length ? Math.min(...c.map(t => topicShift(sk, t))) : 0 }
/** mixed practice: among problems that are the right difficulty *for their topics*, prefer the topics that still pay off,
 *  and don't serve the same main topic over and over within a session */
function pickMixed(sk: Skill, cp: CpState, band: number, avoid: Set<string>, seed: string, served: Set<string>): Prob | undefined {
  const gate = new Set(gates(sk, cp).tags), seen = new Map<string, number>()
  for (const id of served) for (const t of coreTags(byId.get(id) || { t: [] } as unknown as Prob)) seen.set(t, (seen.get(t) || 0) + 1)
  const fresh = (p: Prob) => !sk.touched.has(p.id) && !avoid.has(p.id) && !isOutlier(p) && p.r >= band - 250 && p.r <= band + 300
  const fits = (p: Prob) => { const e = p.r - probShift(sk, p); return e >= band && e <= band + 99 }
  let pool = problems.filter(p => fresh(p) && preferred(p) && fits(p))
  if (pool.length < 8) pool = problems.filter(p => fresh(p) && fits(p))
  if (!pool.length) return undefined
  const weight = (p: Prob) => {
    const c = coreTags(p); if (!c.length) return 0.2
    const need = Math.max(...c.map(t => topicNeed(sk, cp, t, gate)))
    // the same topic again in a session gets steeply less likely (2nd ×0.6, 3rd ×0.3, 4th ×0.15…), so weak spots are spread, not hammered
    const rep = c.reduce((m, t) => m + (seen.get(t) || 0), 0) / c.length
    return need / (1 + 0.65 * rep * rep) * (Math.log10(p.s + 10) / 4 + p.c / 4000)
  }
  let best: Prob | undefined, bs = -1
  for (const p of pool) { const u = ((hash(seed + p.id) % 1000) + 1) / 1000, sc = weight(p) * Math.pow(u, 0.6); if (sc > bs) { bs = sc; best = p } }
  return best
}
/** for the UI: why this problem, in topic terms */
export const topicWhy = (sk: Skill, p: Prob) => {
  const c = coreTags(p).map(t => tagOf(sk, t)).filter(Boolean) as TagSkill[]
  const w = c.sort((a, b) => a.rel - b.rel)[0]
  return w ? (w.n < 3 ? `New ground: ${w.tag}` : w.rel < -50 ? `Weak spot: ${w.tag}` : w.rel > 150 ? `${w.tag} is strong, so this one is harder` : `Building ${w.tag}`) : 'Mixed, contest style'
}

/* ───────── practice: session specs + adaptive next problem ───────── */
const clampBand = (L: number, r: number) => Math.max(800, Math.min(3500, r))
/** default day of practice when the coach hasn't designed one: learn the next gate topic, drill weak spots, clear debt */
export function defaultSpecs(sk: Skill, cp: CpState, due: { resolve: number; upsolve: number }, cpMin = targetFor().cpMin): SessSpec[] {
  const L = sk.level, off = cp.offsets?.practice || 0
  // the coach's measured speed directive beats the generic lever: its weakest position opens the day
  const sp = speedSpec(sk, cp)
  // a short day (exam season): one session, not a 4.5 h ladder cut to pieces — the speed directive, else a speed warm-up
  if (cpMin <= 0) return [] // a season with no CP target ("none"): no session at all
  if (cpMin < 90) return [sp ? { ...sp, minutes: cpMin } : { mode: 'speed', tags: [], lo: Math.max(800, L - 400), hi: Math.max(900, L - 200), minutes: cpMin, timebox: 0.75, by: 'default', why: 'Short day: easy problems, fast — keep the hands warm' }]
  const g = gates(sk, cp), unlearned = g.tags.filter(t => !g.passed.includes(t))
  const learning = Object.entries(cp.topics).filter(([, v]) => v.st === 'learning').map(([k]) => k)
  const learnTag = learning[0] || unlearned[0]
  const weak = weakest(sk, cp.focusTags, new Set(unlearned)).map(t => t.tag)
  const specs: SessSpec[] = []
  if (sp) specs.push(sp)
  const pos = leverSpec(sk)
  if (pos && pos.pos !== sp?.pos) specs.push(pos)
  if (due.upsolve + due.resolve > 0) specs.push({ mode: due.upsolve ? 'upsolve' : 'resolve', tags: [], lo: L - 300, hi: L + 500, minutes: 45, timebox: 1, by: 'default', why: 'Clear your upsolve / re-solve queue first' })
  const ls = learnSpec(sk, cp)
  if (ls) specs.push(ls)
  else if (learnTag) specs.push({ mode: 'learn', tags: [learnTag], lo: L - 300, hi: L + 100, minutes: 90, timebox: 1.25, by: 'default', why: `Next topic for ${g.tier}: ${learnTag}` })
  specs.push({ mode: 'drill', tags: weak.slice(0, 3), lo: L + off, hi: L + 200 + off, minutes: 90, timebox: 1, by: 'default', why: 'Weak spots just above your level' })
  specs.push({ mode: 'mixed', tags: [], lo: L + off, hi: L + 300 + off, minutes: 90, timebox: 1, by: 'default', why: 'Contest-style mixed problems' })
  let total = specs.reduce((a, x) => a + x.minutes, 0)
  while (total > cpMin && specs.length > 1) { total -= specs[specs.length - 1].minutes; specs.pop() }
  if (total < cpMin) specs[specs.length - 1].minutes += cpMin - total
  else if (total > cpMin) specs[0].minutes = cpMin // one session longer than the whole day: cut to it
  return specs
}
/** solve-time target per position (min from the round's start; Div 2 checkpoints) — what "slow at B" is measured against */
const POS_TARGET: Record<string, number> = { A: 10, B: 25, C: 50, D: 80, E: 120, F: 160 }
/** of the coach's speed positions, the one you're slowest at relative to its target, from your rounds and mocks of the last
 *  30 days (unsolved = 3× the target); no data: the coach's first */
export function weakestSpeedPos(cp: CpState, list: string[], now = Date.now()): string | undefined {
  const ps = [...new Set(list.map(p => p.charAt(0).toUpperCase()).filter(p => POS_TARGET[p]))]
  if (ps.length < 2) return ps[0]
  const ratio = new Map<string, number[]>()
  for (const t of Object.values(cp.tests)) {
    if (!t.finishedAt || now - t.startedAt > 30 * 864e5 || isVoidTest(t, cp) || !sameHandle(t.h, cp.handle)) continue
    t.pids.forEach((pid, i) => {
      const ix = t.real ? pid.slice(String(t.real.contestId).length) : 'ABCDEF'[i] || ''
      const pos = ix.charAt(0); if (!ps.includes(pos)) return
      const at = t.real ? t.real.probs[ix]?.at : t.solved[pid]
      ;(ratio.get(pos) || ratio.set(pos, []).get(pos)!).push(at === undefined ? 3 : at / 60 / POS_TARGET[pos])
    })
  }
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }
  let best = ps[0], bv = -1
  for (const p of ps) { const r = ratio.get(p); if (r?.length && med(r) > bv) { bv = med(r); best = p } }
  return best
}
/** the coach's speed directive (cp.speedPos, ≤ 14 days old) as a position session: problems you can solve at that letter, fast */
export function speedSpec(sk: Skill, cp: CpState, minutes = 60): SessSpec | null {
  const sp = cp.speedPos
  if (!sp?.list?.length || Date.now() - sp.u > 14 * 864e5) return null
  const pos = weakestSpeedPos(cp, sp.list); if (!pos) return null
  const L = sk.level, lo = Math.max(800, Math.round(Math.min(posRating(pos), L) / 100) * 100 - 200)
  return { mode: 'position', pos, tags: [], lo, hi: lo + 300, minutes, timebox: 0.75, by: 'default', why: `Coach: speed at ${pos} — solve it fast, then the next` }
}
/** a learn session for a curriculum sub-topic: the one given, else the one you're on, else the next one due (null: none) */
export function learnSpec(sk: Skill, cp: CpState, subId?: string): SessSpec | null {
  const L = sk.level
  // learning happens sub-topic by sub-topic (knapsack, LIS, bitmask DP…): the one you're on, else the next one due
  const ss = subSkillsMemo(sk, cp, getProb, problems.length)
  let sub = subId ? SUB_BY_ID.get(subId) : undefined
  if (!sub) {
    const cur = learningSubs(cp).find(id => { const st = ss.get(id)?.st; return (st === 'learning' || st === 'new') && practicable(ss.get(id)) })
    // reading-only sub-topics (no ladder at your floor) can't fill a practice block: skip to the next practicable one
    sub = SUB_BY_ID.get(cur || '') || nextSubs(sk, cp, ss, 40).find(s => practicable(ss.get(s.id)))
  }
  if (!sub) return null
  const slo = Math.max(800, Math.min(L, sub.tier) - 300)
  return { mode: 'learn', sub: sub.id, tags: sub.cfTags.filter(t => TAG_SET.has(t)).slice(0, 1), lo: slo, hi: Math.max(slo + 200, Math.min(Math.max(L, sub.tier) + 100, L + 400)), minutes: 90, timebox: 1.25, by: 'default', why: `Learn ${sub.name} (${sub.topicName})` }
}
/** a position session at a chosen contest position (A–F): problems of that letter in recent rounds, capped near your edge */
export function posSpec(sk: Skill, pos: string, minutes = 60): SessSpec {
  pos = pos.charAt(0).toUpperCase()
  const L = sk.level, lo = Math.max(800, Math.round(Math.min(posRating(pos), L + 300) / 100) * 100 - 100)
  return { mode: 'position', pos, tags: [], lo, hi: lo + 300, minutes, timebox: 1, by: 'user', why: `Position ${pos}: the ${pos} problems of recent rounds` }
}
/** the contest position that sits at your level (the first whose typical rating reaches it) */
export const posAtLevel = (L: number) => 'ABCDEF'.split('').find(p => posRating(p) >= L) || 'F'
/** typical rating of a contest position in recent Div 2/3/Edu rounds (median) */
export function posRating(pos: string) {
  const r = problems.filter(p => p.c >= 1500 && posOf(p) === pos && GOOD_DIV.has(divKnown(p.c) || '') && divKnown(p.c) !== 'Div4').map(p => p.r).sort((a, b) => a - b)
  return r.length ? r[r.length >> 1] : ({ A: 800, B: 1100, C: 1400, D: 1700, E: 2000, F: 2300 } as Record<string, number>)[pos] || 1500
}
/** the #1 rating lever (speed / solving a position, ≥ +8 per contest) becomes the day's first session */
export function leverSpec(sk: Skill): SessSpec | null {
  const lv = getLeverage()?.levers.filter(l => l.pos && (l.kind === 'speed' || l.kind === 'solve')).sort((a, b) => b.perContest - a.perContest)[0]
  if (!lv || lv.perContest < 8) return null
  const pos = lv.pos!.charAt(0).toUpperCase(), med = posRating(pos), L = sk.level, gain = Math.round(lv.perContest)
  // solve lever: the position is out of reach → train at it (capped near your edge); speed lever: you solve it → do many, fast
  const lo = lv.kind === 'solve' ? Math.max(800, Math.round(Math.min(med, L + 300) / 100) * 100 - 100) : Math.max(800, Math.round(Math.min(med, L) / 100) * 100 - 200)
  const why = lv.kind === 'solve' ? `Solving ${pos} is worth +${gain}/contest for you` : `${pos} speed is worth +${gain}/contest for you`
  return { mode: 'position', pos, tags: [], lo, hi: lo + 300, minutes: 60, timebox: lv.kind === 'speed' ? 0.75 : 1, by: 'default', why }
}
/** a deep-thinking block: one hard problem (≈ L+300), 60-90 min, hints locked for the first hour */
export const deepSpec = (L: number, minutes = 90): SessSpec => ({ mode: 'deep', tags: [], lo: L + 250, hi: L + 350, minutes, timebox: 1.5, by: 'user', why: 'Deep: one hard problem, no hints for 60 min' })
/** where a spec's band starts (relative to the spec's lo) */
export const bandStart = (spec: SessSpec) => spec.mode === 'learn' || spec.mode === 'speed' || spec.mode === 'deep' ? spec.lo : Math.round((spec.lo + spec.hi) / 2 / 100) * 100 - 100
/** after each problem: clean & fast → harder, slow/hinted → same, failed/skipped → easier (aim: 50-65% clean) */
export function stepBand(spec: SessSpec, band: number, outcome: 'fast' | 'ok' | 'hinted' | 'fail' | 'skip') {
  const d = outcome === 'fast' ? 100 : outcome === 'fail' || outcome === 'skip' ? -100 : 0
  return Math.max(spec.lo, Math.min(spec.hi, band + d))
}
export function nextProblem(sk: Skill, cp: CpState, spec: SessSpec, band: number, served: Set<string>, seed: string, queues: { resolve: string[]; upsolve: string[] }): { p: Prob; why: string } | null {
  const avoid = new Set([...served])
  if (spec.mode === 'resolve' || spec.mode === 'upsolve' || spec.mode === 'mixed') {
    const q = spec.mode === 'resolve' ? queues.resolve : spec.mode === 'upsolve' ? queues.upsolve : [...queues.upsolve, ...queues.resolve]
    const id = q.find(x => !avoid.has(x) && byId.has(x))
    if (id) return { p: byId.get(id)!, why: queues.upsolve.includes(id) ? 'Upsolve (mandatory)' : 'Spaced re-solve' }
    if (spec.mode !== 'mixed') return null
  }
  const lo = clampBand(sk.level, band), hi = lo + 99
  const tags = spec.tags.filter(t => TAG_SET.has(t))
  const tag = tags.length ? tags[hash(seed) % tags.length] : undefined
  if (spec.mode === 'position' && spec.pos) {
    const p = positionProblem(sk, spec.pos, band, avoid, seed, tag) || (tag ? positionProblem(sk, spec.pos, band, avoid, seed) : undefined)
    return p ? { p, why: spec.why || `Position ${spec.pos}` } : null
  }
  if (spec.mode === 'deep') {
    const p = findProblem(sk, cp, { lo: Math.max(spec.lo, lo), hi: Math.max(spec.hi, hi), tag, avoid, seed }) || findProblem(sk, cp, { lo: spec.lo, hi: spec.hi + 100, avoid, seed })
    return p ? { p, why: 'Deep: think it through — hints unlock at 60 min' } : null
  }
  // a curriculum sub-topic: its own ladder first, near the band (falls through to the topic's CF tag when exhausted)
  let fallbackWhy = ''
  if (spec.sub) {
    const sub = SUB_BY_ID.get(spec.sub)
    // the curated ladder may stretch 200 past the block's top: an on-topic problem beats an off-topic one
    const p = sub && subProblem(sk, cp, sub, lo, avoid, getProb, spec.hi + 200)
    if (p) return { p, why: `${sub!.name} · ${sub!.topicName}` }
    if (sub) fallbackWhy = `No ${sub.name} problem left near your level — general ${sub.topicName} practice (try its CSES exercises)`
  }
  // no topic given (mixed / speed): pick by topic need, sized per topic
  if (!tag && spec.mode !== 'speed') {
    const p = pickMixed(sk, cp, lo, avoid, seed, served) || findProblem(sk, cp, { lo, hi, avoid, seed })
    return p ? { p, why: topicWhy(sk, p) } : null
  }
  // a chosen topic: the band moves with your strength in THAT topic (learning only ever skips ahead, never back)
  const sh = tag ? topicShift(sk, tag) : 0, tlo = clampBand(sk.level, lo + (spec.mode === 'learn' ? Math.max(0, sh) : sh)), thi = tlo + 99
  const p = findProblem(sk, cp, { lo: tlo, hi: thi, tag, avoid, seed, strict: spec.mode === 'learn' }) || (tag ? findProblem(sk, cp, { lo, hi, avoid, seed }) : undefined)
  if (!p) return null
  const why = fallbackWhy ? fallbackWhy : spec.mode === 'learn' ? `Learning ${tag}` : spec.mode === 'speed' ? 'Speed: solve it fast' : spec.mode === 'drill' ? `Drill: ${tag || 'weak spot'}${sh ? ` (sized to your ${tag}: ${sh > 0 ? '+' : ''}${sh})` : ''}` : 'Mixed, contest style'
  return { p, why }
}

/** problems at one contest position (e.g. every C of recent Div 2/3/Edu rounds) near a rating band */
export function positionProblem(sk: Skill, pos: string, band: number, avoid: Set<string>, seed: string, tag?: string): Prob | undefined {
  pos = pos.charAt(0).toUpperCase()
  const fresh = (p: Prob) => posOf(p) === pos && !sk.touched.has(p.id) && !avoid.has(p.id) && !isOutlier(p) && (!tag || p.t.includes(tag))
  const div = (p: Prob) => { const d = divKnown(p.c); return d === 'Div2' || d === 'Div3' || d === 'Edu' }
  const tries: ((p: Prob) => boolean)[] = [
    p => div(p) && p.c >= 1500 && Math.abs(p.r - band - 50) <= 150,
    p => div(p) && Math.abs(p.r - band - 50) <= 300,
    p => goodDiv(p.c) && Math.abs(p.r - band - 50) <= 300,
  ]
  for (const f of tries) { const pick = pickFrom(problems.filter(p => fresh(p) && f(p)), seed); if (pick) return pick }
  return undefined
}

/* ───────── the daily 2h syllabus mock (tailored virtual contest) ───────── */
export const MOCK_LADDER = [-300, -100, 0, 100, 200, 400]
export function buildMock(date: string, sk: Skill, cp: CpState, rev: number, avoid: Set<string>): string[] {
  const L = sk.level, off = cp.offsets?.mock || 0, syl = syllabus(sk, cp)
  const seed = (slot: string) => `${date}|${cp.handle}|${rev}|mock|${slot}`
  const designedFor = cp.designs?.forDate && cp.designs.forDate >= (() => { const d = keyToDate(date); d.setDate(d.getDate() - 1); return dateKey(d) })()
  const slots = designedFor && cp.designs?.mock?.length === 6 ? cp.designs.mock.map(s => ({ tag: syl.includes(s.tag) ? s.tag : '', r: Math.max(L - 400, Math.min(L + 600, s.rating)) })) : MOCK_LADDER.map(d => ({ tag: '', r: L + d + off }))
  const out: string[] = [], used = new Set<string>()
  slots.forEach((sl, k) => {
    const lo = clampR(sl.r), hi = lo + 99
    let p: Prob | undefined
    const order = sl.tag ? [sl.tag] : syl.filter(t => !used.has(t)).sort((a, b) => hash(seed(k + a)) - hash(seed(k + b)))
    const only = new Set(syl)
    for (const t of order) { p = findProblem(sk, cp, { lo, hi, tag: t, avoid, seed: seed(k + t), strict: true, only }); if (p) { used.add(t); break } }
    // only problems whose every core tag is in the syllabus — the mock never tests what you haven't learned
    p ||= findProblem(sk, cp, { lo, hi, avoid, seed: seed('any' + k), only }) || findProblem(sk, cp, { lo: lo - 100, hi: hi + 100, avoid, seed: seed('wide' + k), only })
    if (p) { out.push(p.id); avoid.add(p.id) }
  })
  return out
}
/* ───────── real past rounds as the mock (virtual participation on codeforces.com) ───────── */
export interface RealPick { contestId: number; name: string; rule: 'icpc' | 'cf'; pids: string[]; dur: number; div: string; ratings: number[]; start: number; offSyl: number }
export const virtualUrl = (cid: number) => `https://codeforces.com/contest/${cid}/virtual`
export const contestUrl = (cid: number) => `https://codeforces.com/contest/${cid}`
/** problem link inside the contest — submissions made there count for the virtual participation (the problemset page does not) */
export const contestProbUrl = (pid: string) => { const m = pid.match(/^(\d+)(.+)$/)!; return `https://codeforces.com/contest/${m[1]}/problem/${m[2]}` }
const idxSort = (a: Prob, b: Prob) => a.i < b.i ? -1 : a.i > b.i ? 1 : 0
let byContestFor: Prob[] | null = null, byContest = new Map<number, Prob[]>()
export function contestProblems(cid: number) {
  if (byContestFor !== problems) {
    byContestFor = problems; byContest = new Map()
    for (const p of problems) { const a = byContest.get(p.c) || []; a.push(p); byContest.set(p.c, a) }
    for (const a of byContest.values()) a.sort(idxSort)
  }
  return byContest.get(cid) || []
}
/** An unseen rated Div 2/3/4/Edu round from 2021+ whose first problems fit your mock ladder (≈ T−400 … T+300, T = level + mock offset)
 *  and, preferably, your syllabus. Deterministic per day. null until the problemset + finished-contest list are loaded. */
export function pickRealRound(sk: Skill, cp: CpState, avoid?: Set<number>, opts: { date?: string; level?: number; offset?: number; rev?: number } = {}): RealPick | null {
  const T = (opts.level ?? sk.level) + (opts.offset ?? cp.offsets?.mock ?? 0), date = opts.date || dateKey()
  const syl = new Set(syllabus(sk, cp))
  const u = user && sameHandle(user.handle, cp.handle) ? user : null
  const seenC = new Set<number>(avoid || [])
  for (const s of u?.list || []) seenC.add(s.cid)
  for (const pid of [...Object.keys(cp.attempts), ...Object.keys(u?.subs || {}), ...sk.touched]) { const m = pid.match(/^(\d+)/); if (m) seenC.add(+m[1]) }
  for (const t of Object.values(cp.tests)) { if (t.real) seenC.add(t.real.contestId); for (const pid of t.pids) { const m = pid.match(/^(\d+)/); if (m) seenC.add(+m[1]) } }
  const cands: (RealPick & { cost: number })[] = []
  for (const c of past) {
    if (c.start < Date.UTC(2021, 0, 1) || seenC.has(c.id) || /unrated|kotlin|april fools|q#|team|marathon/i.test(c.name)) continue
    const div = divName(c.name)
    if (!GOOD_DIV.has(div) || /Div\.?\s*1\b/i.test(c.name)) continue
    const ps = contestProblems(c.id)
    if (ps.length < 5 || ps[0].i !== 'A' || !['B', 'C', 'D'].every(x => ps.some(p => posOf(p) === x))) continue
    if (ps.some(p => sk.touched.has(p.id) || cp.attempts[p.id])) continue
    const head = ps.slice(0, 5), a = head[0].r, b = head[head.length - 1].r
    if (a < T - 750 || a > Math.max(800, T - 50) || b < Math.max(1000, T - 50) || b > Math.max(1300, T + 800)) continue
    const offSyl = ps.slice(0, 4).filter(p => p.t.some(t => TAG_SET.has(t) && !syl.has(t))).length
    const cost = Math.abs(a - (T - 400)) + Math.abs(b - (T + 300)) + 150 * offSyl - (c.start - Date.UTC(2021, 0, 1)) / (365 * 864e5) * 10
    cands.push({ contestId: c.id, name: c.name, rule: c.type === 'CF' ? 'cf' : 'icpc', pids: ps.map(p => p.id), dur: Math.round(c.dur / 60), div, ratings: ps.map(p => p.r), start: c.start, offSyl, cost })
  }
  if (!cands.length) return null
  cands.sort((x, y) => x.cost - y.cost || x.contestId - y.contestId)
  const near = cands.filter(x => x.cost <= cands[0].cost + 150).slice(0, 8)
  const { cost: _c, ...pick } = near[hash(`${date}|${cp.handle}|${opts.rev || 0}|real`) % near.length]
  return pick
}
/** per-problem facts of the newest VIRTUAL participation in `contestId` (submissions at/after `since`):
 *  at = contest seconds of the first OK, wa = rejected tries before it (compile errors and test-1 failures are free, like on CF) */
export function virtualProbs(list: CfSub[], contestId: number, since = 0, pt: 'VIRTUAL' | 'CONTESTANT' = 'VIRTUAL'): { vStart?: number; probs: RealRound['probs'] } {
  // pt CONTESTANT: the same facts for a rated round taken live (startTimeSeconds is the round's start)
  const vs = list.filter(s => s.cid === contestId && s.pt === pt && s.at >= since)
  const vstartOf = (s: CfSub) => s.vs ?? (s.rel !== null ? s.at - s.rel * 1000 : s.at)
  if (!vs.length) return { probs: {} }
  // several virtual runs of the same round: only the newest counts (starts within a minute are the same run)
  const vStart = Math.max(...vs.map(vstartOf))
  const run = vs.filter(s => Math.abs(vstartOf(s) - vStart) < 60000).sort((a, b) => (a.rel ?? (a.at - vStart) / 1000) - (b.rel ?? (b.at - vStart) / 1000) || a.id - b.id)
  const probs: RealRound['probs'] = {}
  for (const s of run) {
    const ix = s.pid.startsWith(String(contestId)) ? s.pid.slice(String(contestId).length) : s.pid.replace(/^\d+/, '')
    const x = probs[ix] ||= { wa: 0 }
    if (x.at !== undefined) continue
    if (s.v === 'OK') x.at = Math.max(0, Math.round(s.rel ?? (s.at - vStart) / 1000))
    else if (s.v !== 'COMPILATION_ERROR' && s.v !== 'SKIPPED' && !(s.tn === 0 && s.v !== 'TESTING')) x.wa++
  }
  return { vStart, probs }
}

/** the mock offset rises only when you prove it: 2 mocks in a row ≥ L+100 → +100; 2 in a row < L−100 → −100 */
export function mockOffsetRule(cp: CpState, L: number) {
  // mocks only: a rated round's perf says nothing about the syllabus mock's difficulty (and two rounds would step it)
  const fin = Object.values(cp.tests).filter(t => t.finishedAt && t.perf && !isVoidTest(t, cp) && !isContestRec(t) && sameHandle(t.h, cp.handle)).sort((a, b) => b.startedAt - a.startedAt).slice(0, 2)
  const off = cp.offsets?.mock || 0
  if (fin.length < 2) return off
  if (fin[0].startedAt <= (cp.offsets?.lastMock || 0)) return off // already stepped on this evidence
  if (fin.every(t => t.perf! >= L + 100)) return Math.min(400, off + 100)
  if (fin.every(t => t.perf! < L - 100)) return Math.max(-300, off - 100)
  return off
}
/** practice difficulty controller: clean rate over the last 14 days of drill/mixed problems → ±100 */
export function practiceOffsetRule(cp: CpState, clean: number, n: number, today = dateKey()) {
  const off = cp.offsets?.practice || 0
  if (n < 6 || cp.offsets?.practiceDay === today) return off // at most one step per day
  if (clean > 0.7) return Math.min(300, off + 100)
  if (clean < 0.4) return Math.max(-100, off - 100)
  return off
}
/** today's plan: practice session specs (coach designs or defaults) + the mock round */
export function buildPlan(date: string, sk: Skill, cp: CpState, rev = 0, specs: SessSpec[] = [], mockOffset?: number): CpPlan {
  const avoid = usedRecently(cp, date)
  const test = buildMock(date, sk, { ...cp, offsets: { ...cp.offsets, mock: mockOffset ?? cp.offsets?.mock ?? 0 } }, rev, avoid)
  return { date, practice: [], test, level: sk.level, genAt: Date.now(), rev, why: {}, calibU: cp.calibU || 0, specs, mockOffset: mockOffset ?? cp.offsets?.mock ?? 0 }
}

/** performance rating: the P at which you'd expect to solve exactly as many as you did (Elo inversion) */
export function performance(ratings: number[], solved: number) {
  if (!ratings.length) return 0
  const target = Math.min(Math.max(solved, 0.5), ratings.length - 0.5)
  let lo = 0, hi = 4500
  for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; ratings.reduce((a, r) => a + E(r, m), 0) < target ? lo = m : hi = m }
  return Math.round((lo + hi) / 2)
}
/** suggested time for one problem: ~20 min at your level, more for harder ones */
export const timeFor = (r: number, level: number) => Math.max(15, Math.min(75, Math.round((20 + Math.max(0, r - level) / 10) / 5) * 5))
export const solveXp = (r: number, level: number) => Math.round(20 + Math.max(0, r - level + 300) / 10)

export function attemptOf(pid: string): CpAttempt | undefined { return getState().cp.attempts[pid] }
