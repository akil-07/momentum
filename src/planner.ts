import { optedOut, provisional, radar } from './contests'
import {
  addDays, blockActive, CATS, dateKey, getState, projectDay, reconcileToday, setPlannerState, toast, toMin,
  isMine, isCpMode, type Block, type BlockSess, type Cat, type PlannedTask, type PlanDay, type Proposal, type RoutineChange, type State, isWork, fmtMin, keyToDate, capState } from './store'
import { SUB_BY_ID } from './curriculum'
import { cpDetail, inferCpMode } from './cpblocks'
import { getContests } from './cf'
import { catchUp, onResult, submit, type TurnResult } from './claude'
import { discipline, peakSummary } from './discipline'
import { firstSync, getSyncCfg } from './sync'
import { makeSeason, seasonOut, targetFor, targetsAhead, upcomingSeasons, type Season } from './season'

/* ═════════ the day-planner session: prompt → proposal → preview → apply / undo ═════════ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item'
const KIND_K: Record<string, PlannedTask['k']> = { cp_practice: 'cp_practice', cp_mock: 'cp_mock', study: 'study', other: 'other' }
/** the key the planner sees for an agenda record (the student's own hand-made items keep their "you:" prefix) */
const agendaKey = (id: string) => id.startsWith('you:') ? id.replace(/:\d{4}-\d{2}-\d{2}$/, '') : id.split(':')[1]
/** the planner re-listed one of the student's pinned items as its own: the pinned one already covers it */
/** a planned CP practice block's session: the planner's `session` (+ `sub` for learn), else what the title says ("Warm-up for…",
 *  "Upsolve…", "Free solve:…"); '' / unknown = untyped (the app's sync assigns one of today's sessions) */
export function plannedSess(kind: string, session: unknown, sub: unknown, title: string): BlockSess | undefined {
  if (kind !== 'cp_practice') return undefined
  const t = inferCpMode(title), m = isCpMode(session) ? session : t
  if (!m) return undefined
  // the planner's own pick (its title doesn't say it) is a guess before the day's trainer plan exists: the app's sync may retype
  // it to a session the day's plan needs (auto, like an app-assigned one). The student's / a routine block's choice never is.
  const o: BlockSess = { mode: m, ...(m !== t ? { auto: true } : {}) }
  if (m === 'learn' && typeof sub === 'string' && SUB_BY_ID.has(sub)) o.sub = sub
  return o
}
const sessOut = (cp?: BlockSess) => cp ? { session: cp.mode, ...(cpDetail(cp) ? { session_detail: cpDetail(cp) } : {}), ...(cp.sub ? { sub: cp.sub } : {}) } : {}
const dupOfPinned = (agenda: PlannedTask[], n: PlannedTask) => n.kind === 'task' && agenda.some(a => a.pin && a.kind === 'task' && a.id !== n.id && a.date === n.date && a.start === n.start && a.dur === n.dur && a.title.trim().toLowerCase() === n.title.trim().toLowerCase())

