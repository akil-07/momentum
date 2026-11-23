import { motion } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { spring } from './common'

/* ═════════ one segmented control (Progress views, Plan views, routine weekday): pill slides to the picked segment ═════════ */
export function Seg<T extends string | number>({ value, options, onChange, className = '', label }: {
  value: T; options: { v: T; label: ReactNode; sub?: ReactNode; aria?: string }[]; onChange: (v: T) => void; className?: string; label?: string
}) {
  const id = useId()
  return (
    <div className={'seg ' + className} role="tablist" aria-label={label}>
      {options.map(o => {
        const on = o.v === value
        return <button key={String(o.v)} type="button" role="tab" aria-selected={on} aria-label={o.aria} className={'seg-b' + (on ? ' on' : '')} onClick={() => onChange(o.v)}>
          {on && <motion.span layoutId={'seg' + id} className="seg-pill" transition={spring} />}
          <span>{o.label}</span>{o.sub !== undefined && <small>{o.sub}</small>}
        </button>
      })}
    </div>
  )
}
