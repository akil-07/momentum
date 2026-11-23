import { activeMin, addDays, dateKey, liveSpans, nowMin, toMin, type CpEvent, type State, workMin } from './store'
import { brkOverlap, practiceMinutes } from './cptime'
import { computeSkill, getCfUser, getProbMap, isContestRec, isVoidTest, tierOf, timeFor } from './cf'
import { LIGHT, NORMAL_CP, targetFor } from './season'

/* ═════════ discipline score + progress rates (deterministic) ═════════ */

/** a normal day's practice target; the real one is per day: targetFor(date).cpMin (exam weeks are lighter) */
export const PRACTICE_TARGET = NORMAL_CP
export interface DayScore { date: string; practice: number; mock: boolean; planned: number; score: number; cpMin: number; D: number }

/** the day's weights. Normal day: 60% practice vs its target, 25% the mock, 15% your other planned tasks (by minutes).
 *  Exam day: the planned study is the day's real work, so it carries 70% (or 55% next to a mock) and the light CP target 30% —
 *  a full study day with the CP target met ≈ 1.0, nothing done ≈ 0. Other seasons without a mock move the mock's share to practice. */
export function dayWeights(t: { kind: string; mock: boolean }) {
  if (t.kind === 'exam') { const m = t.mock ? 0.15 : 0; return { practice: 0.3, mock: m, planned: 0.7 - m } }
  const m = t.mock ? 0.25 : 0
  return { practice: 0.85 - m, mock: m, planned: 0.15 }
}
/** practice minutes of a day, without the part of a session that ran inside a rated round you took (a free-solve timer left
 *  running through the round: the round is that day's mock, its time is not practice as well) */
export function dayPractice(s: State, d: string) {
  const sessions = Object.values(s.cp.sessions || {})
  const rounds = Object.values(s.cp.tests).filter(t => t.date === d && t.finishedAt && isContestRec(t) && !isVoidTest(t, s.cp))
  let cut = 0
  for (const x of sessions) {
    if (x.date !== d || x.kind === 'mock' || !rounds.length) continue
    const end = x.endedAt || x.startedAt + x.mins * 60000
    let ov = 0
    for (const r of rounds) { const lo = Math.max(x.startedAt, r.startedAt), hi = Math.min(end, r.finishedAt!); if (hi > lo) ov += (hi - lo - brkOverlap(x.brks, lo, hi)) / 60000 }
    cut += Math.min(x.mins, Math.max(0, Math.round(ov)))
  }
  return Math.max(0, practiceMinutes(sessions, d) - cut)
}
/** today/any day, scored against that day's target (targetFor): a season set later rescores its past days too.
 *  A light day (the plan was lightened by the morning check-in) is measured against the lightened target, as the trainer shows it.
 *  A season with no CP target (cpMin 0) moves the practice share to the planned work. */
export function dayScore(s: State, d: string) {
  const tgt = targetFor(d, s), w0 = dayWeights(tgt)
  const cpMin = Math.round(tgt.cpMin * ((s.cp.plans?.[d] as { light?: string } | undefined)?.light ? LIGHT : 1))
  const w = cpMin > 0 ? w0 : { practice: 0, mock: w0.mock, planned: w0.planned + w0.practice }
  const sessions = Object.values(s.cp.sessions || {})
  const practice = dayPractice(s, d)
  const day = s.days[d]
  // a voided / discarded mock is no mock: not its test, not its logged 'mock:<id>' session, not a block it ticked
  const voided = Object.values(s.cp.tests).filter(t => isVoidTest(t, s.cp))
  const voidIds = new Set(voided.map(t => 'mock:' + t.id)), voidBlocks = new Set(voided.map(t => (t as { blockId?: string }).blockId).filter(Boolean))
  // a real-round mock only counts once the virtual participation actually started; a live CF round (or its ticked 'CF: …' task) is the day's mock
  const mock = Object.values(s.cp.tests).some(t => t.date === d && t.finishedAt && (!t.real || t.real.vStart) && !isVoidTest(t, s.cp)) || sessions.some(x => x.date === d && x.kind === 'mock' && !voidIds.has(x.id))
    || (day?.tasks || []).some(t => t.k === 'cp_mock' && t.done && !voidBlocks.has(t.id)) || (getCfUser()?.list || []).some(x => x.pt === 'CONTESTANT' && dateKey(new Date(x.at)) === d)
  const other = (day?.tasks || []).filter(t => t.k !== 'cp_practice' && t.k !== 'cp_mock' && t.cat !== 'break')
  const tot = other.reduce((a, t) => a + t.dur, 0), done = other.filter(t => t.done).reduce((a, t) => a + t.dur, 0)
  const pFrac = cpMin > 0 ? Math.min(1, practice / cpMin) : 0
  // nothing planned: a normal day gives the small share free; an exam day (where it is most of the score) scores the practice
  // instead — and with no CP target either there is nothing done to score (never a free 1.0)
  const planned = tot ? done / tot : !day ? 0 : tgt.kind === 'exam' ? pFrac : 1
  const score = w.practice * pFrac + w.mock * (mock ? 1 : 0) + w.planned * planned
  return { practice, mock, planned, score, cpMin }
}

