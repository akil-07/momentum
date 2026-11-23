import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

/* M3 Expressive shape library — every shape is a polar radius function sampled at N points,
   so any shape can morph smoothly into any other by lerping radii. */
const N = 180
type ShapeFn = (t: number) => number
const smooth = (lobes: number, amp: number): ShapeFn => t => 1 - amp + amp * Math.cos(lobes * t)
const sq = (n: number, k = 4): ShapeFn => t => { const c = Math.abs(Math.cos(t * n / 4)), s = Math.abs(Math.sin(t * n / 4)); return 1 / Math.pow(Math.pow(c, k) + Math.pow(s, k), 1 / k) * 0.82 }

export const SHAPES = {
  circle: () => 1,
  cookie4: smooth(4, 0.07),
  cookie6: smooth(6, 0.06),
  cookie7: smooth(7, 0.07),
  cookie9: smooth(9, 0.05),
  cookie12: smooth(12, 0.04),
  clover4: smooth(4, 0.2),
  clover8: smooth(8, 0.12),
  flower: smooth(8, 0.16),
  sunny: smooth(10, 0.09),
  burst: smooth(14, 0.08),
  puffy: smooth(5, 0.13),
  pentagon: smooth(5, 0.07),
  gem: smooth(3, 0.12),
  square: sq(4, 5),
  pill: (t: number) => { const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t)); return 0.9 / Math.pow(Math.pow(c * 0.8, 6) + Math.pow(s * 1.25, 6), 1 / 6) * 0.75 },
} satisfies Record<string, ShapeFn>
export type ShapeName = keyof typeof SHAPES

const radii = (name: ShapeName) => { const f = SHAPES[name]; const r = Array.from({ length: N }, (_, i) => f((i / N) * Math.PI * 2)); const m = Math.max(...r); return r.map(v => v / m) }
const cache = new Map<ShapeName, number[]>()
const getR = (n: ShapeName) => { let r = cache.get(n); if (!r) { r = radii(n); cache.set(n, r) } return r }

