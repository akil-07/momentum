import { useMemo, useRef, useState, type ReactNode } from 'react'
import { addDays, dateKey, getState, useStore, workMin } from '../store'
import { discipline, levelSeries, PEAK_MIN_N, peakStats, progressRates, type PeakCell } from '../discipline'
import { addRival, MAX_RIVALS, ratingAt, removeRival, useRivals } from '../rivals'
import { Btn, Chips, useNow } from './common'
import { fmtDay, fmtHours } from '../ui'
import { WavyBar } from './shapes'
import '../styles/analytics.css'
import { eventsByPid, recurringErrors, timeline } from '../cptime'
import { getProb, TIERS, useCf } from '../cf'
import { Icon } from './fx'

/* ═════════ progress analytics: plain SVG, theme tokens, one axis, hover tooltips, table view ═════════ */

const W = 640, H = 220, PAD = { l: 44, r: 52, t: 14, b: 26 }
type Pt = { x: string; y: number | null }
interface Series { name: string; color: string; pts: Pt[]; w?: number; noEnd?: boolean }

function niceTicks(lo: number, hi: number, n = 4) {
  const span = Math.max(1, hi - lo), step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0
  // the axis always covers the data: the last tick is at or above hi (else the tallest bar / highest point pokes out of the plot)
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.max(a + step, Math.ceil(hi / step - 1e-9) * step), out: number[] = []
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 100) / 100)
  return out
}
/** tooltips name the day ("Mon 23 Nov"); axes keep the short MM-DD */
const dayTip = (x: string) => /^\d{4}-\d\d-\d\d$/.test(x) ? fmtDay(x) : x
const fmtTick = (v: number) => Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}K` : v.toLocaleString()

function Frame({ title, sub, legend, children, table }: { title: string; sub?: string; legend?: { name: string; color: string; kind: 'line' | 'rect' }[]; children: ReactNode; table: [string, ...string[]][] }) {
  const [showTable, setShowTable] = useState(false)
  return (
    <section className="card chart">
      <div className="card-head">
        <div><h3 className="title">{title}</h3>{sub && <div className="small muted">{sub}</div>}</div>
        <button type="button" className="linkish small pad" onClick={() => setShowTable(t => !t)}><Icon n={showTable ? 'show_chart' : 'table'} /> {showTable ? 'Chart' : 'Table'}</button>
      </div>
      {legend && legend.length > 1 && <div className="legend">{legend.map(l => <span key={l.name}><i className={l.kind} style={{ background: l.color }} />{l.name}</span>)}</div>}
      {showTable ? <div className="chart-table"><table><tbody>{table.map((r, i) => <tr key={i}>{r.map((c, j) => i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>)}</tr>)}</tbody></table></div> : children}
    </section>
  )
}

/** line chart with crosshair tooltip; optional horizontal reference line and shaded bands */
export function LineChart({ title, sub, series, yfmt = (v: number) => String(Math.round(v)), refLine, bands, yMin, yMax, xlab = (x: string) => x.slice(5), xname = 'Date', xtip = dayTip, after }: {
  title: string; sub?: string; series: Series[]; yfmt?: (v: number) => string
  refLine?: { y: number; label: string }; bands?: { from: number; to: number; label: string }[]; yMin?: number; yMax?: number
  xlab?: (x: string) => string; xname?: string; xtip?: (x: string) => string; after?: ReactNode
}) {
  const xs = series[0]?.pts.map(p => p.x) || []
  const ys = series.flatMap(s => s.pts.map(p => p.y)).filter((v): v is number => v !== null)
  if (refLine) ys.push(refLine.y)
  const lo0 = ys.length ? Math.min(...ys) : 0, hi0 = ys.length ? Math.max(...ys) : 1
  const pad = Math.max(10, (hi0 - lo0) * 0.12)
  const ticks = niceTicks(yMin ?? lo0 - pad, yMax ?? hi0 + pad)
  const lo = ticks[0], hi = ticks[ticks.length - 1]
  const X = (i: number) => PAD.l + (xs.length <= 1 ? 0.5 : i / (xs.length - 1)) * (W - PAD.l - PAD.r) // one day: in the middle, not on the axis
  const Y = (v: number) => PAD.t + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - PAD.t - PAD.b)
  const [hov, setHov] = useState<number | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const onMove = (e: React.PointerEvent) => {
    if (xs.length === 0) return
    const r = svg.current!.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (xs.length - 1))
    setHov(Math.max(0, Math.min(xs.length - 1, i)))
  }
  const path = (s: Series) => s.pts.map((p, i) => p.y === null ? null : `${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).reduce<string>((acc, c, i, arr) => c === null ? acc : acc + (i === 0 || arr[i - 1] === null ? 'M' : 'L') + c, '')
  if (!xs.length) return <Frame title={title} sub={sub} table={[[xname]]}><p className="muted small">No data yet — it fills in as you train.</p></Frame>
  const table: [string, ...string[]][] = [[xname, ...series.map(s => s.name)], ...xs.map((x, i) => [x, ...series.map(s => s.pts[i].y === null ? '—' : yfmt(s.pts[i].y!))] as [string, ...string[]])]
  return (
    <Frame title={title} sub={sub} legend={series.map(s => ({ name: s.name, color: s.color, kind: 'line' }))} table={table}>
      <div className="chart-box">
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="chart-svg" onPointerMove={onMove} onPointerLeave={() => setHov(null)} role="img" aria-label={title}>
          {bands?.filter(b => b.to > lo && b.from < hi).map(b => <g key={b.label}><rect x={PAD.l} width={W - PAD.l - PAD.r} y={Y(Math.min(hi, b.to))} height={Math.max(0, Y(Math.max(lo, b.from)) - Y(Math.min(hi, b.to)))} className="band" /><text x={PAD.l + 4} y={Y(Math.min(hi, b.to)) + 11} className="band-l">{b.label}</text></g>)}
          {ticks.map(t => <g key={t}><line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} className="grid" /><text x={PAD.l - 6} y={Y(t) + 4} className="tick" textAnchor="end">{fmtTick(t)}</text></g>)}
          {xs.map((x, i) => (i === 0 || i === xs.length - 1 || i % Math.ceil(xs.length / 5) === 0) && <text key={x} x={X(i)} y={H - 6} className="tick" textAnchor="middle">{xlab(x)}</text>)}
          {refLine && <g><line x1={PAD.l} x2={W - PAD.r} y1={Y(refLine.y)} y2={Y(refLine.y)} className="ref" /><text x={W - PAD.r + 4} y={Y(refLine.y) + 4} className="tick">{refLine.label}</text></g>}
          {series.map(s => <path key={s.name} d={path(s)} fill="none" stroke={s.color} strokeWidth={s.w || 2} strokeLinejoin="round" strokeLinecap="round" />)}
          {series.map(s => { if (s.noEnd) return null; const li = s.pts.map(p => p.y).lastIndexOf(s.pts.filter(p => p.y !== null).slice(-1)[0]?.y ?? null); if (li < 0 || s.pts[li].y === null) return null; return <g key={s.name + 'e'}><circle cx={X(li)} cy={Y(s.pts[li].y!)} r={4} fill={s.color} className="dot" /><text x={X(li) + 7} y={Y(s.pts[li].y!) + 4} className="end-l">{yfmt(s.pts[li].y!)}</text></g> })}
          {hov !== null && <g><line x1={X(hov)} x2={X(hov)} y1={PAD.t} y2={H - PAD.b} className="cross" />{series.map(s => s.pts[hov].y !== null && <circle key={s.name} cx={X(hov)} cy={Y(s.pts[hov].y!)} r={4} fill={s.color} className="dot" />)}</g>}
        </svg>
        {hov !== null && <div className="tip" style={{ left: `${(X(hov) / W) * 100}%` }}>
          <div className="tip-x">{xtip(xs[hov])}</div>
          {series.filter(s => s.pts[hov].y !== null || series.length < 4).map(s => <div key={s.name} className="tip-r"><i style={{ background: s.color }} /><b>{s.pts[hov].y === null ? '—' : yfmt(s.pts[hov].y!)}</b><span>{s.name}</span></div>)}
        </div>}
      </div>
      {after}
    </Frame>
  )
}

