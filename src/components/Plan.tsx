import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { CATS, dateKey, deleteBlock, deleteGoal, fmtMin, saveBlock, saveGoal, toMin, uid, useStore, type Block, type Cat, type Goal } from '../store'
import { BLOCK_TYPES, LENGTH_PRESETS } from '../blockTypes'
import { confirmAsk, fmtDay, fmtDur } from '../ui'
import { Seg } from './Seg'
import '../styles/plan.css'
import { Upcoming } from './Upcoming'
import { SessionPicker } from './SessionPicker'
import { GENERIC_RE, retitle } from '../cpblocks'
import { Btn, Chips, Field, IconBtn, Sheet } from './common'
import { Icon } from './fx'
import { Shape } from './shapes'

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const tone = (c: Cat) => `var(--${CATS[c].tone === 'neutral' ? 'outline' : CATS[c].tone})`

export function Plan() {
  const template = useStore(s => s.template), goals = useStore(s => s.goals), threshold = useStore(s => s.settings.threshold)
  const [wd, setWd] = useState(new Date().getDay())
  const [edit, setEdit] = useState<Block | null>(null)
  const [goal, setGoal] = useState<Goal | null>(null)
  const [view, setView] = useState<'upcoming' | 'routine'>('upcoming')
  const today = dateKey()
  const blocks = template.filter(b => b.days.includes(wd) && (!b.until || b.until >= today)).sort((a, b) => toMin(a.start) - toMin(b.start))
  const mins = blocks.reduce((a, b) => a + b.dur, 0)
  const byCat = (Object.keys(CATS) as Cat[]).map(c => [c, blocks.filter(b => b.cat === c).reduce((a, b) => a + b.dur, 0)] as const).filter(x => x[1])

  return (
    <div className="view plan">
      <header className="greet"><div><div className="overline">Plan</div><h1 className="display-sm">{view === 'upcoming' ? 'Plan your days' : 'Design your ideal day'}</h1></div></header>
      <Seg label="Plan view" value={view} onChange={setView} options={[{ v: 'upcoming', label: 'Upcoming' }, { v: 'routine', label: 'Routine' }]} />
      {view === 'upcoming' ? <Upcoming /> : <>
      <p className="muted lead">Blocks here auto-populate every matching day at midnight. Be ambitious but honest — the streak only counts if you hit {threshold}%.</p>
      <p className="small muted routine-note"><Icon n="info" /> Routine is what repeats every week. Claude's day-specific plan (your CP blocks, mocks, exams) lives in <button type="button" className="linkish pad" onClick={() => setView('upcoming')}>Upcoming → Next 7 days</button>, where you can edit, merge or split any block.</p>

      <div className="cols plan-cols">
      <section className="card col-main">
        <Seg label="Weekday" value={wd} onChange={setWd} options={DAYS.map((d, i) => ({ v: i, label: d, sub: template.filter(b => b.days.includes(i)).length, aria: `${DAYN[i]}, ${template.filter(b => b.days.includes(i)).length} blocks` }))} />
        <div className="plan-sum">
          <div><b>{blocks.length}</b> blocks · <b>{fmtDur(mins)}</b> planned on {DAYN[wd]}</div>
          <div className="catbar" aria-hidden>{byCat.map(([c, m]) => <span key={c} title={`${CATS[c].label} ${fmtDur(m)}`} style={{ flex: m, background: tone(c) }} />)}</div>
          {byCat.length > 0 && <div className="legend small">{byCat.map(([c, m]) => <span key={c}><i className="rect" style={{ background: tone(c) }} />{CATS[c].label} <b>{fmtDur(m)}</b></span>)}</div>}
        </div>
        <ul className="blocks">
          <AnimatePresence initial={false}>
            {blocks.map(b => (
              <motion.li key={b.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} className="block" onClick={() => setEdit(b)}>
                <div className="block-ic" style={{ color: `var(--${CATS[b.cat].tone === 'neutral' ? 'surface-container-highest' : CATS[b.cat].tone + '-container'})` }}>
                  <Shape shape="cookie6" size={100} /><Icon n={CATS[b.cat].icon} fill />
                </div>
                <div className="grow">
                  <div className="task-title">{b.title}{(b.k === 'cp_practice' || b.k === 'cp_mock') && <span className="chip mini on">{b.k === 'cp_mock' ? 'mock' : 'CP'}</span>}</div>
                  <div className="task-meta">{b.start}–{fmtMin(toMin(b.start) + b.dur)} · {fmtDur(b.dur)} · {b.days.length === 7 ? 'every day' : b.days.map(d => DAYN[d]).join(' ')}{b.from && b.from > today ? ` · from ${fmtDay(b.from)}` : ''}{b.until ? ` · until ${fmtDay(b.until)}` : ''}{b.ai ? ' · planned by Claude' : ''}</div>
                </div>
                <Icon n="chevron_right" />
              </motion.li>
            ))}
          </AnimatePresence>
          {!blocks.length && <li className="muted small plan-empty">Nothing repeats on {DAYN[wd]} yet. Add a block and it lands on every {DAYN[wd]} from now on.</li>}
        </ul>
        <Btn kind="tonal" icon="add" onClick={() => setEdit({ id: uid(), title: '', start: '09:00', dur: 60, cat: 'deep', days: [wd], u: 0 })}>Add block</Btn>
      </section>

      <section className="card col-side">
        <div className="card-head"><h3 className="title"><Icon n="flag" fill /> Daily goals</h3><Btn kind="text" size="sm" icon="add" onClick={() => setGoal({ id: uid(), title: '', target: 1, step: 1, unit: '', icon: 'star', u: 0 })}>Goal</Btn></div>
        <ul className="blocks">
          {!goals.length && <li className="muted small plan-empty"><Icon n="lightbulb" /> Small things you want to do every day: water, pushups, reading pages. Tap + Goal, set a target, and tick it off on Today.</li>}
          {goals.map(g => (
            <li key={g.id} className="block" onClick={() => setGoal(g)}>
              <div className="block-ic" style={{ color: 'var(--secondary-container)' }}><Shape shape="clover4" size={100} /><Icon n={g.icon} fill /></div>
              <div className="grow"><div className="task-title">{g.title}</div><div className="task-meta">Target {g.target} {g.unit} · step {g.step}</div></div>
              <Icon n="chevron_right" />
            </li>
          ))}
        </ul>
      </section>
      </div>
      </>}
      <BlockEditor b={edit} onClose={() => setEdit(null)} />
      <GoalEditor g={goal} onClose={() => setGoal(null)} />
    </div>
  )
}

