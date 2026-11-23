import { motion } from 'motion/react'
import { useStore } from '../store'
import { isProvisional, PROVISIONAL_CONTESTS, settledRating, tierOf, topicState, useCf, type Skill } from '../cf'
import { detect, setHandle, useSkill } from '../train'
import { IconBtn, bouncy } from './common'
import { Icon } from './fx'
import { Shape, WavyBar } from './shapes'
import { rc } from './cpui'
import { LinkCard } from './Train'
import { LeverageCard } from './Leverage'
import { confirmAsk } from '../ui'
import { RivalsCard } from './Charts'
import { SubProgress } from './Curriculum'

/* ═════════ the ladder: where you stand and what moves your rating (the rounds ahead live on Train → Contest radar) ═════════ */

export function Ladder() {
  const cf = useCf(), sk = useSkill(), handle = useStore(s => s.cp.handle)
  const u = cf.user, prov = isProvisional(u)
  const curR = settledRating(u) || sk.level
  const tier = tierOf(curR)
  if (!handle) return <LinkCard />
  return (
    <>
        <section className="card cf-pos">
          <div className="cf-pos-top">
            <div className="cf-badge" style={{ color: rc(curR) }}><Shape shape="cookie9" size={100} spin={6} /><span>{curR}</span></div>
            <div className="grow">
              <div className="overline">{u ? `${u.handle} · ${prov ? `provisional · ${u.contests ?? 0}/${PROVISIONAL_CONTESTS} rated contests` : 'rated'}` : handle}</div>
              <h2 className="headline" style={{ color: rc(curR) }}>{prov ? `Training at ${tier.name} level` : tier.name}</h2>
              <div className="small muted">Practice level <b>{sk.level}</b>{u?.rating ? <> · CF shows {u.rating}{prov ? ' (still climbing from boosts)' : ''}</> : null} · {sk.events} problems tracked</div>
            </div>
            <IconBtn icon={cf.status.busy ? 'progress_activity' : 'refresh'} title="Refresh from Codeforces" className={cf.status.busy ? 'spin' : ''} onClick={() => detect(true)} />
            <IconBtn icon="swap_horiz" title="Change handle" onClick={async () => { if (await confirmAsk({ title: 'Unlink this Codeforces handle?', body: 'Your in-app progress stays.', ok: 'Unlink', danger: true })) void setHandle('') }} />
          </div>
          {tier.next && <><WavyBar value={(curR - tier.from) / (tier.next - tier.from)} height={16} color={rc(curR)} /><div className="small muted"><b>{tier.next - curR}</b> rating to {tier.nextName}</div></>}
          {cf.status.err && <div className="small err"><Icon n="error" /> {cf.status.err}</div>}
        </section>
      <LeverageCard />
      <SubProgress sk={sk} />
      <Topics sk={sk} />
      <RivalsCard />
    </>
  )
}

function Topics({ sk }: { sk: Skill }) {
  const cp = useStore(s => s.cp), level = sk.level
  const sorted = [...sk.tags].sort((a, b) => a.rel - b.rel)
  return (
    <section className="card topics">
      <div className="card-head"><h3 className="title"><Icon n="radar" fill /> Topic strength</h3><span className="small muted">rating per topic vs your level {level}</span></div>
      <ul className="topic-list">{sorted.map(t => {
        const x = Math.max(0, Math.min(1, (t.theta - (level - 500)) / 1000)), st = topicState(sk, cp, t.tag)
        return (
          <li key={t.tag} className={'topic ' + t.label}>
            <div className="topic-name">{t.tag}<span className={'tlabel ' + t.label}>{t.label}</span>{st !== 'new' && <span className="tlabel">{st}</span>}</div>
            <div className="topic-bar"><i className="mid" /><motion.span className="fill" initial={{ width: 0 }} animate={{ width: `${x * 100}%` }} transition={bouncy} /></div>
            <div className="topic-n small muted">{t.n ? <><b style={{ color: rc(t.theta) }}>{t.theta}</b> · {t.solved}✓ {t.failed}✗</> : 'no data yet'}</div>
          </li>
        )
      })}</ul>
    </section>
  )
}
