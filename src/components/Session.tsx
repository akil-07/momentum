import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { activeEnd, breakCfg, breakIn, breakMs, getState, openBreak, useStore, type CpTest } from '../store'
import { contestProbUrl, contestUrl, divName, getProb, isContestRec, TAG_SET, virtualUrl, solveXp, useCf } from '../cf'
import { isSolved } from '../review'
import {
  checkExpiry, DEEP_LOCK, debrief, detect, discardMock, editorialUrl, finishActive, finishTest, giveUp, hintStage, markSolved, markTestSolved, mockScore, openProblem,
  realScore, rescoreRealRound, revealHint, skipCurrent, testEnd, timeboxOf, whyServed, skillNow, tickBreaks, skipBreak, endBreakEarly, setBreakCue } from '../train'
import { buzz, sfx } from '../sound'
import { Btn, Chips, IconBtn, bouncy, spring, useEscape, useNow } from './common'
import { confirmAsk } from '../ui'
import { Icon } from './fx'
import { WavyBar, WavyRing } from './shapes'
import { fmtClock, LETTERS, ProbLink, Rating, rc } from './cpui'
import { IdeaPrompt } from './Ideas'
import { ReviewButton } from './ReviewSheet'
import '../styles/realround.css'
import '../styles/today.css'

/* ═════════ full-screen live session: adaptive practice / mock round / drill ═════════ */

/* automatic breaks: a calm chime + buzz when a break starts, a brighter one when work resumes */
setBreakCue(k => { if (k === 'start') { sfx.level(); buzz([200, 100, 200]) } else { sfx.check(3); buzz([80, 40, 80, 40, 80]) } })

const BLOCKERS = [['idea', 'No idea'], ['wrong_idea', 'Wrong idea'], ['proof', 'Couldn’t prove'], ['impl_bug', 'Bug'], ['edge_case', 'Edge case'], ['overflow', 'Overflow'], ['complexity', 'Too slow'], ['misread', 'Misread']] as const

