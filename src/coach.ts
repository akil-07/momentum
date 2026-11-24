import { SUB_BY_ID } from './curriculum'
import {
  addDays, addTaskToday, capCoachLog, completeTask, dateKey, fmtDur, getState, keyToDate, patchToday, sameHandle, setCp, spansOf, taskMinutes, toast, workMin,
  type CoachTodo, type CpState, type SessSpec, type Task,
} from './store'
import { getContests, getCfUser, getPastContests, getProb, gates, internalRating, isProvisional, pastContest, settledRating, syllabus, TAG_SET, topicState, divOf, isVoidTest, type CfSub, type Skill } from './cf'
import { activeSeconds, brkOverlap, classify, eventsByPid, recurringErrors, timeline, verdictChain } from './cptime'
import { catchUp, onResult, submit, type TurnResult } from './claude'
import { queues, setOnSessionEnded, skillNow } from './train'
import { RESOURCES, RES_BY_ID } from './resources'
import { dayPractice, discipline, progressRates } from './discipline'
import { firstSync, getSyncCfg, syncNow, syncStatusRef } from './sync'
import { seasonOn, seasonOut, targetFor, targetsAhead } from './season'
import { archiveForCoach } from './archive'
const getSyncStatus = () => syncStatusRef()

/* ═════════ the one-to-one coach: maximal data in, structured coaching out, applied safely ═════════ */

export type CoachKind = 'ask' | 'debrief' | 'report' | 'pre_contest' | 'post_contest' | 'weekly' | 'review'
/** other modules add snapshot fields here without touching this file, e.g. `extraData.leverage = () => leverageSummary()`.
 *  Each getter runs on every coach turn; a throwing or undefined getter is skipped. */
export const extraData: Record<string, () => unknown> = {}
/** optional slimmer form of an extraData entry, used by the size guard when the payload is too big */
export const extraShrink: Record<string, (v: unknown) => unknown> = {}
const PID_RE = /\b\d{3,4}[A-Z]\d?\b/g // real CF ids only — never '2D DP', '4K', '1A'

/** every problem id the app knows about — the coach may only cite these */
function knownIds(cp: CpState) {
  const s = new Set<string>([...Object.keys(cp.attempts), ...Object.keys(cp.resolve), ...Object.values(cp.tests).flatMap(t => t.pids)])
  for (const e of Object.values(cp.events)) if (!e.pid.startsWith('res:')) s.add(e.pid)
  for (const p of Object.values(cp.plans)) p.test.forEach(x => s.add(x))
  for (const c of Object.values(cp.ideas || {})) if (!c.del) s.add(c.pid)
  for (const id of extraKnown) s.add(id)
  for (const x of getCfUser()?.list || []) if (LIVE_PT.has(x.pt)) s.add(x.pid)
  return s
}
/** ids this device asked about explicitly (a review of a problem not yet in the event log) */
const extraKnown = new Set<string>()
/** a submission made inside a round (live, out of competition or virtual), not in practice */
const LIVE_PT = new Set(['CONTESTANT', 'OUT_OF_COMPETITION', 'VIRTUAL'])
/** rounds the student took part in (rated results, round submissions, real-round mocks, rounds they said they're taking)
 *  plus today's and the last week's rounds: any problem letter of these is real. A just-finished round isn't in the
 *  problemset yet (no rating), which is how "Upsolve [?]" happened — the id was right, the validator didn't know it */
export function roundCids(cp: CpState = getState().cp, now = Date.now()) {
  const u = getCfUser(), s = new Set<number>()
  for (const r of u?.rated || []) s.add(r.cid)
  for (const x of u?.list || []) if (LIVE_PT.has(x.pt)) s.add(x.cid)
  for (const t of Object.values(cp.tests)) if (t.real?.contestId) s.add(t.real.contestId)
  for (const k of Object.keys(cp.triggers)) { const m = k.match(/^(?:in|pre|post):(\d+)$/); if (m) s.add(+m[1]) }
  for (const c of getContests()) if (c.start < now + 864e5) s.add(c.id)
  for (const c of getPastContests()) if (c.start > now - 7 * 864e5) s.add(c.id)
  return s
}
/** the coach may cite an id when the app has seen it or it's a problem of one of those rounds */
function idCheck(cp: CpState) {
  const ok = knownIds(cp), cids = roundCids(cp)
  return (id: string) => { if (ok.has(id)) return true; const m = id.match(/^(\d{3,4})([A-Z]\d?)$/); return !!m && cids.has(+m[1]) }
}
const stripIds = (text: string, ok: (id: string) => boolean) => text.replace(PID_RE, m => ok(m) ? m : '[?]')

/** the student's recent rounds with their result per problem (live/virtual submissions from the CF list) */
function recentRounds(days = 14) {
  const u = getCfUser(); if (!u) return undefined
  const since = Date.now() - days * 864e5, by = new Map<number, CfSub[]>()
  for (const x of u.list || []) if (x.at > since && LIVE_PT.has(x.pt)) { const l = by.get(x.cid); if (l) l.push(x); else by.set(x.cid, [x]) }
  for (const r of u.rated || []) if (r.at > since && !by.has(r.cid)) by.set(r.cid, [])
  if (!by.size) return undefined
  return [...by].map(([cid, subs]) => {
    const r = u.rated?.find(x => x.cid === cid), probs = new Map<string, CfSub[]>()
    for (const x of [...subs].sort((a, b) => a.at - b.at)) { const l = probs.get(x.pid); if (l) l.push(x); else probs.set(x.pid, [x]) }
    return {
      contest: cid, name: r?.name ?? pastContest(cid)?.name, type: subs[0]?.pt ?? 'CONTESTANT', rank: r?.rank, delta: r ? r.new - r.old : undefined,
      problems: [...probs].map(([pid, l]) => { const ac = l.findIndex(x => x.v === 'OK'); const before = ac < 0 ? l : l.slice(0, ac)
        return { id: pid, solved: ac >= 0, wrong: before.filter(x => x.v !== 'COMPILATION_ERROR').length, solve_min: ac >= 0 && l[ac].rel !== null ? Math.round(l[ac].rel! / 60) : undefined, last: ac < 0 ? l[l.length - 1].v : undefined } }),
    }
  }).slice(-6)
}

/* ───────── payload: snapshot + delta since the coach's last acknowledged event ───────── */
/** the static material (resources, the curriculum, the notebook, long histories) goes in full only on the first turn of a
 *  coach session — the conversation keeps it — and again every STATIC_EVERY turns as a safety net (autocompaction can drop it).
 *  The marker is `cstatic:<gen>` in cp.triggers (synced, merged by max): a session rotated on the laptop has a new gen. */