export function shapePath(r: number[], size: number, rot = 0) {
  const c = size / 2, R = size / 2
  let d = ''
  const pts = r.map((v, i) => { const a = (i / N) * Math.PI * 2 + rot - Math.PI / 2; return [c + Math.cos(a) * v * R, c + Math.sin(a) * v * R] })
  // Catmull-Rom → cubic bezier for buttery curves
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N]
    if (i === 0) d += `M${p1[0].toFixed(2)},${p1[1].toFixed(2)}`
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`
  }
  return d + 'Z'
}
export const staticPath = (name: ShapeName, size = 100, rot = 0) => shapePath(getR(name), size, rot)

const springStep = (x: number, v: number, target: number, k = 170, c = 14, dt = 1 / 60) => { const a = -k * (x - target) - c * v; v += a * dt; x += v * dt; return [x, v] }

/* ───────── one animation loop for every shape: runs only while on screen, the tab is visible and motion is allowed.
   A frame returns 'busy' (a spring is moving: every frame), 'idle' (only a slow spin / wave ripple: ~30 fps) or 'done'
   (nothing left to draw: the loop stops until its inputs change). Under reduced motion a frame is told so and should snap. */
type Mode = 'busy' | 'idle' | 'done'
const IDLE_MS = 1000 / 30
const reduceMQ = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null
function useLoop(el: RefObject<Element | null>, frame: (dt: number, reduced: boolean) => Mode, deps: unknown[]) {
  const fr = useRef(frame); fr.current = frame
  useEffect(() => {
    let raf = 0, last = 0, mode: Mode = 'busy', vis = true
    const ok = () => vis && !document.hidden
    const tick = (now: number) => {
      raf = 0; if (!ok()) return
      if (mode === 'idle' && now - last < IDLE_MS) { raf = requestAnimationFrame(tick); return }
      const dt = Math.min(0.05, Math.max(0, now - last) / 1000); last = now
      mode = fr.current(dt, !!reduceMQ?.matches)
      if (mode !== 'done') raf = requestAnimationFrame(tick)
    }
    const start = () => { if (!raf && ok()) { last = performance.now() - 1000 / 60; mode = 'busy'; raf = requestAnimationFrame(tick) } }
    const stop = () => { cancelAnimationFrame(raf); raf = 0 }
    const io = typeof IntersectionObserver !== 'undefined' && el.current ? new IntersectionObserver(es => { vis = es[es.length - 1].isIntersecting; if (vis) start(); else stop() }, { rootMargin: '64px' }) : null
    if (io && el.current) io.observe(el.current)
    const onVis = () => document.hidden ? stop() : start()
    document.addEventListener('visibilitychange', onVis); reduceMQ?.addEventListener?.('change', start)
    start()
    return () => { stop(); io?.disconnect(); document.removeEventListener('visibilitychange', onVis); reduceMQ?.removeEventListener?.('change', start) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** A morphing M3 Expressive shape. Change `shape` and it springs into the new form. */
export function Shape({ shape, size = 100, spin = 0, rotate = 0, className, style, fill = 'currentColor', children }: {
  shape: ShapeName; size?: number; spin?: number; rotate?: number; className?: string; style?: CSSProperties; fill?: string; children?: React.ReactNode
}) {
  const ref = useRef<SVGPathElement>(null), svg = useRef<SVGSVGElement>(null)
  const st = useRef({ from: getR(shape), to: getR(shape), x: 1, v: 0, rot: rotate, rv: 0, spinA: 0 })
  const [init] = useState(() => staticPath(shape, size, rotate * Math.PI / 180))
  useEffect(() => {
    const s = st.current
    const cur = s.from.map((r, i) => r + (s.to[i] - r) * s.x)
    s.from = cur; s.to = getR(shape); s.x = 0
  }, [shape])
  useLoop(svg, (dt, reduced) => {
    const s = st.current
    let moving = false
    if (reduced) { s.x = 1; s.v = 0; s.rot = rotate; s.rv = 0 }
    else {
      if (Math.abs(s.x - 1) > 0.0005 || Math.abs(s.v) > 0.0005) { [s.x, s.v] = springStep(s.x, s.v, 1, 220, 16, dt); moving = true }
      if (Math.abs(s.rot - rotate) > 0.05 || Math.abs(s.rv) > 0.05) { [s.rot, s.rv] = springStep(s.rot, s.rv, rotate, 120, 12, dt); moving = true }
      if (spin) s.spinA += spin * dt
    }
    if (ref.current) {
      const r = s.x === 1 ? s.to : s.from.map((v, i) => v + (s.to[i] - v) * s.x)
      ref.current.setAttribute('d', shapePath(r, size, (s.rot + s.spinA) * Math.PI / 180))
    }
    return reduced ? 'done' : moving ? 'busy' : spin ? 'idle' : 'done'
  }, [shape, size, spin, rotate])
  return (
    <svg ref={svg} viewBox={`0 0 ${size} ${size}`} className={className} style={{ overflow: 'visible', ...style }} aria-hidden>
      <path ref={ref} d={init} fill={fill} />
      {children}
    </svg>
  )
}

/** M3 Expressive wavy circular progress. */
export function WavyRing({ value, size = 220, stroke = 12, amp = 4, waves = 14, track = 'var(--secondary-container)', color = 'var(--primary)', speed = 1 }: {
  value: number; size?: number; stroke?: number; amp?: number; waves?: number; track?: string; color?: string; speed?: number
}) {
  const ref = useRef<SVGPathElement>(null), trackRef = useRef<SVGPathElement>(null), svg = useRef<SVGSVGElement>(null)
  const v = useRef({ x: 0, vel: 0, phase: 0 })
  useLoop(svg, (dt, reduced) => {
    const R = size / 2 - stroke - amp, c = size / 2, gap = 0.09
    const s = v.current
    if (reduced) { s.x = value; s.vel = 0 } else { [s.x, s.vel] = springStep(s.x, s.vel, value, 90, 13, dt); s.phase += dt * 2.2 * speed }
    const p = Math.max(0, Math.min(1, s.x))
    const end = p * Math.PI * 2
    let d = ''
    const steps = Math.max(2, Math.round(p * 260))
    const a = p > 0.995 ? 1 : Math.min(1, p * 12) // wave grows in
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * end, r = R + Math.sin(t * waves - s.phase) * amp * a
      const x = c + Math.cos(t - Math.PI / 2) * r, y = c + Math.sin(t - Math.PI / 2) * r
      d += (i ? 'L' : 'M') + x.toFixed(2) + ',' + y.toFixed(2)
    }
    ref.current?.setAttribute('d', p > 0.002 ? d : '')
    // track: flat arc from end+gap back to start-gap
    if (trackRef.current) {
      const t0 = end + (p > 0.002 ? gap : 0) + stroke / R * 0.3, t1 = Math.PI * 2 - gap - stroke / R * 0.3
      if (t1 > t0 && p < 0.985) {
        const P = (t: number) => `${(c + Math.cos(t - Math.PI / 2) * R).toFixed(2)},${(c + Math.sin(t - Math.PI / 2) * R).toFixed(2)}`
        trackRef.current.setAttribute('d', `M${P(t0)} A${R},${R} 0 ${t1 - t0 > Math.PI ? 1 : 0} 1 ${P(t1)}`)
      } else trackRef.current.setAttribute('d', '')
    }
    if (reduced) return 'done'
    return Math.abs(s.x - value) > 0.0005 || Math.abs(s.vel) > 0.0005 ? 'busy' : p > 0.002 && amp ? 'idle' : 'done'
  }, [value, size, stroke, amp, waves, speed])
  return (
    <svg ref={svg} viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ maxWidth: '100%', height: 'auto' }} aria-hidden>
      <path ref={trackRef} fill="none" stroke={track} strokeWidth={stroke} strokeLinecap="round" />
      <path ref={ref} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** M3 Expressive wavy linear progress. */
export function WavyBar({ value, height = 14, color = 'var(--primary)', track = 'var(--secondary-container)', wave = true, className }: {
  value: number; height?: number; color?: string; track?: string; wave?: boolean; className?: string
}) {
  const wrap = useRef<HTMLDivElement>(null), ref = useRef<SVGPathElement>(null), tr = useRef<SVGLineElement>(null), svg = useRef<SVGSVGElement>(null)
  const v = useRef({ x: 0, vel: 0, phase: 0 })
  // width is measured once and on resize, never read per frame (that forced a layout every frame)
  const [W, setW] = useState(200)
  useEffect(() => {
    const el = wrap.current; if (!el) return
    setW(el.clientWidth || 200)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(es => { const w = Math.round(es[es.length - 1].contentRect.width); if (w > 0) setW(w) })
    ro.observe(el); return () => ro.disconnect()
  }, [])
  useLoop(wrap, (dt, reduced) => {
    const s = v.current
    if (reduced) { s.x = value; s.vel = 0 } else { [s.x, s.vel] = springStep(s.x, s.vel, value, 100, 14, dt); s.phase += dt * 6 }
    const H = height, sw = H * 0.32, amp = wave ? H * 0.22 : 0
    svg.current?.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const p = Math.max(0, Math.min(1, s.x)), end = sw / 2 + p * (W - sw)
    let d = ''
    for (let x = sw / 2; x <= end; x += 2) d += (d ? 'L' : 'M') + x.toFixed(1) + ',' + (H / 2 + Math.sin(x / 7 - s.phase) * amp * Math.min(1, p * 8)).toFixed(2)
    ref.current?.setAttribute('d', p > 0.004 ? d : '')
    ref.current?.setAttribute('stroke-width', String(sw))
    if (tr.current) { tr.current.setAttribute('x1', String(Math.min(W - sw / 2, end + (p > 0.004 ? sw * 1.6 : 0)))); tr.current.setAttribute('x2', String(W - sw / 2)); tr.current.setAttribute('y1', String(H / 2)); tr.current.setAttribute('y2', String(H / 2)); tr.current.setAttribute('stroke-width', String(sw)); tr.current.style.opacity = p > 0.99 ? '0' : '1' }
    if (reduced) return 'done'
    return Math.abs(s.x - value) > 0.0005 || Math.abs(s.vel) > 0.0005 ? 'busy' : amp && p > 0.004 ? 'idle' : 'done'
  }, [value, height, wave, W])
  return (
    <div ref={wrap} className={className} style={{ height, width: '100%' }}>
      <svg ref={svg} width="100%" height={height} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }} aria-hidden>
        <line ref={tr} stroke={track} strokeLinecap="round" />
        <path ref={ref} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** M3 Expressive loading indicator: a shape that morphs through a sequence while spinning. */
export function Loader({ size = 48, color = 'var(--primary)' }: { size?: number; color?: string }) {
  const seq: ShapeName[] = ['cookie9', 'pentagon', 'pill', 'sunny', 'cookie4', 'gem']
  const [i, setI] = useState(0)
  useEffect(() => { const t = setInterval(() => setI(i => (i + 1) % seq.length), 650); return () => clearInterval(t) }, [])
  return <Shape shape={seq[i]} size={100} spin={140} style={{ width: size, height: size, color }} />
}