/** columns over time (one series) with an optional target line; each column is its own hover target */
export function Columns({ title, sub, data, yfmt = (v: number) => String(v), target, color = 'var(--primary)' }: {
  title: string; sub?: string; data: { x: string; y: number }[]; yfmt?: (v: number) => string; target?: { y: number; label: string }; color?: string
}) {
  const hi0 = Math.max(1, ...data.map(d => d.y), target?.y || 0)
  const ticks = niceTicks(0, hi0 * 1.1), hi = ticks[ticks.length - 1]
  const slot = (W - PAD.l - PAD.r) / Math.max(1, data.length), bw = Math.min(24, slot - 2)
  const Y = (v: number) => PAD.t + (1 - v / hi) * (H - PAD.t - PAD.b), base = Y(0)
  const [hov, setHov] = useState<number | null>(null)
  const table: [string, ...string[]][] = [['Date', title], ...data.map(d => [d.x, yfmt(d.y)] as [string, string])]
  if (!data.some(d => d.y > 0)) return <Frame title={title} sub={sub} table={table}><p className="muted small chart-empty">No data yet — it fills in as you work.</p></Frame>
  return (
    <Frame title={title} sub={sub} table={table}>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" onPointerLeave={() => setHov(null)} role="img" aria-label={title}>
          {ticks.map(t => <g key={t}><line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} className="grid" /><text x={PAD.l - 6} y={Y(t) + 4} className="tick" textAnchor="end">{fmtTick(t)}</text></g>)}
          {data.map((d, i) => {
            const cx = PAD.l + slot * i + slot / 2, h = Math.max(0, base - Y(d.y)), r = Math.min(4, h / 2)
            const x0 = cx - bw / 2
            return <g key={d.x} onPointerEnter={() => setHov(i)} onFocus={() => setHov(i)} tabIndex={0}>
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
              {h > 0 && <path d={`M${x0},${base} L${x0},${base - h + r} Q${x0},${base - h} ${x0 + r},${base - h} L${x0 + bw - r},${base - h} Q${x0 + bw},${base - h} ${x0 + bw},${base - h + r} L${x0 + bw},${base} Z`} fill={color} opacity={hov === null || hov === i ? 1 : 0.55} />}
              {(i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 6) === 0) && <text x={cx} y={H - 6} className="tick" textAnchor="middle">{d.x.slice(5)}</text>}
            </g>
          })}
          {target && <g><line x1={PAD.l} x2={W - PAD.r} y1={Y(target.y)} y2={Y(target.y)} className="ref" /><text x={W - PAD.r + 4} y={Y(target.y) + 4} className="tick">{target.label}</text></g>}
        </svg>
        {hov !== null && <div className="tip" style={{ left: `${((PAD.l + slot * hov + slot / 2) / W) * 100}%` }}>
          <div className="tip-x">{dayTip(data[hov].x)}</div><div className="tip-r"><b>{yfmt(data[hov].y)}</b></div>
        </div>}
      </div>
    </Frame>
  )
}

