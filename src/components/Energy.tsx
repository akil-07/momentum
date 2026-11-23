import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { dateKey, setCp, useStore } from '../store'
import { firstSync } from '../sync'
import { lightenPlan } from '../train'
import { Btn, Chips } from './common'
import { Icon } from './fx'
import '../styles/analytics.css'

/** one-tap morning self-report (sleep hours, energy 1-5); renders nothing once answered today */
export function EnergyCheck() {
  const today = dateKey()
  const done = useStore(s => !!s.cp.energy?.[today])
  const [sleep, setSleep] = useState<number | null>(null)
  const [energy, setEnergy] = useState<number | null>(null)
  // wait for the first pull so an unsynced device can't overwrite the morning check made on the other one
  const [synced, setSynced] = useState(false)
  useEffect(() => { void firstSync.then(() => setSynced(true)) }, [])
  if (!synced || done || new Date().getHours() >= 14) return null
  // a short night / flat morning lightens today's practice plan (only while none of it has started)
  const write = (v: { sleep?: number; energy?: number }) => { setCp(c => ({ ...c, energy: { ...(c.energy || {}), [today]: { ...v, u: Date.now() } } })); lightenPlan(today) }
  return (
    <motion.section className="card energy-check" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="card-head">
        <h3 className="title"><Icon n="bedtime" fill /> Morning check</h3>
        <span className="small muted">one tap · finds your best hours</span>
      </div>
      <div className="ec-row"><span className="ec-l small">Slept ≈</span>
        <Chips value={sleep ?? -1} onChange={v => setSleep(v)} options={[4, 5, 6, 7, 8, 9].map(h => ({ v: h, label: h === 9 ? '9+ h' : `${h} h` }))} />
      </div>
      <div className="ec-row"><span className="ec-l small">Energy</span>
        <Chips value={energy ?? -1} onChange={v => setEnergy(v)} options={[1, 2, 3, 4, 5].map(e => ({ v: e, label: String(e) }))} />
      </div>
      <div className="row ec-actions">
        <Btn kind="text" size="sm" onClick={() => write({})}>Skip today</Btn>
        <Btn kind="filled" size="sm" icon="check" disabled={sleep === null && energy === null}
          onClick={() => write({ ...(sleep !== null ? { sleep } : {}), ...(energy !== null ? { energy } : {}) })}>Save</Btn>
      </div>
    </motion.section>
  )
}
