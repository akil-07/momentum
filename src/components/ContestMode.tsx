import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { getCfUser, getContests, getProb, useCf, type CfContest } from '../cf'
import { takingContest } from '../coach'
import { checkpoints, contestFor, isTakingNow, notTaking, POSITIONS, provisional, radar, skipRule, warmUp, warmWindow, type RadarRound, type RoundDiv } from '../contests'
import { completeTask, dateKey, DEVICE, fmtDur, getState, liveSpans, setCp, startSpan, stopSpan, toast, useStore, type Task } from '../store'
import { activeTest, startPractice, whyServed } from '../train'
import { Btn, IconBtn, spring, useNow } from './common'
import { Icon } from './fx'
import { WavyBar } from './shapes'
import { goTo } from '../ui'
import { fmtClock, ProbLink, Rating } from './cpui'
import '../styles/contest.css'

const DIV_LABEL: Record<RoundDiv, string> = { Div2: 'Div 2', Div3: 'Div 3', Div4: 'Div 4', Edu: 'Edu', 'Div1+2': 'Div 1+2', Global: 'Global' }
const contestUrl = (id: number) => `https://codeforces.com/contest/${id}`
const regUrl = (id: number) => `https://codeforces.com/contestRegistration/${id}`
const until = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h` : fmtDur(m) }
const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** 2 easy problems seeded by the contest id; the session opens on the first, then serves more at the same band */
function startWarmUp(r: { id: number; start: number }) {
  if (getState().cp.active || activeTest()) { toast('Finish the running session first', 'timer'); return }
  const w = warmUp(r)
  if (!w.pids.length) { toast('No fresh warm-up problem found', 'search_off'); return }
  startPractice({ mode: 'speed', tags: [], lo: w.rating, hi: w.rating, minutes: 25, timebox: 1, by: 'user', why: 'Contest warm-up' }, 25)
  const a = getState().cp.active
  if (!a || a.kind !== 'practice' || a.spec?.why !== 'Contest warm-up') return
  const p = w.pids[0], t = Date.now()
  setCp(c => c.active ? { ...c, active: { ...c.active, pids: [p], cur: p, curAt: 0, servedAt: t }, activeU: t } : c)
  whyServed.set(p, 'Contest warm-up — fast and clean')
  toast('Warm-up on: 25 min, easy problems, zero WA', 'local_fire_department')
}

/* jump to the radar from anywhere (Today's banner): opens Train (GO_EVENT), and the radar scrolls itself into view */
let wantRadar = 0
export function goToRadar() {
  wantRadar = Date.now()
  goTo('train')
  requestAnimationFrame(() => document.getElementById('contest-radar')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

/** Today: a compact banner when a rated round starts within 24 h (or is live) */
export function ContestBanner() {
  const now = useNow(30000).getTime(); useCf(); useStore(s => s.cp.triggers)
  const r = radar(2, now).find(x => x.rated && x.season !== 'none' && x.start - now < 864e5)
  if (!r) return null
  const live = now >= r.start, taking = isTakingNow(r.id), regOpen = now >= r.regFrom && !live
  return (
    <section className="contest-banner" aria-label="Rated round soon">
      <Icon n="emoji_events" fill />
      <div className="grow">
        <div className="cb-t">{r.name}</div>
        <div className="small muted">{live ? <b>live now</b> : <>in <b>{until(r.start - now)}</b> · {when(r.start)}</>} · {DIV_LABEL[r.div]}{taking ? ' · you\'re taking it' : ''}</div>
      </div>
      <div className="row wrap">
        {live ? <a className="btn filled sm" href={contestUrl(r.id)} target="_blank" rel="noreferrer"><Icon n="open_in_new" />Open round</a>
          : regOpen && !taking ? <a className="btn tonal sm" href={regUrl(r.id)} target="_blank" rel="noreferrer"><Icon n="how_to_reg" />Register</a> : null}
        <Btn size="sm" kind="text" icon="radar" onClick={goToRadar}>Contest radar</Btn>
      </div>
    </section>
  )
}

/* ═════════ Train card: the radar ═════════ */
export function ContestRadar() {
  const now = useNow(30000).getTime(), cf = useCf(); useStore(s => s.cp.triggers); const busy = useStore(s => !!s.cp.active)
  const list = radar(14, now).slice(0, 6)
  const b = provisional(cf.user)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { if (Date.now() - wantRadar < 5000) { wantRadar = 0; setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80) } }, [])
  return (
    <section className="card radar" id="contest-radar" ref={ref}>
      <div className="card-head"><h3 className="title"><Icon n="radar" fill /> Contest radar</h3><span className="small muted">every rated round, every time</span></div>
      {b && (
        <div className="radar-boost"><Icon n="rocket_launch" fill />
          <div className="grow"><b>{b.text}</b><div className="small">+{b.left} rating still unlocks over your next {6 - b.k} rated rounds. Nothing climbs faster.</div></div>
        </div>
      )}
      {!list.length ? <p className="small muted">No eligible rated round in the next 14 days. Mocks fill the gap.</p> : (
        <ul className="radar-list">{list.map(r => <RadarRow key={r.id} r={r} now={now} busy={busy} />)}</ul>
      )}
      <p className="small muted">Mark a round and you get a warm-up 40 min before, a live protocol during it and a coach review after.</p>
    </section>
  )
}

function RadarRow({ r, now, busy }: { r: RadarRound; now: number; busy: boolean }) {
  const taking = isTakingNow(r.id), live = now >= r.start, regOpen = now >= r.regFrom && !live
  const soon = !live && r.start - now < 3 * 36e5, w = warmWindow(r.start)
  const [warm, setWarm] = useState<string[] | null>(null)
  return (
    <motion.li layout transition={spring} className={'radar-row' + (taking ? ' on' : '') + (live ? ' live' : '')}>
      <div className="radar-top">
        <div className="grow">
          <b className="radar-name">{r.name}</b>
          <div className="small muted">{when(r.start)} · {live ? <b className="radar-live">live now</b> : <>in <b>{until(r.start - now)}</b></>} · {Math.round(r.dur / 60)} min</div>
          <div className="row wrap radar-chips">
            <span className="chip mini">{DIV_LABEL[r.div]}</span>
            {r.mandatory ? <span className="chip mini tert"><Icon n="priority_high" />mandatory</span> : !r.rated ? <span className="chip mini">unrated for you</span> : <span className="chip mini"><Icon n="school" />{r.season === 'none' ? 'exam season · skip' : 'exam season · optional'}</span>}
            {taking && <span className="chip mini on"><Icon n="check" />taking it</span>}
          </div>
        </div>
      </div>
      <div className="row wrap">
        {live ? <a className="btn filled sm" href={contestUrl(r.id)} target="_blank" rel="noreferrer"><Icon n="open_in_new" />Open round</a>
          : <a className={'btn sm ' + (regOpen ? 'filled' : 'text')} href={regOpen ? regUrl(r.id) : 'https://codeforces.com/contests'} target="_blank" rel="noreferrer"><Icon n="how_to_reg" />{regOpen ? 'Register now' : 'Register'}</a>}
        {taking ? <Btn size="sm" kind="text" icon="close" onClick={() => notTaking(r.id)}>Not taking</Btn>
          : <Btn size="sm" kind="tonal" icon="sports_score" onClick={() => takingContest(r.id)}>I'm taking it</Btn>}
        {soon && <Btn size="sm" kind={now >= w.from - 5 * 60000 ? 'filled' : 'outlined'} icon="local_fire_department" disabled={busy || !!activeTest()} onClick={() => startWarmUp(r)}>
          {now >= w.from ? 'Start warm-up' : `Warm-up at ${new Date(w.from).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}</Btn>}
        {soon && !warm && <Btn size="sm" kind="text" onClick={() => setWarm(warmUp(r).pids)}>Preview</Btn>}
      </div>
      {soon && warm && <div className="radar-warm small">{warm.length ? warm.map(p => <ProbLink key={p} pid={p} className="chip mini">{p} <Rating r={getProb(p)?.r} /></ProbLink>) : <span className="muted">Problems still loading</span>}</div>}
    </motion.li>
  )
}

