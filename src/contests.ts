import { divOf, findProblem, getCfUser, getContests, PROVISIONAL_CONTESTS, type CfContest, type CfUser } from './cf'
import { getLeverage } from './leverage'
import { dateKey, getState, setCp, toMin } from './store'
import { targetFor } from './season'
import { skillNow } from './train'

/* ═════════ Contest radar: every eligible rated round, every time ═════════
   Early contests are the fastest rating source (provisional boosts), so the app treats each one as mandatory. */

export type RoundDiv = 'Div2' | 'Div3' | 'Div4' | 'Edu' | 'Div1+2' | 'Global'
export interface RadarRound {
  id: number; name: string; start: number; /** seconds */ dur: number; div: RoundDiv
  /** rated for the user's current rating */ rated: boolean; mandatory: boolean
  /** remind "register now" from here (CF opens registration ≥ a day before) */ regFrom: number
  /** that day's season rule for rated rounds (set by radar()) */ season?: 'all' | 'optional' | 'none'
}
/** CF rates a division only below this rating */
export const RATED_BELOW: Record<RoundDiv, number> = { Div4: 1400, Div3: 1600, Div2: 2100, Edu: 2100, 'Div1+2': Infinity, Global: Infinity }
const NOT_RATED = /kotlin|icpc|unrated|\bteam\b|april fools|testing round|marathon|\bgym\b|div\.?\s*1\s*only/i

/** which kind of round a name is, or null when it's not a rated round the user can enter (Div 1 only, Kotlin, ICPC mirrors, unrated…) */
export function classify(name: string): RoundDiv | null {
  if (NOT_RATED.test(name)) return null
  if (/Educational/i.test(name)) return 'Edu'
  if (/Global Round/i.test(name)) return 'Global'
  const d = divOf(name)
  return d === 'Div2' || d === 'Div3' || d === 'Div4' || d === 'Div1+2' ? d : null
}

/** pure filter (testable): eligible upcoming rounds within `days` */
export function filterRadar(list: CfContest[], now: number, rating: number, days = 14): RadarRound[] {
  const out: RadarRound[] = []
  for (const c of list) {
    if (c.start + c.dur * 1000 <= now || c.start > now + days * 864e5) continue
    const div = classify(c.name); if (!div) continue
    const rated = rating < RATED_BELOW[div]
    out.push({ id: c.id, name: c.name, start: c.start, dur: c.dur, div, rated, mandatory: rated, regFrom: c.start - 24 * 36e5 })
  }
  return out.sort((a, b) => a.start - b.start)
}
/** the radar the app uses: a round is mandatory only when it's rated for you AND that day's season says rated rounds are
 *  mandatory (exam season: optional → offered without reminders unless you mark it; none → never pushed) */
export const radar = (days = 14, now = Date.now()) => filterRadar(getContests(), now, getCfUser()?.rating || 0, days)
  .map(r => { const c = targetFor(dateKey(new Date(r.start))).contests; return { ...r, mandatory: r.mandatory && c === 'all', season: c } })