/** ranked / ordered horizontal bars, value at the tip */
export function HBars({ title, sub, rows, fmt = (v: number) => String(v), color = 'var(--primary)' }: { title: string; sub?: string; rows: { label: string; value: number; note?: string }[]; fmt?: (v: number) => string; color?: string }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  const [open, setOpen] = useState<string | null>(null) // tap / focus a row: the full label and note (title= alone is hover-only)
  const table: [string, ...string[]][] = [['', 'Value'], ...rows.map(r => [r.label, fmt(r.value) + (r.note ? ` (${r.note})` : '')] as [string, string])]
  return (
    <Frame title={title} sub={sub} table={table}>
      {rows.length ? <ul className="hbars">{rows.map(r => (
        <li key={r.label} title={`${r.label}: ${fmt(r.value)}${r.note ? ' · ' + r.note : ''}`} className={open === r.label ? 'open' : ''} tabIndex={0}
          onClick={() => setOpen(o => o === r.label ? null : r.label)} onFocus={() => setOpen(r.label)} onBlur={() => setOpen(o => o === r.label ? null : o)}>
          <span className="hb-l">{r.label}</span>
          <span className="hb-track"><span className="hb-bar" style={{ width: `${(r.value / max) * 100}%`, background: color }} /></span>
          <span className="hb-v">{fmt(r.value)}{r.note && <span className="muted"> {r.note}</span>}</span>
        </li>))}</ul> : <p className="muted small">No data yet.</p>}
    </Frame>
  )
}

