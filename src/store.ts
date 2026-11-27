import { useSyncExternalStore } from 'react'
import type { SchemeStyle } from './theme'
import type { Season } from './season'

/* ───────────────────────── types ───────────────────────── */
export type Cat = 'deep' | 'study' | 'health' | 'admin' | 'life' | 'break'
export const CATS: Record<Cat, { label: string; icon: string; tone: string }> = {
  deep: { label: 'Deep work', icon: 'psychology', tone: 'primary' },
  study: { label: 'Study', icon: 'school', tone: 'tertiary' },
  health: { label: 'Health', icon: 'fitness_center', tone: 'secondary' },
  admin: { label: 'Admin', icon: 'inbox', tone: 'neutral' },
  life: { label: 'Life', icon: 'self_improvement', tone: 'tertiary' },
  break: { label: 'Break', icon: 'coffee', tone: 'secondary' },
}

/* Every syncable record carries `u` (last-modified ms). Merging two devices = per-record last-write-wins,
   deletions are tombstones, counters are per-device, bonuses are keyed so they can never be double-paid. */
export interface Task {
  id: string; title: string; start: string | null; dur: number; cat: Cat; u: number
  done: boolean; doneAt?: number; xp?: number; ontime?: boolean; tpl?: string
  /** when the completion fields (done/doneAt/xp/xpm/ontime) last changed: they merge apart from the rest of the record,
   *  so a title/time edit on one device can't undo a completion made on the other (missing = written by a client from before
   *  doneU, whose u covers the completion too; this client stamps every task it writes) */ doneU?: number
  /** XP per counted minute, fixed when done (editing the log later re-prices the task with it) */ xpm?: number
  /** what the task is linked to: a CP practice/mock block (completed by the trainer), a coach assignment, a planner item */
  k?: 'cp_practice' | 'cp_mock' | 'coach' | 'study' | 'other'
  ai?: string; pin?: boolean; note?: string; ref?: string
  /** a CP practice block's session (what its play button runs); missing = untyped (the trainer picks) */ cp?: BlockSess
}
/** what a CP practice block runs. warmup = short easy speed session (~level−300); free = free solve; auto = typed by the app
 *  (today's plan sync), so it may be retyped — a session the student (or the planner, or a routine block) set never is */
export type CpMode = SessMode | 'warmup'
export interface BlockSess { mode: CpMode; sub?: string; tags?: string[]; pos?: string; auto?: boolean }
export const CP_MODES: CpMode[] = ['learn', 'drill', 'mixed', 'position', 'upsolve', 'resolve', 'deep', 'free', 'warmup', 'speed']
export const isCpMode = (m: unknown): m is CpMode => typeof m === 'string' && (CP_MODES as string[]).includes(m)
const sameSess = (a?: BlockSess, b?: BlockSess) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
export interface Goal { id: string; title: string; target: number; step: number; unit: string; icon: string; u: number }
export interface Block { id: string; title: string; start: string; dur: number; cat: Cat; days: number[]; u: number; from?: string; until?: string; ai?: string; k?: Task['k']; cp?: BlockSess }
export type QuestId = 'perfect' | 'focus' | 'work' | 'firstOnTime'
/** one stretch of REAL work with exact start/end (end null while it runs). Every timer writes these; "Done" without a
 *  timer asks when you did it. Work time and task XP come from these minutes, not from planned lengths. */
export interface Span {
  id: string; taskId?: string; title: string; cat: Cat; src: 'focus' | 'pomodoro' | 'cp' | 'mock' | 'contest' | 'manual'
  start: number; end: number | null; /** last sign of life of a running span (closes it at this time if the app died) */ beat?: number
  dev?: string; u: number; del?: boolean
  /** logged from the Done sheet (undoing the task removes it) */ ask?: boolean
}
export interface MealEntry {
  id: string; name: string; kcal: number
  protein?: number; carbs?: number; fat?: number
  at: number; u: number; del?: boolean
}
export interface MealEntry {
  id: string; name: string; kcal: number
  protein?: number; carbs?: number; fat?: number
  at: number; u: number; del?: boolean
}
export interface MealEntry {
  id: string; name: string; kcal: number
  protein?: number; carbs?: number; fat?: number
  at: number; u: number; del?: boolean
}
export interface Day {
  date: string; tasks: Task[]; del: Record<string, number>
  goals: Record<string, number>; goalsU: Record<string, number>; goalsHit: string[]
  /** goal counters per device: goal → device → [added, removed] (grow-only, merged by max; goals[id] = the clamped sum).
   *  'legacy' holds the value from before per-device counting (the same on every device, so it isn't double counted) */
  gc?: Record<string, Record<string, [number, number]>>
  locked: boolean; lockedAt?: number; perfect: boolean
  quests: { id: QuestId; claimed: boolean }[]
  focusBy: Record<string, number>; bonus: Record<string, number>
  /** the work log of this day (keyed by span id; a span belongs to the day it started) */ spans?: Record<string, Span>
  /** logged meals/calories for this day (keyed by entry id, merged by u) */ calories?: Record<string, MealEntry>
  combo: number; maxCombo: number; lastDoneAt?: number
  /** derived */ xp: number; focusMin: number
}
export interface Settings {
  name: string; seed: string; mode: 'system' | 'light' | 'dark'; style: SchemeStyle
  sound: boolean; haptics: boolean; threshold: number; workTarget: number; calorieTarget?: number
  coachAutoAdd?: boolean; pomoWork?: number; pomoBreak?: number; pomoLong?: number; disciplineBar?: number
  /** 0 standard · 0.5 medium · 1 high */
  contrast?: 0 | 0.5 | 1; amoled?: boolean; preset?: string; tierTheme?: boolean
  /** automatic breaks in Focus mode and CP practice / free-solve / drill sessions: after breakEvery min of work, a breakLen-min break */
  autoBreak?: boolean; breakEvery?: number; breakLen?: number
}
/* ── planner (Claude day-planner session) ── */
export interface PlannedTask {
  id: string; date: string; title: string; start: string | null; dur: number; cat: Cat; note?: string
  kind: 'task' | 'skip'; skip?: string; k?: Task['k']; plan: string; pin?: boolean; u: number; cp?: BlockSess
}
export interface PlanDay { date: string; skip_blocks: string[]; tasks: { key: string; title: string; start: string; dur: number; cat: Cat; kind: string; note: string; cp?: BlockSess }[] }
export interface RoutineChange { op: 'add' | 'update' | 'remove'; key: string; block_id: string; title: string; start?: string; dur?: number; cat?: Cat; days: number[]; from: string; until: string; k?: Task['k'] }
export interface Proposal {
  id: string; at: number; prompt: string; summary: string; questions: string[]; range: { from: string; to: string }
  days: PlanDay[]; routine: RoutineChange[]; status: 'pending' | 'applied' | 'rejected' | 'undone' | 'error' | 'superseded'; err?: string; u: number
  /** the app found overlaps and asked the planner to fix them (this proposal waits for the fix) */ repairing?: boolean; /** this proposal IS the automatic fix of another */ repairOf?: string; issues?: string[]
  undo?: { agenda: PlannedTask[]; added: string[]; blocks: Block[]; addedBlocks: string[]; /** the season this plan set (undo tombstones it unless edited since) */ season?: string }
  /** the planner heard exam / holiday dates: applying the plan sets this season (its id is 'plan-<proposal id>') */ season?: Season
}
/* ── competitive programming trainer (synced part; Codeforces caches live in cf.ts, per device) ── */
export type CpSrc = 'practice' | 'test' | 'drill' | 'free'
/** h = the Codeforces handle this belongs to: switching accounts must not drag the old account's history along */
export interface CpAttempt { pid: string; status: 'solved' | 'failed'; at: number; secs?: number; src: CpSrc; u: number; h?: string }
export interface CpPlan { date: string; practice: string[]; test: string[]; level: number; genAt: number; rev: number; why: Record<string, string>; calibU?: number; specs?: SessSpec[]; mockOffset?: number }
export interface CpTest { id: string; date: string; pids: string[]; startedAt: number; dur: number; finishedAt?: number; solved: Record<string, number>; perf?: number; h?: string; real?: RealRound }
/** a mock that is a real past CF round, taken as a virtual participation on codeforces.com and re-ranked into its real standings */
export interface RealRound {
  contestId: number; name: string; rule: 'icpc' | 'cf'
  /** virtual start on CF (ms), from the first VIRTUAL submission's startTimeSeconds / creationTime − relativeTime */
  vStart?: number
  /** per problem index: solve time (s from start) and rejected attempts before AC (or so far) */
  probs: Record<string, { at?: number; wa: number }>
  /** results from the leverage engine once finished */
  rank?: number; of?: number; delta?: number; perf?: number; points?: number; penalty?: number
}
/** idea bank: one key observation per problem, reviewed with SM-2 spaced repetition */
export interface IdeaCard {
  id: string; pid: string; idea: string; tags: string[]; created: number
  ef: number; ivl: number; reps: number; lapses: number; due: string; last?: number; u: number; del?: boolean
}
export const sameHandle = (a: string | undefined, b: string) => !a || a.toLowerCase() === b.toLowerCase()
export type SessMode = 'learn' | 'drill' | 'mixed' | 'speed' | 'resolve' | 'upsolve' | 'deep' | 'position' | 'free'
export interface SessSpec { mode: SessMode; tags: string[]; lo: number; hi: number; minutes: number; timebox: number; why?: string; by?: 'coach' | 'default' | 'user'; pos?: string; /** curriculum sub-topic this block teaches */ sub?: string }
/** a running practice session: problems are served one at a time by the adaptive picker until the timer ends */
export interface CpActive {
  id: string; kind: 'sprint' | 'drill' | 'practice'; pids: string[]; startedAt: number; dur: number
  spec?: SessSpec; cur?: string | null; curAt?: number; servedAt?: number; band?: number; skipped?: string[]; hint?: Record<string, number>; specIdx?: number
  /** automatic breaks taken (oldest first; end null while it runs, len = its planned length; end === start: skipped) */
  breaks?: CpBreak[]
  /** the schedule block this session was started from (its play button / its Train row): finishing completes THAT block */
  blockId?: string
}
export interface CpBreak { start: number; end: number | null; len: number }
/** break time of a running session up to `at` (a running break counts up to its planned end) */
export const breakMs = (a: Pick<CpActive, 'breaks'>, at = Date.now()) => (a.breaks || []).reduce((t, b) => t + Math.max(0, Math.min(b.end ?? b.start + b.len, at) - b.start), 0)
/** break time inside [from, to] (a problem's time-box clock doesn't run during a break) */
export const breakIn = (a: Pick<CpActive, 'breaks'>, from: number, to: number) => (a.breaks || []).reduce((t, b) => t + Math.max(0, Math.min(b.end ?? b.start + b.len, to) - Math.max(b.start, from)), 0)
/** when a running session's clock runs out: its length plus every break taken */
export const activeEnd = (a: Pick<CpActive, 'breaks' | 'startedAt' | 'dur'>, at = Date.now()) => a.startedAt + a.dur * 60000 + breakMs(a, at)
/** minutes of the session really worked by `at` (breaks excluded, capped at its length) */
export const activeMin = (a: Pick<CpActive, 'breaks' | 'startedAt' | 'dur'>, at = Date.now()) => Math.max(0, Math.min(a.dur, (at - a.startedAt - breakMs(a, at)) / 60000))
export const openBreak = (a?: Pick<CpActive, 'breaks'> | null) => a?.breaks?.find(b => b.end === null)
/** the automatic-break settings (minutes) */
export const breakCfg = () => { const st = state.settings; return { on: st.autoBreak !== false, every: st.breakEvery || 55, len: st.breakLen || 5 } }
/** a break only comes when more than this much work is still left (a 60-min block doesn't break at 55 for its last 5) */
export const breakMinLeft = (len: number) => Math.max(5, len)
/** an automatic break logged by a timer (not a break you logged by hand) */
export const isAutoBreak = (s: Pick<Span, 'cat' | 'src'>) => s.cat === 'break' && s.src !== 'manual'
/** finished session record (practice minutes, discipline, graphs) */
export interface CpSession { /** last edit (missing: endedAt) */ u?: number; id: string; kind: 'practice' | 'sprint' | 'drill' | 'mock'; date: string; startedAt: number; endedAt: number; mins: number; pids: string[]; solved: string[]; spec?: SessSpec; h?: string; specIdx?: number; /** minutes of automatic breaks (not in mins) */ brk?: number; blockId?: string; /** those breaks [start, end] (solve times leave them out) */ brks?: [number, number][] }
/** append-only event log: union-merged by deterministic id */
export type CpEvKind = 'open' | 'sub' | 'ac' | 'giveup' | 'hint' | 'editorial' | 'resource' | 'debrief' | 'note' | 'skip'
export interface CpEvent {
  id: string; pid: string; k: CpEvKind; at: number; sess?: string; src?: string; h?: string
  v?: string; tn?: number; ms?: number; mem?: number; rel?: number; pt?: string   // CF submission fields
  hl?: number                                                                          // hint level reached
  blk?: string; ed?: string; felt?: string; n?: string; mins?: number              // debrief / note / resource
  ing?: number                                                                       // when the app first recorded it (coach delta watermark)
}
export interface ProbSummary { pid: string; firstOpen?: number; acAt?: number; subs: number; verdicts: Record<string, number>; hint: number; gaveUp: boolean; u: number }
/** 'paused' = you stopped learning it (kept as a record so the choice syncs; counts as not started) */
export type TopicState = 'learning' | 'learned' | 'mastered' | 'paused'
export interface CoachTodo { id: string; kind: string; title: string; minutes: number; ref: string; why: string; due: string; at: number; done?: boolean; added?: boolean; learned?: string; u: number }
export interface CoachQ { id: string; q: string; options: string[]; at: number; asked: number; answer?: string; answeredAt?: number; sent?: number; u: number }
export interface CoachMsg { id: string; at: number; kind: string; q?: string; out?: Record<string, unknown>; err?: string; gen?: number }
export interface CoachNow { text: string; action: string; ref: string; minutes: number; at: number }
export interface CoachWeak { area: string; evidence: string[]; status: string; plan: string }
export interface CoachReport {
  headline: string; position: string; estimated_level: number; next_milestone: string
  strengths: string[]; weaknesses: { topic: string; why: string; drill: string }[]
  focus_tags: string[]; this_week: string[]; today: string
}
export interface CpState {
  handle: string; handleU: number; plans: Record<string, CpPlan>; attempts: Record<string, CpAttempt>
  tests: Record<string, CpTest>; active: CpActive | null; activeU: number
  coach: { at: number; report: CoachReport } | null; focusTags: string[]; focusU: number
  /** self-estimated starting level for a new account (a prior that fades as real evidence arrives); 0 = not set */
  calib: number; calibU: number
  sessions: Record<string, CpSession>
  events: Record<string, CpEvent>; evCut: number; probStats: Record<string, ProbSummary>
  topics: Record<string, { st: TopicState; since: number; u: number }>
  resolve: Record<string, { due: string; step: number; wins: number; u: number }>
  offsets: { practice: number; mock: number; u: number; lastMock?: number; practiceDay?: string }
  speedPos: { list: string[]; u: number }
  coachLog: Record<string, CoachMsg>; coachAck: { upTo: number; gen: number; u: number }
  coachNow: CoachNow | null; coachTodos: Record<string, CoachTodo>; coachQs: Record<string, CoachQ>
  coachWeak: { list: CoachWeak[]; at: number }; coachNotes: { text: string; at: number }
  designs: { specs: SessSpec[]; forDate: string; at: number; mock?: { tag: string; rating: number }[] }
  triggers: Record<string, number>
  daily: Record<string, { level: number; internal: number; cf: number; topics: Record<string, number>; u: number }>
  ideas: Record<string, IdeaCard>
  /** list = live handles (derived from m); m = per-handle LWW register keyed by lowercase handle, so concurrent adds/removes merge (old copies have only list) */
  rivals: { list: string[]; u: number; m?: Record<string, { h: string; u: number; del?: boolean }> }
  /** optional morning self-report, correlated with performance */
  energy: Record<string, { sleep?: number; energy?: number; u: number }>
  /** the coach's catalogue of recurring tricks, clustered from the idea bank */
  tricks: { list: { name: string; pids: string[]; note?: string }[]; at: number }
  /** curriculum sub-topics you chose to learn / marked learned / stopped (derived mastery comes from solves) */
  subs: Record<string, { st: TopicState; since: number; u: number }>
  /** problems classified into curriculum sub-topics (by the coach, or by you) — beyond the curated lists */
  subtag: Record<string, { subs: string[]; by: 'coach' | 'user'; u: number }>
  /** CSES exercises you ticked off (no CSES API, so these are self-reported) */
  cses: Record<string, { done: boolean; at: number; u: number }>
}
export const MAX_RIVALS = 8
type Rivals = CpState['rivals']
const rivalMap = (r?: Rivals): NonNullable<Rivals['m']> => r?.m || Object.fromEntries((r?.list || []).map(h => [h.toLowerCase(), { h, u: r!.u }]))
const rivalList = (m: NonNullable<Rivals['m']>) => Object.values(m).filter(x => !x.del).sort((x, y) => x.u - y.u || (x.h < y.h ? -1 : 1)).slice(0, MAX_RIVALS).map(x => x.h)
/** add (del=false) or tombstone (del=true) one rival handle */
export function rivalsSet(r: Rivals | undefined, h: string, del: boolean, at = Date.now()): Rivals {
  const m = { ...rivalMap(r), [h.toLowerCase()]: { h, u: at, ...(del ? { del: true } : {}) } }
  return { list: rivalList(m), u: at, m }
}
function mergeRivals(a?: Rivals, b?: Rivals): Rivals {
  const m = { ...rivalMap(a) }
  for (const [k, y] of Object.entries(rivalMap(b))) { const x = m[k]; if (!x || y.u > x.u || (y.u === x.u && !!y.del && !x.del)) m[k] = y }
  return { list: rivalList(m), u: Math.max(a?.u || 0, b?.u || 0), m }
}
export const emptyCp = (): CpState => ({
  handle: '', handleU: 0, plans: {}, attempts: {}, tests: {}, active: null, activeU: 0, coach: null, focusTags: [], focusU: 0, calib: 0, calibU: 0,
  sessions: {}, events: {}, evCut: 0, probStats: {}, topics: {}, resolve: {}, offsets: { practice: 0, mock: 0, u: 0 }, speedPos: { list: [], u: 0 },
  coachLog: {}, coachAck: { upTo: 0, gen: 0, u: 0 }, coachNow: null, coachTodos: {}, coachQs: {}, coachWeak: { list: [], at: 0 },
  coachNotes: { text: '', at: 0 }, designs: { specs: [], forDate: '', at: 0 }, triggers: {}, daily: {}, ideas: {}, rivals: { list: [], u: 0 }, energy: {}, tricks: { list: [], at: 0 }, subs: {}, subtag: {}, cses: {},
})

