import { useSyncExternalStore } from 'react'
import { call, getCfUser, tierOf } from './cf'

/* ═════════ Rating-leverage engine ═════════
   The Codeforces rating formula (Mirzayanov 2015, as in Carrot / cf-predictor), run locally on real rounds:
   re-rank the user inside the real standings with changed times / solves and read off the delta they would have got.
   cfDeltas is the formula itself (exact on pre-2020 rounds). Since 2020 CF rates with hidden internal ratings for
   provisional accounts and drops removed cheaters from the published field, so ContestData carries a per-contest
   calibration (stage inference + residual by place and rating) fitted to the real changes; placements use that. */

export interface ProbResult { at?: number; wa: number }
/** one rated participant. `oldRating`/`newRating` are what CF displays; `eff` is the rating the formula really used
 *  (1400 for a first contest, displayed + unreceived boosts while provisional). `known` = their standings row was returned
 *  (the anonymous standings API omits part of the field), so points/penalty/probs are real; otherwise they are -1/0/{} */
export interface ContestRow { handle: string; oldRating: number; newRating?: number; rank: number; points: number; penalty: number; probs: Record<string, ProbResult>; eff?: number; known?: boolean }
export interface ContestData {
  contestId: number; name: string; rule: 'icpc' | 'cf'; start: number; dur: number
  problems: { index: string; points?: number; rating?: number; tags: string[] }[]
  rows: ContestRow[]
  /** the delta correction calibrated from the real rating changes (see inferEff) */
  adj?: Calib
}
export interface Placement { rank: number; of: number; delta: number; perf: number; points: number; penalty: number }
export interface WhatIf { contestId: number; name: string; label: string; key: string; delta: number }
export interface Lever { key: string; label: string; pos?: string; kind: 'speed' | 'solve' | 'penalty'; perContest: number; n: number }
/** `check`: per analysed contest the real (boost-free) delta vs. what the model reproduces from the user's own row */
export interface Leverage {
  /** lower-cased CF handle the levers were computed for */
  handle?: string
  at: number; contests: number; levers: Lever[]; whatIfs: WhatIf[]; speedTable: Record<string, number>; targetTier: number
  check?: { contestId: number; real: number; model: number }[]
}

/* ───────── new-account handling ─────────
   Since 2020 a new account is computed as 1400 but displayed as 0, then handed these boosts over its first 6 contests.
   OFF[k] = internal − displayed after k rated contests. */
export const BOOST = [500, 350, 250, 150, 100, 50]
export const OFF = [1400, 900, 550, 300, 150, 50, 0]

/* ───────── the formula ───────── */
const KOFF = 16000, TMIN = -4000, TMAX = 8000
let KER: Float64Array | null = null
/** K[d] = P(b beats x) where d = x − b */
const ker = () => KER ||= (() => { const k = new Float64Array(2 * KOFF + 1); for (let d = -KOFF; d <= KOFF; d++) k[d + KOFF] = 1 / (1 + Math.pow(10, d / 400)); return k })()
const kp = (d: number) => ker()[Math.max(-KOFF, Math.min(KOFF, d)) + KOFF]

/** seed table of a field: 1 + Σ_b P(b beats x), filled lazily per integer x */
interface Field { vals: Int32Array; cnts: Float64Array; tab: Float64Array }
function field(ratings: number[]): Field {
  const m = new Map<number, number>(); for (const r of ratings) m.set(r, (m.get(r) || 0) + 1)
  const vals = new Int32Array(m.size), cnts = new Float64Array(m.size); let i = 0
  for (const [v, c] of m) { vals[i] = v; cnts[i++] = c }
  return { vals, cnts, tab: new Float64Array(TMAX - TMIN + 1).fill(NaN) }
}
function seedOf(f: Field, x: number) {
  x = Math.max(TMIN, Math.min(TMAX, Math.round(x)))
  let v = f.tab[x - TMIN]
  if (v !== v) { v = 1; const k = ker(), { vals, cnts } = f; for (let j = 0; j < vals.length; j++) v += cnts[j] * k[x - vals[j] + KOFF]; f.tab[x - TMIN] = v }
  return v
}

