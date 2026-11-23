import type { CpEvent, CpSession, CpState, ProbSummary } from './store'

/* ═════════ time & error analytics over the synced event log (pure, deterministic) ═════════ */

export const IDLE_CAP = 25 * 60 // seconds: longer gaps don't count as working on a problem

export interface Sub { at: number; v: string; tn?: number; ms?: number; mem?: number; rel?: number; pt?: string }
export interface Timeline {
  pid: string; firstOpen?: number; firstSub?: number; acAt?: number; subs: Sub[]
  hint: number; editorial: boolean; gaveUp: boolean; resourceMin: number
  debrief?: { blk?: string; ed?: string; felt?: string; n?: string }; notes: string[]
}

export function eventsByPid(cp: CpState): Map<string, CpEvent[]> {
  const m = new Map<string, CpEvent[]>()
  for (const e of Object.values(cp.events || {})) { const a = m.get(e.pid); a ? a.push(e) : m.set(e.pid, [e]) }
  for (const a of m.values()) a.sort((x, y) => x.at - y.at)
  return m
}

export function timeline(pid: string, evs: CpEvent[] = []): Timeline {
  const t: Timeline = { pid, subs: [], hint: 0, editorial: false, gaveUp: false, resourceMin: 0, notes: [] }
  for (const e of evs) {
    if (e.k === 'open') t.firstOpen = Math.min(t.firstOpen ?? Infinity, e.at)
    else if (e.k === 'sub') {
      t.subs.push({ at: e.at, v: e.v || '?', tn: e.tn, ms: e.ms, mem: e.mem, rel: e.rel, pt: e.pt })
      t.firstSub = Math.min(t.firstSub ?? Infinity, e.at)
      if (e.v === 'OK') t.acAt = Math.min(t.acAt ?? Infinity, e.at)
    } else if (e.k === 'ac') t.acAt = Math.min(t.acAt ?? Infinity, e.at)
    else if (e.k === 'hint') t.hint = Math.max(t.hint, e.hl || 0)
    else if (e.k === 'editorial') { t.editorial = true; t.hint = Math.max(t.hint, 3) }
    else if (e.k === 'giveup') t.gaveUp = true
    else if (e.k === 'resource') t.resourceMin += e.mins || 0
    else if (e.k === 'debrief') t.debrief = { blk: e.blk, ed: e.ed, felt: e.felt, n: e.n }
    else if (e.k === 'note' && e.n) t.notes.push(e.n)
  }
  return t
}

const SHORT: Record<string, string> = {
  OK: 'OK', WRONG_ANSWER: 'WA', TIME_LIMIT_EXCEEDED: 'TLE', MEMORY_LIMIT_EXCEEDED: 'MLE', RUNTIME_ERROR: 'RE',
  COMPILATION_ERROR: 'CE', IDLENESS_LIMIT_EXCEEDED: 'ILE', CHALLENGED: 'HACKED', SKIPPED: 'SKIP', PARTIAL: 'PART',
}
export const shortV = (v: string) => SHORT[v] || v
/** e.g. "WA@3m(t5), TLE@12m(t9), OK@19m" — minutes since the problem was opened (or first submission) */
export function verdictChain(t: Timeline) {
  const t0 = t.firstOpen ?? t.firstSub ?? 0
  return t.subs.map(s => `${shortV(s.v)}@${Math.max(0, Math.round((s.at - t0) / 60000))}m${s.v !== 'OK' && s.tn !== undefined ? `(t${s.tn + 1})` : ''}`).join(', ')
}

/* ───────── error classes (deterministic from verdicts) ───────── */
export type ErrClass = 'sample_fail' | 'edge_or_bug' | 'wrong_idea' | 'complexity' | 'bounds' | 'memory' | 'fst_edge' | 'compile'
export function classify(t: Timeline): ErrClass[] {
  const out: ErrClass[] = []
  const ac = t.acAt
  t.subs.forEach((s, i) => {
    if (s.v === 'OK') return
    const later = t.subs.slice(i + 1), fixedSoon = ac !== undefined && later.findIndex(x => x.v === 'OK') <= 2 && t.hint < 3
    if (s.v === 'WRONG_ANSWER') out.push((s.tn ?? 1) === 0 ? 'sample_fail' : fixedSoon ? 'edge_or_bug' : 'wrong_idea')
    else if (s.v === 'TIME_LIMIT_EXCEEDED') out.push('complexity')
    else if (s.v === 'RUNTIME_ERROR') out.push('bounds')
    else if (s.v === 'MEMORY_LIMIT_EXCEEDED') out.push('memory')
    else if (s.v === 'CHALLENGED') out.push('fst_edge')
    else if (s.v === 'COMPILATION_ERROR') out.push('compile')
  })
  return out
}
export function recurringErrors(byPid: Map<string, CpEvent[]>, sinceMs: number) {
  const n: Record<string, number> = {}
  for (const [pid, evs] of byPid) {
    if (!evs.some(e => e.at >= sinceMs)) continue
    for (const c of classify(timeline(pid, evs.filter(e => e.at >= sinceMs)))) n[c] = (n[c] || 0) + 1
  }
  return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([cls, count]) => ({ cls, count, recurring: count >= 3 }))
}

