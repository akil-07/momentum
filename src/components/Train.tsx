import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { dateKey, fmtDur, getState, fmtMin, sameHandle, toMin, useStore, type CpPlan, type SessSpec } from '../store'
import { cpLabel, sessOfSpec } from '../cpblocks'
import { getProb, isContestRec, isProvisional, isVoidTest, settledRating, syllabus, tierOf, useCf, weakest, type Skill } from '../cf'
import { activeTest, cpMatchToday, discardMock, ensurePlan, mockChoice, planStarted, practiceTarget, queues, setCalib, setHandle, startBlock, startDrill, startPractice, startRealRound, startTest, useSkill, startFree } from '../train'

import { dayPractice } from '../discipline'
import { Btn, Chips, bouncy } from './common'
import { Icon } from './fx'
import { Loader, Shape, WavyBar } from './shapes'
import { LETTERS, ProbLink, Rating, rc } from './cpui'
import { CpSession, RealResult } from './Session'
import { isSolved } from '../review'
import { IdeaReview } from './Ideas'
import { LearningCard } from './Curriculum'
import { ContestRadar } from './ContestMode'
import { ANY_TIME, confirmAsk } from '../ui'
import '../styles/realround.css'
import '../styles/today.css'

export function Train({ onLadder }: { onPomodoro?: () => void; onLadder?: () => void }) {
  const cf = useCf(), sk = useSkill()
  const handle = useStore(s => s.cp.handle), calib = useStore(s => s.cp.calib), tests = useStore(s => s.cp.tests), cp = useStore(s => s.cp)
  const plan = useStore(s => s.cp.plans[dateKey()])
  const u = cf.user
  useEffect(() => { ensurePlan() }, [cf.problems.length])
  const prov = isProvisional(u)
  const myRounds = Object.values(tests).filter(t => t.finishedAt && !isVoidTest(t, cp) && sameHandle(t.h, handle) && Date.now() - t.startedAt < 60 * 864e5).length

  if (!handle) return (
    <div className="view train">
      <header className="greet"><div><div className="overline">Training</div><h1 className="display-sm">Today's reps</h1></div></header>
      <p className="train-nohandle">Practice sessions, mock rounds and lessons are built from your Codeforces history — link your handle to start.</p>
      <LinkCard />
      <ContestRadar />
      <CpSession />
    </div>
  )
  return (
    <div className="view train">
      <header className="greet"><div><div className="overline">Training</div><h1 className="display-sm">Today's reps</h1></div></header>
      {(!u || prov) && (u?.contests ?? 0) < 3 && sk.events < 25 && myRounds < 3 && <Calibrate current={calib} level={sk.level} ready={cf.problems.length > 0} />}
      <div className="cols flat">
        <div className="col-main">
          {!cf.problems.length ? <section className="card center"><Loader /><p className="muted">Loading the Codeforces problemset…</p></section> : <>
            {plan && <Practice plan={plan} sk={sk} />}
            {plan && <MockRound plan={plan} sk={sk} />}
            <Queues sk={sk} />
          </>}
        </div>
        <aside className="col-side" aria-label="Contests and learning">
          <ContestRadar />
          <LevelStrip onLadder={onLadder} />
          {cf.problems.length > 0 && <><IdeaReview /><LearningCard sk={sk} /></>}
        </aside>
      </div>
      <CpSession />
    </div>
  )
}

/** one-line standing on the training page; the full picture lives on Progress → Ladder */
function LevelStrip({ onLadder }: { onLadder?: () => void }) {
  const cf = useCf(), sk = useSkill(), u = cf.user, prov = isProvisional(u)
  const curR = settledRating(u) || sk.level, tier = tierOf(curR)
  return (
    <button className="card level-strip" onClick={onLadder}>
      <b style={{ color: rc(curR) }}>{curR}</b>
      <span className="grow"><span className="small">{prov ? `Training at ${tier.name} level` : tier.name}{tier.next ? ` · ${tier.next - curR} to ${tier.nextName}` : ''}</span>
        {tier.next && <WavyBar value={(curR - tier.from) / (tier.next - tier.from)} height={8} color={rc(curR)} />}</span>
      {cf.status.busy ? <Icon n="progress_activity" className="spin" /> : <span className="small muted">Ladder <Icon n="chevron_right" /></span>}
    </button>
  )
}