/** test knobs: excl = leave self out of the need-rating seed (Carrot; matches CF exactly), fr = field rating, noInfer/noRating = skip stage inference / rating calibration */
export const _cfg: { excl: boolean; fr?: (r: ContestRow) => number; noInfer?: boolean; noRating?: boolean } = { excl: true }
/** one contestant's uncorrected delta at rating r and (tie-last) place pos */
function rawDelta(r: number, pos: number, seed: (x: number) => number) {
  const mid = Math.sqrt(pos * (seed(r) - 0.5)), ex = _cfg.excl ? 1 : 0
  let lo = 1, hi = 8000
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (seed(m) - ex * kp(m - r) < mid) hi = m; else lo = m }
  return Math.trunc((lo - r) / 2)
}
/** the formula ranks a tie group at its LAST place */
function tieLast(rnk: number[]) {
  const n = rnk.length, ord = rnk.map((_, i) => i).sort((a, b) => rnk[a] - rnk[b]), pos = new Array<number>(n)
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && rnk[ord[j + 1]] === rnk[ord[i]]) j++; for (let t = i; t <= j; t++) pos[ord[t]] = j + 1; i = j + 1 }
  return pos
}
/** core: ratings (as computed), ranks (CF place, ties share the first place), field seed fn → deltas */
function core(rat: number[], rnk: number[], seed: (x: number) => number): number[] {
  const n = rat.length; if (!n) return []
  const pos = tieLast(rnk), d = rat.map((r, i) => rawDelta(r, pos[i], seed))
  let sum = 0; for (const x of d) sum += x
  const inc = Math.trunc(-sum / n) - 1; for (let i = 0; i < n; i++) d[i] += inc
  // the top 4·√n by rating must not gain in total
  const byR = rat.map((_, i) => i).sort((a, b) => rat[b] - rat[a] || pos[a] - pos[b])
  const z = Math.min(4 * Math.round(Math.sqrt(n)), n); let s2 = 0; for (let i = 0; i < z; i++) s2 += d[byR[i]]
  const inc2 = Math.min(Math.max(Math.trunc(-s2 / z), -10), 0); for (let i = 0; i < n; i++) d[i] += inc2
  return d
}

/** official CF rating changes for a finished contest's rated rows (ratings + ranks); returns deltas in row order.
 *  `rating` is the rating the formula uses (1400 for a first contest; see ContestRow.eff) */
export function cfDeltas(rows: { rating: number; rank: number }[]): number[] {
  const rat = rows.map(r => Math.round(r.rating)), f = field(rat)
  return core(rat, rows.map(r => r.rank), x => seedOf(f, x))
}

/* ───────── scoring ───────── */
/** contest score under its rules for a set of per-problem results (`at` = seconds from start) */
export function scoreFor(cd: ContestData, probs: Record<string, ProbResult>): { points: number; penalty: number } {
  let points = 0, penalty = 0
  for (const p of cd.problems) {
    const r = probs[p.index]; if (!r || r.at === undefined) continue
    const m = Math.floor(r.at / 60)
    if (cd.rule === 'icpc') { points++; penalty += m + 10 * r.wa }
    else { const x = p.points || 500; points += Math.max(0.3 * x, x - m * x / 250 - 50 * r.wa) }
  }
  return { points, penalty }
}
const better = (a: { points: number; penalty: number }, b: { points: number; penalty: number }) => a.points - b.points > 1e-9 || (Math.abs(a.points - b.points) <= 1e-9 && a.penalty < b.penalty)
const same = (a: { points: number; penalty: number }, b: { points: number; penalty: number }) => Math.abs(a.points - b.points) <= 1e-9 && a.penalty === b.penalty

/* ───────── placement ───────── */
const effOf = (r: ContestRow) => r.eff ?? (r.oldRating || 1400)
/** what the others count as in the field: displayed rating, 1400 for first-timers (fits real changes better than internal ratings) */
const fieldRating = (r: ContestRow) => r.oldRating || 1400
const baseField = new WeakMap<ContestData, Field>()
const knownSorted = new WeakMap<ContestData, ContestRow[]>()
function fieldOf(cd: ContestData) { let f = baseField.get(cd); if (!f) baseField.set(cd, f = field(cd.rows.map(_cfg.fr || fieldRating))); return f }