export const STATIC_EVERY = 12
/** extraData keys that are static (sent on full turns only) */
const STATIC_EXTRA = new Set(['curriculum'])
/** extraData keys sent in their shrunk form on delta turns */
const DELTA_SHRINK = new Set(['work_log'])
/** the newest session generation this device has heard of (results, the panel's session info, a reset) */
let serverGen = 0
export const noteCoachGen = (g: unknown) => { if (typeof g === 'number' && g > serverGen) serverGen = g }
/** a reset answers with the OLD gen (the server only starts the new conversation, gen + 1, on the next turn): that next turn
 *  must carry the static material */
export const noteCoachReset = (oldGen: unknown) => noteCoachGen(typeof oldGen === 'number' ? oldGen + 1 : oldGen)
const coachGen = (cp: CpState) => Math.max(serverGen, cp.coachAck?.gen || 0, ...Object.values(cp.coachLog).map(m => m.gen || 0))
export function needStatic(cp: CpState = getState().cp) {
  const g = coachGen(cp), mark = cp.triggers[`cstatic:${g}`] || (inFlight?.gen === g ? inFlight.at : 0)
  return !mark || Object.values(cp.coachLog).filter(m => m.at > mark).length >= STATIC_EVERY
}
/** the full turn this device queued and is waiting on: it stands in for the marker (no second full turn right behind it), but the
 *  synced marker is only written when its answer lands — a full turn that errors never leaves the session marked as having it */
let inFlight: { id: string; gen: number; at: number } | null = null
export const markStaticSent = (id = '') => { inFlight = { id, gen: coachGen(getState().cp), at: Date.now() } }
/** a full turn was answered in session `gen` (the server may have rotated it at turn time: then the NEW session got the
 *  material). A delta turn answered by a new gen leaves that gen unmarked, so the next turn goes full. */
function staticLanded(id: string, gen: number) {
  if (inFlight?.id === id) inFlight = null
  const at = getState().cp.coachLog[id]?.at || Date.now()
  setCp(c => (c.triggers[`cstatic:${gen}`] || 0) >= at ? c : { ...c, triggers: { ...c.triggers, [`cstatic:${gen}`]: at } })
}