const CAL = [
  { v: 800, l: 'Just starting', d: 'learning the basics' }, { v: 1000, l: 'Div 2 A', d: 'usually solve A' }, { v: 1200, l: 'Div 2 A–B', d: 'A and B reliably' },
  { v: 1400, l: 'Div 2 C', d: 'C some of the time' }, { v: 1600, l: 'Div 2 C–D', d: 'C reliably, D sometimes' }, { v: 1800, l: 'Div 2 D', d: 'D reliably' }, { v: 2000, l: 'Div 2 E+', d: 'E sometimes' },
]
function Calibrate({ current, level, ready }: { current: number; level: number; ready: boolean }) {
  return (
    <section className="card calib">
      <div className="card-head"><h3 className="title"><Icon n="tune" fill /> New account — where are you starting?</h3><span className="small muted">now aiming at {level}</span></div>
      <p className="small muted">Pick what you can solve <b>reliably</b> today. It fades out as your solves and mock rounds come in.</p>
      <div className="cal-grid">{CAL.map(c => (
        <motion.button key={c.v} disabled={!ready} whileTap={{ scale: 0.95 }} transition={bouncy} className={'cal' + (current === c.v ? ' on' : '')} onClick={() => setCalib(c.v)}>
          <b>{c.l}</b><span className="rating" style={{ color: rc(c.v), borderColor: rc(c.v) }}>~{c.v}</span><small>{c.d}</small>
        </motion.button>))}</div>
    </section>
  )
}
export function LinkCard() {
  const [h, setH] = useState(''), [busy, setBusy] = useState(false)
  return (
    <section className="card cf-link">
      <div className="cf-link-ic"><Shape shape="clover8" size={100} spin={10} /><Icon n="link" fill /></div>
      <h2 className="headline">Link your Codeforces handle</h2>
      <p className="muted">Your full submission history becomes a skill rating for every topic, and every verdict feeds your coach.</p>
      <form className="row" onSubmit={async e => { e.preventDefault(); if (!h.trim()) return; setBusy(true); await setHandle(h); setBusy(false) }}>
        <input className="cf-input" aria-label="Codeforces handle" value={h} onChange={e => setH(e.target.value)} placeholder="handle" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <Btn type="submit" icon="link" disabled={busy || !h.trim()}>{busy ? 'Linking…' : 'Link'}</Btn>
      </form>
    </section>
  )
}