/** my rank among the full rated field: exact where known rows bracket me, interpolated across rows the API omitted */
function rankOf(cd: ContestData, me: { points: number; penalty: number }) {
  let ks = knownSorted.get(cd)
  if (!ks) knownSorted.set(cd, ks = cd.rows.filter(r => r.known).sort((a, b) => a.rank - b.rank))
  const tie = ks.find(r => same(r, me)); if (tie) return { rank: tie.rank, shared: true }
  let lo = 0, hi = ks.length // first known row not strictly better than me
  while (lo < hi) { const m = (lo + hi) >> 1; if (better(ks[m], me)) lo = m + 1; else hi = m }
  const prev = ks[lo - 1], next = ks[lo]
  const ranks = cd.rows.map(r => r.rank)
  const pr = prev ? prev.rank : 0, nr = next ? next.rank : Infinity
  const atOrAbove = ranks.filter(x => x <= pr).length, gap = ranks.filter(x => x > pr && x < nr).length
  let f = 0.5
  if (prev && next) {
    const key = (s: { points: number; penalty: number }) => cd.rule === 'cf' ? s.points : s.points * 1e6 - s.penalty
    const a = key(prev), b = key(next), x = key(me)
    if (a !== b) f = Math.min(1, Math.max(0, (a - x) / (a - b)))
  } else if (!next) f = 1
  return { rank: atOrAbove + Math.round(f * gap) + 1, shared: false }
}

function place(cd: ContestData, rating: number, probs: Record<string, ProbResult>, withPerf: boolean): Placement | null {
  if (!cd.rows.length) return null
  const sc = scoreFor(cd, probs), { rank, shared } = rankOf(cd, sc), f = fieldOf(cd)
  const others = cd.rows.map(r => shared || r.rank < rank ? r.rank : r.rank + 1)
  const ranks = [...others, rank], base = cd.rows.map(effOf)
  let myPos = 1; for (const x of others) if (x <= rank) myPos++
  const deltaAt = (r: number) => {
    r = Math.round(r)
    const seed = (x: number) => seedOf(f, x) + kp(Math.round(x) - r)
    if (cd.adj) return rawDelta(r, myPos, seed) + corr(cd.adj, myPos, r)
    const d = core([...base, r], ranks, seed)
    return d[d.length - 1]
  }
  const delta = deltaAt(rating)
  let perf = rating
  if (withPerf) { let lo = -1000, hi = 4500; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (deltaAt(m) > 0) lo = m; else hi = m } perf = hi }
  return { rank, of: cd.rows.length + 1, delta, perf, points: sc.points, penalty: sc.penalty }
}
/** insert a participant with `rating` (as computed: 1400 for a brand-new account) and `probs` into the real standings → rank, delta, performance */
export function placeInto(cd: ContestData, rating: number, probs: Record<string, ProbResult>): Placement | null { return place(cd, rating, probs, true) }
/** the contest with one participant taken out (to re-place them) */
export function without(cd: ContestData, handle: string): ContestData {
  const h = handle.toLowerCase(), me = cd.rows.find(r => r.handle.toLowerCase() === h)
  if (!me) return cd
  const tied = cd.rows.some(o => o !== me && o.rank === me.rank)
  return { ...cd, rows: cd.rows.filter(r => r !== me).map(r => r.rank > me.rank && !tied ? { ...r, rank: r.rank - 1 } : r) }
}

/* ───────── provisional inference ─────────
   ratingChanges shows displayed ratings; for a provisional participant the formula used displayed + OFF[k]. We know k only for
   first-timers (oldRating 0), so the rest are inferred: pick the k whose boost-adjusted delta matches the real change. */
