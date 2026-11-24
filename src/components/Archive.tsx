import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { dateKey, toast } from '../store'
import { contestProbUrl } from '../cf'
import { useSync } from '../sync'
import { askReview, COACH_FOCUS_EVENT } from '../review'
import { askCoach } from '../coach'
import { GRADES, fmtIvl, type Grade } from '../ideas'
import { fmtDay } from '../ui'
import {
  dueCards, linkFile, loadArchive, loadProblem, previewIvl, queueCards, reviewCard, scanAndLink, setCodeDir, useArchive,
  type Activity, type ArchiveIndex, type Card, type CodeScan, type ProbMeta, type ProblemDetail,
} from '../archive'
import { Btn, Chips, IconBtn, Sheet, spring } from './common'
import { Seg } from './Seg'
import { Icon } from './fx'
import { Rating, fmtClock } from './cpui'
import { Md } from './CoachPanel'
import '../styles/archive.css'

/* ═════════ Archive: every mock, round, virtual and practice session ever, every problem, flashcards, your code ═════════ */

type View = 'history' | 'problems' | 'cards' | 'code'
type Kind = Activity['kind']
type Meta = ProbMeta

const VIEW_KEY = 'momentum.archive.view'
const KINDS: { v: Kind; label: string; icon: string }[] = [
  { v: 'contest', label: 'Rated', icon: 'emoji_events' }, { v: 'mock', label: 'Mocks', icon: 'sports_score' },
  { v: 'virtual', label: 'Virtual', icon: 'history_toggle_off' }, { v: 'practice', label: 'Practice', icon: 'fitness_center' },
  { v: 'free', label: 'Free', icon: 'bolt' },
]
const KIND_ICON = Object.fromEntries(KINDS.map(k => [k.v, k.icon])) as Record<Kind, string>
const KIND_LABEL: Record<Kind, string> = { contest: 'Rated', mock: 'Mock', virtual: 'Virtual', practice: 'Practice', free: 'Free' }
const PAGE = 80

const idxOf = (pid: string, m?: Meta) => m?.index || pid.replace(/^\d+/, '')
const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }
const okVerdict = (s: string) => /^(ok|ac|accepted|solved)$/i.test(s)
/** fmtDay plus the year whenever the day is not in the current year (srs dues reach a year ahead) */
const fmtDate = (k: string, rel = false) => fmtDay(k, rel) + (k.slice(0, 4) !== String(new Date().getFullYear()) && !/^(Today|Tomorrow|Yesterday)$/.test(fmtDay(k, rel)) ? ' ' + k.slice(0, 4) : '')
const fmtWhen = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const lsGet = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const linkedPids = (ix: ArchiveIndex) => { const s = new Set<string>(); for (const l of Object.values(ix.links || {})) if (l?.pid) s.add(l.pid); return s }

