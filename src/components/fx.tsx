import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { onFx, type Fx } from '../store'
import { buzz, sfx } from '../sound'
import { Shape } from './shapes'
import { useEscape } from './common'
import { onUndoSnack } from '../ui'

export const Icon = ({ n, fill, className, style }: { n: string; fill?: boolean; className?: string; style?: React.CSSProperties }) =>
  <span className={'msr ' + (fill ? 'fill ' : '') + (className || '')} style={style} aria-hidden>{n}</span>

/* ───────── confetti (shape-based, uses theme colours) ───────── */
function Confetti() {
  const cv = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = cv.current!, g = c.getContext('2d')!
    type P = { x: number; y: number; vx: number; vy: number; r: number; vr: number; s: number; col: string; k: number; life: number }
    let ps: P[] = [], raf = 0
    const resize = () => { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio }
    resize(); addEventListener('resize', resize)
    const cols = () => { const cs = getComputedStyle(document.documentElement); return ['--primary', '--tertiary', '--secondary', '--primary-container', '--tertiary-container', '--error'].map(v => cs.getPropertyValue(v).trim()) }
    const off = onFx(f => {
      if (f.type !== 'confetti') return
      const C = cols(), n = Math.round(70 * (f.power || 1)), W = innerWidth
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1
        ps.push({ x: side > 0 ? -10 : W + 10, y: innerHeight * (0.55 + Math.random() * 0.3), vx: side * (5 + Math.random() * 11), vy: -(10 + Math.random() * 12), r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, s: 6 + Math.random() * 9, col: C[i % C.length], k: i % 4, life: 1 })
      }
      if (!raf) raf = requestAnimationFrame(loop)
    })
    const loop = () => {
      g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); g.clearRect(0, 0, innerWidth, innerHeight)
      ps = ps.filter(p => p.y < innerHeight + 40 && p.life > 0)
      for (const p of ps) {
        p.vy += 0.38; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; if (p.vy > 0) p.life -= 0.004
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.col; g.globalAlpha = Math.min(1, p.life * 2)
        g.beginPath()
        if (p.k === 0) g.arc(0, 0, p.s / 2, 0, 7)
        else if (p.k === 1) g.roundRect(-p.s / 2, -p.s / 4, p.s, p.s / 2, p.s / 4)
        else if (p.k === 2) { for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, rr = i % 2 ? p.s / 4 : p.s / 2; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) } }
        else g.roundRect(-p.s / 2, -p.s / 2, p.s, p.s, p.s / 3)
        g.fill(); g.restore()
      }
      raf = ps.length ? requestAnimationFrame(loop) : 0
      if (!raf) g.clearRect(0, 0, innerWidth, innerHeight)
    }
    return () => { off(); removeEventListener('resize', resize); cancelAnimationFrame(raf) }
  }, [])
  return <canvas ref={cv} className="confetti" />
}

/* ───────── floating reward pops ───────── */
type Pop = { id: number; xp: number; label?: string; combo?: number; work?: number; ontime?: boolean; x: number; y: number }
function Pops() {
  const [pops, setPops] = useState<Pop[]>([])
  useEffect(() => onFx(f => {
    if (f.type !== 'reward') return
    const id = Math.random()
    const p: Pop = { id, ...f, x: f.x ?? innerWidth / 2, y: f.y ?? innerHeight / 2 }
    setPops(ps => [...ps, p]); setTimeout(() => setPops(ps => ps.filter(x => x.id !== id)), 2200)
    sfx.check(f.combo); buzz(f.label ? [20, 30, 20] : 25)
  }), [])
  return (
    <div className="pops">
      <AnimatePresence>
        {pops.map(p => (
          <motion.div key={p.id} className="pop" style={{ left: Math.min(innerWidth - 120, Math.max(120, p.x)), top: p.y }}
            initial={{ opacity: 0, y: 0, scale: 0.4 }} animate={{ opacity: 1, y: -90, scale: 1 }} exit={{ opacity: 0, y: -150, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 18 }}>
            {p.label ? <div className="pop-label">{p.label}</div> : null}
            <div className="pop-xp">{p.work ? `+${p.work} min work` : p.xp ? `+${p.xp} XP` : 'Break logged'}</div>
            <div className="pop-sub">
              {p.work ? <span><Icon n="star" fill /> +{p.xp} XP</span> : null}
              {!p.xp && <span>0 XP — breaks don't count</span>}
              {p.combo && p.combo > 1 ? <span><Icon n="bolt" fill /> ×{p.combo}</span> : null}
              {p.ontime ? <span><Icon n="schedule" fill /> on time</span> : null}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* ───────── snackbars (store toasts + ui.ts toastUndo, which carries an action button) ───────── */
type Snack = { id: number; text: string; icon?: string; ach?: boolean; action?: string; run?: () => void }
function Snacks() {
  const [q, setQ] = useState<Snack[]>([])
  const push = (item: Snack, ms: number) => { setQ(x => [...x.slice(-2), item]); setTimeout(() => setQ(x => x.filter(i => i.id !== item.id)), ms) }
  useEffect(() => onFx(f => {
    if (f.type !== 'toast' && f.type !== 'achievement') return
    const id = Math.random()
    const item = f.type === 'toast' ? { id, text: f.text, icon: f.icon } : { id, text: `Achievement unlocked — ${f.title}`, icon: f.icon, ach: true }
    if (f.type === 'achievement') { sfx.level(); buzz([40, 60, 40]) }
    push(item, f.type === 'achievement' ? 4200 : 3000)
  }), [])
  useEffect(() => onUndoSnack(s => push({ id: s.id, text: s.text, icon: s.icon, action: s.action, run: s.run }, s.ms)), [])
  const act = (s: Snack) => { setQ(x => x.filter(i => i.id !== s.id)); sfx.tap(); s.run?.() }
  return (
    <div className="snacks" role="status" aria-live="polite">
      <AnimatePresence>
        {q.map(s => (
          <motion.div layout key={s.id} className={'snack' + (s.ach ? ' ach' : '') + (s.action ? ' has-act' : '')} initial={{ y: 40, opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}>
            {s.icon && <Icon n={s.icon} fill />}<span>{s.text}{s.ach ? ' · +50 XP' : ''}</span>
            {s.action && <button type="button" className="snack-act" onClick={() => act(s)}>{s.action}</button>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* ───────── level up dialog ───────── */
function Celebrate() {
  const [ev, setEv] = useState<Fx | null>(null)
  useEffect(() => onFx(f => {
    if (f.type === 'levelup') { setEv(f); sfx.level(); buzz([60, 40, 60, 40, 120]) }
  }), [])
  const close = () => setEv(null)
  useEscape(close, !!ev, 2)
  return (
    <AnimatePresence>
      {ev && ev.type === 'levelup' && (
        <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.div className="celebrate" role="dialog" aria-modal="true" aria-label={ev.type === 'levelup' ? `Level ${ev.lvl}` : 'Level up'} onClick={e => e.stopPropagation()} initial={{ scale: 0.5, y: 60 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
              <div className="cel-shape">
                <Shape shape="burst" size={100} spin={40} style={{ color: 'var(--primary)' }} />
                <span className="cel-num">{ev.lvl}</span>
              </div>
              <div className="overline">Level up</div>
              <h2 className="display">You are now<br />{ev.title}</h2>
              <p className="muted">Every level makes the next one harder. Keep the pace.</p>
            <button className="btn filled lg" onClick={close}>Back to work</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function FxLayer() { return <><Confetti /><Pops /><Snacks /><Celebrate /></> }