/** additive correction: by place (p) + by rating (r), each as [x, value] knots, linear between */
export interface Calib { p: [number, number][]; r: [number, number][] }
function knot(k: [number, number][], x: number) {
  if (!k.length) return 0
  if (x <= k[0][0]) return k[0][1]
  let i = 0; while (i + 1 < k.length && k[i + 1][0] <= x) i++
  if (i + 1 >= k.length) return k[i][1]
  const [x0, y0] = k[i], [x1, y1] = k[i + 1]
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
}
export const corr = (c: Calib, pos: number, rating: number) => Math.round(knot(c.p, pos) + knot(c.r, rating))
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
/** knots of the median residual over groups of `per` consecutive items in `order` */
function knotsOf(order: number[], x: (i: number) => number, res: (i: number) => number, per: number): [number, number][] {
  const out: [number, number][] = []
  for (let s = 0; s < order.length; s += per) {
    const g = order.slice(s, s + per), v = g.map(res).filter(y => y === y)
    if (v.length >= 10) out.push([(x(g[0]) + x(g[g.length - 1])) / 2, median(v)])
  }
  return out
}
/** infers each row's computed rating (provisional stage) and the contest's correction.
   CF's own correction is one number per contest, but the field it rated (removed cheaters, hidden internal ratings of
   provisional accounts) isn't fully public — so the residual of rows whose stage is certain is read off by place and rating. */
export function inferEff(rows: ContestRow[], bound = false): Calib {
  const n = rows.length, pos = tieLast(rows.map(r => r.rank))
  for (const r of rows) r.eff = r.oldRating === 0 ? 1400 : r.oldRating
  let cal: Calib = { p: [], r: [] }
  const byPos = rows.map((_, i) => i).sort((a, b) => pos[a] - pos[b]), per = Math.max(50, Math.ceil(n / 48))
  for (let it = 0; it < 8; it++) {
    const f = field(rows.map(_cfg.fr || fieldRating)), seed = (x: number) => seedOf(f, x)
    const raw = rows.map((r, i) => rawDelta(effOf(r), pos[i], seed))
    // anchors: first-timers and rows currently taken as settled
    const res: number[] = rows.map((r, i) => r.newRating === undefined ? NaN : r.oldRating === 0 ? r.newRating - BOOST[0] - raw[i] : r.eff === r.oldRating ? r.newRating - r.oldRating - raw[i] : NaN)
    const byR = rows.map((_, i) => i).sort((a, b) => effOf(rows[a]) - effOf(rows[b]))
    cal = { p: knotsOf(byPos, i => pos[i], i => res[i], per), r: [] }
    if (!_cfg.noRating) for (let t = 0; t < 2; t++) {
      cal.r = knotsOf(byR, i => effOf(rows[i]), i => res[i] - knot(cal.p, pos[i]), per)
      cal.p = knotsOf(byPos, i => pos[i], i => res[i] - knot(cal.r, effOf(rows[i])), per)
    }
    let moved = 0
    rows.forEach((r, i) => {
      if (r.oldRating === 0 || r.newRating === undefined || _cfg.noInfer) return
      const real = r.newRating - r.oldRating, k0 = OFF.indexOf(r.eff! - r.oldRating)
      if (raw[i] + corr(cal, pos[i], effOf(r)) + (BOOST[k0] || 0) === real) return
      // the provisional stage whose own delta (same field) + boost lands closest to the real change;
      // the anonymous standings list only participants with 5+ earlier rated rounds: that bounds the stage
      let bk = k0, err = Infinity
      for (let k = 6; k >= 1; k--) {
        if (bound && (r.known ? k < 5 : k > 4)) continue
        const e2 = r.oldRating + OFF[k], e = Math.abs(rawDelta(e2, pos[i], seed) + corr(cal, pos[i], e2) + (BOOST[k] || 0) - real)
        if (e < err) { err = e; bk = k }
      }
      const ne = r.oldRating + OFF[bk]; if (ne !== r.eff) { r.eff = ne; moved++ }
    })
    if (!moved) break
  }
  return cal
}

/* ───────── contest data (network + compact cache) ───────── */
const mem = new Map<number, ContestData>()
const ls = {
  get(k: string) { try { return localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); return true } catch { return false } },
  del(k: string) { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}
// the contest-data cache used to live in localStorage (and filled its quota): drop the old entries
try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith('momentum.cd.')) localStorage.removeItem(k) } } catch { /* ignore */ }
/* packed contests live in IndexedDB ('data': id → packed string, 'meta': {id, size, t}), LRU-evicted by total size;
   without IndexedDB the cache is memory-only */
