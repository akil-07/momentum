// archive: buildIngest ids / kinds / dedup / handle filter, matchCode (all four heuristics + mtime), monthlyDigest, dueCards, previewIvl, chunkIngest
globalThis.document = { addEventListener() {}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}
globalThis.window = { setTimeout: () => 0, clearTimeout() {}, open() {} }
const mem = new Map([['momentum.device', 'devA']])
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size } }
const S = await import('./store.js'), A = await import('./archive.js')
let ok = 0, bad = 0
const check = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n) }

const H = 18e5, D = 864e5, base = new Date(2026, 9, 5, 10).getTime() // 5 Oct 2026 10:00 local
const k = t => S.dateKey(new Date(t))
const P = (id, n, r, t = ['dp']) => { const m = id.match(/^(\d+)(.+)$/); return { id, c: +m[1], i: m[2], n, r, t, s: 1000 } }
const probs = new Map([
  P('2100A', 'Alpha', 800), P('2100B', 'Beta', 1000), P('2100C', 'Gamma', 1300, ['greedy']), P('1900A', 'Coin Rows', 1200), P('1950C', 'Coin Rows', 1100), P('1960C', 'Coin Rows', 1100),
  P('2150A', 'Rated A', 800), P('2150B', 'Rated B', 1100), P('2160A', 'Virt A', 900), P('2160B', 'Virt B', 1200), P('2170A', 'CfVirt A', 900),
  P('2180A', 'Free A', 1000), P('2180B', 'Free B', 1400), P('2190A', 'Sess A', 1000), P('2190B', 'Sess B', 1200), P('1833A', 'Tagged', 900),
  P('2200A', 'R1136 A', 800), P('2200B1', 'R1136 B1', 1100), P('2201A', 'R1136d1 A', 1500), P('2210C', 'Edu C', 1400),
].map(p => [p.id, p]))
const contests = [
  { id: 2200, name: 'Codeforces Round 1136 (Div. 2)' }, { id: 2201, name: 'Codeforces Round 1136 (Div. 1)' },
  { id: 2210, name: 'Educational Codeforces Round 1136 (Rated for Div. 2)' }, { id: 2211, name: 'Codeforces Round 11360 (Div. 2)' },
]
const cname = cid => contests.find(c => c.id === cid)?.name || ({ 2150: 'Codeforces Round 999 (Div. 2)', 2160: 'Codeforces Round 998 (Div. 2)', 2170: 'Codeforces Round 997 (Div. 3)' })[cid]

