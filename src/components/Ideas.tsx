import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { dateKey, keyToDate, toast, useStore, type IdeaCard } from '../store'
import { getProb } from '../cf'
import { addNote } from '../train'
import { GRADES, LEECH, addIdea, deleteIdea, editIdea, fmtIvl, gradeIdea, ideaId, live, previewIvl, useIdeas, type Grade } from '../ideas'
import { Btn, IconBtn, spring } from './common'
import { Icon } from './fx'
import { ProbLink, Rating } from './cpui'
import '../styles/ideas.css'

const EXAMPLES = ['answer is monotone in k → binary search', 'look at the parity of the sum', 'sort, then greedy from the largest', 'fix the minimum, count the rest']
const daysTo = (k: string) => Math.round((keyToDate(k).getTime() - keyToDate(dateKey()).getTime()) / 864e5)
const dueLabel = (k: string) => { const d = daysTo(k); return d <= 0 ? 'due now' : d === 1 ? 'tomorrow' : `in ${fmtIvl(d)}` }

/** inline "one-line key observation" prompt shown after an AC / give-up / editorial; calls onDone when saved or skipped */
export function IdeaPrompt({ pid, onDone }: { pid: string; onDone?: () => void }) {
  const card = useStore(s => s.cp.ideas?.[ideaId(pid)])
  const had = live(card) ? card.idea : ''
  const [v, setV] = useState(had)
  const [ph] = useState(() => 'e.g. ' + EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)])
  const save = () => {
    const t = v.trim(); if (!t) return onDone?.()
    if (t !== had) { addIdea(pid, t); addNote(pid, 'Key idea: ' + t); toast(had ? 'Idea updated' : 'Saved to your idea bank', 'lightbulb') }
    onDone?.()
  }
  return (
    <motion.form className="idea-prompt" layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring} onSubmit={e => { e.preventDefault(); save() }}>
      <label className="idea-q" htmlFor={'idea-' + pid}><Icon n="lightbulb" fill /> Key idea in one line?</label>
      <input id={'idea-' + pid} className="idea-in" value={v} maxLength={160} placeholder={ph} autoComplete="off" onChange={e => setV(e.target.value)} />
      <div className="row">
        <span className="small muted grow">{had ? 'Already in your bank — edit it' : 'It comes back before you forget it'}</span>
        <Btn kind="text" size="sm" onClick={() => onDone?.()}>Skip</Btn>
        <Btn size="sm" icon="check" type="submit" disabled={!v.trim()}>Save</Btn>
      </div>
    </motion.form>
  )
}

/** idea-bank review card (SM-2) for Train */
export function IdeaReview() {
  const { all, due, stats } = useIdeas()
  const tricks = useStore(s => s.cp.tricks?.list || [])
  const [run, setRun] = useState<string[] | null>(null)
  const [list, setList] = useState(false)
  return (
    <section className="card ideas">
      <div className="card-head">
        <h3 className="title"><Icon n="lightbulb" fill /> Idea bank</h3>
        <span className="small muted">{stats.total ? <><b className={stats.due ? 'idea-due' : ''}>{stats.due} due</b> · {stats.total} card{stats.total > 1 ? 's' : ''}</> : 'empty'}</span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {run ? <motion.div key="run" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={spring}>
          <ReviewFlow ids={run} onExit={() => setRun(null)} />
        </motion.div> : <motion.div key="idle" className="ideas-idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {!stats.total ? <p className="small muted">After each solve, save the key trick in one line. Cards come back right before you'd forget them, so every insight compounds.</p> : <>
            <div className="row wrap">
              <Btn icon="play_arrow" disabled={!due.length} onClick={() => setRun(due.map(c => c.id))}>{due.length ? `Start review · ${due.length}` : 'All caught up'}</Btn>
              {!due.length && stats.next && <span className="small muted">next card {dueLabel(stats.next)}</span>}
              {stats.reviewedToday > 0 && <span className="small muted">{stats.reviewedToday} reviewed today</span>}
            </div>
            {stats.leeches.length > 0 && <p className="small idea-leech"><Icon n="sync_problem" /> {stats.leeches.length} idea{stats.leeches.length > 1 ? 's keep' : ' keeps'} slipping — rewrite {stats.leeches.length > 1 ? 'them' : 'it'} sharper or re-solve the problem.</p>}
            <button type="button" className="idea-toggle" onClick={() => setList(x => !x)} aria-expanded={list}>
              <Icon n={list ? 'expand_less' : 'expand_more'} /> All cards ({stats.total})
            </button>
            <AnimatePresence initial={false}>{list && <motion.div key="list" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} style={{ overflow: 'hidden' }}>
              <CardList cards={all} />
            </motion.div>}</AnimatePresence>
          </>}
          {tricks.length > 0 && <Tricks list={tricks} />}
        </motion.div>}
      </AnimatePresence>
    </section>
  )
}

