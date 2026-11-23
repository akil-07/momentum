import { useMemo } from 'react'
import { CP_MODES, useStore, type BlockSess, type CpMode } from '../store'
import { MODE_ICON, MODE_LABEL } from '../cpblocks'
import { learningSubs, nextSubs, SUB_BY_ID, subSkillsMemo } from '../curriculum'
import { getProb, TAGS, useCf } from '../cf'
import { useSkill } from '../train'
import { Chips } from './common'

/* ═════════ what a CP practice block runs: mode + its detail (sub-topic / topics / position) ═════════ */

const POS = ['A', 'B', 'C', 'D', 'E', 'F']
const HINT: Record<CpMode, string> = {
  learn: 'A curriculum sub-topic, its own problem ladder', drill: 'Your weakest topics, just above your level', mixed: 'Contest-style problems across topics',
  position: 'Problems at one contest letter of recent rounds', upsolve: 'Problems you missed in mocks / rounds', resolve: 'Spaced re-solves of problems you failed',
  deep: 'One hard problem, no hints for 60 min', free: 'Solve anything on Codeforces — every Accepted counts', warmup: 'Easy problems, fast (~300 below your level)',
  speed: 'Problems you can solve, as fast as you can',
}
/** value undefined = Auto (the app gives the block one of today's planned sessions) */
export function SessionPicker({ value, onChange }: { value?: BlockSess; onChange: (v?: BlockSess) => void }) {
  const cp = useStore(s => s.cp), sk = useSkill(), cf = useCf()
  const subs = useMemo(() => {
    if (value?.mode !== 'learn') return []
    const ss = subSkillsMemo(sk, cp, getProb, cf.problems.length)
    const ids = [...learningSubs(cp), ...nextSubs(sk, cp, ss, 6).map(s => s.id), ...(value.sub ? [value.sub] : [])]
    return [...new Set(ids)].filter(id => SUB_BY_ID.has(id))
  }, [value?.mode, value?.sub, cp.subs, cp.events, sk.level, cf.problems.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const mode = value?.mode ?? 'auto'
  // any change by hand makes the session the student's (never retyped by the app)
  const set = (p: Partial<BlockSess>) => value && onChange(cleanSess({ ...value, ...p, auto: undefined }))
  const tags = value?.tags || []
  return (
    <div className="sess-pick">
      <div className="field-label">Session</div>
      <Chips value={mode} onChange={m => onChange(m === 'auto' ? undefined : { mode: m as CpMode })}
        options={[{ v: 'auto' as const, label: 'Auto', icon: 'auto_awesome' }, ...CP_MODES.map(m => ({ v: m, label: MODE_LABEL[m], icon: MODE_ICON[m] }))]} />
      <p className="small muted">{value ? HINT[value.mode] : "The app gives this block one of today's planned sessions"}</p>
      {value?.mode === 'learn' && <>
        <div className="field-label">Sub-topic</div>
        <Chips value={value.sub || 'auto'} onChange={v => set({ sub: v === 'auto' ? undefined : v })}
          options={[{ v: 'auto', label: 'Auto (current / next)' }, ...subs.map(id => ({ v: id, label: SUB_BY_ID.get(id)!.name + (learningSubs(cp).includes(id) ? ' · learning' : '') }))]} />
      </>}
      {value?.mode === 'drill' && <>
        <div className="field-label">Topics</div>
        <Chips multi value={tags.length ? tags : ['auto']} onChange={v => set({ tags: v === 'auto' ? undefined : tags.includes(v) ? (tags.filter(x => x !== v).length ? tags.filter(x => x !== v) : undefined) : [...tags, v].slice(-4) })}
          options={[{ v: 'auto', label: 'Auto (weakest)' }, ...TAGS.map(t => ({ v: t.tag, label: t.tag }))]} />
      </>}
      {value?.mode === 'position' && <>
        <div className="field-label">Position</div>
        <Chips value={value.pos || 'auto'} onChange={v => set({ pos: v === 'auto' ? undefined : v })}
          options={[{ v: 'auto', label: 'Auto' }, ...POS.map(p => ({ v: p, label: p }))]} />
      </>}
    </div>
  )
}
/** strip undefined detail keys (so an untouched picker compares equal to what the block had) */
export const cleanSess = (v?: BlockSess): BlockSess | undefined => v ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as unknown as BlockSess : undefined
