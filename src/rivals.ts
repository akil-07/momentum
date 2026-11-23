import { useEffect, useSyncExternalStore } from 'react'
import { getState, MAX_RIVALS, rivalsSet, setCp, useStore } from './store'
import { call, getCfUser, useCf, type CfRated } from './cf'

/* ═════════ rivals: rating vs days since first rated contest, you against handles you pick ═════════ */

export { MAX_RIVALS }
const R_KEY = 'momentum.rivals', TTL = 6 * 36e5
export interface RivalPt { d: number; r: number }
export interface RivalData { handle: string; rows: { at: number; r: number }[]; at: number }
export interface RivalSeries { handle: string; you?: boolean; pts: RivalPt[]; first: number; dayNow: number; rating: number }

/* ───────── per-device cache (6 h per handle) ───────── */
let cache: Record<string, RivalData> = (() => { try { return JSON.parse(localStorage.getItem(R_KEY) || 'null') || {} } catch { return {} } })()
let status: { busy: boolean; err?: string } = { busy: false }
let ver = 0
const subs = new Set<() => void>()
const bump = () => { ver++; subs.forEach(f => f()) }
const save = () => { try { localStorage.setItem(R_KEY, JSON.stringify(cache)) } catch { /* ignore */ } }
const lc = (h: string) => h.trim().toLowerCase()

/** step series: rating after each rated contest, x = whole days since that account's first rated contest */
export function toSeries(handle: string, rows: { at: number; r: number }[], now = Date.now(), you = false): RivalSeries | null {
  const a = [...rows].sort((x, y) => x.at - y.at)
  if (!a.length) return null
  const first = a[0].at
  return { handle, you, first, pts: a.map(x => ({ d: Math.floor((x.at - first) / 864e5), r: x.r })), dayNow: Math.floor((now - first) / 864e5), rating: a[a.length - 1].r }
}
/** displayed rating at day d (step: the last contest on or before d); null before the first contest or past the account's age */
export function ratingAt(s: RivalSeries, d: number): number | null {
  if (d < 0 || d > s.dayNow) return null
  let v: number | null = null
  for (const p of s.pts) { if (p.d <= d) v = p.r; else break }
  return v
}
/** "ahead of k of n": only rivals whose own history already reaches day d are compared */
export function compare(me: RivalSeries | null, rivals: RivalSeries[], d = me?.dayNow ?? 0) {
  if (!me) return null
  const mine = ratingAt(me, d)
  let k = 0, n = 0
  const rows: { handle: string; r: number; diff: number }[] = []
  for (const s of rivals) {
    const r = ratingAt(s, d); if (r === null || mine === null) continue
    n++; if (mine > r) k++
    rows.push({ handle: s.handle, r, diff: mine - r })
  }
  return { day: d, mine, ahead: k, of: n, rows: rows.sort((a, b) => a.diff - b.diff) }
}
export const youSeries = (now = Date.now()) => { const u = getCfUser(); return u ? toSeries(u.handle, (u.rated || []).map((r: CfRated) => ({ at: r.at, r: r.new })), now, true) : null }

/* ───────── list in synced state ───────── */
export async function addRival(handle: string): Promise<string | null> {
  const h = handle.trim().replace(/^@/, '')
  if (!h) return 'Type a handle'
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(h)) return 'That is not a valid Codeforces handle'
  const list = getState().cp.rivals?.list || []
  if (list.some(x => lc(x) === lc(h))) return 'Already on your list'
  const me = getState().cp.handle || getCfUser()?.handle || ''
  if (me && lc(me) === lc(h)) return "That's you"
  if (list.length >= MAX_RIVALS) return `Max ${MAX_RIVALS} rivals — remove one first`
  let canon = h
  try {
    const [info] = await call<{ handle: string }[]>('user.info', { handles: h })
    canon = info.handle
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    return /not found/i.test(m) ? `No Codeforces user "${h}"` : `Couldn't check: ${m}`
  }
  setCp(c => { const l = c.rivals?.list || []; return l.some(x => lc(x) === lc(canon)) || l.length >= MAX_RIVALS ? c : { ...c, rivals: rivalsSet(c.rivals, canon, false) } })
  void fetchRivals([canon])
  return null
}
export function removeRival(handle: string) {
  setCp(c => { const x = (c.rivals?.list || []).find(y => lc(y) === lc(handle)); return x ? { ...c, rivals: rivalsSet(c.rivals, x, true) } : c })
}

/** user.rating for each rival (rate-gated by `call`), skipping handles fetched in the last 6 h unless forced */
let queue = Promise.resolve()
export function fetchRivals(only?: string[], force = false) {
  queue = queue.then(() => fetchNow(only, force), () => fetchNow(only, force))
  return queue
}
async function fetchNow(only?: string[], force = false) {
  const list = only || getState().cp.rivals?.list || []
  const todo = list.filter(h => force || !cache[lc(h)] || Date.now() - cache[lc(h)].at > TTL)
  if (!todo.length) return
  status = { busy: true }; bump()
  const errs: string[] = []
  for (const h of todo) {
    try {
      type RawR = { handle: string; newRating: number; ratingUpdateTimeSeconds: number }
      const rows = await call<RawR[]>('user.rating', { handle: h })
      cache = { ...cache, [lc(h)]: { handle: rows[0]?.handle || h, rows: rows.map(r => ({ at: r.ratingUpdateTimeSeconds * 1000, r: r.newRating })), at: Date.now() } }
      save(); bump()
    } catch (e) { errs.push(`${h}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  status = { busy: false, err: errs.length ? errs.join(' · ') : undefined }; bump()
}

export function rivalSeries(now = Date.now(), list = getState().cp.rivals?.list || []) {
  return list.map(h => { const c = cache[lc(h)]; return c ? toSeries(c.handle, c.rows, now) || { handle: c.handle, pts: [], first: 0, dayNow: -1, rating: 0 } : null })
    .filter((x): x is RivalSeries => !!x)
}

/** short line for the coach (motivation only) */
export function rivalsSummary(now = Date.now()) {
  const me = youSeries(now), rv = rivalSeries(now).filter(r => r.pts.length), c = compare(me, rv)
  if (!rv.length) return null
  if (!me || !c) return `${rv.length} rivals tracked; no rated contest yet`
  return c.of ? `ahead of ${c.ahead} of ${c.of} rivals at day ${c.day}` : `no rival had reached day ${c.day} yet`
}

/** reactive: your series + the rivals' (fetches stale ones on mount / list change) */
export function useRivals() {
  useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => ver)
  useCf()
  const list = useStore(s => s.cp.rivals?.list) || []
  const key = list.join(',')
  useEffect(() => { void fetchRivals() }, [key])
  const me = youSeries(), rivals = rivalSeries(Date.now(), list)
  return { me, rivals, list, status, cmp: compare(me, rivals.filter(r => r.pts.length)), refresh: () => fetchRivals(undefined, true) }
}
