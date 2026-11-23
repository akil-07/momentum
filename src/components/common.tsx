import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Icon } from './fx'
import { sfx } from '../sound'
import { setConfirmHost, type ConfirmOpts } from '../ui'

export function useNow(ms = 15000) {
  const [n, setN] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setN(new Date()), ms); return () => clearInterval(t) }, [ms])
  return n
}

export const spring = { type: 'spring', stiffness: 500, damping: 30 } as const
export const bouncy = { type: 'spring', stiffness: 400, damping: 15 } as const

export function Btn({ kind = 'filled', icon, children, onClick, className = '', disabled, size, title, type }: {
  kind?: 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated' | 'tertiary' | 'error'; icon?: string; children?: ReactNode
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; className?: string; disabled?: boolean; size?: 'sm' | 'lg' | 'xl'; title?: string; type?: 'submit' | 'button'
}) {
  return (
    <motion.button type={type || 'button'} title={title} disabled={disabled} whileTap={{ scale: 0.94, borderRadius: '12px' }} transition={spring}
      className={`btn ${kind} ${size || ''} ${children ? '' : 'icon-only'} ${className}`} onClick={e => { sfx.tap(); onClick?.(e) }}>
      {icon && <Icon n={icon} fill={kind === 'filled'} />}{children}
    </motion.button>
  )
}

export function IconBtn({ icon, onClick, kind = 'standard', title, fill, className = '', disabled }: { icon: string; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; kind?: 'standard' | 'tonal' | 'filled' | 'outlined'; title?: string; fill?: boolean; className?: string; disabled?: boolean }) {
  return (
    <motion.button type="button" aria-label={title} title={title} disabled={disabled} whileTap={{ scale: 0.85, borderRadius: '10px' }} transition={spring}
      className={`ibtn ${kind} ${className}`} onClick={e => { sfx.tap(); onClick?.(e) }}><Icon n={icon} fill={fill} /></motion.button>
  )
}

/* ───────── one Escape stack: Escape closes only the top-most layer (a sheet before a full-screen timer) ─────────
   Registered at module load, so it runs before any component's own window keydown listener; when a layer takes the
   key it stops it there. With no layer open the key passes through untouched. */
type EscLayer = { id: number; prio: number; fn: () => void }
const escLayers: EscLayer[] = []
let escSeq = 0
if (typeof window !== 'undefined') window.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented || !escLayers.length) return
  const top = escLayers.reduce((a, b) => b.prio > a.prio || (b.prio === a.prio && b.id > a.id) ? b : a)
  e.preventDefault(); e.stopImmediatePropagation(); top.fn()
})
/** register an Escape layer while `active`. The newest layer wins; a higher `prio` wins over newer lower ones
 *  (sheets/dialogs use 1, full-screen timers the default 0, so Escape closes a sheet before it minimises a timer). */