/** the first day you actually used the app: a ticked task, a timer or logged time, a CP session, attempt or mock.
 *  Days before it (the routine template that was sitting there before you started) never count against you. */
export function firstActiveDay(s: State): string | null {
  const ds: string[] = []
  for (const [k, d] of Object.entries(s.days)) if (d.tasks.some(t => t.done) || liveSpans(d).length) ds.push(k)
  for (const x of Object.values(s.cp.sessions || {})) ds.push(x.date)
  for (const a of Object.values(s.cp.attempts)) ds.push(dateKey(new Date(a.at)))
  for (const t of Object.values(s.cp.tests)) ds.push(t.date)
  return ds.length ? ds.sort()[0] : null
}

/** how much of today's planned day is behind you (0 → 1): the share of today's timed, non-break task minutes whose time has
 *  passed; with nothing timed, the share of 06:00–23:00 gone. The live score expects that share of the bar, no more. */
export function dayPace(s: State, d = dateKey(), now = nowMin()): number {
  const ts = (s.days[d]?.tasks || []).filter(t => t.start && t.cat !== 'break')
  const tot = ts.reduce((a, t) => a + t.dur, 0)
  if (!tot) return Math.max(0, Math.min(1, (now - 360) / (23 * 60 - 360)))
  return ts.reduce((a, t) => a + Math.max(0, Math.min(t.dur, now - toMin(t.start!))), 0) / tot
}

/** D starts at 50 on your first real day; each finished day moves it by step(dayScore − bar): ×30 above the bar, ×12 below.
 *  Doing everything = +4.5/day; skipping the work still drops it fast (an empty day −10). `live` adds today so far, against the part of the bar today's clock has reached — so it
 *  moves as you work, doesn't drop at 6 am for work that isn't due yet, and at midnight equals the finished-day value. */
export const GAIN = 30, LOSS = 12
const step = (x: number) => x * (x >= 0 ? GAIN : LOSS)
export function discipline(s: State, now = new Date()) {
  const bar = (s.settings.disciplineBar ?? 85) / 100
  const today = dateKey(now), first = firstActiveDay(s)
  const hist: DayScore[] = []
  let D = 50
  if (first) {
    for (let k = first; k < today; k = addDays(k, 1)) {
      const r = s.days[k] ? dayScore(s, k) : { practice: 0, mock: false, planned: 0, score: 0, cpMin: targetFor(k, s).cpMin }
      D = Math.max(0, Math.min(100, D + step(r.score - bar)))
      hist.push({ date: k, ...r, D: Math.round(D * 10) / 10 })
    }
  }
  const t = dayScore(s, today)
  const projected = Math.max(0, Math.min(100, D + step(t.score - bar)))
  const pace = dayPace(s, today, nowMin(now))
  // capped at a perfect day's gain, so being ahead of the clock never shows more than the day can end on
  const live = Math.max(0, Math.min(100, D + Math.min(step(t.score - bar * pace), step(1 - bar))))
  return {
    /** after your finished days */ score: Math.round(D), /** including today so far */ live: Math.round(live), liveDelta: Math.round((live - D) * 10) / 10, pace, today: { ...t, score: Math.round(t.score * 100) / 100 }, projected: Math.round(projected),
    yesterdayDelta: hist.length >= 2 ? Math.round((hist[hist.length - 1].D - hist[hist.length - 2].D) * 10) / 10 : hist.length ? Math.round((hist[0].D - 50) * 10) / 10 : 0,
    history: hist.slice(-90),
  }
}

