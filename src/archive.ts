import { useSyncExternalStore } from 'react'
import { dateKey, getState, onAnyChange, sameHandle, type CpState } from './store'
import { cacheReady, contestInfo, getCfUser, getContests, getPastContests, getProbMap, hasProblems, loadPastContests, loadProblems, onCf, type CfUser, type Prob } from './cf'
import { firstSync, getSyncCfg, docHash } from './sync'
import { schedule, type Grade } from './ideas'

/* ═════════ Archive: every mock, round, virtual and practice session ever done, kept on the laptop for years ═════════
   state.json is pruned (events compacted, days slimmed, statements cached 30 days); data/archive on the server is
   append/upsert only. This module re-sends everything the device knows (idempotent: the server upserts by id), links
   the student's code folder to problems, and reads the archive back for the Archive tab, the flashcards and the coach. */

export type ActKind = 'mock' | 'virtual' | 'contest' | 'practice' | 'free'
export interface Activity {
  id: string; kind: ActKind; date: string; at: number; end?: number; title: string
  pids: string[]; solved: string[]; perf?: number; rank?: number; delta?: number; mins?: number; mode?: string
  contestId?: number; note?: string
}
export type AttStatus = 'solved' | 'failed' | 'tried'
export interface Attempt { pid: string; at: number; status: AttStatus; src: string; secs?: number; act?: string }
export interface ProbMeta {
  pid: string; name: string; rating: number; tags: string[]; contestId: number; index: string
  firstAt: number; lastAt: number; status: AttStatus; attempts: Omit<Attempt, 'pid'>[]
}
export interface ProbIn { pid: string; name: string; rating: number; tags: string[]; contestId: number; index: string }
export interface Card {
  pid: string; at: number; model: string; ver: 1; summary: string; key_idea: string; intended: string
  mine: string; compare: string; pitfalls: string[]; tags: string[]
}
/** first: the day of the first review (set by the server; missing on records made before it existed) */
export interface Srs { ef: number; ivl: number; reps: number; lapses: number; due: string; last?: number; first?: string }
export interface LinkRec { pid: string | null; by: 'auto' | 'user'; u: number }
export interface CardJobs { running: string | null; queue: string[]; doneToday: number; cap: number; errors: Record<string, string> }
export interface ArchiveIndex {
  ver: number; createdAt?: number; codeDir: string; activities: Record<string, Activity>; problems: Record<string, ProbMeta>
  cards: Record<string, CardEntry>; srs: Record<string, Srs>; links: Record<string, LinkRec>
  hasStatement: Record<string, boolean>; cardJobs: CardJobs
  /** keep the code folder organized (server files linked code under <Kind>/<date> <round>/<pid> <name>) */
  organize?: boolean; lastOrganize?: { at: number; n: number; moves: { from: string; to: string }[] } | null
}
/** a card in the archive index: enough to list it (its front) without loading it */
export interface CardEntry { at: number; key_idea: string; summary?: string; tags?: string[]; ver?: number }
/* topics, most specific first: a card goes under the first of these its problem has (Codeforces tags) */
export const TOPIC_ORDER = ['dp', 'graphs', 'trees', 'shortest paths', 'dfs and similar', 'dsu', 'graph matchings', 'flows', 'data structures',
  'binary search', 'two pointers', 'bitmasks', 'number theory', 'combinatorics', 'probabilities', 'geometry', 'string suffix structures',
  'hashing', 'strings', 'divide and conquer', 'games', 'interactive', 'matrices', 'fft', 'meet-in-the-middle', 'ternary search',
  'constructive algorithms', 'sortings', 'greedy', 'math', 'brute force', 'implementation']
export const TOPIC_LABEL: Record<string, string> = {
  dp: 'Dynamic programming', graphs: 'Graphs', trees: 'Trees', 'shortest paths': 'Shortest paths', 'dfs and similar': 'DFS / BFS', dsu: 'DSU',
  'data structures': 'Data structures', 'binary search': 'Binary search', 'two pointers': 'Two pointers', bitmasks: 'Bitmasks',
  'number theory': 'Number theory', combinatorics: 'Combinatorics', probabilities: 'Probability', geometry: 'Geometry', strings: 'Strings',
  hashing: 'Hashing', 'divide and conquer': 'Divide and conquer', games: 'Games', interactive: 'Interactive',
  'constructive algorithms': 'Constructive', sortings: 'Sorting', greedy: 'Greedy', math: 'Math', 'brute force': 'Brute force',
  implementation: 'Implementation', other: 'Other',
}
export const topicLabel = (t: string) => TOPIC_LABEL[t] || t.charAt(0).toUpperCase() + t.slice(1)
/** the one topic a problem is filed under: its most specific Codeforces tag, else the card's own first tag */
export function topicOf(tags: string[] | undefined, cardTags?: string[]): string {
  const ts = (tags || []).filter(t => !t.startsWith('*'))
  for (const t of TOPIC_ORDER) if (ts.includes(t)) return t
  return ts[0] || cardTags?.[0] || 'other'
}
export interface OrganizeResult { moves: { from: string; to: string }[]; kept: { path: string; why: string }[]; error?: string }
/** a code file linked to a problem, with its text (GET /api/archive/problem/<pid>) */
export interface CodeFile { path: string; text: string; mtime: number }
export interface ProblemDetail { meta: ProbMeta | null; statement: string; card: Card | null; srs: Srs | null; code: CodeFile[] }
/** one file of the code-folder scan (GET /api/archive/code) */
export interface CodeScanFile { path: string; mtime: number; size: number; head: string }
export interface CodeScan { dir: string; ok: boolean; files: CodeScanFile[] }
/** drop: app records that were never real work (the server deletes them and their attempts for good);
 *  full: app activities whose complete attempt list this send carries (the server replaces what it had for them) */