export function CpSession() {
  const cp = useStore(s => s.cp)
  const now = useNow(1000)
  const [min, setMin] = useState(false)
  const [deb, setDeb] = useState<string | null>(null)
  const t = Object.values(cp.tests).find(x => !x.finishedAt)
  const a = cp.active
  // Escape minimises the live session; it keeps running
  useEscape(() => setMin(true), !!(t || a) && !min)
  useEffect(() => { if (t || a) setMin(false); setDeb(null) }, [t?.id, a?.id])
  // automatic breaks (practice / free solve / drill only): checked every second, wall-clock based
  useEffect(() => { if (a && !t) tickBreaks() }, [now, a?.id, t?.id])
  const over = !!(t || a) && now.getTime() >= (t ? testEnd(t) : activeEnd(a!, now.getTime()))
  useEffect(() => { if (over) checkExpiry() }, [over])
  // the time-box check runs every 30s while practising
  useEffect(() => { if (a?.kind === 'practice' && now.getSeconds() % 30 === 0) checkExpiry() }, [now, a?.kind])
  // after each served problem resolves, ask for a 1-tap debrief of the previous one
  const prevDone = a?.kind === 'practice' ? a.pids.filter(p => p !== a.cur).slice(-1)[0] : undefined
  useEffect(() => { if (prevDone && !Object.values(getState().cp.events).some(e => e.k === 'debrief' && e.pid === prevDone)) setDeb(prevDone) }, [prevDone])
  if (!t && !a) return null
  const real = t?.real
  const kind = real ? 'Real round' : t ? 'Mock round' : a!.kind === 'drill' ? 'Drill' : a!.kind === 'practice' ? 'Practice' : 'Sprint'
  // a real round's clock follows the virtual start on CF; before it's detected, count down the grace window to start it
  const start = real?.vStart ?? (t ? t.startedAt : a!.startedAt), dur = (t ? (real && !real.vStart ? t.dur + 30 : t.dur) : a!.dur) * 60
  // a session's clock stops during its breaks (the end moves later by every break)
  const el = Math.max(0, (now.getTime() - start - (t ? 0 : breakMs(a!, now.getTime()))) / 1000), left = dur - el
  const brk = t ? undefined : openBreak(a), brkLeft = brk ? Math.max(0, (brk.start + brk.len - now.getTime()) / 1000) : 0
  const pids = t ? t.pids : a!.pids
  const solvedOf = (pid: string) => t ? t.solved[pid] !== undefined : cp.attempts[pid]?.status === 'solved'
  const k = pids.filter(solvedOf).length
  const finish = async () => {
    if (!await confirmAsk({ title: `End the ${kind.toLowerCase()} now?`, body: t ? 'Unsolved problems you opened count as failed.' : undefined, ok: 'End session', cancel: 'Keep going' })) return
    if (real) await detect(true) // last submissions first
    t ? finishTest() : finishActive('quit')
  }
  if (min) return (
    <motion.button className="cp-mini" initial={{ y: 80 }} animate={{ y: 0 }} transition={bouncy} onClick={() => setMin(false)}>
      {brk ? <><Icon n="self_improvement" fill /><b>Break · {fmtClock(brkLeft)}</b><span>{kind} resumes after</span></>
        : <><Icon n="timer" fill /><b>{fmtClock(Math.max(0, left))}</b><span>{kind} · {k} solved</span></>}
    </motion.button>
  )
  return (
    <motion.div className={'focus cp-session' + (brk ? ' on-break' : '')} initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} transition={spring}>
      <div className="focus-top">
        <span className="badge live"><i className="dot" />{kind.toUpperCase()}{a?.spec ? ` · ${a.spec.mode}${a.spec.pos ? ' ' + a.spec.pos : ''}${a.spec.tags.length ? ': ' + a.spec.tags.join(', ') : ''}` : ''}</span>
        <div className="row"><IconBtn icon="sync" title="Check Codeforces now" onClick={() => detect(true)} /><IconBtn icon="close_fullscreen" title="Minimise (keeps running)" onClick={() => setMin(true)} /></div>
      </div>
      {brk ? <div className="cp-clock">
        <div className="cp-ring"><WavyRing value={Math.min(1, 1 - brkLeft * 1000 / brk.len)} size={200} stroke={12} amp={2} waves={12} speed={0.4} color="var(--tertiary)" track="color-mix(in srgb, var(--on-tertiary-container) 15%, transparent)" /></div>
        <div className="cp-time"><div className="big brk">Break · {fmtClock(brkLeft)}</div><div className="muted">{fmtClock(Math.max(0, left))} of work left after it</div></div>
      </div> : <div className="cp-clock">
        <div className="cp-ring"><WavyRing value={Math.min(1, el / dur)} size={200} stroke={12} amp={4} waves={12} track="color-mix(in srgb, var(--on-primary-container) 15%, transparent)" /></div>
        <div className="cp-time"><div className={'big' + (left < 600 ? ' warn' : '')}>{fmtClock(Math.max(0, left))}</div><div className="muted">{real && !real.vStart ? 'to start it on CF' : <>{k} solved{a?.kind === 'practice' ? (a.spec?.mode === 'free' ? ' on your own' : ` · ${a.pids.length} served`) : `/${pids.length}`}</>}</div></div>
      </div>}

      {brk ? <BreakNow len={Math.round(brk.len / 60000)} /> : t && real ? <RealLive t={t} /> : a?.kind === 'practice' ? <PracticeNow now={now.getTime()} /> : (
        <ul className="probs cp-probs">
          {pids.map((pid, i) => {
            const p = getProb(pid), ok = solvedOf(pid)
            return (
              <li key={pid} className={'prob' + (ok ? ' solved' : '')}>
                <ProbLink pid={pid}>
                  <div className="prob-top"><b className="letter">{t ? LETTERS[i] : i + 1}</b><Rating r={p?.r} /><span className="prob-id">{pid}</span>{ok && <Icon n="check_circle" fill className="ok" />}{t && ok ? <span className="small">{Math.round(t.solved[pid] / 60)} min</span> : null}</div>
                  <div className="prob-name">{p?.n}</div>
                </ProbLink>
                {!ok && <IconBtn icon="check" kind="tonal" title="I got Accepted" onClick={async () => { await detect(true); if (!solvedOf(pid)) t ? markTestSolved(pid) : markSolved(pid, 'drill') }} />}
              </li>
            )
          })}
        </ul>
      )}
      {t && !real && <p className="small muted center">Score so far: <b>{Math.round(mockScore(t))}</b> · tags are hidden, no hints — contest rules.</p>}
      {a?.kind === 'practice' && a.spec?.mode !== 'free' && a.pids.length > 1 && <ul className="probs cp-probs past">
        {a.pids.filter(p => p !== a.cur).slice().reverse().map(pid => <li key={pid} className={'prob ' + (solvedOf(pid) ? 'solved' : 'failed')}><ProbLink pid={pid}><div className="prob-top"><Rating r={getProb(pid)?.r} /><span className="prob-id">{pid}</span>{solvedOf(pid) ? <Icon n="check_circle" fill className="ok" /> : <Icon n="replay" className="err" />}</div></ProbLink></li>)}
      </ul>}
      <div className="focus-actions"><Btn kind="tonal" icon="stop" title={`End the ${kind.toLowerCase()}`} onClick={() => void finish()}>End session</Btn>
        {t && <Btn kind="text" icon="delete" onClick={async () => { if (await confirmAsk({ title: 'Discard this mock?', body: 'It will not count: no performance, no failures, no upsolves, no time booked.', ok: 'Discard', danger: true })) discardMock() }}>Discard</Btn>}</div>
      <AnimatePresence>{deb && <Debrief pid={deb} onClose={() => setDeb(null)} />}</AnimatePresence>
    </motion.div>
  )
}