function ReviewFlow({ ids, onExit }: { ids: string[]; onExit: () => void }) {
  const ideas = useStore(s => s.cp.ideas) || {}
  const [queue, setQueue] = useState(ids)
  const [i, setI] = useState(0)
  const [shown, setShown] = useState(false)
  const [counts, setCounts] = useState([0, 0, 0, 0])
  const graded = useRef(new Set<string>())
  // a card deleted on another device mid-review is skipped
  const c = queue[i] && live(ideas[queue[i]]) ? ideas[queue[i]] : undefined
  useEffect(() => { if (i < queue.length && !c) setI(x => x + 1) }, [i, queue.length, c])
  const grade = (q: Grade) => {
    if (!c || !shown) return
    // an in-session repeat of an 'Again' card only counts: the schedule already took that session's lapse
    if (!graded.current.has(c.id)) { graded.current.add(c.id); gradeIdea(c.id, q) }
    setCounts(n => n.map((x, k) => k === q ? x + 1 : x))
    if (q === 0) setQueue(qs => [...qs, c.id]) // again: see it once more this session
    setShown(false); setI(x => x + 1)
  }
  const done = i >= queue.length
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return
      // a session / Focus / sheet / rank-up overlay owns the keyboard; so does focus anywhere outside this card
      if (document.querySelector('.focus, .scrim, .rankup') || (t && t !== document.body && !t.closest?.('.card.ideas'))) return
      if (done) { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); onExit() } return }
      if (e.key === 'Escape') return onExit()
      if (!shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setShown(true); return }
      if (shown && e.key === ' ') { e.preventDefault(); grade(2); return }
      const g = GRADES.find(x => x.key === e.key); if (g && shown) { e.preventDefault(); grade(g.q) }
    }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  })
  if (done) {
    const total = counts.reduce((a, b) => a + b, 0)
    return (
      <div className="idea-done">
        <motion.div className="idea-done-icon" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}><Icon n="task_alt" fill /></motion.div>
        <h4 className="title">{total ? `${total} review${total > 1 ? 's' : ''} done` : 'Nothing left to review'}</h4>
        {total > 0 && <div className="row wrap idea-counts">{GRADES.map(g => <span key={g.q} className={`chip mini g${g.q}`}>{g.label} {counts[g.q]}</span>)}</div>}
        <p className="small muted">{counts[0] ? 'The ones you missed come back tomorrow.' : 'Every idea held. Clean sweep.'}</p>
        <Btn kind="tonal" onClick={onExit}>Done</Btn>
      </div>
    )
  }
  if (!c) return null
  const p = getProb(c.pid)
  return (
    <div className="idea-review">
      <div className="idea-progress"><motion.span animate={{ width: `${(i / queue.length) * 100}%` }} transition={spring} /></div>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={c.id + ':' + i} className="idea-face" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={spring}>
          <div className="row idea-front">
            <span className="prob-id">{c.pid}</span><Rating r={p?.r} />
            {c.lapses >= LEECH && <span className="chip mini idea-leech-chip"><Icon n="sync_problem" /> slipping</span>}
            <span className="grow" />
            <span className="small muted">{i + 1}/{queue.length}</span>
          </div>
          <ProbLink pid={c.pid} className="idea-name">{p?.n || 'Open problem'} <Icon n="open_in_new" /></ProbLink>
          <AnimatePresence mode="wait" initial={false}>
            {!shown ? <motion.div key="q" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="small muted">Recall the key idea, then reveal.</p>
              <Btn kind="tonal" icon="visibility" onClick={() => setShown(true)}>Reveal <kbd>space</kbd></Btn>
            </motion.div> : <motion.div key="a" className="idea-back" initial={{ opacity: 0, rotateX: -60 }} animate={{ opacity: 1, rotateX: 0 }} transition={spring}>
              <p className="idea-text">{c.idea}</p>
              {c.tags.length > 0 && <div className="row wrap">{c.tags.map(t => <span key={t} className="chip mini">{t}</span>)}</div>}
              <div className="idea-grades">
                {GRADES.map(g => (
                  <motion.button key={g.q} type="button" className={`idea-g g${g.q}`} whileTap={{ scale: 0.92 }} transition={spring} onClick={() => grade(g.q)}>
                    <b>{g.label}</b><span>{fmtIvl(previewIvl(c, g.q))} · <kbd>{g.key}</kbd></span>
                  </motion.button>
                ))}
              </div>
            </motion.div>}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
      <div className="row"><span className="grow" /><Btn kind="text" size="sm" onClick={onExit}>End review</Btn></div>
    </div>
  )
}