export interface Ingest { activities: Activity[]; problems: ProbIn[]; attempts: Attempt[]; drop: string[]; full: string[] }
/** a mock left before this many minutes with nothing solved, submitted or opened was rerolled, not sat */
export const JUNK_MOCK_MIN = 10

export const PID_OK = /^\d{1,4}[A-Z]\d?$/
const splitPid = (pid: string) => { const m = pid.match(/^(\d+)([A-Z]\d?)$/); return m ? { c: +m[1], i: m[2] } : null }
const idxSort = (a: string, b: string) => { const x = splitPid(a), y = splitPid(b); return x && y ? x.c - y.c || (x.i < y.i ? -1 : x.i > y.i ? 1 : 0) : a < b ? -1 : 1 }
const uniq = <T>(xs: T[]) => [...new Set(xs)]

/* ───────── buildIngest: everything this device knows, as archive records (pure) ───────── */
/** `contestName`: a contest's title when known (contestInfo), else undefined */
export function buildIngest(cp: CpState, user: CfUser | null, probs: Map<string, Prob>, contestName: (cid: number) => string | undefined): Ingest {
  const acts = new Map<string, Activity>(), atts: Attempt[] = [], drop: string[] = [], full: string[] = []
  // events before evCut were compacted away: only newer records can be judged (opened problems) and re-sent in full
  const evCut = cp.evCut || 0, evs = Object.values(cp.events || {})
  const openedIn = (lo: number, hi: number) => new Set(evs.filter(e => e.k === 'open' && e.at >= lo && e.at <= hi).map(e => e.pid))
  const mine = (h?: string) => !!cp.handle && sameHandle(h, cp.handle)
  const subs = user && cp.handle && sameHandle(user.handle, cp.handle) ? (user.list || []).filter(s => PID_OK.test(s.pid)) : []
  // CfUser.list keeps the newest ~4000 submissions: once it is full, the groups at its old end may have lost their
  // first submissions, and re-sending them would give their summary attempts new keys. The archive already has them.
  const LIST_CAP = 4000
  const all = user?.list || []
  const cut = all.length >= LIST_CAP ? Math.min(...all.map(s => s.at)) + 36 * 36e5 : -Infinity
  // only a device that has your CF submissions for a window can say what happened in it: without them a record is
  // merged, never re-sent in full (that would delete its CF attempts) and never dropped (a tombstone is for good)
  const cfOk = !!user && !!cp.handle && sameHandle(user.handle, cp.handle) && Array.isArray(user.list)
  const cfCovers = (lo: number) => cfOk && lo >= cut
  const nameOf = (cid: number) => contestName(cid) || user?.rated?.find(r => r.cid === cid)?.name
  const voided = (id: string) => !!cp.triggers?.['void:' + id]
  const subsIn = (pid: string, lo: number, hi: number) => subs.filter(s => s.pid === pid && s.at >= lo && s.at <= hi)

  // 1. app mocks and real-round virtuals (and live-round records, which become the round's cf:<cid> activity)
  const now = Date.now()
  const isDone = (t: { finishedAt?: number; startedAt: number; dur: number }) => !!t.finishedAt || t.startedAt + t.dur * 60000 < now
  const myTests = Object.values(cp.tests || {}).filter(t => mine(t.h))
  const tests = myTests.filter(isDone)
  // a real-round virtual's VIRTUAL submissions belong to the test, finished or still running (never a cfv:<cid> copy)
  const virtualCids = new Set<number>(myTests.filter(t => t.real && !(t.real as { live?: boolean }).live).map(t => t.real!.contestId))
  // work still in progress (a running mock or practice session) is left out until it is finished and has its own record:
  // its practice submissions would otherwise land in a free:<day> activity the server can never take them out of
  const pending = [...myTests.filter(t => !isDone(t)).map(t => t.startedAt), ...(cp.active ? [cp.active.startedAt] : [])]
  const inPending = (at: number) => pending.some(lo => at >= lo)
  // a finished mock's problems submitted on CF (as PRACTICE) are already its test attempts
  const testWins: { lo: number; hi: number; pids: string[] }[] = []
  for (const t of tests) {
    const real = t.real as (NonNullable<typeof t.real> & { live?: boolean }) | undefined
    const end = t.finishedAt || t.startedAt + t.dur * 60000
    const solvedSecs = (pid: string): number | undefined => {
      if (t.solved[pid] !== undefined) return t.solved[pid]
      const sp = splitPid(pid), p = real && sp ? real.probs?.[sp.i] : undefined
      return p?.at
    }
    const solved = t.pids.filter(p => solvedSecs(p) !== undefined)
    if (real?.live) {
      acts.set('cf:' + real.contestId, {
        id: 'cf:' + real.contestId, kind: 'contest', date: t.date, at: t.startedAt, end, title: nameOf(real.contestId) || real.name || `Round ${real.contestId}`,
        pids: [...t.pids].sort(idxSort), solved: solved.sort(idxSort), mins: t.dur, contestId: real.contestId,
        ...(real.perf ?? t.perf ? { perf: real.perf ?? t.perf } : {}), ...(real.rank ? { rank: real.rank } : {}), ...(real.delta !== undefined ? { delta: real.delta } : {}),
      })
      continue
    }
    const id = 'test:' + t.id
    const seen = t.startedAt >= evCut  // its open events are still there
    const judged = seen && cfCovers(t.startedAt)
    // only inside the mock itself: the next mock can start minutes after a voided one ended
    const opened = openedIn(t.startedAt, end)
    const anySub = t.pids.some(p => subsIn(p, t.startedAt, end).length || (real?.probs?.[splitPid(p)?.i || '']?.wa || 0) > 0)
    // rerolled after seconds, or abandoned (voided) with nothing done: not something you sat
    if (judged && !solved.length && !anySub && !opened.size && (voided(t.id) || end - t.startedAt < JUNK_MOCK_MIN * 60000)) { drop.push(id); continue }
    if (judged) full.push(id)
    testWins.push({ lo: t.startedAt, hi: end + 30 * 60000, pids: t.pids })
    acts.set(id, {
      id, kind: real ? 'virtual' : 'mock', date: t.date, at: t.startedAt, end, mins: t.dur,
      title: real ? `Virtual · ${real.name || nameOf(real.contestId) || 'Round ' + real.contestId}` : `Mock · ${t.date}`,
      pids: [...t.pids], solved,
      ...(t.perf ?? real?.perf ? { perf: t.perf ?? real?.perf } : {}), ...(real?.rank ? { rank: real.rank } : {}), ...(real?.delta !== undefined ? { delta: real.delta } : {}),
      ...(real ? { contestId: real.contestId } : {}), ...(voided(t.id) ? { note: 'voided' } : {}),
    })
    for (const pid of t.pids) {
      const s = solvedSecs(pid)
      if (s !== undefined) atts.push({ pid, at: t.startedAt + s * 1000, status: 'solved', src: 'test', secs: s, act: id })
      else if (subsIn(pid, t.startedAt, end).length || (real?.probs?.[splitPid(pid)?.i || '']?.wa || 0) > 0) atts.push({ pid, at: t.startedAt, status: 'failed', src: 'test', act: id })
      // a problem you never opened was not tried (once events are compacted we can no longer tell: keep the old rule)
      else if (opened.has(pid) || !seen) atts.push({ pid, at: t.startedAt, status: 'tried', src: 'test', act: id })
    }
  }

  // 2. practice sessions (mock sessions duplicate the tests); CF practice submissions made inside one belong to it
  const sessions = Object.values(cp.sessions || {}).filter(x => mine(x.h) && x.kind !== 'mock').sort((a, b) => a.startedAt - b.startedAt)
  const sessWin = sessions.map(x => ({ x, lo: x.startedAt, hi: (x.endedAt || x.startedAt) + 10 * 60000 }))
  for (const x of sessions) {
    if (x.startedAt >= evCut && cfCovers(x.startedAt)) full.push('sess:' + x.id)
    const mode = x.spec?.mode ?? x.kind
    const tags = (x.spec?.tags || []).slice(0, 2)
    acts.set('sess:' + x.id, {
      id: 'sess:' + x.id, kind: 'practice', date: x.date, at: x.startedAt, end: x.endedAt, mins: x.mins, mode,
      title: ['Practice', mode, ...tags].join(' · '), pids: [...x.pids], solved: [...x.solved],
    })
  }

  // 3. Codeforces history: rated rounds, virtuals, practice
  let byRound: Map<number, string[]> | null = null
  const roundPids = (cid: number) => {
    if (!byRound) { byRound = new Map(); for (const p of probs.values()) { const l = byRound.get(p.c); if (l) l.push(p.id); else byRound.set(p.c, [p.id]) } }
    return byRound.get(cid) || []
  }
  const groups = new Map<string, typeof subs>()
  const actOfSub = (s: (typeof subs)[number]): string | null => {
    if (s.pt === 'CONTESTANT' || s.pt === 'OUT_OF_COMPETITION') return 'cf:' + s.cid
    if (s.pt === 'VIRTUAL') return virtualCids.has(s.cid) ? null : 'cfv:' + s.cid
    if (s.pt === 'PRACTICE') {
      if (inPending(s.at)) return null
      const w = sessWin.find(w => s.at >= w.lo && s.at <= w.hi)
      return w ? 'sess:' + w.x.id : 'free:' + dateKey(new Date(s.at))
    }
    return null
  }
  for (const s of subs) { const a = actOfSub(s); if (a) (groups.get(a) || groups.set(a, []).get(a)!).push(s) }
  const partial = (id: string) => { const ss = groups.get(id); return !!ss && ss.some(s => s.at < cut) }
  const okSet = (ss: typeof subs) => new Set(ss.filter(s => s.v === 'OK').map(s => s.pid))
  for (const [id, ss] of groups) {
    if (!id.startsWith('cf:') && !id.startsWith('cfv:')) continue
    if (partial(id)) continue
    const cid = +id.split(':')[1], virtual = id.startsWith('cfv:')
    const at = Math.min(...ss.map(s => s.rel != null ? s.at - s.rel * 1000 : s.at)), end = Math.max(...ss.map(s => s.at))
    // every problem of the round, not just the ones you submitted: the rest were skipped (and belong in Upsolve)
    const pids = uniq([...ss.map(s => s.pid), ...roundPids(cid)]).sort(idxSort), ok = okSet(ss)
    const rated = user?.rated?.find(r => r.cid === cid)
    const old = acts.get(id)
    const name = nameOf(cid) || `Round ${cid}`
    acts.set(id, {
      ...(old || {}), id, kind: virtual ? 'virtual' : 'contest', date: old?.date || dateKey(new Date(at)), at: old?.at ?? at, end: Math.max(old?.end || 0, end),
      title: old?.title || (virtual ? `Virtual · ${name}` : name), contestId: cid,
      pids: uniq([...(old?.pids || []), ...pids]).sort(idxSort), solved: uniq([...(old?.solved || []), ...pids.filter(p => ok.has(p))]).sort(idxSort),
      ...(!virtual && rated ? { rank: rated.rank, delta: rated.new - rated.old } : {}),
    })
  }
  for (const [id, ss] of groups) {
    if (!id.startsWith('sess:')) continue
    const a = acts.get(id)!, ok = okSet(ss)
    acts.set(id, { ...a, pids: uniq([...a.pids, ...ss.map(s => s.pid)]), solved: uniq([...a.solved, ...ss.map(s => s.pid).filter(p => ok.has(p))]) })
  }

  // 4. app attempts (tests are covered above: an attempt there is only the latest per problem)
  const winOf = (a: Activity) => [a.at, (a.end || a.at + (a.mins || 0) * 60000) + 30 * 60000]
  const inOther = (pid: string, at: number, day: string) => [...acts.values()].some(a => a.kind !== 'free' && a.pids.includes(pid) && (a.date === day || (at >= winOf(a)[0] && at <= winOf(a)[1])))
  const freeAdd = (day: string, at: number, pid: string, ok: boolean) => {
    const id = 'free:' + day, a = acts.get(id) || { id, kind: 'free' as const, date: day, at, end: at, title: 'Free solves', pids: [], solved: [] }
    acts.set(id, { ...a, at: Math.min(a.at, at), end: Math.max(a.end || at, at), pids: uniq([...a.pids, pid]), solved: ok ? uniq([...a.solved, pid]) : a.solved })
    return id
  }
  const appAct = new Set<string>() // `${act}|${pid}`: an app record exists, the CF summary attempt would only repeat it
  for (const a of Object.values(cp.attempts || {})) {
    if (!mine(a.h) || a.src === 'test' || !PID_OK.test(a.pid)) continue
    const day = dateKey(new Date(a.at))
    let act: string | undefined
    const w = sessWin.find(w => a.at >= w.lo && a.at <= w.hi && w.x.pids.includes(a.pid))
    if (w) act = 'sess:' + w.x.id
    else if (a.src === 'free' && !inPending(a.at) && !inOther(a.pid, a.at, day)) act = freeAdd(day, a.at, a.pid, a.status === 'solved')
    if (act) appAct.add(act + '|' + a.pid)
    atts.push({ pid: a.pid, at: a.at, status: a.status, src: a.src, ...(a.secs !== undefined ? { secs: a.secs } : {}), ...(act ? { act } : {}) })
  }
  // served in a session but neither solved nor given up on record
  for (const x of sessions) for (const pid of x.pids) {
    if (!PID_OK.test(pid) || x.solved.includes(pid) || appAct.has('sess:' + x.id + '|' + pid)) continue
    atts.push({ pid, at: x.startedAt, status: 'tried', src: 'practice', act: 'sess:' + x.id })
  }

  // 5. CF practice submissions outside every session: the day's free solves (unless the problem was part of another activity)
  for (const [id, ss] of groups) {
    if (!id.startsWith('free:') || partial(id)) continue
    for (const s of ss.sort((a, b) => a.at - b.at)) {
      const day = id.slice(5)
      if (inOther(s.pid, s.at, day)) continue
      freeAdd(day, s.at, s.pid, s.v === 'OK')
    }
  }
  // one summary attempt per problem per CF participation (deterministic: keyed by the first submission's time)
  for (const s of subs) {
    const a = actOfSub(s); if (!a || partial(a)) continue
    // a mock problem submitted on CF during (or just after) the mock: the test attempt already records it
    if (a.startsWith('free:') && testWins.some(w => w.pids.includes(s.pid) && s.at >= w.lo && s.at <= w.hi)) continue
    // a practice submission on another activity's problem (an upsolve) keeps its record, just without an activity
    // ('' tells the server to drop an activity an earlier send may have given it)
    const act = a.startsWith('free:') && !acts.get(a)?.pids.includes(s.pid) ? '' : a
    if (appAct.has(a + '|' + s.pid)) continue
    appAct.add(a + '|' + s.pid)
    const ss = (groups.get(a) || []).filter(x => x.pid === s.pid).sort((x, y) => x.at - y.at)
    const ac = ss.find(x => x.v === 'OK')
    atts.push({ pid: s.pid, at: ss[0].at, status: ac ? 'solved' : 'failed', src: 'cf', ...(ac && ac.rel != null && !a.startsWith('free:') && !a.startsWith('sess:') ? { secs: ac.rel } : {}), act })
  }

  const activities = [...acts.values()].map(a => ({ ...a, pids: a.pids.filter(p => PID_OK.test(p)), solved: a.solved.filter(p => PID_OK.test(p)) }))
    .filter(a => a.pids.length || a.kind === 'practice' || a.kind === 'mock')
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
  const attempts = atts.filter(a => PID_OK.test(a.pid)).sort((a, b) => a.at - b.at || (a.pid < b.pid ? -1 : 1))
  const pids = uniq([...activities.flatMap(a => a.pids), ...attempts.map(a => a.pid)]).sort(idxSort)
  const problems = pids.map(pid => {
    const p = probs.get(pid), sp = splitPid(pid)!
    return { pid, name: p?.n || '', rating: p?.r || 0, tags: p?.t || [], contestId: p?.c ?? sp.c, index: p?.i ?? sp.i }
  })
  return { activities, problems, attempts, drop, full }
}