export function Archive() {
  const { index, status, error, code } = useArchive()
  // fresh numbers whenever the tab opens (the background loop refreshes every 10 min)
  useEffect(() => { void loadArchive() }, [])
  const sync = useSync()
  const [view, setViewS] = useState<View>(() => { const v = lsGet(VIEW_KEY); return v === 'problems' || v === 'cards' || v === 'code' ? v : 'history' })
  const setView = (v: View) => { setViewS(v); lsSet(VIEW_KEY, v) }
  const [open, setOpen] = useState<string | null>(null)
  const today = dateKey()
  const due = useMemo(() => index ? dueCards(index, today) : [], [index, today])
  const counts = index ? { acts: Object.keys(index.activities).length, probs: Object.keys(index.problems).length, cards: Object.keys(index.cards).length } : null
  const title = { history: 'Everything you ever did', problems: 'Every problem you touched', cards: 'Never forget a solution', code: 'Your code, linked' }[view]

  let body: React.ReactNode
  if (sync.state === 'off' || status === 'off') body = <Empty icon="cloud_off" title="Connect the local server in Settings" text="The archive lives on your Momentum server so it keeps every round, problem and card for years — it needs sync set up." />
  else if (!index && status === 'error') body = <Empty icon="sync_problem" title="Could not load the archive" text={error || 'The server did not answer. It retries on its own.'} />
  else if (!index) body = <Empty icon="hourglass_top" title="Loading the archive…" text="Collecting every round and problem you have done." />
  else if (view === 'history') body = <History ix={index} onOpen={setOpen} />
  else if (view === 'problems') body = <Problems ix={index} onOpen={setOpen} />
  else if (view === 'cards') body = <Cards ix={index} due={due} onOpen={setOpen} />
  else body = <CodeView ix={index} scan={code} onOpen={setOpen} />

  return (
    <div className="view archive">
      <header className="greet"><div><div className="overline">Archive</div><h1 className="display-sm">{title}</h1></div></header>
      <Seg className="arc-seg" label="Archive view" value={view} onChange={setView} options={[
        { v: 'history', label: 'History', sub: counts ? counts.acts : undefined },
        { v: 'problems', label: 'Problems', sub: counts ? counts.probs : undefined },
        { v: 'cards', label: 'Cards', sub: counts ? (due.length ? `${due.length} due` : counts.cards) : undefined },
        { v: 'code', label: 'Code' },
      ]} />
      {body}
      {index && <ProblemSheet ix={index} pid={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Empty({ icon, title, text, children }: { icon: string; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <section className="card arc-empty">
      <Icon n={icon} fill />
      <h3 className="title">{title}</h3>
      {text && <p className="small muted">{text}</p>}
      {children}
    </section>
  )
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="arc-search"><Icon n="search" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <IconBtn icon="close" title="Clear" onClick={() => onChange('')} />}
    </div>
  )
}

function Badges({ ix, pid, code }: { ix: ArchiveIndex; pid: string; code: Set<string> }) {
  return <>
    {code.has(pid) && <span className="arc-badge code" title="Your code is linked"><Icon n="code" /></span>}
    {ix.cards[pid] && <span className="arc-badge card" title="Flashcard ready"><Icon n="style" fill /></span>}
  </>
}

function StatusChip({ s }: { s?: string }) {
  if (!s) return null
  return <span className={'arc-st ' + s}>{s === 'solved' ? <Icon n="check" /> : s === 'failed' ? <Icon n="close" /> : <Icon n="more_horiz" />}{s}</span>
}

/* ───────── History: activities newest first, grouped by month ───────── */
function History({ ix, onOpen }: { ix: ArchiveIndex; onOpen: (pid: string) => void }) {
  const [kinds, setKinds] = useState<Kind[]>([])
  const [q, setQ] = useState('')
  const [months, setMonths] = useState(12)
  const [exp, setExp] = useState<string | null>(null)
  const code = useMemo(() => linkedPids(ix), [ix])
  const all = useMemo(() => Object.values(ix.activities).sort((a, b) => b.at - a.at), [ix])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all.filter(a => (!kinds.length || kinds.includes(a.kind)) && (!s || a.title.toLowerCase().includes(s) || a.date.includes(s)
      || a.pids.some(p => p.toLowerCase().includes(s) || (ix.problems[p]?.name || '').toLowerCase().includes(s))))
  }, [all, kinds, q, ix])
  const groups = useMemo(() => {
    const m = new Map<string, Activity[]>()
    for (const a of shown) { const k = a.date.slice(0, 7); if (!m.has(k)) m.set(k, []); m.get(k)!.push(a) }
    return [...m.entries()]
  }, [shown])
  const byKind = useMemo(() => { const c: Partial<Record<Kind, number>> = {}; for (const a of all) c[a.kind] = (c[a.kind] || 0) + 1; return c }, [all])
  const first = all.length ? all[all.length - 1].date : ''
  if (!all.length) return <Empty icon="history_edu" title="No activities yet" text="Finish a mock, a practice session or a rated round and it lands here — kept for good." />
  return (
    <div className="arc-layout">
      <aside className="card arc-aside">
        <Search value={q} onChange={setQ} placeholder="Search rounds, problems, dates" />
        <div className="field-label">Kind</div>
        <Chips multi value={kinds} onChange={k => setKinds(ks => ks.includes(k) ? ks.filter(x => x !== k) : [...ks, k])}
          options={KINDS.filter(k => byKind[k.v]).map(k => ({ v: k.v, label: `${k.label} · ${byKind[k.v]}`, icon: k.icon }))} />
        <p className="small muted">{all.length} activities since {first ? fmtDay(first) + ' ' + first.slice(0, 4) : '—'}. Nothing here is ever pruned.</p>
      </aside>
      <div className="arc-main">
        {!groups.length && <p className="small muted arc-none">No match.</p>}
        {groups.slice(0, months).map(([ym, acts]) => {
          const solved = acts.reduce((n, a) => n + a.solved.length, 0), total = acts.reduce((n, a) => n + a.pids.length, 0)
          return (
            <section key={ym} className="arc-month">
              <h3 className="arc-month-h"><span>{monthLabel(ym)}</span><span className="small muted">{acts.length} · {solved}/{total} solved</span></h3>
              <div className="arc-list">
                {acts.map(a => <ActRow key={a.id} a={a} ix={ix} code={code} open={exp === a.id} onToggle={() => setExp(x => x === a.id ? null : a.id)} onOpen={onOpen} />)}
              </div>
            </section>
          )
        })}
        {groups.length > months && <Btn kind="tonal" icon="expand_more" onClick={() => setMonths(m => m + 12)}>Older months ({groups.length - months} more)</Btn>}
      </div>
    </div>
  )
}

