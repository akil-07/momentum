import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { CATS, fmtDur, breakCfg, breakMinLeft, dateKey, nowMin, toMin, completeTask, deleteSpan, deleteTask, editSpan, focusMinute, getState, logWork, saveTask, startSpan, stopSpan, toast, type BlockSess, type Cat, type Task } from '../store'
import { GENERIC_RE, retitle } from '../cpblocks'
import { SessionPicker } from './SessionPicker'
import { Shape, WavyRing, type ShapeName } from './shapes'
import { Btn, Chips, Field, Sheet, IconBtn, useEscape } from './common'
import { confirmAsk, fmtClock } from '../ui'
import { Icon } from './fx'
import { buzz, sfx } from '../sound'

const SEQ: ShapeName[] = ['cookie9', 'clover8', 'sunny', 'cookie6', 'flower', 'puffy', 'cookie12', 'gem']
/* the work log: a timer that runs is a span (start → end); pausing, quitting or finishing closes it */
const findSp = (id: string) => { for (const d of Object.values(getState().days)) { const s = d.spans?.[id]; if (s) return s } return undefined }
/** close a running span at `at`; a few seconds (a mis-tap, StrictMode's double mount) leaves no trace.
 *  exact: the timer's own clock decides the end (Pomodoro phases are wall-clock bounded), not the last heartbeat */
function endSp(id: string, at = Date.now(), exact = false) {
  const s = findSp(id); if (!s || s.end !== null) return
  if (at - s.start < 15000) deleteSpan(id, true)
  else if (exact) editSpan(id, { end: Math.max(s.start, at) })
  else stopSpan(id, at)
}

