import { getState } from './store'
import { useSyncExternalStore } from 'react'
import { getSyncCfg } from './sync'

/* ═════════ transport to the two persistent Claude Code sessions on the laptop (server.py) ═════════
   Turns are queued per device (localStorage), POSTed with a client turn_id (idempotent), then polled.
   Works offline: a turn waits until the laptop is reachable. Results that finished while the app was closed
   are recovered from the session log on start. */

export type SessionName = 'coach' | 'planner'
export interface Turn {
  id: string; session: SessionName; path: string; body: Record<string, unknown>; meta: Record<string, unknown>
  at: number; state: 'queued' | 'sent' | 'running' | 'done' | 'error'; err?: string; position?: number
  /** transient-failure retries so far, and when the next one may go (429 / 5xx backoff) */
  tries?: number; retryAt?: number
}
export interface TurnResult { structured: Record<string, unknown>; gen: number; reseeded?: boolean; at: number; kind?: string; cost_usd?: number }
type Handler = (turn: { id: string; meta: Record<string, unknown> }, res: TurnResult) => void
type ErrHandler = (turn: Turn) => void

const Q_KEY = 'momentum.claude.q', SEEN_KEY = 'momentum.claude.seen'
let q: Turn[] = (() => { try { return JSON.parse(localStorage.getItem(Q_KEY) || '[]') } catch { return [] } })()
let ver = 0
const subs = new Set<() => void>()
const save = () => { try { localStorage.setItem(Q_KEY, JSON.stringify(q.slice(-40))) } catch { /* ignore */ } ver++; subs.forEach(f => f()) }
const handlers: Partial<Record<SessionName, Handler>> = {}, errHandlers: Partial<Record<SessionName, ErrHandler>> = {}
export const onResult = (s: SessionName, h: Handler, e?: ErrHandler) => { handlers[s] = h; if (e) errHandlers[s] = e }
export const useTurns = (s: SessionName) => { useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => ver); return q.filter(t => t.session === s) }
export const pending = (s: SessionName) => q.filter(t => t.session === s && t.state !== 'done' && t.state !== 'error')
export const newTurnId = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`)

async function api(method: string, path: string, body?: unknown) {
  const cfg = getSyncCfg(); if (!cfg) throw new Error('no-sync')
  const r = await fetch(cfg.url + path, {
    method, headers: { Authorization: 'Bearer ' + cfg.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, j }
}

/** `fixedId`: a deterministic id (auto-triggers) so two devices firing the same trigger collapse into one turn on the server */
export function submit(session: SessionName, path: string, body: Record<string, unknown>, meta: Record<string, unknown> = {}, fixedId?: string): string {
  const id = fixedId || newTurnId()
  if (q.some(t => t.id === id)) return id
  q.push({ id, session, path, body: { ...body, turn_id: id }, meta, at: Date.now(), state: 'queued' })
  save(); void pump()
  return id
}
export function dismiss(id: string) { q = q.filter(t => t.id !== id); save() }

/** a 429 / 5xx (not 503: the laptop says "busy, keep it queued") is retried this many times before the turn errors */
export const TURN_RETRIES = 3
/** wait before retry n (1-based): 3 s, 6 s, 12 s + up to 1 s jitter */
export const turnBackoff = (n: number) => 3000 * 2 ** (n - 1) + Math.floor(Math.random() * 1000)
let pumping = false
export async function pump() {
  if (pumping || !getSyncCfg()) return
  pumping = true
  try {
    for (let rounds = 0; rounds < 400; rounds++) {
      const live = q.filter(t => t.state === 'queued' || t.state === 'sent' || t.state === 'running')
      if (!live.length) break
      for (const t of live) {
        try {
          if (t.state === 'queued') {
            if (t.retryAt && Date.now() < t.retryAt) continue // backing off after a 429 / 5xx
            const r = await api('POST', t.path, t.body)
            if (r.status === 202) { t.state = r.j.state === 'running' ? 'running' : 'sent'; t.position = r.j.position; t.tries = t.retryAt = undefined }
            else if (r.status === 503) t.err = r.j.error || `server ${r.status}`
            else if (r.status === 429 || r.status >= 500) {
              t.err = r.j.error || `server ${r.status}`; t.tries = (t.tries || 0) + 1
              if (t.tries > TURN_RETRIES) { t.state = 'error'; t.retryAt = undefined; errHandlers[t.session]?.(t) }
              else t.retryAt = Date.now() + turnBackoff(t.tries)
            }
            else { t.state = 'error'; t.err = r.j.error || `server ${r.status}`; errHandlers[t.session]?.(t) }
            if (r.j.state === 'done' || r.j.state === 'error') finish(t, r.j)
          } else {
            const r = await api('GET', `/api/job/${t.id}`)
            if (r.status === 404) { if (Date.now() - t.at > 6 * 864e5) { t.state = 'error'; t.err = 'expired'; continue } t.state = 'queued'; continue } // server restarted mid-turn: resend (idempotent)
            if (r.j.state === 'done' || r.j.state === 'error') finish(t, r.j)
            else { t.state = r.j.state === 'running' ? 'running' : 'sent'; t.position = r.j.position }
          }
        } catch {
          t.err = 'Waiting for your laptop (server.py) to be reachable'
          save(); return // offline: try again on the next pump trigger
        }
        save()
      }
      await new Promise(r => setTimeout(r, rounds < 5 ? 2000 : rounds < 15 ? 4000 : 8000))
    }
  } finally { pumping = false }
}
function finish(t: Turn, j: { state: string; result?: TurnResult; error?: string }) {
  if (j.state === 'done' && j.result) {
    t.state = 'done'; t.err = undefined
    markSeen(t.id)
    try { handlers[t.session]?.({ id: t.id, meta: t.meta }, j.result) } catch (e) { console.error(e) }
  } else { t.state = 'error'; t.err = j.error || 'failed'; errHandlers[t.session]?.(t) }
}

/* results that finished while this device was away (or were asked from the other device's queue) */
const seen = (() => { try { return new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set<string>() } })()
function markSeen(id: string) { seen.add(id); try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-300))) } catch { /* ignore */ } }
export async function catchUp(session: SessionName, after: number, known: (turnId: string) => boolean) {
  try {
   after = Math.max(after, getState().epoch || 0) // nothing from before a reset comes back
   for (let page = 0; page < 20; page++) {
    const r = await api('GET', `/api/session/${session}/log?after=${after}&limit=50`)
    const entries = (r.j.entries || []) as { turn_id: string; at: number; kind: string; gen: number; out?: Record<string, unknown>; message?: string }[]
    if (entries.length) after = entries[entries.length - 1].at
    for (const e of entries) {
      if (q.some(t => t.id === e.turn_id && t.state !== 'done' && t.state !== 'error')) continue // the live queue delivers it with full meta
      // `known` (the answer is actually stored) decides — a merge can drop a stored answer, and this restores it
      if (!e.out || known(e.turn_id)) continue
      markSeen(e.turn_id)
      handlers[session]?.({ id: e.turn_id, meta: { message: e.message, kind: e.kind, recovered: true } }, { structured: e.out, gen: e.gen, at: e.at, kind: e.kind })
    }
    if (entries.length < 50) break
   }
  } catch { /* offline */ }
}
export async function sessionInfo(name: SessionName) { const r = await api('GET', `/api/session/${name}`); if (r.status !== 200) throw new Error(r.j.error || 'unreachable'); return r.j }
export async function resetSession(name: SessionName, keepNotebook: boolean) { const r = await api('POST', `/api/session/${name}/reset`, { keep_notebook: keepNotebook }); if (r.status !== 200) throw new Error(r.j.error || 'failed'); return r.j }

export function startClaude() {
  addEventListener('online', () => void pump())
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void pump() })
  setInterval(() => { if (q.some(t => t.state !== 'done' && t.state !== 'error')) void pump() }, 20000)
  void pump()
}