/* ───────── the Progress dashboard ───────── */
/** the inputs the rating series reads, so the charts recompute when those change — not on every heartbeat or planner edit */
function useSeries() {
  const cp = useStore(x => x.cp), nDays = useStore(x => Object.keys(x.days).length), cf = useCf()
  const today = dateKey(useNow(60000))
  const series = useMemo(() => levelSeries(getState(), 30), [cp.events, cp.attempts, cp.sessions, cp.daily, cp.calib, cf.user, cf.problems.length, nDays, today]) // eslint-disable-line react-hooks/exhaustive-deps
  return { series, cp, cf, nDays, today }
}
const fmtRate = (v: number) => `${v > 0 ? '+' : ''}${v}`
const signed = (v: number) => `${v >= 0 ? '+' : ''}${v}`

/** KPI row (rating pace, ETA, this week's hours) + the three main charts; `aside` fills the fourth grid slot on a laptop */
export function ProgressCharts({ aside }: { aside?: ReactNode }) {
  const { series, cp, cf, nDays, today } = useSeries()
  const days = useStore(x => x.days), settings = useStore(x => x.settings), seasons = useStore(x => x.seasons)
  const minute = Math.floor(useNow(60000).getTime() / 60000)
  const rates = useMemo(() => progressRates(getState()), [series, cp.active]) // eslint-disable-line react-hooks/exhaustive-deps
  // the live score follows the clock (pace) as well as the day's work
  const dis = useMemo(() => discipline(getState()), [days, settings, seasons, cp.sessions, cp.tests, cp.plans, cp.active, cf.user, minute, nDays]) // eslint-disable-line react-hooks/exhaustive-deps
  const wt = settings.workTarget
  // total work per day: every finished deep-work, study and admin task (CP blocks included)
  const hours = series.map(p => ({ x: p.date, y: Math.round(workMin(days[p.date]) / 6) / 10 }))
  const week = Array.from({ length: 7 }, (_, i) => workMin(days[addDays(today, i - 6)])).reduce((a, b) => a + b, 0)
  const tierBands = TIERS.slice(0, -1).map(([from, label], i) => ({ from, to: TIERS[i + 1][0], label })).filter((_, i) => i % 2 === 1)
  const hasRate = rates.change || rates.days > 1
  return (
    <div className="view-sub">
      <div className="kpis rates">
        <div className="kpi card hero"><div className="small muted">rating gain / training day</div><div className="kpi-v">{hasRate ? fmtRate(rates.per_day_14) : '—'}</div><div className="small muted">{hasRate ? (rates.days >= 14 ? `last 14 training days · 30: ${fmtRate(rates.per_day_30)}` : `${rates.start_level} → ${rates.level} over ${rates.days} training day${rates.days === 1 ? '' : 's'}`) : 'solve a few problems and it appears'}</div></div>
        <div className="kpi card hero"><div className="small muted">rating gain / hour trained</div><div className="kpi-v">{rates.has_hours ? fmtRate(rates.per_hour) : '—'}</div><div className="small muted">{rates.has_hours ? `${rates.hours_30d} h of practice over ${rates.days} training day${rates.days === 1 ? '' : 's'}` : 'counts once you run a practice session'}</div></div>
        <div className="kpi card"><div className="small muted">{rates.next_tier ? `ETA to ${rates.next_tier}` : 'top tier'}</div><div className="kpi-v">{rates.eta_days ? `${rates.eta_days}d` : '—'}</div><div className="small muted">{rates.eta_days ? 'training days at your recent pace' : 'need a positive trend'}</div></div>
        <div className="kpi card"><div className="small muted">work this week</div><div className="kpi-v">{fmtHours(week)}</div>
          <WavyBar value={Math.min(1, week / Math.max(1, wt * 7 * 60))} height={8} />
          <div className="small muted">of {wt * 7} h · last 7 days at {wt} h a day</div></div>
      </div>
      <div className="grid-2 prog-grid">
        <LineChart title="Rating" sub="your last 30 training days · practice level (from every solve, fail and mock) vs Codeforces" yMin={Math.min(...series.flatMap(p => p.cf ? [p.level, p.cf] : [p.level])) - 100}
          series={[{ name: 'Practice level', color: 'var(--chart-1)', pts: series.map(p => ({ x: p.date, y: p.level })) }, ...(series.some(p => p.cf) ? [{ name: 'Codeforces', color: 'var(--chart-2)', pts: series.map(p => ({ x: p.date, y: p.cf || null })) }] : [])]}
          bands={tierBands} />
        <Columns title="Work hours per day" sub={`your last 30 training days · deep work + study + admin · target ${wt} h`} data={hours} yfmt={v => `${v} h`} target={{ y: wt, label: `${wt}h` }} />
        <LineChart title="Discipline" sub={`now ${dis.live} · ${signed(dis.liveDelta)} today so far${dis.history.length ? ` · ${signed(dis.yesterdayDelta)} yesterday` : ''} · today ${Math.round(dis.today.score * 100)}% done — rises when you do everything, falls when you don't`}
          series={[{ name: 'Discipline', color: 'var(--chart-3)', pts: dis.history.slice(-30).map(h => ({ x: h.date, y: h.D })) }]} yMin={0} />
        {aside}
      </div>
    </div>
  )
}