/* ───────── which real round a schedule block is ("CF: <name>" from the planner, or a block placed at a round's start) ───────── */
const normName = (s: string) => s.toLowerCase().replace(/^\s*(cf|codeforces)\s*:\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim()
const ROUND_WORD = /\b(cf|codeforces|round|contest|div\.?\s*[1-4]|educational|global)\b/i
export function contestFor(t: { title: string; start: string | null; k?: string }, list: CfContest[] = getContests(), day = new Date()): CfContest | null {
  // warm-up / upsolve / practice blocks name the round but run their own session
  if (t.k === 'cp_practice' || /^\s*(warm|upsolve|free solve|re-?solve)/i.test(t.title)) return null
  const nt = normName(t.title)
  if (nt.length >= 6) for (const c of list) { const nc = normName(c.name); if (nc === nt || nc.includes(nt) || nt.includes(nc)) return c }
  if (!t.start || (t.k !== 'cp_mock' && !ROUND_WORD.test(t.title))) return null
  const d = new Date(day); d.setHours(0, 0, 0, 0); const at = d.getTime() + toMin(t.start) * 60000
  let best: CfContest | null = null
  // nearest round within 30 min; a round you can enter (Div 2 next to a parallel Div 1) wins over one you can't
  const score = (c: CfContest) => Math.abs(c.start - at) + (classify(c.name) ? 0 : 36e5)
  for (const c of list) if (Math.abs(c.start - at) <= 30 * 60000 && (!best || score(c) < score(best))) best = c
  // a mock-type block only counts as the round when its name says so or it sits on a rated round's start
  return best && (ROUND_WORD.test(t.title) || classify(best.name)) ? best : null
}

/* ───────── provisional boosts ───────── */
export const BOOSTS = [500, 350, 250, 150, 100, 50]
export interface Boost { k: number; boost: number; left: number; text: string }
export function boostAt(k: number): Boost | null {
  if (k >= PROVISIONAL_CONTESTS) return null
  return { k, boost: BOOSTS[k], left: BOOSTS.slice(k).reduce((a, b) => a + b, 0), text: `Contest ${k + 1}/${PROVISIONAL_CONTESTS} — +${BOOSTS[k]} boost still available` }
}
export const contestsTaken = (u: CfUser | null) => u ? u.contests ?? u.rated?.length ?? 0 : 0
/** null once the account has had its 6 boosted contests */
export const provisional = (u: CfUser | null = getCfUser()) => u ? boostAt(contestsTaken(u)) : boostAt(0)

/* ───────── taking it (coach.ts keys: 'in:'+cid; 'out:' newer than 'in:' = changed their mind) ───────── */
export function isTakingNow(cid: number) { const t = getState().cp.triggers; return (t['in:' + cid] || 0) > (t['out:' + cid] || 0) }
/** explicitly declined ('Not taking' newer than any 'I'm taking it'): overrides mandatory */
export function optedOut(cid: number) { const t = getState().cp.triggers; return (t['out:' + cid] || 0) > (t['in:' + cid] || 0) }
export const notTaking = (cid: number) => setCp(c => ({ ...c, triggers: { ...c.triggers, ['out:' + cid]: Date.now() } }))

/* ───────── warm-up: 2 easy problems, 25 min, ending 15 min before start ───────── */
export const WARM_MIN = 25, WARM_GAP = 15
export const warmWindow = (start: number) => ({ from: start - (WARM_MIN + WARM_GAP) * 60000, to: start - WARM_GAP * 60000 })
export function warmUp(c: { id: number; start: number }) {
  const sk = skillNow(), cp = getState().cp, rating = Math.max(800, Math.round((sk.level - 300) / 100) * 100)
  const avoid = new Set<string>([...Object.keys(cp.attempts), ...Object.values(cp.tests).flatMap(t => t.pids), ...Object.values(cp.plans).flatMap(p => [...p.practice, ...p.test])])
  const pids: string[] = []
  for (const k of ['a', 'b']) {
    const p = findProblem(sk, cp, { lo: rating, hi: rating + 99, avoid, seed: `warm|${c.id}|${k}` }) || findProblem(sk, cp, { lo: rating - 100, hi: rating + 199, avoid, seed: `warm|${c.id}|${k}|w` })
    if (p) { pids.push(p.id); avoid.add(p.id) }
  }
  return { pids, rating, ...warmWindow(c.start) }
}

/* ───────── in-round protocol: per-position checkpoints + skip rule ───────── */
export const POSITIONS: Record<RoundDiv, string[]> = {
  Div2: ['A', 'B', 'C', 'D', 'E', 'F'], Edu: ['A', 'B', 'C', 'D', 'E', 'F'], Div3: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  Div4: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 'Div1+2': ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], Global: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
}
/** fallback: minutes since the start by which each position should be accepted */
const FALLBACK: Record<string, number[]> = { Div4: [6, 15, 30, 50, 75, 105, 140], Div3: [8, 20, 40, 70, 100, 135], def: [10, 25, 50, 80, 120, 160] }
export interface Checkpoint { pos: string; min: number }
export function checkpoints(div: RoundDiv, durSec: number, table: Record<string, number> | undefined = getLeverage()?.speedTable): Checkpoint[] {
  const fb = FALLBACK[div] || FALLBACK.def, end = durSec / 60
  const out: Checkpoint[] = []
  let prev = 0 // keep checkpoints strictly increasing: mixed medians/fallbacks can come out of order; missing tail positions get +30
  POSITIONS[div].forEach((pos, i) => {
    const raw = table?.[pos] && table[pos] > 0 ? Math.round(table[pos]) : fb[i] ?? (prev ? prev + 30 : undefined)
    if (raw === undefined) return
    const min = Math.max(raw, prev + 1); prev = min
    if (min < end) out.push({ pos, min })
  })
  return out
}
/** "B > 25 min → read C" */
export const skipRule = (cps: Checkpoint[], pos: string) => {
  const i = cps.findIndex(c => c.pos === pos)
  return i >= 0 && i + 1 < cps.length ? `${pos} > ${cps[i].min} min → read ${cps[i + 1].pos}` : ''
}
