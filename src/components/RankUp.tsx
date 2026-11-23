import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { TIERS, tierOf, useCf } from '../cf'
import { tierSeed } from '../theme'
import { sfx } from '../sound'
import { Icon } from './fx'
import '../styles/themes.css'

const KEY = 'momentum.cfTier'
const BLURB: Record<string, string> = {
  Pupil: 'The grind is working. Specialist is next.',
  Specialist: 'Cyan. Most people never get here. Keep going.',
  Expert: 'Blue. You are in the top tier of active coders.',
  'Candidate Master': 'Violet. Div 1 is calling.',
}
const idx = (name: string) => TIERS.findIndex(t => t[1] === name)
const read = (): { h: string; i: number } | null => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null } }
const write = (v: { h: string; i: number }) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private mode */ } }

/** Full-screen celebration the first time the user's Codeforces rank goes up (tracked per handle in localStorage). */
export function RankUp() {
  const { user } = useCf()
  const [shown, setShown] = useState<{ name: string; rating: number } | null>(null)
  useEffect(() => {
    if (!user?.handle) return
    const t = tierOf(user.rating || 0), i = idx(t.name), prev = read()
    if (prev && prev.h === user.handle && i > prev.i) { setShown({ name: t.name, rating: user.rating }); sfx.level() }
    if (!prev || prev.h !== user.handle || i > prev.i) write({ h: user.handle, i }) // keep the highest tier reached: a drop and climb back doesn't re-fire
  }, [user?.handle, user?.rating])
  const col = shown ? tierSeed(shown.rating) : '#808080'
  const bits = useMemo(() => Array.from({ length: 36 }, (_, k) => ({ a: (k / 36) * Math.PI * 2 + Math.random() * 0.3, d: 140 + Math.random() * 260, s: 6 + Math.random() * 10, r: Math.random() * 720 - 360, k: k % 3 })), [shown])
  return (
    <AnimatePresence>
      {shown && (
        <motion.div className="rankup" role="dialog" aria-label={`Rank up: ${shown.name}`} style={{ ['--tier' as string]: col }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="rankup-wash" initial={{ clipPath: 'circle(0% at 50% 50%)' }} animate={{ clipPath: 'circle(150% at 50% 50%)' }} transition={{ duration: 1.1, ease: [0.2, 0, 0, 1] }} />
          <div className="rankup-burst" aria-hidden>
            {bits.map((b, k) => <motion.i key={k} className={'rb k' + b.k} style={{ width: b.s, height: b.s }}
              initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }} animate={{ x: Math.cos(b.a) * b.d, y: Math.sin(b.a) * b.d, opacity: [0, 1, 1, 0], rotate: b.r }}
              transition={{ delay: 0.5, duration: 1.6, ease: 'easeOut' }} />)}
          </div>
          <motion.div className="rankup-card" initial={{ scale: 0.6, y: 40, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 240, damping: 16, delay: 0.45 }}>
            <div className="rankup-badge"><Icon n="military_tech" fill /></div>
            <div className="rankup-over">Rank up · {shown.rating}</div>
            <h2 className="rankup-title">You're {/^[AEIOU]/.test(shown.name) ? 'an' : 'a'} {shown.name} now</h2>
            <p className="rankup-sub">{BLURB[shown.name] || 'New colour, same hunger. On to the next one.'}</p>
            <button className="btn rankup-btn" onClick={() => setShown(null)}>Keep climbing</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