/* ───────── level history + rate of progress ───────── */
const cache = new Map<string, number>()
/** your last `n` TRAINING days, oldest first (a day counts if you submitted on Codeforces, solved or attempted a problem
 *  in the app, ran a CP session or finished any work) — a break of a week or a month doesn't empty your stats; today is always last */
export function activeDates(s: State, n = 30): string[] {
  const today = dateKey(), act = new Set<string>()
  for (const x of getCfUser()?.list || []) act.add(dateKey(new Date(x.at)))
  for (const a of Object.values(s.cp.attempts)) act.add(dateKey(new Date(a.at)))
  for (const x of Object.values(s.cp.sessions || {})) act.add(x.date)
  for (const [d, day] of Object.entries(s.days)) if (workMin(day) > 0) act.add(d)
  return [...[...act].filter(d => d < today).sort().slice(-(n - 1)), today]
}
/** practice level on each of your last `days` training days (uses stored snapshots, else replays the skill model as of that day) */
export function levelSeries(s: State, days = 30) {
  const out: { date: string; level: number; cf: number }[] = []
  const u = getCfUser(), probs = getProbMap()
  const nEv = Object.keys(s.cp.events).length + Object.keys(s.cp.attempts).length
  for (const d of activeDates(s, days)) {
    const snap = s.cp.daily?.[d]
    let level = snap?.level
    if (level === undefined) {
      const key = `${d}|${nEv}|${u?.lastSubId || 0}|${s.cp.calib}`
      if (cache.size > 300) cache.clear()
      if (!cache.has(key)) { const end = new Date(d + 'T23:59:59').getTime(); cache.set(key, computeSkill(s.cp, u, probs, end).level) }
      level = cache.get(key)!
    }
    const rows = (u?.rated || []).filter(r => r.at <= new Date(d + 'T23:59:59').getTime())
    out.push({ date: d, level, cf: snap?.cf ?? (rows.length ? rows[rows.length - 1].new : 0) })
  }
  return out
}
function slope(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 2) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2 }
  return den ? num / den : 0
}
/** rating gained per TRAINING day and per hour of CP training, from the days you actually have (one is enough):
 *  the trend starts at your level just before your first training day in the window (your starting estimate on day one),
 *  so day one already shows today's change; later it is a regression over up to your last 30 training days */
export function progressRates(s: State) {
  const series = levelSeries(s, 30)
  const sessions = Object.values(s.cp.sessions || {})
  const active = s.cp.active, liveMin = active && active.kind === 'practice' ? activeMin(active) : 0
  // where you stood before the window starts (cached like the series)
  const first = series[0]?.date || dateKey(), u = getCfUser()
  const bkey = `base|${first}|${Object.keys(s.cp.attempts).length}|${u?.lastSubId || 0}|${s.cp.calib}`
  if (cache.size > 300) cache.clear()
  if (!cache.has(bkey)) cache.set(bkey, computeSkill(s.cp, u, getProbMap(), new Date(first + 'T00:00:00').getTime() - 1).level)
  const base = cache.get(bkey)!
  let cum = 0
  const pts = [{ level: base, hours: 0 }, ...series.map((p, i) => {
    cum += sessions.filter(x => x.date === p.date).reduce((a, x) => a + x.mins, 0) / 60 + (i === series.length - 1 ? liveMin / 60 : 0)
    return { level: p.level, hours: cum }
  })]
  // per day: the last n training days (plus the starting point while you have fewer than n)
  const per = (n: number) => { const sl = pts.slice(-(n + 1)); return slope(sl.map((_, i) => i), sl.map(p => p.level)) }
  const perDay14 = per(14), perDay30 = per(30)
  const perHour = cum > 0.05 ? slope(pts.map(p => p.hours), pts.map(p => p.level)) : 0
  const cur = series[series.length - 1]?.level || 0, t = tierOf(cur)
  const eta = t.next && perDay14 > 0.5 ? Math.ceil((t.next - cur) / perDay14) : null
  return {
    per_day_14: Math.round(perDay14 * 10) / 10, per_day_30: Math.round(perDay30 * 10) / 10,
    per_hour: Math.round(perHour * 10) / 10, hours_30d: Math.round(cum * 10) / 10,
    next_tier: t.nextName || null, eta_days: eta, level: cur,
    /** how much data the rates stand on */ days: series.length, start_level: base, change: cur - base, has_hours: cum > 0.05,
  }
}