/** the treat jar: a start mark (when the jar began counting) or a treat you redeemed. The jar counts from the newest treat
 *  (else the oldest start); xp0 is your total XP at that moment, so the jar's XP is what you earned since. Never edited. */
export interface Treat { id: string; kind: 'start' | 'treat'; at: number; xp0: number; what: string; u: number }
export interface State {
  cp: CpState
  /** treat jar marks, by id (grow-only; merged as a union) */ treats?: Record<string, Treat>
  agenda: PlannedTask[]
  planner: { proposals: Record<string, Proposal>; notes: { text: string; at: number } }
  /** exam weeks / holidays: what a day's training target is (season.ts targetFor); merged per id by u, deletes are a del flag */
  seasons: Record<string, Season>
  v: 2; days: Record<string, Day>; template: Block[]; goals: Goal[]; del: Record<string, number>
  frozen: string[]; earnedFreezes: string[]; achievements: string[]
  settings: Settings; settingsU: number; best: { streak: number; combo: number }
  /** bumped by "Reset everything": a state from a newer epoch replaces older ones wholesale on every device */
  epoch?: number
  /** derived */ xp: number; freezes: number
  /** derived */ stats: { tasksDone: number; perfectDays: number; focusMin: number; bestStreak: number; bestCombo: number }
}

