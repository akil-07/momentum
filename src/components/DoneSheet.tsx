import { useEffect, useRef, useState } from 'react'
import { addDays, dateKey, fmtDur, getState, isWork, liveSpans, spanEnd, taskMinutes, unionMin, type Task } from '../store'
import { Btn, Chips, Field, Sheet, useNow } from './common'
import { Icon } from './fx'
import { atTime, fm, hm } from './Timeline'
import '../styles/timeline.css'

const DAY = 864e5, MIN = 60000
/** the planned slot if it's already over, else the planned length ending now */
function guess(t: Task, now: number, left = t.dur): [number, number] {
  if (t.start && left >= t.dur) { const s = atTime(dateKey(new Date(now)), t.start), e = s + t.dur * MIN; if (e <= now) return [s, e] }
  return [now - Math.max(1, left) * MIN, now]
}

/** "Done" on a task nobody timed: ask when it really happened, so work time and XP come from real minutes */
export function DoneSheet({ task, onClose, onDone }: { task: Task | null; onClose: () => void; onDone: (t: Task, actual?: { start: number; end: number }) => void }) {
  const now = useNow(15000).getTime()
  const [a, setA] = useState(''), [b, setB] = useState('')
  // keep showing the last task while the sheet slides away
  const last = useRef(task); if (task) last.current = task
  const t = task ?? last.current
  const k0 = dateKey(new Date(now)), day = t ? getState().days[k0] : undefined
  /** what timers already logged for it (a few stray seconds, or part of it) */
  const tracked = t && day ? taskMinutes(day, t.id, now) : undefined
  useEffect(() => { if (task) { const [s, e] = guess(task, Date.now(), task.dur - (tracked || 0)); setA(hm(s)); setB(hm(e)) } }, [task?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const k = dateKey(new Date(now))
  // the end is today; a start later than the end means it began yesterday evening
  const en = b ? atTime(k, b) : NaN
  let st = a ? atTime(k, a) : NaN
  if (st >= en) st -= DAY
  const mins = (en - st) / MIN
  const err = isNaN(st) || isNaN(en) ? 'Set both times' : en > now + MIN ? "That's in the future" : mins > 16 * 60 ? 'Over 16h — check the times' : mins < 1 ? 'Too short' : ''
  // time already logged inside this stretch (a timer, another task): work time counts it once
  const ov = err ? 0 : unionMin([getState().days[addDays(k, -1)], getState().days[k]].flatMap(liveSpans).filter(x => isWork(x.cat) && x.start < en && spanEnd(x, now) > st)
    .map(x => ({ ...x, start: Math.max(x.start, st), end: Math.min(spanEnd(x, now), en) })), now)
  const chips: { l: string; s: number; e: number }[] = []
  if (t) {
    if (t.start) { const s = atTime(k, t.start); if (s < now) chips.push({ l: `Planned ${t.start}–${hm(Math.min(now, s + t.dur * MIN))}`, s, e: Math.min(now, s + t.dur * MIN) }) }
    chips.push({ l: `Just now · ${fmtDur(t.dur)}`, s: now - t.dur * MIN, e: now })
    for (const m of [15, 30, 60, 120]) if (m !== t.dur) chips.push({ l: `${fmtDur(m)} ending now`, s: now - m * MIN, e: now })
  }
  const submit = () => { if (t && !err) onDone(t, { start: st, end: Math.min(en, Date.now()) }) }
  return (
    <Sheet open={!!task} onClose={onClose} title="When did you do it?" actions={<>
      <Btn kind="text" onClick={() => t && onDone(t)} className="tm-skip">{tracked !== undefined ? `Count only the ${fm(tracked)} logged` : "I didn't time it — use the planned length"}</Btn>
      <Btn icon="check" onClick={submit} disabled={!!err}>Done</Btn>
    </>}>
      {t && <form className="form" onSubmit={e => { e.preventDefault(); submit() }}>
        <p className="tm-ds-t"><b>{t.title}</b><span className="small muted"> · planned {t.start ? `${t.start}, ` : ''}{fmtDur(t.dur)}</span></p>
        <div className="tm-ds-chips">
          <Chips value={chips.find(c => hm(c.s) === a && hm(c.e) === b)?.l ?? ''} options={chips.map(c => ({ v: c.l, label: c.l }))}
            onChange={l => { const c = chips.find(x => x.l === l); if (c) { setA(hm(c.s)); setB(hm(c.e)) } }} />
        </div>
        <div className="row two">
          <Field label="Started"><input type="time" value={a} onChange={e => setA(e.target.value)} /></Field>
          <Field label="Finished"><input type="time" value={b} onChange={e => setB(e.target.value)} /></Field>
        </div>
        <div className="tm-readout">{err ? <span className="err small">{err}</span> : <>= <b>{fm(mins)}</b>{st < atTime(k, '00:00') ? <span className="small muted"> · started yesterday</span> : null}{tracked ? <span className="small muted"> · + {fm(tracked)} already logged</span> : null}</>}</div>
        {ov >= 1 && <p className="small tm-warn"><Icon n="warning" /> {fm(ov)} of this overlaps time already logged. Work time counts it once.</p>}
        <p className="small muted"><Icon n="info" /> XP and work time count these minutes (up to 2× the plan).</p>
      </form>}
    </Sheet>
  )
}