function ActRow({ a, ix, code, open, onToggle, onOpen }: { a: Activity; ix: ArchiveIndex; code: Set<string>; open: boolean; onToggle: () => void; onOpen: (pid: string) => void }) {
  return (
    <div className={'arc-act ' + a.kind + (open ? ' open' : '')}>
      <button type="button" className="arc-act-h" onClick={onToggle} aria-expanded={open}>
        <span className="arc-kind" title={KIND_LABEL[a.kind]}><Icon n={KIND_ICON[a.kind] || 'event'} fill /></span>
        <span className="grow arc-act-t">
          <b>{a.title}</b>
          <span className="small muted">{fmtDay(a.date)}{a.mins ? ` · ${a.mins} min` : ''}{a.mode ? ` · ${a.mode}` : ''}</span>
        </span>
        <span className="arc-act-n">
          <b>{a.solved.length}/{a.pids.length}</b>
          {(a.perf || a.rank || a.delta !== undefined) && <span className="small muted">
            {a.perf ? `perf ${a.perf}` : ''}{a.rank ? `${a.perf ? ' · ' : ''}#${a.rank}` : ''}
            {a.delta !== undefined && a.delta !== null && <i className={a.delta >= 0 ? 'arc-up' : 'arc-down'}> {a.delta >= 0 ? '+' : ''}{a.delta}</i>}
          </span>}
        </span>
        <Icon n={open ? 'expand_less' : 'expand_more'} />
      </button>
      <AnimatePresence initial={false}>
        {open && <motion.div className="arc-act-b" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring}>
          {a.note && <p className="small muted arc-note">{a.note}</p>}
          {!a.pids.length && <p className="small muted">No problems recorded.</p>}
          {a.pids.map(pid => {
            const m = ix.problems[pid], tries = (m?.attempts || []).filter(t => t.act === a.id)
            const ok = a.solved.includes(pid), solveT = tries.find(t => okVerdict(t.status) && t.secs)
            const st = ok ? 'solved' : tries.length ? 'failed' : 'unattempted'
            return (
              <button key={pid} type="button" className="arc-prow" onClick={() => onOpen(pid)}>
                <span className="arc-letter">{idxOf(pid, m)}</span>
                <span className="grow arc-pname">{m?.name || pid}<span className="prob-id"> {pid}</span></span>
                <Rating r={m?.rating} />
                <span className={'arc-v ' + st}>{ok ? 'AC' : tries.length ? `${tries.length} tr${tries.length > 1 ? 'ies' : 'y'}` : '—'}</span>
                {solveT?.secs ? <span className="small muted arc-time">{fmtClock(solveT.secs)}</span> : null}
                <Badges ix={ix} pid={pid} code={code} />
              </button>
            )
          })}
        </motion.div>}
      </AnimatePresence>
    </div>
  )
}