/* ═════════ live-round overlay ═════════ */
interface Live { id: number; name: string; start: number; dur: number; div: RoundDiv }
interface Marks { solved: Record<string, number>; cur?: string; closed?: boolean; min?: boolean; /** the schedule block this round is */ taskId?: string }
const L_KEY = 'momentum.contest.live', mKey = (id: number) => 'momentum.contest.marks.' + id
const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d } catch { return d } }
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }
const AFTER = 3 * 36e5 // show the upsolve panel for 3 h after the end
const MARKS_EVENT = 'momentum:contest-marks'
const spanId = (cid: number) => `contest:${cid}:${DEVICE}`
const hhmm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** play on a round's schedule block: you're taking it, the round opens on Codeforces and the live protocol takes over (not a mock) */
export function startLiveContest(t: Pick<Task, 'id' | 'title'>, c: CfContest) {
  const now = Date.now(), end = c.start + c.dur * 1000
  if (now > end) { toast(`${c.name} is over. Upsolve it from Train`, 'sports_score'); return }
  if (!isTakingNow(c.id)) takingContest(c.id)
  const m = load<Marks>(mKey(c.id), { solved: {} })
  save(mKey(c.id), { ...m, taskId: t.id, min: false, closed: false })
  window.dispatchEvent(new Event(MARKS_EVENT))
  const early = now < c.start - 15 * 60000
  window.open(early ? regUrl(c.id) : contestUrl(c.id), '_blank')
  if (early) toast(`${c.name} starts at ${hhmm(c.start)}. Register now; the live timer opens 15 min before and logs the round`, 'sports_score')
}

