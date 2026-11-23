/* ═════════ shared UI helpers: one way to format time and dates, one way to confirm ═════════ */
import { fmtDur, keyToDate } from './store'
export { fmtDur }
export { fmtClock } from './components/cpui'

/** hours with one decimal for chart axes / KPIs: 6.5 h */
export const fmtHours = (min: number) => `${Math.round(min / 6) / 10} h`
/** friendly date from a 'YYYY-MM-DD' key: "Mon 23 Nov" (or "Today" / "Tomorrow" / "Yesterday" when asked) */
export function fmtDay(k: string, rel = false) {
  if (rel) {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0)
    const diff = Math.round((keyToDate(k).getTime() - d0.getTime()) / 864e5)
    if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff === -1) return 'Yesterday'
  }
  return keyToDate(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
export const ANY_TIME = 'any time'

/** ask before something destructive. Resolves true on confirm. A Material sheet replaces this browser dialog
 *  (common.tsx registers it via setConfirmHost); until then it falls back to window.confirm. */
export interface ConfirmOpts { title: string; body?: string; ok?: string; cancel?: string; danger?: boolean; input?: { label: string; value?: string } }
type Host = (o: ConfirmOpts) => Promise<boolean | string>
let host: Host | null = null
export const setConfirmHost = (h: Host | null) => { host = h }
export function confirmAsk(o: ConfirmOpts): Promise<boolean> {
  if (host) return host(o).then(v => v !== false)
  return Promise.resolve(window.confirm(o.body ? `${o.title}\n\n${o.body}` : o.title))
}
/** a one-field prompt (rename, label…): resolves the text, or null when cancelled */
export function promptAsk(o: ConfirmOpts & { input: { label: string; value?: string } }): Promise<string | null> {
  if (host) return host(o).then(v => typeof v === 'string' ? v : null)
  return Promise.resolve(window.prompt(o.title, o.input.value ?? ''))
}

/* ═════════ snackbar with an action: "Deleted · Undo" ═════════ */
export interface UndoSnack { id: number; text: string; icon?: string; action: string; ms: number; run: () => void }
const snackSubs = new Set<(s: UndoSnack) => void>()
/** fx.tsx's snackbar host listens here (store.ts's toast() has no action slot) */
export const onUndoSnack = (f: (s: UndoSnack) => void) => { snackSubs.add(f); return () => { snackSubs.delete(f) } }
/** a toast with an Undo button (6 s): call after a delete with a closure that puts the thing back.
 *  `opts.action` renames the button, `opts.ms` changes how long it stays. */
export function toastUndo(text: string, onUndo: () => void, opts: { icon?: string; action?: string; ms?: number } = {}) {
  const s: UndoSnack = { id: Math.random(), text, icon: opts.icon ?? 'delete', action: opts.action ?? 'Undo', ms: opts.ms ?? 6000, run: onUndo }
  snackSubs.forEach(f => f(s))
}

/* ═════════ app-wide window events (names shared between components) ═════════ */
/** switch tab (and Progress view) from anywhere: dispatchEvent(new CustomEvent(GO_EVENT, { detail: { tab: 'progress', view: 'timeline' } })) */
export const GO_EVENT = 'momentum:go'
/** space bar: pause / resume the running timer (Focus, Pomodoro and Session listen) */
export const TIMER_TOGGLE_EVENT = 'momentum:timer-toggle'
/** "/" : the Coach tab focuses its chat box (CoachPanel listens) */
export const FOCUS_CHAT_EVENT = 'momentum:focus-chat'
export const goTo = (tab: string, view?: string) => window.dispatchEvent(new CustomEvent(GO_EVENT, { detail: { tab, view } }))
