import { SUB_BY_ID } from './curriculum'
import { toMin, type BlockSess, type CpMode, type SessSpec, type Task } from './store'

/* ═════════ CP practice blocks ↔ sessions: what each block runs, labels, and the "every planned session has a block" match ═════════ */

export const MODE_LABEL: Record<CpMode, string> = {
  learn: 'Learn', drill: 'Drill', mixed: 'Mixed', position: 'Position', upsolve: 'Upsolve', resolve: 'Re-solve',
  deep: 'Deep', free: 'Free solve', warmup: 'Warm-up', speed: 'Speed',
}
export const MODE_ICON: Record<CpMode, string> = {
  learn: 'school', drill: 'fitness_center', mixed: 'shuffle', position: 'format_list_numbered', upsolve: 'replay', resolve: 'autorenew',
  deep: 'psychology_alt', free: 'travel_explore', warmup: 'directions_run', speed: 'speed',
}
/** "0-1 knapsack" · "dp, greedy" · "C" ('' when the session has no detail) */
export function cpDetail(cp?: BlockSess) {
  if (!cp) return ''
  if (cp.mode === 'learn' && cp.sub) return SUB_BY_ID.get(cp.sub)?.name || cp.sub
  if (cp.mode === 'position' && cp.pos) return cp.pos
  return cp.tags?.length ? cp.tags.join(', ') : ''
}
/** "Learn · 0-1 knapsack", "Drill · dp, greedy", "Position · C", "Mixed" */
export const cpLabel = (cp?: BlockSess) => !cp ? '' : MODE_LABEL[cp.mode] + (cpDetail(cp) ? ' · ' + cpDetail(cp) : '')
/** a block's title for a session: "CP · Learn: 0-1 knapsack" */
export const cpTitle = (cp: BlockSess) => 'CP · ' + MODE_LABEL[cp.mode] + (cpDetail(cp) ? ': ' + cpDetail(cp) : '')
/** a title that says nothing about the session (safe to replace with the session's own title) */
export const GENERIC_RE = new RegExp('^\\s*(?:cp practice|competitive programming|cp block|cp session|practice|cp · (?:' + Object.values(MODE_LABEL).join('|') + ')(?:: .*?)?)\\s*(?:\\(\\d\\/\\d\\))?\\s*$', 'i')
const PART_RE = /\s*\(\d\/\d\)$/
/** a block's new title for a session: a generic title becomes the session's (a "(2/3)" part suffix stays); others are kept */
export function retitle(title: string, cp: BlockSess) {
  if (!GENERIC_RE.test(title)) return title
  const part = title.match(PART_RE)?.[0] || ''
  return cpTitle(cp) + part
}
/** planned blocks meant for solving on your own (e.g. "Revisit unsolved / random problems") start a free session */
export const FREE_RE = /free\s*solve|random|unsolved|revisit|on my own|own problems|any problems/i
/** a session the title already says: "Warm-up for <round>", "Upsolve <round>", "Free solve: …" */
export function inferCpMode(title: string): CpMode | null {
  if (/^\s*warm[\s-]?up/i.test(title)) return 'warmup'
  if (/^\s*up-?solv/i.test(title)) return 'upsolve'
  if (FREE_RE.test(title)) return 'free'
  return null
}
/** the block session a plan spec stands for */
export function sessOfSpec(s: SessSpec): BlockSess {
  const o: BlockSess = { mode: s.mode }
  if (s.mode === 'learn' && s.sub) o.sub = s.sub
  else if ((s.mode === 'learn' || s.mode === 'drill' || s.mode === 'speed') && s.tags.length) o.tags = s.tags.slice(0, 4)
  if (s.mode === 'position' && s.pos) o.pos = s.pos
  return o
}
const same = (a?: BlockSess, b?: BlockSess) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const byStart = (a: Task, b: Task) => (a.start ? toMin(a.start) : 9999) - (b.start ? toMin(b.start) : 9999) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
/** a typed block that may be retyped by the app: typed by the app itself and never touched by the student */
/** tombstones below this are the app's own drops (u + 1 of a record the app wrote); a real clock time is the student's delete */
export const APP_DEL = 1e9
const loose = (t: Task) => !!t.cp?.auto && !t.pin && !t.done

export interface CpMatch {
  /** sessions to write onto existing blocks (title only when it changes) */
  set: { id: string; cp: BlockSess; title?: string }[]
  /** blocks to add for planned sessions that have none */
  add: { id: string; i: number; spec: SessSpec; cp: BlockSess; title: string }[]
  /** blocks the app added earlier that no planned session needs any more (untouched, never started) */
  drop: string[]
  /** per plan spec: the block that runs it (null: none — e.g. its session is already done, or the student deleted its block) */
  bySpec: (string | null)[]
}
/** make sure today's schedule has a block for every planned session. Pure + deterministic (two devices compute the same thing):
 *  1. untyped blocks whose title names a session (warm-up / upsolve / free solve) get that session; the remainder of a
 *     partly-finished block (`hold`) keeps its parent's spec;
 *  2. each spec (in order) takes a typed block of the same mode (best detail match first);
 *  3. a spec left over — unless its session is done or the student deleted a block of that mode today (`declined`) — types the
 *     earliest untyped (or app-typed, untouched) not-done block;
 *  4. still none: a new "any time" block `cp:<mode>:<i>:<date>` (unless that id exists or was deleted);
 *  5. untyped blocks left over become Mixed;
 *  6. a block the app added (`cp:…`) that no session needs any more — never touched (u below APP_DEL), never started — goes (e.g. the planner
 *     placed that session in a block of its own).
 *  Never retypes a block the student (or the planner / a routine block) typed, a pinned typed block, or a done one. */