/* ───────────────────────── helpers ───────────────────────── */
export const uid = () => Math.random().toString(36).slice(2, 10)
const pad = (n: number) => String(n).padStart(2, '0')
export const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const keyToDate = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d) }
export const addDays = (k: string, n: number) => { const d = keyToDate(k); d.setDate(d.getDate() + n); return dateKey(d) }
export const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
export const fmtMin = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
export const nowMin = (d = new Date()) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
export const fmtDur = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`
export const DEVICE = (() => { try { let d = localStorage.getItem('momentum.device'); if (!d) { d = uid(); localStorage.setItem('momentum.device', d) } return d } catch { return 'local' } })()
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/* ───────────────────────── work accounting ─────────────────────────
   Only real work earns: XP is proportional to the minutes of work you actually completed. No luck, ever. */
export const WORK_W: Record<Cat, number> = { deep: 1, study: 1, admin: 0.6, health: 0.4, life: 0.3, break: 0 }
export const isWork = (c: Cat) => c === 'deep' || c === 'study' || c === 'admin'
/* ───────── the work log ───────── */
const SLEEP = 90 * 60000 // a timer whose device was silent this long (asleep) didn't log work in that gap
const STALE = 3 * 60000 // a running span with no heartbeat for this long (app closed / crashed) counts up to its last beat
export const liveSpans = (d?: Day) => Object.values(d?.spans || {}).filter(s => !s.del)
/** a span's end for counting: its end, else (running) now — or its last heartbeat if that's stale */
export const spanEnd = (s: Span, now = Date.now()) => s.end ?? (s.beat && now - s.beat > STALE ? s.beat : now)
export const spanMin = (s: Span, now = Date.now()) => Math.max(0, (Math.min(spanEnd(s, now), now) - s.start) / 60000)
/** minutes covered by spans, overlaps counted once (two devices, a hand-logged stretch over a timer);
 *  lo/hi: only the part inside that window (a day's share of a span that crosses midnight) */
export function unionMin(ss: Span[], now = Date.now(), lo = -Infinity, hi = Infinity) {
  const iv = ss.map(s => [Math.max(lo, s.start), Math.min(spanEnd(s, now), now, hi)]).filter(x => x[1] > x[0]).sort((a, b) => a[0] - b[0])
  let tot = 0, a = 0, b = -Infinity
  for (const [s, e] of iv) { if (s > b) { if (b > a) tot += b - a; a = s; b = e } else b = Math.max(b, e) }
  if (b > a) tot += b - a
  return tot / 60000
}
/** every span logged for a task. A span lives on the day it started, so a task's stretch can sit on the day before
 *  (started last night) or after; del: include deleted ones (a task whose log was deleted is still "logged", at 0) */
export function taskSpans(d: Day, taskId: string, del = false) {
  return [state.days[addDays(d.date, -1)], d, state.days[addDays(d.date, 1)]].flatMap(x => Object.values(x?.spans || {})).filter(s => s.taskId === taskId && (del || !s.del))
}
/** a day's local window [00:00, next 00:00) in ms (DST-safe) */
export const dayWindow = (k: string): [number, number] => [keyToDate(k).getTime(), keyToDate(addDays(k, 1)).getTime()]
/** minutes really tracked for a task (undefined when it has no log — older days, or not timed). The whole task by default
 *  (its XP: a block run 23:00–01:00 took 120 min); clip: only its minutes inside day d (per-day accounting) */
export function taskMinutes(d: Day | undefined, taskId: string, now = Date.now(), clip = false) {
  if (!d) return undefined
  if (!taskSpans(d, taskId, true).length) return undefined
  const [lo, hi] = clip ? dayWindow(d.date) : [-Infinity, Infinity]
  return unionMin(taskSpans(d, taskId), now, lo, hi)
}
/** the spans that count toward day d: its own, clipped at midnight, plus the previous day's that ran past midnight */
export function daySpans(d: Day) {
  const lo = dayWindow(d.date)[0], prev = state.days[addDays(d.date, -1)]
  return [...liveSpans(prev).filter(s => spanEnd(s) > lo), ...liveSpans(d)]
}
/** done work tasks with no log at all (older days, or "didn't time it"): their planned length */
export const untimedMin = (d: Day, until?: number) => d.tasks.reduce((a, t) => a + (t.done && isWork(t.cat) && (until === undefined || (t.doneAt || 0) <= until) && !taskSpans(d, t.id, true).length ? t.dur : 0), 0)
/** real work minutes: every logged deep/study/admin minute (overlaps once); tasks finished without any log count their planned length */
export function workMin(d?: Day, until?: number) {
  if (!d) return 0
  const now = until ?? Date.now(), [lo, hi] = dayWindow(d.date)
  // a span is stored on its start day: 23:00–01:00 gives 60 min to each day (this one looks back for yesterday's overflow)
  return Math.round(unionMin(daySpans(d).filter(s => isWork(s.cat) && s.start <= now), now, lo, hi) + untimedMin(d, until))
}
export const totalWork = (s: State) => Object.values(s.days).reduce((a, d) => a + workMin(d), 0)
export const bestWorkDay = (s: State, exclude?: string) => Object.values(s.days).reduce((b, d) => d.date === exclude ? b : Math.max(b, workMin(d)), 0)

/* ───────────────────────── levels ───────────────────────── */
export const xpFor = (lvl: number) => Math.round(80 * Math.pow(lvl, 1.45))
const TITLES = ['Drifter', 'Starter', 'Grinder', 'Focused', 'Disciplined', 'Relentless', 'Machine', 'Unstoppable', 'Legend', 'Mythic', 'Transcendent']
export function levelInfo(xp: number) {
  let lvl = 1, rest = xp
  while (rest >= xpFor(lvl)) { rest -= xpFor(lvl); lvl++ }
  return { lvl, into: rest, need: xpFor(lvl), title: TITLES[Math.min(TITLES.length - 1, Math.floor(lvl / 2))] }
}
export const ACH_XP = 50

/* ───────────────────────── quests (fixed, every day) ───────────────────────── */
export const QUESTS: Record<QuestId, { title: string; icon: string; xp: number; eval: (d: Day, s: State) => [number, number] }> = {
  firstOnTime: { title: 'Nail your first block on time', icon: 'rocket_launch', xp: 25, eval: d => { const f = d.tasks.filter(t => t.start).sort((a, b) => toMin(a.start!) - toMin(b.start!))[0]; return [f?.ontime ? 1 : 0, 1] } },
  focus: { title: 'Focus mode for 90 minutes', icon: 'timer', xp: 60, eval: d => [Math.min(d.focusMin, 90), 90] },
  work: { title: 'Hit your daily work target', icon: 'work', xp: 80, eval: (d, s) => [Math.min(workMin(d), s.settings.workTarget * 60), s.settings.workTarget * 60] },
  perfect: { title: 'Perfect day — clear every task', icon: 'verified', xp: 80, eval: d => [d.tasks.filter(t => t.done).length, Math.max(1, d.tasks.length)] },
}
const DAILY_QUESTS: QuestId[] = ['firstOnTime', 'focus', 'work', 'perfect']

/* ───────────────────────── achievements ───────────────────────── */
export const ACHIEVEMENTS: { id: string; title: string; desc: string; icon: string; test: (s: State, streak: number) => boolean }[] = [
  { id: 'first', title: 'First blood', desc: 'Complete your first task', icon: 'flag', test: s => s.stats.tasksDone >= 1 },
  { id: 't50', title: 'Workhorse', desc: '50 tasks done', icon: 'construction', test: s => s.stats.tasksDone >= 50 },
  { id: 't250', title: 'Factory', desc: '250 tasks done', icon: 'factory', test: s => s.stats.tasksDone >= 250 },
  { id: 's3', title: 'Warming up', desc: '3-day streak', icon: 'local_fire_department', test: (s, st) => Math.max(st, s.stats.bestStreak) >= 3 },
  { id: 's7', title: 'One week strong', desc: '7-day streak', icon: 'whatshot', test: (s, st) => Math.max(st, s.stats.bestStreak) >= 7 },
  { id: 's30', title: 'Habit forged', desc: '30-day streak', icon: 'military_tech', test: (s, st) => Math.max(st, s.stats.bestStreak) >= 30 },
  { id: 'perfect', title: 'Flawless', desc: 'A perfect day', icon: 'verified', test: s => s.stats.perfectDays >= 1 },
  { id: 'perfect10', title: 'Perfectionist', desc: '10 perfect days', icon: 'diamond', test: s => s.stats.perfectDays >= 10 },
  { id: 'w10', title: 'Clocked in', desc: '10 hours of real work', icon: 'work', test: s => totalWork(s) >= 600 },
  { id: 'w100', title: 'Centurion', desc: '100 hours of real work', icon: 'workspace_premium', test: s => totalWork(s) >= 6000 },
  { id: 'w500', title: 'Obsessed', desc: '500 hours of real work', icon: 'diamond', test: s => totalWork(s) >= 30000 },
  { id: 'day8', title: 'Eight-hour grind', desc: '8h of work in one day', icon: 'bolt', test: s => bestWorkDay(s) >= 480 },
  { id: 'combo5', title: 'Chain reaction', desc: 'Reach a ×5 combo', icon: 'bolt', test: s => s.stats.bestCombo >= 5 },
  { id: 'focus10', title: 'Monk mode', desc: '10 hours in focus mode', icon: 'self_improvement', test: s => s.stats.focusMin >= 600 },
  { id: 'lvl5', title: 'Level 5', desc: 'Reach level 5', icon: 'trending_up', test: s => levelInfo(s.xp).lvl >= 5 },
  { id: 'lvl15', title: 'Level 15', desc: 'Reach level 15', icon: 'workspace_premium', test: s => levelInfo(s.xp).lvl >= 15 },
]

/* ───────────────────────── defaults ───────────────────────── */
const ALL = [0, 1, 2, 3, 4, 5, 6], WK = [1, 2, 3, 4, 5]
const blk = (id: string, title: string, start: string, dur: number, cat: Cat, days = ALL): Block => ({ id, title, start, dur, cat, days, u: 0 })
const DEFAULT_SETTINGS: Settings = { name: '', seed: '#6750A4', mode: 'system', style: 'expressive', sound: true, haptics: true, threshold: 80, workTarget: 6, coachAutoAdd: true, pomoWork: 50, pomoBreak: 10, pomoLong: 20, disciplineBar: 85, contrast: 0, amoled: false, tierTheme: false, autoBreak: true, breakEvery: 55, breakLen: 5 }
// fixed ids so two fresh devices don't end up with duplicate default routines after their first sync
function defaults(): State {
  return derive({
    cp: emptyCp(), agenda: [], planner: { proposals: {}, notes: { text: '', at: 0 } }, seasons: {}, v: 2, days: {}, del: {}, frozen: [], earnedFreezes: [], achievements: [], settingsU: 0, best: { streak: 0, combo: 0 },
    template: [
      blk('d-wake', 'Wake up, water, make bed', '07:00', 15, 'health'),
      blk('d-workout', 'Workout', '07:30', 45, 'health'),
      blk('d-deep1', 'Deep work block I', '08:30', 90, 'deep'),
      blk('d-class', 'Lectures / classes', '10:15', 120, 'study', WK),
      blk('d-lunch', 'Lunch + walk', '13:00', 45, 'break'),
      blk('d-deep2', 'Deep work block II', '14:00', 90, 'deep'),
      blk('d-cp', 'Competitive programming', '16:00', 90, 'study'),
      blk('d-admin', 'Admin & messages', '18:00', 30, 'admin'),
      blk('d-dinner', 'Dinner', '19:00', 45, 'break'),
      blk('d-review', 'Review today, plan tomorrow', '21:30', 20, 'admin'),
      blk('d-wind', 'Wind down — no screens', '22:30', 30, 'life'),
    ],
    goals: [
      { id: 'g-water', title: 'Water', target: 8, step: 1, unit: 'glasses', icon: 'water_drop', u: 0 },
    ],
    settings: { ...DEFAULT_SETTINGS },
  } as unknown as State)
}

/* ───────────────────────── derived fields ───────────────────────── */
// self-contained (derive() runs while the module is still loading, before the helpers further down exist)
function qualifiesRaw(s: State, k: string) { const d = s.days[k]; if (!d || !d.tasks.length) return false; return d.tasks.filter(t => t.done).length / d.tasks.length * 100 >= s.settings.threshold - 1e-9 }
function derive(s: State): State {
  const days: Record<string, Day> = {}
  for (const k in s.days) {
    const d = s.days[k]
    const focusMin = sum(Object.values(d.focusBy || {}))
    const xp = sum(d.tasks.map(t => t.done ? t.xp || 0 : 0)) + sum(Object.values(d.bonus || {})) + focusMin
    days[k] = d.xp === xp && d.focusMin === focusMin ? d : { ...d, xp, focusMin }
  }
  const all = Object.values(days)
  return {
    ...s, days,
    xp: sum(all.map(d => d.xp)) + s.achievements.length * ACH_XP,
    // a freeze spent on a day that turned out to qualify (e.g. used before the other device's data arrived) is refunded
    freezes: Math.max(0, 1 + s.earnedFreezes.length - s.frozen.filter(k => !qualifiesRaw(s, k)).length),
    stats: {
      tasksDone: sum(all.map(d => d.tasks.filter(t => t.done).length)),
      perfectDays: all.filter(d => d.perfect).length,
      focusMin: sum(all.map(d => d.focusMin)),
      bestStreak: s.best.streak, bestCombo: s.best.combo,
    },
  }
}

/* ───────────────────────── merge (CRDT-ish) ───────────────────────── */
const maxMap = (a: Record<string, number> = {}, b: Record<string, number> = {}) => { const o = { ...a }; for (const k in b) o[k] = Math.max(o[k] ?? -Infinity, b[k]); return o }
const union = <T,>(a: T[] = [], b: T[] = []) => [...new Set([...a, ...b])]
function lww<T extends { id: string; u: number }>(a: T[], b: T[], del: Record<string, number>) {
  const m = new Map<string, T>()
  // a tie (two devices wrote the same record at the same u, e.g. the trainer's block sync) resolves the same way on both sides
  for (const x of [...a, ...b]) { const c = m.get(x.id); if (!c || x.u > c.u || (x.u === c.u && x !== c && JSON.stringify(x) > JSON.stringify(c))) m.set(x.id, x) }
  return [...m.values()].filter(x => !(del[x.id] >= x.u))
}
/* ── tasks: the record merges by u, its completion by doneU (two stamps, so each side keeps what it changed last) ── */
const DONE_F = ['done', 'doneAt', 'xp', 'xpm', 'ontime', 'doneU'] as const
// no doneU: an old client wrote it (it completes AND uncompletes by u alone), so its u is the completion's stamp too
export const doneStamp = (t: Task) => t.doneU ?? t.u
const later2 = <T,>(x: T, y: T, kx: number, ky: number) => kx !== ky ? (ky > kx ? y : x) : JSON.stringify(y) > JSON.stringify(x) ? y : x
/** seasons: the newer edit wins per id; a delete is a del flag on the record (never pruned: a past season still decides how
 *  those days were scored, so dropping its tombstone could let an old copy bring it back); a tie prefers the delete */
function mergeSeasons(a: Record<string, Season> = {}, b: Record<string, Season> = {}) {
  const o = { ...a }
  for (const [k, y] of Object.entries(b)) { const x = o[k]; o[k] = !x ? y : x.u === y.u && !!x.del !== !!y.del ? (x.del ? x : y) : later2(x, y, x.u, y.u) }
  return o
}
function mergeTask(x: Task, y: Task): Task {
  const base = later2(x, y, x.u, y.u), sx = doneStamp(x), sy = doneStamp(y)
  const c = sx !== sy ? (sy > sx ? y : x) : base // completion tie: the newer record decides
  if (c === base) return base
  const o = { ...base } as Record<string, unknown>
  for (const f of DONE_F) if (c[f] !== undefined) o[f] = c[f]; else delete o[f]
  o.doneU = doneStamp(c) // keep the stamp the completion was judged by (base's newer u must not stand in for it)
  return o as unknown as Task
}
/** a local write stamps doneU on each task it adds or changes that lacks it: the stamp its completion had before (u of the old
 *  copy), 0 for a new undone task, so a later title edit here never reads as a newer completion state (untouched tasks stay as they are) */
function stampDone(prev: Day | undefined, next: Day): Day {
  const old = new Map((prev?.tasks || []).map(t => [t.id, t]))
  if (!next?.tasks?.some(t => t.doneU === undefined && old.get(t.id) !== t)) return next
  return { ...next, tasks: next.tasks.map(t => { const p = old.get(t.id); if (t.doneU !== undefined || p === t) return t; return { ...t, doneU: p ? doneStamp(p) : t.done ? t.u : 0 } }) }
}
function mergeTasks(a: Task[], b: Task[], del: Record<string, number>) {
  const m = new Map<string, Task>()
  for (const x of [...a, ...b]) { const c = m.get(x.id); m.set(x.id, !c || c === x ? x : mergeTask(c, x)) }
  return [...m.values()].filter(x => !(del[x.id] >= x.u))
}
/* ── goal counters: per device [added, removed], merged by max, summed (two devices adding a glass each = 2).
   A client from before counters changes goals[id] without gc (or drops/keeps a stale gc): such a copy no longer adds up, and that
   goal falls back to last-write-wins by goalsU (the old rule) until a bump here re-bases the counters on the shown value. ── */
type GoalCount = NonNullable<Day['gc']>
const r2 = (n: number) => Math.round(n * 100) / 100
/** a day's counters (a copy from before per-device counting: its value as the shared 'legacy' entry) */
export const goalCounts = (d: Pick<Day, 'goals' | 'gc'>): GoalCount => {
  const o: GoalCount = { ...(d.gc || {}) }
  for (const id in d.goals || {}) if (!o[id] && d.goals[id]) o[id] = { legacy: [d.goals[id], 0] }
  return o
}
export const goalTotal = (c?: Record<string, [number, number]>) => r2(Object.values(c || {}).reduce((t, [p, n]) => t + p - n, 0))
/** the counters (raw, never synthesized) add up to the value shown */
const goalOk = (d: Day, id: string) => { const c = d.gc?.[id], v = d.goals?.[id] ?? 0; return c ? Math.max(0, goalTotal(c)) === r2(v) : !v }
function mergeGoals(a: Day, b: Day) {
  const gc: GoalCount = {}, goals: Record<string, number> = {}, goalsU: Record<string, number> = {}
  for (const id of union(Object.keys(a.goalsU || {}), Object.keys(b.goalsU || {}))) goalsU[id] = Math.max(a.goalsU?.[id] ?? -1, b.goalsU?.[id] ?? -1)
  const ids = union(union(Object.keys(a.goals || {}), Object.keys(b.goals || {})), union(Object.keys(a.gc || {}), Object.keys(b.gc || {})))
  for (const id of ids) {
    const ca = a.gc?.[id], cb = b.gc?.[id], okA = goalOk(a, id), okB = goalOk(b, id)
    // two different 'legacy' values = devices that migrated different pre-counter values: max would drop the newer change
    const clash = !!ca?.legacy && !!cb?.legacy && (ca.legacy[0] !== cb.legacy[0] || ca.legacy[1] !== cb.legacy[1])
    if (okA && okB && !clash) {
      const m: Record<string, [number, number]> = { ...(ca || {}) }
      for (const [dev, [p, n]] of Object.entries(cb || {})) { const x = m[dev]; m[dev] = x ? [Math.max(x[0], p), Math.max(x[1], n)] : [p, n] }
      if (Object.keys(m).length) gc[id] = m
      goals[id] = Math.max(0, goalTotal(m))
      continue
    }
    // last write wins (ties: the copy that adds up, then a stable order, so both merge orders agree); its counters go with it
    const ua = a.goalsU?.[id] ?? -1, ub = b.goalsU?.[id] ?? -1
    const w = ua !== ub ? (ub > ua ? b : a) : okA !== okB ? (okA ? a : b)
      : JSON.stringify([b.goals?.[id] ?? 0, cb ?? null]) > JSON.stringify([a.goals?.[id] ?? 0, ca ?? null]) ? b : a
    goals[id] = w.goals?.[id] ?? 0
    if (w.gc?.[id]) gc[id] = w.gc[id]
  }
  return { gc, goals, goalsU }
}
function mergeDay(a?: Day, b?: Day): Day {
  if (!a) return b!; if (!b) return a
  const del = maxMap(a.del, b.del)
  const later = (b.lastDoneAt || 0) > (a.lastDoneAt || 0) ? b : a
  return {
    ...a, del, ...mergeGoals(a, b),
    tasks: mergeTasks(a.tasks, b.tasks, del),
    goalsHit: union(a.goalsHit, b.goalsHit),
    locked: a.locked || b.locked,
    lockedAt: a.lockedAt && b.lockedAt ? Math.min(a.lockedAt, b.lockedAt) : a.lockedAt || b.lockedAt,
    perfect: a.perfect || b.perfect,
    quests: DAILY_QUESTS.map(id => ({ id, claimed: !!(a.quests.find(q => q.id === id)?.claimed || b.quests.find(q => q.id === id)?.claimed) })),
    focusBy: maxMap(a.focusBy, b.focusBy), bonus: maxMap(a.bonus, b.bonus),
    // a span tombstone folded into del (pruneState) still beats a stale live copy
    spans: (() => { const o: Record<string, Span> = { ...(a.spans || {}) }; for (const [k, y] of Object.entries(b.spans || {})) o[k] = o[k] ? mergeSpan(o[k], y) : y; for (const k in o) if (del[k] >= o[k].u) delete o[k]; return o })(),
    calories: (() => { const o: Record<string, MealEntry> = { ...(a.calories || {}) }; for (const [k, y] of Object.entries(b.calories || {})) { const x = o[k]; o[k] = !x ? y : (!x.del !== !y.del && y.u >= x.u) ? y : y.u > x.u ? y : x } for (const k in o) if (del[k] >= o[k].u) delete o[k]; return o })(),
    combo: later.combo, lastDoneAt: later.lastDoneAt, maxCombo: Math.max(a.maxCombo, b.maxCombo),
  }
}
/** a delete and a stop stick whatever the clocks say (a stale copy can't reopen or revive a span); otherwise last write wins.
 *  The heartbeat doesn't bump u, so it never beats a real edit: beats merge by max */
function mergeSpan(x: Span, y: Span): Span {
  if (!x.del !== !y.del) return x.del ? x : y
  if ((x.end === null) !== (y.end === null)) return x.end === null ? y : x
  const w = later2(x, y, x.u, y.u), beat = Math.max(x.beat || 0, y.beat || 0)
  return w.end === null && beat ? { ...w, beat } : w
}
function mergeTest(a?: CpTest, b?: CpTest): CpTest {
  if (!a) return b!; if (!b) return a
  // two devices started *different* rounds offline under the same id: keep the one started first, whole
  if (a.pids.join() !== b.pids.join()) return a.startedAt !== b.startedAt ? (a.startedAt < b.startedAt ? a : b) : (a.pids.join() < b.pids.join() ? a : b)
  // the virtual run was restarted on CF: the copy that saw the newer run owns vStart, probs and solves wholesale (min/max would resurrect the old run)
  const rv = a.real?.vStart && b.real?.vStart && a.real.vStart !== b.real.vStart ? (a.real.vStart > b.real.vStart ? a : b) : null
  const solved = rv ? { ...rv.solved } : { ...a.solved }
  if (!rv) for (const k in b.solved) if (a.pids.includes(k)) solved[k] = Math.min(solved[k] ?? Infinity, b.solved[k])
  const fin = a.finishedAt && b.finishedAt ? Math.min(a.finishedAt, b.finishedAt) : a.finishedAt || b.finishedAt
  // perf comes from whichever device finished first (ties: more solves, then the copy with real-round results, higher perf, then a stable order) so both sides converge on the same number
  const ahead = (x: CpTest, y: CpTest) => {
    const sx = Object.keys(x.solved).length, sy = Object.keys(y.solved).length; if (sx !== sy) return sx > sy
    const rx = x.real?.rank !== undefined, ry = y.real?.rank !== undefined; if (rx !== ry) return rx
    const px = x.real?.perf ?? x.perf ?? -Infinity, py = y.real?.perf ?? y.perf ?? -Infinity; if (px !== py) return px > py
    return JSON.stringify(x.real ?? null) <= JSON.stringify(y.real ?? null)
  }
  const first = !a.finishedAt ? b : !b.finishedAt ? a : a.finishedAt !== b.finishedAt ? (a.finishedAt < b.finishedAt ? a : b) : (ahead(a, b) ? a : b)
  // real rounds: per-problem facts come from CF submissions (identical on both devices), so take the earliest solve and the most rejections; results from the first finisher
  let real = a.real || b.real
  if (a.real && b.real) {
    const probs: RealRound['probs'] = rv ? { ...rv.real!.probs } : { ...a.real.probs }
    if (!rv) for (const [k, y] of Object.entries(b.real.probs)) { const x = probs[k]; probs[k] = !x ? y : { at: x.at === undefined ? y.at : y.at === undefined ? x.at : Math.min(x.at, y.at), wa: Math.max(x.wa, y.wa) } }
    const fr = first.real || a.real
    real = { ...fr, vStart: rv ? rv.real!.vStart : a.real.vStart ?? b.real.vStart, probs }
  }
  return { ...a, startedAt: Math.min(a.startedAt, b.startedAt), solved, finishedAt: fin, perf: first.perf ?? a.perf ?? b.perf, ...(real ? { real } : {}) }
}
export function mergeCp(a: CpState = emptyCp(), b: CpState = emptyCp()): CpState {
  const plans: Record<string, CpPlan> = { ...a.plans }
  for (const k in b.plans) {
    const x = plans[k], y = b.plans[k]
    // a deliberate regenerate bumps rev; otherwise the first plan generated that day stays (stable across devices)
    // ties: the plan built from the newer calibration wins (matches the calib LWW below), then the earliest built
    plans[k] = !x ? y : y.rev > x.rev || (y.rev === x.rev && ((y.calibU || 0) > (x.calibU || 0) || ((y.calibU || 0) === (x.calibU || 0) && y.genAt < x.genAt))) ? y : x
  }
  const attempts: Record<string, CpAttempt> = { ...a.attempts }
  for (const k in b.attempts) {
    const x = attempts[k], y = b.attempts[k]
    // a solve is permanent: a later "failed" from the other device can never erase it (keep the earliest solve)
    if (!x) attempts[k] = y
    else if (x.status === 'solved' || y.status === 'solved') attempts[k] = x.status !== 'solved' ? y : y.status !== 'solved' ? x : (y.at < x.at ? y : x)
    else if (y.u > x.u) attempts[k] = y
  }
  const tests: Record<string, CpTest> = {}
  for (const k of union(Object.keys(a.tests), Object.keys(b.tests))) tests[k] = mergeTest(a.tests[k], b.tests[k])
  const h = b.handleU > a.handleU ? b : a, act = b.activeU > a.activeU ? b : a, f = b.focusU > a.focusU ? b : a
  const cal = (b.calibU || 0) > (a.calibU || 0) ? b : a
  const evCut = Math.max(a.evCut || 0, b.evCut || 0)
  const events: Record<string, CpEvent> = {}
  for (const src of [a.events || {}, b.events || {}]) for (const k in src) {
    const e = src[k]; if (e.at < evCut) continue
    const x = events[k]; if (!x || e.at < x.at) events[k] = e
  }
  const newer = <T extends { u: number }>(x: T | undefined, y: T | undefined) => !x ? y! : !y ? x : y.u > x.u ? y : x
  const byU = <T extends { u: number }>(m1: Record<string, T> = {}, m2: Record<string, T> = {}) => { const o: Record<string, T> = { ...m1 }; for (const k in m2) o[k] = newer(o[k], m2[k]); return o }
  const later = <T extends { at: number }>(x: T | null | undefined, y: T | null | undefined) => (y?.at || 0) > (x?.at || 0) ? y! : x!
  const ackA = a.coachAck || { upTo: 0, gen: 0, u: 0 }, ackB = b.coachAck || { upTo: 0, gen: 0, u: 0 }
  return {
    calib: cal.calib || 0, calibU: cal.calibU || 0,
    // per entry: the newer edit (u, else endedAt) wins, ties settle the same way on both sides
    sessions: (() => { const o = { ...(a.sessions || {}) }; for (const [k, y] of Object.entries(b.sessions || {})) { const x = o[k]; o[k] = !x ? y : later2(x, y, x.u ?? x.endedAt, y.u ?? y.endedAt) } return o })(),
    events, evCut, probStats: byU(a.probStats, b.probStats),
    topics: byU(a.topics, b.topics), resolve: byU(a.resolve, b.resolve),
    offsets: newer(a.offsets, b.offsets) || { practice: 0, mock: 0, u: 0 }, speedPos: newer(a.speedPos, b.speedPos) || { list: [], u: 0 },
    // a chat turn: the copy that has the coach's answer (or error) wins over the placeholder, then the newer one
    coachLog: capCoachLog((() => { const o = { ...(a.coachLog || {}) }; for (const [k, y] of Object.entries(b.coachLog || {})) { const x = o[k]; const rank = (m: typeof y) => (m.out ? 2 : m.err ? 1 : 0); o[k] = !x ? y : rank(y) > rank(x) || (rank(y) === rank(x) && y.at > x.at) ? y : x } return o })()),
    coachAck: ackB.gen > ackA.gen || (ackB.gen === ackA.gen && ackB.upTo > ackA.upTo) ? ackB : ackA,
    coachNow: later(a.coachNow, b.coachNow) || null,
    coachTodos: byU(a.coachTodos, b.coachTodos), coachQs: byU(a.coachQs, b.coachQs),
    coachWeak: later(a.coachWeak, b.coachWeak) || { list: [], at: 0 }, coachNotes: later(a.coachNotes, b.coachNotes) || { text: '', at: 0 },
    designs: later(a.designs, b.designs) || { specs: [], forDate: '', at: 0 },
    triggers: maxMap(a.triggers, b.triggers),
    daily: byU(a.daily, b.daily),
    ideas: byU(a.ideas, b.ideas), rivals: mergeRivals(a.rivals, b.rivals),
    // energy: a real report beats a skip / empty entry regardless of u, then the newer
    energy: (() => { const o = { ...(a.energy || {}) }; for (const [k, y] of Object.entries(b.energy || {})) { const x = o[k], has = (e: typeof y) => e.sleep !== undefined || e.energy !== undefined; o[k] = !x ? y : has(x) !== has(y) ? (has(y) ? y : x) : y.u > x.u ? y : x } return o })(), tricks: later(a.tricks, b.tricks) || { list: [], at: 0 },
    subs: byU(a.subs, b.subs), subtag: byU(a.subtag, b.subtag), cses: byU(a.cses, b.cses),
    handle: h.handle, handleU: h.handleU, plans, attempts, tests, active: mergeActive(act.active, (act === a ? b : a).active), activeU: act.activeU,
    coach: (b.coach?.at || 0) > (a.coach?.at || 0) ? b.coach : a.coach, focusTags: f.focusTags, focusU: f.focusU,
  }
}
/** the same running session on two devices: the newer copy wins, but its breaks merge entry by entry (a late tick on one device
 *  can't undo a Skip / End-early made on the other): union by start, a closed break beats a running one, the earlier end wins,
 *  and a break that overlaps the one before it (each device started its own) is dropped */
function mergeBreaks(x: CpBreak[] = [], y: CpBreak[] = []): CpBreak[] | undefined {
  const by = new Map<number, CpBreak>()
  for (const b of [...x, ...y]) {
    const o = by.get(b.start)
    by.set(b.start, !o ? b : o.end === null ? b : b.end === null ? o : b.end < o.end ? b : o)
  }
  const out: CpBreak[] = []
  for (const b of [...by.values()].sort((p, q) => p.start - q.start)) {
    const prev = out[out.length - 1]
    if (prev && b.start < (prev.end ?? prev.start + prev.len)) continue
    out.push(b)
  }
  return out.length ? out : undefined
}
function mergeActive(win: CpActive | null, other: CpActive | null): CpActive | null {
  if (!win || !other || win.id !== other.id || (!win.breaks?.length && !other.breaks?.length)) return win
  return { ...win, breaks: mergeBreaks(win.breaks, other.breaks) }
}
/** a session finished on two devices either side of midnight lands on two days: keep it only on the earliest */
const ONCE = /^(cp:|test:)/, ONCE_TASK = /^w:(test:|sprint:|drill:)/
function dedupeSessions(days: Record<string, Day>) {
  const seenB = new Set<string>(), seenT = new Set<string>()
  for (const k of Object.keys(days).sort()) {
    const d = days[k]
    const dupB = Object.keys(d.bonus).filter(id => ONCE.test(id) && seenB.has(id))
    const dupT = d.tasks.filter(t => ONCE_TASK.test(t.id) && seenT.has(t.id))
    Object.keys(d.bonus).filter(id => ONCE.test(id)).forEach(id => seenB.add(id))
    d.tasks.filter(t => ONCE_TASK.test(t.id)).forEach(t => seenT.add(t.id))
    if (dupB.length || dupT.length) {
      const bonus = { ...d.bonus }; dupB.forEach(id => delete bonus[id])
      days[k] = { ...d, bonus, tasks: d.tasks.filter(t => !dupT.includes(t)) }
    }
  }
}
export function mergeStates(a: State, b: State): State {
  // a reset on any device wins over everything from before it (settings: the newer edit still wins)
  const ea = a.epoch || 0, eb = b.epoch || 0
  if (ea !== eb) {
    const w = ea > eb ? a : b, l = ea > eb ? b : a
    return derive(capState(l.settingsU > w.settingsU && l.settingsU > Math.max(ea, eb) ? { ...w, settings: l.settings, settingsU: l.settingsU } : w))
  }
  const del = maxMap(a.del, b.del)
  const days: Record<string, Day> = {}
  for (const k of union(Object.keys(a.days), Object.keys(b.days))) days[k] = mergeDay(a.days[k], b.days[k])
  dedupeSessions(days)
  const newerSettings = b.settingsU > a.settingsU ? b : a
  // capState: the pruned collections are cut again after the union, so nothing pruned comes back from the other side
  return derive(capState({
    ...a, days, del, cp: mergeCp(a.cp, b.cp),
    template: lww(a.template, b.template, del), goals: lww(a.goals, b.goals, del),
    frozen: union(a.frozen, b.frozen), earnedFreezes: union(a.earnedFreezes, b.earnedFreezes), achievements: union(a.achievements, b.achievements),
    settings: newerSettings.settings, settingsU: newerSettings.settingsU,
    agenda: lww(a.agenda || [], b.agenda || [], del), seasons: mergeSeasons(a.seasons, b.seasons), treats: { ...(a.treats || {}), ...(b.treats || {}) },
    planner: {
      proposals: (() => { const o = { ...(a.planner?.proposals || {}) }; for (const [k, v] of Object.entries(b.planner?.proposals || {})) o[k] = !o[k] ? v : later2(o[k], v, o[k].u, v.u); return o })(),
      notes: (b.planner?.notes?.at || 0) > (a.planner?.notes?.at || 0) ? b.planner.notes : (a.planner?.notes || { text: '', at: 0 }),
    },
    best: { streak: Math.max(a.best.streak, b.best.streak), combo: Math.max(a.best.combo, b.best.combo) },
  }))
}

/* ───────────────────────── pruning (bounded state that stays pruned across devices) ─────────────────────────
   Every cut is a deterministic rule that mergeStates re-applies after its union (capState), never a bare delete:
   a device that still has the old copy can't bring a pruned record back. Tombstones are only dropped where a cutoff
   already drops what they protect. */
export const KEEP_PROPOSALS = 10, KEEP_COACHLOG = 30, UNDO_DAYS = 2, AGENDA_DAYS = 14, TOMB_DAYS = 30, SLIM_DAYS = 120
const DAY_MS = 864e5
/** the newest n entries by time (ties by id, so both devices keep the same set) */
function newest<T extends { id: string; at: number }>(m: Record<string, T>, n: number): Record<string, T> {
  const xs = Object.values(m); if (xs.length <= n) return m
  return Object.fromEntries(xs.sort((x, y) => y.at - x.at || (x.id < y.id ? -1 : 1)).slice(0, n).map(x => [x.id, x]))
}
/** the coach chat keeps its newest turns (the panel shows 30) */
export function capCoachLog(m: Record<string, CoachMsg>) { return newest(m, KEEP_COACHLOG) }
const DATED = /:(\d{4}-\d{2}-\d{2})$/
/** the cheap cuts mergeStates applies: proposals (newest 10; undo snapshots go after 2 days), agenda items older than
 *  14 days, and the top-level tombstones of those agenda ids (the agenda cut already drops what they protected) */
export function capState(s: State, now = Date.now()): State {
  const props0 = s.planner?.proposals || {}, undoCut = now - UNDO_DAYS * DAY_MS
  let props = newest(props0, KEEP_PROPOSALS)
  if (Object.values(props).some(p => p.undo && p.at < undoCut)) props = Object.fromEntries(Object.entries(props).map(([k, p]) => { if (!p.undo || p.at >= undoCut) return [k, p]; const q = { ...p }; delete q.undo; return [k, q] }))
  const cut = dateKey(new Date(now - AGENDA_DAYS * DAY_MS)), agenda = (s.agenda || []).filter(a => a.date >= cut)
  const tombCut = now - TOMB_DAYS * DAY_MS
  const gone = Object.keys(s.del || {}).filter(id => { const m = DATED.exec(id); return s.del[id] < tombCut && !!m && m[1] < cut })
  const del = gone.length ? Object.fromEntries(Object.entries(s.del).filter(([id]) => !gone.includes(id))) : s.del
  const coachLog = s.cp ? capCoachLog(s.cp.coachLog || {}) : undefined
  if (props === props0 && agenda.length === (s.agenda || []).length && del === s.del && coachLog === s.cp?.coachLog) return s
  return { ...s, del, agenda, planner: { ...s.planner, proposals: props }, ...(s.cp ? { cp: { ...s.cp, coachLog: coachLog! } } : {}) }
}
/** a day's records in the current shape: done tasks get their completion stamp, goal values their per-device counters */
function migrateDay(d: Day): Day {
  let o = d
  if (d.tasks.some(t => t.done && t.doneU === undefined)) o = { ...o, tasks: d.tasks.map(t => t.done && t.doneU === undefined ? { ...t, doneU: t.u } : t) }
  if (Object.keys(d.goals || {}).some(id => !d.gc?.[id] && d.goals[id])) o = { ...o, gc: goalCounts(d) }
  return o
}
/** the full prune + migration, run on load (not on every commit): capState, then per day
 *  - span tombstones older than 30 days fold into the day's del map (id → u, which mergeDay applies to spans), or shrink to
 *    a stub when tied to a task (a task whose log was deleted still counts as logged, at 0)
 *  - days older than 120 days drop what only a live day uses (a closed span's heartbeat/device, a task's session spec,
 *    planner link and routine id); everything the history views, streaks, XP and work hours read stays */
export function pruneState(s0: State, now = Date.now()): State {
  const s = capState(s0, now), tombCut = now - TOMB_DAYS * DAY_MS, oldKey = dateKey(new Date(tombCut)), slimKey = dateKey(new Date(now - SLIM_DAYS * DAY_MS))
  let days: Record<string, Day> | null = null
  for (const [k, d0] of Object.entries(s.days || {})) {
    let d = migrateDay(d0)
    if (k < oldKey && d.spans) {
      const dead = Object.values(d.spans).filter(x => x.del && x.u < tombCut && !(x.title === '' && x.end === x.start && x.beat === undefined && x.dev === undefined))
      if (dead.length) {
        const spans = { ...d.spans }, del = { ...d.del }
        for (const x of dead) {
          if (x.taskId) spans[x.id] = { id: x.id, taskId: x.taskId, title: '', cat: x.cat, src: x.src, start: x.start, end: x.start, u: x.u, del: true }
          else { delete spans[x.id]; del[x.id] = Math.max(del[x.id] ?? 0, x.u) }
        }
        d = { ...d, spans, del }
      }
    }
    if (k < slimKey && (d.tasks.some(t => t.cp || t.ai || t.tpl) || Object.values(d.spans || {}).some(x => x.end !== null && (x.beat !== undefined || x.dev !== undefined)))) {
      const tasks = d.tasks.map(t => { if (!t.cp && !t.ai && !t.tpl) return t; const o = { ...t }; delete o.cp; delete o.ai; delete o.tpl; return o })
      const spans = Object.fromEntries(Object.entries(d.spans || {}).map(([id, x]) => { if (x.end === null || (x.beat === undefined && x.dev === undefined)) return [id, x]; const o = { ...x }; delete o.beat; delete o.dev; return [id, o] }))
      d = { ...d, tasks, spans }
    }
    if (d !== d0) (days ||= { ...s.days })[k] = d
  }
  return days ? { ...s, days } : s
}

/* ───────────────────────── migration from v1 ───────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrate(o: any): State {
  if (o?.v === 2) { const d = defaults(); return derive({ ...d, ...o, cp: { ...emptyCp(), ...o.cp }, agenda: o.agenda || [], seasons: o.seasons || {}, treats: o.treats || {}, planner: { proposals: {}, notes: { text: '', at: 0 }, ...(o.planner || {}) }, settings: { ...DEFAULT_SETTINGS, ...o.settings }, best: { ...d.best, ...o.best } }) }
  if (o?.v !== 1) return defaults()
  const days: Record<string, Day> = {}
  for (const k in o.days) {
    const d = o.days[k]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tasks: Task[] = d.tasks.map((t: any) => ({ ...t, u: 0, coins: undefined }))
    const legacy = Math.max(0, (d.xp || 0) - sum(tasks.map(t => t.done ? t.xp || 0 : 0)) - (d.focusMin || 0))
    days[k] = {
      date: k, tasks, del: {}, goals: d.goals || {}, goalsU: {}, goalsHit: d.goalsHit || [], locked: !!d.locked, lockedAt: d.lockedAt,
      perfect: d.chest === 'opened', quests: DAILY_QUESTS.map(id => ({ id, claimed: !!d.quests?.find((q: { id: string; claimed: boolean }) => q.id === id)?.claimed })),
      focusBy: { [DEVICE]: d.focusMin || 0 }, bonus: legacy ? { legacy } : {}, combo: d.combo || 0, maxCombo: d.maxCombo || 0, lastDoneAt: d.lastDoneAt, xp: 0, focusMin: 0,
    }
  }
  const earned = Math.max(0, (o.freezes ?? 1) - 1 + (o.frozen?.length || 0))
  return derive({
    cp: emptyCp(), agenda: [], planner: { proposals: {}, notes: { text: '', at: 0 } }, seasons: {}, v: 2, days, del: {}, frozen: o.frozen || [], earnedFreezes: Array.from({ length: earned }, (_, i) => 'legacy' + i),
    achievements: o.achievements || [], settings: { ...DEFAULT_SETTINGS, ...o.settings }, settingsU: 0,
    best: { streak: o.stats?.bestStreak || 0, combo: o.stats?.bestCombo || 0 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    template: (o.template || []).map((b: any) => ({ ...b, u: 0 })), goals: (o.goals || []).map((g: any) => ({ ...g, u: 0 })),
  } as unknown as State)
}

/* ───────────────────────── store core ───────────────────────── */
const KEY = 'momentum.v2'
const subs = new Set<() => void>()
const changeSubs = new Set<() => void>()
/* storage trouble the UI must show until it's fixed (a full quota means edits only live in memory / on the sync server) */
export interface StorageError { kind: 'quota' | 'corrupt'; at: number; msg: string; /** corrupt: where the unreadable copy was kept */ key?: string }
let storageError: StorageError | null = null
const storageSubs = new Set<() => void>()
function setStorageError(e: StorageError | null) {
  if (e?.kind === storageError?.kind && e?.key === storageError?.key) return
  const was = storageError; storageError = e; storageSubs.forEach(f => f())
  if (e && !was) setTimeout(() => emit({ type: 'toast', text: e.kind === 'quota' ? 'Storage full — changes are not saved on this device' : 'Saved data was unreadable — a backup copy was kept', icon: 'warning' }), 0)
}
export const getStorageError = () => storageError
export const onStorageError = (f: () => void) => { storageSubs.add(f); return () => { storageSubs.delete(f) } }
export function useStorageError() { return useSyncExternalStore(onStorageError, getStorageError) }
export const clearStorageError = () => setStorageError(null)
/** per-device caches that are fetched again when missing: what we drop to make room for the state */
export const REFETCHABLE = ['momentum.cf.problems', 'momentum.cf.contests', 'momentum.cf.past', 'momentum.cf.userlist', 'momentum.cf.user', 'momentum.leverage']
function freeSpace() { for (const k of REFETCHABLE) try { localStorage.removeItem(k) } catch { /* ignore */ } }
function load(): State {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) ?? localStorage.getItem('momentum.v1') } catch { /* no storage */ }
  if (!raw) return defaults()
  try { return pruneState(migrate(JSON.parse(raw))) } catch (e) {
    // never lose it: keep the unreadable copy apart (the next save overwrites KEY), making room if it doesn't fit
    const key = 'momentum.state.corrupt.' + Date.now()
    try { localStorage.setItem(key, raw) } catch { freeSpace(); try { localStorage.setItem(key, raw) } catch { /* the sync server may still have it */ } }
    storageError = { kind: 'corrupt', at: Date.now(), msg: e instanceof Error ? e.message : String(e), key }
    return defaults()
  }
}
function save(json: string) {
  const ok = () => { if (storageError?.kind === 'quota') setStorageError(null) }
  try { localStorage.setItem(KEY, json); return ok() } catch { /* full: make room and retry once */ }
  freeSpace()
  try { localStorage.setItem(KEY, json); ok() } catch (e) {
    setStorageError({ kind: 'quota', at: Date.now(), msg: e instanceof Error ? e.message : String(e) })
  }
}
function commit(next: State, local: boolean) {
  state = derive(next)
  save(JSON.stringify(state))
  subs.forEach(f => f())
  if (local) changeSubs.forEach(f => f())
}
// after the storage-error state above exists (load() may report a corrupt copy)
let state: State = load()
const set = (fn: (s: State) => State) => commit(fn(state), true)
export const getState = () => state
/** called by the sync engine with the merged document; never counts as a local edit */
export function replaceFromSync(merged: State) {
  const before = levelInfo(state.xp).lvl
  commit(merged, false)
  const after = levelInfo(state.xp)
  if (after.lvl > before) emit({ type: 'levelup', lvl: after.lvl, title: after.title })
}
export const onAnyChange = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const onLocalChange = (f: () => void) => { changeSubs.add(f); return () => { changeSubs.delete(f) } }
const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb) } }
export function useStore<T>(sel: (s: State) => T): T { return useSyncExternalStore(subscribe, () => sel(state)) }

/* ───────────────────────── fx bus ───────────────────────── */
export type Fx =
  | { type: 'reward'; xp: number; label?: string; combo?: number; ontime?: boolean; work?: number; x?: number; y?: number }
  | { type: 'levelup'; lvl: number; title: string }
  | { type: 'toast'; text: string; icon?: string }
  | { type: 'achievement'; title: string; icon: string }
  | { type: 'confetti'; power?: number }
const fxSubs = new Set<(f: Fx) => void>()
export const onFx = (f: (fx: Fx) => void) => { fxSubs.add(f); return () => { fxSubs.delete(f) } }
const emit = (f: Fx) => fxSubs.forEach(s => s(f))

/* ───────────────────────── derived helpers ───────────────────────── */
export const dayPct = (d?: Day) => !d || !d.tasks.length ? 0 : d.tasks.filter(t => t.done).length / d.tasks.length
export const qualifies = (s: State, k: string) => { const d = s.days[k]; return !!d && d.tasks.length > 0 && dayPct(d) * 100 >= s.settings.threshold - 1e-9 }
export function streakOf(s: State, today = dateKey()) {
  let k = qualifies(s, today) ? today : addDays(today, -1), n = 0
  while (qualifies(s, k) || s.frozen.includes(k)) { if (qualifies(s, k)) n++; k = addDays(k, -1) }
  return n
}
export const streakMult = (streak: number) => 1 + Math.min(streak, 25) * 0.02
export const COMBO_WINDOW = 60 // minutes
export const sortTasks = (ts: Task[]) => [...ts].sort((a, b) => (a.start ? toMin(a.start) : 9999) - (b.start ? toMin(b.start) : 9999))

/* ───────────────────────── actions ───────────────────────── */
// routine tasks get deterministic ids (date:block) so two devices generating the same day merge cleanly
const tplTask = (k: string, b: Block): Task => ({ id: `${k}:${b.id}`, title: b.title, start: b.start, dur: b.dur, cat: b.cat, done: false, tpl: b.id, u: 0, ...(b.k ? { k: b.k } : {}), ...(b.cp && b.k === 'cp_practice' ? { cp: b.cp } : {}) })
/** a routine block applies on day k: right weekday and inside its optional from/until dates */
export const blockActive = (b: Block, k: string) => b.days.includes(keyToDate(k).getDay()) && (!b.from || k >= b.from) && (!b.until || k <= b.until)
const agendaTask = (p: PlannedTask): Task => ({ id: p.id, title: p.title, start: p.start, dur: p.dur, cat: p.cat, done: false, u: p.u, ai: p.plan, pin: p.pin, note: p.note, ...(p.k ? { k: p.k } : {}), ...(p.cp ? { cp: p.cp } : {}) })
/** what day k looks like without creating it: the routine (minus skipped blocks) + planned agenda items */
export function projectDay(s: State, k: string): Task[] {
  const items = (s.agenda || []).filter(p => p.date === k)
  const skipped = new Set(items.filter(p => p.kind === 'skip').map(p => p.skip))
  return [
    ...s.template.filter(b => blockActive(b, k) && !skipped.has(b.id)).map(b => tplTask(k, b)),
    ...items.filter(p => p.kind === 'task').map(agendaTask),
  ]
}
function newDay(s: State, k: string): Day {
  return {
    date: k, del: {}, goals: {}, goalsU: {}, goalsHit: [], locked: false, perfect: false, focusBy: {}, bonus: {}, combo: 0, maxCombo: 0, xp: 0, focusMin: 0,
    tasks: projectDay(s, k),
    quests: DAILY_QUESTS.map(id => ({ id, claimed: false })),
  }
}
/** bring today in line with the agenda after a plan is applied/undone or arrives by sync.
    Only AI tasks that aren't done or pinned move; writes only if something differs. */
export function reconcileToday() {
  const k = dateKey(), d = state.days[k]; if (!d) return
  const items = (state.agenda || []).filter(p => p.date === k), live = new Map(items.filter(p => p.kind === 'task').map(p => [p.id, p]))
  const skips = new Set(items.filter(p => p.kind === 'skip').map(p => `${k}:${p.skip}`))
  let tasks = d.tasks, changed = false
  const del = { ...d.del }
  for (const p of live.values()) {
    if (d.del[p.id] >= p.u || state.del[p.id] >= p.u) continue
    const t = tasks.find(x => x.id === p.id)
    if (!t) { tasks = [...tasks, agendaTask(p)]; changed = true }
    // a newer record wins even over a pinned task (a hand edit made for this date on another device is newer still)
    else if (!t.done && t.u < p.u) { tasks = tasks.map(x => x.id === p.id ? { ...x, title: p.title, start: p.start, dur: p.dur, cat: p.cat, note: p.note, k: p.k, cp: p.cp, ai: p.plan, pin: p.pin || x.pin, u: p.u } : x); changed = true }
  }
  {
    const drop = tasks.filter(t => !t.done && !t.pin && ((t.ai && !live.has(t.id)) || skips.has(t.id)))
    if (drop.length) { tasks = tasks.filter(t => !drop.includes(t)); drop.forEach(t => { del[t.id] = Date.now() }); changed = true }
  }
  if (changed) set(s => ({ ...s, days: { ...s.days, [k]: { ...s.days[k], tasks, del } } }))
  afterReconcile?.()
}
/** set by the trainer: after today is reconciled, make sure every planned practice session has its block */
let afterReconcile: (() => void) | undefined
export const setAfterReconcile = (f: typeof afterReconcile) => { afterReconcile = f }
export function addTaskToday(t: Task) { patchDay(d => d.tasks.some(x => x.id === t.id) || d.del[t.id] ? d : { ...d, tasks: [...d.tasks, t] }) }
export const setPlannerState = (fn: (s: State) => State) => set(fn)
/** add or edit a season (Settings, the planner): stamped now so it wins the merge and the newest overlapping season applies */
export const setSeason = (x: Season) => set(s => ({ ...s, seasons: { ...(s.seasons || {}), [x.id]: { ...x, u: Math.max(Date.now(), (s.seasons?.[x.id]?.u ?? 0) + 1) } } }))
/** delete = a del-flagged copy (merge needs the tombstone; the record keeps its dates for history) */
export const deleteSeason = (id: string) => set(s => { const x = s.seasons?.[id]; return x ? { ...s, seasons: { ...s.seasons, [id]: { ...x, del: true, u: Math.max(Date.now(), x.u + 1) } } } : s })
export function ensureToday() {
  const k = dateKey()
  if (state.days[k]) return
  set(s => {
    const days = { ...s.days, [k]: newDay(s, k) }
    let { frozen } = s
    const y = addDays(k, -1), yy = addDays(k, -2), was = { ...s, days }
    // auto-use a streak freeze if yesterday would break an active streak
    if (!qualifies(was, y) && !frozen.includes(y) && s.freezes > 0 && (qualifies(was, yy) || frozen.includes(yy))) {
      frozen = [...frozen, y]
      setTimeout(() => emit({ type: 'toast', text: 'Streak freeze used — your streak survived yesterday', icon: 'ac_unit' }), 900)
    }
    return { ...s, days, frozen }
  })
}
const today = () => state.days[dateKey()]
/** change today (the trainer's block sync writes through this) */
export const patchToday = (fn: (d: Day) => Day) => patchDay(fn)
function patchDay(fn: (d: Day) => Day) { ensureToday(); const k = dateKey(); set(s => ({ ...s, days: { ...s.days, [k]: stampDone(s.days[k], fn(s.days[k])) } })) }
/** run a mutation and celebrate if it crossed a level */
function leveled(fn: () => void) {
  const before = levelInfo(state.xp).lvl
  fn()
  const after = levelInfo(state.xp)
  if (after.lvl > before) setTimeout(() => { emit({ type: 'levelup', lvl: after.lvl, title: after.title }); emit({ type: 'confetti', power: 2 }) }, 700)
}
const bonus = (id: string, xp: number, k = dateKey()) => patchDayKey(k, d => d.bonus[id] ? d : { ...d, bonus: { ...d.bonus, [id]: xp } })

export function checkAchievements() {
  const st = streakOf(state)
  if (st > state.best.streak) set(s => ({ ...s, best: { ...s.best, streak: st } }))
  // a streak freeze is earned (never rolled) for every 7 straight days kept
  if (st > 0 && st % 7 === 0) {
    const key = 'streak' + (qualifies(state, dateKey()) ? dateKey() : addDays(dateKey(), -1))
    if (!state.earnedFreezes.includes(key)) {
      set(s => ({ ...s, earnedFreezes: [...s.earnedFreezes, key] }))
      emit({ type: 'toast', text: `${st} days straight — streak freeze earned`, icon: 'ac_unit' })
    }
  }
  const fresh = ACHIEVEMENTS.filter(a => !state.achievements.includes(a.id) && a.test(state, st))
  if (!fresh.length) return
  leveled(() => set(s => ({ ...s, achievements: [...s.achievements, ...fresh.map(a => a.id)] })))
  fresh.forEach((a, i) => setTimeout(() => emit({ type: 'achievement', title: a.title, icon: a.icon }), 1200 + i * 1600))
}

/** the day that holds a task: today, else the newest day with it (a block started before midnight, finished after it) */
export const taskDay = (id: string) => { const k = dateKey(); if (state.days[k]?.tasks.some(t => t.id === id)) return k
  return Object.keys(state.days).sort().reverse().find(d => state.days[d].tasks.some(t => t.id === id)) ?? k }
/** date: the day the task is on (default: the day that holds it) — a block from yesterday can still be completed after midnight */
export function completeTask(id: string, pos?: { x: number; y: number }, actual?: { start: number; end: number }, date = taskDay(id)) {
  const dk = date, day = () => state.days[dk], patch = (fn: (d: Day) => Day) => patchDayKey(dk, fn)
  let d = day(); const t0 = d?.tasks.find(t => t.id === id); if (!t0 || t0.done) return
  // "Done" without a timer: record when you really did it
  if (actual && actual.end > actual.start) { addSpan({ taskId: id, title: t0.title, cat: t0.cat, start: actual.start, end: actual.end, src: 'manual', ask: true }); d = day() }
  stopTaskSpans(id)
  d = day(); const t = d.tasks.find(t => t.id === id)!
  const now = Date.now()
  // what it really took (the log), falling back to the planned length only when nothing was logged
  const tracked = taskMinutes(d, id), mins = tracked ?? t.dur
  const ts = taskSpans(d, id), lastEnd = Math.max(0, ...ts.map(s => spanEnd(s, now)))
  // minutes after the task day's midnight (finished after midnight: past 24:00, so a late block isn't "on time")
  const endAt = lastEnd || now, endMin = dateKey(new Date(endAt)) === dk ? nowMin(new Date(endAt)) - new Date(endAt).getSeconds() / 60 : (endAt - dayWindow(dk)[0]) / 60000
  // the automatic breaks taken during the block push its end later by design: they don't make it late
  const first = Math.min(...ts.map(s => s.start)), brkMin = lastEnd ? liveSpans(d).filter(isAutoBreak).reduce((m, s) => m + Math.max(0, Math.min(spanEnd(s, now), lastEnd) - Math.max(s.start, first)), 0) / 60000 : 0
  const ontime = !!t.start && endMin <= toMin(t.start) + t.dur + 10 + brkMin
  const combo = d.lastDoneAt && now - d.lastDoneAt < COMBO_WINDOW * 60000 ? d.combo + 1 : 1
  const streak = streakOf(state)
  // XP = minutes × how much that category counts as work × multipliers you earned. Fully deterministic.
  const xpm = 0.6 * WORK_W[t.cat] * (ontime ? 1.25 : 1) * (1 + Math.min(combo - 1, 6) * 0.15) * streakMult(streak)
  const xp = Math.round(Math.min(mins, t.dur * 2) * xpm)
  const wBefore = workMin(d), best = bestWorkDay(state, d.date), qualBefore = qualifies(state, d.date)
  leveled(() => {
    patch(d => {
      const tasks = d.tasks.map(x => x.id === id ? { ...x, done: true, doneAt: now, xp, xpm, ontime, u: now, doneU: now } : x)
      return { ...d, tasks, combo, maxCombo: Math.max(d.maxCombo, combo), lastDoneAt: now }
    })
    if (combo > state.best.combo) set(s => ({ ...s, best: { ...s.best, combo } }))
  })
  emit({ type: 'reward', xp, combo, ontime, work: isWork(t.cat) ? Math.round(mins) : 0, ...pos })
  const nd = day(), wAfter = workMin(nd), target = state.settings.workTarget * 60
  if (wBefore < target && wAfter >= target) setTimeout(() => { emit({ type: 'toast', text: `Daily work target hit — ${fmtDur(wAfter)}. Now go past it.`, icon: 'work' }); emit({ type: 'confetti', power: 1.5 }) }, 700)
  if (best > 0 && wBefore <= best && wAfter > best) setTimeout(() => { emit({ type: 'toast', text: `NEW RECORD — most work you've ever done in a day (${fmtDur(wAfter)})`, icon: 'emoji_events' }); emit({ type: 'confetti', power: 2.5 }) }, 1400)
  if (!nd.perfect && nd.tasks.length >= 3 && nd.tasks.every(x => x.done)) {
    leveled(() => { patch(d => ({ ...d, perfect: true })); bonus('perfect', 100, dk) })
    setTimeout(() => { emit({ type: 'reward', xp: 100, label: 'Perfect day bonus' }); emit({ type: 'confetti', power: 3 }) }, 900)
  } else if (!qualBefore && qualifies(state, d.date)) {
    setTimeout(() => emit({ type: 'toast', text: `Streak secured for today — ${streakOf(state)} days`, icon: 'local_fire_department' }), 600)
  }
  checkAchievements()
}
export function uncompleteTask(id: string, date = taskDay(id)) {
  const d = state.days[date]; const t = d?.tasks.find(t => t.id === id); if (!t || !t.done) return
  const xp = t.xp || 0, now = Date.now()
  patchDayKey(date, d => ({ ...d, tasks: d.tasks.map(x => x.id === id ? { ...x, done: false, doneAt: undefined, xp: undefined, xpm: undefined, ontime: undefined, u: now, doneU: now } : x) }))
  // the stretch the Done sheet logged goes with it (timer spans stay: that work really happened)
  for (const sp of taskSpans(state.days[date], id)) if (sp.ask) deleteSpan(sp.id, true)
  emit({ type: 'toast', text: `Undone — −${xp} XP`, icon: 'undo' })
}
export function saveTask(t: Omit<Task, 'id' | 'done' | 'u'> & { id?: string }) {
  const u = Date.now()
  // editing an AI-planned task pins it: later planner revisions leave it alone
  if (t.id && (t.id.startsWith('ai:') || t.id.startsWith('you:'))) set(s => ({ ...s, agenda: (s.agenda || []).map(p => p.id === t.id ? { ...p, pin: true, title: t.title, start: t.start, dur: t.dur, cat: t.cat, ...('k' in t ? { k: t.k } : {}), ...('cp' in t ? { cp: t.cp } : {}), u } : p) }))
  // a CP block the student saved is theirs: the trainer's sync never retypes, moves or drops it (an app-assigned session becomes theirs)
  const mine = (x: Task) => { const o: Task = { ...x, ...t, id: x.id, u }; if (o.k === 'cp_practice' && o.cp?.auto) { o.cp = { ...o.cp }; delete o.cp.auto }
    return x.ai || o.k === 'cp_practice' ? { ...o, pin: true } : o }
  patchDay(d => t.id && d.tasks.some(x => x.id === t.id)
    ? { ...d, tasks: d.tasks.map(x => x.id === t.id ? mine(x) : x) }
    : { ...d, tasks: [...d.tasks, { ...t, id: uid(), done: false, u }] })
}
export function deleteTask(id: string) {
  // a typed CP block the student deletes (or merges away): its session is declined for the day — the trainer's sync adds no
  // replacement block for it (a day-level mark that syncs like any tombstone)
  patchDay(d => { const t = d.tasks.find(x => x.id === id), now = Date.now()
    return { ...d, tasks: d.tasks.filter(x => x.id !== id), del: { ...d.del, [id]: now, ...(t && t.k === 'cp_practice' && t.cp && !t.done ? { [`cpx:${t.cp.mode}:${id}`]: now } : {}) } } })
  if (id.startsWith('ai:') || id.startsWith('you:')) set(s => ({ ...s, agenda: (s.agenda || []).filter(p => p.id !== id), del: { ...s.del, [id]: Date.now() } }))
}