function BlockEditor({ b, onClose }: { b: Block | null; onClose: () => void }) {
  const [v, setV] = useState<Block | null>(b)
  const [last, setLast] = useState(b)
  if (b !== last) { setLast(b); setV(b) }
  const exists = useStore(s => !!b && s.template.some(x => x.id === b.id))
  const ok = !!v && v.title.trim() && v.days.length
  return (
    <Sheet open={!!b} onClose={onClose} title={exists ? 'Edit block' : 'New routine block'} actions={<>
      {exists && <Btn kind="text" icon="delete" className="danger" onClick={async () => { if (await confirmAsk({ title: `Delete “${b!.title || 'this block'}”?`, body: 'It stops repeating from tomorrow on. Today keeps the copy it already has.', ok: 'Delete', danger: true })) { deleteBlock(b!.id); onClose() } }}>Delete</Btn>}
      <span className="grow" /><Btn kind="text" onClick={onClose}>Cancel</Btn>
      <Btn icon="check" disabled={!ok} onClick={() => { if (v && ok) { saveBlock({ ...v, title: v.title.trim() }); onClose() } }}>Save</Btn>
    </>}>
      {v && <div className="form">
        <Field label="Block"><input autoFocus value={v.title} onChange={e => setV({ ...v, title: e.target.value })} placeholder="e.g. Deep work" /></Field>
        <div className="row two">
          <Field label="Start"><input type="time" value={v.start} onChange={e => setV({ ...v, start: e.target.value || '00:00' })} /></Field>
          <Field label="Minutes"><input type="number" min={5} step={5} value={v.dur} onChange={e => setV({ ...v, dur: Math.max(5, +e.target.value || 5) })} /></Field>
        </div>
        <Chips value={v.dur} onChange={dur => setV({ ...v, dur })} options={LENGTH_PRESETS.map(m => ({ v: m, label: fmtDur(m) }))} />
        <div className="field-label">Type</div>
        <Chips value={v.k && v.k !== 'coach' ? v.k : 'other'} onChange={k => setV({ ...v, k: k === 'other' ? undefined : k, ...(k === 'cp_practice' || k === 'cp_mock' ? { cat: 'deep' as Cat } : {}), ...(k !== 'cp_practice' ? { cp: undefined } : {}) })} options={BLOCK_TYPES} />
        {(v.k === 'cp_practice' || v.k === 'cp_mock') && <p className="small muted">{v.k === 'cp_mock' ? 'The play button starts a mock round, and it counts as the day\'s mock.' : 'The play button starts this block\'s session, and it counts toward your daily CP hours.'}</p>}
        {v.k === 'cp_practice' && <SessionPicker value={v.cp} onChange={cp => setV({ ...v, cp, ...(cp && GENERIC_RE.test(v.title) ? { title: retitle(v.title, cp) } : {}) })} />}
        <div className="field-label">Category</div>
        <Chips value={v.cat} onChange={c => setV({ ...v, cat: c })} options={(Object.keys(CATS) as Cat[]).map(c => ({ v: c, label: CATS[c].label, icon: CATS[c].icon }))} />
        <div className="field-label">Repeats on</div>
        <Chips multi value={v.days} onChange={d => setV({ ...v, days: v.days.includes(d) ? v.days.filter(x => x !== d) : [...v.days, d].sort() })} options={DAYN.map((l, i) => ({ v: i, label: l }))} />
        <div className="row two">
          <Field label="From (optional)"><input type="date" value={v.from || ''} onChange={e => setV({ ...v, from: e.target.value || undefined })} /></Field>
          <Field label="Until (optional)"><input type="date" value={v.until || ''} onChange={e => setV({ ...v, until: e.target.value || undefined })} /></Field>
        </div>
        <div className="row wrap">
          <Btn kind="outlined" size="sm" onClick={() => setV({ ...v, days: [0, 1, 2, 3, 4, 5, 6] })}>Every day</Btn>
          <Btn kind="outlined" size="sm" onClick={() => setV({ ...v, days: [1, 2, 3, 4, 5] })}>Weekdays</Btn>
          <Btn kind="outlined" size="sm" onClick={() => setV({ ...v, days: [0, 6] })}>Weekends</Btn>
        </div>
      </div>}
    </Sheet>
  )
}