/** an automatic break: the session's clock and the problem's time-box are stopped; work resumes on its own when it ends */
function BreakNow({ len }: { len: number }) {
  const every = breakCfg().every
  return (
    <motion.div className="now-prob card brk-now" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <div className="prob-top"><Icon n="self_improvement" fill /><b>{len} min break</b><span className="why">after {every} min of work</span></div>
      <h2 className="headline">Stand up, water, look away.</h2>
      <p className="small">The session clock and the problem's time-box are paused. Work resumes by itself when the break ends; it shows as a break in your timeline, not as work.</p>
      <div className="row wrap">
        <Btn kind="tonal" icon="skip_next" onClick={skipBreak}>Skip break</Btn>
        <Btn kind="text" icon="play_arrow" onClick={endBreakEarly}>End break early</Btn>
      </div>
    </motion.div>
  )
}

/** the problem being worked on right now: time-box with escalating hints (tags → editorial hint → full editorial) */
/** free solve: nothing is picked for you — solve anything on Codeforces, every Accepted is detected and pays XP */
function FreeNow() {
  const a = useStore(s => s.cp.active), attempts = useStore(s => s.cp.attempts), cf = useCf()
  const [busy, setBusy] = useState(false)
  const solvedKey = a ? a.pids.filter(p => attempts[p]?.status === 'solved').join(' ') : ''
  // the skill model is costly: read it once per change of the solved list, not twice per problem every second
  const xp = useMemo(() => { if (!solvedKey) return 0; const L = skillNow().level; return solvedKey.split(' ').reduce((t, p) => t + solveXp(getProb(p)?.r || L, L), 0) }, [solvedKey])
  if (!a) return null
  const solved = solvedKey ? solvedKey.split(' ') : []
  return (
    <motion.div className="now-prob card free-now" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <div className="prob-top"><Icon n="travel_explore" fill /><b>Free solve</b><span className="why">{a.spec?.why}</span></div>
      <p className="small">Solve anything you like on Codeforces: unsolved problems, a random set, a past round. The app checks your submissions every ~45 s and every Accepted counts here and earns XP.</p>
      <div className="row wrap">
        <a className="btn filled" href="https://codeforces.com/problemset" target="_blank" rel="noreferrer"><Icon n="open_in_new" /> Problemset</a>
        {cf.user && <a className="btn tonal" href={`https://codeforces.com/submissions/${cf.user.handle}`} target="_blank" rel="noreferrer"><Icon n="history" /> My submissions</a>}
        <Btn kind="tonal" icon={busy ? 'progress_activity' : 'sync'} disabled={busy} onClick={async () => { setBusy(true); try { await detect(true) } finally { setBusy(false) } }}>Check now</Btn>
      </div>
      <div className="small muted">{solved.length ? <><b>{solved.length}</b> solved this session · <b>+{xp} XP</b></> : 'No accepted submissions yet this session.'}</div>
      {solved.length > 0 && <ul className="probs cp-probs">{solved.slice().reverse().map(pid => (
        <li key={pid} className="prob solved"><ProbLink pid={pid}><div className="prob-top"><Rating r={getProb(pid)?.r} /><span className="prob-id">{pid}</span><Icon n="check_circle" fill className="ok" /></div><div className="prob-name">{getProb(pid)?.n}</div></ProbLink></li>))}</ul>}
    </motion.div>
  )
}