/* ───────── hand-editing any of the next 7 days (today = the real list; later days = agenda over the routine) ─────────
   Every edit is a pinned record (the planner and reconcileToday never move or drop pinned items) and merges per record
   (lww + tombstones). A routine block changed on one date: a pinned skip of that block for that date + a pinned copy. */
/** cp: a session (null = make it untyped again) */
export type ItemPatch = Partial<Pick<Task, 'title' | 'start' | 'dur' | 'cat' | 'k'>> & { cp?: BlockSess | null }
export interface NewItem { title: string; start: string | null; dur: number; cat: Cat; k?: Task['k']; cp?: BlockSess }
/** apply a patch to a record: cp null clears the session; a block that isn't CP practice carries none */
function withPatch<T extends { k?: Task['k']; cp?: BlockSess }>(x: T, pt: ItemPatch): T {
  const o = { ...x, ...pt } as T & { cp?: BlockSess | null }
  if (o.cp === null || o.k !== 'cp_practice') delete o.cp
  return o as T
}
const idPart = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'x'
/** the items of a day as the student sees them (today: the real list) */
export const dayItems = (s: State, date: string): Task[] => date === dateKey() && s.days[date] ? s.days[date].tasks : projectDay(s, date)
const isFuture = (date: string) => date > dateKey()
/** write one agenda record (u past any tombstone of that id, so the write survives every merge) */
function putAgenda(p: PlannedTask) { set(s => { const u = Math.max(p.u, (s.del[p.id] ?? -1) + 1); return { ...s, agenda: [...(s.agenda || []).filter(x => x.id !== p.id), { ...p, u }] } }) }
const youTask = (id: string, date: string, it: NewItem, u: number): PlannedTask => ({ id, date, title: it.title, start: it.start, dur: Math.max(5, Math.round(it.dur)), cat: it.cat, kind: 'task', k: it.k, plan: 'you', pin: true, u, ...(it.cp && it.k === 'cp_practice' ? { cp: it.cp } : {}) })
const skipOf = (date: string, blockId: string, u: number): PlannedTask => ({ id: `you:skip-${blockId}:${date}`, date, title: 'skip', start: null, dur: 0, cat: 'break', kind: 'skip', skip: blockId, plan: 'you', pin: true, u })
const normPatch = (p: ItemPatch): ItemPatch => { const o = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as ItemPatch; if (o.dur !== undefined) o.dur = Math.max(5, Math.round(o.dur)); if (o.title !== undefined) o.title = o.title.trim() || 'Untitled'; return o }