const CD_CAP = 40e6 // chars
type CdMeta = { id: number; size: number; t: number }
const idb = (() => {
  let db: Promise<IDBDatabase | null> | null = null
  const open = () => db ||= new Promise<IDBDatabase | null>(res => {
    try {
      const r = indexedDB.open('momentum-cd', 1)
      r.onupgradeneeded = () => { r.result.createObjectStore('data'); r.result.createObjectStore('meta', { keyPath: 'id' }) }
      r.onsuccess = () => res(r.result); r.onerror = r.onblocked = () => res(null)
    } catch { res(null) }
  })
  const tx = async <T>(f: (t: IDBTransaction, out: (v: T) => void) => void, dflt: T): Promise<T> => {
    const d = await open(); if (!d) return dflt
    return new Promise<T>(res => {
      let v = dflt
      try {
        const t = d.transaction(['data', 'meta'], 'readwrite')
        t.oncomplete = () => res(v); t.onerror = t.onabort = () => res(dflt)
        f(t, x => { v = x })
      } catch { res(dflt) }
    })
  }
  return {
    get: (id: number) => tx<string | null>((t, out) => {
      const r = t.objectStore('data').get(id)
      r.onsuccess = () => { const s = r.result as string | undefined; if (s) { out(s); t.objectStore('meta').put({ id, size: s.length, t: Date.now() }) } }
    }, null),
    put: (id: number, s: string) => tx<boolean>((t, out) => {
      const data = t.objectStore('data'), meta = t.objectStore('meta'), r = meta.getAll()
      r.onsuccess = () => {
        const all = (r.result as CdMeta[]).filter(m => m.id !== id).sort((a, b) => a.t - b.t)
        let total = all.reduce((x, m) => x + m.size, 0)
        if (s.length > CD_CAP) { data.delete(id); meta.delete(id); return } // too big on its own: memory only
        while (all.length && total + s.length > CD_CAP) { const m = all.shift()!; total -= m.size; data.delete(m.id); meta.delete(m.id) }
        data.put(s, id); meta.put({ id, size: s.length, t: Date.now() }); out(true)
      }
    }, false),
  }
})()
// compact: columns + one string per row of per-problem "minute.wa" ("" = untouched, "-wa" = unsolved with rejections)
function pack(cd: ContestData) {
  const P = cd.problems.map(p => p.index)
  return JSON.stringify({ v: 1, c: cd.adj ?? null, i: cd.contestId, n: cd.name, u: cd.rule, s: cd.start, d: cd.dur, p: cd.problems,
    h: cd.rows.map(r => r.handle).join(' '), o: cd.rows.map(r => r.oldRating), w: cd.rows.map(r => r.newRating ?? null),
    e: cd.rows.map(r => effOf(r) - (r.oldRating || 0)), r: cd.rows.map(r => r.rank),
    x: cd.rows.map(r => r.known ? [r.points, r.penalty, P.map(k => { const q = r.probs[k]; return !q ? '' : q.at === undefined ? `-${q.wa}` : `${Math.floor(q.at / 60)}${q.wa ? '.' + q.wa : ''}` }).join(',').replace(/,+$/, '')] : 0) })
}
function unpack(s: string): ContestData | null {
  try {
    const j = JSON.parse(s); if (j.v !== 1) return null
    const P: string[] = j.p.map((p: { index: string }) => p.index), H: string[] = j.h ? j.h.split(' ') : []
    const rows: ContestRow[] = H.map((handle, i) => {
      const x = j.x[i], probs: Record<string, ProbResult> = {}
      if (x) (x[2] as string).split(',').forEach((c, k) => {
        if (!c) return
        if (c[0] === '-') probs[P[k]] = { wa: +c.slice(1) }
        else { const [m, w] = c.split('.'); probs[P[k]] = { at: +m * 60, wa: +(w || 0) } }
      })
      return { handle, oldRating: j.o[i], newRating: j.w[i] ?? undefined, eff: (j.o[i] || 0) + j.e[i], rank: j.r[i], points: x ? x[0] : -1, penalty: x ? x[1] : 0, probs, known: !!x }
    })
    return { contestId: j.i, name: j.n, rule: j.u, start: j.s, dur: j.d, problems: j.p, rows, adj: j.c ?? undefined }
  } catch { return null }
}
function save(cd: ContestData) { void idb.put(cd.contestId, pack(cd)) }