export function Focus({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const [sec, setSec] = useState(0)
  const [run, setRun] = useState(true)
  const [earned, setEarned] = useState(0)
  const acc = useRef(0)
  // if the block is already running, the timer covers what's left of it
  const [mins] = useState(() => { if (!task?.start) return task?.dur || 25; const end = toMin(task.start) + task.dur, nm = nowMin(); return nm > toMin(task.start) && nm < end ? Math.max(5, Math.ceil(end - nm)) : task.dur })
  const secRef = useRef(0), upAlerted = useRef(false)
  /* automatic breaks: after `every` min of work (paused time doesn't count) a `len`-min break; the block timer stops during it */
  const [cfg] = useState(breakCfg)
  const [phase, setPhase] = useState<'work' | 'break'>('work')
  const [brkAt, setBrkAt] = useState(0), [nowB, setNowB] = useState(0)
  const dueSec = useRef(cfg.every * 60) // work second at which the next break is due
  const cut = useRef<number | null>(null), from = useRef<number | null>(null), skipB = useRef(false), resumeAt = useRef<number | null>(null)
  useEffect(() => { if (task) { setSec(0); secRef.current = 0; setRun(true); setEarned(0); acc.current = 0; upAlerted.current = false; setPhase('work'); dueSec.current = cfg.every * 60 } }, [task?.id])
  // log the real time: one span per stretch the timer runs (pause / quit / unmount close it, Done closes it via completeTask);
  // a break is its own Break span (no task, never work). cut / from: the exact moments a break started or ended (wall clock)
  useEffect(() => {
    if (!task || !run) return
    const t0 = from.current; from.current = null
    const id = phase === 'work' ? startSpan({ taskId: task.id, title: task.title, cat: task.cat, src: 'focus' }) : startSpan({ title: 'Break', cat: 'break', src: 'focus' })
    if (t0 !== null && t0 < Date.now() - 1000) editSpan(id, { start: t0 })
    return () => {
      const at = cut.current; cut.current = null
      if (phase === 'break' && skipB.current) { skipB.current = false; deleteSpan(id, true) } // a skipped break leaves nothing
      else at !== null ? endSp(id, at, true) : endSp(id)
    }
  }, [task?.id, run, phase])
  const beginBreak = (at: number) => {
    cut.current = at; from.current = at; setBrkAt(at); setNowB(Date.now()); setPhase('break')
    sfx.level(); buzz([200, 100, 200]); toast(`${cfg.every} min of focus — ${cfg.len} min break. Stand up, water, look away.`, 'self_improvement')
  }
  /** skip: pass the break's start, so the minutes since then count as work (log and clock), as a CP session's skip does */
  const endBreak = (at: number, skip = false) => {
    cut.current = at; from.current = at; resumeAt.current = at; skipB.current = skip
    dueSec.current = secRef.current + cfg.every * 60
    setPhase('work'); sfx.check(3); buzz([80, 40, 80, 40, 80])
    if (!skip) toast('Break over — back to it', 'timer')
  }
  // wall-clock based: a backgrounded tab or a sleeping device still counts the real time, and missed minutes are caught up
  useEffect(() => {
    if (!task || !run || phase !== 'work') return
    const anchor = (resumeAt.current ?? Date.now()) - secRef.current * 1000; resumeAt.current = null
    let done = false
    const tick = () => {
      if (done) return
      let s = Math.floor((Date.now() - anchor) / 1000)
      // a break is due: stop the clock exactly at the mark. Only a little of the block left at the mark: no break then, but
      // working on past the block's end (overtime) takes it there; in overtime breaks keep coming every `every` min of work
      const due = dueSec.current, mark = mins * 60 - due > breakMinLeft(cfg.len) * 60 ? due : Math.max(due, mins * 60)
      const brk = cfg.on && s >= mark
      if (brk) s = mark
      secRef.current = s; setSec(s)
      let n = 0
      while (acc.current < Math.floor(s / 60)) { acc.current++; focusMinute(); n++ }
      if (n) { setEarned(e => e + n); sfx.tick(); buzz(10) }
      if (brk) { done = true; beginBreak(anchor + mark * 1000) }
    }
    tick()
    const t = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [task, run, phase])
  // the break counts down on the wall clock too; if it ended while the device slept, work resumes at its end
  useEffect(() => {
    if (!task || phase !== 'break') return
    const end = brkAt + cfg.len * 60000
    let done = false
    const tick = () => { if (done) return; const n = Date.now(); setNowB(n); if (n >= end) { done = true; endBreak(end) } }
    tick()
    const t = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [task, phase, brkAt])
  useEffect(() => {
    if (!task) return
    const total = mins * 60
    if (sec >= total && !upAlerted.current) { upAlerted.current = true; sfx.level(); buzz([100, 50, 100]); toast('Block time is up — mark it done to bank the XP', 'alarm') }
    document.title = phase === 'break' ? `Break · ${fmt(Math.max(0, (brkAt + cfg.len * 60000 - nowB) / 1000))}` : run ? `${fmt(Math.max(0, total - sec))} · ${task.title}` : 'Paused · Momentum'
    return () => { document.title = 'Momentum' }
  }, [sec, task, run, mins, phase, nowB])
  // leaving the screen never stops the timer: Escape / the minimise button shrink it to a pill
  const [min, setMin] = useState(false)
  useEffect(() => { if (task) setMin(false) }, [task?.id])
  useEffect(() => { const f = () => setMin(false); addEventListener('momentum:focus-open', f); return () => removeEventListener('momentum:focus-open', f) }, [])
  useEscape(() => setMin(true), !!task && !min)
  // the app's play/pause shortcut: pause / resume the work clock (a break runs on its own)
  const phaseRef = useRef(phase); phaseRef.current = phase
  useEffect(() => {
    if (!task) return
    const f = () => { if (phaseRef.current === 'work') setRun(r => !r) }
    addEventListener('momentum:timer-toggle', f); return () => removeEventListener('momentum:timer-toggle', f)
  }, [task?.id])
  const quitRef = useRef(() => {})
  if (!task) return null
  const total = mins * 60, remain = total - sec, over = remain < 0
  const onBrk = phase === 'break', brkLeft = Math.max(0, (brkAt + cfg.len * 60000 - nowB) / 1000)
  const quit = async () => {
    if (sec > 60 && remain > 0 && !await confirmAsk({ title: `End the session with ${fmtDur(Math.ceil(remain / 60))} left?`, body: "Ending early doesn't earn the completion XP. Your logged time stays.", ok: 'End session', cancel: 'Keep going', danger: true })) return
    onClose()
  }
  quitRef.current = quit
  const finish = (e: React.MouseEvent) => { completeTask(task.id, { x: e.clientX, y: e.clientY }); onClose() }
  if (min) return (
    <motion.button className={'cp-mini focus-mini' + (onBrk ? ' on-break' : '')} initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80, opacity: 0 }} onClick={() => setMin(false)} aria-label="Back to the timer">
      <Icon n={onBrk ? 'self_improvement' : run ? 'timer' : 'pause'} fill /><b>{onBrk ? fmt(brkLeft) : `${over ? '+' : ''}${fmt(Math.abs(remain))}`}</b><span>{onBrk ? 'Break' : task.title}</span>
    </motion.button>
  )
  return (
      <motion.div className={'focus' + (onBrk ? ' on-break' : '')} initial={{ opacity: 0, scale: 1.05 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
        <div className="focus-top">
          <span className="badge live"><i className="dot" />{onBrk ? 'BREAK' : 'FOCUS'}</span>
          <span className="row"><span className="muted">+1 XP every minute · {earned} earned</span><IconBtn icon="close_fullscreen" title="Minimise (keeps running)" onClick={() => setMin(true)} /></span>
        </div>
        <div className="focus-center">
          <div className="focus-ring">
            {onBrk ? <>
              <Shape shape="puffy" size={100} spin={3} className="focus-blob" />
              <div className="focus-ring-svg"><WavyRing value={Math.min(1, 1 - brkLeft / (cfg.len * 60))} size={320} stroke={16} amp={2} waves={16} track="color-mix(in srgb, var(--on-tertiary-container) 15%, transparent)" speed={0.4} color="var(--tertiary)" /></div>
              <div className="focus-time">
                <div className="big">{fmt(brkLeft)}</div>
                <div className="muted">Stand up, water, look away · {fmt(Math.max(0, remain))} of the block left</div>
              </div>
            </> : <>
            <Shape shape={SEQ[Math.floor(sec / 20) % SEQ.length]} size={100} spin={run ? 10 : 0} className="focus-blob" />
            <div className="focus-ring-svg"><WavyRing value={Math.min(1, sec / total)} size={320} stroke={16} amp={run ? 5 : 0} waves={16} track="color-mix(in srgb, var(--on-primary-container) 15%, transparent)" speed={run ? 1 : 0} /></div>
            <div className="focus-time">
              <div className={'big' + (over ? ' over' : '')}>{over ? '+' : ''}{fmt(Math.abs(remain))}</div>
              <div className="muted">{over ? 'overtime — finish strong' : run ? 'stay with it' : 'paused'}</div>
            </div>
            </>}
          </div>
          <h1 className="display-sm focus-title">{task.title}</h1>
          <div className="muted">{CATS[task.cat].label} · {fmtDur(task.dur)} block</div>
        </div>
        <div className="focus-actions">
          {onBrk ? <>
            <Btn kind="tonal" size="xl" icon="skip_next" onClick={() => endBreak(brkAt, true)}>Skip break</Btn>
            <Btn kind="tonal" icon="play_arrow" onClick={() => endBreak(Date.now())}>End break early</Btn>
          </> : <Btn kind="tonal" size="xl" icon={run ? 'pause' : 'play_arrow'} onClick={() => setRun(r => !r)}>{run ? 'Pause' : 'Resume'}</Btn>}
          <Btn size="xl" icon="check" onClick={finish}>Done</Btn>
          <Btn kind="text" icon="stop" onClick={() => void quit()}>End session</Btn>
        </div>
      </motion.div>
  )
}
const fmt = fmtClock

const DURS = [15, 25, 30, 45, 60, 90, 120]
type K = NonNullable<Task['k']>
const TYPES: { v: K; label: string; icon: string }[] = [
  { v: 'cp_practice', label: 'CP practice', icon: 'code' }, { v: 'cp_mock', label: 'CP mock', icon: 'timer' },
  { v: 'study', label: 'Study', icon: 'school' }, { v: 'other', label: 'Other', icon: 'more_horiz' },
]
export function TaskEditor({ open, task, onClose }: { open: boolean; task?: Task; onClose: () => void }) {
  const [title, setTitle] = useState(''), [start, setStart] = useState<string>(''), [dur, setDur] = useState(30), [cat, setCat] = useState<Cat>('deep')
  const [k, setK] = useState<K>('other'), [kSet, setKSet] = useState(false), [cp, setCp] = useState<BlockSess | undefined>(undefined), [cpSet, setCpSet] = useState(false)
  useEffect(() => {
    if (!open) return
    setKSet(false); setCpSet(false)
    if (task) { setTitle(task.title); setStart(task.start || ''); setDur(task.dur); setCat(task.cat); setK(task.k && task.k !== 'coach' ? task.k : 'other'); setCp(task.cp) }
    else {
      const d = new Date(); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15)
      setTitle(''); setStart(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`); setDur(30); setCat('deep'); setK('other'); setCp(undefined)
    }
  }, [open, task])
  const pickType = (v: K) => { setK(v); setKSet(true); if (v === 'cp_practice' || v === 'cp_mock') setCat('deep') }
  // a generic title follows the session ("CP practice" → "CP · Learn: 0-1 knapsack")
  const pickSess = (v?: BlockSess) => { setCp(v); setCpSet(true); if (v && GENERIC_RE.test(title)) setTitle(retitle(title, v)) }
  const save = () => {
    if (!title.trim()) return
    // untouched Type / Session chips keep what the task has (a coach task stays one); a saved CP block becomes the student's (saveTask pins it)
    const kk = task && !kSet ? task.k : k === 'other' && !task ? undefined : k
    saveTask({ id: task?.id, title: title.trim(), start: start || null, dur, cat, tpl: task?.tpl, ...(kSet || !task ? { k: kk } : {}),
      ...(cpSet || kSet ? { cp: kk === 'cp_practice' ? cp : undefined } : {}) })
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title={task ? 'Edit task' : 'New task'} actions={<>
      {task && <Btn kind="text" icon="delete" className="danger" onClick={() => { deleteTask(task.id); onClose() }}>Delete</Btn>}
      <span className="grow" />
      <Btn kind="text" onClick={onClose}>Cancel</Btn>
      <Btn icon="check" onClick={save} disabled={!title.trim()}>Save</Btn>
    </>}>
      <form onSubmit={e => { e.preventDefault(); save() }} className="form">
        <Field label="What will you do?"><input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Solve 3 Div2 C problems" /></Field>
        <div className="row two">
          <Field label="Start"><input type="time" value={start} onChange={e => setStart(e.target.value)} /></Field>
          <Field label="Minutes"><input type="number" min={5} max={600} step={5} value={dur} onChange={e => setDur(Math.max(5, +e.target.value || 5))} /></Field>
        </div>
        <Chips value={dur} onChange={setDur} options={DURS.map(v => ({ v, label: v >= 60 ? `${v / 60}h` : `${v}m` }))} />
        <div className="field-label">Type</div>
        <Chips value={k} onChange={pickType} options={TYPES} />
        {k === 'cp_practice' && <SessionPicker value={cp} onChange={pickSess} />}
        <div className="field-label">Category</div>
        <Chips value={cat} onChange={setCat} options={(Object.keys(CATS) as Cat[]).map(v => ({ v, label: CATS[v].label, icon: CATS[v].icon }))} />
        <p className="muted small"><Icon n="info" /> Longer blocks earn more XP. Finishing within the block earns an on-time bonus. Leave start empty for an any-time task.</p>
      </form>
    </Sheet>
  )
}

/* ───────── Pomodoro: work/break cycles for any non-CP study or focus work ───────── */
export function Pomodoro({ label, taskId, onClose }: { label: string; taskId?: string; onClose: () => void }) {
  const st = getState().settings
  const W = (st.pomoWork || 50) * 60, B = (st.pomoBreak || 10) * 60, LB = (st.pomoLong || 20) * 60
  const [phase, setPhase] = useState<'work' | 'break'>('work')
  const [cycle, setCycle] = useState(1)
  const [sec, setSec] = useState(0)
  const [run, setRun] = useState(true)
  const [name, setName] = useState(label)
  const [pmin, setPMin] = useState(false)
  const startedAt = useRef(Date.now())
  const secRef = useRef(0), minsLogged = useRef(0), endAt = useRef(0)
  const total = phase === 'work' ? W : cycle % 4 === 0 ? LB : B
  const [cat] = useState<Cat>(() => (taskId && getState().days[dateKey()]?.tasks.find(t => t.id === taskId)?.cat) || 'study')
  const nameRef = useRef(name); nameRef.current = name
  const key = (c: number) => `pomo:${startedAt.current}:${c}`
  /* a work phase longer than the automatic-break rule (90/15) also takes the `every`/`len` break inside it: the phase clock stops,
   * and the log gets a Break span between two work spans. mini: when that break started (wall clock), null while working */
  const [cfg] = useState(breakCfg)
  const [mini, setMini] = useState<number | null>(null), [nowB, setNowB] = useState(0)
  const dueSec = useRef(cfg.every * 60), cutAt = useRef<number | null>(null), resumeAt = useRef<number | null>(null), fromAt = useRef<number | null>(null), skipMini = useRef(false)
  // wall-clock based so background tabs / a locked device keep correct time
  useEffect(() => {
    if (!run || mini !== null) return
    const anchor = (resumeAt.current ?? Date.now()) - secRef.current * 1000; resumeAt.current = null
    endAt.current = anchor + total * 1000
    let done = false
    const tick = () => {
      if (done) return
      let s = Math.min(total, Math.floor((Date.now() - anchor) / 1000))
      const due = dueSec.current, brk = cfg.on && phase === 'work' && s >= due && total - due > breakMinLeft(cfg.len) * 60
      if (brk) { s = due; done = true }
      secRef.current = s; setSec(s)
      if (brk) {
        const at = anchor + due * 1000
        cutAt.current = at; setNowB(Date.now()); setMini(at)
        sfx.level(); buzz([200, 100, 200]); toast(`${cfg.every} min of work — ${cfg.len} min break. Stand up, water, look away.`, 'self_improvement')
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [run, phase, cycle, mini])
  /** end the in-phase break at `at` (skip: pass its start, the minutes since then count as work) */
  const endMini = (at: number, skip = false) => {
    resumeAt.current = at; fromAt.current = at; skipMini.current = skip; dueSec.current = secRef.current + cfg.every * 60
    setMini(null); sfx.check(3); buzz([80, 40, 80, 40, 80])
    if (!skip) toast('Break over — back to it', 'timer')
  }
  // the in-phase break: its own Break span (never work), counted down on the wall clock (one that ended during sleep ends there)
  useEffect(() => {
    if (mini === null) return
    const id = startSpan({ title: 'Break', cat: 'break', src: 'pomodoro' })
    if (mini < Date.now() - 1000) editSpan(id, { start: mini })
    const end = mini + cfg.len * 60000
    let done = false
    const tick = () => { if (done) return; const n = Date.now(); setNowB(n); if (n >= end) { done = true; endMini(end) } }
    tick()
    const t = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(t); document.removeEventListener('visibilitychange', tick)
      if (skipMini.current) { skipMini.current = false; deleteSpan(id, true) } else endSp(id, Math.min(Date.now(), end), true)
    }
  }, [mini])
  // the work log: a span per running stretch of a WORK phase, closed on break, pause, stop and unmount.
  // From a task it carries the task (its XP is the logged minutes when you mark it done); a free session's span carries the id of
  // the done task logWork books per cycle, so that task's XP is the real minutes and workMin counts them once.
  const span = useRef<string | null>(null)
  const close = (at = Date.now()) => {
    const id = span.current; span.current = null; if (!id) return
    const nm = nameRef.current.trim(); if (nm && findSp(id)?.title !== nm) editSpan(id, { title: nm })
    endSp(id, Math.min(at, endAt.current), true)
  }
  useEffect(() => {
    if (!run || phase !== 'work' || mini !== null) return
    const from = fromAt.current; fromAt.current = null
    span.current = startSpan({ taskId: taskId ?? 'w:' + key(cycle), title: nameRef.current.trim() || label, cat, src: 'pomodoro' })
    if (from !== null && from < Date.now() - 1000) editSpan(span.current, { start: from })
    return () => { const at = cutAt.current; cutAt.current = null; at !== null ? close(at) : close() }
  }, [run, phase, cycle, mini])
  useEffect(() => {
    if (phase === 'work') while (minsLogged.current < Math.floor(sec / 60)) { minsLogged.current++; focusMinute() }
    if (mini !== null) { document.title = `☕ ${fmt(Math.max(0, (mini + cfg.len * 60000 - Date.now()) / 1000))} · ${name}`; return }
    if (sec < total) { document.title = `${phase === 'work' ? '🍅' : '☕'} ${fmt(total - sec)} · ${name}`; return }
    sfx.level(); buzz([120, 60, 120])
    if (phase === 'work') {
      close(endAt.current)
      if (!taskId) logWork(`Pomodoro · ${name}`, total / 60, 'study', undefined, key(cycle))
      toast(cycle % 4 === 0 ? `Cycle ${cycle} done — long break, you earned it` : `Cycle ${cycle} done — ${B / 60} min break`, 'coffee')
      setPhase('break')
    } else { setPhase('work'); setCycle(c => c + 1); toast('Break over — back to it', 'timer') }
    setSec(0); secRef.current = 0; minsLogged.current = 0; dueSec.current = cfg.every * 60
  }, [sec, mini, nowB])
  useEffect(() => () => { document.title = 'Momentum' }, [])
  const stop = () => {
    close()
    if (!taskId && phase === 'work' && sec >= 300) logWork(`Pomodoro · ${name} (partial)`, sec / 60, 'study', undefined, key(cycle))
    onClose()
  }
  useEscape(() => setPMin(true), !pmin)
  // the app's play/pause shortcut: pause / resume (an in-phase break runs on its own)
  const miniRef = useRef(mini); miniRef.current = mini
  useEffect(() => {
    const f = () => { if (miniRef.current === null) setRun(r => !r) }
    addEventListener('momentum:timer-toggle', f); return () => removeEventListener('momentum:timer-toggle', f)
  }, [])
  if (pmin) return (
    <motion.button className={'cp-mini focus-mini' + (phase === 'break' || mini !== null ? ' on-break' : '')} initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80, opacity: 0 }} onClick={() => setPMin(false)} aria-label="Back to the Pomodoro">
      <Icon n={phase === 'break' || mini !== null ? 'coffee' : 'timer'} fill /><b>{mini !== null ? fmt(Math.max(0, (mini + cfg.len * 60000 - nowB) / 1000)) : fmt(Math.max(0, total - sec))}</b><span>{phase === 'break' || mini !== null ? 'Break' : name}</span>
    </motion.button>
  )
  return (
    <motion.div className={'focus pomo ' + phase} initial={{ opacity: 0, scale: 1.05 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
      <div className="focus-top">
        <span className="badge live"><i className="dot" />{mini !== null ? 'BREAK' : phase === 'work' ? `POMODORO ${cycle}` : cycle % 4 === 0 ? 'LONG BREAK' : 'BREAK'}</span>
        <span className="row"><span className="muted">{(st.pomoWork || 50)}/{(st.pomoBreak || 10)} · long break every 4</span><IconBtn icon="close_fullscreen" title="Minimise (keeps running)" onClick={() => setPMin(true)} /><IconBtn icon="close" title="End session" onClick={stop} /></span>
      </div>
      <div className="focus-center">
        <div className="focus-ring">
          <Shape shape={phase === 'work' ? SEQ[Math.floor(sec / 30) % SEQ.length] : 'puffy'} size={100} spin={run ? (phase === 'work' ? 10 : 3) : 0} className="focus-blob" />
          <div className="focus-ring-svg"><WavyRing value={Math.min(1, sec / total)} size={320} stroke={16} amp={run ? 5 : 0} waves={16} track="color-mix(in srgb, var(--on-primary-container) 15%, transparent)" speed={run ? 1 : 0} color={phase === 'work' ? 'var(--primary)' : 'var(--tertiary)'} /></div>
          {mini !== null
            ? <div className="focus-time"><div className="big">{fmt(Math.max(0, (mini + cfg.len * 60000 - nowB) / 1000))}</div><div className="muted">Break · stand up, water, look away · {fmt(Math.max(0, total - sec))} of the pomodoro left</div></div>
            : <div className="focus-time"><div className="big">{fmt(Math.max(0, total - sec))}</div><div className="muted">{phase === 'work' ? (run ? 'deep focus' : 'paused') : 'step away from the screen'}</div></div>}
        </div>
        <input className="pomo-label" aria-label="What are you working on?" value={name} onChange={e => setName(e.target.value)} placeholder="What are you working on?" />
      </div>
      <div className="focus-actions">
        {mini !== null ? <>
          <Btn kind="tonal" size="xl" icon="skip_next" onClick={() => endMini(mini, true)}>Skip break</Btn>
          <Btn kind="tonal" icon="play_arrow" onClick={() => endMini(Date.now())}>End break early</Btn>
        </> : <Btn kind="tonal" size="xl" icon={run ? 'pause' : 'play_arrow'} onClick={() => setRun(r => !r)}>{run ? 'Pause' : 'Resume'}</Btn>}
        {phase === 'break' && <Btn kind="tonal" icon="skip_next" onClick={() => { setPhase('work'); setCycle(c => c + 1); setSec(0); secRef.current = 0; minsLogged.current = 0 }}>Skip break</Btn>}
        <Btn kind="text" icon="stop" onClick={stop}>End session</Btn>
      </div>
    </motion.div>
  )
}