/** the detail charts for "More stats": mock performance, solves and median time by rating, error classes */
export function DetailCharts() {
  const { series, cp } = useSeries()
  const byPid = useMemo(() => eventsByPid(cp), [cp.events]) // eslint-disable-line react-hooks/exhaustive-deps
  // everything below covers your last 30 TRAINING days (breaks don't empty it)
  const since30 = new Date((series[0]?.date || dateKey()) + 'T00:00:00').getTime()
  const level = series[series.length - 1]?.level || 0
  const { bandRows, errs, mocks } = useMemo(() => {
    // solves and median time to AC by rating band
    const bands = new Map<number, { n: number; times: number[] }>()
    for (const a of Object.values(cp.attempts)) {
      if (a.status !== 'solved' || a.at < since30) continue
      const r = getProb(a.pid)?.r; if (!r) continue
      const b = Math.floor(r / 100) * 100, e = bands.get(b) || { n: 0, times: [] }
      e.n++
      const t = timeline(a.pid, byPid.get(a.pid))
      const mins = a.secs ? a.secs / 60 : t.firstOpen && t.acAt ? (t.acAt - t.firstOpen) / 60000 : undefined
      if (mins !== undefined && mins < 600) e.times.push(mins)
      bands.set(b, e)
    }
    return {
      bandRows: [...bands.entries()].sort((a, b) => a[0] - b[0]),
      errs: recurringErrors(byPid, since30),
      mocks: Object.values(cp.tests).filter(t => t.finishedAt && t.perf).sort((a, b) => a.startedAt - b.startedAt).slice(-20),
    }
  }, [cp.attempts, cp.tests, byPid, since30])
  const med = (xs: number[]) => { if (!xs.length) return 0; const s2 = [...xs].sort((a, b) => a - b); return s2[Math.floor(s2.length / 2)] }
  return (
    <>
      {mocks.length > 0 && <LineChart title="Mock contest performance" series={[{ name: 'Performance', color: 'var(--chart-2)', pts: mocks.map(t => ({ x: t.date, y: t.perf! })) }]} refLine={{ y: level, label: 'level' }} />}
      <HBars title="Solves by rating" sub="your last 30 training days" rows={bandRows.map(([b, e]) => ({ label: String(b), value: e.n }))} />
      <HBars title="Median minutes to AC by rating" sub="last 30 training days · from problem open (or session start) to Accepted" color="var(--tertiary)" rows={bandRows.filter(([, e]) => e.times.length).map(([b, e]) => ({ label: String(b), value: Math.round(med(e.times)), note: `n=${e.times.length}` }))} fmt={v => `${v}m`} />
      <HBars title="Error classes" sub="last 30 training days · from your verdicts: sample fails, edge cases, wrong ideas, TLE…" color="var(--error)" rows={errs.map(e => ({ label: e.cls.replace('_', ' '), value: e.count, note: e.recurring ? 'recurring' : undefined }))} />
    </>
  )
}

/* ───────── when you think best: hour heat strip, peak window, fatigue, weekday, sleep/energy ───────── */
const pct = (v: number) => `${Math.round(v * 100)}%`
const spd = (v: number | null) => v === null ? '—' : `${Math.round(v * 100)}% of box`
/** sequential single-hue ramp (5 steps of the theme primary into the surface); n < 3 = hatched "not enough data" */
const RAMP = [18, 36, 54, 72, 90]
const rampOf = (clean: number) => RAMP[Math.min(4, Math.floor(clean * 5))]
const cellTip = (c: PeakCell, head: string) => `${head} · n=${c.n}${c.n ? ` · clean ${pct(c.clean)} · speed ${spd(c.speed)}` : ''}`