type RawRC = { handle: string; rank: number; oldRating: number; newRating: number }
type RawStand = {
  contest: { id: number; name: string; type: string; startTimeSeconds?: number; durationSeconds: number; phase: string }
  problems: { index: string; points?: number; rating?: number; tags: string[] }[]
  rows: { party: { members: { handle: string }[]; participantType: string }; points: number; penalty: number; rank: number; problemResults: { points: number; rejectedAttemptCount: number; bestSubmissionTimeSeconds?: number }[] }[]
}
/** build ContestData from raw API results (exported for tests / offline use) */
export function buildContestData(rc: RawRC[], st: RawStand): ContestData {
  const rule: 'icpc' | 'cf' = st.contest.type === 'CF' ? 'cf' : 'icpc'
  const byH = new Map(st.rows.filter(r => r.party.members.length === 1).map(r => [r.party.members[0].handle.toLowerCase(), r]))
  const rows: ContestRow[] = rc.map(c => {
    const s = byH.get(c.handle.toLowerCase())
    const probs: Record<string, ProbResult> = {}
    if (s) s.problemResults.forEach((p, k) => {
      const idx = st.problems[k]?.index; if (!idx) return
      if (p.points > 0 && p.bestSubmissionTimeSeconds !== undefined) probs[idx] = { at: p.bestSubmissionTimeSeconds, wa: p.rejectedAttemptCount }
      else if (p.rejectedAttemptCount) probs[idx] = { wa: p.rejectedAttemptCount }
    })
    return { handle: c.handle, oldRating: c.oldRating, newRating: c.newRating, rank: c.rank, points: s ? s.points : -1, penalty: s ? s.penalty : 0, probs, known: !!s }
  })
  const adj = inferEff(rows, rows.some(r => !r.known))
  return { contestId: st.contest.id, name: st.contest.name, rule, start: (st.contest.startTimeSeconds || 0) * 1000, dur: st.contest.durationSeconds,
    problems: st.problems.map(p => ({ index: p.index, points: p.points, rating: p.rating, tags: p.tags || [] })), rows, adj }
}
/** every row's delta (as computed, boosts excluded) under the calibrated model */
export function modelDeltas(cd: ContestData): number[] {
  const f = fieldOf(cd), pos = tieLast(cd.rows.map(r => r.rank)), seed = (x: number) => seedOf(f, x)
  if (!cd.adj) return core(cd.rows.map(effOf), cd.rows.map(r => r.rank), seed)
  return cd.rows.map((r, i) => rawDelta(effOf(r), pos[i], seed) + corr(cd.adj!, pos[i], effOf(r)))
}

const loading = new Map<number, Promise<ContestData | null>>()
/** ratingChanges + standings, cached; null when not available (unrated / too new / offline) */
export async function loadContestData(contestId: number): Promise<ContestData | null> {
  const hit = mem.get(contestId); if (hit) return hit
  let p = loading.get(contestId)
  if (!p) {
    p = (async () => {
      try {
        const s = await idb.get(contestId), c = s && unpack(s)
        if (c) { mem.set(contestId, c); return c }
        const rc = await call<RawRC[]>('contest.ratingChanges', { contestId })
        if (!rc.length) return null
        // the API only serves non-gym standings to anonymous GETs with no extra parameters
        const st = await call<RawStand>('contest.standings', { contestId })
        if (st.contest.phase !== 'FINISHED') return null
        const cd = buildContestData(rc, st)
        mem.set(contestId, cd); save(cd)
        return cd
      } catch { return null } finally { loading.delete(contestId) }
    })()
    loading.set(contestId, p)
  }
  return p
}

/** virtual participation result: re-rank into the real contest (`rating` as computed; 0 → treated as a first contest, 1400) */
export async function virtualResult(contestId: number, probs: Record<string, ProbResult>, rating: number): Promise<Placement | null> {
  const cd = await loadContestData(contestId)
  return cd ? placeInto(cd, rating || 1400, probs) : null
}

