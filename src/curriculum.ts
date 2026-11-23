import { CURRICULUM } from './curriculumData'
import { getState, setCp, type CpState, type TopicState } from './store'
import { TAGS, type Prob, type Skill } from './cf'

/* ═════════ the curriculum: topics → sub-topics (USACO Guide + CP Handbook + cp-algorithms), each with
   theory, a problem ladder and its own mastery, so "dp" means knapsack, LIS, bitmask, digit, tree… one by one ═════════ */

export interface CRes { title: string; url: string; kind: 'usaco' | 'cph' | 'cpalgo' | 'cf-edu' | 'cf-blog' | 'other'; where?: string; minutes?: number }
export interface CProb { id: string; src: 'cf' | 'cses'; name: string; rating?: number; from?: string }
export interface Sub {
  id: string; name: string; tier: number; order: number; prereq: string[]; summary: string; learn: string[]
  resources: CRes[]; problems: CProb[]; topic: string; topicName: string; area: string; cfTags: string[]
}
export interface CTopic { id: string; name: string; area: string; cfTags: string[]; subs: Sub[] }

type RawSub = Omit<Sub, 'topic' | 'topicName' | 'area' | 'cfTags'> & { prereq?: string[] }
type RawArea = { area: string; topics: { id: string; name: string; cfTags: string[]; subtopics: RawSub[] }[] }

export const TOPICS: CTopic[] = (CURRICULUM as RawArea[]).flatMap(a => a.topics.map(t => ({
  id: t.id, name: t.name, area: a.area, cfTags: t.cfTags,
  subs: [...t.subtopics].sort((x, y) => (x.order ?? 0) - (y.order ?? 0) || x.tier - y.tier).map(s => ({
    ...s, prereq: (s.prereq || []).map(p => p.replace(/^@/, '')), topic: t.id, topicName: t.name, area: a.area, cfTags: t.cfTags,
  })),
})))
export const SUBS: Sub[] = TOPICS.flatMap(t => t.subs)
export const SUB_BY_ID = new Map(SUBS.map(s => [s.id, s]))
/** curated problem → sub-topics */
const CURATED = new Map<string, string[]>()
for (const s of SUBS) for (const p of s.problems) CURATED.set(p.id, [...(CURATED.get(p.id) || []), s.id])

/** the sub-topics a problem exercises: curated lists plus the coach's (or your) classification */
export function subsOf(cp: CpState, pid: string): string[] {
  const x = CURATED.get(pid) || [], y = cp.subtag?.[pid]?.subs || []
  return y.length ? [...new Set([...x, ...y])] : x
}

/* ───────── mastery per sub-topic ───────── */
export type SubState = 'new' | 'learning' | 'learned' | 'mastered'
/** need = clean solves at the floor that mark it learned (fewer when its ladder is thin; 0 = nothing to practise, reading only);
 *  earned = what your solves alone show, without the "far below your level" rule (made sticky in cp.subs, see persistEarned) */
export interface SubSkill { id: string; st: SubState; derived: SubState; earned: SubState; need: number; clean: number[]; failed: number; tried: number; cses: number; cfTotal: number; cfDone: number }

/** clean = solved without the full editorial (hint level < 3) */
function hintMap(cp: CpState) {
  const m = new Map<string, number>()
  for (const e of Object.values(cp.events)) if (e.k === 'hint' && e.pid) m.set(e.pid, Math.max(m.get(e.pid) || 0, e.hl || 0))
  return m
}
export const learnFloor = (s: Sub, L: number) => Math.max(800, Math.min(s.tier, L) - 200)