/* ───────── Problems: every problem ever ───────── */
type St = 'all' | 'solved' | 'failed' | 'tried'
type Has = 'code' | 'card' | 'nocard'
const RATINGS = Array.from({ length: 28 }, (_, i) => 800 + i * 100)
function Problems({ ix, onOpen }: { ix: ArchiveIndex; onOpen: (pid: string) => void }) {
  const [q, setQ] = useState('')
  const [st, setSt] = useState<St>('all')
  const [tag, setTag] = useState('')
  const [lo, setLo] = useState(0)
  const [hi, setHi] = useState(0)
  const [has, setHas] = useState<Has[]>([])
  const [sort, setSort] = useState<'last' | 'rating'>('last')
  const [n, setN] = useState(PAGE)
  const code = useMemo(() => linkedPids(ix), [ix])
  const all = useMemo(() => Object.values(ix.problems), [ix])
  const tags = useMemo(() => {
    const c = new Map<string, number>(); for (const p of all) for (const t of p.tags || []) c.set(t, (c.get(t) || 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [all])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const r = all.filter(p => (st === 'all' || p.status === st) && (!tag || (p.tags || []).includes(tag))
      && (!lo || (p.rating || 0) >= lo) && (!hi || ((p.rating || 0) && (p.rating || 0) <= hi))
      && (!has.includes('code') || code.has(p.pid)) && (!has.includes('card') || !!ix.cards[p.pid]) && (!has.includes('nocard') || !ix.cards[p.pid])
      && (!s || p.pid.toLowerCase().includes(s) || (p.name || '').toLowerCase().includes(s) || (p.tags || []).some(t => t.toLowerCase().includes(s))))
    return r.sort(sort === 'rating' ? (a, b) => (b.rating || 0) - (a.rating || 0) || b.lastAt - a.lastAt : (a, b) => b.lastAt - a.lastAt)
  }, [all, q, st, tag, lo, hi, has, sort, code, ix])
  const missing = useMemo(() => shown.filter(p => !ix.cards[p.pid]).map(p => p.pid), [shown, ix])
  const jobs = ix.cardJobs
  const make = async () => {
    try { const r = await queueCards(missing); toast(r.queued ? `${r.queued} flashcard${r.queued > 1 ? 's' : ''} queued` : 'Nothing new to queue', 'style') }
    catch (e) { toast('Could not queue: ' + (e instanceof Error ? e.message : 'server error'), 'error') }
  }
  if (!all.length) return <Empty icon="list_alt" title="No problems yet" text="Every problem from your rounds and sessions shows up here once it syncs." />
  return (
    <div className="arc-layout">
      <aside className="card arc-aside">
        <Search value={q} onChange={v => { setQ(v); setN(PAGE) }} placeholder="Name, id or tag" />
        <div className="field-label">Status</div>
        <Chips value={st} onChange={v => { setSt(v); setN(PAGE) }} options={[{ v: 'all', label: 'All' }, { v: 'solved', label: 'Solved' }, { v: 'failed', label: 'Failed' }, { v: 'tried', label: 'Tried' }]} />
        <div className="field-label">Has</div>
        <Chips multi value={has} onChange={h => setHas(hs => hs.includes(h) ? hs.filter(x => x !== h) : [...hs.filter(x => !(h === 'card' && x === 'nocard') && !(h === 'nocard' && x === 'card')), h])}
          options={[{ v: 'code', label: 'Code', icon: 'code' }, { v: 'card', label: 'Card', icon: 'style' }, { v: 'nocard', label: 'No card' }]} />
        <div className="arc-sel-row">
          <label className="arc-sel"><span className="field-label">Tag</span>
            <select value={tag} onChange={e => { setTag(e.target.value); setN(PAGE) }}><option value="">Any tag</option>{tags.map(([t, c]) => <option key={t} value={t}>{t} ({c})</option>)}</select>
          </label>
        </div>
        <div className="arc-sel-row">
          <label className="arc-sel"><span className="field-label">Rating from</span>
            <select value={lo} onChange={e => setLo(+e.target.value)}><option value={0}>Any</option>{RATINGS.map(r => <option key={r} value={r}>{r}</option>)}</select>
          </label>
          <label className="arc-sel"><span className="field-label">to</span>
            <select value={hi} onChange={e => setHi(+e.target.value)}><option value={0}>Any</option>{RATINGS.map(r => <option key={r} value={r}>{r}</option>)}</select>
          </label>
        </div>
        <div className="arc-jobs">
          <Btn icon="auto_awesome" disabled={!missing.length} onClick={make}>{missing.length ? `Make flashcards for ${missing.length} without one` : 'Every match has a card'}</Btn>
          <JobLine ix={ix} />
          {jobs && Object.keys(jobs.errors || {}).length > 0 && <p className="small arc-err"><Icon n="error" /> {Object.keys(jobs.errors).length} failed — retry from the problem.</p>}
        </div>
      </aside>
      <div className="arc-main">
        <div className="row wrap arc-bar">
          <span className="small muted grow">{shown.length} of {all.length}</span>
          <Seg className="mini" label="Sort" value={sort} onChange={setSort} options={[{ v: 'last', label: 'Last seen' }, { v: 'rating', label: 'Rating' }]} />
        </div>
        {!shown.length && <p className="small muted arc-none">No match.</p>}
        <div className="arc-list">
          {shown.slice(0, n).map(p => (
            <button key={p.pid} type="button" className="arc-prow big" onClick={() => onOpen(p.pid)}>
              <span className="grow arc-pname"><b>{p.name || p.pid}</b>
                <span className="small muted arc-pmeta"><span className="prob-id">{p.pid}</span> · {fmtDay(dateKey(new Date(p.lastAt)))} {new Date(p.lastAt).getFullYear()}{p.attempts?.length ? ` · ${p.attempts.length} attempt${p.attempts.length > 1 ? 's' : ''}` : ''}{p.tags?.length ? ' · ' + p.tags.slice(0, 3).join(', ') : ''}</span>
              </span>
              <Rating r={p.rating} />
              <StatusChip s={p.status} />
              <Badges ix={ix} pid={p.pid} code={code} />
            </button>
          ))}
        </div>
        {shown.length > n && <Btn kind="tonal" icon="expand_more" onClick={() => setN(x => x + PAGE)}>Show more ({shown.length - n})</Btn>}
      </div>
    </div>
  )
}

function JobLine({ ix }: { ix: ArchiveIndex }) {
  const j = ix.cardJobs
  if (!j) return null
  const q = j.queue?.length || 0
  return (
    <p className="small muted arc-jobline">
      {j.running ? <><Icon n="progress_activity" className="arc-spin" /> Writing card for {j.running}{q ? ` · ${q} queued` : ''}</> : q ? <>{q} queued</> : <>Card writer idle</>}
      {' · '}{j.doneToday ?? 0}/{j.cap ?? '∞'} today
    </p>
  )
}

/* ───────── Flashcards ───────── */
function Cards({ ix, due, onOpen }: { ix: ArchiveIndex; due: string[]; onOpen: (pid: string) => void }) {
  const [run, setRun] = useState<string[] | null>(null)
  const [browse, setBrowse] = useState(false)
  const [q, setQ] = useState('')
  const total = Object.keys(ix.cards).length
  const fresh = due.filter(p => !ix.srs[p]).length
  const next = useMemo(() => Object.values(ix.srs).map(s => s.due).filter(d => d > dateKey()).sort()[0], [ix])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return Object.entries(ix.cards).map(([pid, c]) => ({ pid, c, m: ix.problems[pid] }))
      .filter(x => !s || x.pid.toLowerCase().includes(s) || (x.m?.name || '').toLowerCase().includes(s) || (x.c.key_idea || '').toLowerCase().includes(s) || (x.m?.tags || []).some(t => t.includes(s)))
      .sort((a, b) => (b.m?.lastAt || 0) - (a.m?.lastAt || 0))
  }, [ix, q])
  if (!total) return <Empty icon="style" title="No flashcards yet" text="Open Problems and press “Make flashcards” — each card holds the statement, how it should be solved and how you solved it.">
    <JobLine ix={ix} />
  </Empty>
  return (
    <div className="arc-layout cards">
      <div className="arc-main">
        {run ? <Deck ix={ix} ids={run} onExit={() => setRun(null)} onOpen={onOpen} />
          : <section className="card arc-deck-idle">
              <div className="arc-deck-big"><b>{due.length}</b><span>due today</span></div>
              <p className="small muted">{fresh ? `${fresh} new · ` : ''}{due.length - fresh} to review · {total} cards in all{!due.length && next ? ` · next ${fmtDate(next, true)}` : ''}</p>
              <div className="row wrap"><Btn icon="play_arrow" size="lg" disabled={!due.length} onClick={() => setRun(due)}>{due.length ? 'Start review' : 'All caught up'}</Btn>
                <Btn kind="tonal" icon="view_list" onClick={() => setBrowse(b => !b)}>{browse ? 'Hide cards' : 'Browse all cards'}</Btn></div>
            </section>}
        {browse && !run && (
          <section className="card arc-browse">
            <Search value={q} onChange={setQ} placeholder="Search cards" />
            <div className="arc-list">
              {list.slice(0, 300).map(({ pid, c, m }) => (
                <button key={pid} type="button" className="arc-prow big" onClick={() => onOpen(pid)}>
                  <span className="grow arc-pname"><b>{m?.name || pid}</b><span className="small muted arc-pmeta">{c.key_idea || pid}</span></span>
                  <Rating r={m?.rating} />
                  {ix.srs[pid] && <span className="small muted arc-time">{ix.srs[pid].due <= dateKey() ? 'due' : fmtDate(ix.srs[pid].due)}</span>}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      <aside className="card arc-aside">
        <h3 className="title"><Icon n="school" fill /> How it works</h3>
        <p className="small muted">Front: the problem in a few lines. Recall how you would solve it, then flip (<kbd>space</kbd>). Back: the intended solution, how you actually solved it, what differed, and your code. Grade with <kbd>1</kbd>–<kbd>4</kbd>; cards you know drift years apart, ones you miss come back tomorrow.</p>
        <JobLine ix={ix} />
      </aside>
    </div>
  )
}

function Deck({ ix, ids, onExit, onOpen }: { ix: ArchiveIndex; ids: string[]; onExit: () => void; onOpen: (pid: string) => void }) {
  const [queue, setQueue] = useState(ids)
  const [i, setI] = useState(0)
  const [shown, setShown] = useState(false)
  const [tagsOn, setTagsOn] = useState(false)
  const [counts, setCounts] = useState([0, 0, 0, 0])
  const [details, setDetails] = useState<Record<string, ProblemDetail | 'err'>>({})
  const busy = useRef(false)
  const flipAt = useRef(0)
  const pid = queue[i], done = i >= queue.length
  const d = pid ? details[pid] : undefined
  const ready = !!d && d !== 'err' // the back and the grade buttons exist only once the card has loaded
  const flip = () => { if (!ready || shown) return; flipAt.current = Date.now(); setShown(true) }
  // fetch this card and the next one ahead
  useEffect(() => {
    for (const p of [queue[i], queue[i + 1]]) {
      if (!p || details[p]) continue
      loadProblem(p).then(r => setDetails(x => ({ ...x, [p]: r })), () => setDetails(x => ({ ...x, [p]: 'err' })))
    }
  }, [i, queue, details])
  const grade = async (q: Grade) => {
    if (!pid || !shown || !ready || busy.current) return
    busy.current = true
    // every grade is saved, a card graded Again and seen again later in the session too; a failed save keeps the card
    // on screen so the grade can be retried
    try { await reviewCard(pid, q) }
    catch { toast('Review not saved — server unreachable', 'sync_problem'); return }
    finally { busy.current = false }
    setCounts(n => n.map((x, k) => k === q ? x + 1 : x))
    if (q === 0) setQueue(qs => [...qs, pid])
    setShown(false); setTagsOn(false); setI(x => x + 1)
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('.scrim, .focus, .rankup')) return
      // a keyboard-focused button keeps its own Space / Enter
      const f = document.activeElement as HTMLElement | null
      if ((e.key === ' ' || e.key === 'Enter') && f && f !== document.body && f.matches('button, a, summary') && f.matches(':focus-visible')) return
      if (done) { if (e.key === 'Enter') { e.preventDefault(); onExit() } return }
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); return } // Space only flips, never grades
      const g = GRADES.find(x => x.key === e.key)
      if (g && shown) { e.preventDefault(); if (Date.now() - flipAt.current >= 250) void grade(g.q) }
    }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  })
  if (done) {
    const total = counts.reduce((a, b) => a + b, 0)
    return (
      <section className="card arc-deck arc-deck-done">
        <motion.div className="arc-done-ic" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}><Icon n="task_alt" fill /></motion.div>
        <h3 className="title">{total ? `${total} card${total > 1 ? 's' : ''} reviewed` : 'Nothing left to review'}</h3>
        {total > 0 && <div className="row wrap arc-counts">{GRADES.map(g => <span key={g.q} className={`chip mini g${g.q}`}>{g.label} {counts[g.q]}</span>)}</div>}
        <Btn kind="tonal" onClick={onExit}>Done</Btn>
      </section>
    )
  }
  // ix.srs is updated by reviewCard, so a requeued card previews from its latest schedule
  const m = ix.problems[pid], card = d && d !== 'err' ? d.card : null, srs = ix.srs[pid] || (d && d !== 'err' ? d.srs : null)
  return (
    <section className="card arc-deck reviewing">
      <div className="arc-prog"><motion.span animate={{ width: `${(i / queue.length) * 100}%` }} transition={spring} /></div>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={pid + ':' + i} className="arc-face" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={spring}>
          <div className="row wrap">
            <span className="prob-id">{pid}</span><Rating r={m?.rating} />
            {!srs && <span className="chip mini on">new</span>}
            <span className="grow" /><span className="small muted">{i + 1}/{queue.length}</span>
          </div>
          <h2 className="arc-face-name">{m?.name || pid}</h2>
          {m?.tags?.length ? (tagsOn ? <div className="row wrap">{m.tags.map(t => <span key={t} className="chip mini">{t}</span>)}</div>
            : <button type="button" className="arc-link" onClick={() => setTagsOn(true)}><Icon n="sell" /> show tags</button>) : null}
          {!d ? <p className="small muted">Loading…</p> : d === 'err' ? <p className="small arc-err">Could not load this card.</p> : <>
            {card?.summary ? <p className="arc-summary">{card.summary}</p> : <p className="small muted">No summary — open the full statement.</p>}
            {d.statement && <details className="arc-det"><summary><Icon n="description" /> Full statement</summary><pre className="arc-stmt">{d.statement}</pre></details>}
            {!shown ? <Btn kind="tonal" icon="flip" onClick={flip}>Show solution <kbd>space</kbd></Btn>
              : <motion.div className="arc-back" initial={{ opacity: 0, rotateX: -50 }} animate={{ opacity: 1, rotateX: 0 }} transition={spring}>
                  {card ? <CardBack card={card} code={d.code} /> : <p className="small muted">This problem has no card text yet.</p>}
                  <div className="arc-grades">
                    {GRADES.map(g => (
                      <motion.button key={g.q} type="button" className={`idea-g g${g.q}`} whileTap={{ scale: 0.92 }} transition={spring} onClick={() => void grade(g.q)}>
                        <b>{g.label}</b><span>{fmtIvl(previewIvl(srs, g.q))} · <kbd>{g.key}</kbd></span>
                      </motion.button>
                    ))}
                  </div>
                </motion.div>}
          </>}
        </motion.div>
      </AnimatePresence>
      <div className="row"><Btn kind="text" size="sm" icon="open_in_full" onClick={() => onOpen(pid)}>Open problem</Btn><span className="grow" /><Btn kind="text" size="sm" onClick={onExit}>End review</Btn></div>
    </section>
  )
}

