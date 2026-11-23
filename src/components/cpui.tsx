import type { ReactNode } from 'react'
import { probUrl, tierOf } from '../cf'
import { openProblem } from '../train'

export const TIER_COLOR: Record<string, string> = {
  Newbie: '#9e9e9e', Pupil: '#43a047', Specialist: '#03a89e', Expert: '#3f6fff', 'Candidate Master': '#aa00aa',
  Master: '#ff8c00', 'International Master': '#ff8c00', Grandmaster: '#ff3333', 'International GM': '#ff3333', 'Legendary GM': '#ff0000',
}
export const rc = (r: number) => TIER_COLOR[tierOf(r).name]
export const LETTERS = 'ABCDEF'
export const fmtClock = (s: number) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
export function Rating({ r }: { r?: number }) { return r ? <span className="rating" style={{ color: rc(r), borderColor: rc(r) }}>{r}</span> : null }

/** every problem link records when you opened it (never blocks the navigation) */
export function ProbLink({ pid, className = 'prob-main', children }: { pid: string; className?: string; children: ReactNode }) {
  return <a className={className} href={probUrl(pid)} target="_blank" rel="noreferrer" onClick={() => openProblem(pid)} onAuxClick={() => openProblem(pid)}>{children}</a>
}
