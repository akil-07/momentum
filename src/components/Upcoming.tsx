import { useMemo, useState } from 'react'
import { dateKey, getState, keyToDate, useStore, type Proposal, isWork } from '../store'
import { applyProposal, askPlanner, diffProposal, hasChanges, rejectProposal, undoProposal, upcoming } from '../planner'
import { NORMAL_MOCK, seasonLabel, seasonOn, targetFor } from '../season'
import { dismiss, resetSession, useTurns } from '../claude'
import { useSync } from '../sync'
import { Btn, IconBtn, useAutoScroll, useNow } from './common'
import { confirmAsk, fmtDay, fmtDur } from '../ui'
import '../styles/plan.css'
import { Icon } from './fx'
import { Loader } from './shapes'
import { Md } from './CoachPanel'
import { DayList } from './DayEditor'

/* ═════════ Plan with Claude: talk to the planner session, preview, apply, undo; and the next 7 days ═════════ */

const EXAMPLES = [
  'Here is my timetable this semester: classes Mon/Wed/Fri 9:00-12:30, labs Tue 14:00-17:00, until Dec 20.',
  'My exams: Data Structures on the 28th at 10:00, Linear Algebra on Dec 3 at 14:00. Plan revision around them.',
  'Gym 3 times a week in the mornings, and keep Sunday evening free.',
  'Plan tomorrow around a Codeforces round at 20:05.',
]