function CardBack({ card, code }: { card: Card; code?: ProblemDetail['code'] }) {
  return (
    <div className="arc-cardback">
      {card.key_idea && <p className="arc-key"><Icon n="lightbulb" fill /> {card.key_idea}</p>}
      {card.intended && <div className="arc-sec"><h4><Icon n="route" /> How it should be solved</h4><Md text={card.intended} /></div>}
      {card.mine && <div className="arc-sec mine"><h4><Icon n="person" /> How you solved it</h4><Md text={card.mine} /></div>}
      {card.compare && <div className="arc-sec diff"><h4><Icon n="compare_arrows" /> What differed</h4><Md text={card.compare} /></div>}
      {card.pitfalls?.length > 0 && <div className="arc-sec"><h4><Icon n="warning" /> Pitfalls</h4><ul>{card.pitfalls.map((p, k) => <li key={k}>{p}</li>)}</ul></div>}
      {code && code.length > 0 && code.map(f => (
        <details key={f.path} className="arc-det"><summary><Icon n="code" /> {f.path}</summary><pre className="arc-code">{f.text}</pre></details>
      ))}
    </div>
  )
}

/* ───────── Code folder ───────── */
function CodeView({ ix, scan, onOpen }: { ix: ArchiveIndex; scan: CodeScan | null; onOpen: (pid: string) => void }) {
  const [dir, setDir] = useState(ix.codeDir || '')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => { setDir(ix.codeDir || '') }, [ix.codeDir])
  const save = async () => {
    setBusy(true)
    try { await setCodeDir(dir.trim()); toast('Code folder saved and scanned', 'folder') }
    catch (e) { toast('Not saved: ' + (e instanceof Error ? e.message : 'not a folder'), 'error') }
    finally { setBusy(false) }
  }
  const rescan = async () => {
    setBusy(true)
    try { await scanAndLink(); toast('Code folder rescanned', 'refresh') } catch { toast('Rescan failed', 'error') } finally { setBusy(false) }
  }
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    // every scanned file (unlinked ones too) plus any link whose file is not in the latest scan
    const m = new Map<string, { path: string; pid: string | null; by: 'auto' | 'user' }>()
    for (const f of scan?.files || []) m.set(f.path, { path: f.path, pid: null, by: 'auto' })
    for (const [path, l] of Object.entries(ix.links || {})) m.set(path, { path, pid: l.pid, by: l.by })
    return [...m.values()]
      .filter(r => !s || r.path.toLowerCase().includes(s) || (r.pid || '').toLowerCase().includes(s) || (r.pid && (ix.problems[r.pid]?.name || '').toLowerCase().includes(s)))
      .sort((a, b) => (a.pid ? 1 : 0) - (b.pid ? 1 : 0) || a.path.localeCompare(b.path, undefined, { numeric: true }))
  }, [ix, scan, q])
  const linked = rows.filter(r => r.pid).length
  return (
    <div className="arc-layout">
      <aside className="card arc-aside">
        <form onSubmit={e => { e.preventDefault(); void save() }} className="arc-dir">
          <label className="field"><span className="field-label">Code folder on the server machine</span>
            <input value={dir} onChange={e => setDir(e.target.value)} placeholder="~/code/cp" spellCheck={false} autoComplete="off" /></label>
          <div className="row wrap">
            <Btn type="submit" icon="save" disabled={busy || !dir.trim() || dir.trim() === ix.codeDir}>Save</Btn>
            <Btn kind="tonal" icon="refresh" disabled={busy || !ix.codeDir} onClick={rescan}>Rescan</Btn>
          </div>
        </form>
        <p className="small muted">Files are matched to problems by an id in the file (<code>// 1833A</code>), the contest folder, the mock folder and its time, or the file name. Your coach reads this folder too, read-only. Fix any wrong match by typing the problem id.</p>
        <p className="small muted">{rows.length} files · {linked} linked · {rows.length - linked} unlinked</p>
        {scan && !scan.ok && ix.codeDir && <p className="small arc-err"><Icon n="error" /> The server cannot read this folder.</p>}
      </aside>
      <div className="arc-main">
        {!ix.codeDir ? <Empty icon="folder_open" title="No code folder yet" text="Point Momentum at the folder where you keep your solutions." />
          : <>
              <Search value={q} onChange={setQ} placeholder="Search files or problems" />
              {!rows.length && <p className="small muted arc-none">No files found yet — press Rescan.</p>}
              <div className="arc-list">{rows.slice(0, 600).map(r => <FileRow key={r.path} path={r.path} pid={r.pid} by={r.by} ix={ix} onOpen={onOpen} />)}</div>
            </>}
      </div>
    </div>
  )
}