function findLive(now: number): Live | null {
  for (const c of getContests()) {
    if (now < c.start - 15 * 60000 || now > c.start + c.dur * 1000 || !isTakingNow(c.id)) continue
    const r = radar(14, now).find(x => x.id === c.id)
    const l: Live = { id: c.id, name: c.name, start: c.start, dur: c.dur, div: r?.div || 'Div2' }
    save(L_KEY, l); return l
  }
  const last = load<Live | null>(L_KEY, null) // finished rounds drop out of the contest list; remember the last one
  return last && now > last.start + last.dur * 1000 && now < last.start + last.dur * 1000 + AFTER && !load<Marks>(mKey(last.id), { solved: {} }).closed ? last : null
}

export function ContestOverlay() {
  useCf(); useStore(s => s.cp.triggers)
  const [fast, setFast] = useState(false)
  const now = useNow(fast ? 1000 : 20000).getTime()
  const live = findLive(now)
  useEffect(() => { if (!!live !== fast) setFast(!!live) }, [!!live, fast])
  return <AnimatePresence>{live && <Overlay key={live.id} c={live} now={now} />}</AnimatePresence>
}

function Overlay({ c, now }: { c: Live; now: number }) {
  const [marks, setMarks] = useState<Marks>(() => load(mKey(c.id), { solved: {} }))
  const put = (m: Marks) => { setMarks(m); save(mKey(c.id), m) }
  useEffect(() => { const f = () => setMarks(load(mKey(c.id), { solved: {} })); addEventListener(MARKS_EVENT, f); return () => removeEventListener(MARKS_EVENT, f) }, [c.id])
  const min = !!marks.min, setMin = (v: boolean) => put({ ...marks, min: v }) // persisted so a reload doesn't re-expand it
  const end = c.start + c.dur * 1000, el = (now - c.start) / 60000, before = now < c.start, over = now >= end
  const cps = checkpoints(c.div, c.dur)
  const cur = marks.cur && marks.solved[marks.cur] === undefined ? marks.cur : cps.find(x => marks.solved[x.pos] === undefined)?.pos
  const curCp = cps.find(x => x.pos === cur)
  const behind = !!curCp && !before && el > curCp.min
  const rule = cur ? skipRule(cps, cur) : ''
  const tap = (pos: string) => {
    if (before || over) return
    if (marks.solved[pos] !== undefined) { const s = { ...marks.solved }; delete s[pos]; put({ ...marks, solved: s, cur: pos }) }
    else if (cur === pos) put({ ...marks, solved: { ...marks.solved, [pos]: Math.round(el) }, cur: undefined })
    else put({ ...marks, cur: pos })
  }
  // the round is work: log it against its schedule block (the one you pressed play on, else today's block for this round)
  const phase = before ? 'before' : over ? 'over' : 'live'
  useEffect(() => {
    const day = getState().days[dateKey(new Date(c.start))]
    const task = day?.tasks.find(x => x.id === marks.taskId) || day?.tasks.find(x => !x.done && contestFor(x, [{ ...c, type: '' }], new Date(c.start))?.id === c.id)
    const sid = spanId(c.id), sp = liveSpans(day).find(x => x.id === sid)
    if (phase === 'live' && !sp) startSpan({ taskId: task?.id, title: task?.title || `CF: ${c.name}`, cat: 'deep', src: 'contest' }, sid)
    if (phase === 'over') {
      if (sp && sp.end === null) stopSpan(sid, end)
      if (task && !task.done && sp) completeTask(task.id) // XP from the logged round time
    }
  }, [phase, marks.taskId, c.id])
  const clock = before ? `-${fmtClock((c.start - now) / 1000)}` : over ? 'over' : fmtClock((end - now) / 1000)
  const upsolve = () => {
    put({ ...marks, closed: true })
    const why = `Upsolve ${c.name}`, subs = getCfUser()?.subs || {}
    const p = POSITIONS[c.div].map(x => String(c.id) + x).find(pid => getProb(pid) && !subs[pid]?.ok && marks.solved[pid.slice(String(c.id).length)] === undefined)
    startPractice({ mode: 'upsolve', tags: [], lo: 800, hi: 3500, minutes: 60, timebox: 1, by: 'user', why }, 60)
    const a = getState().cp.active
    if (!p || !a || a.kind !== 'practice' || a.spec?.why !== why) return
    const t = Date.now() // open on this round's first unsolved problem (same override as the warm-up); the queue serves after it
    setCp(c => c.active ? { ...c, active: { ...c.active, pids: [p], cur: p, curAt: 0, servedAt: t }, activeU: t } : c)
    whyServed.set(p, `${why} — next unsolved, while it's fresh`)
  }

  if (min) return (
    <motion.button className={'cm-pill' + (behind ? ' late' : '')} initial={{ y: -80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -80, opacity: 0 }} transition={spring} onClick={() => setMin(false)}>
      <Icon n="sports_score" fill /><b>{clock}</b>{cur && !over && <span>· {cur}</span>}
    </motion.button>
  )
  return (
    <motion.div className="cm-overlay" role="dialog" aria-label={c.name} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 360, damping: 34 }}>
      <div className="cm-head">
        <div className="grow"><div className="overline">{before ? 'Starting soon' : over ? 'Round finished' : 'Live round'}</div><h2 className="title">{c.name}</h2></div>
        <IconBtn icon="close_fullscreen" title="Minimise" onClick={() => setMin(true)} />
      </div>
      <div className={'cm-clock' + (behind ? ' late' : '')}>{clock}</div>
      {!over && <WavyBar value={before ? 0 : el / (c.dur / 60)} height={16} color={behind ? 'var(--error)' : 'var(--primary)'} />}
      {before && <p className="cm-note">Warm-up done. Template open, water, paper. Read A the second it opens.</p>}
      {!over && <>
        <div className="cm-cps">{cps.map(x => {
          const solved = marks.solved[x.pos] !== undefined, late = !solved && !before && el > x.min, warn = !solved && !late && !before && el > x.min * 0.8
          return (
            <motion.button key={x.pos} whileTap={{ scale: 0.9 }} transition={spring} onClick={() => tap(x.pos)}
              className={'cm-cp' + (solved ? ' ok' : late ? ' late' : warn ? ' warn' : '') + (x.pos === cur ? ' cur' : '')}>
              <b>{x.pos}</b><span>{solved ? `${marks.solved[x.pos]}′` : `≤${x.min}′`}</span>
            </motion.button>)
        })}</div>
        <div className="small cm-hint">Tap a letter to make it current, tap again when it's accepted.</div>
        {rule && <div className={'cm-rule' + (behind ? ' late' : '')}><Icon n={behind ? 'skip_next' : 'rule'} fill />{behind ? <b>{rule} now. Come back later.</b> : <span>Skip rule: {rule}</span>}</div>}
      </>}
      {over && <div className="cm-done">
        <p>You marked {Object.keys(marks.solved).length} solved. The rating update and your submissions sync in on their own, and the coach review runs as soon as the rating is out.</p>
        <p className="small muted">Upsolve the next problem now, while it's fresh. It's worth more than any random practice.</p>
        <div className="row wrap">
          <Btn icon="replay" disabled={!!getState().cp.active || !!activeTest()} onClick={upsolve}>Upsolve now</Btn>
          <Btn kind="text" onClick={() => put({ ...marks, closed: true })}>Done</Btn>
        </div>
      </div>}
      <div className="row wrap cm-links">
        <a className="btn tonal sm" href={contestUrl(c.id)} target="_blank" rel="noreferrer"><Icon n="open_in_new" />Problems</a>
        <a className="btn text sm" href={contestUrl(c.id) + '/my'} target="_blank" rel="noreferrer"><Icon n="list" />My submissions</a>
        {over && <a className="btn text sm" href={contestUrl(c.id) + '/standings'} target="_blank" rel="noreferrer"><Icon n="leaderboard" />Standings</a>}
      </div>
    </motion.div>
  )
}