export function subSkills(sk: Skill, cp: CpState, getProb: (id: string) => Prob | undefined): Map<string, SubSkill> {
  const hints = hintMap(cp), L = sk.level, failed = new Set(sk.failed)
  // every problem you touched, attributed to its sub-topics
  const bySub = new Map<string, { clean: number[]; failed: number; tried: number }>()
  for (const pid of sk.touched) {
    const subs = subsOf(cp, pid); if (!subs.length) continue
    const r = getProb(pid)?.r ?? 0, ok = sk.solved.has(pid), clean = ok && (hints.get(pid) || 0) < 3
    for (const id of subs) {
      const b = bySub.get(id) || { clean: [], failed: 0, tried: 0 }
      b.tried++; if (clean && r) b.clean.push(r); if (!ok && failed.has(pid)) b.failed++
      bySub.set(id, b)
    }
  }
  const out = new Map<string, SubSkill>()
  for (const s of SUBS) {
    const b = bySub.get(s.id) || { clean: [], failed: 0, tried: 0 }
    const cses = s.problems.filter(p => p.src === 'cses' && cp.cses?.[p.id]?.done).length
    const cf = s.problems.filter(p => p.src === 'cf')
    const floor = learnFloor(s, L)
    const atFloor = b.clean.filter(r => r >= floor).length, high = b.clean.filter(r => r >= Math.max(L + 100, s.tier + 200)).length
    // a thin ladder (1-2 problems at the floor) can't supply 3 clean solves: all of it is enough then
    const need = Math.min(3, cf.filter(p => (getProb(p.id)?.r ?? p.rating ?? 0) >= floor).length)
    const ex = cp.subs?.[s.id]?.st
    // far below your level (tier ≤ L−300) counts as known unless you chose to (re)learn it: old solves rarely hit the curated ladders
    const implicit = s.tier <= L - 300 && ex !== 'learning'
    const earned: SubState = high >= 3 ? 'mastered' : atFloor >= (need || 3) || (atFloor >= 2 && cses >= 2) ? 'learned' : 'new'
    const derived: SubState = earned === 'new' && implicit ? 'learned' : earned
    const explicit: SubState | undefined = ex === 'paused' ? undefined : ex
    const order: SubState[] = ['new', 'learning', 'learned', 'mastered']
    const st = explicit && order.indexOf(explicit) > order.indexOf(derived) ? explicit : derived
    out.set(s.id, { id: s.id, st, derived, earned, need, clean: b.clean.sort((x, y) => y - x), failed: b.failed, tried: b.tried, cses, cfTotal: cf.length, cfDone: cf.filter(p => sk.solved.has(p.id)).length })
  }
  return out
}
/** subSkills, cached on the slices it reads (one shared result for the Train card, the Ladder and defaultSpecs) */
let memo: { key: unknown[]; v: Map<string, SubSkill> } | null = null
export function subSkillsMemo(sk: Skill, cp: CpState, getProb: (id: string) => Prob | undefined, nProbs: number): Map<string, SubSkill> {
  const key = [cp.events, cp.subs, cp.subtag, cp.cses, sk.level, sk.solved.size, sk.touched.size, sk.failed.length, nProbs]
  if (memo && memo.key.length === key.length && memo.key.every((x, i) => x === key[i])) return memo.v
  memo = { key, v: subSkills(sk, cp, getProb) }
  return memo.v
}
export const done = (st?: SubState) => st === 'learned' || st === 'mastered'
/** floor and mastery bar move with your level, so what your solves earned is written into cp.subs once reached (never goes backwards) */
export function persistEarned(cp: CpState, ss: Map<string, SubSkill>) {
  const rank: Record<string, number> = { learned: 1, mastered: 2 }
  const up = [...ss.values()].filter(k => done(k.earned) && (rank[k.earned] || 0) > (rank[cp.subs?.[k.id]?.st || ''] || 0))
  if (!up.length) return
  const t = Date.now()
  setCp(c => ({ ...c, subs: { ...(c.subs || {}), ...Object.fromEntries(up.map(k => [k.id, { st: k.earned as TopicState, since: t, u: t }])) } }))
}
/** a sub-topic the learn block can practise (it has ladder problems at your floor) */
export const practicable = (k?: SubSkill) => !!k && k.need > 0

/** the rating your next rank needs, and which sub-topics belong to it */
export const tierTarget = (L: number) => [1200, 1400, 1600, 1900, 2100, 2400, 2700].find(t => t > L + 50) ?? 3000
/** the sub-topics a rank needs: tier ≤ target plus every prerequisite of those (some prereqs are rated above their dependents) */
const needMemo = new Map<number, Sub[]>()
export function subsFor(target: number): Sub[] {
  let v = needMemo.get(target)
  if (v) return v
  const ids = new Set(SUBS.filter(s => s.tier <= target).map(s => s.id)), stack = [...ids]
  while (stack.length) for (const p of SUB_BY_ID.get(stack.pop()!)?.prereq || []) if (SUB_BY_ID.has(p) && !ids.has(p)) { ids.add(p); stack.push(p) }
  v = SUBS.filter(s => ids.has(s.id)); needMemo.set(target, v)
  return v
}

