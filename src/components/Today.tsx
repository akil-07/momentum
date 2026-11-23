import { AnimatePresence, motion } from 'motion/react'
import { contestFor } from '../contests'
import { useState } from 'react'
import {
  CATS, COMBO_WINDOW, isAutoBreak, addDays, bumpGoal, completeTask, dateKey, dayPct, fmtDur, fmtMin, nowMin, workMin, bestWorkDay, keyToDate,
  pullLeftovers, applyTemplateToToday, sortTasks, streakMult, streakOf, toMin, uncompleteTask, useStore, taskMinutes, taskSpans, spanMin, type Day, type Task, liveSpans, DEVICE } from '../store'
import { DoneSheet } from './DoneSheet'
import { LogStrip, dayLog, fm, openTimeline } from './Timeline'
import { Icon } from './fx'
import { DoNowCard } from './CoachPanel'
import { ContestBanner } from './ContestMode'
import { EnergyCheck } from './Energy'
import { Shape, WavyBar, WavyRing, type ShapeName } from './shapes'
import { Btn, IconBtn, bouncy, spring, useNow } from './common'
import { sfx } from '../sound'
import { cpLabel, MODE_ICON } from '../cpblocks'
import { ANY_TIME } from '../ui'
import '../styles/today.css'

const toneVar = (tone: string) => tone === 'neutral'
  ? { bg: 'var(--surface-container-highest)', fg: 'var(--on-surface-variant)' }
  : { bg: `var(--${tone}-container)`, fg: `var(--on-${tone}-container)` }

