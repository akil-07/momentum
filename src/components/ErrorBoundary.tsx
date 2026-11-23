import { Component, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react'
import * as store from '../store'

/* ═════════ last-resort safety nets: a render crash never strands the data, a full disk never loses it silently ═════════ */

/** download the full planner state as a JSON backup (same file as Settings → Export) */
export function downloadBackup() {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([store.exportData()], { type: 'application/json' }))
  a.download = `momentum-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

/** catches render errors anywhere below it and shows a calm card instead of a blank page; the data is untouched */
export class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null; exportErr?: string }> {
  state: { err: Error | null; exportErr?: string } = { err: null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error, info: ErrorInfo) { console.error(err, info.componentStack) }
  render() {
    const { err, exportErr } = this.state
    if (!err) return this.props.children
    // plain markup only (no motion / sound / store hooks): whatever crashed must not crash this too
    return (
      <div className="crash">
        <section className="card crash-card" role="alert">
          <span className="msr crash-ic" aria-hidden>sentiment_dissatisfied</span>
          <h2>Something went wrong</h2>
          <p className="muted">Momentum hit an unexpected error while drawing this screen. Your data is safe on this device — reload to carry on, or export a backup first if you want to be sure.</p>
          <div className="crash-btns">
            <button type="button" className="btn filled" onClick={() => location.reload()}><span className="msr fill" aria-hidden>refresh</span>Reload</button>
            <button type="button" className="btn tonal" onClick={() => { try { downloadBackup() } catch (e) { this.setState({ exportErr: String(e) }) } }}><span className="msr" aria-hidden>download</span>Export backup</button>
          </div>
          {exportErr && <p className="small crash-err">Export failed: {exportErr}</p>}
          <details className="crash-details"><summary>Error details</summary><pre>{err.message}{err.stack ? '\n\n' + err.stack : ''}</pre></details>
        </section>
      </div>
    )
  }
}

/* storage-full signal from store.ts (getStorageError / onStorageError, owned by the store). Read through the namespace so
   a rename there degrades to "no banner" instead of a crash; only a full quota shows this banner (a corrupt copy has its own toast) */
type Sig = { getStorageError?: () => { kind?: string } | null; onStorageError?: (cb: () => void) => (() => void) | void }
const S = store as unknown as Sig
const storageErr = () => { const e = typeof S.getStorageError === 'function' ? S.getStorageError() : null; return !!e && (e.kind === undefined || e.kind === 'quota') }
function subscribe(cb: () => void) {
  const offs = [store.onAnyChange(cb), typeof S.onStorageError === 'function' ? S.onStorageError(cb) : undefined]
  return () => offs.forEach(f => typeof f === 'function' && f())
}

/** "storage is full" banner: changes stay in memory (and sync), so offer an export until saving works again */
export function StorageBanner() {
  const bad = useSyncExternalStore(subscribe, storageErr)
  const [hid, setHid] = useState(false)
  if (!bad && hid) setHid(false) // saving recovered: a later failure shows the banner again
  if (!bad || hid) return null
  return (
    <div className="storage-banner" role="alert">
      <span className="msr fill" aria-hidden>sd_card_alert</span>
      <p>Couldn't save on this device — storage is full. Your changes are kept in memory; export a backup or free space.</p>
      <button type="button" className="btn tonal sm" onClick={() => { try { downloadBackup() } catch { store.toast('Export failed', 'error') } }}><span className="msr" aria-hidden>download</span>Export</button>
      <button type="button" className="ibtn storage-x" title="Hide" aria-label="Hide" onClick={() => setHid(true)}><span className="msr" aria-hidden>close</span></button>
    </div>
  )
}