const PID_RE = /^\d{1,4}[A-Z]\d?$/
function FileRow({ path, pid, by, ix, onOpen }: { path: string; pid: string | null; by: 'auto' | 'user'; ix: ArchiveIndex; onOpen: (pid: string) => void }) {
  const [v, setV] = useState(pid || '')
  useEffect(() => { setV(pid || '') }, [pid])
  const cut = path.lastIndexOf('/'), folder = cut >= 0 ? path.slice(0, cut) : '', file = path.slice(cut + 1)
  // Enter then blur fires commit twice before the `pid` prop catches up: skip while one is in flight or already saved
  const inflight = useRef(false), lastSent = useRef<string | null>(null)
  useEffect(() => { lastSent.current = null }, [pid])
  const commit = async () => {
    const p = v.trim().toUpperCase()
    if (p === (pid || '') || inflight.current || p === lastSent.current) return
    if (p && !PID_RE.test(p)) { toast('Problem id like 1833A', 'error'); setV(pid || ''); return }
    inflight.current = true
    try { await linkFile(path, p || null); lastSent.current = p; toast(p ? `Linked to ${p}` : 'Unlinked', 'link') }
    catch { toast('Link not saved', 'error'); setV(pid || '') }
    finally { inflight.current = false }
  }
  return (
    <div className={'arc-file' + (pid ? '' : ' unlinked')}>
      <Icon n={pid ? 'link' : 'link_off'} />
      <span className="grow arc-fname"><b>{file}</b>{folder && <span className="small muted">{folder}</span>}</span>
      {pid && <button type="button" className="arc-link" onClick={() => onOpen(pid)} title={ix.problems[pid]?.name}>{ix.problems[pid]?.name || 'open'}</button>}
      {pid && <span className={'chip mini' + (by === 'user' ? ' on' : '')}>{by}</span>}
      <form className="arc-pidin" onSubmit={e => { e.preventDefault(); void commit() }}>
        <input value={v} onChange={e => setV(e.target.value)} onBlur={() => void commit()} placeholder="pid" aria-label={'Problem id for ' + path} spellCheck={false} maxLength={6} />
      </form>
    </div>
  )
}

