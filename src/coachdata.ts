import { extraData, extraShrink } from './coach'
import { getCfUser, getProb, onCf } from './cf'
import { getLeverage, refreshLeverage } from './leverage'
import { peakSummary } from './discipline'
import { rivalsSummary } from './rivals'
import { provisional, radar } from './contests'
import { addDays, dateKey, getState, isWork, spanEnd, spanMin, spansOf, workMin } from './store'
import { learningSubs, nextSubs, subsOf, subSkills, tierTarget, TOPICS } from './curriculum'
import { skillNow } from './train'

/* ═════════ extra coach data (leverage, peak hours, contests, rivals) + the leverage auto-refresh ═════════ */

const lev = () => {
  const l = getLeverage()
  return l && { analysed_contests: l.contests, target_tier: l.targetTier, levers: l.levers.slice(0, 6).map(x => ({ label: x.label, pos: x.pos, kind: x.kind, rating_per_contest: Math.round(x.perContest) })),
    what_ifs: l.whatIfs.slice(-12).map(w => ({ contest: w.contestId, change: w.label, gain: Math.round(w.delta) })), speed_targets_min: l.speedTable }
}
const rounds = () => radar(14).slice(0, 8).map(r => ({ id: r.id, name: r.name, div: r.div, start_local: new Date(r.start).toLocaleString('sv').slice(0, 16), dur_min: Math.round(r.dur / 60), rated: r.rated, mandatory: r.mandatory }))

extraData.leverage = lev
extraData.peak = () => peakSummary(getState())
extraData.rated_rounds = rounds
extraData.provisional = () => provisional()
extraData.rivals = () => rivalsSummary()
// the curriculum (ids only — you know the theory) and where the student stands in every sub-topic with evidence
extraData.curriculum = () => TOPICS.map(t => `${t.name}: ` + t.subs.map(s => `${s.id}(${s.tier})`).join(' '))
extraData.subtopics = () => {
  const cp = getState().cp, sk = skillNow(), ss = subSkills(sk, cp, getProb), learning = new Set(learningSubs(cp))
  const rows = [...ss.values()].filter(k => k.tried || k.cses || learning.has(k.id) || cp.subs?.[k.id])
    .map(k => [k.id, k.st, k.clean.length, k.clean[0] || 0, k.failed, k.cses, cp.subs?.[k.id]?.st === 'paused' ? 'stopped' : learning.has(k.id) ? 'learning-now' : ''])
  return { columns: ['sub', 'state', 'clean_solves', 'best_clean_rating', 'fails', 'cses_done', 'flag'], rows, next_suggested: nextSubs(sk, cp, ss, 8).map(s => s.id), unclassified_recent: Object.keys(cp.attempts).filter(p => !subsOf(cp, p).length).slice(-40) }
}
// size guard: only sub-topics near the next rank, and only the rows that matter now (flagged, suggested, still in progress)
extraShrink.curriculum = () => {
  const cap = tierTarget(skillNow().level) + 300
  return TOPICS.map(t => [t.name, t.subs.filter(s => s.tier <= cap)] as const).filter(([, subs]) => subs.length).map(([n, subs]) => `${n}: ` + subs.map(s => `${s.id}(${s.tier})`).join(' '))
}
extraShrink.subtopics = v => {
  const x = v as { rows: unknown[][]; next_suggested: string[]; unclassified_recent: string[] }
  const nx = new Set(x.next_suggested)
  const rows = x.rows.filter(r => r[6] || nx.has(r[0] as string) || r[1] === 'learning' || r[1] === 'new').slice(0, 60)
  return { ...x, rows, rows_omitted: x.rows.length - rows.length, unclassified_recent: x.unclassified_recent.slice(-15) }
}
// the real work log: what the student actually did (start–end, from the timers) next to what was planned
const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)
const workLog = (n: number) => {
  const s = getState(), k = dateKey()
  return Array.from({ length: n }, (_, i) => addDays(k, -i)).filter(d => s.days[d]).map(d => {
    const day = s.days[d], ss = spansOf(day), title = (id?: string) => id && day.tasks.find(t => t.id === id)?.title
    return {
      date: d, work_min: workMin(day), logged_min: Math.round(ss.filter(x => isWork(x.cat)).reduce((a, x) => a + spanMin(x), 0)),
      planned_work_min: day.tasks.filter(t => isWork(t.cat)).reduce((a, t) => a + t.dur, 0),
      untracked_done: day.tasks.filter(t => t.done && !ss.some(x => x.taskId === t.id)).map(t => `${t.title} (${t.dur}m planned, no timer)`),
      spans: ss.map(x => [`${hm(x.start)}-${x.end === null ? 'now' : hm(spanEnd(x))}`, Math.round(spanMin(x)), x.cat, x.src, x.title, title(x.taskId) || null]),
    }
  })
}
extraData.work_log = () => ({ columns: ['time', 'min', 'cat', 'src', 'title', 'planned_block'], days: workLog(4) })
extraShrink.work_log = () => ({ columns: ['time', 'min', 'cat', 'src', 'title', 'planned_block'], days: workLog(2).map(d => ({ ...d, spans: d.spans.slice(-30) })) })

/** re-analyse rating leverage once per new rated contest (network-heavy: ratingChanges + standings per contest) */
let busy = false, lastTry = 0, lastH = ''
function maybeRefresh() {
  const u = getCfUser(), rated = u?.rated || []
  if (u && u.handle.toLowerCase() !== lastH) { lastH = u.handle.toLowerCase(); lastTry = 0 } // new handle: don't wait out the throttle
  if (busy || !u || !rated.length || Date.now() - lastTry < 30 * 60000) return
  const last = Math.max(...rated.map(r => r.at)), l = getLeverage()
  if (l && l.at > last && l.contests >= Math.min(6, rated.length)) return
  busy = true; lastTry = Date.now()
  refreshLeverage(u.handle, 6).catch(() => null).finally(() => { busy = false; if (getCfUser()?.handle.toLowerCase() !== lastH) setTimeout(maybeRefresh, 3000) })
}
export function startCoachData() {
  onCf(() => setTimeout(maybeRefresh, 3000))
  setTimeout(maybeRefresh, 8000)
}