export function buildPlannerContext() {
  const s = getState(), k = dateKey(), now = new Date()
  const horizon = addDays(k, 60)
  return {
    today: k, weekday: now.toLocaleDateString('en', { weekday: 'long' }), now: now.toTimeString().slice(0, 5),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    // the per-day commitment (exam weeks are lighter): follow it day by day; seasons say how it goes on past these 7 days
    commitment: targetsAhead(7, k, s).map(t => ({ date: t.date, cp_practice_min: t.cpMin, cp_mock_min: t.mockMin, rated_rounds: t.contests, season: t.season ? t.kind : 'normal' })),
    commitment_note: 'per date, times flexible; dates past this list follow `seasons` (inside one: its cp_min / mock / contests), else the normal 270 min practice + 120 min mock',
    seasons: upcomingSeasons(s, k).map(seasonOut),
    work_target_hours: s.settings.workTarget,
    routine: s.template.map(b => ({ id: b.id, title: b.title, start: b.start, dur: b.dur, cat: b.cat, kind: b.k || 'other', days: b.days, from: b.from || '', until: b.until || '' })),
    goals: s.goals.map(g => `${g.title}: ${g.target}${g.unit ? ' ' + g.unit : ''}/day`),
    agenda: (s.agenda || []).filter(p => p.date >= k && p.date <= horizon).map(p => ({ key: agendaKey(p.id), date: p.date, title: p.title, start: p.start || '', dur: p.dur, cat: p.cat, kind: p.kind === 'skip' ? 'skip:' + p.skip : p.k || 'other', ...sessOut(p.cp), pinned: !!p.pin })),
    // today's practice sessions from the trainer (coach-designed or default): today's schedule must hold a cp_practice block for each
    practice_sessions: (s.cp.plans[k]?.specs || []).map(x => ({ mode: x.mode, minutes: x.minutes, why: x.why || '', ...(x.sub ? { sub: x.sub, sub_name: SUB_BY_ID.get(x.sub)?.name || x.sub } : {}), ...(x.pos ? { pos: x.pos } : {}), ...(x.tags.length ? { tags: x.tags } : {}) })),
    today_tasks: (s.days[k]?.tasks || []).map(t => ({ title: t.title, start: t.start || '', dur: t.dur, done: t.done })),
    cf_contests: getContests().slice(0, 12).map(c => ({ name: c.name, start_local: new Date(c.start).toLocaleString('sv').slice(0, 16), dur_min: Math.round(c.dur / 60) })),
    rated_rounds: radar(21).map(r => ({ name: r.name, div: r.div, start_local: new Date(r.start).toLocaleString('sv').slice(0, 16), dur_min: Math.round(r.dur / 60), mandatory: r.mandatory && !optedOut(r.id) && targetFor(dateKey(new Date(r.start)), s).contests === 'all', season_rounds: targetFor(dateKey(new Date(r.start)), s).contests, ...(optedOut(r.id) ? { opted_out: true } : {}) })),
    provisional: provisional(),
    peak: peakSummary(s),
    discipline: discipline(s).score,
    // THE TRUTH: what the student's planner shows right now for the next 7 days (today = real list incl. done/edited items)
    current_schedule: upcoming(s, 7).map(d => ({ date: d.date, items: d.tasks.slice().sort((a, b) => (a.start ? toMin(a.start) : 9999) - (b.start ? toMin(b.start) : 9999)).map(t => ({ key: t.id.startsWith('you:') ? agendaKey(t.id) : t.ai ? t.id.split(':')[1] : t.tpl ? 'routine:' + t.tpl : 'own:' + t.id, start: t.start || '', end: t.start ? fmtMin(toMin(t.start) + t.dur) : '', dur: t.dur, title: t.title, kind: t.k || 'other', ...sessOut(t.cp), ...(t.cp && !t.cp.auto ? { session_set: true } : {}), cat: t.cat, ...(t.done ? { done: true } : {}), ...(isMine(t) ? { pinned_by_student: true } : {}) })) })),
    // your earlier proposals and what the student did with them — "pending" means NOT applied (the app does not show it)
    proposal_history: Object.values(s.planner.proposals).sort((a, b) => a.at - b.at).slice(-6).map(p => ({ at: new Date(p.at).toLocaleString('sv').slice(0, 16), request: p.prompt.slice(0, 160), status: p.status, range: p.range,
      // a season in a proposal that was not applied is NOT in `seasons`: send it again if it still holds
      ...(p.season ? { season: seasonOut(p.season), season_applied: p.status === 'applied' } : {}) })),
    planner_notes: s.planner?.notes?.text || '',
  }
}