/* ───────── problem sheet (shared by every view) ───────── */
function ProblemSheet({ ix, pid, onClose }: { ix: ArchiveIndex; pid: string | null; onClose: () => void }) {
  const [d, setD] = useState<ProblemDetail | null>(null)
  const [err, setErr] = useState(false)
  const last = useRef<string | null>(null)
  if (pid) last.current = pid
  const p = pid || last.current
  const cardAt = p ? ix.cards[p]?.at : undefined
  useEffect(() => {
    if (!pid) return
    let live = true
    setErr(false); setD(x => x && x.meta?.pid === pid ? x : null)
    loadProblem(pid).then(r => { if (live) setD(r) }, () => { if (live) setErr(true) })
    return () => { live = false }
  }, [pid, cardAt])
  const m = (p && ix.problems[p]) || d?.meta
  const queued = !!p && (ix.cardJobs?.running === p || (ix.cardJobs?.queue || []).includes(p))
  const failed = p ? ix.cardJobs?.errors?.[p] : undefined
  const make = async (force: boolean) => {
    if (!p) return
    try { await queueCards([p], force); toast(force ? 'Card will be rewritten' : 'Card queued', 'style') } catch { toast('Could not queue the card', 'error') }
  }
  const ask = () => {
    if (!p) return
    const code = d?.code?.slice().sort((a, b) => b.mtime - a.mtime)[0]
    if (code?.text.trim()) { askReview({ pid: p, code: code.text, solved: m?.status === 'solved' }); onClose(); return }
    const id = askCoach('ask', `Let's go over ${p}${m?.name ? ' (' + m.name + ')' : ''} from my archive — what should I take away from it?`, { archive_pid: p })
    if (id) { toast('Sent to your coach', 'psychology'); dispatchEvent(new CustomEvent(COACH_FOCUS_EVENT, { detail: { turn: id } })); onClose() }
    else toast('Coach needs the local server', 'cloud_off')
  }
  const attempts = (m?.attempts || []).slice().sort((a, b) => a.at - b.at)
  return (
    <Sheet open={!!pid} onClose={onClose} title={m?.name || p || 'Problem'} className="arc-sheet"
      actions={p ? <>
        <a className="btn text" href={contestProbUrl(p)} target="_blank" rel="noreferrer"><Icon n="open_in_new" /> Codeforces</a>
        <span className="grow" />
        <Btn kind="tonal" icon="psychology" onClick={ask}>Ask coach about this</Btn>
      </> : undefined}>
      {p && <div className="arc-sheet-b">
        <div className="row wrap">
          <span className="prob-id">{p}</span><Rating r={m?.rating} /><StatusChip s={m?.status} />
          {m?.firstAt ? <span className="small muted">first {fmtDay(dateKey(new Date(m.firstAt)))} {new Date(m.firstAt).getFullYear()}</span> : null}
        </div>
        {m?.tags?.length ? <div className="row wrap">{m.tags.map(t => <span key={t} className="chip mini">{t}</span>)}</div> : null}

        <section className="arc-block">
          <div className="arc-block-h"><h3 className="title"><Icon n="style" fill /> Flashcard</h3>
            {d?.card ? <Btn kind="text" size="sm" icon="refresh" disabled={queued} onClick={() => make(true)}>{queued ? 'Rewriting…' : 'Rewrite'}</Btn> : null}</div>
          {d?.card ? <>
            {d.card.summary && <p className="arc-summary">{d.card.summary}</p>}
            <CardBack card={d.card} />
            <p className="small muted">Written {fmtWhen(d.card.at)}{d.card.model ? ` · ${d.card.model}` : ''}{d.srs ? ` · next review ${fmtDate(d.srs.due, true)}` : ''}</p>
          </> : queued ? <p className="small muted"><Icon n="progress_activity" className="arc-spin" /> Card is being written…</p>
            : !d && !err ? <p className="small muted">Loading…</p>
            : err && ix.cards[p] ? <p className="small arc-err">Could not load this card.{ix.cards[p].key_idea ? <span className="muted"> Key idea: {ix.cards[p].key_idea}</span> : null}</p>
            : <div className="row wrap">{failed && <span className="small arc-err grow">Last try failed: {failed}</span>}<Btn icon="auto_awesome" onClick={() => make(false)}>Make card</Btn></div>}
        </section>

        <section className="arc-block">
          <h3 className="title"><Icon n="description" /> Statement</h3>
          {err ? <p className="small arc-err">Could not load the details.</p> : !d ? <p className="small muted">Loading…</p>
            : d.statement ? <details className="arc-det"><summary>Show full statement</summary><pre className="arc-stmt">{d.statement}</pre></details>
            : <p className="small muted">Not stored yet — open it on Codeforces.</p>}
        </section>

        {attempts.length > 0 && <section className="arc-block">
          <h3 className="title"><Icon n="timeline" /> Attempts</h3>
          <ol className="arc-tl">
            {attempts.map((a, k) => (
              <li key={k} className={okVerdict(a.status) ? 'ok' : ''}>
                <b>{a.status}</b><span className="small muted">{fmtWhen(a.at)}{a.secs ? ` · ${fmtClock(a.secs)}` : ''}{a.src ? ` · ${a.src}` : ''}{a.act && ix.activities[a.act] ? ` · ${ix.activities[a.act].title}` : ''}</span>
              </li>
            ))}
          </ol>
        </section>}

        <section className="arc-block">
          <h3 className="title"><Icon n="code" /> Your code</h3>
          {!d ? <p className="small muted">{err ? '—' : 'Loading…'}</p> : !d.code?.length ? <p className="small muted">No file linked. Link one in Archive → Code.</p>
            : d.code.map(f => (
              <details key={f.path} className="arc-det" open={d.code.length === 1}>
                <summary><Icon n="draft" /> {f.path} <span className="small muted">· {fmtWhen(f.mtime)}</span></summary>
                <pre className="arc-code">{f.text}</pre>
              </details>
            ))}
        </section>
      </div>}
    </Sheet>
  )
}