/** `full`: force (true) or suppress (false) the static material; default: needStatic() */
export function buildCoachData(kind: CoachKind, extra: Record<string, unknown> = {}, opt: { full?: boolean } = {}) {
  const s = getState(), cp = s.cp, u = getCfUser(), sk = skillNow(), k = dateKey()
  const full = opt.full ?? needStatic(cp)
  const byPid = eventsByPid(cp)
  const since = cp.coachAck?.upTo || 0
  // watermark on when the app RECORDED an event (late CF submissions get a fresh stamp), minus a grace window for
  // events still syncing in from the other device — a little overlap is fine, a gap is not
  const upTo = Date.now() - 10 * 60000
  const fresh = (e: { at: number; ing?: number }) => (e.ing ?? e.at) > since
  const g = gates(sk, cp), q = queues(sk), dis = discipline(s), rates = progressRates(s)

  // every problem touched since last turn, with its full story
  const touched = [...byPid.keys()].filter(pid => !pid.startsWith('res:') && (byPid.get(pid) || []).some(fresh))
  const sessOf = (pid: string) => Object.values(cp.sessions).find(x => x.pids.includes(pid) && x.endedAt > since)
  const problems = touched.map(pid => {
    const p = getProb(pid), t = timeline(pid, byPid.get(pid)), se = sessOf(pid)
    const act = se ? activeSeconds((byPid.get(pid) || []).concat(), se.startedAt, se.endedAt, se.brks)[pid] : undefined
    const att = cp.attempts[pid]
    return {
      id: pid, r: p?.r, tags: p?.t.filter(x => TAG_SET.has(x)), mode: se?.spec?.mode ?? se?.kind ?? att?.src,
      opened: t.firstOpen ? new Date(t.firstOpen).toISOString().slice(0, 16) : undefined,
      first_sub_min: t.firstOpen && t.firstSub ? Math.round((t.firstSub - t.firstOpen) / 60000) : undefined,
      ac_min: t.acAt && (t.firstOpen || se) ? Math.round((t.acAt - (t.firstOpen || se!.startedAt) - brkOverlap(se?.brks, t.firstOpen || se!.startedAt, t.acAt)) / 60000) : undefined,
      active_min: act !== undefined ? Math.round(act / 60) : undefined,
      verdicts: verdictChain(t) || undefined,
      subs: t.subs.map(x => ({ v: x.v, tests_passed: x.tn, ms: x.ms, kb: x.mem ? Math.round(x.mem / 1024) : undefined, contest_sec: x.rel, type: x.pt })),
      errors: classify(t), hint_level: t.hint, editorial: t.editorial, gave_up: t.gaveUp,
      result: att?.status ?? (t.acAt ? 'solved' : 'open'), debrief: t.debrief, notes: t.notes.length ? t.notes : undefined,
      timebox_min: p ? Math.round(20 + Math.max(0, p.r - sk.level) / 10) : undefined,
    }
  })
  const sessions = Object.values(cp.sessions).filter(x => x.endedAt > since && sameHandle(x.h, cp.handle)).map(x => ({
    id: x.id, kind: x.kind, date: x.date, start: new Date(x.startedAt).toTimeString().slice(0, 5), mins: x.mins, served: x.pids.length, solved: x.solved.length,
    spec: x.spec ? { mode: x.spec.mode, tags: x.spec.tags, band: [x.spec.lo, x.spec.hi], by: x.spec.by } : undefined,
    split_min: Object.fromEntries(Object.entries(activeSeconds(x.pids.flatMap(p => byPid.get(p) || []), x.startedAt, x.endedAt, x.brks)).map(([p, v]) => [p, Math.round(v / 60)])),
  }))
  const mocks = Object.values(cp.tests).filter(t => t.finishedAt && t.finishedAt > since && sameHandle(t.h, cp.handle)).map(t => ({
    date: t.date, perf: t.perf, solved: Object.keys(t.solved).length, of: t.pids.length,
    problems: t.pids.map((pid, i) => ({ pos: 'ABCDEF'[i], id: pid, r: getProb(pid)?.r, tags: getProb(pid)?.t.filter(x => TAG_SET.has(x)), solved_min: t.solved[pid] !== undefined ? Math.round(t.solved[pid] / 60) : null, wrong: (byPid.get(pid) || []).filter(e => e.k === 'sub' && e.sess === t.id && e.v !== 'OK').length })),
  }))
  const resources = Object.values(cp.events).filter(e => e.k === 'resource' && fresh(e)).map(e => ({ id: e.pid.slice(4), mins: e.mins, at: new Date(e.at).toISOString().slice(0, 16) }))
  const days = Object.keys(s.days).filter(d => keyToDate(d).getTime() + 864e5 > since && d <= k).sort().map(d => {
    const day = s.days[d]
    return {
      date: d, practice_min: dayPractice(s, d), mock: Object.values(cp.tests).some(t => t.date === d && t.finishedAt && !isVoidTest(t, cp)), // a voided mock is no mock
      planned: day.tasks.map(t => ({ title: t.title, min: t.dur, done: t.done, k: t.k, start: t.start, real_min: taskMinutes(day, t.id) === undefined ? undefined : Math.round(taskMinutes(day, t.id)!) })), focus_min: day.focusMin,
      work_min: workMin(day), // real: from the timers (work_log has every start–end)
    }
  })
  const answers = Object.values(cp.coachQs).filter(x => x.answer && (x.answeredAt || 0) > since).map(x => ({ q: x.q, a: x.answer }))
  const todosDone = Object.values(cp.coachTodos).filter(t => t.done && t.u > since).map(t => ({ title: t.title, learned: t.learned }))
  // only open, live to-dos go back (expired and merged duplicates stay in the app's list)
  const inToday = new Set((s.days[k]?.tasks || []).filter(t => t.k === 'coach' && !t.done).map(t => t.id))
  const todosOpen = openTodos(cp).map(t => [t.title, t.kind, t.due, t.start || '', inToday.has(t.id) ? 1 : 0])
  const tg = targetFor(k, s), sea = seasonOn(k, s)
  const rounds = recentRounds()
  const ratedRows = (u?.rated || []).filter(r => r.at > since).map(r => ({ contest: r.name, id: r.cid, rank: r.rank, old: r.old, new: r.new }))

  const snapshot = {
    now: new Date().toISOString().slice(0, 16), weekday: new Date().toLocaleDateString('en', { weekday: 'long' }),
    handle: cp.handle || null, rated_contests: u?.contests ?? 0, provisional: isProvisional(u),
    cf_rating: isProvisional(u) ? null : u?.rating || null, internal_rating_estimate: internalRating(u) || null, settled_rating: settledRating(u) || null,
    practice_level: sk.level, self_estimated_start: cp.calib || null, problems_tracked: sk.events,
    offsets: { practice: cp.offsets.practice, mock: cp.offsets.mock }, focus_tags: cp.focusTags, speed_positions: cp.speedPos.list,
    topics: sk.tags.map(t => [t.tag, t.theta, t.n, t.solved, t.failed, topicState(sk, cp, t.tag)]),
    topics_columns: ['tag', 'rating', 'attempts', 'solved', 'failed', 'lifecycle'],
    gates: { next_tier: g.tier, passed: g.passed, missing: g.tags.filter(t => !g.passed.includes(t)) },
    mock_syllabus: syllabus(sk, cp),
    queues: { upsolve: q.upsolve.map(x => ({ id: x.pid, overdue: x.overdue })), resolve_due: q.resolve, upsolve_debt: q.debt },
    recurring_errors_14d: recurringErrors(byPid, Date.now() - 14 * 864e5),
    // 90 days of history once per session; later turns get the last 14 (the trend the coach needs now)
    discipline: full ? dis : { ...dis, history: dis.history.slice(-14) }, progress: rates,
    today_plan: cp.plans[k] ? { specs: cp.plans[k].specs, mock_ratings: cp.plans[k].test.map(p => getProb(p)?.r) } : null,
    upcoming_contests: getContests().slice(0, 6).map(c => ({ id: c.id, name: c.name, div: divOf(c.name), starts: new Date(c.start).toISOString().slice(0, 16), min: Math.round(c.dur / 60) })),
    rating_history: (u?.rated || []).slice(-10).map(r => ({ contest: r.name, rank: r.rank, old: r.old, new: r.new })),
    open_questions: Object.values(cp.coachQs).filter(x => !x.answer).map(x => x.q),
    ideas: ideasFor(cp, full ? 0 : since), ideas_columns: ['pid', 'idea', 'lapses', 'reps', 'due'],
    tricks: full && cp.tricks?.list?.length ? cp.tricks.list : undefined,
    week_plan: Object.entries(s.agenda?.reduce((m, a) => { if (a.date >= k && a.date <= addDays(k, 6) && a.kind !== 'skip') (m[a.date] ||= []).push(`${a.start || '--'} ${a.title} (${a.dur}m)`); return m }, {} as Record<string, string[]>) || {}),
  }
  for (const [key, get] of Object.entries(extraData)) {
    if (!full && STATIC_EXTRA.has(key)) continue
    try {
      let v = get()
      if (!full && DELTA_SHRINK.has(key) && extraShrink[key] && v !== undefined) v = extraShrink[key](v)
      if (v !== undefined && !(key in snapshot)) (snapshot as Record<string, unknown>)[key] = v
    } catch (e) { console.error('coach extraData', key, e) }
  }
  const delta = { since: since ? new Date(since).toISOString().slice(0, 16) : 'beginning', problems, sessions, mocks, resources_read: resources, days, answers, todos_done: todosDone, rated_contests_new: ratedRows }
  const allowed = [...new Set([...problems.map(p => p.id), ...(rounds || []).flatMap(r => r.problems.map(p => p.id)), ...q.upsolve.map(x => x.pid), ...q.resolve, ...[...knownIds(cp)].reverse()])].slice(0, 400)
  let data: Record<string, unknown> = {
    kind, snapshot, delta, allowed_ids: allowed,
    // top level (the prompt reads data.season / data.targets / data.todo_open / data.recent_rounds):
    // the commitment follows the season (exam weeks are light): today + the next 7 days
    season: sea ? seasonOut(sea) : null,
    targets: targetsAhead(8, k, s).map(t => ({ date: t.date, kind: t.kind, cp_min: t.cpMin, mock: t.mock, mock_min: t.mockMin, contests: t.contests })),
    targets_note: tg.kind === 'exam' ? 'exam season: hold the student to these light targets, not 4.5h + mock; at most 1 automatic debrief a day and 1 to-do into Today a day' : undefined,
    todo_open: todosOpen, todo_open_columns: ['title', 'kind', 'due', 'start', 'in_today'],
    recent_rounds: rounds,
    ...extra,
    ...(full ? {
      resources: RESOURCES.map(r => [r.id, r.tag, r.title, r.tier[0], r.tier[1], r.minutes]),
      notebook: cp.coachNotes.text,
      // long-term memory: one row per month for the last 24 (older detail: grep data/archive on the laptop)
      archive: archiveForCoach(),
    } : { static: 'unchanged since earlier in this conversation (resources list, snapshot.curriculum, notebook, tricks, full discipline history, all ideas, archive months): use those; this turn sends deltas only' }),
  }
  // size guard (~60 KB): fold older detail into compact rows, shrinking until it fits
  for (let keep = 40; JSON.stringify(data).length > 60000 && keep >= 0; keep = keep ? Math.floor(keep / 2) : -1) {
    // before cutting problem detail to the bone, slim the fixed-size snapshot extras (curriculum, sub-topic rows)
    if (keep === 10) {
      const sn: Record<string, unknown> = { ...snapshot }
      for (const [key, f] of Object.entries(extraShrink)) if (sn[key] !== undefined) { try { sn[key] = f(sn[key]) } catch (e) { console.error('coach extraShrink', key, e) } }
      data = { ...data, snapshot: sn }
    }
    const slim = problems.slice(0, Math.max(0, problems.length - keep)).slice(-150).map(p => ({ id: p.id, r: p.r, result: p.result, verdicts: p.verdicts, ac_min: p.ac_min, hint_level: p.hint_level }))
    data = { ...data, delta: { ...delta, problems: [...slim, ...problems.slice(problems.length - keep)], sessions: sessions.slice(-40), days: days.slice(-21), mocks: mocks.slice(-10), older_problems_omitted: Math.max(0, problems.length - keep - 150) } }
  }
  return { data, upTo, full }
}

