import { useState } from 'react'
import { refreshLeverage, useLeverage } from '../leverage'
import { getCfUser, useCf } from '../cf'
import { Btn } from './common'
import { Icon } from './fx'
import '../styles/leverage.css'

/* ═════════ where your rating actually comes from: exact what-ifs re-ranked into real standings ═════════ */

export function LeverageCard() {
  const lev = useLeverage(), cf = useCf()
  const [busy, setBusy] = useState(false)
  const rated = cf.user?.rated?.length || 0
  const run = async () => { const u = getCfUser(); if (!u) return; setBusy(true); try { await refreshLeverage(u.handle, 6) } finally { setBusy(false) } }
  if (!cf.user) return null
  const head = (
    <div className="card-head"><h3 className="title"><Icon n="trending_up" fill /> Rating levers</h3>
      {rated > 0 && <Btn size="sm" kind="text" icon={busy ? 'progress_activity' : 'refresh'} disabled={busy} onClick={run}>{busy ? 'Analysing…' : 'Re-analyse'}</Btn>}</div>
  )
  if (!rated) return (
    <section className="card leverage">{head}
      <p className="small muted">After your first rated round, this re-ranks you inside the real standings and shows exactly which change would have gained the most rating: solving one more problem, solving faster, or fewer wrong submissions.</p>
    </section>
  )
  if (!lev) return (
    <section className="card leverage">{head}
      <p className="small muted">{busy ? 'Downloading the standings of your rated rounds (takes ~10 s per contest)…' : 'Not analysed yet.'}</p>
      {!busy && <Btn icon="insights" onClick={run}>Analyse my contests</Btn>}
    </section>
  )
  const top = lev.levers.filter(l => l.perContest > 0).slice(0, 4), max = Math.max(1, ...top.map(l => l.perContest))
  const lastCid = lev.whatIfs[lev.whatIfs.length - 1]?.contestId
  const recent = lev.whatIfs.filter(w => w.contestId === lastCid && w.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 4)
  return (
    <section className="card leverage">{head}
      {top.length ? <>
        <p className="lev-hero">Your #1 lever: <b>{top[0].label}</b> <span className="lev-gain">+{Math.round(top[0].perContest)}</span> <span className="small muted">rating per contest</span></p>
        <ul className="lev-bars">{top.map((l, i) => (
          <li key={l.key}><span className="lev-label">{l.label}</span>
            <span className="lev-track"><span className={'lev-fill' + (i === 0 ? ' top' : '')} style={{ width: `${(l.perContest / max) * 100}%` }} /></span>
            <span className="lev-val">+{Math.round(l.perContest)}</span></li>))}</ul>
      </> : <p className="small muted">No single change would have moved your rating much: keep doing what you're doing.</p>}
      {recent.length > 0 && <div className="lev-whatif"><div className="small muted">Last round, re-ranked in the real standings:</div>
        <ul>{recent.map(w => <li key={w.contestId + ':' + w.label}>{w.label} <b>→ +{Math.round(w.delta)}</b></li>)}</ul></div>}
      {Object.keys(lev.speedTable).length > 0 && <div className="lev-speed"><span className="small muted">Solve-by targets at {lev.targetTier}:</span>
        {Object.entries(lev.speedTable).map(([p, m]) => <span key={p} className="chip mini">{p} ≤ {Math.round(m)}m</span>)}</div>}
      <p className="small muted">From {lev.contests} rated round{lev.contests === 1 ? '' : 's'}. Your practice plan's first block targets the top lever.</p>
    </section>
  )
}
