import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { getProb, TAG_SET, useCf, type Skill } from '../cf'
import { activeTest, logResource, startPractice } from '../train'
import { done, learningSubs, nextSubs, persistEarned, setSub, SUB_BY_ID, subGates, subProblem, subSkillsMemo, tickCses, TOPICS, type Sub, type SubSkill, type SubState } from '../curriculum'
import { Btn, IconBtn, Sheet } from './common'
import { Icon } from './fx'
import { ProbLink, Rating } from './cpui'
import { WavyBar } from './shapes'
import '../styles/curriculum.css'

/* ═════════ learning, sub-topic by sub-topic: theory (USACO Guide · CP Handbook · cp-algorithms) → ladder → mastery ═════════ */

const ST_LABEL: Record<SubState, string> = { new: 'new', learning: 'learning', learned: 'learned', mastered: 'mastered' }
const KIND: Record<string, string> = { usaco: 'USACO Guide', cph: 'CP Handbook', cpalgo: 'cp-algorithms', 'cf-edu': 'CF EDU', 'cf-blog': 'CF blog', other: 'Read' }

export function useSubs(sk: Skill) {
  const cp = useStore(s => s.cp); const cf = useCf()
  // only the slices subSkills reads; the module cache shares one result between Train, Ladder and the daily plan
  return useMemo(() => subSkillsMemo(sk, cp, getProb, cf.problems.length), [cp.events, cp.subs, cp.subtag, cp.cses, sk.level, sk.solved.size, sk.touched.size, sk.failed.length, cf.problems.length]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Train: the sub-topics you're learning now + what's next for your rank */
export function LearningCard({ sk }: { sk: Skill }) {
  const cp = useStore(s => s.cp), ss = useSubs(sk)
  const [browse, setBrowse] = useState(false), [just, setJust] = useState<string[]>([])
  // your solves showed a sub-topic learned: record it (cp.subs, coach data) and say so before it leaves the card
  useEffect(() => {
    persistEarned(cp, ss) // earned states stick even when your level later raises the floor
    const fin = learningSubs(cp).filter(id => done(ss.get(id)?.derived))
    if (!fin.length) return
    fin.forEach(id => setSub(id, 'learned'))
    setJust(j => [...new Set([...j, ...fin])])
  }, [ss]) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = learningSubs(cp).filter(id => { const st = ss.get(id)?.st; return st === 'learning' || st === 'new' }).map(id => SUB_BY_ID.get(id)!)
  const next = nextSubs(sk, cp, ss, 8)
  const g = subGates(sk, ss)
  if (!TOPICS.length) return null
  return (
    <section className="card learning">
      <div className="card-head"><h3 className="title"><Icon n="school" fill /> Learning</h3>
        <Btn size="sm" kind="text" icon="menu_book" onClick={() => setBrowse(true)}>Full curriculum</Btn></div>
      <div className="small muted">Toward {g.target}: <b>{g.done.length}/{g.need.length}</b> sub-topics learned</div>
      <WavyBar value={g.done.length / Math.max(1, g.need.length)} height={10} />
      {cur.length === 0 && <p className="small muted">Pick what to learn next. Each sub-topic comes with its theory, then a ladder of problems that gets harder as you go.</p>}
      {just.map(id => <div key={id} className="row small"><Icon n="celebration" fill /><span className="grow">Learned <b>{SUB_BY_ID.get(id)?.name}</b>: clean solves at its level</span><IconBtn icon="close" title="Dismiss" onClick={() => setJust(j => j.filter(x => x !== id))} /></div>)}
      {cur.map(s => <SubCard key={s.id} s={s} sk={sk} k={ss.get(s.id)!} />)}
      {next.length > 0 && <>
        <div className="field-label">{cur.length ? 'Up next' : 'Start one'}</div>
        <div className="next-subs">{next.map(s => (
          <button key={s.id} className="next-sub" onClick={() => setSub(s.id, 'learning')}>
            <Icon n="add" /><span><b>{s.name}</b><small>{s.topicName} · {s.tier}</small></span>
          </button>))}</div>
      </>}
      <CurriculumSheet open={browse} onClose={() => setBrowse(false)} sk={sk} ss={ss} />
    </section>
  )
}

/** one sub-topic in progress: what to learn, where to read it, the problem ladder */
const RKEY = (sub: string) => 'mom.reading.' + sub
const readMins = (r: { at: number }) => Math.max(1, Math.round((Date.now() - r.at) / 60000))
function SubCard({ s, sk, k, embedded }: { s: Sub; sk: Skill; k: SubSkill; embedded?: boolean }) {
  const cp = useStore(x => x.cp)
  const [open, setOpen] = useState(true)
  // the pending read survives the card unmounting (sheet closed, another sub tapped)
  const [reading, setReadingRaw] = useState<{ id: string; at: number } | null>(() => { try { return JSON.parse(localStorage.getItem(RKEY(s.id)) || 'null') } catch { return null } })
  const setReading = (r: { id: string; at: number } | null) => { setReadingRaw(r); try { r ? localStorage.setItem(RKEY(s.id), JSON.stringify(r)) : localStorage.removeItem(RKEY(s.id)) } catch { /* private mode */ } }
  const startReading = (id: string) => { if (reading && reading.id !== id) logResource(reading.id, readMins(reading)); if (reading?.id !== id) setReading({ id, at: Date.now() }) }
  // keep the minute count live while you read
  const [, tick] = useState(0), live = useRef(0)
  useEffect(() => {
    if (!reading) return
    const f = () => tick(++live.current)
    const iv = setInterval(f, 30000); document.addEventListener('visibilitychange', f)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', f) }
  }, [reading])
  const busy = !!cp.active || !!activeTest()
  const tag = s.cfTags.filter(t => TAG_SET.has(t)).slice(0, 1)
  const ladderLeft = !!subProblem(sk, cp, s, 0, new Set(), getProb)
  const stoppable = cp.subs?.[s.id]?.st === 'learning' && !done(k.st)
  const cf = s.problems.filter(p => p.src === 'cf').map(p => ({ ...p, r: getProb(p.id)?.r ?? p.rating })).sort((a, b) => (a.r || 0) - (b.r || 0))
  const cses = s.problems.filter(p => p.src === 'cses')
  const solved = (pid: string) => sk.solved.has(pid), tried = (pid: string) => sk.touched.has(pid)
  return (
    <div className="sub-card">
      <div className="row">{embedded ? <span className="small muted grow">{s.topicName} · {s.tier}</span>
        : <button className="sub-title grow" onClick={() => setOpen(o => !o)}><Icon n={open ? 'expand_less' : 'expand_more'} /><b>{s.name}</b><span className="small muted">{s.topicName} · {s.tier}</span></button>}
        <span className={'tlabel ' + (done(k.st) ? 'strong' : 'shaky')}>{cp.subs?.[s.id]?.st === 'paused' && !done(k.st) ? 'paused' : ST_LABEL[k.st]}</span>
        {stoppable && <IconBtn icon="pause" title={`Stop learning ${s.name}`} onClick={() => setSub(s.id, null)} />}</div>
      <div className="sub-progress small muted">{k.cfDone}/{k.cfTotal} ladder problems · {k.clean.length} clean solves{k.cses ? ` · ${k.cses} CSES` : ''} · {k.need ? `learned at ${k.need} clean solve${k.need > 1 ? 's' : ''} ≥ ${Math.max(800, Math.min(s.tier, sk.level) - 200)}` : 'reading only: mark it when done'}</div>
      {(open || embedded) && <>
        <p className="small">{s.summary}</p>
        <div className="field-label">What to learn</div>
        <ul className="learn-list">{s.learn.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <div className="field-label">Theory</div>
        <ol className="res-list">{s.resources.map((r, i) => (
          <li key={i}><a href={r.url} target="_blank" rel="noreferrer" onClick={() => startReading(s.id + ':' + i)}>{r.title}</a> <span className="muted small">· {KIND[r.kind] || r.kind}{r.where ? ` · ${r.where}` : ''}{r.minutes ? ` · ${r.minutes}m` : ''}</span></li>))}</ol>
        {reading && <Btn size="sm" kind="tonal" icon="done" onClick={() => { logResource(reading.id, readMins(reading)); setReading(null) }}>Done reading ({readMins(reading)} min)</Btn>}
        <div className="field-label">Problem ladder</div>
        <ul className="sub-ladder">{cf.map(p => (
          <li key={p.id} className={solved(p.id) ? 'ok' : tried(p.id) ? 'tried' : ''}>
            <Icon n={solved(p.id) ? 'check_circle' : tried(p.id) ? 'replay' : 'radio_button_unchecked'} fill={solved(p.id)} />
            <ProbLink pid={p.id} className="lad-link"><Rating r={p.r} /> {p.name}</ProbLink></li>))}</ul>
        {cses.length > 0 && <>
          <div className="field-label">CSES (tick when accepted)</div>
          <ul className="sub-ladder">{cses.map(p => { const d = !!cp.cses?.[p.id]?.done; return (
            <li key={p.id} className={d ? 'ok' : ''}><button type="button" className="tick" onClick={() => tickCses(p.id, !d)} aria-pressed={d} aria-label={`${p.name}: accepted`}><Icon n={d ? 'check_box' : 'check_box_outline_blank'} fill={d} /></button>
              <a className="lad-link" href={`https://cses.fi/problemset/task/${p.id.slice(5)}`} target="_blank" rel="noreferrer">{p.name}</a></li>) })}</ul>
        </>}
        <div className="row wrap">
          {!ladderLeft && !tag.length ? <span className="small muted"><Icon n="check" /> Ladder done</span>
          : <Btn size="sm" icon="play_arrow" disabled={busy} onClick={() => { const lo = Math.max(800, Math.min(sk.level, s.tier) - 300); startPractice({ mode: 'learn', sub: s.id, tags: tag, lo, hi: Math.max(lo + 200, Math.min(Math.max(sk.level, s.tier) + 100, sk.level + 400)), minutes: 90, timebox: 1.25, by: 'user', why: `Learn ${s.name}` }) }}>Practice {s.name}</Btn>}
          {k.st !== 'learned' && k.st !== 'mastered' && <Btn size="sm" kind="text" icon="done_all" onClick={() => setSub(s.id, 'learned')}>I've learned it</Btn>}
        </div>
      </>}
    </div>
  )
}

/** every topic and sub-topic, with your state in each */
export function CurriculumSheet({ open, onClose, sk, ss }: { open: boolean; onClose: () => void; sk: Skill; ss: Map<string, SubSkill> }) {
  const cp = useStore(s => s.cp)
  const [q, setQ] = useState(''), [sel, setSel] = useState<string | null>(null)
  const ql = q.trim().toLowerCase()
  const learning = new Set(learningSubs(cp))
  const hit = (t: (typeof TOPICS)[number], s: Sub) => !ql || [s.name, t.name, s.summary, ...s.cfTags, ...s.learn].some(x => x.toLowerCase().includes(ql))
  const any = TOPICS.some(t => t.subs.some(s => hit(t, s)))
  return (
    <Sheet open={open} onClose={onClose} title="Curriculum">
      <input className="cf-input" placeholder="Search sub-topics (e.g. knapsack, LCA, KMP)" value={q} onChange={e => setQ(e.target.value)} />
      <p className="small muted">Built from the USACO Guide, the Competitive Programmer's Handbook and cp-algorithms. Tap a sub-topic to see its theory and problems.</p>
      {!any && <div className="small muted">No sub-topics match “{q.trim()}”. <Btn size="sm" kind="text" icon="close" onClick={() => setQ('')}>Clear search</Btn></div>}
      {TOPICS.map(t => {
        const subs = t.subs.filter(s => hit(t, s))
        if (!subs.length) return null
        const d = t.subs.filter(s => { const st = ss.get(s.id)?.st; return st === 'learned' || st === 'mastered' }).length
        return (
          <div key={t.id} className="cur-topic">
            <div className="row"><b className="grow">{t.name}</b><span className="small muted">{d}/{t.subs.length}</span></div>
            <ul className="cur-subs">{subs.map(s => { const k = ss.get(s.id)!, paused = cp.subs?.[s.id]?.st === 'paused' && !done(k.st); return (
              <li key={s.id}>
                <button className={'cur-sub ' + k.st} onClick={() => setSel(sel === s.id ? null : s.id)}>
                  <Icon n={k.st === 'mastered' ? 'star' : k.st === 'learned' ? 'check_circle' : learning.has(s.id) ? 'school' : paused ? 'pause_circle' : 'circle'} fill={k.st !== 'new'} />
                  <span className="grow">{s.name}</span><span className="small muted">{s.tier}</span></button>
                {sel === s.id && <div className="cur-detail">
                  {!learning.has(s.id) && !done(k.st) && <Btn size="sm" icon={paused ? 'play_arrow' : 'add'} onClick={() => setSub(s.id, 'learning')}>{paused ? 'Resume' : 'Learn this'}</Btn>}
                  <SubCard s={s} sk={sk} k={k} embedded />
                </div>}
              </li>) })}</ul>
          </div>
        )
      })}
    </Sheet>
  )
}

/** Ladder: per-topic sub-topic progress */
export function SubProgress({ sk }: { sk: Skill }) {
  const ss = useSubs(sk), g = subGates(sk, ss)
  if (!TOPICS.length) return null
  return (
    <section className="card subprog">
      <div className="card-head"><h3 className="title"><Icon n="account_tree" fill /> Sub-topic mastery</h3><span className="small muted">learned / total, per topic</span></div>
      <div className="small muted">Toward {g.target}: <b>{g.done.length}/{g.need.length}</b> sub-topics learned</div>
      <WavyBar value={g.done.length / Math.max(1, g.need.length)} height={12} />
      <ul className="subprog-list">{TOPICS.map(t => {
        const k = t.subs.map(s => ss.get(s.id)!), d = k.filter(x => x.st === 'learned' || x.st === 'mastered').length, m = k.filter(x => x.st === 'mastered').length
        return <li key={t.id}><span className="sp-name" title={t.name}>{t.name}</span><span className="sp-bar"><i style={{ width: `${(d / t.subs.length) * 100}%` }} /><b style={{ width: `${(m / t.subs.length) * 100}%` }} /></span><span className="small muted">{d}/{t.subs.length}</span></li>
      })}</ul>
    </section>
  )
}