/** idea-bank cards for the coach: the most-forgotten and newest first, compact rows, <= 150 */
function ideasFor(cp: CpState, since = 0) {
  const list = Object.values(cp.ideas || {}).filter(c => !c.del && c.idea && c.u > since)
  if (!list.length) return undefined
  return list.sort((a, b) => b.lapses - a.lapses || b.created - a.created).slice(0, 150).map(c => [c.pid, c.idea.slice(0, 160), c.lapses, c.reps, c.due])
}

/* ───────── asking ───────── */
/** `top`: extra top-level body fields the server validates (pid for a stuck/review turn; code, want_fix, hint, solved for 'review') */
export function askCoach(kind: CoachKind, message = '', extra: Record<string, unknown> = {}, fixedId?: string, top: Record<string, unknown> = {}) {
  if (!getSyncCfg()) { toast('Connect sync first (Settings → Sync) — the coach runs on your laptop', 'cloud_off'); return null }
  const { data, upTo, full } = buildCoachData(kind, extra)
  const pid = typeof top.pid === 'string' ? top.pid : undefined
  if (pid) { extraKnown.add(pid); if (Array.isArray(data.allowed_ids) && !data.allowed_ids.includes(pid)) data.allowed_ids = [pid, ...data.allowed_ids] }
  const id = submit('coach', '/api/coach/turn', { ...top, kind, message, data }, { kind, message, upTo, ...(pid ? { pid } : {}), ...(full ? { full: true } : {}) }, fixedId)
  if (full) markStaticSent(id)
  setCp(c => ({ ...c, coachLog: capCoachLog({ ...c.coachLog, [id]: { id, at: Date.now(), kind, q: message || undefined } }) }))
  return id
}
export function answerQuestion(qid: string, answer: string) {
  setCp(c => c.coachQs[qid] ? { ...c, coachQs: { ...c.coachQs, [qid]: { ...c.coachQs[qid], answer, answeredAt: Date.now(), u: Date.now() } } } : c)
}
export function markSent(ids: string[]) {
  setCp(c => { const qs = { ...c.coachQs }; for (const id of ids) if (qs[id]) qs[id] = { ...qs[id], sent: Date.now(), u: Date.now() }; return { ...c, coachQs: qs } })
}
export const QUICK = [
  'What should I do right now?', 'What are my weaknesses?', 'Review my last mock', 'Plan my week of training',
]

/* ───────── applying the coach's answer (clamped, ids checked) ───────── */
const clampN = (x: unknown, lo: number, hi: number, d: number) => typeof x === 'number' && isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d
const asArr = (x: unknown) => Array.isArray(x) ? x : []
const asStr = (x: unknown) => typeof x === 'string' ? x : ''
const MODES = ['learn', 'drill', 'mixed', 'speed', 'resolve', 'upsolve', 'deep', 'position']

