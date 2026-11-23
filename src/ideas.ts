import { addDays, dateKey, getState, setCp, useStore, type IdeaCard } from './store'
import { getProb } from './cf'

/* ═════════ Idea bank: one key observation per problem, SM-2 spaced repetition ═════════
   Cards live in cp.ideas keyed 'i:'+pid; every write stamps u (per-card LWW merge in store.mergeCp).
   Deletes are tombstones (del:true) so they sync; everything below filters them out. */

export type Grade = 0 | 1 | 2 | 3 // Again / Hard / Good / Easy
export const GRADES: { q: Grade; label: string; key: string }[] = [
  { q: 0, label: 'Again', key: '1' }, { q: 1, label: 'Hard', key: '2' }, { q: 2, label: 'Good', key: '3' }, { q: 3, label: 'Easy', key: '4' },
]
const QUALITY = [1, 3, 4, 5] // SM-2 quality per grade
const EF0 = 2.5, EF_MIN = 1.3, IVL_MAX = 365
export const ideaId = (pid: string) => 'i:' + pid
export const live = (c?: IdeaCard): c is IdeaCard => !!c && !c.del

/** pure SM-2 step: the card's schedule after grading q on day `today` (yyyy-mm-dd) */
export function schedule(c: IdeaCard, q: Grade, today = dateKey(), at = Date.now()): IdeaCard {
  const quality = QUALITY[q]
  const ef = Math.max(EF_MIN, +(c.ef + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)).toFixed(3))
  let ivl: number, reps = c.reps + 1, lapses = c.lapses
  if (q === 0) { reps = 0; ivl = 1; lapses++ }
  else if (q === 1) ivl = c.reps === 0 ? 1 : Math.max(c.ivl + 1, Math.round(c.ivl * 1.2)) // hard: slow growth, ef only falls
  else {
    const good = c.reps === 0 ? 1 : c.reps === 1 ? 6 : Math.round(c.ivl * ef)
    ivl = q === 3 ? Math.max(good + 1, Math.round(good * 1.3)) : good // easy: a step past good
  }
  ivl = Math.min(IVL_MAX, Math.max(1, ivl))
  return { ...c, ef, ivl, reps, lapses, due: addDays(today, ivl), last: at, u: at }
}
/** the interval (days) a grade would give, for the button labels */
export const previewIvl = (c: IdeaCard, q: Grade) => schedule(c, q, '2000-01-01', 0).ivl
export const fmtIvl = (d: number) => d < 30 ? `${d}d` : d < 365 ? `${Math.round(d / 30)}mo` : `${+(d / 365).toFixed(1)}y`

const put = (c: IdeaCard) => setCp(cp => ({ ...cp, ideas: { ...cp.ideas, [c.id]: c } }))
export const ideaFor = (pid: string): IdeaCard | undefined => { const c = getState().cp.ideas?.[ideaId(pid)]; return live(c) ? c : undefined }

/** save (or update) the one card for this problem; a fresh card first comes back tomorrow */
export function addIdea(pid: string, idea: string, today = dateKey()) {
  const text = idea.trim().slice(0, 160); if (!text) return
  const id = ideaId(pid), old = getState().cp.ideas?.[id], at = Date.now()
  const tags = getProb(pid)?.t || old?.tags || []
  if (live(old)) { if (old.idea !== text || old.tags.join() !== tags.join()) put({ ...old, idea: text, tags, u: at }); return }
  put({ id, pid, idea: text, tags, created: at, ef: EF0, ivl: 0, reps: 0, lapses: 0, due: addDays(today, 1), u: at })
}
export function editIdea(id: string, idea: string) {
  const c = getState().cp.ideas?.[id], text = idea.trim().slice(0, 160)
  if (live(c) && text && text !== c.idea) put({ ...c, idea: text, u: Date.now() })
}
export function deleteIdea(id: string) { const c = getState().cp.ideas?.[id]; if (live(c)) put({ ...c, del: true, u: Date.now() }) }
export function gradeIdea(id: string, q: Grade, today = dateKey()) { const c = getState().cp.ideas?.[id]; if (live(c)) put(schedule(c, q, today)) }

/* ───────── queries (pure over a cards map; defaults read the store) ───────── */
const cardsOf = (m?: Record<string, IdeaCard>) => Object.values(m ?? getState().cp.ideas ?? {}).filter(live)
/** due cards, oldest due first, then the ones that slip most */
export const dueIdeas = (date = dateKey(), m?: Record<string, IdeaCard>) =>
  cardsOf(m).filter(c => c.due <= date).sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : b.lapses - a.lapses || a.created - b.created)
/** ideas the user keeps re-learning */
export const LEECH = 3
export function ideaStats(date = dateKey(), m?: Record<string, IdeaCard>) {
  const all = cardsOf(m), due = all.filter(c => c.due <= date)
  const next = all.filter(c => c.due > date).map(c => c.due).sort()[0]
  return {
    total: all.length, due: due.length, next, // next due date when nothing is due today
    young: all.filter(c => c.ivl < 21).length, mature: all.filter(c => c.ivl >= 21).length,
    leeches: all.filter(c => c.lapses >= LEECH).sort((a, b) => b.lapses - a.lapses),
    reviewedToday: all.filter(c => c.last && dateKey(new Date(c.last)) === date).length,
  }
}
/** reactive: live cards (newest first), due queue and stats */
export function useIdeas(date = dateKey()) {
  const m = useStore(s => s.cp.ideas)
  const all = cardsOf(m).sort((a, b) => b.created - a.created)
  return { all, due: dueIdeas(date, m), stats: ideaStats(date, m) }
}
/** suggested Today block when cards are due (~30 s per card, 5–15 min) */
export function ideaTaskToday(date = dateKey()): { title: string; dur: number } | null {
  const n = dueIdeas(date).length
  return n ? { title: `Idea review · ${n} card${n > 1 ? 's' : ''}`, dur: Math.min(15, Math.max(5, Math.ceil(n / 2))) } : null
}
