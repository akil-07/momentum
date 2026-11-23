import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { CATS, addDays, addSpan, dateKey, daySpans, dayWindow, deleteSpan, editSpan, fmtDur, getState, isAutoBreak, isWork, keyToDate, spanEnd, spanMin, spansOf, stopSpan, taskSpans, toMin, unionMin, untimedMin, useStore, type Cat, type Day, type Span } from '../store'
import { Btn, Chips, Field, IconBtn, Sheet, spring, useNow } from './common'
import { confirmAsk, fmtDay } from '../ui'
import { Icon } from './fx'
import '../styles/timeline.css'

/* ═════════ the work log: what you REALLY did, against what you planned ═════════ */

const pad = (n: number) => String(n).padStart(2, '0')
export const hm = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
export const fm = (m: number) => fmtDur(Math.max(0, Math.round(m)))
/** "HH:MM" on day k → ms */
export const atTime = (k: string, t: string) => { const d = keyToDate(k), [h, m] = t.split(':').map(Number); d.setHours(h || 0, m || 0, 0, 0); return d.getTime() }
export const SRC: Record<Span['src'], { icon: string; label: string }> = {
  focus: { icon: 'center_focus_strong', label: 'Focus' }, pomodoro: { icon: 'timer', label: 'Pomodoro' }, cp: { icon: 'code', label: 'CP practice' },
  mock: { icon: 'emoji_events', label: 'Mock' }, contest: { icon: 'sports_score', label: 'Live contest' }, manual: { icon: 'edit', label: 'Logged by hand' },
}
export const toneOf = (c: Cat) => { const t = CATS[c].tone; return t === 'neutral' ? { mark: 'var(--outline)', bg: 'var(--surface-container-highest)', fg: 'var(--on-surface-variant)' } : { mark: `var(--${t})`, bg: `var(--${t}-container)`, fg: `var(--on-${t}-container)` } }
/** lo/hi: only the minutes inside that window (a day's share of a span that crosses midnight) */
const sumMin = (ss: Span[], now: number, lo = -Infinity, hi = Infinity) => ss.reduce((a, x) => a + Math.max(0, (Math.min(spanEnd(x, now), now, hi) - Math.max(x.start, lo)) / 60000), 0)
/** longest run of work with no gap over a minute (back-to-back timers count as one stretch) */
function longest(ss: Span[], now: number, lo = -Infinity, hi = Infinity) {
  const iv = ss.filter(x => isWork(x.cat)).map(x => [Math.max(lo, x.start), Math.min(hi, spanEnd(x, now))]).filter(x => x[1] > x[0]).sort((a, b) => a[0] - b[0])
  let best = 0, a = 0, b = -Infinity
  for (const [s, e] of iv) { if (s > b + 60e3) { a = s; b = e } else b = Math.max(b, e); best = Math.max(best, b - a) }
  return best / 60000
}
/** what the log of a day adds up to */
export function dayLog(d: Day | undefined, now = Date.now()) {
  // overlaps (two devices, a hand-logged stretch over a timer) count once, as in workMin
  // automatic breaks are drawn but never counted: not work, not in "logged in all"
  // the sums split at midnight like workMin: this day's share of its spans plus last night's overflow (ss: the day's own, for the list)
  const ss = spansOf(d), [lo, hi] = d ? dayWindow(d.date) : [-Infinity, Infinity], all = d ? daySpans(d) : []
  const work = unionMin(all.filter(x => isWork(x.cat)), now, lo, hi), real = all.filter(x => !isAutoBreak(x))
  const untimed = d ? untimedMin(d) : 0
  return { ss, work, total: sumMin(real, now, lo, hi), n: ss.filter(x => !isAutoBreak(x)).length, breaks: sumMin(all.filter(isAutoBreak), now, lo, hi), untimed, longest: longest(all, now, lo, hi), running: ss.find(x => x.end === null) }
}
/** greedy lane packing for overlapping blocks: lane index + lanes in its cluster */
function pack<T>(xs: T[], s: (x: T) => number, e: (x: T) => number) {
  const out: { x: T; lane: number; g: number }[] = [], ends: number[] = [], n: Record<number, number> = {}
  let g = 0, gEnd = -Infinity
  for (const x of [...xs].sort((p, q) => s(p) - s(q))) {
    if (s(x) >= gEnd) { g++; ends.length = 0 }
    let l = ends.findIndex(v => v <= s(x)); if (l < 0) { l = ends.length; ends.push(0) }
    ends[l] = e(x); gEnd = Math.max(gEnd, e(x)); n[g] = Math.max(n[g] || 0, l + 1); out.push({ x, lane: l, g })
  }
  return out.map(o => ({ ...o, n: n[o.g] }))
}

