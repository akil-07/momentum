import { resetAll } from './store'
import { getSyncCfg, syncNow } from './sync'
import { resetSession } from './claude'

/* ═════════ "Reset everything": this browser and the server start over ═════════ */

// per-device caches that hold your data (the public Codeforces problemset/contest caches and the server connection stay)
const LOCAL = ['momentum.cf.user', 'momentum.cfTier', 'momentum.claude.q', 'momentum.claude.seen', 'momentum.contest.live', 'momentum.leverage', 'momentum.rivals', 'momentum.v1']

export async function resetEverything(keepSettings: boolean) {
  resetAll(keepSettings)
  try {
    for (const k of LOCAL) localStorage.removeItem(k)
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith('momentum.contest.marks.')) localStorage.removeItem(k) }
  } catch { /* storage unavailable */ }
  const notes: string[] = []
  if (getSyncCfg()) {
    // push the reset so the server follows; then wipe the coach + planner memory on the server
    try { await syncNow() } catch { notes.push('sync') }
    for (const s of ['coach', 'planner'] as const) { try { await resetSession(s, false) } catch { notes.push(s) } }
  }
  return notes
}
