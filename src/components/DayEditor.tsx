import { AnimatePresence, motion } from 'motion/react'
import { contestFor } from '../contests'
import { useEffect, useState } from 'react'
import { addItem, CATS, dateKey, deleteItem, editItem, fmtMin, isMine, mergeItems, mergePreview, splitItem, toast, toMin, useStore, type BlockSess, type Cat, type Task } from '../store'
import { cpLabel, GENERIC_RE, MODE_ICON, retitle } from '../cpblocks'
import { SessionPicker } from './SessionPicker'
import { Btn, Chips, Field, Sheet, spring } from './common'
import { Icon } from './fx'
import { BLOCK_TYPES, LENGTH_PRESETS, type BlockKind } from '../blockTypes'
import { ANY_TIME, confirmAsk, fmtDay, fmtDur } from '../ui'
import '../styles/dayeditor.css'

/* ═════════ hand-edit one day of the next 7: tap a row to edit, + Add, Select → Merge / Split ═════════ */

type K = BlockKind
const isCp = (t: Pick<Task, 'k'>) => t.k === 'cp_practice' || t.k === 'cp_mock'
const byStart = (a: Task, b: Task) => (a.start ? toMin(a.start) : 9999) - (b.start ? toMin(b.start) : 9999)
const span = (t: Pick<Task, 'start' | 'dur'>) => t.start ? `${t.start}–${fmtMin(toMin(t.start) + t.dur)}` : ANY_TIME