/** change one item of a day; returns the id it lives under now (a routine block edited on a later date gets a new id) */
export function editItem(date: string, itemId: string, patch: ItemPatch, idHint?: string): string | null {
  const u = Date.now(), pt = normPatch(patch)
  if (date < dateKey()) return null
  if (!isFuture(date)) {
    ensureToday()
    const t = today().tasks.find(x => x.id === itemId); if (!t || t.done) return null
    patchDay(d => ({ ...d, tasks: d.tasks.map(x => x.id === itemId ? { ...withPatch(x, pt), pin: true, u } : x) }))
    // the agenda record behind it (if any) follows, pinned, so a sync / reconcile can't bring the old version back
    const a = (state.agenda || []).find(p => p.id === itemId && p.date === date)
    if (a) putAgenda({ ...withPatch({ ...a, cp: t.cp }, pt), pin: true, u })
    return itemId
  }
  const t = projectDay(state, date).find(x => x.id === itemId); if (!t) return null
  if (t.tpl) {
    const id = idHint || `you:r-${idPart(t.tpl)}:${date}`
    putAgenda(skipOf(date, t.tpl, u))
    putAgenda(youTask(id, date, withPatch({ title: t.title, start: t.start, dur: t.dur, cat: t.cat, k: t.k, cp: t.cp }, pt), u))
    return id
  }
  const a = (state.agenda || []).find(p => p.id === itemId); if (!a) return null
  putAgenda({ ...withPatch(a, pt), pin: true, u })
  return itemId
}
/** a new item on a day; id: a fixed id (split / merge results, so two devices doing the same thing write one record) */
export function addItem(date: string, it: NewItem, id?: string): string {
  const u = Date.now(); id = id || `you:${uid()}:${date}`
  if (date < dateKey()) return id
  if (!isFuture(date)) {
    ensureToday()
    patchDay(d => ({ ...d, tasks: [...d.tasks.filter(x => x.id !== id), { id: id!, title: it.title.trim() || 'Untitled', start: it.start, dur: Math.max(5, Math.round(it.dur)), cat: it.cat, done: false, u, pin: true, ...(it.k ? { k: it.k } : {}), ...(it.cp && it.k === 'cp_practice' ? { cp: it.cp } : {}) }], del: Object.fromEntries(Object.entries(d.del).filter(([x]) => x !== id)) }))
    return id
  }
  putAgenda(youTask(id, date, { ...it, title: it.title.trim() || 'Untitled' }, u))
  return id
}
export function deleteItem(date: string, itemId: string) {
  if (date < dateKey()) return
  if (!isFuture(date)) { deleteTask(itemId); return }
  const t = projectDay(state, date).find(x => x.id === itemId); if (!t) return
  const u = Date.now()
  if (t.tpl) putAgenda(skipOf(date, t.tpl, u))
  else set(s => ({ ...s, agenda: (s.agenda || []).filter(p => p.id !== itemId), del: { ...s.del, [itemId]: u } }))
}
const byStart = (a: Task, b: Task) => (a.start ? toMin(a.start) : 9999) - (b.start ? toMin(b.start) : 9999)
/** what merging these items gives (null: fewer than 2, or one of them is done) */
export function mergePreview(date: string, ids: string[]) {
  const items = dayItems(state, date).filter(t => ids.includes(t.id)).sort(byStart)
  if (items.length < 2 || items.some(t => t.done)) return null
  const timed = items.filter(t => t.start), loose = items.filter(t => !t.start)
  const start = timed.length ? Math.min(...timed.map(t => toMin(t.start!))) : null
  const end = timed.length ? Math.max(...timed.map(t => toMin(t.start!) + t.dur)) : 0
  const dur = (start === null ? 0 : end - start) + sum(loose.map(t => t.dur))
  // a mock is the once-a-day requirement: merging one in keeps the block a mock (the bar says so)
  const mock = items.find(t => t.k === 'cp_mock'), cp = mock || items.find(t => t.k === 'cp_practice'), first = items[0]
  const mixed = !!mock && items.some(t => t.k === 'cp_practice')
  // a practice block keeps the first block's session (the sessions on offer: every distinct one among the blocks, in time order)
  const sessions = mock ? [] : items.filter(t => t.k === 'cp_practice' && t.cp).map(t => { const x: BlockSess = { ...t.cp! }; delete x.auto; return x }).filter((x, i, a) => a.findIndex(y => sameSess(y, x)) === i)
  return { first, rest: items.slice(1), title: first.title, start: start === null ? null : fmtMin(start), dur, cat: (cp || first).cat, k: cp ? cp.k : first.k, mixed, cp: sessions[0], sessions }
}
/** merge items into one block (earliest start → latest end); returns the merged item's id. cp: the session the student picked
 *  in the preview (default: the first block's) */
