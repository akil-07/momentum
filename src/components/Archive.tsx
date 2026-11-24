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
  dueCards, roundExtras, linkFile, loadArchive, organizeNow, setOrganize, undoOrganize, loadProblem, previewIvl, queueCards, reviewCard, scanAndLink, setCodeDir, upsolveList, useArchive,
  topicOf, topicLabel, TOPIC_ORDER, type CardEntry, type UpWhy, type Activity, type ArchiveIndex, type Card, type CodeScan, type ProbMeta, type ProblemDetail,
} from '../archive'
import { Btn, Chips, IconBtn, Sheet, Switch, spring } from './common'
import { Seg } from './Seg'
import { Icon } from './fx'
import { ProbLink, Rating, fmtClock } from './cpui'
import { queues, startPractice, skillNow } from '../train'
import { useStore } from '../store'
import { Md } from './CoachPanel'
import { Statement, withMath } from './MathText'
import '../styles/archive.css'

/* ═════════ Archive: every mock, round, virtual and practice session ever, every problem, flashcards, your code ═════════ */

type View = 'history' | 'upsolve' | 'problems' | 'cards' | 'code'
type Kind = Activity['kind']
type Meta = ProbMeta

const VIEW_KEY = 'momentum.archive.view'
const TOPICS_KEY = 'momentum.archive.openTopics'
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
  const [view, setViewS] = useState<View>(() => { const v = lsGet(VIEW_KEY); return v === 'upsolve' || v === 'problems' || v === 'cards' || v === 'code' ? v : 'history' })
  const setView = (v: View) => { setViewS(v); lsSet(VIEW_KEY, v) }
  const [open, setOpen] = useState<string | null>(null)
  const today = dateKey()
  const due = useMemo(() => index ? dueCards(index, today) : [], [index, today])
  const nUps = useMemo(() => upsolveList(index).length, [index])
  const counts = index ? { acts: Object.keys(index.activities).length, ups: nUps, probs: Object.keys(index.problems).length, cards: Object.keys(index.cards).length } : null
  const title = { history: 'Everything you ever did', upsolve: 'Unfinished business', problems: 'Every problem you touched', cards: 'Never forget a solution', code: 'Your code, linked' }[view]

  let body: React.ReactNode
  if (sync.state === 'off' || status === 'off') body = <Empty icon="cloud_off" title="Connect the local server in Settings" text="The archive lives on your Momentum server so it keeps every round, problem and card for years — it needs sync set up." />
  else if (!index && status === 'error') body = <Empty icon="sync_problem" title="Could not load the archive" text={error || 'The server did not answer. It retries on its own.'} />
  else if (!index) body = <Empty icon="hourglass_top" title="Loading the archive…" text="Collecting every round and problem you have done." />
  else if (view === 'history') body = <History ix={index} onOpen={setOpen} />
  else if (view === 'upsolve') body = <Upsolve ix={index} onOpen={setOpen} />
  else if (view === 'problems') body = <Problems ix={index} onOpen={setOpen} />
  else if (view === 'cards') body = <Cards ix={index} due={due} onOpen={setOpen} />
  else body = <CodeView ix={index} scan={code} onOpen={setOpen} />

  return (
    <div className="view archive">
      <header className="greet"><div><div className="overline">Archive</div><h1 className="display-sm">{title}</h1></div></header>
      <Seg className="arc-seg" label="Archive view" value={view} onChange={setView} options={[
        { v: 'history', label: 'History', sub: counts ? counts.acts : undefined },
        { v: 'upsolve', label: 'Upsolve', sub: counts ? counts.ups : undefined },
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
          <b>{a.solved.length}/{a.pids.length + roundExtras(a, code).length}</b>
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
          {[...a.pids, ...roundExtras(a, code)].map(pid => {
            const m = ix.problems[pid], tries = (m?.attempts || []).filter(t => t.act === a.id)
            const ok = a.solved.includes(pid), solveT = tries.find(t => okVerdict(t.status) && t.secs)
            // solved later anywhere = upsolved; a WA on record = failed; opened or code written = tried; else untouched
            const later = !ok && m?.status === 'solved', wa = tries.some(t => t.status === 'failed')
            const st = ok ? 'solved' : later ? 'upsolved' : wa ? 'failed' : tries.length || code.has(pid) ? 'tried' : 'untouched'
            const label = { solved: 'AC', upsolved: 'upsolved', failed: 'WA', tried: 'tried', untouched: '—' }[st]
            return (
              <button key={pid} type="button" className="arc-prow" onClick={() => onOpen(pid)}>
                <span className="arc-letter">{idxOf(pid, m)}</span>
                <span className="grow arc-pname">{m?.name || pid}<span className="prob-id"> {pid}</span></span>
                <Rating r={m?.rating} />
                <span className={'arc-v ' + st} title={st === 'untouched' ? 'not opened in the app, no submission, no code' : undefined}>{label}</span>
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

/* ───────── Today: due flashcards come up there too ───────── */
export function CardsDueCard() {
  const { index } = useArchive()
  const due = useMemo(() => index ? dueCards(index, dateKey()) : [], [index])
  if (!due.length) return null
  const go = () => { reviewOnOpen = true; lsSet(VIEW_KEY, 'cards'); window.dispatchEvent(new CustomEvent('momentum:go', { detail: { tab: 'archive' } })) }
  const fresh = due.filter(p => !index!.srs[p]).length
  return (
    <section className="card arc-today">
      <div className="arc-today-n"><b>{due.length}</b><span>flashcard{due.length > 1 ? 's' : ''}</span></div>
      <div className="grow"><b>Due today</b><p className="small muted">{fresh ? `${fresh} new` : ''}{fresh && due.length - fresh ? ' · ' : ''}{due.length - fresh ? `${due.length - fresh} to review` : ''} · about {Math.max(2, Math.round(due.length * 1.5))} min</p></div>
      <Btn icon="style" onClick={go}>Review</Btn>
    </section>
  )
}

/* ───────── Upsolve: every problem you have not solved, from every round, mock, virtual and practice session ───────── */
const WHY: Record<UpWhy, { label: string; long: string }> = {
  failed: { label: 'WA', long: 'wrong answer' }, tried: { label: 'opened', long: 'opened, not solved' },
  skipped: { label: 'skipped', long: 'skipped in practice' }, code: { label: 'code', long: 'code written, not accepted' },
  untouched: { label: 'not opened', long: 'never opened' },
}
const UP_KINDS: { v: Kind; label: string; icon: string }[] = KINDS.filter(k => k.v !== 'free')
function Upsolve({ ix, onOpen }: { ix: ArchiveIndex; onOpen: (pid: string) => void }) {
  const busy = useStore(s => !!s.cp.active)
  const tests = useStore(s => s.cp.tests), atts = useStore(s => s.cp.attempts)
  const ups = useMemo(() => upsolveList(ix), [ix])
  // the 72-hour deadlines come from the app's own queue (overdue ones hold back new practice)
  const due = useMemo(() => { const m = new Map<string, { due: number; overdue: boolean }>(); try { for (const x of queues(skillNow()).upsolve) if (!m.has(x.pid)) m.set(x.pid, x) } catch { /* no data yet */ } return m }, [ix, tests, atts]) // eslint-disable-line react-hooks/exhaustive-deps
  const [kinds, setKinds] = useState<Kind[]>([])
  const [whys, setWhys] = useState<UpWhy[]>([])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'new' | 'easy'>('new')
  const [n, setN] = useState(PAGE)
  const byKind = useMemo(() => { const c: Partial<Record<Kind, number>> = {}; for (const u of ups) { const k = u.kind === 'free' ? 'practice' : u.kind; c[k] = (c[k] || 0) + 1 } return c }, [ups])
  const byWhy = useMemo(() => { const c: Partial<Record<UpWhy, number>> = {}; for (const u of ups) c[u.why] = (c[u.why] || 0) + 1; return c }, [ups])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const r = ups.filter(u => (!kinds.length || kinds.includes(u.kind === 'free' ? 'practice' : u.kind)) && (!whys.length || whys.includes(u.why))
      && (!s || u.pid.toLowerCase().includes(s) || (ix.problems[u.pid]?.name || '').toLowerCase().includes(s) || u.title.toLowerCase().includes(s)
        || (ix.problems[u.pid]?.tags || []).some(t => t.includes(s))))
    return sort === 'easy' ? [...r].sort((a, b) => (ix.problems[a.pid]?.rating || 9999) - (ix.problems[b.pid]?.rating || 9999)) : r
  }, [ups, kinds, whys, q, sort, ix])
  // newest first: grouped by the round it came from; easiest first: one flat list
  const groups = useMemo(() => {
    if (sort === 'easy') return [{ key: 'all', title: '', date: '', kind: null as Kind | null, items: shown.slice(0, n) }]
    const m = new Map<string, { key: string; title: string; date: string; kind: Kind | null; items: typeof shown }>()
    for (const u of shown.slice(0, n)) { if (!m.has(u.act)) m.set(u.act, { key: u.act, title: u.title, date: u.date, kind: u.kind, items: [] }); m.get(u.act)!.items.push(u) }
    return [...m.values()]
  }, [shown, sort, n])
  const totals = useMemo(() => { const t = new Map<string, number>(); for (const u of shown) t.set(u.act, (t.get(u.act) || 0) + 1); return t }, [shown])
  const overdue = ups.filter(u => due.get(u.pid)?.overdue).length
  const now = Date.now()
  if (!ups.length) return <Empty icon="task_alt" title="Nothing left to upsolve" text="Every problem from your rounds, mocks and practice is solved. New ones land here the moment a round ends." />
  return (
    <div className="arc-layout">
      <aside className="card arc-aside">
        <div className="arc-deck-big"><b>{ups.length}</b><span>to upsolve</span></div>
        {overdue > 0 && <p className="small arc-err"><Icon n="schedule" /> {overdue} past the 72-hour upsolve window</p>}
        <Search value={q} onChange={setQ} placeholder="Search problems, rounds, tags" />
        <div className="field-label">From</div>
        <Chips multi value={kinds} onChange={k => setKinds(ks => ks.includes(k) ? ks.filter(x => x !== k) : [...ks, k])}
          options={UP_KINDS.filter(k => byKind[k.v] || kinds.includes(k.v)).map(k => ({ v: k.v, label: `${k.label} · ${byKind[k.v] || 0}`, icon: k.icon }))} />
        <div className="field-label">Why it is here</div>
        <Chips multi value={whys} onChange={w => setWhys(ws => ws.includes(w) ? ws.filter(x => x !== w) : [...ws, w])}
          options={(Object.keys(WHY) as UpWhy[]).filter(w => byWhy[w] || whys.includes(w)).map(w => ({ v: w, label: `${WHY[w].label} · ${byWhy[w] || 0}` }))} />
        <Seg className="mini" label="Order" value={sort} onChange={setSort} options={[{ v: 'new', label: 'Newest' }, { v: 'easy', label: 'Easiest' }]} />
        <Btn icon="replay" disabled={busy} onClick={() => { const L = skillNow().level; startPractice({ mode: 'upsolve', tags: [], lo: L - 300, hi: L + 500, minutes: 60, timebox: 1.25, by: 'user' }) }}>Start an upsolve session</Btn>
        <p className="small muted">Solve any of these on Codeforces and it leaves this list on its own (it shows as “upsolved” in History). It gets its flashcard then too.</p>
      </aside>
      <div className="arc-main">
        {!shown.length && <p className="small muted arc-none">No match. {(kinds.length || whys.length || q) ? <button type="button" className="arc-more" onClick={() => { setKinds([]); setWhys([]); setQ('') }}>Clear filters</button> : null}</p>}
        {groups.map(g => (
          <section key={g.key} className={g.title ? 'arc-act open' : 'arc-list'}>
            {g.title && <div className="arc-up-gh">
              {g.kind && <span className="arc-kind" title={KIND_LABEL[g.kind]}><Icon n={KIND_ICON[g.kind] || 'event'} fill /></span>}
              <span className="grow arc-act-t"><b>{g.title}</b><span className="small muted">{fmtDay(g.date)}{g.date.slice(0, 4) !== String(new Date().getFullYear()) ? ' ' + g.date.slice(0, 4) : ''}</span></span>
              <span className="small muted">{totals.get(g.key) || g.items.length} left</span>
            </div>}
            <div className="arc-act-b">
              {g.items.map(u => {
                const m = ix.problems[u.pid], d = due.get(u.pid)
                return (
                  <div key={u.pid} className={'arc-up-row' + (d?.overdue ? ' overdue' : '')}>
                    <button type="button" className="grow arc-up-main" onClick={() => onOpen(u.pid)}>
                      <span className="arc-pname">{m?.name || u.pid} <span className="prob-id">{u.pid}</span></span>
                      <span className="small muted">{WHY[u.why].long}{d ? (d.overdue ? ' · overdue' : ` · due in ${Math.max(1, Math.round((d.due - now) / 36e5))}h`) : ''}{!g.title ? ` · ${u.title}` : ''}</span>
                    </button>
                    <Rating r={m?.rating} />
                    <ProbLink pid={u.pid} className="arc-up-go"><Icon n="open_in_new" /></ProbLink>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
        {shown.length > n && <Btn kind="tonal" icon="expand_more" onClick={() => setN(x => x + PAGE)}>Show more ({shown.length - n} more)</Btn>}
      </div>
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
  // flashcards are only for problems you solved (unsolved ones live in Upsolve and get a card once solved)
  const missing = useMemo(() => shown.filter(p => p.status === 'solved' && !ix.cards[p.pid]).map(p => p.pid), [shown, ix])
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
          <Btn icon="auto_awesome" disabled={!missing.length} onClick={make}>{missing.length ? `Make flashcards for ${missing.length} solved without one` : 'Every solved match has a card'}</Btn>
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
/** the Today "Review" button opens the Cards view straight into a review of what is due */
let reviewOnOpen = false
function Cards({ ix, due, onOpen }: { ix: ArchiveIndex; due: string[]; onOpen: (pid: string) => void }) {
  const [run, setRun] = useState<string[] | null>(() => { if (reviewOnOpen && due.length) { reviewOnOpen = false; return due } reviewOnOpen = false; return null })
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'rating' | 'recent'>('rating')
  const [openPid, setOpenPid] = useState<string | null>(null)
  // topic folders: closed until you open one; which are open is remembered
  const [openT, setOpenT] = useState<Set<string>>(() => { try { return new Set(JSON.parse(lsGet(TOPICS_KEY) || '[]')) } catch { return new Set() } })
  const toggleT = (t: string) => setOpenT(o => { const n = new Set(o); if (n.has(t)) n.delete(t); else n.add(t); lsSet(TOPICS_KEY, JSON.stringify([...n])); return n })
  const total = Object.keys(ix.cards).length
  const all = useMemo(() => Object.entries(ix.cards).map(([pid, c]) => {
    const m = ix.problems[pid]
    return { pid, c, m, topic: topicOf(m?.tags, c.tags) }
  }), [ix])
  const topics = useMemo(() => {
    const n = new Map<string, number>(); for (const x of all) n.set(x.topic, (n.get(x.topic) || 0) + 1)
    const rank = (t: string) => { const i = TOPIC_ORDER.indexOf(t); return i < 0 ? TOPIC_ORDER.length : i }
    return [...n.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
  }, [all])
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    const hit = (x: (typeof all)[number]) => !s || x.pid.toLowerCase().includes(s) || (x.m?.name || '').toLowerCase().includes(s)
      || (x.c.key_idea || '').toLowerCase().includes(s) || (x.c.summary || '').toLowerCase().includes(s) || [...(x.m?.tags || []), ...(x.c.tags || [])].some(t => t.includes(s))
    const ord = (a: (typeof all)[number], b: (typeof all)[number]) => sort === 'rating' ? (a.m?.rating || 9999) - (b.m?.rating || 9999) || (a.pid < b.pid ? -1 : 1) : (b.c.at || 0) - (a.c.at || 0)
    return topics.map(([t]) => ({ t, items: all.filter(x => x.topic === t && hit(x)).sort(ord) })).filter(g => g.items.length)
  }, [all, topics, q, sort])
  const searching = !!q.trim()
  if (!total) return <Empty icon="style" title="No flashcards yet" text="Every problem you solve gets a card on its own: the statement, how it should be solved and how you solved it.">
    <JobLine ix={ix} />
  </Empty>
  if (run) return <div className="arc-cardsv"><Deck ix={ix} ids={run} onExit={() => setRun(null)} onOpen={onOpen} /></div>
  const fresh = due.filter(p => !ix.srs[p]).length
  const next = Object.values(ix.srs).map(x => x.due).filter(d => d > dateKey()).sort()[0]
  const rec = due.slice(0, 8)
  return (
    <div className="arc-cardsv">
      {/* today's review: what is due, and the cards it recommends first */}
      <section className="card arc-today-deck">
        <div className="arc-td-l">
          <div className="arc-deck-big"><b>{due.length}</b><span>due today</span></div>
          <p className="small muted">{due.length ? `${fresh ? `${fresh} new · ` : ''}${due.length - fresh} to review` : next ? `All caught up · next ${fmtDate(next, true)}` : 'All caught up'} · {total} cards</p>
          <Btn icon="play_arrow" size="lg" disabled={!due.length} onClick={() => setRun(due)}>{due.length ? 'Start review' : 'Nothing due'}</Btn>
        </div>
        {rec.length > 0 && <div className="arc-td-r">
          <div className="arc-rec-h"><Icon n="auto_awesome" fill /> Recommended now</div>
          <div className="arc-rec">
            {rec.map(pid => { const m = ix.problems[pid]; return (
              <button key={pid} type="button" className="arc-rec-i" onClick={() => setRun([pid, ...due.filter(p => p !== pid)])} title="Review this one first">
                <span className="arc-rec-n">{m?.name || pid}</span>
                <span className="arc-rec-m"><Rating r={m?.rating} /><span className="small muted">{ix.srs[pid] ? 'review' : 'new'} · {topicLabel(topicOf(m?.tags, ix.cards[pid]?.tags))}</span></span>
                {ix.cards[pid]?.summary && <span className="arc-rec-s">{withMath(ix.cards[pid].summary || '')}</span>}
              </button>) })}
          </div>
        </div>}
      </section>

      {/* every card, by topic: one compact row each, the back opens in place */}
      <div className="arc-ctools">
        <Search value={q} onChange={setQ} placeholder="Search cards, ideas, tags" />
        <Seg className="mini" label="Order" value={sort} onChange={setSort} options={[{ v: 'rating', label: 'Easiest' }, { v: 'recent', label: 'Newest' }]} />
        <IconBtn icon={openT.size ? 'unfold_less' : 'unfold_more'} title={openT.size ? 'Close all folders' : 'Open all folders'}
          onClick={() => { const n = openT.size ? new Set<string>() : new Set(groups.map(g => g.t)); setOpenT(n); lsSet(TOPICS_KEY, JSON.stringify([...n])) }} />
      </div>
      {!groups.length && <p className="small muted arc-none">No match.</p>}
      <div className="arc-folders">
        {groups.map(g => {
          const open = searching || openT.has(g.t)
          const nDue = g.items.filter(x => due.includes(x.pid) && ix.srs[x.pid]).length, nNew = g.items.filter(x => !ix.srs[x.pid]).length
          return (
            <section key={g.t} className={'arc-folder' + (open ? ' open' : '')}>
              <button type="button" className="arc-folder-h" onClick={() => toggleT(g.t)} aria-expanded={open}>
                <Icon n={open ? 'folder_open' : 'folder'} fill />
                <span className="grow arc-folder-t">{topicLabel(g.t)}</span>
                {nDue > 0 && <span className="arc-due">{nDue} due</span>}
                {nNew > 0 && <span className="arc-new">{nNew} new</span>}
                <span className="arc-folder-n">{g.items.length}</span>
                <Icon n={open ? 'expand_less' : 'expand_more'} />
              </button>
              <AnimatePresence initial={false}>
                {open && <motion.div className="arc-folder-b" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring}>
                  <div className="arc-crows">{g.items.map(x => <CardRow key={x.pid} pid={x.pid} entry={x.c} m={x.m} due={due.includes(x.pid) && !!ix.srs[x.pid]}
                    open={openPid === x.pid} onToggle={() => setOpenPid(o => o === x.pid ? null : x.pid)} onOpen={onOpen} />)}</div>
                </motion.div>}
              </AnimatePresence>
            </section>
          )
        })}
      </div>
      <JobLine ix={ix} />
    </div>
  )
}

/* one card as a compact row (name, rating, key idea); the front and back open in place */
function CardRow({ pid, entry, m, due, open, onToggle, onOpen }: { pid: string; entry: CardEntry; m?: ProbMeta; due: boolean; open: boolean; onToggle: () => void; onOpen: (pid: string) => void }) {
  const [d, setD] = useState<ProblemDetail | 'err' | null>(null)
  useEffect(() => { if (open && !d) loadProblem(pid).then(setD, () => setD('err')) }, [open, d, pid])
  return (
    <div className={'arc-crow' + (open ? ' open' : '')}>
      <button type="button" className="arc-crow-h" onClick={onToggle} aria-expanded={open}>
        <span className="arc-crow-t"><b>{m?.name || pid}</b> <span className="prob-id">{pid}</span>{due && <span className="arc-due">due</span>}</span>
        <Rating r={m?.rating} />
        <Icon n={open ? 'expand_less' : 'expand_more'} />
        <span className="arc-crow-k small muted">{entry.key_idea ? withMath(entry.key_idea) : ''}</span>
      </button>
      {open && <div className="arc-crow-b">
        {entry.summary && <p className="arc-summary">{withMath(entry.summary)}</p>}
        {d === 'err' ? <p className="small arc-err">Could not load this card.</p> : !d ? <p className="small muted">Loading…</p>
          : d.card ? <CardBack card={d.card} code={d.code} /> : null}
        <div className="row wrap"><Btn kind="text" size="sm" icon="open_in_full" onClick={() => onOpen(pid)}>Problem, statement and history</Btn></div>
      </div>}
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
      if (e.key === 'Escape') { e.preventDefault(); onExit(); return } // ends the review (it may have started on its own)
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
    <section className={'card arc-deck reviewing' + (shown ? ' shown' : '')}>
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
            {card?.summary ? <p className="arc-summary">{withMath(card.summary)}</p> : <p className="small muted">No summary — open the full statement.</p>}
            {d.statement && <details className="arc-det"><summary><Icon n="description" /> Full statement</summary><Statement text={d.statement} /></details>}
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
      {card.key_idea && <p className="arc-key"><Icon n="lightbulb" fill /> <span>{withMath(card.key_idea)}</span></p>}
      {card.intended && <div className="arc-sec"><h4><Icon n="route" /> How it should be solved</h4><Md math text={card.intended} /></div>}
      {card.mine && <div className="arc-sec mine"><h4><Icon n="person" /> How you solved it</h4><Md math text={card.mine} /></div>}
      {card.compare && <div className="arc-sec diff"><h4><Icon n="compare_arrows" /> What differed</h4><Md math text={card.compare} /></div>}
      {card.pitfalls?.length > 0 && <div className="arc-sec"><h4><Icon n="warning" /> Pitfalls</h4><ul>{card.pitfalls.map((p, k) => <li key={k}>{withMath(p)}</li>)}</ul></div>}
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
        {ix.codeDir && <Organize ix={ix} />}
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

/* keeping the folder organized: the server files every linked solution, this shows it and can undo the last batch */
function Organize({ ix }: { ix: ArchiveIndex }) {
  const [busy, setBusy] = useState(false)
  const on = ix.organize !== false, last = ix.lastOrganize
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f() } catch (e) { toast('Failed: ' + (e instanceof Error ? e.message : 'server error'), 'error') } finally { setBusy(false) } }
  return (
    <section className="arc-org">
      <Switch on={on} label="Keep this folder organized" onChange={v => void run(async () => { await setOrganize(v); if (v) { const r = await organizeNow(); toast(r.moves.length ? `Filed ${r.moves.length} file${r.moves.length > 1 ? 's' : ''}` : 'Already organized', 'folder') } })} />
      <p className="small muted">Every linked solution goes to <code>Contests/</code>, <code>Virtual/</code>, <code>Mocks/</code> or <code>Practice/</code>, in a folder per round or day, named <code>1772A A+B.cpp</code>. Save new solutions anywhere in the folder. Files edited in the last 2 hours are left alone, nothing is ever overwritten, and only names change, never what is inside.</p>
      <div className="row wrap">
        <Btn kind="tonal" size="sm" icon="folder_managed" disabled={busy} onClick={() => void run(async () => { const r = await organizeNow(); toast(r.moves.length ? `Filed ${r.moves.length} file${r.moves.length > 1 ? 's' : ''}` : 'Already organized', 'folder') })}>Organize now</Btn>
        {last && <Btn kind="text" size="sm" icon="undo" disabled={busy} onClick={() => void run(async () => { const n = await undoOrganize(); toast(`Moved ${n} file${n === 1 ? '' : 's'} back · automatic organizing is off`, 'undo') })}>Undo last ({last.n})</Btn>}
      </div>
      {last && <details className="arc-det"><summary className="small">Last organized {fmtWhen(last.at)} · {last.n} file{last.n > 1 ? 's' : ''}</summary>
        <ul className="arc-moves small">{last.moves.map(m => <li key={m.to}><span className="muted">{m.from}</span><br />→ {m.to}</li>)}</ul></details>}
    </section>
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
    try { const r = await queueCards([p], force); toast(!r.queued ? 'Flashcards are only for solved problems' : force ? 'Card will be rewritten' : 'Card queued', 'style') } catch { toast('Could not queue the card', 'error') }
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
            {d?.card && m?.status === 'solved' ? <Btn kind="text" size="sm" icon="refresh" disabled={queued} onClick={() => make(true)}>{queued ? 'Rewriting…' : 'Rewrite'}</Btn> : null}</div>
          {d?.card ? <>
            {d.card.summary && <p className="arc-summary">{withMath(d.card.summary)}</p>}
            <CardBack card={d.card} />
            <p className="small muted">Written {fmtWhen(d.card.at)}{d.card.model ? ` · ${d.card.model}` : ''}{d.srs ? ` · next review ${fmtDate(d.srs.due, true)}` : ''}</p>
          </> : queued ? <p className="small muted"><Icon n="progress_activity" className="arc-spin" /> Card is being written…</p>
            : !d && !err ? <p className="small muted">Loading…</p>
            : err && ix.cards[p] ? <p className="small arc-err">Could not load this card.{ix.cards[p].key_idea ? <span className="muted"> Key idea: {ix.cards[p].key_idea}</span> : null}</p>
            : m?.status !== 'solved' ? <p className="small muted">You get a flashcard once you solve it. It is in Upsolve until then.</p>
            : <div className="row wrap">{failed && <span className="small arc-err grow">Last try failed: {failed}</span>}<Btn icon="auto_awesome" onClick={() => make(false)}>Make card</Btn></div>}
        </section>

        <section className="arc-block">
          <h3 className="title"><Icon n="description" /> Statement</h3>
          {err ? <p className="small arc-err">Could not load the details.</p> : !d ? <p className="small muted">Loading…</p>
            : d.statement ? <details className="arc-det"><summary>Show full statement</summary><Statement text={d.statement} /></details>
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
