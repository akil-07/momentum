import { withMath } from './MathText'
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { breakIn, dateKey, getState, toast, useStore, type CoachMsg } from '../store'
import { QUICK, TODAY_CAP, answerQuestion, askCoach, addTodoToToday, coachPrompt, markSent, noteCoachGen, noteCoachReset, openTodos, todoDone, type Todo } from '../coach'
import { RES_BY_ID } from '../resources'
import { dismiss, resetSession, sessionInfo, useTurns } from '../claude'
import { getSyncCfg, useSync } from '../sync'
import { DEEP_LOCK, activeTest, logResource, mockChoice, startPractice, startRealRound, startTest, todaySpecs } from '../train'
import { Btn, IconBtn, copyText, spring, useAutoScroll } from './common'
import { confirmAsk, promptAsk } from '../ui'
import { Icon } from './fx'
import { Loader, Shape } from './shapes'
import { ReviewSheet } from './ReviewSheet'
import { COACH_FOCUS_EVENT } from '../review'
import '../styles/review.css'

/* ═════════ the one-to-one coach: "do this now", chat, questions, todos, weakness board ═════════ */

/** tiny markdown: paragraphs, "- " bullets, **bold**, `code`, ```fenced code blocks``` (with a copy button) */
/** markdown-lite; `math` also renders $…$ / $$…$$ / $$$…$$$ with KaTeX (flashcards, statements) */
export function Md({ text, math = false }: { text: string; math?: boolean }) {
  const fmt = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => p.startsWith('**') && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith('`') && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code> : <Fragment key={i}>{p}</Fragment>)
  const inline = (s: string) => math ? withMath(s, t => fmt(t)) : fmt(s)
  const blocks: ReactNode[] = []
  let list: string[] = [], ordered = false, code: string[] | null = null, lang = ''
  const flush = () => {
    if (!list.length) return
    const items = list.map((l, i) => <li key={i}>{inline(l)}</li>)
    blocks.push(ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>); list = []
  }
  const flushCode = () => { if (code) { blocks.push(<CodeBlock key={blocks.length} code={code.join('\n')} lang={lang} />); code = null } }
  for (const line of text.split('\n')) {
    const fence = line.match(/^\s*```\s*([\w+#.-]*)\s*$/)
    if (code) { if (fence && !fence[1]) flushCode(); else code.push(line); continue }
    if (fence) { flush(); code = []; lang = fence[1]; continue }
    const m = line.match(/^\s*(?:([-*•])|\d+[.)])\s+(.*)/)
    if (m) { const o = !m[1]; if (list.length && o !== ordered) flush(); ordered = o; list.push(m[2]) }
    else { flush(); if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>) }
  }
  flush(); flushCode() // an unterminated fence still renders as code
  return <div className="md">{blocks}</div>
}
function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="md-pre">
      {lang && <span className="md-lang">{lang}</span>}
      <button type="button" className="md-copy" title="Copy code" aria-label="Copy code" onClick={async () => toast(await copyText(code) ? 'Code copied' : 'Could not copy', 'content_copy')}><Icon n="content_copy" /></button>
      <pre><code>{code}</code></pre>
    </div>
  )
}

const ACTION_ICON: Record<string, string> = { read: 'menu_book', practice: 'play_arrow', mock: 'sports_score', pomodoro: 'timer', contest: 'emoji_events', rest: 'bedtime', upsolve: 'replay', resolve: 'autorenew', todo: 'task_alt', none: 'arrow_forward' }

export function DoNowCard({ onPomodoro }: { onPomodoro?: () => void }) {
  const n = useStore(s => s.cp.coachNow)
  const pend = useTurns('coach').filter(t => t.state !== 'done' && t.state !== 'error')
  const off = useSync().state === 'off'
  const [reading, setReading] = useState<{ ref: string; at: number } | null>(null)
  const go = () => {
    if (!n) return
    const res = RES_BY_ID.get(n.ref)
    if (n.action === 'read' && res) { window.open(res.url, '_blank'); setReading({ ref: res.id, at: Date.now() }); return }
    if (n.action === 'practice' || n.action === 'upsolve' || n.action === 'resolve') {
      const spec = todaySpecs().find(s => s.mode === n.action || (n.ref && s.tags.includes(n.ref)))
      startPractice(spec ?? (n.action !== 'practice' ? { mode: n.action as 'upsolve' | 'resolve', tags: [], lo: 800, hi: 3500, minutes: n.minutes || 60, timebox: 1, by: 'coach' } : undefined), n.minutes || undefined)
      return
    }
    if (n.action === 'mock') { if (!activeTest()) { const c = mockChoice(); if (!c.offer) toast(c.why, 'event_busy'); else if (c.kind === 'real' && c.pick) startRealRound(c.pick); else startTest() } return } // no mock today (season / rated round): say why
    if (n.action === 'pomodoro') { onPomodoro?.(); return }
    if (n.action === 'contest') { window.open('https://codeforces.com/contests', '_blank'); return }
    if (n.action === 'todo') { const t = openTodos()[0]; if (t) { addTodoToToday(t.id); toast('Added to Today', 'task_alt') } }
  }
  return (
    <section className="card donow">
      <div className="donow-ic"><Shape shape="sunny" size={100} spin={8} /><Icon n={ACTION_ICON[n?.action || 'none'] || 'arrow_forward'} fill /></div>
      <div className="grow">
        <div className="overline">Do this now</div>
        {n ? <div className="donow-t">{n.text}{n.minutes ? <span className="muted small"> · {n.minutes} min</span> : null}</div> : <div className="donow-t muted">Ask your coach what to do next.</div>}
        {reading && <div className="row wrap" style={{ marginTop: 8 }}>
          <span className="small">Reading since {new Date(reading.at).toTimeString().slice(0, 5)}</span>
          <Btn size="sm" kind="tonal" icon="done" onClick={() => { logResource(reading.ref, (Date.now() - reading.at) / 60000); setReading(null); toast('Reading logged for your coach', 'menu_book') }}>Done reading</Btn>
        </div>}
      </div>
      <div className="col">
        {n && n.action !== 'none' && n.action !== 'rest' && <Btn icon="play_arrow" onClick={go}>Start</Btn>}
        <Btn kind="text" size="sm" icon={pend.length ? undefined : 'psychology'} disabled={!!pend.length || off} title={off ? 'Connect sync to use the coach' : undefined} onClick={() => askCoach('ask', 'What should I do right now?')}>{pend.length ? 'Thinking…' : 'What now?'}</Btn>
        {off && <span className="ai-hint"><Icon n="cloud_off" />Connect sync to use the coach</span>}
      </div>
    </section>
  )
}


export function CoachPanel() {
  const cp = useStore(s => s.cp)
  const turns = useTurns('coach')
  const off = useSync().state === 'off'
  const [msg, setMsg] = useState('')
  const [tab, setTab] = useState<'todo' | 'weak' | 'notes'>('todo')
  const [info, setInfo] = useState<Record<string, unknown> | null>(null)
  const chatBox = useAutoScroll<HTMLDivElement>()
  const panel = useRef<HTMLElement>(null), input = useRef<HTMLTextAreaElement>(null)
  const [paste, setPaste] = useState(false)
  // a review sent from anywhere (practice card, problem row): bring the chat into view so the reply lands there
  useEffect(() => {
    const f = () => setTimeout(() => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    addEventListener(COACH_FOCUS_EVENT, f); return () => removeEventListener(COACH_FOCUS_EVENT, f)
  }, [])
  // the app's shortcut (or anything else) asks for the chat box
  useEffect(() => {
    const f = () => { panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => input.current?.focus(), 60) }
    addEventListener('momentum:focus-chat', f); return () => removeEventListener('momentum:focus-chat', f)
  }, [])
  const log = Object.values(cp.coachLog).sort((a, b) => a.at - b.at).slice(-30)
  const pend = turns.filter(t => t.state !== 'done' && t.state !== 'error')
  const openQs = Object.values(cp.coachQs).filter(q => !q.answer).sort((a, b) => a.at - b.at)
  const answered = Object.values(cp.coachQs).filter(q => q.answer && !q.answer.startsWith('⁣'))
  const cur = cp.active?.cur
  // deep mode's first hour is hint-free: no "I'm stuck" chip, and free-form asks carry deep_locked so the coach holds back
  const [, tick] = useState(0)
  const deepAt = cp.active?.spec?.mode === 'deep' && cur ? cp.active.curAt || 0 : -1
  // break time doesn't count (the same working clock as the session screen's hint stage)
  const locked = deepAt >= 0 && (!deepAt || Date.now() - deepAt - breakIn(cp.active!, deepAt, Date.now()) < DEEP_LOCK * 60000)
  useEffect(() => { if (!locked) return; const iv = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(iv) }, [locked])
  const answeredCount = log.filter(m => m.out).length
  // the session generation tells buildCoachData when the laptop started a fresh conversation (static material goes again)
  useEffect(() => { if (getSyncCfg()) sessionInfo('coach').then(i => { noteCoachGen(i?.gen); setInfo(i) }).catch(() => setInfo(null)) }, [answeredCount, pend.length])
  const send = (text: string) => { const t = text.trim(); if (!t || off) return; askCoach('ask', t, locked ? { deep_locked: true, deep_pid: cur } : {}); setMsg('') }
  const sendAnswers = () => {
    const pendingAns = Object.values(getState().cp.coachQs).filter(q => q.answer && !q.sent)
    if (!pendingAns.length) return
    askCoach('ask', 'Here are my answers to your questions: ' + pendingAns.map(q => `"${q.q}" → ${q.answer}`).join(' | '))
    markSent(pendingAns.map(q => q.id))
  }
  const usage = info?.last_usage as Record<string, number> | undefined
  const ctxK = usage ? Math.round(((usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)) / 1000) : null
  return (
    <div className="cols coach-lay">
      <section className="card coach-panel coach-chat col-main" ref={panel} aria-label="Coach chat">
        <div className="card-head"><h3 className="title"><Icon n="psychology" fill /> Your coach</h3></div>
        {off && <div className="coach-offline small"><Icon n="cloud_off" /><span><b>Connect sync to use the coach.</b> It runs as a Claude Code session on your laptop — connect sync in Settings, or <button className="linkish" onClick={async () => toast(await copyText(coachPrompt()) ? 'Full data copied — paste into claude.ai' : 'Could not copy', 'content_copy')}>copy your data for claude.ai</button>.</span></div>}
        <div className="chat" ref={chatBox} aria-live="polite">
          {!log.length && !pend.length && <div className="chat-empty">
            <div className="chat-empty-ic"><Shape shape="cookie9" size={100} spin={14} /><Icon n="forum" fill /></div>
            <h3 className="title">Your one-to-one coach</h3>
            <p className="small muted">It sees every problem you open, every verdict and how long each took, your mocks and your schedule, and it remembers what you tell it. Ask it anything.</p>
            <div className="suggest">{QUICK.map(q => <button key={q} className="suggest-card" disabled={off} onClick={() => send(q)}><Icon n="north_east" />{q}</button>)}</div>
          </div>}
          {log.map(m => <ChatTurn key={m.id} m={m} />)}
          {pend.map(t => <div key={t.id} className="bubble coach pending"><Loader size={18} /> {t.err && t.state === 'queued' ? t.err : t.state === 'running' ? 'Thinking…' : t.position ? `Queued (#${t.position + 1})` : 'Sending…'}</div>)}
          {turns.filter(t => t.state === 'error').slice(-1).map(t => <div key={t.id} className="bubble err">{t.err} <button className="linkish" onClick={() => dismiss(t.id)}>dismiss</button></div>)}
        </div>
        <div className="chips quick">
          {(log.length > 0 || pend.length > 0) && QUICK.map(q => <button key={q} className="chip" disabled={off} onClick={() => send(q)}>{q}</button>)}
          {cur && !locked && <button className="chip" disabled={off} onClick={() => { askCoach('ask', `I'm stuck on ${cur}. Give me a hint, not the solution.`, {}, undefined, { pid: cur }) }}>I'm stuck on {cur}</button>}
          <button className="chip" disabled={off} onClick={() => setPaste(true)}><Icon n="code" /> Paste code</button>
        </div>
        <ReviewSheet open={paste} onClose={() => setPaste(false)} pid={cur || ''} sess={cp.active?.id} pickPid />
        <form className="row chat-in" onSubmit={e => { e.preventDefault(); send(msg) }}>
          <textarea ref={input} aria-label="Message your coach" value={msg} disabled={off} onChange={e => setMsg(e.target.value)} placeholder={off ? 'Connect sync to use the coach' : 'Ask your coach anything…'} rows={2} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(msg) } }} />
          <IconBtn icon="send" kind="filled" title="Send" disabled={!msg.trim() || off} onClick={() => send(msg)} />
        </form>
        {info && <div className="session-foot small muted">
          <span>Session gen {String(info.gen)} · {String(info.turns)} turns · {String(info.day_turns)}/{String(info.max_day)} today{ctxK ? ` · context ~${ctxK}k tokens` : ''}</span>
          <button className="linkish" onClick={async () => { if (await confirmAsk({ title: 'Start a fresh coach conversation?', body: 'It keeps its notebook, so it still remembers the important things.', ok: 'Reset' })) { const r = await resetSession('coach', true); noteCoachReset(r?.gen); toast('Coach session restarted (notebook kept)', 'restart_alt') } }}>Reset</button>
        </div>}
      </section>

      <aside className="col-side" aria-label="Coach board">
        {(openQs.length > 0 || (answered.some(q => !q.sent) && !pend.length)) && <section className="card coach-qs-card">
          <div className="card-head"><h3 className="title"><Icon n="help" fill /> Your coach asks</h3>{openQs.length > 0 && <span className="small muted">{openQs.length} open</span>}</div>
          {openQs.length > 0 && <div className="coach-qs">{openQs.map(q => <QuestionCard key={q.id} id={q.id} q={q.q} options={q.options} />)}</div>}
          {answered.some(q => !q.sent) && !openQs.length && !pend.length && <Btn kind="tonal" size="sm" icon="send" disabled={off} onClick={sendAnswers}>Send my answers to the coach</Btn>}
        </section>}
        <section className="card coach-board">
          <div className="card-head">
            <div className="seg mini" role="tablist" aria-label="Coach board">
              {(['todo', 'weak', 'notes'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} className={'seg-b' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>{tab === t && <motion.span layoutId="coachseg" className="seg-pill" transition={spring} />}<span>{t === 'todo' ? 'To-dos' : t === 'weak' ? 'Weaknesses' : 'Notebook'}</span></button>)}
            </div>
          </div>
          {tab === 'todo' && <TodoBoard />}
          {tab === 'weak' && <WeakBoard off={off} />}
          {tab === 'notes' && <div className="notebook">{cp.coachNotes.text ? <Md text={cp.coachNotes.text} /> : <p className="muted small">The coach writes its durable notes about you here: profile, hypotheses, recurring errors, what worked.</p>}</div>}
        </section>
      </aside>
    </div>
  )
}

