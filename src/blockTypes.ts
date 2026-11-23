import type { Task } from './store'

/* ═════════ one list of block types and lengths for every block editor (Plan routine, Next 7 days, Focus) ═════════ */
export type BlockKind = NonNullable<Task['k']>
export const BLOCK_TYPES: { v: BlockKind; label: string; icon: string }[] = [
  { v: 'cp_practice', label: 'CP practice', icon: 'code' }, { v: 'cp_mock', label: 'CP mock', icon: 'timer' },
  { v: 'study', label: 'Study', icon: 'school' }, { v: 'other', label: 'Other', icon: 'more_horiz' },
]
/** quick length chips, minutes */
export const LENGTH_PRESETS = [30, 45, 60, 90, 120, 180, 270]
