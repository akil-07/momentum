import { getState, toast } from './store'
import { getProb } from './cf'
import { activeSeconds, classify, eventsByPid, timeline, verdictChain } from './cptime'
import { askCoach } from './coach'
import { hintIn } from './train'

/* ═════════ paste-your-code review: hints-first bug hunt (WA/TLE) or AC solution review, answered in the coach chat ═════════ */

export const REVIEW_PID_RE = /^\d{1,4}[A-Z]\d?$/
export const CODE_CAP = 20000
/** fired after a review is queued: the coach chat switches to Chat and scrolls into view (CoachPanel listens) */
export const COACH_FOCUS_EVENT = 'momentum:coach-focus'

/** hint stage the coach must respect: 0 none · 1 tags · 2 editorial hint · 3 full editorial (reading the editorial counts as 3) */
export function reviewStage(pid: string, sess?: string) {
  const t = timeline(pid, eventsByPid(getState().cp).get(pid))
  return Math.max(hintIn(pid, sess), t.editorial ? 3 : 0)
}
/** did this problem already get an AC (any source) */
export function isSolved(pid: string) {
  const cp = getState().cp
  return cp.attempts[pid]?.status === 'solved' || !!timeline(pid, eventsByPid(cp).get(pid)).acAt
}

/** what the coach gets besides the code: verdict chain, time spent, error classes, rating/tags */
function reviewData(pid: string, hint: number, sess?: string) {
  const cp = getState().cp, byPid = eventsByPid(cp), t = timeline(pid, byPid.get(pid)), p = getProb(pid)
  const start = t.firstOpen ?? t.firstSub, end = t.acAt ?? Date.now()
  const all = [...byPid.values()].flat()
  const active = start ? activeSeconds(all, start, end)[pid] : undefined
  return {
    pid, rating: p?.r, name: p?.n, tags: hint >= 1 ? p?.t : undefined, // tags are a spoiler before hint stage 1
    verdicts: verdictChain(t) || 'no submissions recorded', errors: classify(t),
    minutes_since_open: start ? Math.round((end - start) / 60000) : undefined,
    active_minutes: active !== undefined ? Math.round(active / 60) : undefined,
    gave_up: t.gaveUp || undefined, session: sess, notes: t.notes.length ? t.notes : undefined,
  }
}

/** queue a review turn; returns the turn id (null when sync isn't set up or the input is bad) */
export function askReview({ pid, code, wantFix = false, solved, sess }: { pid: string; code: string; wantFix?: boolean; solved?: boolean; sess?: string }) {
  pid = pid.trim().toUpperCase()
  if (!REVIEW_PID_RE.test(pid)) { toast('Problem id like 1900A', 'error'); return null }
  const src = code.replace(/\r\n/g, '\n').slice(0, CODE_CAP)
  if (!src.trim()) { toast('Paste your code first', 'error'); return null }
  const hint = reviewStage(pid, sess), ac = solved ?? isSolved(pid)
  const fix = !ac && wantFix && hint >= 3 // hints first: the fix unlocks at the full-editorial stage
  const message = ac ? `Review my AC solution for ${pid} — make it faster or cleaner.`
    : `My code for ${pid} fails (${verdictChain(timeline(pid, eventsByPid(getState().cp).get(pid))) || 'not submitted yet'}). ${fix ? 'Show me the fix.' : 'Hints first — where is the bug?'}`
  const id = askCoach('review', message, { review: reviewData(pid, hint, sess) }, undefined, { pid, code: src, want_fix: fix, hint, solved: ac })
  if (id) {
    toast('Sent to your coach', 'psychology')
    try { dispatchEvent(new CustomEvent(COACH_FOCUS_EVENT, { detail: { turn: id } })) } catch { /* ignore */ }
  }
  return id
}

/** the problem the student is working on right now (practice card or mock), for defaults */
export function currentPid() {
  const cp = getState().cp
  return cp.active?.cur || undefined
}