export function askPlanner(prompt: string) {
  if (!getSyncCfg()) { toast('Connect sync first (Settings → Sync) — the planner runs on your laptop', 'cloud_off'); return null }
  // a pending (unapplied) proposal that carried a season: the follow-up's answer may leave the season out (the model thinks it
  // already sent it) — carryOf lets onPlannerResult keep it
  const carry = Object.values(getState().planner.proposals).filter(p => p.status === 'pending' && p.season).sort((a, b) => b.at - a.at)[0]
  const id = submit('planner', '/api/planner/turn', { prompt, context: buildPlannerContext() }, { message: prompt, ...(carry ? { carryOf: carry.id } : {}) })
  const now = Date.now()
  setPlannerState(s => ({ ...s, planner: { ...s.planner, proposals: { ...Object.fromEntries(Object.entries(s.planner.proposals).map(([k, p]) => [k, p.status === 'pending' && hasChanges(p) ? { ...p, status: 'superseded' as const, repairing: false, u: now } : p])), [id]: { id, at: Date.now(), prompt, summary: '', questions: [], range: { from: '', to: '' }, days: [], routine: [], status: 'pending', u: Date.now() } } } }))
  return id
}

/** a proposal that would change something (days, routine or a season) */
export const hasChanges = (p: Pick<Proposal, 'days' | 'routine' | 'season'>) => p.days.length > 0 || p.routine.length > 0 || !!p.season