/* ───────── time attribution inside a session ───────── */
/** seconds spent per problem in [from, to]: time between consecutive touches goes to the last-touched problem, gaps capped */
/** break time of a finished session inside [from, to] (ms) */
export const brkOverlap = (brks: [number, number][] | undefined, from: number, to: number) => (brks || []).reduce((t, [s, e]) => t + Math.max(0, Math.min(e, to) - Math.max(s, from)), 0)
export function activeSeconds(evs: CpEvent[], from: number, to: number, brks?: [number, number][]): Record<string, number> {
  // a session's automatic breaks are never time on a problem
  const gap = (t0: number, t1: number) => Math.min(IDLE_CAP, (t1 - t0 - brkOverlap(brks, t0, t1)) / 1000)
  const pts = evs.filter(e => e.at >= from && e.at <= to && e.k !== 'resource').sort((a, b) => a.at - b.at)
  const out: Record<string, number> = {}
  let cur: string | null = null, last = from
  for (const e of pts) {
    if (cur) out[cur] = (out[cur] || 0) + gap(last, e.at)
    cur = e.k === 'giveup' || e.k === 'skip' || (e.k === 'sub' && e.v === 'OK') || e.k === 'ac' ? null : e.pid
    last = e.at
  }
  if (cur) out[cur] = (out[cur] || 0) + gap(last, to)
  for (const k in out) out[k] = Math.round(out[k])
  return out
}

/* ───────── training-loop signals ───────── */
/** clean = solved without a full editorial (hint < 3); over drill/mixed/learn problems in the last `days` */
export function cleanRate(cp: CpState, byPid: Map<string, CpEvent[]>, days = 14, now = Date.now()) {
  const since = now - days * 864e5
  let n = 0, clean = 0
  for (const s of Object.values(cp.sessions || {})) {
    if (s.kind !== 'practice' || s.startedAt < since || (s.spec && (s.spec.mode === 'resolve' || s.spec.mode === 'upsolve'))) continue
    for (const pid of s.pids) {
      const t = timeline(pid, byPid.get(pid))
      n++
      if (s.solved.includes(pid) && t.hint < 3) clean++
    }
  }
  return { n, clean: n ? clean / n : 0 }
}
export const practiceMinutes = (sessions: CpSession[], day: string) => sessions.filter(s => s.date === day && s.kind !== 'mock').reduce((a, s) => a + s.mins, 0)

/* ───────── keep the synced log bounded ───────── */
export function compactEvents(cp: CpState, now = Date.now()): Pick<CpState, 'events' | 'evCut' | 'probStats'> | null {
  const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 60)
  const cut = d.getTime()
  if (cut <= (cp.evCut || 0)) return null
  const old = Object.values(cp.events).filter(e => e.at < cut)
  if (!old.length) return null
  const stats: Record<string, ProbSummary> = { ...cp.probStats }
  const byPid = new Map<string, CpEvent[]>()
  for (const e of old) { const a = byPid.get(e.pid); a ? a.push(e) : byPid.set(e.pid, [e]) }
  for (const [pid, evs] of byPid) {
    const t = timeline(pid, evs.sort((a, b) => a.at - b.at)), prev = stats[pid]
    const verdicts: Record<string, number> = { ...(prev?.verdicts || {}) }
    for (const s of t.subs) verdicts[shortV(s.v)] = (verdicts[shortV(s.v)] || 0) + 1
    stats[pid] = {
      pid, firstOpen: Math.min(prev?.firstOpen ?? Infinity, t.firstOpen ?? Infinity) || undefined,
      acAt: prev?.acAt ?? t.acAt, subs: (prev?.subs || 0) + t.subs.length, verdicts,
      hint: Math.max(prev?.hint || 0, t.hint), gaveUp: !!prev?.gaveUp || t.gaveUp, u: cut,
    }
    if (stats[pid].firstOpen === Infinity) stats[pid].firstOpen = undefined
  }
  const events: Record<string, CpEvent> = {}
  for (const [k, e] of Object.entries(cp.events)) if (e.at >= cut) events[k] = e
  return { events, evCut: cut, probStats: stats }
}