function PracticeNow({ now }: { now: number }) {
  const a = useStore(s => s.cp.active), events = useStore(s => s.cp.events)
  const pid = a?.cur
  if (a?.spec?.mode === 'free') return <FreeNow />
  if (!a || !pid) return <p className="muted center">Picking your next problem…</p>
  const p = getProb(pid), T = timeboxOf(pid), since = a.curAt || 0
  const mins = since ? Math.max(0, now - since - breakIn(a, since, now)) / 60000 : 0 // paused during breaks
  const hint = Object.values(events).filter(e => e.pid === pid && e.k === 'hint' && e.sess === a.id).reduce((m, e) => Math.max(m, e.hl || 0), 0)
  const deep = a.spec?.mode === 'deep'
  const stage = hintStage(a.spec?.mode, mins, T, !!since)
  return (
    <motion.div key={pid} className="now-prob card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <div className="prob-top"><Rating r={p?.r} /><span className="prob-id">{pid}</span><span className="why">{whyServed.get(pid) || a.spec?.why || ''}</span></div>
      <h2 className="headline">{p?.n}</h2>
      {hint >= 1 ? <div className="prob-meta">{p?.t.filter(t => TAG_SET.has(t)).map(t => <span key={t} className="tag">{t}</span>)}</div> : <div className="small muted"><Icon n="visibility_off" /> Tags hidden — like a real contest</div>}
      <ProbLink pid={pid} className="btn filled lg open-btn"><Icon n="open_in_new" /> {since ? 'Open again' : 'Open problem — the clock starts'}</ProbLink>
      {since > 0 && <>
        <WavyBar value={Math.min(1, mins / (3 * T))} height={12} color={mins > 2 * T ? 'var(--error)' : mins > T ? 'var(--tertiary)' : 'var(--primary)'} />
        <div className="small muted">{mins > 2 * T ? <span className="tb-state over"><Icon n="warning" fill />Well over the time-box · </span> : mins > T ? <span className="tb-state past"><Icon n="schedule" />Past the time-box · </span> : null}{Math.floor(mins)} min · time-box {T} min{stage === 'nudge' ? ' — stuck? brute-force small cases and write down observations' : ''}{stage === 'locked' ? ` — hints unlock in ${Math.ceil(DEEP_LOCK - mins)} min. Small cases, invariants, write it down.` : ''}</div>
        {deep && stage === 'locked' && <div className="rr-lock small"><Icon n="lock" /> Deep mode: think it through. No tags, no editorial for the first hour.</div>}
        <div className="row wrap">
          {stage !== 'work' && stage !== 'nudge' && stage !== 'locked' && hint < 1 && <Btn kind="tonal" size="sm" icon="sell" onClick={() => revealHint(pid, 1)}>Reveal tags</Btn>}
          {(stage === 'h2' || stage === 'h3') && hint < 2 && <Btn kind="tonal" size="sm" icon="lightbulb" onClick={() => { revealHint(pid, 2); window.open(editorialUrl(pid), '_blank') }}>Editorial hint</Btn>}
          {stage === 'h3' && hint < 3 && <Btn kind="tonal" size="sm" icon="menu_book" onClick={() => { revealHint(pid, 3); window.open(editorialUrl(pid), '_blank') }}>Full editorial</Btn>}
        </div>
      </>}
      <div className="row wrap">
        <Btn icon="check" onClick={async () => { await detect(true); if (getState().cp.active?.cur === pid) markSolved(pid) }}>I got AC</Btn>
        <Btn kind="tonal" icon="skip_next" onClick={skipCurrent}>Skip</Btn>
        {!(deep && stage === 'locked') && <Btn kind="text" icon="flag" onClick={() => giveUp(pid)}>Give up</Btn>}
        {!(deep && stage === 'locked') && <ReviewButton pid={pid} sess={a.id} size="sm" />}
      </div>
    </motion.div>
  )
}