/* ── fixture state ── */
const cp = S.emptyCp(); cp.handle = 'Me'
const t1 = base, t2 = base + 3 * D, t3 = base + 5 * D
cp.tests = {
  m1: { id: 'm1', date: k(t1), pids: ['2100A', '2100B', '2100C'], startedAt: t1, dur: 120, finishedAt: t1 + 2 * 36e5, solved: { '2100A': 600, '2100B': 1800 }, perf: 1250, h: 'me' },
  v1: { id: 'v1', date: k(t2), pids: ['2160A', '2160B'], startedAt: t2, dur: 120, finishedAt: t2 + 2 * 36e5, solved: {}, h: 'Me', real: { contestId: 2160, name: 'Codeforces Round 998 (Div. 2)', rule: 'cf', probs: { A: { at: 900, wa: 1 }, B: { wa: 2 } }, rank: 3000, delta: 0, perf: 1300 } },
  live: { id: 'live', date: k(t3), pids: ['2150A', '2150B'], startedAt: t3, dur: 120, finishedAt: t3 + 2 * 36e5, solved: { '2150A': 700 }, h: 'Me', real: { contestId: 2150, name: 'Codeforces Round 999 (Div. 2)', rule: 'cf', probs: {}, live: true, perf: 1400 } },
  other: { id: 'other', date: k(t1), pids: ['2100A'], startedAt: t1, dur: 60, finishedAt: t1 + 36e5, solved: {}, h: 'someoneelse' },
  run: { id: 'run', date: k(Date.now()), pids: ['2100A'], startedAt: Date.now(), dur: 120, solved: {}, h: 'Me' },
}
// m1: 2100C was opened during the mock (an unsolved, never-opened problem is not a try)
cp.events = { e1: { id: 'e1', pid: '2100C', k: 'open', at: t1 + 30 * 60000, h: 'Me' } }
// a mock rerolled after 15 s, and one abandoned (voided) overnight with nothing opened: never sat, both dropped
cp.tests.r1 = { id: 'r1~x', date: k(t2), pids: ['2100A'], startedAt: t2 + 36e5, dur: 120, finishedAt: t2 + 36e5 + 15000, solved: {}, h: 'Me' }
cp.tests.ab = { id: 'ab', date: k(t2), pids: ['2100B'], startedAt: t2 + 5 * 36e5, dur: 120, finishedAt: t2 + 13 * 36e5, solved: {}, h: 'Me' }
cp.triggers = { 'void:ab': 1 }
const s1 = base + 1 * D
cp.sessions = {
  s1: { id: 's1', kind: 'practice', date: k(s1), startedAt: s1, endedAt: s1 + 2 * 36e5, mins: 120, pids: ['2190A', '2190B'], solved: ['2190A'], spec: { mode: 'learn', tags: ['dp', 'greedy', 'math'], lo: 900, hi: 1300, minutes: 120, timebox: 1 }, h: 'Me' },
  sm: { id: 'sm', kind: 'mock', date: k(t1), startedAt: t1, endedAt: t1 + 2 * 36e5, mins: 120, pids: ['2100A'], solved: [], h: 'Me' },
  sx: { id: 'sx', kind: 'practice', date: k(s1), startedAt: s1, endedAt: s1 + 36e5, mins: 60, pids: ['2190A'], solved: [], h: 'other' },
}
const f1 = base + 7 * D
cp.attempts = {
  '2190A': { pid: '2190A', status: 'solved', at: s1 + 20 * 60000, secs: 1200, src: 'practice', u: 1, h: 'Me' },
  '2100A': { pid: '2100A', status: 'solved', at: t1 + 600000, secs: 600, src: 'test', u: 1, h: 'Me' },
  '2180A': { pid: '2180A', status: 'solved', at: f1, secs: 900, src: 'free', u: 1, h: 'Me' },
  '2100C': { pid: '2100C', status: 'solved', at: t1 + 5 * D, src: 'free', u: 1, h: 'other' },
}
let sid = 1
const sub = (pid, at, v, pt, rel = null) => ({ id: sid++, pid, at, v, tn: 1, ms: 1, mem: 1, rel, pt, lang: 'C++', cid: +pid.match(/^\d+/)[0] })
const user = {
  handle: 'me', rating: 1300, maxRating: 1300, rank: 'pupil', fetchedAt: 0, subs: {}, lastSubId: 0,
  rated: [{ cid: 2150, name: 'Codeforces Round 999 (Div. 2)', rank: 4000, old: 1200, new: 1260, at: t3 }],
  list: [
    sub('2150A', t3 + 700000, 'OK', 'CONTESTANT', 700), sub('2150B', t3 + 3600000, 'WRONG_ANSWER', 'CONTESTANT', 3600),
    sub('2160A', t2 + 900000, 'OK', 'VIRTUAL', 900),                              // covered by test v1: no cfv:2160
    sub('2170A', base + 9 * D, 'WRONG_ANSWER', 'VIRTUAL', 300), sub('2170A', base + 9 * D + 600000, 'OK', 'VIRTUAL', 900),
    sub('2190B', s1 + 50 * 60000, 'WRONG_ANSWER', 'PRACTICE'),                      // inside session s1
    sub('2180B', f1 + 36e5, 'OK', 'PRACTICE'), sub('2180B', f1 + 30 * 60000, 'WRONG_ANSWER', 'PRACTICE'),
    sub('2100C', t1 + 4 * 36e5, 'OK', 'PRACTICE'),                                 // upsolve of the mock the same day
    sub('9999A', base, 'OK', 'PRACTICE'),                                          // unknown problem: still a valid pid
    sub('100001A', base, 'OK', 'PRACTICE'),                                        // gym-ish id: dropped by the pid rule
  ],
}