export function useEscape(handler: () => void, active = true, prio = 0) {
  const ref = useRef(handler)
  useEffect(() => { ref.current = handler })
  useEffect(() => {
    if (!active) return
    const l: EscLayer = { id: ++escSeq, prio, fn: () => ref.current() }
    escLayers.push(l)
    return () => { const i = escLayers.indexOf(l); if (i >= 0) escLayers.splice(i, 1) }
  }, [active, prio])
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

export function Sheet({ open, onClose, title, children, actions, className = '' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  useEscape(onClose, open, 1)
  const tid = useId()
  // focus: remember what had it, give it back on close
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    return () => { if (prev && document.contains(prev)) prev.focus?.({ preventScroll: true }) }
  }, [open])
  const panel = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    requestAnimationFrame(() => {
      if (el.contains(document.activeElement)) return // an autoFocus field already has it
      // laptop: straight into the first field; phone: the dialog itself (no keyboard popping up uninvited)
      const f = coarse() ? null : el.querySelector<HTMLElement>('.sheet-body input:not([type="checkbox"]):not([type="radio"]):not([disabled]), .sheet-body textarea:not([disabled]), .sheet-body select:not([disabled])')
      ;(f || el).focus({ preventScroll: true })
    })
  }, [])
  const trap = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const els = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null || x === document.activeElement)
    if (!els.length) { e.preventDefault(); return }
    const first = els[0], last = els[els.length - 1], a = document.activeElement
    if (e.shiftKey && (a === first || a === e.currentTarget)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus() }
  }
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="scrim sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div ref={panel} className={'sheet ' + className} role="dialog" aria-modal="true" aria-labelledby={tid} tabIndex={-1} onKeyDown={trap} onClick={e => e.stopPropagation()}
            initial={{ y: '100%', opacity: 0.5 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
            <div className="sheet-handle" aria-hidden />
            <div className="sheet-head"><h2 className="headline" id={tid}>{title}</h2><IconBtn icon="close" onClick={onClose} title="Close" /></div>
            <div className="sheet-body">{children}</div>
            {actions && <div className="sheet-actions">{actions}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** the Material host behind ui.ts confirmAsk / promptAsk — mounted once in App */
export function ConfirmHost() {
  const [req, setReq] = useState<{ o: ConfirmOpts; res: (v: boolean | string) => void } | null>(null)
  const [val, setVal] = useState('')
  const cur = useRef(req)
  const last = useRef<ConfirmOpts>({ title: '' })
  useEffect(() => {
    setConfirmHost(o => new Promise(res => { const r = { o, res }; cur.current?.res(false); cur.current = r; last.current = o; setVal(o.input?.value ?? ''); setReq(r) }))
    return () => { setConfirmHost(null); cur.current?.res(false); cur.current = null }
  }, [])
  const done = (v: boolean | string) => { cur.current?.res(v); cur.current = null; setReq(null) }
  const o = req?.o || last.current, inp = o.input
  const ok = () => done(inp ? val : true)
  return (
    <Sheet open={!!req} onClose={() => done(false)} title={o.title} className={'confirm-sheet' + (o.danger ? ' danger' : '')}
      actions={<><span className="grow" /><Btn kind="text" onClick={() => done(false)}>{o.cancel || 'Cancel'}</Btn>
        <Btn kind={o.danger ? 'error' : 'filled'} icon={o.danger ? 'delete' : undefined} onClick={ok}>{o.ok || (o.danger ? 'Delete' : 'OK')}</Btn></>}>
      {o.danger && <div className="confirm-ic" aria-hidden><Icon n="warning" fill /></div>}
      {o.body && <p className="confirm-body">{o.body}</p>}
      {inp && <form onSubmit={e => { e.preventDefault(); ok() }}><Field label={inp.label}><input autoFocus value={val} onChange={e => setVal(e.target.value)} /></Field></form>}
    </Sheet>
  )
}

export function Chips<T extends string | number>({ value, options, onChange, multi }: {
  value: T | T[]; options: { v: T; label: string; icon?: string }[]; onChange: (v: T) => void; multi?: boolean
}) {
  const sel = (v: T) => multi ? (value as T[]).includes(v) : value === v
  return (
    <div className="chips">
      {options.map(o => (
        <motion.button type="button" key={String(o.v)} className={'chip' + (sel(o.v) ? ' on' : '')} whileTap={{ scale: 0.92 }} transition={spring}
          onClick={() => { sfx.tap(); onChange(o.v) }}>
          {sel(o.v) ? <Icon n="check" /> : o.icon ? <Icon n={o.icon} /> : null}{o.label}
        </motion.button>
      ))}
    </div>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} className={'switch' + (on ? ' on' : '')} onClick={() => { sfx.tap(); onChange(!on) }}>
        <motion.span className="thumb" layout transition={bouncy}>{on && <Icon n="check" />}</motion.span>
      </button>
    </label>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>
}

/** copy text with a fallback for contexts without the async clipboard API (plain http, older WebViews) */
export async function copyText(text: string) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true } } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok
  } catch { return false }
}

/** a chat-style scroll box that keeps the newest message in view: jumps to the bottom when it appears, on every new
 *  message and as an answer fills in — unless you scrolled up to read, in which case only a NEW message brings you back */
export function useAutoScroll<T extends HTMLElement>() {
  const off = useRef<(() => void) | null>(null)
  return useCallback((el: T | null) => {
    off.current?.(); off.current = null
    if (!el) return
    let stick = true
    const toEnd = () => { el.scrollTop = el.scrollHeight }
    const onScroll = () => { stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
    const mo = new MutationObserver(ms => { if (stick || ms.some(m => m.addedNodes.length)) { stick = true; toEnd() } })
    const ro = new ResizeObserver(() => { if (stick) toEnd() })
    el.addEventListener('scroll', onScroll, { passive: true })
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    ro.observe(el)
    toEnd(); requestAnimationFrame(toEnd); setTimeout(toEnd, 250) // after fonts / motion settle
    off.current = () => { el.removeEventListener('scroll', onScroll); mo.disconnect(); ro.disconnect() }
  }, [])
}