function Debrief({ pid, onClose }: { pid: string; onClose: () => void }) {
  const [blk, setBlk] = useState<string>(''), [ed, setEd] = useState('none'), [felt, setFelt] = useState('ok'), [n, setN] = useState('')
  const solved = useStore(s => s.cp.attempts[pid]?.status === 'solved')
  const [idea, setIdea] = useState(true)
  const save = () => { debrief(pid, { blk: blk || undefined, ed, felt, n: n.trim() || undefined }); onClose() }
  return (
    <motion.div className="debrief card" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }} transition={spring}>
      <div className="card-head"><b>{pid} — {solved ? 'what got in the way?' : 'what blocked you?'}</b><IconBtn icon="close" title="Skip" onClick={onClose} /></div>
      <Chips value={blk} onChange={v => setBlk(v === blk ? '' : v)} options={[{ v: '', label: solved ? 'Nothing' : 'Not sure' }, ...BLOCKERS.map(([v, label]) => ({ v, label }))]} />
      <div className="row wrap">
        <Chips value={ed} onChange={setEd} options={[{ v: 'none', label: 'No editorial' }, { v: 'hint', label: 'Hint' }, { v: 'full', label: 'Full editorial' }]} />
        <Chips value={felt} onChange={setFelt} options={[{ v: 'easy', label: 'Easy' }, { v: 'ok', label: 'OK' }, { v: 'hard', label: 'Hard' }]} />
      </div>
      <input className="cf-input" aria-label="Note for your coach" placeholder="One-line note for your coach (optional)" value={n} onChange={e => setN(e.target.value)} maxLength={140} />
      <div className="row wrap"><Btn icon="send" onClick={save}>Save</Btn>{solved && <ReviewButton pid={pid} solved size="sm" />}</div>
      {idea && <IdeaPrompt pid={pid} onDone={() => setIdea(false)} />}
    </motion.div>
  )
}