export function Upcoming() {
  const proposals = useStore(x => x.planner.proposals), hasNotes = useStore(x => !!x.planner.notes.text)
  const workTarget = useStore(x => x.settings.workTarget), seasons = useStore(x => x.seasons)
  const today = dateKey(useNow(60000))
  const todayTasks = useStore(x => x.days[today]?.tasks), template = useStore(x => x.template), agenda = useStore(x => x.agenda)
  const syncOff = useSync().state === 'off'
  const turns = useTurns('planner')
  const chatBox = useAutoScroll<HTMLDivElement>()
  const [msg, setMsg] = useState('')
  const pend = turns.filter(t => t.state !== 'done' && t.state !== 'error')
  const props = useMemo(() => Object.values(proposals).sort((a, b) => a.at - b.at).slice(-8), [proposals])
  const send = (t: string) => { if (!t.trim() || syncOff) return; askPlanner(t.trim()); setMsg('') }
  // the next 7 days: today's real tasks, then routine + agenda (recomputed when those change, not on every heartbeat)
  const days = useMemo(() => upcoming(getState(), 7), [todayTasks, template, agenda, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const season = useMemo(() => { const s = getState(); return new Map(days.map(d => [d.date, seasonOn(d.date, s)])) }, [days, seasons])
  const [open, setOpen] = useState(today)
  // the seasons covering the shown days (one chip each: "Exam season · until 5 Dec")
  const shown = [...new Map([...season.values()].filter(x => !!x).map(x => [x!.id, x!])).values()]
  const reset = async () => { if (await confirmAsk({ title: 'Start a fresh planner conversation?', body: 'It keeps its notes about your schedule.', ok: 'Start fresh' })) await resetSession('planner', true) }
  return (
    <>
      <section className="card planner">
        <div className="card-head"><h3 className="title"><Icon n="event_note" fill /> Plan with Claude</h3><span className="small muted">tell it your timetable, exams, plans</span></div>
        {syncOff && <p className="small muted"><Icon n="info" /> The planner is a persistent Claude Code session on your laptop. Connect sync in Settings to use it.</p>}
        <div className="chat" ref={chatBox}>
          {!props.length && <p className="muted small">Describe your week or month in plain words. Each day's practice + mock target (4.5 h + 2 h normally, light in an exam season) is placed around everything else. Tell it your exam dates and it sets the season. It remembers what you tell it.</p>}
          {props.map(p => <ProposalView key={p.id} p={p} />)}
          {pend.map(t => <div key={t.id} className="bubble coach pending"><Loader size={18} /> {t.err && t.state === 'queued' ? t.err : t.state === 'running' ? 'Planning… (a month can take a minute or two)' : 'Sending…'}</div>)}
          {turns.filter(t => t.state === 'error').slice(-1).map(t => <div key={t.id} className="bubble err">{t.err} <button type="button" className="linkish pad" onClick={() => dismiss(t.id)}>dismiss</button></div>)}
        </div>
        <div className="chips quick">{EXAMPLES.map(e => <button type="button" key={e} className="chip" disabled={syncOff} title={e} onClick={() => setMsg(e)}>{e.slice(0, 42)}…</button>)}</div>
        <form className="row chat-in" onSubmit={e => { e.preventDefault(); send(msg) }}>
          <textarea value={msg} onChange={e => setMsg(e.target.value)} disabled={syncOff} aria-label="Message to the planner" rows={3}
            placeholder={syncOff ? 'Connect sync to use the planner' : 'e.g. Exams on 2 and 5 Dec; classes Mon-Fri 9-1 until then; plan my next two weeks'} />
          <IconBtn icon="send" kind="filled" title="Plan it" disabled={syncOff || !msg.trim()} onClick={() => send(msg)} />
        </form>
        <div className="session-foot small muted"><span>{hasNotes ? 'The planner keeps notes about your schedule.' : ''}</span><button type="button" className="linkish pad" onClick={() => void reset()}>Reset planner</button></div>
      </section>

      <section className="card week">
        <div className="card-head"><h3 className="title"><Icon n="date_range" fill /> Next 7 days</h3><span className="small muted">tap a block to change it · work target {workTarget} h</span></div>
        {shown.length > 0 && <div className="chips">{shown.map(x => <span key={x.id} className="chip on" title={`${x.cpMin} min CP a day · ${x.mock ? 'daily mock' : 'no mock'} · rated rounds ${x.contests}`}><Icon n={x.kind === 'exam' ? 'school' : 'beach_access'} /> {seasonLabel(x)} · {x.from > days[0].date ? `${fmtDay(x.from)} – ` : 'until '}{fmtDay(x.until)}</span>)}</div>}
        <div className="cols week-cols">
        <div className="day-strip" role="tablist" aria-label="Day">{days.map(d => {
          const cp = d.tasks.filter(t => isWork(t.cat)).reduce((a, t) => a + t.dur, 0), goal = workTarget * 60, se = season.get(d.date)
          return (
            <button key={d.date} type="button" role="tab" aria-selected={open === d.date} aria-label={`${fmtDay(d.date, true)}, ${cp ? fmtDur(cp) : 'no'} work planned${se ? ', ' + seasonLabel(se) : ''}`}
              className={'day-chip' + (open === d.date ? ' on' : '') + (cp >= goal ? ' ok' : cp ? ' part' : '')} onClick={() => setOpen(d.date)} title={se ? seasonLabel(se) : undefined}>
              <small>{se?.kind === 'exam' ? <Icon n="school" /> : null}{keyToDate(d.date).toLocaleDateString(undefined, { weekday: 'short' })}</small><b>{keyToDate(d.date).getDate()}</b><i>{cp ? <><span className="dc-long">{fmtDur(cp)}</span><span className="dc-short">{+(cp / 60).toFixed(1)}h</span></> : '—'}</i>
              <span className="dc-wide">{fmtDay(d.date, true)}{se ? <em>{seasonLabel(se)}</em> : null}</span>
            </button>
          )
        })}</div>
        <DayList date={open} tasks={days.find(d => d.date === open)?.tasks || []} />
        </div>
      </section>
    </>
  )
}

function ProposalView({ p }: { p: Proposal }) {
  // only a pending proposal needs the live agenda (its preview diff); applied / rejected ones never re-render on edits
  const pending = p.status === 'pending'
  const agenda = useStore(x => pending ? x.agenda : null), del = useStore(x => pending ? x.del : null), template = useStore(x => pending ? x.template : null)
  const seasons = useStore(x => pending ? x.seasons : null), workTarget = useStore(x => x.settings.workTarget)
  const [show, setShow] = useState(pending)
  const diff = useMemo(() => pending ? diffProposal(getState(), p) : [], [p, pending, agenda, del, template])
  const targetOf = useMemo(() => { const s = getState(); return (d: string) => targetFor(d, s) }, [seasons]) // eslint-disable-line react-hooks/exhaustive-deps
  const has = hasChanges(p)
  // an automatic fix of another proposal: no second copy of the student's message
  if (p.status === 'superseded') return (
    <>{!p.repairOf && <div className="bubble me">{p.prompt}</div>}<div className="bubble coach small muted"><Icon n="history" /> {p.repairing === false && p.issues?.length ? 'Had overlaps — replaced by the fixed version below.' : 'Replaced by a newer plan below (never applied).'}</div></>
  )
  return (
    <>
      {!p.repairOf && <div className="bubble me">{p.prompt}</div>}
      {p.repairing ? <div className="bubble coach pending"><Icon n="build" /> Found {p.issues?.length || 0} overlap{p.issues?.length === 1 ? '' : 's'} in this plan — the planner is fixing {p.issues?.length === 1 ? 'it' : 'them'} before you see it…</div> : p.status === 'error' ? <div className="bubble err">{p.err || 'Planner failed'}</div> : p.summary || p.questions.length ? (
        <div className="bubble coach">
          {p.summary && <Md text={p.summary} />}
          {p.questions.length > 0 && <ul className="plan-qs">{p.questions.map((q, i) => <li key={i}><Icon n="help" fill /> {q}</li>)}</ul>}
          {has && <div className="small muted">{p.days.length} day{p.days.length === 1 ? '' : 's'} · {fmtDay(p.range.from)} → {fmtDay(p.range.to)}{p.routine.length ? ` · ${p.routine.length} routine change${p.routine.length === 1 ? '' : 's'}` : ''}{p.season ? ` · ${seasonLabel(p.season).toLowerCase()} ${fmtDay(p.season.from)} → ${fmtDay(p.season.until)}` : ''} · <b>{p.status}</b></div>}
          {p.repairOf && <div className="small muted"><Icon n="verified" /> Checked by the app{p.issues?.length ? '' : ': no overlaps'}.</div>}
          {p.status === 'pending' && p.issues?.length ? <ul className="plan-qs">{p.issues.map((x, i) => <li key={i}><Icon n="warning" /> {x}</li>)}</ul> : null}
          {p.status === 'pending' && has && <>
            <button type="button" className="linkish small pad" onClick={() => setShow(x => !x)}>{show ? 'Hide' : 'Preview'} changes</button>
            {show && <div className="diff">
              {p.season && <div className="diff-row add"><Icon n={p.season.kind === 'exam' ? 'school' : 'beach_access'} /> {seasonLabel(p.season)}: <b>{fmtDay(p.season.from)} → {fmtDay(p.season.until)}</b> · {fmtDur(p.season.cpMin)} CP a day · {p.season.mock ? 'daily mock' : 'no mock'} · rated rounds {p.season.contests}</div>}
              {p.routine.map((r, i) => <div key={i} className={'diff-row ' + (r.op === 'remove' ? 'rm' : r.op === 'add' ? 'add' : 'chg')}><Icon n="repeat" /> Routine {r.op}: <b>{r.title || r.block_id}</b> {r.start || ''}{r.dur ? ' · ' + fmtDur(r.dur) : ''} · {r.days.map(d => 'SMTWTFS'[d]).join('')}{r.from || r.until ? ` · ${r.from ? fmtDay(r.from) : '…'} → ${r.until ? fmtDay(r.until) : '…'}` : ''}</div>)}
              {diff.map(d => (
                <div key={d.date} className="diff-day">
                  <div className="diff-date"><b>{fmtDay(d.date)}</b>
                    <span className={'tlabel ' + (d.workMin >= workTarget * 60 ? 'strong' : 'weak')}>Work {fmtDur(d.workMin)}</span>{(() => { const t = p.season && p.season.from <= d.date && d.date <= p.season.until ? { cpMin: p.season.cpMin, mockMin: p.season.mock ? NORMAL_MOCK : 0 } : targetOf(d.date), need = t.cpMin + t.mockMin; return need > 0 && d.cpMin < need ? <span className="small muted">CP only {fmtDur(d.cpMin)} of {fmtDur(need)}</span> : null })()}<span className="small muted">{fmtDur(d.totalMin)} planned in all</span></div>
                  {d.add.map(t => <div key={t.id} className="diff-row add">+ {t.start || '--:--'} {t.title} · {fmtDur(t.dur)}</div>)}
                  {d.change.map(([a, b]) => <div key={b.id} className="diff-row chg">~ {b.title}: {a.start || '--'} → {b.start || '--'} · {fmtDur(b.dur)}</div>)}
                  {d.remove.map(t => <div key={t.id} className="diff-row rm">− {t.title}</div>)}
                  {d.skips.map(b => <div key={b} className="diff-row rm">⤫ skip routine block {template?.find(x => x.id === b)?.title || b}</div>)}
                  {d.conflicts.map(c => <div key={c} className="diff-row warn"><Icon n="warning" /> overlap: {c}</div>)}
                </div>
              ))}
            </div>}
            <div className="row wrap">
              <Btn icon="check" onClick={() => applyProposal(p.id)}>Apply</Btn>
              <Btn kind="tonal" icon="close" onClick={() => rejectProposal(p.id)}>Reject</Btn>
            </div>
          </>}
          {p.status === 'applied' && Date.now() - p.u < 24 * 36e5 && <Btn kind="text" size="sm" icon="undo" onClick={() => undoProposal(p.id)}>Undo this plan</Btn>}
        </div>
      ) : null}
    </>
  )
}