/** (exported for tests) */
export function applyCoach(turn: { id: string; meta: Record<string, unknown> }, res: TurnResult) {
  const o = res.structured || {}
  // idempotent: the same turn can arrive twice (poll + log catch-up, or two devices) — apply it once
  if (getState().cp.coachLog[turn.id]?.out) {
    if (typeof turn.meta.upTo === 'number' && (turn.meta.upTo as number) > getState().cp.coachAck.upTo) setCp(c => ({ ...c, coachAck: { upTo: turn.meta.upTo as number, gen: res.gen, u: Date.now() } }))
    return
  }
  if (typeof turn.meta.pid === 'string') extraKnown.add(turn.meta.pid)
  noteCoachGen(res.gen)
  if (turn.meta.full && typeof res.gen === 'number') staticLanded(turn.id, res.gen)
  const cp = getState().cp, ok = idCheck(cp), sk = skillNow(), L = sk.level, now = Date.now(), k = dateKey()
  const clean = (t: unknown) => stripIds(asStr(t), ok)
  const refOk = (r: string) => !r || RES_BY_ID.has(r) || ok(r) || TAG_SET.has(r) || /^\d+$/.test(r)
  const cleanArr = (x: unknown) => asArr(x).map(v => typeof v === 'string' ? clean(v) : v).filter(v => typeof v !== 'string' || !/^\[\?\]$/.test(v))
  const out: Record<string, unknown> = {
    ...o, message: clean(o.message),
    insights: asArr(o.insights).map((x: Record<string, unknown>) => ({ claim: clean(x.claim), evidence: asArr(x.evidence).map(asStr).filter(e => ok(e) || TAG_SET.has(e) || RES_BY_ID.has(e)) })),
    review: o.review && typeof o.review === 'object' ? Object.fromEntries(Object.entries(o.review as Record<string, unknown>).map(([kk, v]) => [kk, Array.isArray(v) ? cleanArr(v) : typeof v === 'string' ? clean(v) : v])) : o.review,
    contest: o.contest && typeof o.contest === 'object' ? Object.fromEntries(Object.entries(o.contest as Record<string, unknown>).map(([kk, v]) => [kk, Array.isArray(v) ? cleanArr(v) : typeof v === 'string' ? clean(v) : v])) : o.contest,
  }

  const nowO = (o.now || {}) as Record<string, unknown>
  const coachNow = asStr(nowO.text) ? { text: clean(nowO.text), action: asStr(nowO.action) || 'none', ref: refOk(asStr(nowO.ref)) ? asStr(nowO.ref) : '', minutes: clampN(nowO.minutes, 0, 300, 0), at: res.at || now } : null

  // to-do ids are per turn, so the same assignment re-issued next turn would pile up: a duplicate of an open to-do
  // refreshes that one instead (mergeTodos); a leading "06:00" / "11-23 08:00:" becomes the start time / due date
  const incoming: Todo[] = asArr(o.todo).slice(0, 8).map((t: Record<string, unknown>, i: number) => {
    const ref = asStr(t.ref), id = `ct:${turn.id.slice(0, 12)}:${i}`
    const pt = parseTodoTitle(clean(t.title), k), due = /^\d{4}-\d{2}-\d{2}$/.test(asStr(t.due)) ? asStr(t.due) : pt.due || k
    const r = refOk(ref) ? ref : ''
    const x: Todo = { id, kind: asStr(t.kind) || 'read', title: pt.title.slice(0, 160), minutes: clampN(t.minutes, 5, 240, 30), ref: r, why: clean(t.why).slice(0, 300), due: pt.due && pt.due > due ? pt.due : due, at: now, u: now }
    if (pt.start) x.start = pt.start
    if (PID_ONE.test(r)) x.pid = r
    return x
  }).filter(t => t.title)
  const { add: todos, refresh, merged } = mergeTodos(cp.coachTodos as Record<string, Todo>, incoming, now)
  if (merged.length) out.todo_merged = merged
  const qs = Object.fromEntries(asArr(o.questions_for_user).slice(0, 4).map((x: Record<string, unknown>, i: number) => {
    const id = `cq:${turn.id.slice(0, 12)}:${i}`
    return [id, { id, q: clean(x.q).slice(0, 300), options: asArr(x.options).map(asStr).filter(Boolean).slice(0, 4), at: now, asked: 1, u: now }]
  }))
  const weak = asArr(o.weaknesses).slice(0, 10).map((w: Record<string, unknown>) => ({ area: clean(w.area), evidence: asArr(w.evidence).map(asStr).filter(e => ok(e) || TAG_SET.has(e)), status: asStr(w.status) || 'open', plan: clean(w.plan) }))

  const d = (o.designs || {}) as Record<string, unknown>
  const specs: SessSpec[] = asArr(d.sessions).slice(0, 6).filter((x: Record<string, unknown>) => MODES.includes(asStr(x.mode))).map((x: Record<string, unknown>) => {
    const lo = clampN(x.lo, Math.max(800, L - 500), L + 600, L), hi = clampN(x.hi, lo, L + 700, lo + 200)
    return { mode: x.mode as SessSpec['mode'], tags: asArr(x.tags).map(asStr).filter(t => TAG_SET.has(t)).slice(0, 4), lo, hi, minutes: clampN(x.minutes, 15, 180, 90), timebox: Math.max(0.75, Math.min(1.5, typeof x.timebox_mult === 'number' ? x.timebox_mult : 1)), why: clean(x.why).slice(0, 200), by: 'coach' as const, sub: SUB_BY_ID.has(asStr(x.sub)) ? asStr(x.sub) : undefined, pos: x.mode === 'position' && /^[A-F]$/i.test(asStr(x.pos)) ? asStr(x.pos).toUpperCase() : undefined }
  })
  const syl = syllabus(sk, cp)
  const mockSlots = asArr(d.mock_slots).length === 6 ? asArr(d.mock_slots).map((x: Record<string, unknown>) => ({ tag: syl.includes(asStr(x.tag)) ? asStr(x.tag) : '', rating: clampN(x.rating, L - 400, L + 600, L) })) : undefined
  const mockAdj = clampN(d.mock_offset_adjust, -100, 100, 0)
  const dir = (o.directives || {}) as Record<string, unknown>
  const focus = asArr(dir.focus_tags).map(asStr).filter(t => TAG_SET.has(t)).slice(0, 3)
  const offAdj = clampN(dir.offset_adjust, -100, 100, 0)
  const speed = asArr(dir.speed_positions).map(asStr).filter(p => /^[A-F]$/.test(p)).slice(0, 3)
  const rep = (o.report || {}) as Record<string, unknown>
  const nb = asStr(o.notebook)
  // the coach returns its FULL trick catalogue when it changed, [] otherwise (keep the previous one then)
  const tricks = asArr(o.tricks).slice(0, 40).map((x: Record<string, unknown>) => ({ name: clean(x.name).slice(0, 80), pids: asArr(x.pids).map(asStr).filter(p => ok(p)).slice(0, 30), note: clean(x.note).slice(0, 240) || undefined })).filter(x => x.name && x.pids.length)

  // the coach sorts problems into curriculum sub-topics (only problems it was shown; only real sub-topic ids)
  const cls = asArr(o.classify).slice(0, 80).map((x: Record<string, unknown>) => ({ pid: asStr(x.pid), subs: asArr(x.subs).map(asStr).filter(s => SUB_BY_ID.has(s)).slice(0, 4) })).filter(x => ok(x.pid) && x.subs.length)
  setCp(c => {
    const topics = { ...c.topics }, subs = { ...(c.subs || {}) }, subtag = { ...(c.subtag || {}) }
    for (const t of asArr(d.learn_start).map(asStr).filter(t => TAG_SET.has(t))) if (!topics[t] || topics[t].st === 'learning') topics[t] = { st: 'learning', since: now, u: now }
    for (const t of asArr(d.learn_done).map(asStr).filter(t => TAG_SET.has(t))) topics[t] = { st: 'learned', since: now, u: now }
    // sub-topics: starting never overrides your own "stop" (paused) or a learned mark
    for (const s of asArr(d.learn_start).map(asStr).filter(s => SUB_BY_ID.has(s))) if (!subs[s]) subs[s] = { st: 'learning', since: now, u: now }
    for (const s of asArr(d.learn_done).map(asStr).filter(s => SUB_BY_ID.has(s))) if (subs[s]?.st !== 'paused') subs[s] = { st: 'learned', since: now, u: now }
    // your own classification wins over the coach's
    for (const x of cls) if (subtag[x.pid]?.by !== 'user') subtag[x.pid] = { subs: x.subs, by: 'coach', u: now }
    const next: CpState = {
      ...c, topics, subs, subtag,
      coachLog: { ...c.coachLog, [turn.id]: { id: turn.id, at: res.at || now, kind: asStr(turn.meta.kind) || res.kind || 'ask', q: asStr(turn.meta.message) || c.coachLog[turn.id]?.q, out, gen: res.gen } },
      coachNow: coachNow ?? c.coachNow,
      // never reset a todo/question the student already acted on
      coachTodos: { ...todos, ...c.coachTodos, ...Object.fromEntries(Object.entries(refresh).filter(([id]) => c.coachTodos[id]).map(([id, f]) => [id, { ...c.coachTodos[id], ...f }])) },
      coachQs: { ...qs, ...c.coachQs },
      coachWeak: weak.length ? { list: weak, at: now } : c.coachWeak,
      tricks: tricks.length ? { list: tricks, at: now } : c.tricks,
      coachNotes: nb.trim() ? { text: nb.slice(0, 12000), at: now } : c.coachNotes,
      coachAck: typeof turn.meta.upTo === 'number' ? { upTo: turn.meta.upTo as number, gen: res.gen, u: now } : c.coachAck,
      designs: specs.length || mockSlots ? { specs: specs.length ? specs : c.designs.specs, forDate: k, at: now, mock: mockSlots ?? c.designs.mock } : c.designs,
      offsets: mockAdj || offAdj ? { practice: Math.max(-100, Math.min(300, c.offsets.practice + offAdj)), mock: Math.max(-300, Math.min(400, c.offsets.mock + mockAdj)), u: now } : c.offsets,
      focusTags: focus.length ? focus : c.focusTags, focusU: focus.length ? now : c.focusU,
      speedPos: speed.length ? { list: speed, u: now } : c.speedPos,
      coach: asStr(rep.headline) ? { at: now, report: { headline: clean(rep.headline), position: clean(rep.position), estimated_level: clampN(rep.estimated_level, 0, 4000, L), next_milestone: clean(rep.next_milestone), strengths: asArr(rep.strengths).map(clean), weaknesses: weak.map(w => ({ topic: w.area, why: w.evidence.join(', '), drill: w.plan })), focus_tags: focus, this_week: asArr(rep.this_week).map(clean), today: coachNow?.text || '' } } : c.coach,
    }
    return next
  })
  // coach todos land in Today (as coach tasks, at most TODAY_CAP open at a time) — one tap away from starting
  reconcileTodos()
  if (turn.meta.kind !== 'ask' && asStr(o.message)) toast('Coach: ' + clean(o.message).split('\n')[0].slice(0, 120), 'psychology')
}
/** (exported for tests) */
export function onCoachError(t: { id: string; err?: string }) {
  if (inFlight?.id === t.id) inFlight = null // the material never reached the conversation: the next turn carries it
  setCp(c => ({ ...c, coachLog: { ...c.coachLog, [t.id]: { ...(c.coachLog[t.id] || { id: t.id, at: Date.now(), kind: 'ask' }), err: t.err || 'failed' } } }))
}