/* ───────── validate the model's answer ───────── */
/** the planner's `season` ({kind:""} = no change): dates checked (an exam season may have started already), numbers clamped */
function sanitizeSeason(v: unknown, today: string): Season | undefined {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  if (!['exam', 'break', 'normal'].includes(String(o.kind))) return undefined
  const ok = (d: unknown): d is string => typeof d === 'string' && DATE_RE.test(d) && d >= addDays(today, -60) && d <= addDays(today, 365)
  if (!ok(o.from) || !ok(o.until) || o.until < today) return undefined
  const contests = ['all', 'optional', 'none'].includes(String(o.contests)) ? o.contests as Season['contests'] : undefined
  const cp = Number(o.cp_min)
  return makeSeason({ id: 'plan', kind: o.kind as Season['kind'], from: o.from, until: o.until, cpMin: Number.isFinite(cp) && cp >= 0 ? Math.min(600, Math.round(cp)) : undefined,
    mock: typeof o.mock === 'boolean' ? o.mock : undefined, contests, note: String(o.note || '').slice(0, 200), u: 0 })
}
function sanitize(o: Record<string, unknown>): Pick<Proposal, 'summary' | 'questions' | 'range' | 'days' | 'routine' | 'season'> {
  const today = dateKey(), max = addDays(today, 180)
  const okDate = (d: unknown): d is string => typeof d === 'string' && DATE_RE.test(d) && d >= addDays(today, -1) && d <= max
  const cat = (c: unknown): Cat => (typeof c === 'string' && c in CATS ? c : 'study') as Cat
  const rawDays: PlanDay[] = (Array.isArray(o.days) ? o.days : []).filter((d: Record<string, unknown>) => okDate(d?.date)).slice(0, 120).map((d: Record<string, unknown>) => ({
    date: d.date as string,
    skip_blocks: (Array.isArray(d.skip_blocks) ? d.skip_blocks : []).filter((x: unknown) => typeof x === 'string').slice(0, 20),
    tasks: (Array.isArray(d.tasks) ? d.tasks : []).slice(0, 30).map((t: Record<string, unknown>) => {
      const title = String(t.title || '').slice(0, 120) || 'Untitled', kind = typeof t.kind === 'string' && t.kind in KIND_K ? t.kind : 'other'
      const cp = plannedSess(kind, t.session, t.sub, title)
      return {
        key: slug(String(t.key || t.title || 'item')), title,
        start: typeof t.start === 'string' && TIME_RE.test(t.start) ? t.start : '', dur: Math.max(5, Math.min(720, Math.round(Number(t.dur) || 30))),
        cat: cat(t.cat), kind, note: String(t.note || '').slice(0, 300), ...(cp ? { cp } : {}),
      }
    }),
  }))
  // the same date twice → one day (tasks concatenated, skips unioned)
  const byDate = new Map<string, PlanDay>()
  for (const d of rawDays) { const x = byDate.get(d.date); if (!x) byDate.set(d.date, d); else byDate.set(d.date, { date: d.date, skip_blocks: [...new Set([...x.skip_blocks, ...d.skip_blocks])], tasks: [...x.tasks, ...d.tasks] }) }
  const days = [...byDate.values()]
  const seenR = new Set<string>()
  const routine: RoutineChange[] = (Array.isArray(o.routine_changes) ? o.routine_changes : []).slice(0, 20).filter((r: Record<string, unknown>) => ['add', 'update', 'remove'].includes(String(r.op))).filter((r: Record<string, unknown>) => { const id = String(r.op) === 'add' ? 'k:' + slug(String(r.key || r.title || 'block')) : 'b:' + String(r.block_id || ''); if (seenR.has(id)) return false; seenR.add(id); return true }).map((r: Record<string, unknown>) => ({
    op: r.op as RoutineChange['op'], key: slug(String(r.key || r.title || 'block')), block_id: String(r.block_id || ''), title: String(r.title || '').slice(0, 120),
    // for updates, a missing/invalid field means "keep what the block has" — never silently reset it to a default
    start: typeof r.start === 'string' && TIME_RE.test(r.start) ? r.start : r.op === 'add' ? '09:00' : undefined,
    dur: Number(r.dur) > 0 ? Math.max(5, Math.min(720, Math.round(Number(r.dur)))) : r.op === 'add' ? 60 : undefined,
    cat: typeof r.cat === 'string' && r.cat in CATS ? r.cat as Cat : r.op === 'add' ? 'study' : undefined,
    days: (Array.isArray(r.days) ? r.days : []).map(Number).filter((n: number) => n >= 0 && n <= 6), from: okDate(r.from) ? r.from as string : '', until: okDate(r.until) ? r.until as string : '',
    ...(typeof r.kind === 'string' && KIND_K[r.kind] ? { k: KIND_K[r.kind] } : {}),
  }))
  const r = (o.range || {}) as Record<string, unknown>
  const dates = days.map(d => d.date).sort()
  const range = { from: okDate(r.from) ? r.from as string : dates[0] || today, to: okDate(r.to) ? r.to as string : dates[dates.length - 1] || today }
  if (dates.length) { if (dates[0] < range.from) range.from = dates[0]; if (dates[dates.length - 1] > range.to) range.to = dates[dates.length - 1] }
  const season = sanitizeSeason(o.season, today)
  return { summary: String(o.summary || '').slice(0, 1200), questions: (Array.isArray(o.questions) ? o.questions : []).map(String).slice(0, 5), range, days, routine, ...(season ? { season } : {}) }
}
/** (tests) the validation the planner's answers go through */
export const sanitizeProposal = sanitize
/** (exported for tests) */
export function onPlannerResult(turn: { id: string; meta: Record<string, unknown> }, res: TurnResult) {
  const o = res.structured || {}, clean = sanitize(o)
  const existing = getState().planner.proposals[turn.id]
  if (existing && (existing.status !== 'pending' || existing.summary || existing.days.length)) return // already have it (and maybe applied/undone it)
  setPlannerState(s => {
    const prev = s.planner.proposals[turn.id]
    const p: Proposal = { id: turn.id, at: res.at || Date.now(), prompt: prev?.prompt || String(turn.meta.message || ''), ...clean, ...(clean.season ? { season: { ...clean.season, id: 'plan-' + turn.id } } : {}), status: 'pending', u: Date.now() }
    const nb = typeof o.notebook === 'string' && o.notebook.trim() ? { text: o.notebook.slice(0, 8000), at: Date.now() } : s.planner.notes
    return { ...s, planner: { proposals: { ...s.planner.proposals, [turn.id]: p }, notes: nb } }
  })
  const repairOf = typeof turn.meta.repairOf === 'string' ? turn.meta.repairOf : ''
  if (repairOf) setPlannerState(s => { const o = s.planner.proposals[repairOf]; return o ? { ...s, planner: { ...s.planner, proposals: { ...s.planner.proposals, [repairOf]: { ...o, status: 'superseded', repairing: false, u: Date.now() }, [turn.id]: { ...withSeason(s.planner.proposals[turn.id], o), prompt: o.prompt, repairOf } } } } : s })
  // a follow-up that superseded a season-carrying proposal and came back without one: the season was never applied, keep it
  const carryOf = typeof turn.meta.carryOf === 'string' ? turn.meta.carryOf : ''
  if (carryOf && !repairOf) setPlannerState(s => { const o = s.planner.proposals[carryOf], p = s.planner.proposals[turn.id]; return o && p && !p.season && o.season ? { ...s, planner: { ...s.planner, proposals: { ...s.planner.proposals, [turn.id]: withSeason(p, o) } } } : s })
  const p = getState().planner.proposals[turn.id], issues = p ? checkProposal(getState(), p) : []
  if (p && issues.length) {
    setPlannerState(s => ({ ...s, planner: { ...s.planner, proposals: { ...s.planner.proposals, [turn.id]: { ...s.planner.proposals[turn.id], issues, repairing: !repairOf } } } }))
    if (!repairOf) { // one automatic fix, never a loop
      submit('planner', '/api/planner/turn', { prompt: `AUTOMATIC CHECK BY THE APP (not the student): the proposal you just returned has problems the student would see:\n- ${issues.join('\n- ')}\nReturn the corrected proposal for the same request and range. Fix ONLY these problems; keep every time the student specified exactly; list each planned day completely; if your proposal had a "season", return the same season again (it is not applied yet).`, context: buildPlannerContext() }, { message: '(automatic check)', repairOf: turn.id })
      return
    }
  }
  if (hasChanges(p ?? clean)) toast(repairOf ? 'Plan ready (overlaps fixed) — preview it in Plan → Upcoming' : 'New plan ready — preview it in Plan → Upcoming', 'event_available')
}
/** the new proposal keeps the season of the one it replaces when it came back without one (the automatic overlap fix is told
 *  "fix ONLY these problems", and "" = no season change reads as "nothing changed since my last answer") */