export function PeakCharts() {
  const cp = useStore(x => x.cp)
  const p = useMemo(() => peakStats(getState()), [cp.sessions, cp.events, cp.energy, cp.daily, cp.plans]) // eslint-disable-line react-hooks/exhaustive-deps
  const [hov, setHov] = useState<number | null>(null)
  const [ex, setEx] = useState<'sleep' | 'energy'>('sleep')
  const hr = (h: number) => `${String(h).padStart(2, '0')}:00`
  const table: [string, ...string[]][] = [['Hour', 'Problems', 'Clean', 'Median speed'], ...p.hours.map((c, h) => [hr(h), String(c.n), c.n ? pct(c.clean) : '—', spd(c.speed)] as [string, ...string[]])]
  const firstClean = p.buckets[0].n ? p.buckets[0].clean : null
  const en = p.energy, need = Math.max(0, 7 - en.n)
  return (
    <>
      <div className="kpis peak-kpis">
        <div className="kpi card pk-hero"><div className="small muted">peak window</div><div className="kpi-v">{p.peak ? p.peak.label : '—'}</div>
          <div className="small muted">{p.peak ? `${pct(p.peak.clean)} clean · n=${p.peak.n}` : `need ${PEAK_MIN_N} problems in one 3-h window`}</div></div>
        <div className="kpi card"><div className="small muted">fatigue sets in</div><div className="kpi-v">{p.fatigue ? `${p.fatigue.after}m` : '—'}</div>
          <div className="small muted">{p.fatigue ? `−${p.fatigue.drop} pts clean after ${p.fatigue.after} min` : 'no drop yet'}</div></div>
        <div className="kpi card"><div className="small muted">best weekday</div><div className="kpi-v">{p.bestWeekday || '—'}</div>
          <div className="small muted">{p.n} problems logged</div></div>
      </div>
      <div className="grid-2">
      <Frame title="When you think best" sub="clean solves (AC, hint < 2, inside the time-box) by the hour you started the problem" table={table}>
        <div className="chart-box">
          <div className="peak-strip" role="img" aria-label="clean rate by hour of day" onPointerLeave={() => setHov(null)}>
            {p.hours.map((c, h) => {
              const inPeak = p.peak && (h - p.peak.from + 24) % 24 < 3
              return <div key={h} className={'pk-c' + (c.n < 3 ? ' thin' : '') + (inPeak ? ' peak' : '') + (hov === h ? ' hov' : '')} tabIndex={0}
                style={c.n >= 3 ? { background: `color-mix(in oklab, var(--primary) ${rampOf(c.clean)}%, var(--surface-container-highest))` } : undefined}
                onPointerEnter={() => setHov(h)} onFocus={() => setHov(h)} onBlur={() => setHov(null)} title={cellTip(c, hr(h))} />
            })}
          </div>
          <div className="peak-axis">{[0, 3, 6, 9, 12, 15, 18, 21].map(h => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}</span>)}</div>
          {hov !== null && <div className="tip" style={{ left: `${((hov + 0.5) / 24) * 100}%`, top: 'auto', bottom: '100%' }}>
            <div className="tip-x">{hr(hov)}–{hr((hov + 1) % 24)}</div>
            <div className="tip-r"><b>{p.hours[hov].n ? pct(p.hours[hov].clean) : '—'}</b><span>clean · n={p.hours[hov].n}</span></div>
            <div className="tip-r"><b>{spd(p.hours[hov].speed)}</b><span>median time</span></div>
          </div>}
        </div>
        <div className="legend small"><span>clean</span>{RAMP.map((r, i) => <span key={r}><i className="rect" style={{ background: `color-mix(in oklab, var(--primary) ${r}%, var(--surface-container-highest))` }} />{i * 20}{i === 4 ? '–100%' : ''}</span>)}
          <span><i className="rect pk-hatch" />n &lt; 3</span>{p.peak && <span><i className="rect pk-ring" />peak</span>}</div>
      </Frame>
      <LineChart title="Fatigue curve" sub={p.fatigue ? `clean rate drops ${p.fatigue.drop} pts once you're ${p.fatigue.after}+ min into a session — take a break there` : 'clean rate by minutes into a session (a drop of 15+ pts flags fatigue)'}
        series={[{ name: 'Clean rate', color: 'var(--chart-1, var(--primary))', pts: p.buckets.map(b => ({ x: b.label, y: b.n ? Math.round(b.clean * 100) : null })) }]}
        yMin={0} yMax={100} yfmt={v => `${Math.round(v)}%`} xlab={x => `${x}m`} xtip={x => `${x} min in · n=${p.buckets.find(b => b.label === x)?.n ?? 0}`} xname="Minutes in"
        refLine={firstClean !== null ? { y: Math.round(firstClean * 100), label: 'start' } : undefined} />
      <HBars title="Clean rate by weekday" sub="days with fewer than 4 problems are left out of “best weekday”" rows={p.weekdays.map(w => ({ label: w.label, value: Math.round(w.clean * 100), note: `n=${w.n}` }))} fmt={v => `${v}%`} />
      {en.n >= 7 ? <Scatter title="Sleep, energy and clean rate" sub={`r(sleep) = ${en.sleep ?? '—'} · r(energy) = ${en.energy ?? '—'} · ${en.n} days`}
        pts={en.pts.filter(x => x[ex] !== undefined).map(x => ({ x: x[ex]!, y: Math.round(x.clean * 100), label: `${fmtDay(x.date)} · n=${x.n}` }))}
        xname={ex === 'sleep' ? 'Sleep (h)' : 'Energy (1–5)'} xs={ex === 'sleep' ? [4, 5, 6, 7, 8, 9] : [1, 2, 3, 4, 5]}
        head={<Chips value={ex} onChange={setEx} options={[{ v: 'sleep', label: 'Sleep' }, { v: 'energy', label: 'Energy' }]} />} />
        : <section className="card chart"><div className="card-head"><h3 className="title">Sleep, energy and clean rate</h3></div>
          <p className="small muted">{need} more morning check{need === 1 ? '' : 's'} on days you practise, then this shows whether sleep and energy move your clean rate ({en.reports} answered so far).</p></section>}
      </div>
    </>
  )
}