export function mergeItems(date: string, ids: string[], cp?: BlockSess): string | null {
  const m = mergePreview(date, ids); if (!m) return null
  const id = editItem(date, m.first.id, { title: m.title, start: m.start, dur: m.dur, cat: m.cat, k: m.k, cp: m.k === 'cp_practice' ? (cp ?? m.cp ?? null) : null })
  if (!id) return null
  for (const t of m.rest) deleteItem(date, t.id)
  return id
}
/** split one item into `parts` consecutive equal blocks */
export function splitItem(date: string, itemId: string, parts: 2 | 3 | 4): string[] {
  const items = dayItems(state, date), t = items.find(x => x.id === itemId); if (!t || t.done || t.dur < parts * 5) return []
  const base = t.title.replace(/\s*\(\d\/\d\)$/, ''), each = Math.floor(t.dur / parts), s0 = t.start ? toMin(t.start) : null
  // later parts would wrap to the start of this same day
  if (s0 !== null && s0 + t.dur > 24 * 60) { toast('This block runs past midnight — shorten it or move it earlier before splitting', 'schedule'); return [] }
  const at = (i: number) => s0 === null ? null : fmtMin(s0 + i * each)
  const len = (i: number) => i === parts - 1 ? t.dur - each * (parts - 1) : each
  // every part runs the same session (the student split it: it's theirs now, never retyped by the app)
  const cp = t.cp ? (() => { const x: BlockSess = { ...t.cp! }; delete x.auto; return x })() : undefined
  const first = editItem(date, itemId, { title: `${base} (1/${parts})`, dur: len(0), ...(cp ? { cp } : {}) }); if (!first) return []
  const out = [first], key = idPart(itemId.replace(/:\d{4}-\d{2}-\d{2}$/, '').replace(/^(you|ai):/, ''))
  // a second split of an already-split block must not reuse a live sibling's id (it would overwrite that part)
  const taken = new Set([...items.map(x => x.id), ...(state.agenda || []).filter(p => p.date === date && !(state.del[p.id] >= p.u)).map(p => p.id)])
  const freeId = (i: number) => { const b = `you:${key}-${i + 1}of${parts}`, m = at(i) === null ? 'x' : String(s0! + i * each); let id = `${b}:${date}`; for (let n = 0; taken.has(id); n++) id = `${b}-${m}${n ? '-' + n : ''}:${date}`; taken.add(id); return id }
  for (let i = 1; i < parts; i++) out.push(addItem(date, { title: `${base} (${i + 1}/${parts})`, start: at(i), dur: len(i), cat: t.cat, k: t.k, cp }, freeId(i)))
  return out
}
/** hand-edited by the student (vs planned by Claude / the plain routine) */
export const isMine = (t: Task) => !!t.pin || t.id.startsWith('you:')
export function bumpGoal(id: string, dir: 1 | -1) {
  const g = state.goals.find(g => g.id === id); if (!g) return
  ensureToday()
  const d = today(); const cur = d.goals[id] || 0
  const next = Math.max(0, Math.round((cur + dir * g.step) * 100) / 100)
  // this device's own counter takes the change (another device's glasses add to it on merge, never overwrite it)
  patchDay(d => {
    const gc = goalCounts(d), mine = { ...(gc[id] || {}) }, [p, n] = mine[DEVICE] || [0, 0], diff = r2(next - goalTotal(mine))
    mine[DEVICE] = diff >= 0 ? [r2(p + diff), n] : [p, r2(n - diff)]
    return { ...d, gc: { ...gc, [id]: mine }, goals: { ...d.goals, [id]: next }, goalsU: { ...d.goalsU, [id]: Date.now() } }
  })
  if (next >= g.target && !d.goalsHit.includes(id)) {
    leveled(() => { patchDay(d => ({ ...d, goalsHit: [...d.goalsHit, id] })); bonus('goal:' + id, 25) })
    emit({ type: 'reward', xp: 25, label: `${g.title} goal hit!` }); emit({ type: 'confetti', power: 0.8 })
  }
}
export function claimQuest(id: QuestId) {
  const q = QUESTS[id], d = today(); const [p, n] = q.eval(d, state)
  if (p < n || d.quests.find(x => x.id === id)?.claimed) return
  leveled(() => { patchDay(d => ({ ...d, quests: d.quests.map(x => x.id === id ? { ...x, claimed: true } : x) })); bonus('quest:' + id, q.xp) })
  emit({ type: 'reward', xp: q.xp, label: 'Quest complete' }); emit({ type: 'confetti', power: 1 })
}
/** a day other than today (spans that started yesterday close there) */
function patchDayKey(k: string, fn: (d: Day) => Day) { if (k === dateKey()) return patchDay(fn); set(s => s.days[k] ? { ...s, days: { ...s.days, [k]: stampDone(s.days[k], fn(s.days[k])) } } : s) }
const findSpan = (id: string): [string, Span] | undefined => { for (const [k, d] of Object.entries(state.days)) { const sp = d.spans?.[id]; if (sp) return [k, sp] } return undefined }
/** start logging real work now (closes anything else this device was logging); returns the span id.
 *  id: a fixed id (a CP session's, so two devices finishing it write the same record) */