export function DayList({ date, tasks }: { date: string; tasks: Task[] }) {
  const [sel, setSel] = useState<string[] | null>(null)
  const [edit, setEdit] = useState<Task | 'new' | null>(null)
  const [parts, setParts] = useState<2 | 3 | 4 | null>(null)
  const [mcp, setMcp] = useState(0) // the merged block's session: index into merge.sessions
  useStore(s => s.agenda) // re-render when the agenda changes (the merge preview reads it)
  useEffect(() => { setSel(null); setParts(null) }, [date])
  useEffect(() => { setMcp(0) }, [sel?.join()])
  const list = tasks.slice().sort(byStart)
  const picked = list.filter(t => sel?.includes(t.id))
  const doneSel = picked.some(t => t.done)
  const merge = sel && picked.length >= 2 && !doneSel ? mergePreview(date, sel) : null
  const covered = merge?.start ? list.filter(t => !sel!.includes(t.id) && t.start && toMin(t.start) < toMin(merge.start!) + merge.dur && toMin(t.start) + t.dur > toMin(merge.start!)).length : 0
  const one = picked.length === 1 && !picked[0].done ? picked[0] : null
  const cp = list.filter(isCp).reduce((a, t) => a + t.dur, 0)
  const isToday = date === dateKey()
  const toggle = (id: string) => { setParts(null); setSel(s => s ? (s.includes(id) ? s.filter(x => x !== id) : [...s, id]) : s) }
  const tap = (t: Task) => {
    if (sel) return toggle(t.id)
    if (t.done) return toast('Done blocks stay as they were — undo it in Today to change it', 'lock')
    setEdit(t)
  }
  const doMerge = () => { if (!sel) return; const id = mergeItems(date, sel, merge?.sessions[mcp]); if (id) { toast(`Merged into one ${fmtDur(merge!.dur)} block`, 'call_merge'); setSel(null) } }
  const doSplit = (n: 2 | 3 | 4) => { if (!one) return; const ids = splitItem(date, one.id, n); if (ids.length) { toast(`Split into ${n} blocks`, 'call_split'); setSel(null); setParts(null) } }

  return (
    <div className="dayed">
      <div className="dayed-bar">
        <span className="small muted grow">{isToday ? 'Today' : fmtDay(date, true)} · CP {fmtDur(cp)}</span>
        {!sel && <Btn kind="text" size="sm" icon="add" onClick={() => setEdit('new')}>Add</Btn>}
        <Btn kind={sel ? 'tonal' : 'text'} size="sm" icon={sel ? 'close' : 'checklist'} onClick={() => { setSel(s => s ? null : []); setParts(null) }}>{sel ? 'Cancel' : 'Select'}</Btn>
      </div>
      <AnimatePresence mode="wait">
        <motion.ul key={date} className="day-tasks dayed-list" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
          {list.map(t => {
            const on = !!sel?.includes(t.id)
            return (
              <li key={t.id} className={(t.done ? 'done ' : '') + (on ? 'sel ' : '') + 'tap'} onClick={() => tap(t)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(t) } }}>
                {sel && <Icon n={on ? 'check_box' : 'check_box_outline_blank'} fill={on} />}
                <span className="t-time">{span(t)}</span>
                <span className="grow dayed-title">
                  <span className="dayed-name">{t.title}</span>
                  <span className="dayed-tags">
                    {isCp(t) && !t.cp && <span className="chip mini on">{t.k === 'cp_mock' ? (contestFor(t) ? 'contest' : 'mock') : 'CP'}</span>}
                    {t.k === 'cp_practice' && t.cp && <span className="chip mini on" title="What the play button runs"><Icon n={MODE_ICON[t.cp.mode]} /> {cpLabel(t.cp)}</span>}
                    {isMine(t) ? <span className="chip mini you"><Icon n="edit" /> you</span> : t.ai ? <span className="chip mini tert"><Icon n="auto_awesome" /> planned</span> : null}
                  </span>
                </span>
                <span className="muted small dayed-dur"><Icon n={CATS[t.cat].icon} /> {fmtDur(t.dur)}</span>
              </li>
            )
          })}
          {!list.length && <li className="muted small">Nothing planned yet — tap Add.</li>}
        </motion.ul>
      </AnimatePresence>
      <AnimatePresence>
        {sel && (
          <motion.div className="dayed-actions" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={spring}>
            {!picked.length && <p className="small muted">Tap blocks to select them. Merge two or more into one, or split one into equal parts.</p>}
            {doneSel && <p className="small muted"><Icon n="lock" /> A done block can't be merged or split — unselect it.</p>}
            {merge && <p className="small"><Icon n="call_merge" /> One block: <b>{merge.title}</b> · {span(merge)} · {fmtDur(merge.dur)}{merge.k === 'cp_practice' ? ' · CP practice' : merge.k === 'cp_mock' ? ' · CP mock' : ''}{merge.mixed ? <span className="muted"> · includes a mock, so it stays a mock (change its Type after to make it practice)</span> : null}{covered ? <span className="muted"> · overlaps {covered} other block{covered > 1 ? 's' : ''}</span> : null}</p>}
            {merge && merge.sessions.length > 1 && <><p className="small muted">Session of the merged block:</p><Chips value={mcp} onChange={setMcp} options={merge.sessions.map((x, i) => ({ v: i, label: cpLabel(x), icon: MODE_ICON[x.mode] }))} /></>}
            {merge && merge.sessions.length === 1 && <p className="small muted"><Icon n={MODE_ICON[merge.sessions[0].mode]} /> Runs {cpLabel(merge.sessions[0])}</p>}
            {parts && one && <p className="small"><Icon n="call_split" /> {parts} × {fmtDur(Math.floor(one.dur / parts))}{one.start ? ` from ${one.start}` : ''}</p>}
            <div className="row wrap">
              <Btn size="sm" icon="call_merge" disabled={!merge} onClick={doMerge}>Merge{picked.length ? ` (${picked.length})` : ''}</Btn>
              {one && !parts && <Btn kind="tonal" size="sm" icon="call_split" disabled={one.dur < 10} onClick={() => setParts(2)}>Split</Btn>}
              {one && parts && <>
                <Chips value={parts} onChange={v => setParts(v)} options={([2, 3, 4] as const).filter(n => one.dur >= n * 5).map(n => ({ v: n, label: `${n} parts` }))} />
                <Btn kind="tonal" size="sm" icon="check" onClick={() => doSplit(parts)}>Split in {parts}</Btn>
              </>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ItemSheet date={date} item={edit} onClose={() => setEdit(null)} />
    </div>
  )
}

function ItemSheet({ date, item, onClose }: { date: string; item: Task | 'new' | null; onClose: () => void }) {
  const t = item && item !== 'new' ? item : null
  const [title, setTitle] = useState(''), [start, setStart] = useState(''), [dur, setDur] = useState(90), [cat, setCat] = useState<Cat>('deep'), [k, setK] = useState<K>('cp_practice'), [kSet, setKSet] = useState(false)
  const [cp, setCp] = useState<BlockSess | undefined>(undefined), [cpSet, setCpSet] = useState(false)
  useEffect(() => {
    if (!item) return
    setKSet(false); setCpSet(false)
    if (t) { setTitle(t.title); setStart(t.start || ''); setDur(t.dur); setCat(t.cat); setK(t.k && t.k !== 'coach' ? t.k : t.cat === 'study' ? 'study' : 'other'); setCp(t.cp) }
    else { setTitle('CP practice'); setStart(''); setDur(90); setCat('deep'); setK('cp_practice'); setCp(undefined) }
  }, [item]) // eslint-disable-line react-hooks/exhaustive-deps
  // a generic title follows the session ("CP practice" → "CP · Learn: 0-1 knapsack")
  const pickSess = (v?: BlockSess) => { setCp(v); setCpSet(true); if (v && GENERIC_RE.test(title)) setTitle(retitle(title, v)) }
  const pickType = (v: K) => { setK(v); setKSet(true); if (v === 'cp_practice' || v === 'cp_mock') setCat('deep'); if (v === 'study' && cat === 'deep') setCat('study') }
  const ok = title.trim().length > 0 && dur >= 5
  const end = start ? toMin(start) + dur : 0
  const save = () => {
    if (!ok) return
    const kk = t && !kSet ? t.k : k // an untouched Type chip keeps what the item has (a coach todo stays one)
    // an untouched Session picker keeps what the block has (an app-assigned session stays retypable)
    const fields = { title: title.trim(), start: start || null, dur, cat, k: kk }
    if (t) editItem(date, t.id, { ...fields, ...(cpSet ? { cp: kk === 'cp_practice' ? cp ?? null : null } : {}) }); else addItem(date, { ...fields, ...(kk === 'cp_practice' && cp ? { cp } : {}) })
    onClose()
  }
  const when = date === dateKey() ? 'today' : fmtDay(date)
  return (
    <Sheet open={!!item} onClose={onClose} title={t ? 'Edit block' : `Add to ${when}`} actions={<>
      {t && <Btn kind="text" icon="delete" className="danger" onClick={async () => { if (await confirmAsk({ title: `Delete “${t.title}”?`, body: t.tpl ? `Only ${when} — your weekly routine keeps it.` : undefined, ok: 'Delete', danger: true })) { deleteItem(date, t.id); onClose() } }}>Delete</Btn>}
      <span className="grow" /><Btn kind="text" onClick={onClose}>Cancel</Btn>
      <Btn icon="check" disabled={!ok} onClick={save}>Save</Btn>
    </>}>
      <form className="form" onSubmit={e => { e.preventDefault(); save() }}>
        <Field label="Block"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. CP practice" /></Field>
        <div className="field-label">Type</div>
        <Chips value={k} onChange={pickType} options={BLOCK_TYPES} />
        {k === 'cp_practice' && <SessionPicker value={cp} onChange={pickSess} />}
        <div className="row two">
          <Field label={`Start (empty = ${ANY_TIME})`}><input type="time" value={start} onChange={e => setStart(e.target.value)} /></Field>
          <Field label="Minutes"><input type="number" min={5} max={720} step={5} value={dur} onChange={e => setDur(Math.max(5, Math.min(720, Math.round(+e.target.value || 5))))} /></Field>
        </div>
        <Chips value={dur} onChange={setDur} options={LENGTH_PRESETS.map(v => ({ v, label: fmtDur(v) }))} />
        {start && <p className="small muted">{start}–{fmtMin(end)}{end > 24 * 60 ? ' · runs past midnight' : ''}</p>}
        <div className="field-label">Category</div>
        <Chips value={cat} onChange={setCat} options={(Object.keys(CATS) as Cat[]).map(v => ({ v, label: CATS[v].label, icon: CATS[v].icon }))} />
        <p className="muted small"><Icon n="info" /> {t?.tpl && date !== dateKey() ? `Changes only ${when} — your weekly routine stays as it is. ` : ''}Your edits are pinned: the planner plans around them and never moves them.</p>
      </form>
    </Sheet>
  )
}