/** small scatter: x ordinal-ish numeric, y 0–100% */
function Scatter({ title, sub, pts, xs, xname, head }: { title: string; sub?: string; pts: { x: number; y: number; label: string }[]; xs: number[]; xname: string; head?: ReactNode }) {
  const [hov, setHov] = useState<number | null>(null)
  const lo = xs[0], hi = xs[xs.length - 1]
  const X = (v: number) => PAD.l + ((Math.min(hi, Math.max(lo, v)) - lo) / Math.max(1, hi - lo)) * (W - PAD.l - PAD.r)
  const Y = (v: number) => PAD.t + (1 - v / 100) * (H - PAD.t - PAD.b)
  // jitter identical points a little so stacked days stay visible
  const seen = new Map<string, number>()
  const js = pts.map(p => { const k = `${p.x}|${p.y}`, n = seen.get(k) || 0; seen.set(k, n + 1); return (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 6 })
  const table: [string, ...string[]][] = [['Day', xname, 'Clean'], ...pts.map(p => [p.label, String(p.x), `${p.y}%`] as [string, ...string[]])]
  return (
    <Frame title={title} sub={sub} table={table}>
      {head}
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={title} onPointerLeave={() => setHov(null)}>
          {[0, 25, 50, 75, 100].map(t => <g key={t}><line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} className="grid" /><text x={PAD.l - 6} y={Y(t) + 4} className="tick" textAnchor="end">{t}%</text></g>)}
          {xs.map(v => <text key={v} x={X(v)} y={H - 6} className="tick" textAnchor="middle">{v}{v === hi && xname.startsWith('Sleep') ? '+' : ''}</text>)}
          {pts.map((p, i) => <circle key={i} cx={X(p.x) + js[i]} cy={Y(p.y)} r={hov === i ? 6 : 4.5} fill="var(--chart-1, var(--primary))" fillOpacity={hov === null || hov === i ? 0.85 : 0.35} className="dot"
            onPointerEnter={() => setHov(i)} />)}
        </svg>
        {hov !== null && <div className="tip" style={{ left: `${(X(pts[hov].x) / W) * 100}%` }}>
          <div className="tip-x">{pts[hov].label}</div><div className="tip-r"><b>{pts[hov].y}%</b><span>clean · {xname} {pts[hov].x}</span></div>
        </div>}
      </div>
    </Frame>
  )
}

