import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { addTaskToday, completeTask, dateKey, DEVICE, ensureToday, getState, heartbeat, levelInfo, liveSpans, nowMin, qualifies, checkAchievements, sortTasks, stopSpan, toast, toMin, useStore, type State, type Task } from './store'
import { applyTheme, tierSeed } from './theme'
import { useCf } from './cf'
import { RankUp } from './components/RankUp'
import { FxLayer, Icon } from './components/fx'
import { Shape, WavyBar } from './components/shapes'
import { ConfirmHost, IconBtn, spring, bouncy, useNow } from './components/common'
import { Shortcuts } from './components/Shortcuts'
import { FOCUS_CHAT_EVENT, GO_EVENT, TIMER_TOGGLE_EVENT } from './ui'
import { getCfUser } from './cf'
import { Today } from './components/Today'
import { Focus, Pomodoro, TaskEditor } from './components/Focus'
import { discipline } from './discipline'
import { activeTest, mockChoice, startBlock, startRealRound, startTest } from './train'
import { ContestOverlay, startLiveContest } from './components/ContestMode'
import { contestFor } from './contests'
import { Coach } from './components/Coach'
import { COACH_FOCUS_EVENT } from './review'
import { ideaStats, ideaTaskToday } from './ideas'
import { RES_BY_ID } from './resources'
import { getState as gs } from './store'
import { Plan } from './components/Plan'
import { Train } from './components/Train'
import { Stats } from './components/Stats'
import { Settings } from './components/Settings'
import { StorageBanner } from './components/ErrorBoundary'
import { sfx } from './sound'
import { firstSync, useSync } from './sync'

type Tab = 'today' | 'train' | 'coach' | 'plan' | 'progress'
type ProgView = 'ladder' | 'stats' | 'timeline'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'train', label: 'Train', icon: 'code' },
  { id: 'coach', label: 'Coach', icon: 'forum' },
  { id: 'plan', label: 'Plan', icon: 'edit_calendar' },
  { id: 'progress', label: 'Progress', icon: 'insights' },
]
const isTab = (t: unknown): t is Tab => TABS.some(x => x.id === t)

/** the live discipline score without replaying the whole history on every store change: discipline() reads only the days,
 *  the CP log, the seasons, the settings and the Codeforces list, so it reruns only when one of those (or the minute) changes */
let disMemo: { key: unknown[]; v: number } | null = null
function liveDiscipline(s: State) {
  const key = [s.days, s.cp, s.seasons, s.settings, getCfUser(), Math.floor(Date.now() / 60000)]
  if (!disMemo || key.some((k, i) => k !== disMemo!.key[i])) disMemo = { key, v: discipline(s).live }
  return disMemo.v
}

