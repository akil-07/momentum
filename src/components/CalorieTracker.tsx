import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { addMeal, dateKey, dayCalories, liveMeals, removeMeal, setSettings, useStore } from '../store'
import { Btn, Field, IconBtn, spring } from './common'
import { Icon } from './fx'
import { Shape, WavyBar } from './shapes'

export function CalorieTracker() {
  const k = dateKey()
  const d = useStore(s => s.days[k])
  const target = useStore(s => s.settings.calorieTarget || 2000)

  const [adding, setAdding] = useState(false)
  const [editingTarget, setEditingTarget] = useState(false)
  const [showList, setShowList] = useState(false)

  const [name, setName] = useState('')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [targetInput, setTargetInput] = useState(String(target))

  const meals = liveMeals(d)
  const total = dayCalories(d)
  const pct = target > 0 ? total / target : 0
  const over = total > target
  const diff = Math.abs(target - total)

  const totalP = meals.reduce((t, m) => t + (m.protein || 0), 0)
  const totalC = meals.reduce((t, m) => t + (m.carbs || 0), 0)
  const totalF = meals.reduce((t, m) => t + (m.fat || 0), 0)
  const hasMacros = totalP > 0 || totalC > 0 || totalF > 0

  const handleAdd = (e?: React.FormEvent) => {
    e?.preventDefault()
    const val = Number(kcal)
    if (!val || val <= 0) return
    addMeal(name.trim() || 'Meal', val, {
      protein: protein ? Number(protein) : undefined,
      carbs: carbs ? Number(carbs) : undefined,
      fat: fat ? Number(fat) : undefined,
    })
    setName('')
    setKcal('')
    setProtein('')
    setCarbs('')
    setFat('')
    setAdding(false)
  }

  const handleSaveTarget = (v: number) => {
    if (v >= 500 && v <= 10000) {
      setSettings({ calorieTarget: Math.round(v) })
      setEditingTarget(false)
    }
  }

  return (
    <section className="card calories-card" aria-label="Calorie tracker">
      <div className="work-top">
        <div className="grow">
          <div className="overline">CALORIES TODAY</div>
          <div className="display-sm">
            {total.toLocaleString()}
            <span className="small muted" style={{ fontSize: '0.45em', fontWeight: 600 }}> / {target.toLocaleString()} kcal</span>
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <IconBtn
            icon="tune"
            title="Set calorie target"
            onClick={() => { setTargetInput(String(target)); setEditingTarget(v => !v); setAdding(false) }}
          />
          <div className="work-ic" style={{ position: 'relative' }}>
            <Shape
              shape={over ? 'burst' : pct >= 0.85 ? 'sunny' : 'clover4'}
              size={100}
              style={{ color: over ? 'var(--error)' : 'var(--tertiary)' }}
            />
            <Icon n="restaurant" fill />
          </div>
        </div>
      </div>

      <WavyBar
        value={Math.min(1, pct)}
        height={10}
        color={over ? 'var(--error)' : pct >= 0.85 ? 'var(--tertiary)' : 'var(--primary)'}
        track={over ? 'var(--error-container)' : undefined}
      />

      <div className="work-rows" style={{ marginTop: 8 }}>
        <div className={over ? 'behind' : ''}>
          <Icon n={over ? 'warning' : 'local_fire_department'} />
          <span>
            <b>{diff.toLocaleString()} kcal</b> {over ? 'over target' : 'remaining'}
          </span>
        </div>
        {hasMacros && (
          <div className="small muted">
            <Icon n="pie_chart" />
            <span>P: <b>{totalP}g</b> · C: <b>{totalC}g</b> · F: <b>{totalF}g</b></span>
          </div>
        )}
      </div>

      <AnimatePresence>
        {editingTarget && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            style={{ overflow: 'hidden', marginTop: 10 }}
          >
            <div className="sync-box" style={{ padding: 12 }}>
              <div className="field-label" style={{ marginTop: 0 }}>Daily target (kcal)</div>
              <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
                {[1500, 1800, 2000, 2200, 2500].map(v => (
                  <button
                    key={v}
                    type="button"
                    className={'chip' + (target === v ? ' on' : '')}
                    onClick={() => handleSaveTarget(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="number"
                  min={500}
                  max={10000}
                  value={targetInput}
                  onChange={e => setTargetInput(e.target.value)}
                  placeholder="Custom kcal"
                  style={{ flex: 1, minWidth: 0, padding: '6px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--outline-variant)', color: 'inherit' }}
                />
                <Btn size="sm" onClick={() => handleSaveTarget(Number(targetInput))}>Save</Btn>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
        {[100, 250, 500].map(amt => (
          <button
            key={amt}
            type="button"
            className="chip mini"
            onClick={() => addMeal(`Quick +${amt}`, amt)}
          >
            +{amt}
          </button>
        ))}
        <Btn
          size="sm"
          kind={adding ? 'filled' : 'tonal'}
          icon={adding ? 'close' : 'add'}
          onClick={() => { setAdding(v => !v); setEditingTarget(false) }}
        >
          {adding ? 'Cancel' : 'Log meal'}
        </Btn>
        {meals.length > 0 && (
          <Btn
            size="sm"
            kind="text"
            icon={showList ? 'expand_less' : 'expand_more'}
            onClick={() => setShowList(v => !v)}
          >
            {meals.length} {meals.length === 1 ? 'entry' : 'entries'}
          </Btn>
        )}
      </div>

      <AnimatePresence>
        {adding && (
          <motion.form
            onSubmit={handleAdd}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            style={{ overflow: 'hidden', marginTop: 12 }}
          >
            <div className="form sync-box" style={{ padding: 12, gap: 10 }}>
              <div className="row two" style={{ gap: 8 }}>
                <Field label="Meal / Food">
                  <input
                    autoFocus
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Chicken & rice"
                  />
                </Field>
                <Field label="Calories (kcal)">
                  <input
                    type="number"
                    min={1}
                    required
                    value={kcal}
                    onChange={e => setKcal(e.target.value)}
                    placeholder="450"
                  />
                </Field>
              </div>
              <div className="row three" style={{ gap: 8 }}>
                <Field label="Protein (g)">
                  <input type="number" min={0} value={protein} onChange={e => setProtein(e.target.value)} placeholder="opt" />
                </Field>
                <Field label="Carbs (g)">
                  <input type="number" min={0} value={carbs} onChange={e => setCarbs(e.target.value)} placeholder="opt" />
                </Field>
                <Field label="Fat (g)">
                  <input type="number" min={0} value={fat} onChange={e => setFat(e.target.value)} placeholder="opt" />
                </Field>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <Btn type="submit" icon="check" disabled={!kcal || Number(kcal) <= 0}>Add entry</Btn>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showList && meals.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}
          >
            {meals.map(m => (
              <li
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 10,
                  background: 'var(--surface-container-highest)',
                  fontSize: 13,
                }}
              >
                <span className="muted" style={{ fontSize: 11 }}>
                  {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="grow" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name}
                </span>
                {(m.protein || m.carbs || m.fat) && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    {[m.protein ? `P:${m.protein}` : '', m.carbs ? `C:${m.carbs}` : '', m.fat ? `F:${m.fat}` : ''].filter(Boolean).join(' ')}
                  </span>
                )}
                <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{m.kcal} kcal</span>
                <IconBtn
                  icon="close"
                  title="Remove meal"
                  onClick={() => removeMeal(m.id)}
                  className="danger"
                />
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  )
}
