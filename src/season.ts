import { addDays, dateKey, getState, uid, type State } from './store'

/* ═════════ seasons: what a day of training should be (exam weeks are not normal weeks) ═════════
   One source of truth for the daily CP target, the mock and rated rounds. Discipline, the trainer, the planner and the
   coach all read targetFor(date) instead of hard-coding 4.5 h + a 2 h mock. */

export type SeasonKind = 'exam' | 'normal' | 'break'
export interface Season {
  id: string; kind: SeasonKind
  /** inclusive date keys */ from: string; until: string
  /** daily CP practice target in minutes */ cpMin: number
  /** whether a daily mock is expected */ mock: boolean
  /** rated rounds: all = mandatory, optional = offered, none = skip */ contests: 'all' | 'optional' | 'none'
  note?: string; u: number; del?: boolean
}
export interface DayTarget { cpMin: number; mock: boolean; mockMin: number; contests: Season['contests']; kind: SeasonKind; season: Season | null }

export const NORMAL_CP = 270, NORMAL_MOCK = 120
/** a light day (short night / flat morning check-in) scales the day's practice target ×0.6 — the trainer's plan and discipline
 *  both use it (here, not in train.ts: discipline must not import the trainer) */
export const LIGHT = 0.6
/** a sensible default when the student says "exams": light maintenance practice, no mock, rounds optional */
export const EXAM_DEFAULTS = { cpMin: 45, mock: false, contests: 'optional' as const }

export const seasonsOf = (s: State = getState()) => Object.values(s.seasons || {}).filter(x => !x.del)

/** the season covering a date (the most recently edited one wins when two overlap), or null for a normal day */
export function seasonOn(date = dateKey(), s: State = getState()): Season | null {
  const hit = seasonsOf(s).filter(x => x.from <= date && date <= x.until).sort((a, b) => b.u - a.u)
  return hit[0] || null
}

export function targetFor(date = dateKey(), s: State = getState()): DayTarget {
  const season = seasonOn(date, s)
  if (!season) return { cpMin: NORMAL_CP, mock: true, mockMin: NORMAL_MOCK, contests: 'all', kind: 'normal', season: null }
  return { cpMin: season.cpMin, mock: season.mock, mockMin: season.mock ? NORMAL_MOCK : 0, contests: season.contests, kind: season.kind, season }
}

/** the targets for the next n days (planner context, coach data, the Plan tab's chips) */
export const targetsAhead = (n = 7, from = dateKey(), s: State = getState()) => Array.from({ length: n }, (_, i) => { const d = addDays(from, i); return { date: d, ...targetFor(d, s) } })
/** seasons that still matter (cover today or later), soonest first */
export const upcomingSeasons = (s: State = getState(), today = dateKey()) => seasonsOf(s).filter(x => x.until >= today).sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0)
/** a new season record (u is stamped again by setSeason) */
export function makeSeason(o: Partial<Season> & Pick<Season, 'from' | 'until'>): Season {
  const kind = o.kind || 'exam', d = kind === 'exam' ? EXAM_DEFAULTS : { cpMin: NORMAL_CP, mock: kind !== 'break', contests: 'all' as const }
  const [from, until] = o.from <= o.until ? [o.from, o.until] : [o.until, o.from]
  return { id: o.id || 'sea-' + uid(), kind, from, until, cpMin: o.cpMin ?? d.cpMin, mock: o.mock ?? d.mock, contests: o.contests || d.contests, ...(o.note ? { note: o.note } : {}), u: o.u ?? Date.now() }
}
const SEASON_LABEL: Record<SeasonKind, string> = { exam: 'Exam season', break: 'Break', normal: 'Custom season' }
export const seasonLabel = (x: Pick<Season, 'kind'>) => SEASON_LABEL[x.kind] || 'Season'
/** the compact form the planner / coach see */
export const seasonOut = (x: Season) => ({ kind: x.kind, from: x.from, until: x.until, cp_min: x.cpMin, mock: x.mock, contests: x.contests, note: x.note || '' })