function useTheme() {
  const st = useStore(s => s.settings)
  const [sysDark, setSysDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => { const m = matchMedia('(prefers-color-scheme: dark)'), f = () => setSysDark(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  const cfRating = useCf().user?.rating || 0
  const seed = st.tierTheme ? tierSeed(cfRating) : st.seed
  useEffect(() => { applyTheme(seed, st.mode === 'system' ? sysDark : st.mode === 'dark', st.style, st.contrast ?? 0, !!st.amoled) }, [seed, st.mode, st.style, st.contrast, st.amoled, sysDark])
}

/** Block-start + streak-at-risk reminders (only if the user granted notification permission). */
function useReminders() {
  const sent = useRef(new Set<string>())
  useEffect(() => {
    const tick = () => {
      ensureToday()
      const s = getState(), k = dateKey(), d = s.days[k]; if (!d) return
      const nm = Math.floor(nowMin())
      const done = d.tasks.filter(t => t.done).length
      document.title = d.tasks.length ? `(${done}/${d.tasks.length}) Momentum` : 'Momentum'
      if (!('Notification' in window) || Notification.permission !== 'granted') return
      for (const t of d.tasks) {
        if (t.done || !t.start) continue
        const id = k + t.id
        if (nm === toMin(t.start) && !sent.current.has(id)) { sent.current.add(id); new Notification(`Now: ${t.title}`, { body: `${t.dur} min block. Start the timer — combo is waiting.`, tag: id }) }
      }
      if (nm >= 21 * 60 && !qualifies(s, k) && d.tasks.length && !sent.current.has(k + 'risk')) {
        sent.current.add(k + 'risk')
        new Notification('Your streak is at risk', { body: `${d.tasks.length - done} tasks left. Don't let today be the day it breaks.` })
      }
    }
    tick(); const t = setInterval(tick, 20000); return () => clearInterval(t)
  }, [])
}

/** the work log's pulse: keeps this device's running span alive (every minute and on coming back to the app) and closes orphans */
function useWorkLog() {
  useEffect(() => {
    const own = () => Object.values(gs().days).flatMap(liveSpans).filter(s => s.end === null && s.dev === DEVICE)
    // a Focus / Pomodoro timer doesn't survive a reload: its span ends at its last sign of life (CP sessions do survive)
    for (const s of own()) if (s.src !== 'cp' && s.src !== 'mock' && s.src !== 'contest') stopSpan(s.id) // a live round's log is kept by its overlay
    const beat = () => {
      const busy = !!gs().cp.active || !!activeTest()
      for (const s of own()) if ((s.src === 'cp' || s.src === 'mock') && !busy) stopSpan(s.id) // its session is gone
      heartbeat()
    }
    beat(); const t = setInterval(beat, 60000)
    document.addEventListener('visibilitychange', beat)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', beat) }
  }, [])
}

export default function App() {
  useTheme(); useReminders(); useWorkLog()
  useEffect(() => { checkAchievements() }, [])
  const [tab, setTab] = useState<Tab>('today')
  const [edit, setEdit] = useState<{ open: boolean; task?: Task }>({ open: false })
  const [focus, setFocus] = useState<Task | null>(null)
  const [settings, setSettings] = useState(false)
  const [pomo, setPomo] = useState<{ label: string; taskId?: string } | null>(null)
  useNow(60000) // the live discipline score follows the clock too
  const dis = useStore(liveDiscipline)
  /** a task's play button does the right thing: CP blocks start the trainer, coach reading opens the resource, study → Pomodoro */
  const startTask = (t: Task) => {
    // a typed block runs exactly its session for its length; an untyped one: free-solve title → free, else the next planned session
    if (t.k === 'cp_practice') { if (!gs().cp.active && !activeTest()) startBlock(t); go('train'); return }
    // a real rated round ("CF: <name>", or a block on a round's start) opens that round and its live protocol, never a mock
    const round = contestFor(t); if (round) { startLiveContest(t, round); return }
    if (t.k === 'cp_mock') { if (!activeTest()) { const c = mockChoice(); c.kind === 'real' && c.pick ? startRealRound(c.pick, t.id) : startTest(t.id) } go('train'); return }
    if (t.ref === 'ideas') { go('train'); setTimeout(() => document.querySelector('.card.ideas')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400); return }
    if (t.k === 'coach' && t.ref && RES_BY_ID.get(t.ref)) { window.open(RES_BY_ID.get(t.ref)!.url, '_blank') }
    // every scheduled task opens its block timer (automatic 55/5 breaks inside); Pomodoro is only the free "Focus session"
    window.dispatchEvent(new CustomEvent('momentum:focus-open', { detail: t.id })) // a minimised timer for this task comes back
    setFocus(t)
  }
  const xp = useStore(s => s.xp), sync = useSync()
  const L = levelInfo(xp)
  const prog = useStore(s => { const d = s.days[dateKey()]; return d ? `${d.tasks.filter(t => t.done).length}/${d.tasks.length}` : '' })
  useEffect(() => { if (!document.title.includes('·')) document.title = prog && !prog.endsWith('/0') ? `(${prog}) Momentum` : 'Momentum' }, [prog])
  const go = (t: Tab) => { if (t !== tab) { sfx.tap(); setTab(t); scrollTo({ top: 0 }) } }
  const [progView, setProgView] = useState<ProgView>('ladder')
  // switch tab from anywhere: dispatchEvent(new CustomEvent('momentum:go', { detail: { tab: 'progress', view: 'timeline' } }))
  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent<{ tab?: string; view?: ProgView }>).detail || {}, t = d.tab === 'stats' ? 'progress' : d.tab
      if (d.view) setProgView(d.view)
      if (isTab(t)) { setTab(t); scrollTo({ top: 0 }) }
    }
    addEventListener(GO_EVENT, f); return () => removeEventListener(GO_EVENT, f)
  }, [])
  const [keys, setKeys] = useState(false)
  /** a timer is on screen (or minimised): Focus, Pomodoro, a CP session or a mock */
  const timerOn = () => !!focus || !!pomo || !!gs().cp.active || !!activeTest()
  const shortcutActions = {
    tab: (i: number) => TABS[i] && go(TABS[i].id),
    add: () => setEdit({ open: true }),
    // space: pause / resume a running timer, else start the block the Now card shows (the running span's task, else the clock's block)
    space: () => {
      if (focus || pomo) { dispatchEvent(new CustomEvent(TIMER_TOGGLE_EVENT)); return }
      if (timerOn()) { toast('CP sessions follow the contest clock — no pause', 'timer'); return }
      const d = gs().days[dateKey()]; if (!d) return
      const nm = nowMin(), run = liveSpans(d).find(x => x.end === null && x.dev === DEVICE && x.cat !== 'break')
      const t = (run?.taskId ? d.tasks.find(x => x.id === run.taskId && !x.done) : undefined) || sortTasks(d.tasks).find(x => !x.done && x.start && toMin(x.start) <= nm && nm < toMin(x.start) + x.dur)
      if (t) startTask(t); else toast('No block right now — press N to add one', 'schedule')
    },
    // m: the same as Escape on a timer (minimise), only when one is running
    minimise: () => { if (timerOn()) dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) },
    chat: () => {
      go('coach')
      const ask = () => dispatchEvent(new CustomEvent(FOCUS_CHAT_EVENT))
      requestAnimationFrame(ask); setTimeout(ask, 450)
      // fallback until the chat listens: the first chat box on the Coach tab
      setTimeout(() => { if (!(document.activeElement instanceof HTMLTextAreaElement)) document.querySelector<HTMLTextAreaElement>('main textarea')?.focus() }, 600)
    },
    help: () => setKeys(true),
  }
  const coachBadge = useStore(s => Object.values(s.cp.coachQs).filter(q => !q.answer).length)
  useEffect(() => { const f = () => setTab('coach'); addEventListener(COACH_FOCUS_EVENT, f); return () => removeEventListener(COACH_FOCUS_EVENT, f) }, [])
  // a daily idea-review block lands in Today when cards are due
  const ideasKey = useStore(s => `${s.days[dateKey()] ? 1 : 0}|${ideaTaskToday()?.title || ''}`)
  // wait for the first pull: stale pre-sync cards must not re-add (and LWW-beat) a block the other device already completed
  const [synced, setSynced] = useState(false)
  useEffect(() => { void firstSync.then(() => setSynced(true)) }, [])
  useEffect(() => {
    if (!synced) return
    const it = ideaTaskToday(), id = 'ideas:' + dateKey(), t = gs().days[dateKey()]?.tasks.find(x => x.id === id)
    if (it && !t) addTaskToday({ id, title: it.title, start: null, dur: it.dur, cat: 'study', k: 'study', ref: 'ideas', u: 0, done: false }) // u 0: any real edit (the other device's completion) beats this auto copy
    // every due card reviewed → the block completes itself (not when the queue emptied only through deletes)
    if (!it && t && !t.done && ideaStats().reviewedToday > 0) completeTask(id)
  }, [ideasKey, synced])

  return (
    <MotionConfig reducedMotion="user">
    <div className="app">
      <nav className="rail" aria-label="Main">
        <div className="rail-logo"><Shape shape="cookie9" size={100} spin={10} /><Icon n="bolt" fill /></div>
        <motion.button className="fab rail-fab" whileTap={{ scale: 0.9, borderRadius: '16px' }} transition={spring} onClick={() => setEdit({ open: true })} aria-label="Add task"><Icon n="add" /></motion.button>
        {TABS.map(t => (
          <button key={t.id} className={'nav-item' + (tab === t.id ? ' on' : '')} onClick={() => go(t.id)} aria-current={tab === t.id ? 'page' : undefined} aria-label={t.id === 'coach' && coachBadge > 0 ? `${t.label}, ${coachBadge} unanswered` : undefined}>
            <span className="nav-ind">{tab === t.id && <motion.span layoutId="rail-ind" className="nav-pill" transition={bouncy} />}<Icon n={t.icon} fill={tab === t.id} />{t.id === 'coach' && coachBadge > 0 && <i className="nav-badge">{coachBadge}</i>}</span>
            <span className="nav-l">{t.label}</span>
          </button>
        ))}
        <button className="rail-keys" onClick={() => setKeys(true)} title="Keyboard shortcuts"><kbd>?</kbd><span>Shortcuts</span></button>
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="brand"><Shape shape="cookie9" size={100} spin={10} className="brand-shape" /><span>Momentum</span></div>
          <button className="lvl-pill" onClick={() => { setProgView('stats'); go('progress') }} title={`${L.into}/${L.need} XP`}>
            <span className="lvl-n">Lv {L.lvl}</span>
            <WavyBar value={L.into / L.need} height={10} className="lvl-bar" />
          </button>
          <button className={'dis-pill' + (dis >= 70 ? ' hi' : dis < 40 ? ' lo' : '')} onClick={() => { setProgView('stats'); go('progress') }} title="Discipline (live): rises as you do what you planned today, falls when you fall behind"><Icon n="shield" fill /><b>{dis}</b></button>
          <button className={'sync-pill ' + sync.state} onClick={() => setSettings(true)} aria-label={'Sync: ' + { off: 'Not synced', idle: 'Sync', syncing: 'Syncing', ok: 'Synced', error: 'Offline' }[sync.state]} title={sync.msg || (sync.at ? 'Last synced ' + new Date(sync.at).toLocaleTimeString() : 'Sync')}>
            <Icon n={{ off: 'cloud_off', idle: 'cloud', syncing: 'cloud_sync', ok: 'cloud_done', error: 'sync_problem' }[sync.state]} fill />
            <span>{{ off: 'Not synced', idle: 'Sync', syncing: 'Syncing', ok: 'Synced', error: 'Offline' }[sync.state]}</span>
          </button>
          <IconBtn icon="settings" title="Settings" onClick={() => setSettings(true)} />
        </header>
        <StorageBanner />

        <AnimatePresence mode="wait">
          <motion.main key={tab} initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
            {tab === 'today' && <Today onEdit={t => setEdit({ open: true, task: t })} onFocus={startTask} onPomodoro={() => setPomo({ label: 'Focus session' })} />}
            {tab === 'train' && <Train onPomodoro={() => setPomo({ label: 'Focus session' })} onLadder={() => { setProgView('ladder'); go('progress') }} />}
            {tab === 'coach' && <Coach onPomodoro={() => setPomo({ label: 'Focus session' })} />}
            {tab === 'plan' && <Plan />}
            {tab === 'progress' && <Stats view={progView} onView={setProgView} />}
          </motion.main>
        </AnimatePresence>
      </div>

      {tab === 'today' && (
        <motion.button className="fab fab-float" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} whileTap={{ scale: 0.9, borderRadius: '18px' }} transition={bouncy}
          onClick={() => setEdit({ open: true })} aria-label="Add task"><Icon n="add" /><span>Task</span></motion.button>
      )}

      <nav className="navbar" aria-label="Main">
        {TABS.map(t => (
          <button key={t.id} className={'nav-item' + (tab === t.id ? ' on' : '')} onClick={() => go(t.id)} aria-current={tab === t.id ? 'page' : undefined} aria-label={t.id === 'coach' && coachBadge > 0 ? `${t.label}, ${coachBadge} unanswered` : undefined}>
            <span className="nav-ind">{tab === t.id && <motion.span layoutId="bar-ind" className="nav-pill" transition={bouncy} />}<Icon n={t.icon} fill={tab === t.id} />{t.id === 'coach' && coachBadge > 0 && <i className="nav-badge">{coachBadge}</i>}</span>
            <span className="nav-l">{t.label}</span>
          </button>
        ))}
      </nav>

      <TaskEditor open={edit.open} task={edit.task} onClose={() => setEdit({ open: false })} />
      {/* timers unmount immediately: an exit animation here never completed, leaving the timer running after Quit/Stop */}
      {focus && <Focus key={focus.id} task={focus} onClose={() => setFocus(null)} />}
      {pomo && <Pomodoro key={pomo.label + (pomo.taskId || '')} label={pomo.label} taskId={pomo.taskId} onClose={() => setPomo(null)} />}
      <Settings open={settings} onClose={() => setSettings(false)} />
      <FxLayer />
      <RankUp />
      <ContestOverlay />
      <ConfirmHost />
      <Shortcuts open={keys} onClose={() => setKeys(false)} actions={shortcutActions} />
    </div>
    </MotionConfig>
  )
}