function ChatTurn({ m }: { m: CoachMsg }) {
  const o = (m.out || {}) as Record<string, unknown>
  // this turn's to-dos, plus the open ones its duplicates were folded into (a re-issued assignment shows where it lives)
  const all = useStore(s => s.cp.coachTodos) as Record<string, Todo>
  const mergedInto = (Array.isArray(o.todo_merged) ? o.todo_merged : []).map((x: { into?: string }) => x?.into).filter((id): id is string => !!id && !!all[id])
  const todos = [...Object.values(all).filter(t => t.id.startsWith(`ct:${m.id.slice(0, 12)}:`) && t.st !== 'dup'), ...[...new Set(mergedInto)].map(id => all[id])]
  const insights = (Array.isArray(o.insights) ? o.insights : []) as { claim: string; evidence: string[] }[]
  const [open, setOpen] = useState(false)
  return (
    <>
      {m.q ? <div className="bubble me">{m.q}</div> : <div className="bubble sys small">{m.kind === 'debrief' ? 'Auto debrief' : m.kind === 'weekly' ? 'Weekly review' : m.kind === 'post_contest' ? 'Post-contest review' : m.kind === 'pre_contest' ? 'Pre-contest brief' : m.kind === 'report' ? 'Progress report' : 'Coach'} · {new Date(m.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
      {m.err ? <div className="bubble err">{m.err}</div> : m.out ? <motion.div className="bubble coach" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Md text={String(o.message || '')} />
        {todos.length > 0 && <div className="todo-list">{todos.map(t => <TodoRow key={t.id} t={t} />)}</div>}
        {insights.length > 0 && <><button className="linkish small" aria-expanded={open} onClick={() => setOpen(x => !x)}>{open ? 'Hide' : 'Show'} evidence ({insights.length})</button>
          <AnimatePresence>{open && <motion.ul className="insights" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>{insights.map((x, i) => <li key={i}>{x.claim} <span className="muted small">[{x.evidence.join(', ')}]</span></li>)}</motion.ul>}</AnimatePresence></>}
      </motion.div> : null}
    </>
  )
}

/** one coach to-do: title, minutes / start / due, why, resource link; add to Today (when not there) and done */
function TodoRow({ t }: { t: Todo }) {
  const inToday = useStore(s => !!s.days[dateKey()]?.tasks.some(x => x.id === t.id))
  const res = RES_BY_ID.get(t.ref)
  return (
    <div className={'todo' + (t.done ? ' done' : t.st ? ' muted' : '')}>
      <Icon n={t.done ? 'check_circle' : t.st === 'expired' ? 'schedule' : 'radio_button_unchecked'} fill={t.done} />
      <div className="grow"><b>{t.title}</b> <span className="muted small">· {t.minutes}m{t.start ? ` · ${t.start}` : ''}{t.due ? ` · ${t.due}` : ''}{t.st === 'expired' ? ' · expired' : inToday && !t.done ? ' · in Today' : ''}{(t.seen || 1) > 1 ? ` · asked ${t.seen}×` : ''}</span>{t.why && <div className="small muted">{t.why}</div>}
        {res && <a className="small" href={res.url} target="_blank" rel="noreferrer" onClick={() => logResource(t.ref, 0)}><Icon n="menu_book" /> {res.title}{!res.verified ? ' (unverified link)' : ''}</a>}
      </div>
      {!t.done && !t.st && !inToday && <IconBtn icon="playlist_add" title="Add to Today" onClick={() => addTodoToToday(t.id)} />}
      {!t.done && <IconBtn icon="check" title="Done" onClick={async () => { const learned = await promptAsk({ title: 'Done! What did you learn?', body: 'It goes to your coach.', ok: 'Mark done', input: { label: 'What you learned (optional)' } }); if (learned === null) return; todoDone(t.id, learned.trim() || undefined) }} />}
    </div>
  )
}

/** every open to-do (Today takes at most TODAY_CAP at a time; the rest wait here), then the expired ones */
function TodoBoard() {
  const cp = useStore(s => s.cp)
  const open = openTodos(cp), expired = (Object.values(cp.coachTodos) as Todo[]).filter(t => t.st === 'expired' && !t.done).sort((a, b) => b.at - a.at)
  const [showOld, setShowOld] = useState(false)
  if (!open.length && !expired.length) return <p className="muted small">Your coach's assignments land here: what to read, implement, upsolve or reflect on.</p>
  return (
    <div className="todo-list">
      <p className="small muted">Today takes up to {TODAY_CAP} at a time; the next one moves in when you finish one. To-dos expire after 3 days.</p>
      {open.map(t => <TodoRow key={t.id} t={t} />)}
      {expired.length > 0 && <button className="linkish small" aria-expanded={showOld} onClick={() => setShowOld(x => !x)}>{showOld ? 'Hide' : 'Show'} expired ({expired.length})</button>}
      {showOld && expired.map(t => <TodoRow key={t.id} t={t} />)}
    </div>
  )
}

function QuestionCard({ id, q, options }: { id: string; q: string; options: string[] }) {
  const [txt, setTxt] = useState('')
  return (
    <div className="qcard">
      <div className="small"><Icon n="help" fill /> <b>{q}</b></div>
      <div className="chips">{options.map(o => <button key={o} type="button" className="chip" onClick={() => answerQuestion(id, o)}>{o}</button>)}</div>
      <form className="row" onSubmit={e => { e.preventDefault(); if (txt.trim()) answerQuestion(id, txt.trim()) }}>
        <input className="cf-input sm" aria-label={`Your answer: ${q}`} value={txt} onChange={e => setTxt(e.target.value)} placeholder="Or answer in your words…" />
        <IconBtn icon="send" title="Answer" onClick={() => txt.trim() && answerQuestion(id, txt.trim())} />
      </form>
    </div>
  )
}

function WeakBoard({ off }: { off?: boolean }) {
  const w = useStore(s => s.cp.coachWeak)
  if (!w.list.length) return <p className="muted small">Your coach builds this board from your data — every weakness with evidence and a plan. Ask it "What are my weaknesses?".</p>
  return (
    <ul className="weak-board">
      {w.list.map((x, i) => (
        <li key={i}><motion.button type="button" className={'weak ' + x.status} whileTap={{ scale: 0.98 }} disabled={off} title={off ? 'Connect sync to use the coach' : 'Ask the coach about this'}
          onClick={() => askCoach('ask', `Tell me more about my weakness "${x.area}" and exactly how to fix it.`)}>
          <span className="row"><b className="grow">{x.area}</b><span className={'tlabel ' + (x.status === 'fixed' ? 'strong' : x.status === 'improving' ? 'shaky' : 'weak')}>{x.status}</span></span>
          <span className="small">{x.plan}</span>
          {x.evidence.length > 0 && <span className="small muted">evidence: {x.evidence.join(', ')}</span>}
        </motion.button></li>
      ))}
    </ul>
  )
}