/* ── 1. buildIngest ── */
{ const g = A.buildIngest(cp, user, probs, cname), by = Object.fromEntries(g.activities.map(a => [a.id, a]))
  check('ingest: a finished app mock is test:<id> kind mock, titled with its date', by['test:m1']?.kind === 'mock' && by['test:m1'].title === `Mock · ${k(t1)}` && by['test:m1'].perf === 1250 && by['test:m1'].solved.join() === '2100A,2100B')
  check('ingest: a real-round test is a virtual with the round title, rank, perf', by['test:v1']?.kind === 'virtual' && by['test:v1'].title === 'Virtual · Codeforces Round 998 (Div. 2)' && by['test:v1'].contestId === 2160 && by['test:v1'].perf === 1300 && by['test:v1'].solved.join() === '2160A')
  check('ingest: a VIRTUAL CF participation already covered by a real-round test is not repeated', !by['cfv:2160'])
  check('ingest: an uncovered VIRTUAL participation is cfv:<cid>', by['cfv:2170']?.kind === 'virtual' && by['cfv:2170'].solved.join() === '2170A' && by['cfv:2170'].title === 'Virtual · Codeforces Round 997 (Div. 3)')
  check('ingest: a rated round is cf:<cid> kind contest with rank and delta from the rating history', by['cf:2150']?.kind === 'contest' && by['cf:2150'].rank === 4000 && by['cf:2150'].delta === 60 && by['cf:2150'].title === 'Codeforces Round 999 (Div. 2)' && by['cf:2150'].pids.join() === '2150A,2150B' && by['cf:2150'].solved.join() === '2150A')
  check('ingest: a live-round test merges into that round (no test:live)', !by['test:live'] && by['cf:2150'].perf === 1400 && by['cf:2150'].mins === 120)
  check('ingest: a practice session is sess:<id> titled mode + 2 tags', by['sess:s1']?.kind === 'practice' && by['sess:s1'].title === 'Practice · learn · dp · greedy' && by['sess:s1'].mode === 'learn' && by['sess:s1'].mins === 120)
  check('ingest: mock-kind sessions (duplicates of tests) are skipped', !by['sess:sm'])
  check('ingest: another handle\'s tests, sessions and attempts are left out', !by['test:other'] && !by['sess:sx'] && !g.attempts.some(a => a.pid === '2100C' && a.src === 'free'))
  check('ingest: an unfinished test is not an activity yet', !by['test:run'])
  const fr = by['free:' + k(f1)]
  check('ingest: free:<date> collects app free attempts and practice subs outside sessions', fr?.kind === 'free' && fr.title === 'Free solves' && fr.pids.join() === '2180A,2180B' && fr.solved.join() === '2180A,2180B')
  check('ingest: a practice sub inside a session joins that session', by['sess:s1'].pids.includes('2190B') && !Object.values(by).some(a => a.kind === 'free' && a.pids.includes('2190B')))
  check('ingest: an upsolve of a problem in another activity that day is not a free solve', !by['free:' + k(t1)] || !by['free:' + k(t1)].pids.includes('2100C'))
  check('ingest: the upsolve still leaves an attempt record (no activity)', g.attempts.some(a => a.pid === '2100C' && a.src === 'cf' && a.status === 'solved' && !a.act))
  check('ingest: ids are unique', new Set(g.activities.map(a => a.id)).size === g.activities.length)
  check('ingest: invalid pids are dropped everywhere', !JSON.stringify(g).includes('100001A') && g.problems.some(p => p.pid === '9999A' && p.name === '' && p.contestId === 9999 && p.index === 'A'))
  const att = (pid, src) => g.attempts.filter(a => a.pid === pid && a.src === src)
  check('ingest: mock attempts come from the test (solved with secs, opened but unsolved = tried)', att('2100A', 'test').length === 1 && att('2100A', 'test')[0].secs === 600 && att('2100A', 'test')[0].at === t1 + 600000 && att('2100C', 'test')[0].status === 'tried' && att('2100A', 'test')[0].act === 'test:m1')
  check('ingest: virtual attempts use the round\'s per-index results (wa → failed)', att('2160A', 'test')[0]?.secs === 900 && att('2160B', 'test')[0]?.status === 'failed' && !att('2160A', 'cf').length)
  check('ingest: an app practice attempt is linked to its session and not repeated by CF', att('2190A', 'practice')[0]?.act === 'sess:s1' && !att('2190A', 'cf').length)
  check('ingest: a served-but-unsolved session problem with only a WA is one CF attempt (failed)', att('2190B', 'cf').length === 1 && att('2190B', 'cf')[0].status === 'failed' && att('2190B', 'practice')[0]?.status === 'tried')
  check('ingest: one CF attempt per problem per participation, at its first submission', att('2180B', 'cf').length === 1 && att('2180B', 'cf')[0].at === f1 + 30 * 60000 && att('2180B', 'cf')[0].status === 'solved' && att('2170A', 'cf').length === 1 && att('2170A', 'cf')[0].secs === 900)
  check('ingest: a mock rerolled after seconds and a voided one with nothing done are dropped, not archived',
    !by['test:r1~x'] && !by['test:ab'] && g.drop.includes('test:r1~x') && g.drop.includes('test:ab'))
  check('ingest: a sat mock and sessions are sent in full (the server replaces their stale attempts)', g.full.includes('test:m1') && g.full.includes('sess:s1') && !g.full.includes('test:ab'))
  // a device without (this handle's) CF submissions cannot judge a window: it merges, never sends in full or drops
  const g0 = A.buildIngest(cp, null, probs, cname), g1 = A.buildIngest(cp, { ...user, handle: 'someoneelse' }, probs, cname)
  check('ingest: no CF data (or another handle) means no full and no drop', !g0.full.length && !g0.drop.length && !g1.full.length && !g1.drop.length)
  check('ingest: an unsolved problem never opened in a mock gets no attempt', !g.attempts.some(a => a.act === 'test:m1' && a.pid === '2100B' && a.status !== 'solved'))
  { const ix = { activities: by, problems: Object.fromEntries(g.problems.map(p => [p.pid, { ...p, attempts: g.attempts.filter(a => a.pid === p.pid), status: g.attempts.some(a => a.pid === p.pid && a.status === 'solved') ? 'solved' : 'tried' }])), links: {} }
    const ups = A.upsolveList(ix), u = Object.fromEntries(ups.map(x => [x.pid, x]))
    check('upsolve: a WA in a round is listed, one you solved since is not', u['2150B']?.why === 'failed' && !u['2100C'] && u['2160B']?.why === 'failed')
    check('upsolve: newest round first', ups.findIndex(x => x.pid === '2150B') < ups.findIndex(x => x.pid === '2160B'))
    check('upsolve: unsolved practice problems are listed too', u['2190B']?.kind === 'practice') }
  { const mk = (id, kind, pids, solved = [], at = 1) => ({ id, kind, date: '2026-11-0' + at, at, title: id, pids, solved })
    const ix = { activities: { a: mk('a', 'mock', ['1A', '1B', '1C'], ['1A']), b: mk('b', 'practice', ['2A', '2B'], [], 2), v: { ...mk('v', 'mock', ['3A']), note: 'voided' } },
      problems: { '1B': { attempts: [{ act: 'a', status: 'tried' }] }, '2A': { attempts: [{ act: 'b', status: 'tried' }] }, '1A': { status: 'solved', attempts: [] } }, links: { 'x.cpp': { pid: '1C' } } }
    const u = Object.fromEntries(A.upsolveList(ix).map(x => [x.pid, x.why]))
    check('upsolve: every unsolved problem with its reason (opened / code / skipped / never opened), voided mocks left out',
      u['1B'] === 'tried' && u['1C'] === 'code' && u['2A'] === 'skipped' && u['2B'] === 'skipped' && !u['1A'] && !u['3A']) }
  check('ingest: problems carry the problemset meta', g.problems.find(p => p.pid === '2100C')?.rating === 1300 && g.problems.find(p => p.pid === '2100C').tags[0] === 'greedy' && g.problems.find(p => p.pid === '2200B1') === undefined)
  const g2 = A.buildIngest(JSON.parse(JSON.stringify(cp)), JSON.parse(JSON.stringify(user)), probs, cname)
  check('ingest: deterministic (same input → same payload, so the hash skip works)', JSON.stringify(g) === JSON.stringify(g2))
  const noUser = A.buildIngest(cp, { ...user, handle: 'someoneelse' }, probs, cname)
  check('ingest: a CF history of another handle is ignored', !noUser.activities.some(a => a.id.startsWith('cfv') || a.pids.includes('2180B')) && !noUser.activities.find(a => a.id === 'cf:2150')?.rank && !noUser.attempts.some(a => a.src === 'cf'))
  check('ingest: voided mocks are kept with a note', A.buildIngest({ ...cp, triggers: { 'void:m1': 1 } }, user, probs, cname).activities.find(a => a.id === 'test:m1')?.note === 'voided')
  const ch = A.chunkIngest(g, 500)
  check('chunkIngest: splits big payloads without losing records', ch.length > 1 && ch.flatMap(c => c.activities).length === g.activities.length && ch.flatMap(c => c.attempts).length === g.attempts.length && ch.flatMap(c => c.problems).length === g.problems.length) }