/* ───────── rivals: rating vs days since first rated contest ───────── */
/** fixed categorical palette (validated light + dark, adjacent CVD ΔE ≥ 8.4) — role colours collapse in monochrome themes */
const RIVAL_COLORS = Array.from({ length: 8 }, (_, i) => `var(--rv-${i + 1})`)

export function RivalsCard() {
  const { me, rivals, list, status, cmp, refresh } = useRivals()
  const [h, setH] = useState(''), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [span, setSpan] = useState<'pace' | 'all'>('pace')
  const add = async () => { setBusy(true); setErr(null); const e = await addRival(h); setBusy(false); if (e) setErr(e); else setH('') }
  const withPts = rivals.filter(r => r.pts.length)
  const allMax = Math.max(0, ...withPts.map(r => r.dayNow), me?.dayNow ?? 0)
  const D = span === 'all' ? allMax : Math.min(allMax, Math.max(30, Math.ceil((me?.dayNow ?? 30) * 2)))
  const step = Math.max(1, Math.ceil(D / 150))
  const days: number[] = []; for (let d = 0; d <= D; d += step) days.push(d)
  if (days[days.length - 1] !== D) days.push(D)
  const series = [
    ...(me ? [{ name: `You (${me.handle})`, color: 'var(--on-surface)', w: 3, pts: days.map(d => ({ x: String(d), y: ratingAt(me, d) })) }] : []),
    ...withPts.slice(0, 8).map((r, i) => ({ name: r.handle, color: RIVAL_COLORS[i], noEnd: true, pts: days.map(d => ({ x: String(d), y: ratingAt(r, d) })) })),
  ]
  const summary = !me ? 'Take your first rated round to join the race.' : !withPts.length ? 'Add a rival to compare.' : cmp && cmp.of ? `You're ahead of ${cmp.ahead} of ${cmp.of} rival${cmp.of === 1 ? '' : 's'} at day ${cmp.day}.` : `None of your rivals had reached day ${me.dayNow} yet.`
  return (
    <section className="rivals">
      <div className="card">
        <div className="card-head"><h3 className="title"><Icon n="sports_kabaddi" fill /> Rivals</h3>
          <span className="small muted">{list.length}/{MAX_RIVALS}{status.busy ? ' · fetching…' : ''}</span></div>
        <p className="rv-sum">{summary}</p>
        <form className="row rv-add" onSubmit={e => { e.preventDefault(); if (!busy) void add() }}>
          <input className="rv-in" value={h} onChange={e => { setH(e.target.value); setErr(null) }} placeholder="Codeforces handle" aria-label="Rival handle" autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={list.length >= MAX_RIVALS} />
          <Btn kind="tonal" size="sm" icon="person_add" type="submit" disabled={busy || !h.trim() || list.length >= MAX_RIVALS}>{busy ? 'Checking…' : 'Add'}</Btn>
        </form>
        {err && <div className="small rv-err" role="alert"><Icon n="error" /> {err}</div>}
        {status.err && <div className="small rv-err"><Icon n="cloud_off" /> {status.err}</div>}
        {list.length > 0 && <div className="chips rv-list">{list.map(x => {
          const r = rivals.find(y => y.handle.toLowerCase() === x.toLowerCase()), row = cmp?.rows.find(y => y.handle === r?.handle)
          return <span key={x} className="chip rv-chip"><span>{x}</span>{r && <span className="muted">{r.pts.length ? r.rating : 'unrated'}{row ? ` · ${row.diff >= 0 ? '+' : ''}${row.diff}` : ''}</span>}
            <button type="button" className="rv-x" aria-label={`Remove ${x}`} onClick={() => removeRival(x)}><Icon n="close" /></button></span>
        })}</div>}
      </div>
      {series.length > 0 && <LineChart title="Rating vs days since first contest" sub="displayed rating after each rated round · same day count for everyone"
        series={series} xlab={x => `d${x}`} xtip={x => `day ${x}`} xname="Day" yMin={0}
        after={<div className="row wrap rv-foot"><Chips value={span} onChange={setSpan} options={[{ v: 'pace', label: 'Your horizon' }, { v: 'all', label: 'Full history' }]} />
          <button type="button" className="linkish small pad" onClick={() => void refresh()} disabled={status.busy}><Icon n="refresh" /> Refresh</button></div>} />}
    </section>
  )
}