/** what to learn next: prerequisites done, within reach of your next rank, weakest-first within the order */
/** how often a topic's problems appear on Codeforces (0.3 rare … 1 everywhere) */
const topicWeight = (s: Sub) => Math.max(0.4, ...s.cfTags.map(t => TAGS.find(x => x.tag === t)?.w ?? 0))
export function nextSubs(sk: Skill, cp: CpState, ss: Map<string, SubSkill>, limit = 8): Sub[] {
  const target = tierTarget(sk.level)
  const learning = new Set(Object.entries(cp.subs || {}).filter(([, v]) => v.st === 'learning').map(([k]) => k))
  const paused = new Set(Object.entries(cp.subs || {}).filter(([, v]) => v.st === 'paused').map(([k]) => k))
  // a prereq you stopped (paused) or one with nothing to practise (reading only) doesn't lock what builds on it
  return subsFor(target).filter(s => !done(ss.get(s.id)?.st) && !learning.has(s.id) && !paused.has(s.id)
    && s.prereq.every(p => !SUB_BY_ID.has(p) || done(ss.get(p)?.st) || paused.has(p) || !practicable(ss.get(p))))
    // easiest first, but topics that show up often on Codeforces at your level come before rare ones (geometry, games…)
    .map(s => ({ s, k: s.tier + (1 - topicWeight(s)) * 400 })).sort((a, b) => a.k - b.k || a.s.order - b.s.order).map(x => x.s)
    .slice(0, limit)
}
/** progress toward the next rank, sub-topic by sub-topic */
export function subGates(sk: Skill, ss: Map<string, SubSkill>) {
  const target = tierTarget(sk.level), need = subsFor(target)
  return { target, need, done: need.filter(s => done(ss.get(s.id)?.st)) }
}

export function setSub(id: string, st: TopicState | null) {
  const t = Date.now()
  setCp(c => ({ ...c, subs: { ...(c.subs || {}), [id]: { st: st || 'paused', since: t, u: t } } }))
}
export function tickCses(id: string, isDone: boolean) {
  const t = Date.now()
  setCp(c => ({ ...c, cses: { ...(c.cses || {}), [id]: { done: isDone, at: t, u: t } } }))
}
/** the coach (or you) says which sub-topics a problem uses */
export function classify(pid: string, subs: string[], by: 'coach' | 'user') {
  const ok = subs.filter(s => SUB_BY_ID.has(s)).slice(0, 4); if (!ok.length) return
  const t = Date.now()
  setCp(c => ({ ...c, subtag: { ...(c.subtag || {}), [pid]: { subs: ok, by, u: t } } }))
}
export const learningSubs = (cp: CpState = getState().cp) => Object.entries(cp.subs || {}).filter(([, v]) => v.st === 'learning').map(([k]) => k).filter(k => SUB_BY_ID.has(k))

/** a practice problem for a sub-topic near `band` and ≤ `hi`: its own ladder first (unsolved, closest above), then any
 *  untouched problem classified into it (rare: the coach only classifies problems you've already met); undefined when
 *  nothing fits (the caller falls back to the topic's CF tag) */
export function subProblem(sk: Skill, cp: CpState, sub: Sub, band: number, avoid: Set<string>, getProb: (id: string) => Prob | undefined, hi = Infinity): Prob | undefined {
  const pool: Prob[] = []
  for (const p of sub.problems) if (p.src === 'cf') { const x = getProb(p.id); if (x && x.r <= hi && !sk.touched.has(x.id) && !avoid.has(x.id)) pool.push(x) }
  for (const [pid, v] of Object.entries(cp.subtag || {})) if (v.subs.includes(sub.id)) { const x = getProb(pid); if (x && x.r <= hi && !sk.touched.has(pid) && !avoid.has(pid) && !pool.includes(x)) pool.push(x) }
  if (!pool.length) return undefined
  // just above the band is ideal; too easy is better than far too hard while learning
  const cost = (p: Prob) => p.r >= band ? (p.r - band) : (band - p.r) * 1.6
  return pool.sort((a, b) => cost(a) - cost(b))[0]
}