/* ── 2. matchCode ── */
{ const acts = [
    { id: 'test:m1', kind: 'mock', date: k(t1), at: t1, end: t1 + 2 * 36e5, title: 'Mock', pids: ['2100A', '2100B', '2100C'], solved: [] },
    { id: 'test:m2', kind: 'mock', date: k(t1 + D), at: t1 + D, end: t1 + D + 2 * 36e5, title: 'Mock', pids: ['2180A', '2180B'], solved: [] },
    { id: 'test:v1', kind: 'virtual', date: k(t2), at: t2, end: t2 + 2 * 36e5, title: 'Virtual', pids: ['2160A', '2160B'], solved: [], contestId: 2160 },
    { id: 'sess:x', kind: 'practice', date: k(s1), at: s1, title: 'P', pids: ['1950C'], solved: [] },
  ]
  const f = (path, mtime = 0, head = '#include <bits/stdc++.h>\nusing namespace std;\nint main(){int n=1000;}') => ({ path, mtime, head, size: 1 })
  const m = files => Object.fromEntries(A.matchCode(files, acts, probs, contests).map(x => [x.path, x.pid]))
  const r = m([
    f('misc/x.cpp', 0, '// CF 1833A tagged\n#include <bits/stdc++.h>'), f('misc/y.cpp', 0, '// 1833 A\n'), f('misc/z.cpp', 0, '// 4000Z not a problem\n'),
    f('Contests/1136 (Div 2)/A.cpp'), f('Contests/1136 (Div 2)/B1.cpp'), f('Contests/1136 (Div1)/A.cpp'), f('Contests/1136 (Edu)/C.cpp'),
    f('Mock Rounds/1/B.cpp', t1 + 36e5), f('Mock Rounds/1/C.cpp', t1 + 30 * 60000), f('Mock Rounds/1/A.cpp', t2 + 3 * 36e5), f('Mock Rounds/4/C.cpp', t2 + 3 * 36e5), f('Mock Rounds/2/B.cpp', 5), f('Mock Rounds/3/B.cpp', 5), f('Mock Rounds/9/A.cpp', 5),
    f('Daily/21-11-2026/Learn/C. Coin Rows.cpp'), f('Daily/21-11-2026/Learn/A. Coin Rows.cpp'), f('Daily/x/B.  beta .cpp'), f('Daily/x/C. Unknown Thing.cpp'), f('notes/readme.cpp'),
  ])
  check('matchCode 1: an id in the head wins (only for existing problems)', r['misc/x.cpp'] === '1833A' && r['misc/y.cpp'] === '1833A' && !('misc/z.cpp' in r))
  check('matchCode 1: "int n=1000;" in code is not an id', !('notes/readme.cpp' in r))
  check('matchCode 2: Contests/<round>/<IDX> resolves the round number + division to the contest id', r['Contests/1136 (Div 2)/A.cpp'] === '2200A' && r['Contests/1136 (Div 2)/B1.cpp'] === '2200B1')
  check('matchCode 2: the Div in the folder name picks the right half of a split round; "Edu" picks the Educational one', r['Contests/1136 (Div1)/A.cpp'] === '2201A' && r['Contests/1136 (Edu)/C.cpp'] === '2210C')
  check('matchCode 3: a mock file maps by position inside the mock running at its mtime', r['Mock Rounds/1/B.cpp'] === '2100B')
  check('matchCode 3: mtime beats the folder number (a virtual maps by index)', r['Mock Rounds/4/C.cpp'] === '2160C' && r['Mock Rounds/2/B.cpp'] === '2180B' && r['Mock Rounds/3/B.cpp'] === '2160B')
  check('matchCode 3: a folder is one sitting: a stray mtime is outvoted by the rest of the folder', r['Mock Rounds/1/A.cpp'] === '2100A' && r['Mock Rounds/1/C.cpp'] === '2100C')
  const r2 = m([f('Mock Rounds/1/A.cpp', t2 + 36e5)])
  check('matchCode 3: a virtual found by mtime maps by problem index', r2['Mock Rounds/1/A.cpp'] === '2160A')
  check('matchCode 3: no such mock → unmatched', !('Mock Rounds/9/A.cpp' in r))
  check('matchCode 4: "<IDX>. <Name>" matches index + name, preferring problems you attempted', r['Daily/21-11-2026/Learn/C. Coin Rows.cpp'] === '1950C' && r['Daily/21-11-2026/Learn/A. Coin Rows.cpp'] === '1900A')
  check('matchCode 4: case / spacing insensitive; unknown names omitted', r['Daily/x/B.  beta .cpp'] === '2100B' && !('Daily/x/C. Unknown Thing.cpp' in r))
  check('matchCode: an organized file is matched by the id its name starts with', m([f('Virtual/2026-11-23 Round/2160B Virt B (2).cpp'), f('Practice/2026-11-21/2190A Sess A.cpp')])['Practice/2026-11-21/2190A Sess A.cpp'] === '2190A'
    && m([f('Virtual/2026-11-23 Round/2160B Virt B (2).cpp')])['Virtual/2026-11-23 Round/2160B Virt B (2).cpp'] === '2160B')
  const div2 = A.matchCode([f('Contests/1137 (Div2)/A.cpp')], [], probs, [{ id: 2250, name: 'Codeforces Round 1137 (Div. 2)' }])
  check('matchCode 2: "(Div2)" without a space works too', div2[0]?.pid === '2250A') }