/* ───────── peak performance: when do you think best? (hour of day, minutes into a session, weekday) ───────── */
export interface Resolution { pid: string; sess: string; date: string; t0: number; hour: number; dow: number; into: number; solved: boolean; hint: number; mins: number | null; box: number; clean: boolean; ratio: number | null }
export interface PeakCell { label: string; n: number; clean: number; speed: number | null }
export const FATIGUE_BUCKETS = [[0, 30, '0-30'], [30, 60, '30-60'], [60, 90, '60-90'], [90, 120, '90-120'], [120, Infinity, '120+']] as const
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const median = (xs: number[]) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 }
const r2 = (v: number) => Math.round(v * 100) / 100
const hh = (h: number) => String(((h % 24) + 24) % 24).padStart(2, '0')

/** every problem served in a finished practice/drill/sprint session (not mocks, not re-solves/upsolves): when it started, how it went */
export function resolutions(s: State): Resolution[] {
  const byPid = new Map<string, CpEvent[]>()
  for (const e of Object.values(s.cp.events || {})) { const a = byPid.get(e.pid); a ? a.push(e) : byPid.set(e.pid, [e]) }
  const out: Resolution[] = [], probs = getProbMap()
  const sess = Object.values(s.cp.sessions || {}).filter(x => x.kind !== 'mock' && !(x.spec && (x.spec.mode === 'resolve' || x.spec.mode === 'upsolve'))).sort((a, b) => a.startedAt - b.startedAt)
  for (const x of sess) {
    const lo = x.startedAt - 60e3, hi = (x.endedAt || x.startedAt + x.mins * 60e3) + 5 * 60e3
    const level = s.cp.daily?.[x.date]?.level || s.cp.plans?.[x.date]?.level || 0
    let prevEnd = x.startedAt
    for (const pid of x.pids) {
      const evs = (byPid.get(pid) || []).filter(e => e.sess ? e.sess === x.id : e.at >= lo && e.at <= hi).sort((a, b) => a.at - b.at)
      const open = evs.find(e => e.k === 'open')?.at
      const t0 = Math.max(x.startedAt, open ?? prevEnd)
      const acE = evs.find(e => e.k === 'ac' || (e.k === 'sub' && e.v === 'OK'))
      const solved = x.solved.includes(pid) || !!acE
      const hint = evs.reduce((m, e) => Math.max(m, e.k === 'hint' ? e.hl || 0 : e.k === 'editorial' ? 3 : 0), 0)
      const r = probs.get(pid)?.r || level || 1200
      const box = Math.round(timeFor(r, level || r) * (x.spec?.timebox || 1))
      const mins = solved && acE ? Math.max(0, (acE.at - t0 - brkOverlap(x.brks, t0, acE.at)) / 60000) : null // automatic breaks don't count
      const clean = solved && hint < 2 && (mins === null || mins <= box)
      const d = new Date(t0)
      out.push({ pid, sess: x.id, date: x.date, t0, hour: d.getHours(), dow: (d.getDay() + 6) % 7, into: (t0 - x.startedAt) / 60000, solved, hint, mins: mins === null ? null : r2(mins), box, clean, ratio: mins === null ? null : r2(mins / box) })
      const end = acE?.at ?? evs.find(e => e.k === 'giveup' || e.k === 'skip')?.at
      if (end) prevEnd = Math.max(prevEnd, end)
    }
  }
  return out
}
function agg(rows: Resolution[], label: string): PeakCell {
  const n = rows.length
  return { label, n, clean: n ? r2(rows.filter(r => r.clean).length / n) : 0, speed: median(rows.map(r => r.ratio).filter((v): v is number => v !== null)) }
}
/** Pearson r (null when < 3 points or no variance) */
export function pearson(xs: number[], ys: number[]) {
  const n = Math.min(xs.length, ys.length); if (n < 3) return null
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n, my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n
  let num = 0, vx = 0, vy = 0
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; vy += (ys[i] - my) ** 2 }
  return vx && vy ? r2(num / Math.sqrt(vx * vy)) : null
}
export interface EnergyPt { date: string; sleep?: number; energy?: number; clean: number; n: number }
/** daily clean rate vs the morning self-report; r only once there are ≥ 7 answered days with practice */
export function energyCorrelation(s: State, rows = resolutions(s)) {
  const byDay = new Map<string, Resolution[]>()
  for (const r of rows) { const a = byDay.get(r.date); a ? a.push(r) : byDay.set(r.date, [r]) }
  const reports = Object.entries(s.cp.energy || {}).filter(([, e]) => e.sleep !== undefined || e.energy !== undefined)
  const pts: EnergyPt[] = reports.filter(([d]) => byDay.has(d)).sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([d, e]) => { const rs = byDay.get(d)!; return { date: d, sleep: e.sleep, energy: e.energy, clean: r2(rs.filter(r => r.clean).length / rs.length), n: rs.length } })
  const corr = (k: 'sleep' | 'energy') => { const p = pts.filter(x => x[k] !== undefined); return p.length >= 7 ? pearson(p.map(x => x[k]!), p.map(x => x.clean)) : null }
  return { reports: reports.length, n: pts.length, sleep: corr('sleep'), energy: corr('energy'), pts }
}