export function startSpan(o: { taskId?: string; title: string; cat: Cat; src: Span['src'] }, id?: string) {
  stopSpan()
  const now = Date.now(); id = id || 'sp:' + DEVICE + ':' + now.toString(36)
  patchDay(d => ({ ...d, spans: { ...(d.spans || {}), [id]: { id, ...o, start: now, end: null, beat: now, dev: DEVICE, u: now } } }))
  return id
}
/** stop logging (a given span, or whatever this device is logging) */
export function stopSpan(id?: string, at = Date.now()) {
  const open = id ? [findSpan(id)].filter(Boolean) as [string, Span][] : Object.entries(state.days).flatMap(([k, d]) => liveSpans(d).filter(s => s.end === null && s.dev === DEVICE).map(s => [k, s] as [string, Span]))
  for (const [k, sp] of open) if (sp.end === null) patchDayKey(k, d => ({ ...d, spans: { ...d.spans, [sp.id]: { ...sp, end: Math.max(sp.start, Math.min(at, spanEnd(sp, at))), u: Date.now() } } }))
}
function stopTaskSpans(taskId: string) { for (const d of Object.values(state.days)) for (const s of liveSpans(d)) if (s.taskId === taskId && s.end === null) stopSpan(s.id) }
export const runningSpan = () => liveSpans(state.days[dateKey()]).find(s => s.end === null && s.dev === DEVICE) || Object.values(state.days).flatMap(liveSpans).find(s => s.end === null && s.dev === DEVICE)
/** keep this device's running span alive; close spans whose device stopped beating long ago.
 *  Beats don't bump u (a stale copy must never beat a stop / edit made elsewhere; mergeSpan keeps the max beat). */