function greeting(h: number) { return h < 5 ? 'Still up?' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Night shift' }

export function Today({ onEdit, onFocus, onPomodoro, onTimeline }: { onEdit: (t?: Task) => void; onFocus: (t: Task) => void; onPomodoro?: () => void; onTimeline?: () => void }) {
  const now = useNow(10000)
  const k = dateKey(now)
  const d = useStore(s => s.days[k])
  const yDay = useStore(s => s.days[addDays(k, -1)])
  const name = useStore(s => s.settings.name), threshold = useStore(s => s.settings.threshold)
  const goals = useStore(s => s.goals), freezes = useStore(s => s.freezes), streak = useStore(s => streakOf(s, k))
  const [ask, setAsk] = useState<{ t: Task; pos: { x: number; y: number } } | null>(null)
  if (!d) return null
  /** timed tasks (a running timer, or at least half the plan logged) complete straight away; the rest ask when they really happened */
  const finish = (t: Task, pos: { x: number; y: number }) => {
    if (taskSpans(d, t.id).some(x => x.end === null) || (taskMinutes(d, t.id) ?? 0) >= t.dur / 2) { completeTask(t.id, pos); return true }
    setAsk({ t, pos }); return false
  }
  const tasks = sortTasks(d.tasks)
  const done = d.tasks.filter(t => t.done).length, total = d.tasks.length, pct = dayPct(d)
  const needed = Math.max(0, Math.ceil(total * threshold / 100 - 1e-9) - done)
  const nm = nowMin(now)
  // a running timer wins: the Now card shows what you're actually doing, not just the clock's block
  const runSp = liveSpans(d).find(x => x.end === null && x.dev === DEVICE && x.cat !== 'break'), runTask = runSp?.taskId ? d.tasks.find(t => t.id === runSp.taskId && !t.done) : undefined
  const current = runTask || tasks.find(t => !t.done && t.start && toMin(t.start) <= nm && nm < toMin(t.start) + t.dur)
  const next = tasks.find(t => !t.done && t.start && toMin(t.start) > nm)
  const overdue = tasks.filter(t => !t.done && t.start && toMin(t.start) + t.dur < nm).length
  const comboLeft = d.lastDoneAt ? COMBO_WINDOW - (now.getTime() - d.lastDoneAt) / 60000 : 0
  const comboAlive = d.combo >= 1 && comboLeft > 0 && done < total
  const yLeft = (yDay?.tasks || []).filter(t => !t.done && !t.tpl).length

  const heroShape: ShapeName = pct >= 1 ? 'burst' : pct >= 0.8 ? 'sunny' : pct >= 0.5 ? 'cookie9' : pct > 0 ? 'cookie6' : 'cookie4'

  const nowCard = (current || next) && (() => {
    const t = (current || next)!, st = t.start ? toMin(t.start) : nm, el = nm - st, running = !!runTask && t.id === runTask.id
    const logged = taskMinutes(d, t.id, now.getTime()) ?? 0
    return (
      <section className={'now card' + (current ? ' live' : '')} aria-label={current ? 'Now' : 'Next'}>
        <div className="now-top">
          <span className={'badge' + (current ? ' live' : '')}>{running ? <><i className="dot" />FOCUSING</> : current ? <><i className="dot" />NOW</> : `NEXT · in ${fmtDur(Math.ceil(st - nm))}`}</span>
          <span className="muted">{t.start ? `${t.start}–${fmtMin(st + t.dur)}` : ANY_TIME}</span>
        </div>
        <h2 className="headline now-title">{t.title}</h2>
        {running ? <><WavyBar value={Math.min(1, logged / t.dur)} height={16} /><div className="muted small">{fm(logged)} logged of {fmtDur(t.dur)} · timer running</div></>
          : current && <><WavyBar value={el / t.dur} height={16} /><div className="muted small">{fmtDur(Math.ceil(t.dur - el))} left in this block</div></>}
        <div className="row wrap">
          <Btn size="lg" icon={running ? 'open_in_full' : 'play_arrow'} onClick={() => onFocus(t)}>{running ? 'Back to timer' : 'Start focus'}</Btn>
          <Btn size="lg" kind="tonal" icon="check" onClick={e => finish(t, { x: e.clientX, y: e.clientY })}>Done</Btn>
        </div>
      </section>
    )
  })()

  return (
    <div className="view today">
      <header className="greet">
        <div>
          <div className="overline">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1 className="display-sm">{greeting(now.getHours())}{name ? `, ${name}` : ''}</h1>
        </div>
      </header>
      <ContestBanner />

      <div className="cols side-first">
        {/* side first in the DOM: on a phone the Now card leads; on a laptop it's the sticky right column */}
        <aside className="col-side" aria-label="Now and today's numbers">
          {nowCard}
          {/* ───── combo ───── */}
          <AnimatePresence>
            {comboAlive && (
              <motion.section className="combo card" initial={{ opacity: 0, height: 0, scale: 0.95 }} animate={{ opacity: 1, height: 'auto', scale: 1 }} exit={{ opacity: 0, height: 0 }} transition={spring}>
                <div className="combo-badge"><Shape shape="burst" size={100} spin={50} style={{ color: 'var(--tertiary)' }} /><span>×{d.combo}</span></div>
                <div className="grow">
                  <div className="combo-title">Combo ×{d.combo} active — next task pays <b>×{(1 + Math.min(d.combo, 6) * 0.15).toFixed(2)}</b></div>
                  <WavyBar value={comboLeft / COMBO_WINDOW} color="var(--tertiary)" track="var(--tertiary-container)" />
                  <div className="muted small">Finish something in the next {fmtDur(Math.ceil(comboLeft))} or the combo dies.</div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
          <DoNowCard onPomodoro={onPomodoro} />
          <WorkMeter />
          {goals.length > 0 && (
            <section className={'card goals' + (goals.length === 1 ? ' single' : '')}>
              {goals.length > 1 && <div className="card-head"><h3 className="title"><Icon n="flag" fill /> Daily goals</h3><span className="muted small">{goals.filter(g => (d.goals[g.id] || 0) >= g.target).length}/{goals.length} hit</span></div>}
              <div className="goal-grid">
                {goals.map((g, i) => {
                  const v = d.goals[g.id] || 0, hit = v >= g.target
                  return (
                    <motion.div key={g.id} className={'goal' + (hit ? ' hit' : '')} layout>
                      <div className="goal-top">
                        <div className="goal-ic"><Shape shape={hit ? 'sunny' : (['cookie6', 'clover4', 'puffy', 'gem', 'flower'] as ShapeName[])[i % 5]} size={100} /><Icon n={hit ? 'check' : g.icon} fill /></div>
                        <div className="goal-val"><b>{v}</b>/{g.target}<span className="small"> {g.unit}</span>{hit && <span className="sr-only"> (goal hit)</span>}</div>
                      </div>
                      <div className="goal-t">{g.title}</div>
                      <WavyBar value={v / g.target} height={10} wave={hit} color={hit ? 'var(--tertiary)' : 'var(--primary)'} />
                      <div className="btn-group">
                        <IconBtn icon="remove" kind="tonal" title={`Decrease ${g.title}`} onClick={() => bumpGoal(g.id, -1)} />
                        <IconBtn icon="add" kind="filled" title={`Increase ${g.title}`} onClick={() => bumpGoal(g.id, 1)} />
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </section>
          )}
          <EnergyCheck />
        </aside>

        <div className="col-main">
          {/* ───── hero ───── */}
          <motion.section className="hero card" layout transition={spring}>
            <div className="hero-ring">
              <Shape shape={heroShape} size={100} spin={pct >= 1 ? 30 : 6} className="hero-blob" />
              <div className="hero-ring-svg"><WavyRing value={pct} size={220} stroke={13} amp={pct >= 1 ? 6 : 4} waves={pct >= 1 ? 16 : 12} track="color-mix(in srgb, var(--on-primary-container) 14%, transparent)" color="var(--primary)" /></div>
              <div className="hero-center">
                <motion.div key={done} className="hero-pct" initial={{ scale: 1.4 }} animate={{ scale: 1 }} transition={bouncy}>{Math.round(pct * 100)}<small>%</small></motion.div>
                <div className="hero-sub">{done}/{total} done</div>
              </div>
            </div>
            <div className="hero-info">
              {total === 0 ? <>
                <h2 className="headline">Your day is empty.</h2>
                <p>An empty plan is a lost day. Load your routine from the schedule below, or add a task.</p>
                <div className="row wrap"><Btn kind="tonal" icon="add" onClick={() => onEdit()}>Add task</Btn></div>
              </> : pct >= 1 ? <>
                <h2 className="headline">Perfect day.</h2>
                <p>Every single block, done. This is who you are now.</p>
              </> : <>
                <h2 className="headline">{needed > 0 ? <>{needed} more to <span className="hl">secure your streak</span></> : <>{total - done} left for a <span className="hl">perfect day</span></>}</h2>
                {overdue > 0 && <p><b className="err"><Icon n="schedule" /> {overdue} overdue</b></p>}
              </>}
              <div className="stat-chips">
                <div className={'stat-chip fire' + (streak ? ' lit' : '')}><Icon n="local_fire_department" fill /><b>{streak}</b><span>day streak</span></div>
                <div className="stat-chip"><Icon n="bolt" fill /><b>×{streakMult(streak).toFixed(2)}</b><span>streak boost</span></div>
                <div className="stat-chip"><Icon n="ac_unit" fill /><b>{freezes}</b><span>freeze{freezes === 1 ? '' : 's'}</span></div>
              </div>
            </div>
          </motion.section>

          {/* ───── schedule ───── */}
          <section className="card timeline">
            <div className="card-head">
              <h3 className="title"><Icon n="view_timeline" fill /> Schedule</h3>
              <div className="row">
                {yLeft > 0 && <Btn kind="text" size="sm" icon="move_down" onClick={pullLeftovers}>Carry {yLeft}</Btn>}
                <Btn kind="text" size="sm" icon="playlist_add" onClick={applyTemplateToToday}>Load routine</Btn>
              </div>
            </div>
            <motion.ul className="tl" layout>
              <AnimatePresence initial={false}>
                {tasks.map(t => <TaskRow key={t.id} t={t} d={d} now={now.getTime()} nm={nm} onEdit={onEdit} onFocus={onFocus} onFinish={finish} />)}
              </AnimatePresence>
            </motion.ul>
            {total === 0 && <p className="muted empty">Nothing scheduled. Tap + to add your first block.</p>}
          </section>

          <DidCard d={d} now={now.getTime()} onTimeline={onTimeline || openTimeline} />
        </div>
      </div>
      <DoneSheet task={ask?.t || null} onClose={() => setAsk(null)} onDone={(t, actual) => { const p = ask?.pos; setAsk(null); completeTask(t.id, p, actual) }} />
    </div>
  )
}

function TaskRow({ t, d, now, nm, onEdit, onFocus, onFinish }: { t: Task; d: Day; now: number; nm: number; onEdit: (t: Task) => void; onFocus: (t: Task) => void; onFinish: (t: Task, pos: { x: number; y: number }) => boolean }) {
  const st = t.start ? toMin(t.start) : null
  const state = t.done ? 'done' : st === null ? 'anytime' : nm >= st + t.dur ? 'late' : nm >= st ? 'live' : 'upcoming'
  const c = CATS[t.cat], tv = toneVar(c.tone)
  const [burst, setBurst] = useState(0)
  const toggle = (e: React.MouseEvent) => {
    if (t.done) { sfx.undo(); uncompleteTask(t.id) }
    else { setBurst(b => b + 1); onFinish(t, { x: e.clientX, y: e.clientY }) }
  }
  const logged = taskMinutes(d, t.id, now), run = taskSpans(d, t.id).find(x => x.end === null)
  return (
    <motion.li layout className={'task ' + state} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40, height: 0, padding: 0 }} transition={spring}>
      <div className="task-time">
        {t.start ? <><b>{t.start}</b><span>{fmtMin(st! + t.dur)}</span></> : <span aria-label={ANY_TIME}>any<br />time</span>}
      </div>
      <motion.button className="check" onClick={toggle} whileTap={{ scale: 0.8 }} transition={bouncy} aria-label={t.done ? 'Mark not done' : 'Mark done'} style={{ color: tv.bg }}>
        <Shape shape={t.done ? 'cookie9' : 'square'} size={100} rotate={t.done ? 45 : 0} fill={t.done ? 'var(--primary)' : 'currentColor'} />
        <AnimatePresence>{t.done && <motion.span className="check-ic" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={bouncy}><Icon n="check" /></motion.span>}</AnimatePresence>
        {!t.done && <span className="check-cat" style={{ color: tv.fg }}><Icon n={c.icon} /></span>}
        <AnimatePresence>{burst > 0 && t.done && <motion.span key={burst} className="ripple-burst" initial={{ scale: 0.6, opacity: 0.7 }} animate={{ scale: 2.4, opacity: 0 }} transition={{ duration: 0.6 }} />}</AnimatePresence>
      </motion.button>
      <button className="task-body" onClick={() => onEdit(t)}>
        <div className="task-title">{t.title}</div>
        <div className="task-meta">
          {logged !== undefined ? <span className="tm-vs" title="logged / planned"><b>{fm(logged)}</b> / {fmtDur(t.dur)}{t.done ? ' logged' : ''}</span> : <span>{fmtDur(t.dur)}</span>}<span>·</span><span>{c.label}</span>
          {run && <span className="tm-run"><i className="dot" />running {fm(spanMin(run, now))}</span>}
          {state === 'live' && <span className="badge live sm"><i className="dot" />now</span>}
          {state === 'late' && <span className="badge err sm">late</span>}
          {t.ai && <span className="chip mini tert"><Icon n="auto_awesome" /> planned</span>}
          {t.k === 'coach' && <span className="chip mini tert"><Icon n="psychology" /> coach</span>}
          {(t.k === 'cp_practice' || t.k === 'cp_mock') && !t.cp && <span className="chip mini on">{t.k === 'cp_mock' ? (contestFor(t) ? 'contest' : 'mock') : 'CP'}</span>}
          {t.k === 'cp_practice' && t.cp && <span className="chip mini on" title="What the play button runs"><Icon n={MODE_ICON[t.cp.mode]} /> {cpLabel(t.cp)}</span>}
          {t.done && t.xp ? <span className="xp-tag">+{t.xp} XP{t.ontime ? ' · on time' : ''}</span> : null}
        </div>
      </button>
      {!t.done && <IconBtn icon="play_arrow" title="Focus on this" kind={state === 'live' ? 'filled' : 'standard'} onClick={() => onFocus(t)} />}
      {state === 'live' && <div className="live-bar"><WavyBar value={(nm - st!) / t.dur} height={8} /></div>}
    </motion.li>
  )
}

function WorkMeter() {
  const now = useNow(30000), k = dateKey(now), y = addDays(k, -1)
  const d = useStore(s => s.days[k]), yd = useStore(s => s.days[y]), target = useStore(s => s.settings.workTarget) * 60
  const best = useStore(s => bestWorkDay(s, k))
  const w = workMin(d)
  const yAt = keyToDate(y); yAt.setHours(now.getHours(), now.getMinutes(), now.getSeconds())
  const ghost = workMin(yd, yAt.getTime()), diff = w - ghost
  const hasHistory = !!yd
  const hit = w >= target
  return (
    <section className={'work card' + (hit ? ' hit' : '')}>
      <div className="work-top">
        <div>
          <div className="overline">Real work today</div>
          <motion.div key={w} className="work-n" initial={{ scale: 1.15 }} animate={{ scale: 1 }} transition={bouncy}>{Math.floor(w / 60)}<small>h</small> {w % 60}<small>m</small></motion.div>
        </div>
        <div className="work-ic"><Shape shape={hit ? 'burst' : 'cookie7'} size={100} spin={hit ? 20 : 4} /><Icon n="work" fill /></div>
      </div>
      <WavyBar value={w / target} height={18} />
      <div className="work-rows">
        <div><Icon n="flag" fill /> {hit ? <>Target of {fmtDur(target)} smashed — <b>every extra minute counts</b></> : <><b>{fmtDur(target - w)}</b> left to your {fmtDur(target)} target</>}</div>
        {hasHistory && <div className={diff < 0 ? 'behind' : 'ahead'}><Icon n={diff < 0 ? 'trending_down' : 'trending_up'} fill /> {diff < 0 ? <><b>{fmtDur(-diff)} behind</b> yesterday's pace at this time</> : diff > 0 ? <><b>{fmtDur(diff)} ahead</b> of yesterday at this time — widen the gap</> : <>Neck and neck with yesterday</>}</div>}
        {best > 0 && <div><Icon n="emoji_events" fill /> {w > best ? <><b>New personal record</b> (old best {fmtDur(best)})</> : <>Record {fmtDur(best)} — <b>{fmtDur(best - w + 1)}</b> to break it</>}</div>}
      </div>
    </section>
  )
}

/** what the log says you actually did today */
function DidCard({ d, now, onTimeline }: { d: Day; now: number; onTimeline: () => void }) {
  const L = dayLog(d, now)
  return (
    <section className="card tm-did">
      <div className="card-head">
        <h3 className="title"><Icon n="history" fill /> What you did today</h3>
        <button className="linkish small tm-link" onClick={onTimeline}>Timeline</button>
      </div>
      {L.ss.length || L.untimed ? <>
        <div className="tm-did-n small muted">{L.n} stretch{L.n === 1 ? '' : 'es'} · {fm(L.total)} logged{L.untimed ? ` · +${fm(L.untimed)} untimed` : ''}</div>
        <LogStrip ss={L.ss} now={now} />
        {L.running && <div className="small tm-run"><i className="dot" />{isAutoBreak(L.running) ? `On a break · ${fm(spanMin(L.running, now))}` : `${L.running.title} · running ${fm(spanMin(L.running, now))}`}</div>}
      </> : <p className="small muted">Nothing logged yet. Timers log it — or say when you did it as you tick a task off.</p>}
    </section>
  )
}