/* ───────── real past round, taken as a virtual participation on codeforces.com ───────── */
const ruleLabel = (r: 'icpc' | 'cf') => r === 'icpc' ? 'ICPC rules · penalty per WA' : 'CF scoring · points decay'
function RealLive({ t }: { t: CpTest }) {
  const r = t.real!, cid = String(r.contestId), sc = realScore(t)
  return (
    <div className="rr card">
      <div className="card-head"><div><b>{r.name}</b><div className="small muted">{divName(r.name)} · {ruleLabel(r.rule)} · {t.dur} min</div></div>
        <a className="btn tonal sm" href={contestUrl(r.contestId)} target="_blank" rel="noreferrer"><Icon n="open_in_new" /> Contest</a></div>
      {!r.vStart ? <div className="rr-start">
        <p className="small">Start the <b>virtual participation</b> on Codeforces and submit from the contest's own problem pages — the app follows your submissions, the clock syncs to CF.</p>
        <a className="btn filled lg" href={virtualUrl(r.contestId)} target="_blank" rel="noreferrer"><Icon n="play_arrow" /> Start virtual contest on CF</a>
        <p className="small muted">Tags hidden, no hints, no editorials — exact contest conditions.</p>
      </div> : <p className="small muted center">{r.rule === 'icpc' ? <>Solved <b>{sc.points}</b> · penalty <b>{sc.penalty}</b></> : <>Score so far <b>{Math.round(sc.points)}</b></>} · synced from CF virtual</p>}
      <ul className="probs cp-probs rr-probs">{t.pids.map((pid, i) => {
        const ix = pid.slice(cid.length), x = r.probs[ix], p = getProb(pid), ok = x?.at !== undefined
        return (
          <li key={pid} className={'prob' + (ok ? ' solved' : x?.wa ? ' tried' : '')}>
            <a className="prob-main" href={contestProbUrl(pid)} target="_blank" rel="noreferrer" onClick={() => openProblem(pid)}>
              <div className="prob-top"><b className="letter">{ix || LETTERS[i]}</b><Rating r={p?.r} />
                {ok ? <><Icon n="check_circle" fill className="ok" /><span className="small">{Math.floor(x.at! / 60)}:{String(x.at! % 60).padStart(2, '0')}</span></> : null}
                {x?.wa ? <span className="rr-wa">−{x.wa}</span> : null}</div>
              <div className="prob-name">{p?.n}</div>
            </a>
          </li>
        )
      })}</ul>
    </div>
  )
}
/** result of a finished real round: rank in the real standings, the rating change it would have given, performance */
export function RealResult({ t }: { t: CpTest }) {
  const [busy, setBusy] = useState(false)
  const r = t.real; if (!r) return null
  const cid = String(r.contestId), solved = t.pids.filter(p => r.probs[p.slice(cid.length)]?.at !== undefined).length
  // a rated round you took live: the delta is the real one (from your rating history), perf only once the standings are out
  const live = isContestRec(t)
  return (
    <div className="rr-res">
      <div className="small muted"><b>{r.name}</b> · {live ? 'rated, taken live' : divName(r.name)} · {r.rule === 'icpc' ? 'ICPC' : 'CF'} rules</div>
      {!r.vStart ? <p className="small muted">No virtual submissions were found for this round.</p> : <div className="rr-stats">
        <div className="mock-perf" style={{ color: rc(r.perf ?? t.perf ?? 0) }}><small>performance</small>{r.perf ?? t.perf ?? '—'}</div>
        {r.rank !== undefined ? <>
          <div className="rr-stat"><small>rank</small><b>{r.rank}</b><span className="small muted">of {r.of}</span></div>
          <div className={'rr-stat ' + ((r.delta ?? 0) >= 0 ? 'up' : 'down')}><small>{live ? 'rating Δ' : 'would-be Δ'}</small><b>{(r.delta ?? 0) >= 0 ? '+' : ''}{r.delta}</b><span className="small muted">rating</span></div>
        </> : <div className="rr-stat"><small>solved</small><b>{solved}/{t.pids.length}</b>
          <Btn kind="text" size="sm" icon="refresh" disabled={busy} onClick={async () => { setBusy(true); await rescoreRealRound(t.id); setBusy(false) }}>Re-rank</Btn></div>}
      </div>}
      <ul className="probs">{t.pids.map(pid => {
        const ix = pid.slice(cid.length), x = r.probs[ix], p = getProb(pid), ok = x?.at !== undefined, up = !ok && isSolved(pid)
        return <li key={pid} className={'prob ' + (ok ? 'solved' : up ? 'upsolved' : 'failed')}><ProbLink pid={pid}>
          <div className="prob-top"><b>{ix}</b><Rating r={p?.r} /><span className="prob-id">{pid}</span>
            {ok ? <span className="small">{Math.round(x.at! / 60)} min{x.wa ? ` · ${x.wa} WA` : ''}</span> : up ? <span className="small ok-t">{x?.wa ? `${x.wa} WA · ` : ''}upsolved</span> : <span className="small err">{x?.wa ? `${x.wa} WA · ` : ''}upsolve</span>}</div>
          <div className="prob-name">{p?.n}</div></ProbLink></li>
      })}</ul>
    </div>
  )
}