const withSeason = (p: Proposal, from: Proposal): Proposal => p.season || !from.season ? p : { ...p, season: { ...from.season, id: 'plan-' + p.id } }
/** what a careful human would reject: overlaps, items past midnight, end times that don't add up */
export function checkProposal(s: State, p: Proposal): string[] {
  const out: string[] = []
  for (const d of diffProposal(s, p)) for (const c of d.conflicts) out.push(`${d.date}: ${c} overlap`)
  for (const d of p.days) for (const t of d.tasks) if (t.start && toMin(t.start) + t.dur > 24 * 60) out.push(`${d.date}: "${t.title}" (${t.start}, ${t.dur} min) runs past midnight`)
  return out.slice(0, 20)
}
function onPlannerError(t: { id: string; err?: string }) {
  setPlannerState(s => s.planner.proposals[t.id] ? { ...s, planner: { ...s.planner, proposals: { ...s.planner.proposals, [t.id]: { ...s.planner.proposals[t.id], status: 'error', err: t.err, u: Date.now() } } } } : s)
}

/* ───────── preview: what will change ───────── */
export interface DayDiff { date: string; add: PlannedTask[]; change: [PlannedTask, PlannedTask][]; remove: PlannedTask[]; skips: string[]; cpMin: number; workMin: number; totalMin: number; conflicts: string[] }
/** routine blocks active on a date (including ones this proposal adds) — hidden on every date the proposal plans in full */
function routineIdsOn(p: Proposal, date: string, template: Block[]) {
  const dow = keyToDate(date).getDay()
  const ids = template.filter(b => blockActive(b, date)).map(b => b.id)
  for (const r of p.routine) if (r.op === 'add' && (!r.days.length || r.days.includes(dow)) && (!r.from || r.from <= date) && (!r.until || r.until >= date)) ids.push('ai-' + r.key)
  return [...new Set(ids)]
}
const toItems = (p: Proposal, now = Date.now(), template: Block[] = getState().template): PlannedTask[] => p.days.flatMap(d => {
  const seen: Record<string, number> = {}
  const skip = [...new Set([...d.skip_blocks, ...routineIdsOn(p, d.date, template)])]
  return [
    ...d.tasks.map(t => { const n = (seen[t.key] = (seen[t.key] || 0) + 1); return { id: `ai:${t.key}${n > 1 ? '-' + n : ''}:${d.date}`, date: d.date, title: t.title, start: t.start || null, dur: t.dur, cat: t.cat, note: t.note || undefined, kind: 'task' as const, k: KIND_K[t.kind], plan: p.id, u: now, ...(t.cp && t.kind === 'cp_practice' ? { cp: t.cp } : {}) } }),
    ...skip.map(b => ({ id: `ai:skip-${b}:${d.date}`, date: d.date, title: 'skip', start: null, dur: 0, cat: 'break' as Cat, kind: 'skip' as const, skip: b, plan: p.id, u: now })),
  ]
})
export function diffProposal(s: State, p: Proposal): DayDiff[] {
  const next = toItems(p).filter(n => !dupOfPinned(s.agenda || [], n)), cur = (s.agenda || []).filter(a => a.date >= p.range.from && a.date <= p.range.to && !(s.del[a.id] >= a.u))
  const dates = [...new Set([...next.map(n => n.date), ...cur.map(c => c.date)])].sort()
  return dates.map(date => {
    const c = cur.filter(x => x.date === date), pinned = new Set(c.filter(x => x.pin).map(x => x.id))
    // applyProposal never overwrites a pinned record: an item re-listed under a pinned id isn't a change or an extra block
    const n = next.filter(x => x.date === date && !pinned.has(x.id))
    const add = n.filter(x => x.kind === 'task' && !c.some(y => y.id === x.id))
    const change = n.filter(x => x.kind === 'task').map(x => [c.find(y => y.id === x.id), x] as [PlannedTask | undefined, PlannedTask]).filter(([a, b]) => a && (a.start !== b.start || a.dur !== b.dur || a.title !== b.title || JSON.stringify(a.cp ?? null) !== JSON.stringify(b.cp ?? null))) as [PlannedTask, PlannedTask][]
    const remove = c.filter(x => !x.pin && x.kind === 'task' && !n.some(y => y.id === x.id))
    const skips = n.filter(x => x.kind === 'skip').map(x => x.skip!)
    // projected day after applying: routine (minus this plan's skips and the student's pinned per-day overrides) + kept + new items
    const hidden = new Set([...skips, ...c.filter(x => x.pin && x.kind === 'skip').map(x => x.skip!)])
    const routine = s.template.filter(b => blockActive(b, date) && !hidden.has(b.id))
    const items = [...c.filter(x => x.pin && x.kind === 'task'), ...n.filter(x => x.kind === 'task')]
    const all = [...routine.map(b => ({ title: b.title, start: b.start, dur: b.dur, k: b.k, cat: b.cat })), ...items.map(x => ({ title: x.title, start: x.start, dur: x.dur, k: x.k, cat: x.cat }))]
    const cpMin = all.filter(x => x.k === 'cp_practice' || x.k === 'cp_mock').reduce((a, x) => a + x.dur, 0)
    const timed = all.filter(x => x.start).map(x => ({ ...x, a: toMin(x.start!), b: toMin(x.start!) + x.dur })).sort((x, y) => x.a - y.a)
    const conflicts: string[] = []
    for (let i = 1; i < timed.length; i++) if (timed[i].a < timed[i - 1].b) conflicts.push(`${timed[i - 1].title} ↔ ${timed[i].title}`)
    return { date, add, change, remove, skips, cpMin, workMin: all.filter(x => isWork(x.cat)).reduce((a, x) => a + x.dur, 0), totalMin: all.reduce((a, x) => a + x.dur, 0), conflicts }
  })
}