/* ───────── today's practice: the season's target (4.5 h on a normal day) as coach-designed (or default) open-ended sessions ───────── */
const MODE_ICON: Record<string, string> = { learn: 'school', drill: 'fitness_center', mixed: 'shuffle', speed: 'speed', resolve: 'autorenew', upsolve: 'replay', deep: 'psychology_alt', position: 'format_list_numbered' }
const specTitle = (s: SessSpec) => s.mode === 'deep' ? 'Deep · 1 hard problem' : cpLabel(sessOfSpec(s))
function Practice({ plan, sk }: { plan: CpPlan; sk: Skill }) {
  const cp = useStore(s => s.cp)
  useStore(s => s.seasons) // a season edit moves the target
  const k = dateKey(), mins = dayPractice(getState(), k), tgt = practiceTarget(k)
  const done = Object.values(cp.sessions).filter(s => s.date === k && s.kind === 'practice')
  const busy = !!cp.active || !!activeTest()
  const specs = plan.specs || []
  const weak = weakest(sk, cp.focusTags)[0]?.tag
  const startSpec = (s: SessSpec) => startPractice(s)
  // each session's block in today's schedule (the same block the play button there runs)
  const tasks = useStore(s => s.days[k]?.tasks)
  const bySpec = tasks ? cpMatchToday()?.bySpec || [] : []
  const blockOf = (i: number) => tasks?.find(t => t.id === bySpec[i])
  return (
    <section className="card practice">
      <div className="card-head">
        <h3 className="title"><Icon n="exercise" fill /> Today's practice</h3>
        <span className="small muted">{fmtDur(mins)} / {fmtDur(tgt.minutes)} · {done.reduce((a, s) => a + s.solved.length, 0)} solved</span>
      </div>
      <WavyBar value={mins / Math.max(1, tgt.minutes)} height={14} />
      {(tgt.light || tgt.target.kind !== 'normal') && <div className="small muted"><Icon n={tgt.light ? 'bedtime' : 'event_note'} /> {[tgt.light, tgt.target.kind === 'exam' ? `Exam season: ${fmtDur(tgt.target.cpMin)} a day` : tgt.target.kind === 'break' ? 'Break' : ''].filter(Boolean).join(' · ')}</div>}
      <ul className="specs">
        {specs.map((s, i) => {
          const b = blockOf(i)
          // its block says (a session that ran this spec elsewhere only counts when the spec has no block)
          const finished = b ? !!b.done : done.some(s => s.specIdx === i)
          const when = b ? (b.start ? `${b.start}–${fmtMin(toMin(b.start) + b.dur)}` : ANY_TIME) : ''
          return (
            <li key={i} className={'spec' + (finished ? ' done' : '')}>
              <div className="spec-ic"><Icon n={MODE_ICON[s.mode] || 'play_arrow'} fill /></div>
              <div className="grow">
                <div className="spec-t">{specTitle(s)} <span className="muted small">· {when ? <b>{when}</b> : null}{when ? ' · ' : ''}{fmtDur(b ? b.dur : s.minutes)} · {s.lo}–{s.hi}</span>{s.by === 'coach' && <span className="chip mini tert"><Icon n="psychology" /> coach</span>}</div>
                {s.why && <div className="small muted">{s.why}</div>}
              </div>
              {finished ? <Icon n="check_circle" fill className="ok" /> : <Btn size="sm" icon="play_arrow" disabled={busy} onClick={() => b ? startBlock(b) : startSpec(s)}>Start</Btn>}
            </li>
          )
        })}
      </ul>
      <div className="row wrap spec-quick">
        {!specs.length && <Btn icon="timer" disabled={busy} onClick={() => startPractice(undefined, 90)}>Start practice</Btn>}
        <Btn kind="tonal" icon="travel_explore" disabled={busy} title="Solve anything you like on Codeforces; every Accepted counts and earns XP" onClick={() => startFree(60)}>Free solve</Btn>
        <Btn kind="tonal" icon="bolt" disabled={busy || !!activeTest()} title={`One problem against the clock on your weakest topic${weak ? ` (${weak})` : ''}`} onClick={() => startDrill()}>Drill weak topics</Btn>
      </div>
      <p className="small muted">Start the timer and keep going — the next problem appears the moment you solve or skip one. Every open, submission and minute is captured for your coach.</p>
      {!planStarted() && <Btn kind="text" size="sm" icon="refresh" onClick={() => ensurePlan(true)}>Rebuild today's plan</Btn>}
    </section>
  )
}

function Queues({ sk }: { sk: Skill }) {
  useStore(s => s.cp.resolve); useStore(s => s.cp.tests)
  const busy = useStore(s => !!s.cp.active)
  const q = queues(sk)
  if (!q.upsolve.length && !q.resolve.length) return null
  return (
    <section className="card queues">
      <div className="card-head"><h3 className="title"><Icon n="replay" fill /> Upsolve &amp; re-solve</h3></div>
      {q.upsolve.length > 0 && <div className="small">To upsolve: {q.upsolve.map(x => <ProbLink key={x.pid} pid={x.pid} className="pid-chip"><Rating r={getProb(x.pid)?.r} /> {x.pid}</ProbLink>)}</div>}
      {q.resolve.length > 0 && <div className="small">Spaced re-solves due: {q.resolve.map(p => <ProbLink key={p} pid={p} className="pid-chip"><Rating r={getProb(p)?.r} /> {p}</ProbLink>)}</div>}
      <div className="row wrap">
        {q.upsolve.length > 0 && <Btn size="sm" icon="replay" disabled={busy} onClick={() => startPractice({ mode: 'upsolve', tags: [], lo: sk.level - 300, hi: sk.level + 500, minutes: 60, timebox: 1.25, by: 'user' })}>Upsolve session</Btn>}
        {q.resolve.length > 0 && <Btn size="sm" kind="tonal" icon="autorenew" disabled={busy} onClick={() => startPractice({ mode: 'resolve', tags: [], lo: 800, hi: 3500, minutes: 40, timebox: 1, by: 'user' })}>Re-solve now</Btn>}
      </div>
    </section>
  )
}

/* ───────── the daily 2h syllabus mock ───────── */
function MockRound({ plan, sk }: { plan: CpPlan; sk: Skill }) {
  const cp = useStore(s => s.cp), busy = !!cp.active
  useCf(); useStore(s => s.seasons) // the finished-round list arrives async; a season edit changes whether a mock is due
  // a discarded / voided mock doesn't count (today's mock is open again); a rated round you took is shown as such
  const t = Object.values(cp.tests).find(x => x.date === plan.date && !isVoidTest(x, cp) && !isContestRec(x))
  const rec = Object.values(cp.tests).find(x => x.date === plan.date && isContestRec(x) && !isVoidTest(x, cp))
  const ratings = plan.test.map(p => getProb(p)?.r || 0)
  const syl = syllabus(sk, cp)
  const ch = mockChoice(sk)
  const [pickKind, setKind] = useState<'real' | 'syllabus' | null>(null)
  const kind = !ch.pick ? 'syllabus' : pickKind ?? ch.kind
  const pk = ch.pick
  if (!t && !ch.offer) return (
    <section className="card mock">
      <div className="card-head"><h3 className="title"><Icon n="sports_score" fill /> {ch.rated ? 'Rated round' : 'Daily mock contest'}</h3>{ch.rated && <span className="small muted">{ch.rated.name}</span>}</div>
      <p className="small muted">{ch.why}</p>
      {rec && <RealResult t={rec} />}
    </section>
  )
  return (
    <section className="card mock">
      <div className="card-head"><h3 className="title"><Icon n="sports_score" fill /> Daily mock contest</h3><span className="small muted">{t?.real ? 'real round · virtual on CF' : kind === 'real' && !t ? 'real past round · virtual on CF' : '6 problems · 2 hours · syllabus only'}</span></div>
      {!t ? <>
        {pk && <div className="mock-kind"><Chips value={kind} onChange={setKind} options={[{ v: 'real', label: 'Real round' }, { v: 'syllabus', label: 'Syllabus mock' }]} /></div>}
        <div className="small muted">{ch.why}</div>
        {kind === 'real' && pk ? <div className="mock-pick">
          <div className="row wrap"><b className="grow">{pk.name}</b><span className="chip mini tert">{pk.div}</span><span className="small muted">{pk.dur} min · {pk.rule === 'icpc' ? 'ICPC rules' : 'CF scoring'} · {new Date(pk.start).getFullYear()}</span></div>
          <div className="ladder" style={{ gridTemplateColumns: `repeat(${Math.min(pk.ratings.length, 8)}, minmax(0, 1fr))` }}>{pk.ratings.slice(0, 8).map((r, i) => <div key={i} className="ladder-step"><b>{pk.pids[i].slice(String(pk.contestId).length)}</b><Rating r={r} /></div>)}</div>
          <div className="small muted">Unseen by you. Taken as a <b>virtual participation</b> on Codeforces: exact rank, would-be rating change and performance from the real standings{pk.offSyl ? ` · ${pk.offSyl} early problem${pk.offSyl > 1 ? 's' : ''} touch topics outside your syllabus` : ''}.</div>
          <Btn size="xl" icon="play_arrow" onClick={() => startRealRound(pk)} disabled={busy}>{busy ? 'Finish your session first' : 'Start real round'}</Btn>
        </div> : <>
          <div className="ladder">{ratings.map((r, i) => <div key={i} className="ladder-step"><b>{LETTERS[i]}</b><Rating r={r} /></div>)}</div>
          <div className="small muted">Difficulty offset {plan.mockOffset ? (plan.mockOffset > 0 ? '+' : '') + plan.mockOffset : '±0'} — rises after two strong mocks in a row. Syllabus: {syl.join(', ')}</div>
          <Btn size="xl" icon="play_arrow" onClick={() => startTest()} disabled={busy}>{busy ? 'Finish your session first' : 'Start mock contest'}</Btn>
        </>}
      </> : !t.finishedAt ? <div className="row wrap"><p className="muted grow">Running… open the session to see the problems.</p>
        <Btn kind="text" size="sm" icon="delete" onClick={async () => { if (await confirmAsk({ title: 'Discard this mock?', body: 'It will not count: no performance, no failures, no upsolves.', ok: 'Discard', danger: true })) discardMock() }}>Discard mock</Btn></div>
      : t.real ? <RealResult t={t} /> : <>
        <div className="mock-res">
          <div className="mock-perf" style={{ color: rc(t.perf || 0) }}><small>performance</small>{t.perf}</div>
          <div><b>{Object.keys(t.solved).length}/{t.pids.length}</b> solved<div className="small muted">{(t.perf || 0) >= sk.level ? `+${(t.perf || 0) - sk.level} above your level` : `${sk.level - (t.perf || 0)} below your level`}</div></div>
        </div>
        <ul className="probs">{t.pids.map((pid, i) => {
          const p = getProb(pid), s = t.solved[pid], up = s === undefined && isSolved(pid)
          return <li key={pid} className={'prob ' + (s !== undefined ? 'solved' : up ? 'upsolved' : 'failed')}><ProbLink pid={pid}>
            <div className="prob-top"><b>{LETTERS[i]}</b><Rating r={p?.r} /><span className="prob-id">{pid}</span>{s !== undefined ? <span className="small">{Math.round(s / 60)} min</span> : up ? <span className="small ok-t">upsolved</span> : <span className="small err">unsolved — upsolve anytime</span>}</div>
            <div className="prob-name">{p?.n}</div></ProbLink></li>
        })}</ul>
      </>}
    </section>
  )
}