export function matchCpBlocks(date: string, tasks: Task[], specs: SessSpec[], o: { done?: Set<number>; gone?: (id: string) => boolean; busy?: (id: string) => boolean
  /** blocks that continue a spec (the "rest" of a block a session finished only part of): block id → the spec and the block it
   *  continues (that parent holds no other spec) */
  hold?: Map<string, { spec: number; from?: string }>
  /** typed blocks the student deleted (or merged away) today, per mode: that many specs of the mode get no block from the app */
  declined?: Map<CpMode, number> } = {}): CpMatch {
  const prac = tasks.filter(t => t.k === 'cp_practice').sort(byStart)
  const cur = new Map<string, BlockSess | undefined>(prac.map(t => [t.id, t.cp]))
  const want = new Map<string, { cp: BlockSess; title?: string }>()
  const put = (t: Task, cp: BlockSess, title?: string) => { cur.set(t.id, cp); want.set(t.id, { cp, ...(title && title !== t.title ? { title } : {}) }) }
  for (const t of prac) if (!t.cp && !t.done) { const m = inferCpMode(t.title); if (m) put(t, { mode: m }) }
  const claimed = new Set<string>(), bySpec: (string | null)[] = specs.map(() => null)
  // a remainder block keeps its parent's spec (it never takes a later spec of the same mode)
  for (const [id, { spec: i, from }] of o.hold || []) {
    const t = prac.find(x => x.id === id)
    if (t && !t.done && !claimed.has(id) && i < specs.length && !bySpec[i] && cur.get(id)?.mode === specs[i].mode) { claimed.add(id); bySpec[i] = id; if (from) claimed.add(from) }
  }
  const score = (cp: BlockSess, s: SessSpec) => (s.mode === 'learn' && cp.sub && cp.sub === s.sub ? 2 : 0) + (s.mode === 'position' && cp.pos && cp.pos === s.pos ? 2 : 0) + (cp.tags?.length && cp.tags.join() === s.tags.join() ? 1 : 0)
  specs.forEach((s, i) => {
    if (bySpec[i]) return
    const c = prac.filter(t => !claimed.has(t.id) && cur.get(t.id)?.mode === s.mode)
    if (!c.length) return
    // a block someone placed on purpose (the student / a routine block) holds the session before one the app typed or added
    // (and, among retypable ones, a block the planner placed before an "any time" block the app added)
    const sc = (t: Task) => (loose(t) ? (t.id.startsWith('cp:') ? 0 : 5) : 10) + score(cur.get(t.id)!, s)
    const best = c.reduce((b, t) => sc(t) > sc(b) ? t : b, c[0])
    claimed.add(best.id); bySpec[i] = best.id
  })
  const add: CpMatch['add'] = [], declined = new Map(o.declined || [])
  specs.forEach((s, i) => {
    if (bySpec[i]) return
    // a session already done, or whose block the student deleted, neither claims a free block nor gets a new one
    if (o.done?.has(i)) return
    const dn = declined.get(s.mode) || 0
    if (dn > 0) { declined.set(s.mode, dn - 1); return }
    const t = prac.find(t => !claimed.has(t.id) && !t.done && (!cur.get(t.id) || (loose(t) && !want.has(t.id))))
    const cp: BlockSess = { ...sessOfSpec(s), auto: true }
    if (t) { put(t, cp, retitle(t.title, cp)); claimed.add(t.id); bySpec[i] = t.id; return }
    // its id is taken (the student retyped that block): the next free one — but a block the student deleted stays deleted
    let id = `cp:${s.mode}:${i}:${date}`
    for (let n = 2; tasks.some(x => x.id === id) && n < 9; n++) id = `cp:${s.mode}:${i}-${n}:${date}`
    if (tasks.some(x => x.id === id) || o.gone?.(id)) return
    add.push({ id, i, spec: s, cp, title: cpTitle(cp) }); bySpec[i] = id
  })
  for (const t of prac) if (!t.done && !cur.get(t.id)) put(t, { mode: 'mixed', auto: true }, retitle(t.title, { mode: 'mixed' }))
  // never one a real edit touched since (u past APP_DEL: completed / undone / saved) — dropping it would read as the student's delete
  const drop = prac.filter(t => t.id.startsWith('cp:') && loose(t) && t.u < APP_DEL && !claimed.has(t.id) && !want.has(t.id) && !o.busy?.(t.id)).map(t => t.id)
  const set = [...want.entries()].map(([id, w]) => ({ id, ...w })).filter(w => { const t = prac.find(x => x.id === w.id)!; return !same(t.cp, w.cp) || (w.title !== undefined && w.title !== t.title) })
  return { set, add, drop, bySpec }
}