/* ───────── apply / reject / undo ───────── */
export function applyProposal(id: string) {
  const s0 = getState(), p = s0.planner.proposals[id]
  if (!p || p.status !== 'pending') return
  const now = Date.now(), next = toItems(p, now).filter(n => !dupOfPinned(s0.agenda || [], n))
  setPlannerState(s => {
    const agenda = [...(s.agenda || [])], del = { ...s.del }
    const prevTouched: PlannedTask[] = [], added: string[] = []
    // supersede: unpinned AI items inside the range that this plan doesn't keep (a season-only answer plans no days: it keeps them)
    const planning = p.days.length > 0 || p.routine.length > 0
    for (const a of agenda) if (planning && !a.pin && a.date >= p.range.from && a.date <= p.range.to && !next.some(n => n.id === a.id)) { del[a.id] = now; prevTouched.push(a) }
    for (const n of next) {
      const i = agenda.findIndex(a => a.id === n.id)
      if (i >= 0) { if (agenda[i].pin) continue; if (!added.includes(n.id)) prevTouched.push(agenda[i]); agenda[i] = n } else { agenda.push(n); added.push(n.id) }
      if (del[n.id] && del[n.id] < now) delete del[n.id]
    }
    // recurring items become routine blocks with a date span
    const template = [...s.template], prevBlocks: Block[] = [], addedBlocks: string[] = []
    for (const r of p.routine) {
      if (r.op === 'add') {
        const bid = 'ai-' + r.key
        const b: Block = { id: bid, title: r.title, start: r.start || '09:00', dur: r.dur || 60, cat: r.cat || 'study', days: r.days.length ? r.days : [0, 1, 2, 3, 4, 5, 6], u: now, from: r.from || undefined, until: r.until || undefined, ai: p.id, ...(r.k ? { k: r.k } : {}) }
        const i = template.findIndex(x => x.id === bid)
        if (i >= 0) { if (!addedBlocks.includes(bid)) prevBlocks.push(template[i]); template[i] = b } else { template.push(b); addedBlocks.push(bid) }
      } else {
        const i = template.findIndex(x => x.id === r.block_id); if (i < 0) continue
        prevBlocks.push(template[i])
        if (r.op === 'update') template[i] = { ...template[i], title: r.title || template[i].title, start: r.start ?? template[i].start, dur: r.dur ?? template[i].dur, cat: r.cat ?? template[i].cat, days: r.days.length ? r.days : template[i].days, from: r.from || template[i].from, until: r.until || template[i].until, ...(r.k ? { k: r.k } : {}), u: now }
        else template[i] = { ...template[i], until: addDays(r.from || dateKey(), -1), u: now } // end it, keep history
      }
    }
    const live = agenda.filter(a => !(del[a.id] >= a.u))
    // the season the student told the planner about: stamped now, so it wins over an older overlapping one (seasonOn)
    const sid = 'plan-' + p.id, sea = p.season ? { ...p.season, id: sid, u: Math.max(now, (s.seasons?.[sid]?.u ?? 0) + 1) } : null
    const seasons = sea ? { ...(s.seasons || {}), [sea.id]: sea } : s.seasons
    return { ...s, agenda: live, template, del, seasons, planner: { ...s.planner, proposals: { ...s.planner.proposals, [id]: { ...p, status: 'applied', u: now, undo: { agenda: prevTouched, added, blocks: prevBlocks, addedBlocks, ...(sea ? { season: sea.id } : {}) } } } } }
  })
  reconcileToday()
  toast('Plan applied — it shows up day by day', 'event_available')
}
export function rejectProposal(id: string) {
  setPlannerState(s => s.planner.proposals[id] ? { ...s, planner: { ...s.planner, proposals: { ...s.planner.proposals, [id]: { ...s.planner.proposals[id], status: 'rejected', u: Date.now() } } } } : s)
}
export function undoProposal(id: string) {
  const p = getState().planner.proposals[id]; if (!p || p.status !== 'applied' || !p.undo) return
  const now = Date.now(), u = p.undo
  let kept = 0
  setPlannerState(s => {
    const del = { ...s.del }
    // the student's edits since (pinned records, merges) stay: undo never deletes or overwrites them. The plan's skips stay on
    // a date where such an item survives (or the routine block would come back next to it); items deleted since stay deleted.
    const cur = new Map((s.agenda || []).map(a => [a.id, a]))
    const keptIds = new Set(u.added.filter(id => cur.get(id)?.pin))
    const keptDates = new Set([...keptIds].map(id => cur.get(id)!.date))
    for (const id of u.added) { const a = cur.get(id); if (a && a.kind === 'skip' && keptDates.has(a.date)) keptIds.add(id) }
    kept = [...keptIds].filter(id => cur.get(id)?.kind === 'task').length
    const drop = u.added.filter(id => !keptIds.has(id))
    for (const a of drop) del[a] = now
    const restored = u.agenda.filter(a => !cur.get(a.id)?.pin && !(s.del[a.id] > p.u)).map(a => ({ ...a, u: now }))
    restored.forEach(a => { delete del[a.id] })
    const agenda = [...(s.agenda || []).filter(a => !drop.includes(a.id) && !restored.some(r => r.id === a.id)), ...restored]
    let template = s.template.filter(b => !u.addedBlocks.includes(b.id))
    for (const b of u.blocks) template = [...template.filter(x => x.id !== b.id), { ...b, u: now }]
    for (const b of u.addedBlocks) del[b] = now
    // the plan's season goes (a del-flagged copy) unless the student edited it in Settings since the plan was applied
    const sea = u.season ? s.seasons?.[u.season] : undefined
    const seasons = sea && !sea.del && sea.u <= p.u ? { ...s.seasons, [sea.id]: { ...sea, del: true, u: Math.max(now, sea.u + 1) } } : s.seasons
    return { ...s, agenda, template, del, seasons, planner: { ...s.planner, proposals: { ...s.planner.proposals, [id]: { ...p, status: 'undone', u: now } } } }
  })
  reconcileToday()
  toast(kept ? `Plan undone — kept ${kept} block${kept > 1 ? 's' : ''} you edited` : 'Plan undone', 'undo')
}
/** the next 7 days as they will look (today = the real day) */
export function upcoming(s: State, n = 7) {
  const k = dateKey()
  return Array.from({ length: n }, (_, i) => { const d = addDays(k, i); return { date: d, tasks: i === 0 && s.days[d] ? s.days[d].tasks : projectDay(s, d) } })
}

export function startPlanner() {
  onResult('planner', onPlannerResult, onPlannerError)
  const known = (id: string) => { const p = getState().planner.proposals[id]; return !!p && p.status !== 'pending' || !!p?.summary }
  const lastAt = () => Math.max(0, ...Object.values(getState().planner.proposals).filter(p => p.summary).map(p => p.at))
  void firstSync.then(() => catchUp('planner', lastAt(), known))
  // prune (newest 10 proposals, undo snapshots older than 2 days, agenda older than 14 days): the same cut mergeStates
  // re-applies after every union, so a pruned item can't come back from another device's copy
  if (capState(getState()) !== getState()) setPlannerState(s => capState(s))
}