/* ── 3. monthlyDigest / dueCards / previewIvl ── */
{ const oct = new Date(2026, 9, 10).getTime(), nov = new Date(2026, 10, 3).getTime()
  const ix = {
    activities: {
      a: { id: 'a', kind: 'mock', date: '2026-10-10', at: oct, title: '', pids: [], solved: [], perf: 1200 },
      b: { id: 'b', kind: 'mock', date: '2026-10-12', at: oct, title: '', pids: [], solved: [], perf: 1400 },
      c: { id: 'c', kind: 'practice', date: '2026-10-12', at: oct, title: '', pids: [], solved: [] },
      d: { id: 'd', kind: 'contest', date: '2026-11-03', at: nov, title: '', pids: [], solved: [] },
      e: { id: 'e', kind: 'mock', date: '2026-11-04', at: nov, title: '', pids: [], solved: [], perf: 2000, note: 'voided' },
    },
    problems: {
      '2100A': { pid: '2100A', name: '', rating: 800, tags: ['dp', 'math'], contestId: 2100, index: 'A', firstAt: oct, lastAt: nov, status: 'solved', attempts: [{ at: oct, status: 'failed', src: 'test' }, { at: oct + 36e5, status: 'solved', src: 'cf' }, { at: nov, status: 'failed', src: 'practice' }] },
      '2100B': { pid: '2100B', name: '', rating: 1200, tags: ['dp'], contestId: 2100, index: 'B', firstAt: oct, lastAt: oct, status: 'solved', attempts: [{ at: oct, status: 'solved', src: 'test' }] },
      '2100C': { pid: '2100C', name: '', rating: 1500, tags: ['greedy'], contestId: 2100, index: 'C', firstAt: oct, lastAt: oct, status: 'tried', attempts: [{ at: oct, status: 'tried', src: 'test' }] },
      '2100D': { pid: '2100D', name: '', rating: 1900, tags: ['graphs'], contestId: 2100, index: 'D', firstAt: nov, lastAt: nov, status: 'failed', attempts: [{ at: nov, status: 'failed', src: 'cf' }] },
    },
  }
  const md = A.monthlyDigest(ix)
  check('monthlyDigest: one row per month, oldest first', md.map(x => x.m).join() === '2026-10,2026-11')
  check('monthlyDigest: activities by kind; solved once in its first-solved month, failed only when never solved (tried ignored)', md[0].acts.mock === 2 && md[0].acts.practice === 1 && md[0].solved === 2 && md[0].failed === 0 && md[1].acts.contest === 1 && md[1].solved === 0 && md[1].failed === 1)
  check('monthlyDigest: mean rating solved, mean mock perf (voided ignored), top tags', md[0].avg_r === 1000 && md[0].perf === 1300 && md[1].perf === null && md[0].tags[0] === 'dp')
  check('monthlyDigest: empty / missing archive → []', A.monthlyDigest(null).length === 0 && A.monthlyDigest({ activities: {}, problems: {} }).length === 0)

  const today = '2026-11-24'
  const cards = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`${2300 + i}A`, { at: 1000 + i, key_idea: '' }]))
  const srs = {
    '2300A': { ef: 2.5, ivl: 3, reps: 2, lapses: 0, due: '2026-11-20' }, '2301A': { ef: 2.5, ivl: 3, reps: 2, lapses: 2, due: '2026-11-20' },
    '2302A': { ef: 2.5, ivl: 3, reps: 2, lapses: 0, due: '2026-11-10' }, '2303A': { ef: 2.5, ivl: 3, reps: 2, lapses: 0, due: '2026-11-30' },
  }
  const due = A.dueCards({ cards, srs }, today)
  check('dueCards: due reviews first (oldest due, most lapses), future ones left out', due.slice(0, 3).join() === '2302A,2301A,2300A' && !due.includes('2303A'))
  check('dueCards: new cards (no srs) are due, capped at 20 a day, oldest card first', due.length === 23 && due[3] === '2304A')
  const doneNew = { ...srs, '2304A': { ef: 2.5, ivl: 1, reps: 1, lapses: 0, due: '2026-11-25', last: new Date(2026, 10, 24, 9).getTime() } }
  check('dueCards: new cards graded today use up the allowance', A.dueCards({ cards, srs: doneNew }, today).filter(p => !doneNew[p]).length === 19)
  check('dueCards: no archive → []', A.dueCards(null, today).length === 0)
  check('previewIvl: new card 1/1/1/2 days, a learned card grows', [0, 1, 2, 3].map(q => A.previewIvl(null, q)).join() === '1,1,1,2' && A.previewIvl({ ef: 2.5, ivl: 6, reps: 2, lapses: 0, due: today }, 2) === 15) }

/* ── topics for the card list ── */
{
  check('topicOf: the most specific Codeforces tag wins', A.topicOf(['implementation', 'greedy', 'dp']) === 'dp' && A.topicOf(['math', 'number theory']) === 'number theory' && A.topicOf(['implementation', 'strings']) === 'strings')
  check('topicOf: unknown tags, *special, card tags, other', A.topicOf(['*special', 'expression parsing']) === 'expression parsing' && A.topicOf([], ['sweep line']) === 'sweep line' && A.topicOf(undefined) === 'other')
  check('topicLabel: friendly names, fallback capitalised', A.topicLabel('dp') === 'Dynamic programming' && A.topicLabel('expression parsing') === 'Expression parsing')
}

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