const GOAL_ICONS = ['star', 'psychology', 'code', 'water_drop', 'menu_book', 'fitness_center', 'directions_run', 'bedtime', 'edit_note', 'translate', 'savings', 'spa']
function GoalEditor({ g, onClose }: { g: Goal | null; onClose: () => void }) {
  const [v, setV] = useState<Goal | null>(g)
  const [last, setLast] = useState(g)
  if (g !== last) { setLast(g); setV(g) }
  const exists = useStore(s => !!g && s.goals.some(x => x.id === g.id))
  return (
    <Sheet open={!!g} onClose={onClose} title={exists ? 'Edit goal' : 'New daily goal'} actions={<>
      {exists && <Btn kind="text" icon="delete" className="danger" onClick={async () => { if (await confirmAsk({ title: `Delete the goal “${g!.title || 'goal'}”?`, ok: 'Delete', danger: true })) { deleteGoal(g!.id); onClose() } }}>Delete</Btn>}
      <span className="grow" /><Btn kind="text" onClick={onClose}>Cancel</Btn>
      <Btn icon="check" disabled={!v?.title.trim()} onClick={() => { if (v?.title.trim()) { saveGoal(v); onClose() } }}>Save</Btn>
    </>}>
      {v && <div className="form">
        <Field label="Goal"><input autoFocus value={v.title} onChange={e => setV({ ...v, title: e.target.value })} placeholder="e.g. Pushups" /></Field>
        <div className="row three">
          <Field label="Target"><input type="number" min={0.5} step="any" value={v.target} onChange={e => setV({ ...v, target: Math.max(0.5, +e.target.value || 1) })} /></Field>
          <Field label="Step"><input type="number" min={0.1} step="any" value={v.step} onChange={e => setV({ ...v, step: Math.max(0.1, +e.target.value || 1) })} /></Field>
          <Field label="Unit"><input value={v.unit} onChange={e => setV({ ...v, unit: e.target.value })} placeholder="reps" /></Field>
        </div>
        <div className="field-label">Icon</div>
        <div className="icon-pick">{GOAL_ICONS.map(i => <IconBtn key={i} icon={i} kind={v.icon === i ? 'filled' : 'standard'} onClick={() => setV({ ...v, icon: i })} />)}</div>
      </div>}
    </Sheet>
  )
}