/* ───────── leverage ───────── */
const LV_KEY = 'momentum.leverage'
let lev: Leverage | null = (() => { try { return JSON.parse(ls.get(LV_KEY) || 'null') } catch { return null } })()
const lsubs = new Set<() => void>()
const posOf = (index: string) => index.replace(/\d+$/, '')

type RawSub = { relativeTimeSeconds?: number; verdict?: string; passedTestCount?: number; problem: { index: string }; author?: { participantType?: string } }
/** the user's per-problem results in a contest from their submissions (when the standings omitted their row) */
async function probsFromSubs(cid: number, handle: string): Promise<Record<string, ProbResult>> {
  const u = getCfUser()
  let subs: RawSub[]
  const own = u && u.handle.toLowerCase() === handle.toLowerCase() && u.list ? u.list.filter(s => s.cid === cid && s.pt === 'CONTESTANT') : []
  if (own.length) subs = own.map(s => ({ relativeTimeSeconds: s.rel ?? undefined, verdict: s.v, passedTestCount: s.tn, problem: { index: s.pid.slice(String(cid).length) }, author: { participantType: s.pt } }))
  else subs = (await call<RawSub[]>('contest.status', { contestId: cid, handle }).catch(() => [] as RawSub[])).filter(s => s.author?.participantType === 'CONTESTANT')
  const out: Record<string, ProbResult> = {}
  for (const s of [...subs].sort((a, b) => (a.relativeTimeSeconds ?? 0) - (b.relativeTimeSeconds ?? 0))) {
    const k = s.problem.index, r = out[k] ||= { wa: 0 }
    if (r.at !== undefined) continue
    if (s.verdict === 'OK') r.at = s.relativeTimeSeconds ?? 0
    else if (s.verdict && s.verdict !== 'COMPILATION_ERROR' && s.verdict !== 'SKIPPED' && (s.passedTestCount ?? 0) > 0) r.wa++
  }
  for (const k of Object.keys(out)) if (out[k].at === undefined && !out[k].wa) delete out[k]
  return out
}

