import { useEffect, useRef } from 'react'
import { Sheet } from './common'

/* ═════════ laptop keyboard shortcuts: 1-6 tabs · n add task · space start/pause · m minimise · / coach chat · ? this list ═════════ */
export interface ShortcutActions { tab: (i: number) => void; add: () => void; space: () => void; minimise: () => void; chat: () => void; help: () => void }

export const SHORTCUTS: [string[], string][] = [
  [['1', '–', '6'], 'Switch tab (Today, Train, Coach, Plan, Progress, Archive)'],
  [['N'], 'Add a task'],
  [['Space'], 'Start the current block / pause or resume the running timer'],
  [['M'], 'Minimise the running timer'],
  [['Esc'], 'Close the top sheet, or minimise the timer'],
  [['/'], 'Ask the coach (opens Coach and focuses the chat)'],
  [['?'], 'Show these shortcuts'],
]

const typing = (el: EventTarget | null) => {
  const e = el as HTMLElement | null
  if (!e || !e.tagName) return false
  return e.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)
}

/** listens on window; ignores keys while typing, with Ctrl/Alt/Meta held, and while a dialog is open */
export function Shortcuts({ open, onClose, actions }: { open: boolean; onClose: () => void; actions: ShortcutActions }) {
  const act = useRef(actions)
  useEffect(() => { act.current = actions })
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      if (typing(e.target) || typing(document.activeElement)) return
      if (document.querySelector('.sheet[aria-modal="true"], .celebrate')) return // a sheet / dialog owns the keyboard (a full-screen timer doesn't)
      const a = act.current, key = e.key
      // an idea review owns Space and 1-4 (reveal / grade) while focus is on the page or inside its card
      const t = (e.target as HTMLElement | null), inIdeas = !t || t === document.body || document.activeElement === document.body || !!t.closest?.('.card.ideas')
      if ((key === ' ' || key === 'Spacebar' || (key >= '1' && key <= '4')) && inIdeas && document.querySelector('.card.ideas .idea-review, .card.ideas .idea-done')) return
      // an Archive flashcard review owns Space and 1-4 too (unless a full-screen timer is open over it)
      if ((key === ' ' || key === 'Spacebar' || (key >= '1' && key <= '4')) && document.querySelector('.arc-deck.reviewing') && !document.querySelector('.focus')) return
      if (key === '?') { e.preventDefault(); a.help(); return }
      if (e.shiftKey) return
      if (key >= '1' && key <= '6') { e.preventDefault(); a.tab(+key - 1); return }
      if (key === ' ' || key === 'Spacebar') {
        // a keyboard-focused button keeps its own Space (activate); a mouse-clicked one doesn't steal it
        const f = document.activeElement as HTMLElement | null
        if (f && f !== document.body && f.matches('button, a, [role="button"], [role="switch"], [role="tab"], summary') && f.matches(':focus-visible')) return
        e.preventDefault(); if (!e.repeat) a.space(); return
      }
      if (e.repeat) return
      const l = key.toLowerCase()
      if (l === 'n') { e.preventDefault(); a.add() }
      else if (l === 'm') { e.preventDefault(); a.minimise() }
      else if (key === '/') { e.preventDefault(); a.chat() }
    }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])
  return (
    <Sheet open={open} onClose={onClose} title="Keyboard shortcuts" className="keys-sheet">
      <dl className="keys">
        {SHORTCUTS.map(([ks, what]) => (
          <div key={what} className="keys-row">
            <dt>{ks.map((x, i) => x === '–' ? <span key={i} className="keys-to">to</span> : <kbd key={i}>{x}</kbd>)}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small keys-note">Shortcuts pause while you type in a field or a sheet is open.</p>
    </Sheet>
  )
}