/* ───────── matchCode: which problem each file of the code folder solves (pure) ───────── */
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const RE_ID = /\b(\d{3,4})\s?([A-Z]\d?)\b/g
const RE_CONTEST = /(?:^|\/)Contests\/(\d+)\s*(?:\(([^)/]*)\))?[^/]*\/([A-Z]\d?)\.[A-Za-z0-9]+$/i
const RE_MOCK = /(?:^|\/)Mock Rounds?\/(\d+)\/([A-Z]\d?)\.[A-Za-z0-9]+$/i
const RE_NAMED = /(?:^|\/)([A-Z]\d?)\s*[.)\-_]\s*([^/]+)\.[A-Za-z0-9]+$/
export function matchCode(files: Pick<CodeScanFile, 'path' | 'mtime' | 'head'>[], acts: Activity[], probs: Map<string, Prob>, contests: { id: number; name: string }[]): { path: string; pid: string }[] {
  const mineSet = new Set(acts.flatMap(a => a.pids))
  const exists = (pid: string) => probs.has(pid) || mineSet.has(pid)
  // a voided mock was never sat: it neither takes a folder nor counts in the folder numbering
  const mocks = acts.filter(a => (a.kind === 'mock' || a.kind === 'virtual') && a.note !== 'voided').sort((a, b) => a.at - b.at)
  const actCids = new Set(acts.map(a => a.contestId).filter((x): x is number => !!x))
  let byName: Map<string, Prob[]> | null = null
  const nameIdx = () => {
    if (byName) return byName
    byName = new Map()
    for (const p of probs.values()) { const k = p.i + '|' + normName(p.n); (byName.get(k) || byName.set(k, []).get(k)!).push(p) }
    return byName
  }
  // a mock folder is one sitting: every file in it votes with its mtime, the activity with most votes takes the folder
  const hitOf = (mtime: number) => mocks.filter(a => mtime >= a.at && mtime <= (a.end || a.at + (a.mins || 0) * 60000) + 6 * 36e5).pop()
  const folderAct = new Map<string, Activity | undefined>()
  {
    const votes = new Map<string, Map<Activity, number>>()
    for (const f of files) {
      const m = f.path.replace(/\\/g, '/').match(RE_MOCK); if (!m) continue
      const key = f.path.replace(/\\/g, '/').replace(/\/[^/]*$/, ''), hit = hitOf(f.mtime)
      const v = votes.get(key) || votes.set(key, new Map()).get(key)!
      if (hit) v.set(hit, (v.get(hit) || 0) + 1)
      if (!folderAct.has(key)) folderAct.set(key, mocks[+m[1] - 1])
    }
    for (const [key, v] of votes) {
      const best = [...v.entries()].sort((x, y) => y[1] - x[1] || y[0].at - x[0].at)[0]
      if (best) folderAct.set(key, best[0])
    }
  }
  const out: { path: string; pid: string }[] = []
  for (const f of files) {
    const path = f.path.replace(/\\/g, '/')
    const pid = (() => {
      // (1) an explicit id in the file's first lines (beats the file name: it is how you fix a wrong guess)
      for (const m of (f.head || '').matchAll(RE_ID)) { const p = m[1] + m[2]; if (exists(p)) return p }
      // (0) an organized file: its name starts with the problem id ("1772A A+B.cpp")
      { const b = path.split('/').pop() || '', m0 = b.match(/^(\d{1,4}[A-Z]\d?)(?=[\s.(])/); if (m0 && exists(m0[1])) return m0[1] }
      // (2) Contests/<round number> (Div N)/<IDX>.cpp
      let m = path.match(RE_CONTEST)
      if (m) {
        const n = m[1], hint = (m[2] || '') + ' ' + (path.match(/Contests\/([^/]+)\//i)?.[1] || ''), idx = m[3].toUpperCase()
        const div = hint.match(/Div\.?\s*(\d)/i)?.[1], edu = /edu/i.test(hint)
        const rx = new RegExp(`\\bRound\\s*#?${n}\\b`, 'i')
        let cs = contests.filter(c => rx.test(c.name))
        if (div) { const dx = new RegExp(`Div\\.?\\s*${div}\\b`, 'i'); const d = cs.filter(c => dx.test(c.name)); if (d.length) cs = d }
        const e = cs.filter(c => /Educational/i.test(c.name) === edu); if (e.length) cs = e
        cs = [...cs].sort((a, b) => +actCids.has(b.id) - +actCids.has(a.id) || a.id - b.id)
        for (const c of cs) { const p = `${c.id}${idx}`; if (exists(p)) return p }
        return cs.length ? `${cs[0].id}${idx}` : null
      }
      // (3) Mock Rounds/<n>/<L>.cpp: the mock running when the folder's files were saved, else the n-th
      m = path.match(RE_MOCK)
      if (m) {
        const L = m[2].toUpperCase(), a = folderAct.get(path.replace(/\/[^/]*$/, ''))
        if (!a) return null
        if (a.kind === 'virtual') return a.pids.find(p => splitPid(p)?.i === L) || (a.contestId ? `${a.contestId}${L}` : null)
        return a.pids[L.charCodeAt(0) - 65] || null
      }
      // (4) "<IDX>. <Problem Name>.cpp": same index and name, the one you attempted first
      m = path.match(RE_NAMED)
      if (m) {
        const cands = nameIdx().get(m[1].toUpperCase() + '|' + normName(m[2])) || []
        if (!cands.length) return null
        const best = [...cands].sort((a, b) => +mineSet.has(b.id) - +mineSet.has(a.id) || b.c - a.c)[0]
        return best.id
      }
      return null
    })()
    if (pid && PID_OK.test(pid)) out.push({ path, pid })
  }
  return out
}

/* ───────── summaries (pure) ───────── */
export interface MonthRow { m: string; acts: Partial<Record<ActKind, number>>; solved: number; failed: number; avg_r: number | null; perf: number | null; tags: string[] }
/** one compact row per month, oldest first: activities by kind, problems solved / failed, mean rating solved, mean mock perf, top tags */
export function monthlyDigest(a: Pick<ArchiveIndex, 'activities' | 'problems'> | null | undefined): MonthRow[] {
  if (!a) return []
  const rows = new Map<string, { acts: Partial<Record<ActKind, number>>; s: Set<string>; f: Set<string>; perf: number[]; tags: Map<string, number> }>()
  const row = (m: string) => rows.get(m) || rows.set(m, { acts: {}, s: new Set(), f: new Set(), perf: [], tags: new Map() }).get(m)!
  for (const x of Object.values(a.activities || {})) {
    if (!x?.date) continue
    const r = row(x.date.slice(0, 7)); r.acts[x.kind] = (r.acts[x.kind] || 0) + 1
    if ((x.kind === 'mock' || x.kind === 'virtual' || x.kind === 'contest') && x.perf && x.note !== 'voided') r.perf.push(x.perf)
  }
  const probs = a.problems || {}
  // same rules as the server's archive.digest(): a problem counts as solved once, in the month it was first solved;
  // as failed only when it was never solved and has a failed attempt ('tried' = only served), in its last month
  for (const p of Object.values(probs)) {
    const won = (p.attempts || []).filter(t => t.status === 'solved' && t.at).map(t => t.at)
    if (won.length) {
      const r = row(dateKey(new Date(Math.min(...won))).slice(0, 7))
      r.s.add(p.pid); for (const t of p.tags || []) r.tags.set(t, (r.tags.get(t) || 0) + 1)
    } else if (p.status === 'failed' && p.lastAt) row(dateKey(new Date(p.lastAt)).slice(0, 7)).f.add(p.pid)
  }
  return [...rows.entries()].sort((x, y) => x[0] < y[0] ? -1 : 1).map(([m, r]) => {
    const rs = [...r.s].map(pid => probs[pid]?.rating || 0).filter(Boolean)
    return {
      m, acts: r.acts, solved: r.s.size, failed: r.f.size,
      avg_r: rs.length ? Math.round(rs.reduce((x, y) => x + y, 0) / rs.length) : null,
      perf: r.perf.length ? Math.round(r.perf.reduce((x, y) => x + y, 0) / r.perf.length) : null,
      tags: [...r.tags.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 3).map(x => x[0]),
    }
  })
}

export const NEW_PER_DAY = 20
/** today's deck (pids): reviews due (oldest due, most lapses first), then new cards (no srs yet, oldest card first) up to 20 a day */
export function dueCards(a: Pick<ArchiveIndex, 'cards' | 'srs'> | null | undefined, today = dateKey(), newCap = NEW_PER_DAY): string[] {
  if (!a) return []
  const srs = a.srs || {}, cards = a.cards || {}
  const due = Object.keys(cards).filter(pid => srs[pid] && srs[pid].due <= today)
    .sort((x, y) => srs[x].due < srs[y].due ? -1 : srs[x].due > srs[y].due ? 1 : srs[y].lapses - srs[x].lapses || (x < y ? -1 : 1))

  // cards first reviewed today use up today's new-card allowance (`first`; older records: a lone review made today)
  const newToday = Object.values(srs).filter(s => s.first ? s.first === today : !!s.last && dateKey(new Date(s.last)) === today && s.reps + s.lapses === 1).length
  const fresh = Object.keys(cards).filter(pid => !srs[pid]).sort((x, y) => (cards[x].at || 0) - (cards[y].at || 0) || (x < y ? -1 : 1))
    .slice(0, Math.max(0, newCap - newToday))
  return [...due, ...fresh]
}
/** every problem you have not solved, from every round, mock, virtual and practice session (all time, never expires),
 *  newest first: a problem you solved since (anywhere) drops out; voided mocks don't count.
 *  why: failed = a wrong answer on record · tried = opened in the round · skipped = served in practice, not solved ·
 *  code = you wrote code but it never got accepted · untouched = in the round, never opened */
/** code you wrote for a problem of a round that you never submitted: it belongs to that round (History and Upsolve) */
export function roundExtras(x: Pick<Activity, 'kind' | 'contestId' | 'pids'>, code: Set<string>): string[] {
  return x.contestId && x.kind !== 'practice' && x.kind !== 'free' ? [...code].filter(p => splitPid(p)?.c === x.contestId && !x.pids.includes(p)).sort(idxSort) : []
}
export type UpWhy = 'failed' | 'tried' | 'skipped' | 'code' | 'untouched'
export interface Upsolve { pid: string; act: string; kind: ActKind; title: string; date: string; at: number; why: UpWhy }
export function upsolveList(a: Pick<ArchiveIndex, 'activities' | 'problems' | 'links'> | null | undefined): Upsolve[] {
  if (!a) return []
  const code = new Set(Object.values(a.links || {}).map(l => l?.pid).filter(Boolean) as string[])
  const out: Upsolve[] = [], seen = new Set<string>()
  const acts = Object.values(a.activities || {}).filter(x => x.note !== 'voided').sort((x, y) => y.at - x.at || (x.id < y.id ? -1 : 1))
  for (const x of acts) {
    const extra = roundExtras(x, code)
    const order = x.kind === 'mock' || x.kind === 'practice' || x.kind === 'free' ? [...x.pids, ...extra] : [...x.pids, ...extra].sort(idxSort)
    for (const pid of order) {
      const m = a.problems?.[pid]
      if (seen.has(pid) || x.solved.includes(pid) || m?.status === 'solved') continue
      const mine = (m?.attempts || []).filter(t => t.act === x.id)
      const practice = x.kind === 'practice' || x.kind === 'free'
      // a wrong answer anywhere on record makes it 'failed' (it may sit under a later practice session that re-served it)
      const why: UpWhy = (m?.attempts || []).some(t => t.status === 'failed') ? 'failed' : mine.length ? (practice ? 'skipped' : 'tried') : code.has(pid) ? 'code' : practice ? 'skipped' : 'untouched'
      seen.add(pid); out.push({ pid, act: x.id, kind: x.kind, title: x.title, date: x.date, at: x.at, why })
    }
  }
  return out
}
/** the interval (days) a grade would give this card (same SM-2 as the idea bank and the server) */
export function previewIvl(s: Srs | null | undefined, q: Grade) {
  const c = { id: '', pid: '', idea: '', tags: [], created: 0, ef: s?.ef ?? 2.5, ivl: s?.ivl ?? 0, reps: s?.reps ?? 0, lapses: s?.lapses ?? 0, due: s?.due ?? '2000-01-01', u: 0 }
  return schedule(c, q, '2000-01-01', 0).ivl
}

/* ───────── server API ───────── */
async function api<T = Record<string, unknown>>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const cfg = getSyncCfg(); if (!cfg) throw new Error('no-sync')
  const r = await fetch(cfg.url + path, {
    method, headers: { Authorization: 'Bearer ' + cfg.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  })
  const j = await r.json().catch(() => ({})) as T & { error?: string }
  if (!r.ok) throw new Error(j.error || `server ${r.status}`)
  return j
}

/* tiny external store (like useCf) */
type Status = 'off' | 'idle' | 'loading' | 'ok' | 'error'
let archive: ArchiveIndex | null = null, code: CodeScan | null = null, status: Status = getSyncCfg() ? 'idle' : 'off', err: string | undefined
let ver = 0
const subs = new Set<() => void>()
const bump = () => { ver++; subs.forEach(f => f()) }
export const onArchive = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const getArchive = () => archive
export const getCodeScan = () => code
export function useArchive() {
  useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => ver)
  const st: Status = getSyncCfg() ? status : 'off'
  return { archive, index: archive, code, status: st, err, error: err }
}

let pollT: ReturnType<typeof setTimeout> | undefined
/** GET /api/archive into the store; while flashcards are being made, it re-polls every 10 s */
export async function loadArchive(): Promise<ArchiveIndex | null> {
  if (!getSyncCfg()) { status = 'off'; bump(); return null }
  if (!archive) { status = 'loading'; bump() }
  try {
    archive = await api<ArchiveIndex>('GET', '/api/archive'); status = 'ok'; err = undefined
  } catch (e) { status = 'error'; err = e instanceof Error ? e.message : String(e) }
  bump()
  clearTimeout(pollT)
  if (archive && (archive.cardJobs?.running || archive.cardJobs?.queue?.length)) pollT = setTimeout(() => void loadArchive(), 10000)
  return archive
}
export const loadProblem = (pid: string) => api<ProblemDetail>('GET', '/api/archive/problem/' + encodeURIComponent(pid))

const HASH_KEY = 'momentum.archive.hash'
const getHash = () => { try { return localStorage.getItem(HASH_KEY) || '' } catch { return '' } }
const setHash = (h: string) => { try { localStorage.setItem(HASH_KEY, h) } catch { /* ignore */ } }
/** which archive the last send went to: server URL + the archive's creation time + its size. A different server, a
    restored or wiped archive, or a new day forces a full re-send (records pruned locally can't be sent later). */
const archiveIdent = (url: string, createdAt: unknown, nA: number, nP: number) => `${url}|${createdAt ?? ''}|${nA}|${nP}|${dateKey()}`
const contestNameOf = (cid: number) => contestInfo(cid)?.name
/** the ingest payload in pieces under ~3 MB each (the server caps a body at 4 MB) */
export function chunkIngest(p: Ingest, max = 3e6): Ingest[] {
  const n = Math.max(1, Math.ceil(JSON.stringify(p).length / max))
  if (n === 1) return [p]
  const part = <T>(xs: T[], i: number) => xs.slice(Math.floor(xs.length * i / n), Math.floor(xs.length * (i + 1) / n))
  // a `full` activity's attempts must arrive in one request (the server replaces that activity's list with it): they
  // all ride in the first chunk with drop/full, everything else is split evenly
  const fullSet = new Set(p.full), mine = p.attempts.filter(a => a.act && fullSet.has(a.act)), rest = p.attempts.filter(a => !(a.act && fullSet.has(a.act)))
  return Array.from({ length: n }, (_, i) => ({ activities: part(p.activities, i), problems: part(p.problems, i),
    attempts: i === 0 ? [...mine, ...part(rest, i)] : part(rest, i), drop: i === 0 ? p.drop : [], full: i === 0 ? p.full : [] }))
}
let ingestRun: Promise<boolean> | null = null, ingestT: ReturnType<typeof setTimeout> | undefined, ingestWait: ((ok: boolean) => void)[] = [], ingestForce = false
async function doIngest(force: boolean): Promise<boolean> {
  if (!getSyncCfg()) return false
  await cacheReady.catch(() => {})
  if (!hasProblems()) await loadProblems().catch(() => {})
  const payload = buildIngest(getState().cp, getCfUser(), getProbMap(), contestNameOf)
  if (!payload.activities.length && !payload.attempts.length) return true
  const cfg = getSyncCfg()!, h = docHash(payload)
  const ident = archive ? archiveIdent(cfg.url, archive.createdAt, Object.keys(archive.activities || {}).length, Object.keys(archive.problems || {}).length) : ''
  if (!force && ident && ident + '|' + h === getHash()) return true
  let last: { createdAt?: number; nActivities?: number; nProblems?: number } = {}
  for (const c of chunkIngest(payload)) last = await api('POST', '/api/archive/ingest', c)
  setHash(archiveIdent(cfg.url, last.createdAt, last.nActivities ?? 0, last.nProblems ?? 0) + '|' + h)
  return true
}
/** send everything this device knows to the archive (debounced 1 s; skipped when nothing changed since the last success) */
export function ingestNow(force = false): Promise<boolean> {
  return new Promise(res => {
    ingestWait.push(res); ingestForce ||= force
    armIngest()
  })
}
const armIngest = () => { clearTimeout(ingestT); ingestT = setTimeout(fireIngest, 1000) }
/** a call made while a send is running waits for the NEXT send (the one that carries its changes) */
function fireIngest() {
  if (ingestRun) return // re-armed when the running send ends
  const waiters = ingestWait, force = ingestForce
  ingestWait = []; ingestForce = false
  ingestRun = doIngest(force).catch(() => false)
  void ingestRun.then(ok => {
    ingestRun = null
    waiters.forEach(w => w(ok))
    if (ingestWait.length) armIngest()
  })
}
/** scan the code folder, guess each file's problem, and store the guesses as 'auto' links (your own links always win) */
export async function scanAndLink(): Promise<CodeScan | null> {
  if (!getSyncCfg()) return null
  code = await api<CodeScan>('GET', '/api/archive/code'); bump()
  if (!code.ok || !code.files?.length) return code
  await cacheReady.catch(() => {})
  await loadPastContests().catch(() => {})
  const a = archive || await loadArchive()
  const acts = Object.values(a?.activities || {})
  const contests = [...getPastContests(), ...getContests()].map(c => ({ id: c.id, name: c.name }))
  const links = a?.links || {}
  const want = matchCode(code.files, acts, getProbMap(), contests)
    .filter(x => !links[x.path] || (links[x.path].by === 'auto' && links[x.path].pid !== x.pid))
    .map(x => ({ path: x.path, pid: x.pid, by: 'auto' as const }))
  if (want.length) { await api('POST', '/api/archive/link', { links: want }); await loadArchive() }
  // keep the folder organized: file what is linked (the server skips files edited in the last 2 hours)
  if ((archive?.organize ?? true) !== false) {
    const r = await api<OrganizeResult>('POST', '/api/archive/organize', { apply: true }).catch(() => null)
    if (r?.moves?.length) { code = await api<CodeScan>('GET', '/api/archive/code'); await loadArchive(); bump() }
  }
  return code
}
/** file the linked code now (apply) or just show where it would go */
export async function organizeNow(apply = true): Promise<OrganizeResult> {
  const r = await api<OrganizeResult>('POST', '/api/archive/organize', { apply })
  if (apply && r.moves?.length) { code = await api<CodeScan>('GET', '/api/archive/code'); await loadArchive(); bump() }
  return r
}
/** put the latest batch of moves back (this also turns automatic organizing off) */
export async function undoOrganize(): Promise<number> {
  const r = await api<{ undone: number }>('POST', '/api/archive/organize/undo', {})
  code = await api<CodeScan>('GET', '/api/archive/code'); await loadArchive(); bump(); return r.undone || 0
}
export async function setOrganize(on: boolean) { await api('POST', '/api/archive/config', { organize: on }); await loadArchive() }
/** link (pid) or unlink (null) one file by hand */
export async function linkCode(path: string, pid: string | null) {
  await api('POST', '/api/archive/link', { links: [{ path, pid, by: 'user' }] }); await loadArchive()
}
export const linkFile = linkCode
export async function queueCards(pids: string[], force = false): Promise<{ queued: number }> {
  const r = await api<{ queued: number }>('POST', '/api/archive/cards', { pids, force }); await loadArchive(); return { queued: r.queued || 0 }
}
export async function reviewCard(pid: string, grade: Grade, today = dateKey()): Promise<Srs> {
  const r = await api<{ srs: Srs }>('POST', '/api/archive/review', { pid, grade, today })
  if (archive) { archive = { ...archive, srs: { ...archive.srs, [pid]: r.srs } }; bump() }
  return r.srs
}
export async function setCodeDir(dir: string) {
  await api('POST', '/api/archive/config', { codeDir: dir.trim() })
  await loadArchive(); await scanAndLink()
}

/** compact long-term view for the coach payload: the last 24 months (≤ ~3 KB) */
export function archiveForCoach() {
  if (!archive) return undefined
  const months = monthlyDigest(archive).slice(-24)
  let out = { months, code_dir_readable: !!code?.ok }
  while (JSON.stringify(out).length > 3000 && out.months.length > 1) out = { ...out, months: out.months.slice(1) }
  return out
}

/* ───────── startup ───────── */
let started = false
/** after the first sync: ingest + link the code folder, then every 10 min and ~15 s after a session or mock finishes. Never throws. */
export function startArchive() {
  if (started) return; started = true
  const cycle = async () => {
    if (!getSyncCfg()) { if (status !== 'off') { status = 'off'; bump() } return }
    try { await ingestNow(); await loadArchive(); await scanAndLink() } catch (e) { err = e instanceof Error ? e.message : String(e); bump() }
  }
  // what finishing a session / test / CF poll changes, cheaply
  const sig = () => { const cp = getState().cp, u = getCfUser(); return [Object.keys(cp.sessions || {}).length, Object.values(cp.tests || {}).filter(t => t.finishedAt).length, Object.keys(cp.attempts || {}).length, Object.values(cp.attempts || {}).reduce((m, a) => Math.max(m, a.u || 0), 0), u?.lastSubId || 0, cp.handle].join('|') }
  void (async () => {
    try { await firstSync } catch { /* ignore */ }
    let last = sig(), t: ReturnType<typeof setTimeout> | undefined
    const changed = () => { const s = sig(); if (s === last) return; last = s; clearTimeout(t); t = setTimeout(() => void ingestNow().then(ok => { if (ok) void loadArchive() }).catch(() => {}), 15000) }
    try { onAnyChange(changed); onCf(changed) } catch { /* ignore */ }
    setInterval(() => void cycle(), 10 * 60000)
    await cycle()
  })().catch(() => {})
}
