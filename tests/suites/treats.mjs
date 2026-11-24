// treat jar: 1500 XP AND 12 h of real work since the last treat buy one treat; one at a time; merges across devices
globalThis.document = { addEventListener() {}, visibilityState: 'visible' }; globalThis.addEventListener = () => {}
globalThis.window = { setTimeout: () => 0, clearTimeout() {}, open() {} }
const R = Date, t0 = new R(); t0.setHours(10, 0, 0, 0); let T = t0.getTime()
globalThis.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(T) } static now() { return T } }
const H = 36e5
const mem = new Map([['momentum.device', 'devA']])
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size } }
const S = await import('./store.js')
const clone = x => JSON.parse(JSON.stringify(x))
const check = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n)
S.resetAll(); S.ensureToday()

const start = S.treatAnchor()
check('a fresh state opens the jar at once, counting from now', start?.kind === 'start' && start.at === T && start.xp0 === S.getState().xp)
S.ensureTreatJar()
check('opening twice does not move the start', Object.keys(S.getState().treats).length === 1)

// work from before the jar opened never counts
S.addSpan({ title: 'old', cat: 'deep', start: T - 3 * H, end: T - H })
check('work from before the jar opened does not count', S.treatJar().work === 0)

// lots of XP but little work: not ready (XP alone is never enough)
S.cpBonus('cp:test1', 2000, 'big solve')
T += 2 * H; S.addSpan({ title: 'deep', cat: 'deep', start: T - 2 * H, end: T })
let j = S.treatJar()
check(`2000 XP but 2 h of work is not a treat (xp ${j.xp}, work ${j.work})`, j.xp === S.TREAT_XP && j.work === 120 && !j.ready && S.redeemTreat('cola') === false)

// non-work categories and overlapping timers don't pad the hours
S.addSpan({ title: 'gym', cat: 'health', start: T - 2 * H, end: T })
S.addSpan({ title: 'same stretch, other device', cat: 'study', start: T - 2 * H, end: T })
check('health time and overlapping timers do not add hours', S.treatJar().work === 120)

// 12 h of real work: ready
for (let i = 0; i < 10; i++) { T += H; S.addSpan({ title: 'w' + i, cat: i % 2 ? 'study' : 'deep', start: T - H, end: T }) }
j = S.treatJar()
check(`12 h of work + 1500 XP fills the jar (work ${j.work})`, j.work === S.TREAT_MIN && j.ready)

// only one: redeeming empties it, the surplus does not carry over
check('redeeming works once', S.redeemTreat('  iced coffee ') === true)
j = S.treatJar()
check('the jar is empty again right after', !j.ready && j.xp === 0 && j.work === 0 && j.history.length === 1 && j.history[0].what === 'iced coffee')
check('a second redeem straight away is refused', S.redeemTreat('another') === false && S.treatJar().history.length === 1)

// two devices: a later "start" from a fresh device can't reset the jar; treats from both sides merge
const a = clone(S.getState())
const fresh = clone(a); const t2 = { id: 'start-zzz', kind: 'start', at: T + H, xp0: 0, what: '', u: T + H }
fresh.treats = { [t2.id]: t2 }
const m = S.mergeStates(a, fresh)
check('merge: the treat survives and stays the anchor over a later start', Object.keys(m.treats).length === 3 && S.treatAnchor(m).kind === 'treat')
const noTreats = clone(a); delete noTreats.treats
check('merge: a copy from before the jar existed keeps the jar', Object.keys(S.mergeStates(noTreats, a).treats).length === 2)