function CardList({ cards }: { cards: IdeaCard[] }) {
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase(); if (!s) return cards
    return cards.filter(c => [c.pid, c.idea, getProb(c.pid)?.n || '', ...c.tags].some(x => x.toLowerCase().includes(s)))
  }, [cards, q])
  const commit = (id: string) => { editIdea(id, draft); setEdit(null) }
  return (
    <div className="idea-list">
      <div className="idea-search"><Icon n="search" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search ideas, tags, problems" aria-label="Search ideas" /></div>
      {!shown.length && <p className="small muted">No match.</p>}
      <AnimatePresence initial={false}>
        {shown.slice(0, 200).map(c => {
          const p = getProb(c.pid)
          return (
            <motion.div key={c.id} layout className="idea-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} transition={spring}>
              <div className="row">
                <ProbLink pid={c.pid} className="idea-row-name"><span className="prob-id">{c.pid}</span> {p?.n}</ProbLink>
                <Rating r={p?.r} />
              </div>
              {edit === c.id
                ? <form className="row" onSubmit={e => { e.preventDefault(); commit(c.id) }}>
                    <input className="idea-in grow" autoFocus value={draft} maxLength={160} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Escape' && setEdit(null)} />
                    <IconBtn icon="check" kind="tonal" title="Save" onClick={() => commit(c.id)} />
                  </form>
                : <p className="idea-text sm">{c.idea}</p>}
              <div className="row small muted">
                <span>{dueLabel(c.due)}</span>{c.reps > 0 && <span>· every {fmtIvl(c.ivl)}</span>}
                {c.lapses > 0 && <span className={c.lapses >= LEECH ? 'idea-leech' : ''}>· missed {c.lapses}×</span>}
                <span className="grow" />
                <IconBtn icon="edit" title="Edit" onClick={() => { setEdit(c.id); setDraft(c.idea) }} />
                <IconBtn icon="delete" title="Delete" onClick={() => { deleteIdea(c.id); toast('Idea deleted', 'delete') }} />
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

function Tricks({ list }: { list: { name: string; pids: string[]; note?: string }[] }) {
  return (
    <div className="idea-tricks">
      <h4 className="idea-sub"><Icon n="category" /> Trick catalogue <span className="small muted">by your coach</span></h4>
      {list.map((t, k) => (
        <div key={t.name + k} className="idea-trick">
          <b>{t.name}</b>
          {t.note && <p className="small muted">{t.note}</p>}
          {t.pids.length > 0 && <div className="row wrap">{t.pids.map(pid => <ProbLink key={pid} pid={pid} className="chip mini idea-pid">{pid}</ProbLink>)}</div>}
        </div>
      ))}
    </div>
  )
}