let running: Promise<Leverage | null> | null = null, runningH = ''
/** recompute levers from the user's last n rated contests (network) */
export function refreshLeverage(handle: string, n = 6): Promise<Leverage | null> {
  const h = handle.toLowerCase()
  if (running && runningH === h) return running
  const p = (async () => {
    try {
      type RawR = { contestId: number; contestName: string; rank: number; oldRating: number; newRating: number }
      const u = getCfUser()
      const rated: { cid: number; old: number; new: number }[] = u && u.handle.toLowerCase() === handle.toLowerCase() && u.rated
        ? u.rated : (await call<RawR[]>('user.rating', { handle })).map(r => ({ cid: r.contestId, old: r.oldRating, new: r.newRating }))
      if (!rated.length) return null
      const fresh = rated[0].old === 0 // new rating system: 1400 internal, boosts while provisional
      const offAt = (k: number) => fresh ? OFF[Math.min(k, 6)] : 0
      const effNow = rated[rated.length - 1].new + offAt(rated.length)
      const tier = tierOf(effNow), targetTier = tier.next ?? tier.from
      const whatIfs: WhatIf[] = [], check: Leverage['check'] = [], gains = new Map<string, { label: string; pos?: string; kind: Lever['kind']; sum: number; n: number; cut: number }>()
      const solveTimes = new Map<string, number[]>()
      let done = 0
      for (let k = Math.max(0, rated.length - n); k < rated.length; k++) {
        const rr = rated[k], cd0 = await loadContestData(rr.cid); if (!cd0) continue
        const mine = cd0.rows.find(r => r.handle.toLowerCase() === handle.toLowerCase())
        const probs = mine?.known ? mine.probs : await probsFromSubs(rr.cid, handle)
        const cd = without(cd0, handle), eff = rr.old === 0 ? 1400 : rr.old + offAt(k)
        const base = place(cd, eff, probs, false); if (!base) continue
        done++
        check.push({ contestId: rr.cid, real: rr.new - rr.old - (fresh && k < 6 ? BOOST[k] : 0), model: base.delta })
        // split problems (D1/D2) share a lever key: each key counts once per contest, with its best what-if
        const best = new Map<string, { g: number; kind: Lever['kind']; pos?: string; cut: number }>()
        const add = (key: string, label: string, kind: Lever['kind'], p: Record<string, ProbResult>, pos?: string, cut = 0) => {
          const r = place(cd, eff, p, false); if (!r) return
          const g = r.delta - base.delta
          whatIfs.push({ contestId: rr.cid, name: cd.name, label, key, delta: g })
          const b = best.get(key); if (!b || g > b.g) best.set(key, { g, kind, pos, cut })
        }
        // peers: rated near the user's own rating who solved each problem
        const peers = cd.rows.filter(r => r.known && Math.abs(effOf(r) - eff) <= 100)
        let nextUnsolved = 0
        for (const p of cd.problems) {
          const me = probs[p.index], pos = posOf(p.index)
          if (me?.at !== undefined) {
            const cut = Math.min(600, me.at * 0.5); if (cut < 60) continue
            add(`speed:${pos}`, `${p.index} ${Math.round(cut / 60)} min faster`, 'speed', { ...probs, [p.index]: { ...me, at: me.at - cut } }, pos, cut)
          } else if (nextUnsolved < 2) {
            nextUnsolved++
            let ts = peers.map(r => r.probs[p.index]?.at).filter((x): x is number => x !== undefined)
            if (ts.length < 3) ts = cd.rows.map(r => r.probs[p.index]?.at).filter((x): x is number => x !== undefined)
            if (!ts.length) continue
            add(`solve:${pos}`, `Solve ${p.index}`, 'solve', { ...probs, [p.index]: { at: Math.round(median(ts)), wa: 0 } }, pos)
          }
        }
        if (Object.values(probs).some(q => q.at !== undefined && q.wa)) {
          const z: Record<string, ProbResult> = {}; for (const [i, q] of Object.entries(probs)) z[i] = q.at !== undefined ? { at: q.at, wa: 0 } : q
          add('penalty', 'No wrong submissions', 'penalty', z)
        }
        for (const [key, b] of best) {
          const a = gains.get(key) || { label: '', pos: b.pos, kind: b.kind, sum: 0, n: 0, cut: 0 }
          a.sum += b.g; a.n++; a.cut += b.cut
          a.label = b.kind === 'speed' ? `${b.pos} ${Math.round(a.cut / a.n / 60)} min faster` : b.kind === 'solve' ? `Solve ${b.pos}` : 'No wrong submissions'
          gains.set(key, a)
        }
        // speed targets: solve minutes of participants rated around the next tier
        for (const r of cd.rows) if (r.known && Math.abs(effOf(r) - targetTier) <= 150)
          for (const [i, q] of Object.entries(r.probs)) if (q.at !== undefined) { const ps = posOf(i), a = solveTimes.get(ps) || []; a.push(q.at / 60); solveTimes.set(ps, a) }
      }
      if (!done) return null
      const levers: Lever[] = [...gains].map(([key, g]) => ({ key, label: g.label, pos: g.pos, kind: g.kind, perContest: Math.round(g.sum / done * 10) / 10, n: g.n }))
        .sort((a, b) => b.perContest - a.perContest)
      const speedTable: Record<string, number> = {}
      for (const ps of [...solveTimes.keys()].sort()) { const t = solveTimes.get(ps)!; if (t.length >= 5 && /^[A-F]$/.test(ps)) speedTable[ps] = Math.round(median(t)) }
      const out: Leverage = { handle: h, at: Date.now(), contests: done, levers, whatIfs, speedTable, targetTier, check }
      // the linked handle changed while this ran: don't let it overwrite the current account's levers
      if (getCfUser()?.handle.toLowerCase() !== h) return out
      lev = out; ls.set(LV_KEY, JSON.stringify(lev)); lsubs.forEach(f => f())
      return lev
    } catch { return null }
  })()
  running = p; runningH = h; p.finally(() => { if (running === p) running = null })
  return p
}
/** the stored levers, only when they belong to the linked handle */
export function getLeverage(): Leverage | null { const u = getCfUser(); return lev && u && lev.handle === u.handle.toLowerCase() ? lev : null }
export function useLeverage(): Leverage | null { return useSyncExternalStore(cb => { lsubs.add(cb); return () => { lsubs.delete(cb) } }, getLeverage) }
