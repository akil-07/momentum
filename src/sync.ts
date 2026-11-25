import { useSyncExternalStore } from 'react'
import { getState, mergeStates, onLocalChange, reconcileToday, replaceFromSync, toast, type State } from './store'

/* Offline-first sync. Every device keeps the full state locally and works with no network at all.
   Whenever the server is reachable: poll the revision (304 = unchanged) → merge (per-record, nothing is lost) → push only
   when the merged doc differs from the server's, with a revision check. */

export interface SyncCfg { url: string; token: string }
type Status = { state: 'off' | 'idle' | 'syncing' | 'ok' | 'error'; at?: number; msg?: string }

const CFG_KEY = 'momentum.sync'

function initCfg(): SyncCfg | null {
  try {
    if (typeof window !== 'undefined' && window.location) {
      const params = new URLSearchParams(window.location.search)
      const token = params.get('sync_token') || params.get('sync_key') || params.get('key')
      const url = params.get('sync_url') || (token ? window.location.origin : null)
      if (url && token) {
        const c = { url: url.replace(/\/+$/, ''), token: token.trim() }
        localStorage.setItem(CFG_KEY, JSON.stringify(c))
        try {
          const clean = window.location.pathname + window.location.hash
          window.history.replaceState({}, '', clean)
        } catch { /* ignore */ }
        return c
      }
    }
    if (typeof window !== 'undefined') {
      const injected = (window as unknown as { __MOMENTUM_SYNC__?: SyncCfg }).__MOMENTUM_SYNC__
      if (injected?.url && injected?.token) {
        const existing = localStorage.getItem(CFG_KEY)
        if (!existing) {
          localStorage.setItem(CFG_KEY, JSON.stringify(injected))
          return injected
        }
      }
    }
    return JSON.parse(localStorage.getItem(CFG_KEY) || 'null')
  } catch {
    return null
  }
}

let cfg: SyncCfg | null = initCfg()
let status: Status = { state: cfg ? 'idle' : 'off' }
const subs = new Set<() => void>()
const setStatus = (s: Status) => { status = s; subs.forEach(f => f()) }
export const useSync = () => useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => status)
export const getSyncCfg = () => cfg
export const syncStatusRef = () => status

export function configureSync(c: SyncCfg | null) {
  cfg = c ? { url: c.url.replace(/\/+$/, ''), token: c.token.trim() } : null
  try { cfg ? localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) : localStorage.removeItem(CFG_KEY) } catch { /* ignore */ }
  base = null; fails = 0; retryAt = 0 // another server/key: forget what the old one held
  setStatus({ state: cfg ? 'idle' : 'off' })
  if (cfg) void syncNow(true)
}