export const PEAK_MIN_N = 6
const statCache = new WeakMap<object, ReturnType<typeof computePeak>>()
/** clean rate (AC, hint < 2, inside the time-box) + median speed (minutes to AC / time-box) by hour, minutes into the session, weekday */
export function peakStats(s: State) {
  const key = s.cp.sessions, hit = statCache.get(key)
  if (hit && hit.evRef === s.cp.events && hit.enRef === s.cp.energy) return hit
  const r = computePeak(s); statCache.set(key, r); return r
}
function computePeak(s: State) {
  const rows = resolutions(s)
  const hours = Array.from({ length: 24 }, (_, h) => agg(rows.filter(r => r.hour === h), hh(h)))
  const buckets = FATIGUE_BUCKETS.map(([a, b, l]) => agg(rows.filter(r => r.into >= a && r.into < b), l))
  const weekdays = WEEKDAYS.map((l, i) => agg(rows.filter(r => r.dow === i), l))
  // best contiguous 3-hour window (wraps past midnight). Each hour's clean rate is shrunk toward your overall rate
  // (thin hours count as "average", so a window isn't picked just for its empty edges), minus a little for slow solves.
  const all = agg(rows, ''), K = 5
  const shrunk = hours.map(c => (c.clean * c.n + all.clean * K) / (c.n + K))
  let peak: (PeakCell & { from: number; to: number; score: number }) | null = null
  for (let h = 0; h < 24; h++) {
    const w = rows.filter(r => (r.hour - h + 24) % 24 < 3), c = agg(w, `${hh(h)}-${hh(h + 3)}`)
    if (c.n < PEAK_MIN_N) continue
    const score = (shrunk[h] + shrunk[(h + 1) % 24] + shrunk[(h + 2) % 24]) / 3 - 0.1 * Math.min(2, c.speed ?? 1)
    if (!peak || score > peak.score + 1e-9) peak = { ...c, from: h, to: (h + 3) % 24, score: r2(score) }
  }
  // fatigue: the first later bucket whose clean rate is ≥ 15 pts under the first bucket (each needs n ≥ 3)
  let fatigue: { after: number; label: string; drop: number; first: number; at: number } | null = null
  const b0 = buckets[0]
  if (b0.n >= 3) for (let i = 1; i < buckets.length; i++) {
    const b = buckets[i]
    if (b.n >= 3 && b0.clean - b.clean >= 0.15 - 1e-9) { fatigue = { after: FATIGUE_BUCKETS[i][0], label: b.label, drop: Math.round((b0.clean - b.clean) * 100), first: b0.clean, at: b.clean }; break }
  }
  const wk = weekdays.filter(w => w.n >= 4).sort((a, b) => b.clean - a.clean || (a.speed ?? 9) - (b.speed ?? 9))[0]
  return { n: rows.length, hours, buckets, weekdays, peak, fatigue, bestWeekday: wk?.label || null, energy: energyCorrelation(s, rows), evRef: s.cp.events as object, enRef: s.cp.energy as object }
}
export type PeakStats = ReturnType<typeof peakStats>

/** compact context for the coach / planner: put the hardest block inside peak_hours */
export function peakSummary(s: State) {
  const p = peakStats(s)
  return {
    n: p.n, peak_hours: p.peak ? `${hh(p.peak.from)}-${hh(p.peak.from + 3)}` : null,
    peak_clean: p.peak ? p.peak.clean : null, fatigue_after_min: p.fatigue?.after ?? null,
    fatigue_drop_pts: p.fatigue?.drop ?? null, best_weekday: p.bestWeekday,
    energy: { reports: p.energy.reports, n: p.energy.n, sleep_r: p.energy.sleep, energy_r: p.energy.energy },
  }
}