/** jump straight to Progress → Timeline from elsewhere (Today): App listens for 'momentum:go' and routes there */
export function openTimeline() {
  window.dispatchEvent(new CustomEvent('momentum:go', { detail: { tab: 'progress', view: 'timeline' } }))
}

const PX = 1 // px per minute
const MINH = 24 // a block is drawn (and tappable) at least this tall
export function Timeline() {
  const now = useNow(15000).getTime(), today = dateKey(new Date(now))
  const [k, setK] = useState(today)
  const [edit, setEdit] = useState<Span | null>(null), [adding, setAdding] = useState(false), [hov, setHov] = useState<string | null>(null), [catTip, setCatTip] = useState<Cat | null>(null)
  const d = useStore(s => s.days[k]), prevDay = useStore(s => s.days[addDays(k, -1)])
  const dayStart = keyToDate(k).getTime(), isToday = k === today
  const L = dayLog(d, now)
  const m0 = (ms: number) => (ms - dayStart) / 60000
  // spans that started late yesterday and ran past midnight are drawn too (they count on yesterday)
  const shown = [...spansOf(prevDay).filter(x => spanEnd(x, now) > dayStart), ...L.ss]
  const tasks = d?.tasks || []
  // done with "I didn't time it": no log, so draw it at its planned slot (or ending when it was ticked) as a dashed block — tap to log real times
  const untimedAt = (t: typeof tasks[number]) => t.start ? atTime(k, t.start) : (t.doneAt || 0) - t.dur * 60000
  const untimedTs = d ? tasks.filter(t => t.done && (t.start || t.doneAt) && !taskSpans(d, t.id, true).length) : []
  const items: { sp?: Span; t?: typeof tasks[number]; a: number; b: number }[] = [
    ...shown.map(sp => ({ sp, a: Math.max(0, m0(sp.start)), b: Math.min(1440, Math.max(m0(sp.start) + 1, m0(spanEnd(sp, now)))) })),
    ...untimedTs.map(t => { const a = Math.max(0, m0(untimedAt(t))); return { t, a, b: Math.min(1440, a + Math.max(1, t.dur)) } }),
  ]
  const blocks = pack(items, o => o.a, o => Math.max(o.b, o.a + (MINH + 2) / PX)) // packed by drawn size, so short blocks never cover each other
  const logUntimed = (t: typeof tasks[number]) => {
    const st = untimedAt(t), id = addSpan({ taskId: t.id, title: t.title, cat: t.cat, start: st, end: Math.min(now, st + t.dur * 60000), src: 'manual' })
    const sp = spansOf(getState().days[dateKey(new Date(st))]).find(x => x.id === id); if (sp) setEdit(sp)
  }
  const plans = pack(tasks.filter(t => t.start).map(t => ({ t, a: toMin(t.start!), b: Math.min(1440, toMin(t.start!) + t.dur) })), o => o.a, o => o.b)
  const pts = [...blocks.flatMap(o => [o.x.a, o.x.b]), ...plans.flatMap(o => [o.x.a, o.x.b]), ...(isToday ? [m0(now)] : [])]
  const lo = Math.max(0, Math.min(480, Math.floor(Math.min(1440, ...pts) / 60) * 60 - 60)), hi = Math.min(1440, Math.max(1320, Math.ceil(Math.max(0, ...pts) / 60) * 60 + 60))
  const planned = tasks.filter(t => isWork(t.cat)).reduce((a, t) => a + t.dur, 0)
  const dayAll = d ? daySpans(d) : [], [wLo, wHi] = dayWindow(k) // per category: the day's share too, so it adds up to the total
  const byCat = (Object.keys(CATS) as Cat[]).map(c => ({ c, m: sumMin(dayAll.filter(x => x.cat === c && !isAutoBreak(x)), now, wLo, wHi) })).filter(x => x.m >= 0.5)
  const hsb = blocks.find(o => o.x.sp && o.x.sp.id === hov), hs = hsb && { ...hsb, x: { ...hsb.x, sp: hsb.x.sp! } }
  useEffect(() => { if (k > today) setK(today) }, [k, today])

  return (
    <div className="tm">
      <section className="card tm-head">
        <div className="tm-nav">
          <IconBtn icon="chevron_left" title="Previous day" onClick={() => setK(addDays(k, -1))} />
          <div className="tm-date"><b>{isToday ? 'Today' : keyToDate(k).toLocaleDateString(undefined, { weekday: 'long' })}</b><span className="small muted">{keyToDate(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: k.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' })}</span></div>
          <IconBtn icon="chevron_right" title="Next day" disabled={isToday} onClick={() => setK(addDays(k, 1))} />
          {!isToday && <Btn kind="text" size="sm" onClick={() => setK(today)}>Today</Btn>}
        </div>
        <div className="tm-kpis">
          <div className="tm-kpi tm-k1"><b>{fm(L.work)}</b><span>real work</span></div>
          <div className="tm-kpi"><b>{fm(L.total)}</b><span>logged in all</span></div>
          <div className="tm-kpi"><b>{planned ? fm(planned) : '—'}</b><span>work planned</span></div>
          <div className="tm-kpi"><b>{planned ? Math.round(L.work / planned * 100) + '%' : '—'}</b><span>of the plan</span></div>
          <div className="tm-kpi"><b>{L.longest >= 1 ? fm(L.longest) : '—'}</b><span>longest stretch</span></div>
        </div>
        {L.untimed > 0 && <p className="small muted tm-note"><Icon n="info" /> +{fm(L.untimed)} done without times (counted at planned length)</p>}
        {L.breaks >= 1 && <p className="small muted tm-note"><Icon n="self_improvement" /> breaks: {fm(L.breaks)} (automatic, not counted as work)</p>}
        {L.total >= 1 && <div className="tm-cats">
          <div className="tm-catbar" role="img" aria-label={byCat.map(x => `${CATS[x.c].label} ${fm(x.m)}`).join(', ')}>
            {byCat.map(x => <i key={x.c} className={catTip === x.c ? 'on' : ''} style={{ flexGrow: x.m, background: toneOf(x.c).mark }} title={`${CATS[x.c].label} · ${fm(x.m)}`} onClick={() => setCatTip(c => c === x.c ? null : x.c)} />)}
          </div>
          {/* the legend carries every value, so the bar's hover titles are never the only place to read them; tapping a segment highlights its row */}
          <div className="legend">{byCat.map(x => <span key={x.c} className={catTip === x.c ? 'tm-cat-on' : ''}><i className="rect" style={{ background: toneOf(x.c).mark }} />{CATS[x.c].label} <b>{fm(x.m)}</b></span>)}</div>
        </div>}
      </section>

      <section className="card tm-card">
        <div className="card-head">
          <h3 className="title"><Icon n="view_timeline" fill /> Timeline</h3>
          <Btn kind="tonal" size="sm" icon="add" onClick={() => setAdding(true)}>Log work</Btn>
        </div>
        <div className="tm-lanes-h small muted"><span>What you did</span><span>Plan</span></div>
        <div className="tm-chart" style={{ height: (hi - lo) * PX }} onPointerLeave={() => setHov(null)}>
          {Array.from({ length: (hi - lo) / 60 + 1 }, (_, i) => lo / 60 + i).map(h => <div key={h} className="tm-hr" style={{ top: (h * 60 - lo) * PX }}><span>{pad(h % 24)}</span></div>)}
          <div className="tm-lane tm-plan">
            {plans.map(({ x: o, lane, n }) => <div key={o.t.id} className={'tm-ghost' + (o.t.done ? ' done' : '')} title={`Planned ${o.t.start}–${hm(dayStart + o.b * 60000)} · ${o.t.title}`}
              style={{ top: (o.a - lo) * PX, height: Math.max(12, (o.b - o.a) * PX - 2), left: `${lane / n * 100}%`, width: `calc(${100 / n}% - 3px)`, borderColor: toneOf(o.t.cat).mark }}>
              {(o.b - o.a) * PX >= 26 && <span>{o.t.title}</span>}
            </div>)}
          </div>
          <div className="tm-lane tm-real">
            {blocks.map(({ x: o, lane, n }) => {
              if (o.t) { const t = o.t, tn = toneOf(t.cat), h = Math.max(MINH, (o.b - o.a) * PX - 2), st = untimedAt(t)
                return <button key={'u:' + t.id} type="button" className="tm-blk untimed" title="Done without times — tap to log when you really did it"
                  style={{ top: (o.a - lo) * PX, height: h, left: `${lane / n * 100}%`, width: `calc(${100 / n}% - 3px)`, color: tn.fg, borderColor: tn.mark }}
                  aria-label={`${t.title}, done without times, about ${hm(st)}, ${fm(t.dur)}. Log real times`} onClick={() => logUntimed(t)}>
                  <span className="tm-blk-t">{t.title}</span>
                  {h >= 32 && <span className="tm-blk-m">untimed · ~{hm(st)} · {fm(t.dur)}</span>}
                </button> }
              const sp = o.sp!, tn = toneOf(sp.cat), h = Math.max(MINH, (o.b - o.a) * PX - 2), run = sp.end === null, brk = isAutoBreak(sp)
              return <motion.button key={sp.id} type="button" className={'tm-blk' + (brk ? ' brk' : '') + (run ? ' run' : '') + (hov === sp.id ? ' hov' : '')} layout transition={spring}
                style={{ top: (o.a - lo) * PX, height: h, left: `${lane / n * 100}%`, width: `calc(${100 / n}% - 3px)`, ...(brk ? {} : { background: tn.bg, color: tn.fg, boxShadow: `inset 3px 0 0 ${tn.mark}` }) }}
                aria-label={`${brk ? 'Break' : sp.title}, ${hm(sp.start)} to ${run ? 'now' : hm(spanEnd(sp, now))}, ${fm(spanMin(sp, now))}`}
                onPointerEnter={e => e.pointerType === 'mouse' && setHov(sp.id)} onClick={() => { setHov(null); setEdit(sp) }}>
                <span className="tm-blk-t">{brk ? `Break ${fm(spanMin(sp, now))}` : sp.title}</span>
                {!brk && h >= 32 && <span className="tm-blk-m">{hm(sp.start)}–{run ? 'now' : hm(spanEnd(sp, now))} · {fm(spanMin(sp, now))}</span>}
              </motion.button>
            })}
            {hs && <div className="tip tm-tip" style={{ top: Math.min((hi - lo) * PX - 64, (hs.x.b - lo) * PX + 4), left: `${hs.lane / hs.n * 100}%` }}>
              <div className="tip-x">{hm(hs.x.sp.start)}–{hs.x.sp.end === null ? 'now' : hm(spanEnd(hs.x.sp, now))} · {SRC[hs.x.sp.src].label}</div>
              <div className="tip-r"><i style={{ background: toneOf(hs.x.sp.cat).mark }} /><b>{fm(spanMin(hs.x.sp, now))}</b><span>{hs.x.sp.title}</span></div>
            </div>}
          </div>
          {isToday && m0(now) >= lo && m0(now) <= hi && <div className="tm-now" style={{ top: (m0(now) - lo) * PX }}><span>{hm(now)}</span></div>}
          {!items.length && <div className="tm-empty small muted" style={{ top: Math.max(0, ((isToday ? m0(now) : 600) - lo) * PX - 96) }}>Nothing logged{isToday ? ' yet' : ''}. Timers fill this in — or tap “Log work”.</div>}
        </div>
      </section>

      {L.ss.length > 0 && <section className="card">
        <div className="card-head"><h3 className="title"><Icon n="format_list_bulleted" fill /> Log</h3><span className="small muted">{L.ss.length} stretch{L.ss.length === 1 ? '' : 'es'}</span></div>
        <ul className="tm-list">
          {L.ss.map(sp => <li key={sp.id}><button type="button" onClick={() => setEdit(sp)}>
            <span className="tm-l-time">{hm(sp.start)}<i>{sp.end === null ? 'now' : hm(spanEnd(sp, now))}</i></span>
            <span className="tm-l-mark" style={{ background: toneOf(sp.cat).mark }} />
            <span className="grow"><span className="tm-l-t">{sp.title}</span><span className="small muted"><Icon n={SRC[sp.src].icon} /> {SRC[sp.src].label} · {CATS[sp.cat].label}</span></span>
            <b className={'tm-l-m' + (sp.end === null ? ' run' : '')}>{sp.end === null && <i className="dot" />}{fm(spanMin(sp, now))}</b>
          </button></li>)}
        </ul>
      </section>}

      <SpanSheet open={!!edit || adding} span={edit} day={k} onClose={() => { setEdit(null); setAdding(false) }} />
    </div>
  )
}

/** edit a logged stretch, or log one by hand (title, category, start, end, optional task) */
export function SpanSheet({ open, span, day, onClose }: { open: boolean; span?: Span | null; day: string; onClose: () => void }) {
  const tasks = useStore(s => s.days[day]?.tasks || [])
  const [title, setTitle] = useState(''), [cat, setCat] = useState<Cat>('deep'), [a, setA] = useState(''), [b, setB] = useState(''), [task, setTask] = useState(''), [next, setNext] = useState(false)
  const live = useStore(s => span ? Object.values(s.days).map(d => d.spans?.[span.id]).find(Boolean) : undefined)
  useEffect(() => {
    if (!open) return
    if (span) { setTitle(span.title); setCat(span.cat); setA(hm(span.start)); setB(span.end === null ? '' : hm(span.end)); setTask(span.taskId || ''); setNext(span.end !== null && dateKey(new Date(span.end)) !== dateKey(new Date(span.start))) }
    // the last half hour, but never before this day's midnight (just after 00:00 that would be a time tonight)
    else { const end = day === dateKey() ? Date.now() : atTime(day, '12:00'); setTitle(''); setCat('deep'); setA(hm(Math.max(atTime(day, '00:00'), end - 30 * 60000))); setB(hm(end)); setTask(''); setNext(false) }
  }, [open, span?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const running = !!live && live.end === null
  // a new stretch starts on the day shown; an edited one at the instant nearest its old start (a stretch shown after midnight stays there)
  const st = !a ? NaN : !span ? atTime(day, a) : [0, 1, -1].map(n => atTime(addDays(dateKey(new Date(span.start)), n), a)).reduce((p, q) => Math.abs(q - span.start) < Math.abs(p - span.start) ? q : p)
  const en = running ? Date.now() : b && !isNaN(st) ? atTime(addDays(dateKey(new Date(st)), next ? 1 : 0), b) : NaN
  const err = isNaN(st) || isNaN(en) ? 'Set both times' : st > Date.now() ? "Start can't be in the future" : en > Date.now() + 60e3 ? "End can't be in the future"
    : !running && en <= st ? (next ? 'Check the times' : 'Ends before it starts — tick “Ends next day” if it ran past midnight') : en - st > 16 * 3600e3 ? 'Over 16h — check the times' : ''
  const save = () => {
    if (err || !title.trim()) return
    if (span) editSpan(span.id, { title: title.trim(), cat, start: st, ...(running ? {} : { end: en }) })
    else addSpan({ taskId: task || undefined, title: title.trim(), cat, start: st, end: en })
    onClose()
  }
  const pick = (id: string) => { setTask(id); const t = tasks.find(x => x.id === id); if (t) { setTitle(t.title); setCat(t.cat) } }
  return (
    <Sheet open={open} onClose={onClose} title={span ? 'Edit stretch' : 'Log work'} actions={<>
      {span && <Btn kind="text" icon="delete" className="danger" onClick={async () => { if (await confirmAsk({ title: 'Delete this stretch?', body: 'Its minutes stop counting.', ok: 'Delete', danger: true })) { deleteSpan(span.id); onClose() } }}>Delete</Btn>}
      <span className="grow" />
      <Btn kind="text" onClick={onClose}>Cancel</Btn>
      <Btn icon="check" onClick={save} disabled={!!err || !title.trim()}>Save</Btn>
    </>}>
      <form className="form" onSubmit={e => { e.preventDefault(); save() }}>
        {!span && tasks.length > 0 && <Field label="For a task (optional)">
          <select className="tm-sel" value={task} onChange={e => pick(e.target.value)}>
            <option value="">— not linked —</option>
            {tasks.map(t => <option key={t.id} value={t.id}>{t.start ? t.start + ' · ' : ''}{t.title}</option>)}
          </select>
        </Field>}
        <Field label="What did you do?"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Read chapter 4" /></Field>
        <div className="row two">
          <Field label="Started"><input type="time" value={a} onChange={e => setA(e.target.value)} /></Field>
          {running ? <Field label="Ended"><div className="tm-running"><i className="dot" /> running</div></Field>
            : <Field label="Ended"><input type="time" value={b} onChange={e => setB(e.target.value)} /></Field>}
        </div>
        {!running && <label className="tm-next small"><input type="checkbox" checked={next} onChange={e => setNext(e.target.checked)} /> Ends next day</label>}
        <div className="tm-readout">{err ? <span className="err small">{err}</span> : <>= <b>{fm((en - st) / 60000)}</b>{span && dateKey(new Date(st)) !== dateKey(new Date(span.start)) ? <span className="small muted"> · moves to {fmtDay(dateKey(new Date(st)))}</span> : null}</>}</div>
        {running && <Btn kind="tonal" icon="stop" onClick={() => { stopSpan(span!.id); onClose() }}>Stop it now</Btn>}
        <div className="field-label">Category</div>
        <Chips value={cat} onChange={setCat} options={(Object.keys(CATS) as Cat[]).map(v => ({ v, label: CATS[v].label, icon: CATS[v].icon }))} />
        {span && <p className="small muted"><Icon n={SRC[span.src].icon} /> {SRC[span.src].label}{span.taskId ? ' · linked to a task' : ''}</p>}
      </form>
    </Sheet>
  )
}

/** a thin strip of the day's log (for the Today card) */
export function LogStrip({ ss, now }: { ss: Span[]; now: number }) {
  if (!ss.length) return null
  const day0 = new Date(ss[0].start); day0.setHours(0, 0, 0, 0)
  const m = (ms: number) => (ms - day0.getTime()) / 60000
  const lo = Math.min(480, Math.floor(m(ss[0].start) / 60) * 60), hi = Math.max(1320, Math.min(1440, Math.ceil(Math.max(...ss.map(x => m(spanEnd(x, now)))) / 60) * 60))
  return (
    <div className="tm-strip" aria-hidden>
      <AnimatePresence>{ss.filter(x => !isAutoBreak(x)).map(x => <motion.i key={x.id} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} className={x.end === null ? 'run' : ''}
        style={{ left: `${(m(x.start) - lo) / (hi - lo) * 100}%`, width: `max(2px, ${(Math.min(hi, m(spanEnd(x, now))) - m(x.start)) / (hi - lo) * 100}%)`, background: toneOf(x.cat).mark }} />)}</AnimatePresence>
      <span style={{ left: 0 }}>{pad(lo / 60)}</span><span style={{ right: 0 }}>{pad((hi / 60) % 24)}</span>
    </div>
  )
}