async function api(method: 'GET' | 'PUT', body?: string, since?: number) {
  const r = await fetch(cfg!.url + '/api/state' + (since != null ? '?since=' + since : ''), {
    method, headers: { Authorization: 'Bearer ' + cfg!.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body, cache: 'no-store',
  })
  if (r.status === 401) throw new Error('Wrong sync key')
  return r
}
async function fail(r: Response): Promise<never> { // the server's own message (e.g. 413 "too large") beats a bare status
  let m = ''; try { m = ((await r.json()) as { error?: string }).error || '' } catch { /* not json */ }
  throw new Error(m || 'Server error ' + r.status)
}

/* Change detection: a stable hash of canonical JSON (sorted keys), so key order never forces an upload */
function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(x => x === undefined ? 'null' : canon(x)).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}'
}
function cyrb53(str: string) { // fast 53-bit string hash; collisions are irrelevant at this scale
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
export const docHash = (d: unknown) => d == null ? '' : cyrb53(canon(d))
let memoObj: unknown = null, memoHash = '' // the store is immutable: same object -> same hash, so an idle poll hashes nothing
const localHash = () => { const s = getState(); if (s !== memoObj) { memoObj = s; memoHash = docHash(s) } return memoHash }

/* What this device knows the server holds: its rev, the doc at that rev and its hash. Memory only — after a reload the first
   cycle does one full GET. While the server answers 304 the base stands in for its doc, so the merge is exactly the old one. */
let base: { rev: number; doc: State | null; hash: string } | null = null

/* Backoff on 409 storms / 5xx / network errors: 5 s · 2^n with jitter, capped at 5 min, reset by a clean cycle */
const BACKOFF_BASE = 5000, BACKOFF_CAP = 300000
let fails = 0, retryAt = 0, retryTimer: ReturnType<typeof setTimeout> | undefined
export const backoffDelay = (n: number, rnd = Math.random()) => Math.round(Math.min(BACKOFF_CAP, BACKOFF_BASE * 2 ** Math.max(0, n - 1)) * (0.5 + 0.5 * rnd))
export const syncBackoff = () => ({ fails, retryAt })
let sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
/** test hook: replace the in-cycle conflict wait and inspect / reset the engine's memory */
export const _syncTest = { setSleep(f: (ms: number) => Promise<void>) { sleep = f }, reset() { base = null; fails = 0; retryAt = 0; memoObj = null; clearTimeout(retryTimer) }, base: () => base }

let running: Promise<void> | null = null, again = false
let resolveFirst: () => void = () => {}
/** resolves once this device has pulled the latest state (or immediately when sync isn't set up) — catch-up and auto-triggers wait for it */
export const firstSync = new Promise<void>(r => { resolveFirst = r })
export function syncNow(loud = false): Promise<void> {
  if (!cfg) return Promise.resolve()
  if (running) { again = true; return running }
  if (!loud && Date.now() < retryAt) return Promise.resolve() // backing off: the retry timer comes back (a manual sync goes now)
  running = (async () => {
    setStatus({ ...status, state: 'syncing' })
    try {
      let done = false
      for (let attempt = 0; attempt < 4 && !done; attempt++) {
        if (attempt) await sleep(backoffDelay(attempt, Math.random()) / 10) // 0.25–2 s between conflict retries
        const g = await api('GET', undefined, base?.rev)
        let rev: number, doc: State | null, srvHash: string
        if (g.status === 304 && base) ({ rev, doc, hash: srvHash } = base)
        else {
          if (!g.ok) await fail(g)
          const j = await g.json() as { rev: number; doc: State | string | null }
          rev = j.rev; doc = typeof j.doc === 'string' ? JSON.parse(j.doc) as State : j.doc; srvHash = docHash(doc)
          base = { rev, doc, hash: srvHash }
        }
        // merge only when the two sides differ; unchanged server + unchanged device = nothing to do at all
        if (localHash() !== srvHash) {
          if (doc) replaceFromSync(mergeStates(getState(), doc))
          reconcileToday() // a plan applied on the other device shows up in today immediately
        }
        const h = localHash()
        if (h === srvHash) { done = true; break } // the server already has exactly this: no upload
        const out = getState(), json = JSON.stringify(out)
        const p = await api('PUT', '{"rev":' + rev + ',"doc":' + json + '}')
        if (p.status === 409) { base = null; continue } // someone else pushed in between — pull again and re-merge
        if (!p.ok) await fail(p)
        const nr = (await p.json() as { rev: number }).rev
        base = { rev: nr, doc: JSON.parse(json) as State, hash: h } // private copy: what the server now holds
        done = true
      }
      if (!done) throw new Error('Too many conflicts, will retry') // only 4 straight 409s fail a cycle
      // an edit (a tap, the running timer's beat) landed while the PUT was in flight: the upload still succeeded, ship the rest next
      if (localHash() !== base!.hash) again = true
      fails = 0; retryAt = 0
      setStatus({ state: 'ok', at: Date.now() })
      if (loud) toast('Synced', 'cloud_done')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      fails++; const d = backoffDelay(fails); retryAt = Date.now() + d
      clearTimeout(retryTimer); retryTimer = setTimeout(() => void syncNow(), d)
      setStatus({ state: 'error', at: status.at, msg: navigator.onLine ? msg : 'Offline — will sync when back' })
      if (loud) toast('Sync failed: ' + msg, 'cloud_off')
    } finally {
      running = null
      if (again) { again = false; void syncNow() }
    }
  })()
  return running
}

/** wire up automatic syncing: on start, after local edits (debounced), on focus, when back online, and a fast 4s poll while active */
export function startSync() {
  let t: number | undefined
  onLocalChange(() => { clearTimeout(t); t = window.setTimeout(() => void syncNow(), 600) })
  addEventListener('online', () => { retryAt = 0; void syncNow() }) // back online: don't wait out the backoff
  window.addEventListener('focus', () => { if (document.visibilityState === 'visible') void syncNow() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow() })
  setInterval(() => { if (document.visibilityState === 'visible') void syncNow() }, 4000)
  void syncNow().finally(() => resolveFirst())
}