export function heartbeat() {
  const now = Date.now()
  for (const [k, d] of Object.entries(state.days)) for (const s of liveSpans(d)) if (s.end === null) {
    if (s.dev !== DEVICE) { if (s.beat && now - s.beat > 12 * 3600e3) patchDayKey(k, d => ({ ...d, spans: { ...d.spans, [s.id]: { ...s, end: s.beat!, u: now } } })); continue }
    // woke up after a long sleep (lid shut overnight) with a Focus / Pomodoro span open: that gap wasn't work. Bank what came
    // before it and carry on from now (same id, so the timer still owns it); across midnight just close it. A shorter gap
    // (device locked while you read) still counts. CP / mock sessions keep their own clock.
    if (s.src !== 'cp' && s.src !== 'mock' && s.beat && now - s.beat > SLEEP) {
      if (k === dateKey()) { if (s.beat - s.start >= 60000) addSpan({ taskId: s.taskId, title: s.title, cat: s.cat, start: s.start, end: s.beat, src: s.src }); patchDayKey(k, d => ({ ...d, spans: { ...d.spans, [s.id]: { ...s, start: now, beat: now, u: now } } })) }
      else patchDayKey(k, d => ({ ...d, spans: { ...d.spans, [s.id]: { ...s, end: s.beat!, u: now } } }))
      continue
    }
    patchDayKey(k, d => ({ ...d, spans: { ...d.spans, [s.id]: { ...s, beat: now } } }))
  }
}
/** a done task's XP follows its log: changing its stretches afterwards re-prices it at the rate it was paid */
function retally(...ids: (string | undefined)[]) {
  for (const id of new Set(ids)) if (id) for (const [k, d] of Object.entries(state.days)) {
    const t = d.tasks.find(x => x.id === id); if (!t?.done || t.xpm === undefined) continue
    const xp = Math.round(Math.min(taskMinutes(d, id) ?? t.dur, t.dur * 2) * t.xpm), was = t.xp || 0
    if (xp === was) continue
    leveled(() => patchDayKey(k, d => ({ ...d, tasks: d.tasks.map(x => x.id === id ? { ...x, xp, u: Date.now(), doneU: Date.now() } : x) })))
    emit({ type: 'toast', text: `${t.title}: ${xp > was ? '+' : '−'}${Math.abs(xp - was)} XP (log changed)`, icon: 'history' })
  }
}
/** log work after the fact (manual entry); it lands on the day it started */
export function addSpan(o: { taskId?: string; title: string; cat: Cat; start: number; end: number; src?: Span['src']; ask?: boolean }, id?: string) {
  const now = Date.now(), k = dateKey(new Date(o.start))
  id = id || 'sp:' + DEVICE + ':' + now.toString(36) + Math.random().toString(36).slice(2, 5)
  const sp: Span = { id, taskId: o.taskId, title: o.title, cat: o.cat, src: o.src || 'manual', start: o.start, end: Math.max(o.start, o.end), dev: DEVICE, u: now, ...(o.ask ? { ask: true } : {}) }
  if (!state.days[k]) { if (k === dateKey()) ensureToday(); else set(s => ({ ...s, days: { ...s.days, [k]: { ...newDay(s, k), tasks: [] } } })) }
  patchDayKey(k, d => ({ ...d, spans: { ...(d.spans || {}), [id]: sp } }))
  retally(o.taskId)
  return id
}
export function editSpan(id: string, p: Partial<Pick<Span, 'start' | 'end' | 'title' | 'cat'>>) {
  const f = findSpan(id); if (!f) return
  const [k, sp] = f, nx = { ...sp, ...p, u: Date.now() }
  if (nx.end !== null && nx.end < nx.start) nx.end = nx.start
  // its start moved to another day: it lives there now (a tombstone here, a fresh record there, so a sync can't bring it back)
  if (nx.end !== null && dateKey(new Date(nx.start)) !== k) {
    patchDayKey(k, d => ({ ...d, spans: { ...d.spans, [id]: { ...sp, del: true, u: nx.u } } }))
    addSpan({ taskId: nx.taskId, title: nx.title, cat: nx.cat, start: nx.start, end: nx.end, src: nx.src, ask: nx.ask })
    return retally(sp.taskId)
  }
  patchDayKey(k, d => ({ ...d, spans: { ...d.spans, [id]: nx } }))
  retally(sp.taskId, nx.taskId)
}
/** delete a stretch (a tombstone, so it syncs). noise: a mis-tap or a dropped fragment, which also unties it from its task
 *  (the task then counts as never timed, not as timed at 0) */
export function deleteSpan(id: string, noise = false) {
  const f = findSpan(id); if (!f) return
  patchDayKey(f[0], d => ({ ...d, spans: { ...d.spans, [id]: { ...f[1], del: true, end: f[1].end ?? Date.now(), u: Date.now(), ...(noise ? { taskId: undefined } : {}) } } }))
  retally(f[1].taskId)
}
/** every logged span of a day, oldest first */
export const spansOf = (d?: Day) => liveSpans(d).sort((a, b) => a.start - b.start)

export function focusMinute() {
  leveled(() => patchDay(d => ({ ...d, focusBy: { ...d.focusBy, [DEVICE]: (d.focusBy[DEVICE] || 0) + 1 } })))
}
export function applyTemplateToToday() {
  patchDay(d => {
    const have = new Set(d.tasks.map(t => t.tpl).filter(Boolean))
    const add = state.template.filter(b => blockActive(b, d.date) && !have.has(b.id) && !d.del[`${d.date}:${b.id}`]).map(b => ({ ...tplTask(d.date, b), u: Date.now() }))
    emit({ type: 'toast', text: add.length ? `Added ${add.length} routine block${add.length > 1 ? 's' : ''} to today` : 'Today already has your routine', icon: 'playlist_add' })
    return { ...d, tasks: [...d.tasks, ...add] }
  })
}
export function pullLeftovers() {
  const y = state.days[addDays(dateKey(), -1)]; if (!y) return
  const left = y.tasks.filter(t => !t.done && !t.tpl), u = Date.now()
  patchDay(d => ({ ...d, tasks: [...d.tasks, ...left.filter(t => !d.tasks.some(x => x.id === 'c:' + t.id)).map(t => ({ ...t, id: 'c:' + t.id, start: null, u }))] }))
  emit({ type: 'toast', text: left.length ? `Carried over ${left.length} task${left.length > 1 ? 's' : ''}` : 'Nothing left over from yesterday', icon: 'move_down' })
}

/** log finished work that wasn't a scheduled block (a CP test, a solved problem) through the normal reward pipeline */
export function logWork(title: string, dur: number, cat: Cat, pos?: { x: number; y: number }, key?: string) {
  // a session finished on two devices produces the same id, so the merge collapses it to one entry
  const id = 'w:' + (key || uid())
  if (key && Object.values(state.days).some(d => d.tasks.some(t => t.id === id) || d.del[id])) return
  patchDay(d => ({ ...d, tasks: [...d.tasks, { id, title, start: null, dur: Math.max(1, Math.round(dur)), cat, done: false, u: Date.now() }] }))
  completeTask(id, pos)
}
export const bonusPaid = (id: string) => Object.values(state.days).some(d => d.bonus[id] !== undefined)
export function cpBonus(id: string, xp: number, label: string) {
  if (bonusPaid(id)) return
  leveled(() => bonus(id, xp))
  emit({ type: 'reward', xp, label })
}
export const setCp = (fn: (c: CpState) => CpState) => set(s => ({ ...s, cp: fn(s.cp) }))

export function saveBlock(b: Block) {
  set(s => ({ ...s, template: [...s.template.filter(x => x.id !== b.id), { ...b, u: Date.now() }] }))
  // its type (CP practice / mock / …) also applies to today's copy if it isn't done or hand-edited yet
  const t = today()?.tasks.find(x => x.tpl === b.id && !x.done && !x.pin)
  const cp = b.k === 'cp_practice' ? b.cp : undefined
  if (t && (t.k !== b.k || !sameSess(t.cp, cp))) patchDay(d => ({ ...d, tasks: d.tasks.map(x => { if (x.id !== t.id) return x; const o: Task = { ...x, k: b.k, u: Date.now() }; if (cp) o.cp = cp; else delete o.cp; return o }) }))
}
export const deleteBlock = (id: string) => set(s => ({ ...s, template: s.template.filter(x => x.id !== id), del: { ...s.del, [id]: Date.now() } }))
export const saveGoal = (g: Goal) => set(s => ({ ...s, goals: s.goals.some(x => x.id === g.id) ? s.goals.map(x => x.id === g.id ? { ...g, u: Date.now() } : x) : [...s.goals, { ...g, u: Date.now() }] }))
/** the old default goals (deep work / problems / reading) were retired — tombstoned once so every synced device drops them */
export function retireOldGoals() {
  const old = ['g-deep', 'g-cp', 'g-read'].filter(id => state.goals.some(g => g.id === id) && !state.del[id])
  if (old.length) set(s => ({ ...s, goals: s.goals.filter(g => !old.includes(g.id)), del: { ...s.del, ...Object.fromEntries(old.map(id => [id, Date.now()])) } }))
}
export const deleteGoal = (id: string) => set(s => ({ ...s, goals: s.goals.filter(x => x.id !== id), del: { ...s.del, [id]: Date.now() } }))
export const setSettings = (p: Partial<Settings>) => set(s => ({ ...s, settings: { ...s.settings, ...p }, settingsU: Date.now() }))
export const exportData = () => JSON.stringify(state, null, 1)
export function importData(json: string) { const o = JSON.parse(json); if (o?.v !== 1 && o?.v !== 2) throw new Error('bad file'); set(s => mergeStates(s, { ...migrate(o), epoch: s.epoch })) }
/** start over: everything goes, on every synced device (the reset epoch beats all older data in merges) */
export function resetAll(keepSettings = true) {
  const d = defaults(), now = Math.max(Date.now(), (state.epoch || 0) + 1) // always moves forward, even twice in one ms
  commit({ ...d, epoch: now, ...(keepSettings ? { settings: state.settings, settingsU: state.settingsU } : { settingsU: now }) }, true)
  ensureToday(); ensureTreatJar()
}
export const toast = (text: string, icon?: string) => emit({ type: 'toast', text, icon })

/* ───────────────────────── the treat jar ─────────────────────────
   XP buys one real-world treat (a drink, a snack) — but only after TREAT_XP XP AND TREAT_MIN minutes of real logged work
   since the last one. Both gates: XP rates swing with solve bonuses and combos, so XP alone could be hit in ~6 h; the work
   minutes come from the timers (spans), so the 12 h is real. One at a time: anything past full doesn't carry over. */
export const TREAT_XP = 1500, TREAT_MIN = 12 * 60
const liveTreats = (s: State) => Object.values(s.treats || {})
/** the mark the jar counts from: the newest treat, else the oldest start (a second device's later start can't reset it) */
export function treatAnchor(s: State = state): Treat | undefined {
  const ts = liveTreats(s), got = ts.filter(t => t.kind === 'treat').sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1))
  return got[0] ?? ts.filter(t => t.kind === 'start').sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))[0]
}
/** real work minutes since a moment: logged deep/study/admin spans after it (overlaps once), plus timer-less done tasks after it */
export function workSince(s: State, since: number, now = Date.now()) {
  const ds = Object.values(s.days), spans = ds.flatMap(d => liveSpans(d)).filter(x => isWork(x.cat) && spanEnd(x, now) > since)
  const untimed = ds.reduce((a, d) => a + d.tasks.reduce((b, t) => b + (t.done && isWork(t.cat) && (t.doneAt || 0) > since && !taskSpans(d, t.id, true).length ? t.dur : 0), 0), 0)
  return Math.round(unionMin(spans, now, since) + untimed)
}
export function treatJar(s: State = state, now = Date.now()) {
  const a = treatAnchor(s)
  const xp = a ? Math.max(0, s.xp - a.xp0) : 0, work = a ? workSince(s, a.at, now) : 0
  const history = liveTreats(s).filter(t => t.kind === 'treat').sort((x, y) => y.at - x.at)
  return { since: a?.at ?? now, xp: Math.min(xp, TREAT_XP), work: Math.min(work, TREAT_MIN), ready: !!a && xp >= TREAT_XP && work >= TREAT_MIN, history }
}
/** open the jar the first time (counting from now) — never on a state that already has one */
export function ensureTreatJar() {
  if (liveTreats(state).length) return
  const now = Date.now(), id = 'start-' + uid()
  set(s => liveTreats(s).length ? s : { ...s, treats: { [id]: { id, kind: 'start', at: now, xp0: s.xp, what: '', u: now } } })
}
/** spend the jar on one treat; false when it isn't full yet */
export function redeemTreat(what: string) {
  if (!treatJar().ready) return false
  const now = Date.now(), id = 'treat-' + uid()
  set(s => ({ ...s, treats: { ...(s.treats || {}), [id]: { id, kind: 'treat', at: now, xp0: s.xp, what: what.trim().slice(0, 80), u: now } } }))
  return true
}

/* ───────────────────────── calorie tracker ───────────────────────── */
export const liveMeals = (d?: Day) => Object.values(d?.calories || {}).filter(m => !m.del).sort((a, b) => b.at - a.at)
export const dayCalories = (d?: Day) => liveMeals(d).reduce((t, m) => t + m.kcal, 0)

export function addMeal(name: string, kcal: number, macros?: { protein?: number; carbs?: number; fat?: number }) {
  ensureToday()
  const id = 'm-' + uid(), now = Date.now()
  const entry: MealEntry = {
    id,
    name: name.trim() || 'Meal / Snack',
    kcal: Math.max(0, Math.round(kcal)),
    ...(macros?.protein ? { protein: Math.max(0, Math.round(macros.protein)) } : {}),
    ...(macros?.carbs ? { carbs: Math.max(0, Math.round(macros.carbs)) } : {}),
    ...(macros?.fat ? { fat: Math.max(0, Math.round(macros.fat)) } : {}),
    at: now,
    u: now,
  }
  patchDay(d => ({ ...d, calories: { ...(d.calories || {}), [id]: entry } }))
  emit({ type: 'toast', text: `+${entry.kcal} kcal (${entry.name})`, icon: 'restaurant' })
}

export function removeMeal(id: string) {
  ensureToday()
  const now = Date.now()
  patchDay(d => {
    if (!d.calories?.[id]) return d
    return { ...d, calories: { ...d.calories, [id]: { ...d.calories[id], del: true, u: now } } }
  })
}