/* ───────── coach todos: dedupe, expiry, the Today cap ───────── */
/** extra fields on a synced CoachTodo (records merge whole by u, so these travel with it):
 *  st: expired (3 days without being done) / dup (merged into `dupOf`, kept for history); start: "HH:MM" from the title;
 *  pid: the problem it is about; fresh: last time the coach re-issued it (a duplicate refreshes); seen: times issued */
export type Todo = CoachTodo & { st?: 'expired' | 'dup'; dupOf?: string; start?: string; pid?: string; fresh?: number; seen?: number }
export const TODO_TTL_DAYS = 3, TODAY_CAP = 3
const PID_ONE = /^\d{3,4}[A-Z]\d?$/
const isOpen = (t: Todo) => !t.done && !t.st
/** open, live to-dos, earliest due first (the Coach tab list, the coach's todo_open) */
export const openTodos = (cp: CpState = getState().cp) => (Object.values(cp.coachTodos) as Todo[]).filter(isOpen).sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : a.at - b.at)

/** "06:00 Upsolve…" / "11-23 08:00: upsolve…" / "2026-11-23 08:00 …": the time becomes the task's start (and the date its
 *  due day), stripped from the title. A month-day more than 6 months back means next year. */
export function parseTodoTitle(title: string, today = dateKey()): { title: string; start?: string; due?: string } {
  const m = title.match(/^\s*(?:(\d{4})-)?(?:(\d{1,2})-(\d{1,2})[ ,T]+)?([01]?\d|2[0-3]):([0-5]\d)\b\s*[:\-–—,.]?\s*/)
  const rest = m ? title.slice(m[0].length).trim() : ''
  if (!m || !rest) return { title: title.trim() }
  const start = `${m[4].padStart(2, '0')}:${m[5]}`
  let due: string | undefined
  if (m[2]) {
    const y = +(m[1] || today.slice(0, 4)), md = `-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    due = `${y}${md}`
    if (!m[1] && due < addDays(today, -180)) due = `${y + 1}${md}`
  }
  return { title: rest[0].toUpperCase() + rest.slice(1), start, due }
}

const STOP = new Set('a an the and or of to for in on at by with your you it its is be this that then each one up as do it\'s from into'.split(' '))
/** comparable words: lowercase, no punctuation/times, no stop words, no 1–2 digit counts ("3-line", "30-min"). A lone capital
 *  A–H (a problem letter: "div2 B", "problem D") is kept as a `prob<x>` token — it is what tells two upsolves apart. */
const words = (s: string) => s.replace(/\b\d{1,2}:\d{2}\b/g, ' ').replace(/(?<!^)\b([A-H])(\d?)\b/g, ' prob$1$2 ').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1 && !STOP.has(w) && !/^\d{1,2}$/.test(w))
/** a title's head (before ":", "(", ";", ",", " - ") and the rest */
const split = (t: string) => { const [h, ...r] = t.split(/[:(;,]| - | — /); return { head: words(h), tail: words(r.join(' ')) } }
/** the problem a to-do is about: its ref, an id in the title, a round reference ("R1137 C", "Round 1137 problem C",
 *  "Upsolve 1136 D", "Div 2 C from Round 1137", "problem C of Round 1137") — "[?]" is an unknown one */
const probKey = (t: Todo) => {
  if (t.pid) return t.pid
  const k = (cid: string, ix: string) => `r${cid}${ix.toUpperCase()}`
  // "Round 1137C" is the round number, like "R1137 C" (not a problem id): the round-prefixed form first
  const rr = t.title.match(/\bR(?:ound)?\s?#?(\d{3,4})\s?([A-H]\d?)\b/); if (rr) return k(rr[1], rr[2])
  const m = t.title.match(/\b(\d{3,4}[A-Z]\d?)\b/); if (m) return m[1]
  const r = t.title.match(/\b(?:R(?:ound)?\s?#?)?(\d{3,4})\s*(?:\(?\s*Div\.?\s?\d\s*\)?\s*)?(?:problem\s+|task\s+)?([A-H]\d?)\b/i)
  if (r && (/^[A-H]/.test(r[2]) || /problem|task/i.test(r[0]))) return k(r[1], r[2])
  const p = t.title.match(/\b(?:problem|task|Div\.?\s?\d)\s+([A-H]\d?)\b.{0,40}?\b(?:Round|R|contest)\s?#?(\d{3,4})\b/i); if (p) return k(p[2], p[1])
  const q = t.title.match(/\b(?:Round|R|contest)\s?#?(\d{3,4})\b.{0,40}?\b(?:problem|task)\s+([A-H]\d?)\b/i); if (q) return k(q[1], q[2])
  return t.title.includes('[?]') ? '?' : ''
}
const jacc = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); let i = 0; for (const x of A) if (B.has(x)) i++; return i / Math.max(1, A.size + B.size - i) }
const letters = (w: string[]) => w.filter(x => /^prob[a-h]\d?$/.test(x)).sort().join()
const alike = (a: string[], b: string[]) => a.slice(0, 6).join(' ') === b.slice(0, 6).join(' ') || jacc(a, b) >= 0.6
/** same assignment: same kind, and the same problem, the same resource, the same slot (due + start) or a similar title.
 *  Two different problems / resources / problem letters are never the same assignment, however alike the wording
 *  ("Upsolve X (30-min timebox…)", "Upsolve Round 1136 problem D" vs "… problem E", "USACO Silver: Prefix Sums" vs ": Binary Search") */
export function sameTodo(a: Todo, b: Todo) {
  if (a.kind.toLowerCase() !== b.kind.toLowerCase()) return false
  const ka = probKey(a), kb = probKey(b)
  if (ka && kb) return ka === kb
  const ra = a.ref && RES_BY_ID.has(a.ref) ? a.ref : '', rb = b.ref && RES_BY_ID.has(b.ref) ? b.ref : ''
  if (ra && rb) return ra === rb
  // the slot only says "same thing" when neither names a problem or a resource (a read and an upsolve can share 08:00)
  if (!ka && !kb && !ra && !rb && a.start && a.start === b.start && a.due === b.due) return true
  const A = split(a.title), B = split(b.title), wa = [...A.head, ...A.tail], wb = [...B.head, ...B.tail]
  if (letters(wa) && letters(wb) && letters(wa) !== letters(wb)) return false
  // a long enough head decides on its own — unless both tails are short subtitles naming different things (": Prefix Sums" vs
  // ": Binary Search", "(point update, range sum)" vs "(lazy propagation, range add)"); a long tail is just elaboration
  const sub = A.tail.length && B.tail.length && A.tail.length <= 4 && B.tail.length <= 4
  if (A.head.length >= 4 && B.head.length >= 4 && alike(A.head, B.head)) return !(sub && jacc(A.tail, B.tail) < 0.5)
  return alike(wa, wb)
}
/** fold incoming to-dos into the open ones: a duplicate refreshes the existing record (fresh/seen/why), the rest are added */
export function mergeTodos(have: Record<string, Todo>, incoming: Todo[], now = Date.now()) {
  const open = Object.values(have).filter(isOpen).sort((a, b) => a.at - b.at)
  const add: Record<string, Todo> = {}, refresh: Record<string, Partial<Todo>> = {}, merged: { title: string; into: string }[] = []
  for (const t of incoming) {
    if (have[t.id]) continue // the same turn applied twice
    const hit = open.find(x => sameTodo(x, t)) || Object.values(add).find(x => sameTodo(x, t))
    if (!hit) { add[t.id] = t; continue }
    if (add[hit.id]) { add[hit.id] = { ...hit, seen: (hit.seen || 1) + 1 }; continue }
    const r = refresh[hit.id] || {}
    refresh[hit.id] = { fresh: now, seen: (r.seen || hit.seen || 1) + 1, why: t.why || hit.why, ...(!hit.start && t.start ? { start: t.start } : {}), u: now }
    merged.push({ title: t.title, into: hit.id })
  }
  return { add, refresh, merged }
}
/** a to-do's clock: 3 days from when it was last issued, or from its due day if that is later */
export const todoExpiresAt = (t: Todo) => Math.max(t.fresh || t.at, keyToDate(t.due).getTime()) + TODO_TTL_DAYS * 864e5

/** the to-do bookkeeping, idempotent (runs on start, on every open, every 5 min, after each coach answer):
 *  1. a coach task ticked off in Today completes its to-do; 2. duplicates already in the list (from before this rule, or
 *  issued on two devices) collapse into the earliest one; 3. stale ones expire; 4. a collapsed / expired one leaves Today
 *  unless it is done or was started; 5. Today is topped up to TODAY_CAP open coach to-dos (due today or earlier, earliest
 *  first) — future-dated ones arrive on their day. Exam season: at most 1 automatic add a day. Returns what changed. */
export function reconcileTodos(now = Date.now()) {
  const s = getState(), cp = s.cp, k = dateKey(), all = cp.coachTodos as Record<string, Todo>
  const doneIn = new Set<string>(), dismissed = new Set<string>()
  for (const d of Object.values(s.days)) {
    for (const t of d.tasks) if (t.k === 'coach' && t.done && all[t.id]) doneIn.add(t.id)
    for (const id in d.del) if (all[id]) dismissed.add(id)
  }
  const patch: Record<string, Partial<Todo>> = {}
  for (const t of Object.values(all)) if (!t.done && doneIn.has(t.id)) patch[t.id] = { done: true, st: undefined, u: now }
  const open = Object.values(all).filter(t => isOpen(t) && !patch[t.id]).sort((a, b) => a.at - b.at)
  const today = s.days[k], inToday = new Set((today?.tasks || []).map(t => t.id))
  // keeper of a duplicate group: the one already in Today, else the earliest
  const keep: Todo[] = []
  for (const t of [...open.filter(t => inToday.has(t.id)), ...open.filter(t => !inToday.has(t.id))]) {
    const hit = keep.find(x => sameTodo(x, t))
    if (hit) patch[t.id] = { st: 'dup', dupOf: hit.id, u: now }
    else keep.push(t)
  }
  for (const t of keep) if (now > todoExpiresAt(t)) patch[t.id] = { st: 'expired', u: now }
  // leaving Today: not done, never started (a span on it = started)
  const started = new Set(spansOf(today).map(x => x.taskId).filter(Boolean) as string[])
  const drop = (today?.tasks || []).filter(t => patch[t.id]?.st && !t.done && !started.has(t.id)).map(t => t.id)
  if (Object.keys(patch).length) setCp(c => ({ ...c, coachTodos: { ...c.coachTodos, ...Object.fromEntries(Object.entries(patch).filter(([id]) => c.coachTodos[id]).map(([id, p]) => [id, { ...c.coachTodos[id], ...p }])) } }))
  if (drop.length) patchToday(d => ({ ...d, tasks: d.tasks.filter(t => !drop.includes(t.id)), del: { ...d.del, ...Object.fromEntries(drop.map(id => [id, now])) } }))
  // top up Today
  const added: string[] = []
  if (s.settings.coachAutoAdd !== false && today) {
    const live = keep.filter(t => !patch[t.id])
    const openInToday = (getState().days[k]?.tasks || []).filter(t => t.k === 'coach' && !t.done && all[t.id] && !all[t.id].done).length // a to-do done from the Coach tab frees its slot
    const exam = targetFor(k).kind === 'exam'
    let room = Math.min(TODAY_CAP - openInToday, exam ? 1 - autoAddsOn(k) : Infinity)
    for (const t of live.sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : a.at - b.at)) {
      if (room <= 0) break
      if (t.due > k || inToday.has(t.id) || dismissed.has(t.id)) continue
      addTodoToToday(t.id); fire(`tadd:${k}:${t.id}`); added.push(t.id); room--
    }
  }
  return { done: Object.entries(patch).filter(([, p]) => p.done).length, dup: Object.values(patch).filter(p => p.st === 'dup').length, expired: Object.values(patch).filter(p => p.st === 'expired').length, dropped: drop.length, added: added.length }
}
const autoAddsOn = (k: string) => Object.keys(getState().cp.triggers).filter(x => x.startsWith(`tadd:${k}:`)).length

const TODO_CAT: Record<string, Task['cat']> = { read: 'study', implement: 'deep', review_editorial: 'study', study_solution: 'study', template: 'deep', reflect: 'admin', upsolve: 'deep', resolve: 'deep', speed_drill: 'deep', rest: 'break' }
/** put a to-do into Today (the button, or the auto top-up); its start time comes from the title */
export function addTodoToToday(id: string) {
  const t = getState().cp.coachTodos[id] as Todo | undefined; if (!t || t.done) return
  const k = dateKey(), s = getState()
  if (!s.days[k] || s.days[k].tasks.some(x => x.id === id)) return
  const task: Task = { id, title: t.title, start: t.start || null, dur: t.minutes, cat: TODO_CAT[t.kind] || 'study', done: false, u: Date.now(), k: 'coach', ref: t.ref, note: t.why }
  setCp(c => ({ ...c, coachTodos: { ...c.coachTodos, [id]: { ...c.coachTodos[id], added: true, u: Date.now() } } }))
  addTaskToday(task)
}
export function todoDone(id: string, learned?: string) {
  setCp(c => c.coachTodos[id] ? { ...c, coachTodos: { ...c.coachTodos, [id]: { ...c.coachTodos[id], done: true, st: undefined, learned: learned?.slice(0, 500), u: Date.now() } as Todo } } : c)
  // its Today task is the same work: tick it too (Today must not keep an open task for work the coach shows as done)
  if (getState().days[dateKey()]?.tasks.some(t => t.id === id && !t.done)) completeTask(id)
  reconcileTodos() // a slot in Today opened up
}

/* ───────── automatic touchpoints ───────── */
function fired(key: string) { return !!getState().cp.triggers[key] }
function fire(key: string) { setCp(c => ({ ...c, triggers: { ...c.triggers, [key]: Date.now() } })) }
const isoWeek = (d = new Date()) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - y.getTime()) / 864e5 + 1) / 7)}` }
const autoToday = () => Object.keys(getState().cp.triggers).filter(k => k.startsWith('auto:' + dateKey())).length
function auto(key: string, kind: CoachKind, extra: Record<string, unknown> = {}, message = '') {
  if (fired(key) || !getSyncCfg() || autoToday() >= 6) return
  fire(key); fire(`auto:${dateKey()}:${key}`)
  // deterministic turn id: if the other device fires the same trigger, the server runs it once
  askCoach(kind, message, extra, ('auto-' + key.replace(/[^A-Za-z0-9-]/g, '-')).slice(0, 64).padEnd(8, '0'))
}
export function checkTriggers() {
  const s = getState(), now = new Date(), k = dateKey(), u = getCfUser()
  if (!s.cp.handle) return
  const exam = targetFor(k, s).kind === 'exam'
  // weekly review: on Sunday, or at the first open after it (keyed by that Sunday's week) — not in exam season
  const lastSunday = addDaysDate(now, -now.getDay())
  const active = Object.keys(s.cp.sessions).length > 0
  if (active && !exam) auto('weekly:' + isoWeek(lastSunday), 'weekly')
  const didToday = Object.values(s.cp.sessions).some(x => x.date === k) || Object.values(s.cp.events).some(e => dateKey(new Date(e.at)) === k)
  if (exam) {
    // exam season: ONE debrief a day covering every block — after a 90-min pause since the last block ended, or the nightly one
    const lastEnd = s.cp.triggers[`xsess:${k}`] || 0
    if (lastEnd && (Date.now() - lastEnd >= 90 * 60000 || now.getHours() >= 21)) auto('xdebrief:' + k, 'debrief', { reason: 'exam season: one batched debrief of today\'s practice' })
    else if (!lastEnd && now.getHours() >= 21 && didToday) auto('xdebrief:' + k, 'debrief', { reason: 'exam season: nightly debrief of the whole day' })
  }
  // nightly debrief at the first open after 21:00
  else if (now.getHours() >= 21 && didToday) auto('nightly:' + k, 'debrief', { reason: 'nightly debrief of the whole day' })
  // post-contest review: a new rated result
  const last = u?.rated?.[u.rated.length - 1]
  if (last && Date.now() - last.at < 3 * 864e5) auto('post:' + last.cid, 'post_contest', { contest: { id: last.cid, name: last.name, rank: last.rank, old: last.old, new: last.new } })
  // pre-contest brief: a contest you said you're taking starts within 3h
  const t = getState().cp.triggers
  for (const c of getContests()) if ((t['in:' + c.id] || 0) > (t['out:' + c.id] || 0) && c.start - Date.now() < 3 * 36e5 && c.start > Date.now()) auto('pre:' + c.id, 'pre_contest', { contest: { id: c.id, name: c.name, div: divOf(c.name), starts_in_min: Math.round((c.start - Date.now()) / 60000), duration_min: Math.round(c.dur / 60) } })
}
const addDaysDate = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
export const takingContest = (cid: number) => fire('in:' + cid)
export const isTaking = (cid: number) => fired('in:' + cid)

/* ───────── copy-paste fallback for claude.ai ───────── */
export function coachPrompt() {
  const { data } = buildCoachData('report', {}, { full: true })
  return `You are my competitive-programming coach (Codeforces). Using ALL of my training data below, tell me where I really stand, my weaknesses with evidence, exactly what to do today (including non-solving work: what to read, implement, review), and a plan for this week. Only reference problem ids that appear in the data.\n\n${JSON.stringify(data)}`
}

/** a block just ended: debrief it now — in exam season only note it; checkTriggers batches the day into one debrief */
export function sessionEnded(kind: 'practice' | 'mock', mins: number, id: string) {
  if (targetFor().kind === 'exam') { fire(`xsess:${dateKey()}`); return }
  auto('debrief-' + id, 'debrief', { reason: `${kind === 'mock' ? 'mock round' : 'practice block'} just finished (${fmtDur(Math.round(mins))})` })
}

/* ───────── wiring ───────── */
export function startCoach() {
  onResult('coach', applyCoach, onCoachError)
  setOnSessionEnded(sessionEnded)
  const known = (id: string) => !!getState().cp.coachLog[id]?.out
  const lastAt = () => Math.max(0, ...Object.values(getState().cp.coachLog).filter(m => m.out).map(m => m.at))
  // only after this device has pulled the latest state: stale state would re-apply old answers or fire stale triggers
  // to-do bookkeeping (dedupe, expiry, the Today top-up — also how a future-dated to-do arrives on its day) runs after the
  // first pull and on every open / every 5 min, so a day change is picked up without a reload
  const tidy = () => { try { reconcileTodos() } catch (e) { console.error('coach todos', e) } }
  void firstSync.then(() => { tidy(); void catchUp('coach', lastAt(), known); checkTriggers() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow().then(() => { tidy(); void catchUp('coach', lastAt(), known); checkTriggers() }) })
  setInterval(() => { tidy(); if (getSyncStatus().state === 'ok') checkTriggers() }, 5 * 60000)
}
