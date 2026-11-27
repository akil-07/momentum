import { useMemo, useState } from 'react'
import { addDays, dateKey, dayCalories, getState, latestWeight, liveMeals, removeMeal, setSettings, useStore } from '../store'
import { BodyMetrics } from './BodyMetrics'
import { CalorieTracker } from './CalorieTracker'
import { IconBtn } from './common'
import { Icon } from './fx'
import { WavyBar } from './shapes'

export function Fitness() {
  const today = dateKey()
  const [selDate, setSelDate] = useState(today)

  const days = useStore(s => s.days)
  const calTarget = useStore(s => s.settings.calorieTarget || 2000)
  const stepsTarget = useStore(s => s.settings.stepsTarget || 10000)
  const d = days[selDate]

  const meals = liveMeals(d)
  const totalKcal = dayCalories(d)
  const totalP = meals.reduce((s, m) => s + (m.protein || 0), 0)
  const totalC = meals.reduce((s, m) => s + (m.carbs || 0), 0)
  const totalF = meals.reduce((s, m) => s + (m.fat || 0), 0)

  const lastW = useMemo(() => latestWeight(getState()), [days])
  const curKg = d?.weightKg ?? lastW?.kg ?? 0

  // Weight-based protein target (~1.8 g/kg, the 1.6-2.2 g/kg fat-loss sweet spot) when weight is known
  const pTarget = curKg > 0 ? Math.round(curKg * 1.8) : Math.round((calTarget * 0.25) / 4)
  const fTarget = Math.round((calTarget * 0.25) / 9)
  const cTarget = Math.max(50, Math.round((calTarget - pTarget * 4 - fTarget * 9) / 4))

  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -i))

  return (
    <div className="view fitness">
      <header className="greet">
        <div>
          <div className="overline">HEALTH & NUTRITION</div>
          <h1 className="display-sm">Fitness</h1>
        </div>
      </header>

      <div className="cols side-first">
        <div className="col-main">
          {/* Calories & Macros Table */}
          <section className="card" aria-label="Calories and Macros Table">
            <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h2 className="title"><Icon n="table_chart" fill /> Calories &amp; Macros Table</h2>
              <div className="row wrap" style={{ gap: 4 }}>
                {last7.slice(0, 4).map(k => (
                  <button
                    key={k}
                    type="button"
                    className={'chip mini' + (selDate === k ? ' on' : '')}
                    onClick={() => setSelDate(k)}
                  >
                    {k === today ? 'Today' : k === addDays(today, -1) ? 'Yesterday' : k.slice(5)}
                  </button>
                ))}
              </div>
            </div>

            {meals.length === 0 ? (
              <p className="small muted" style={{ padding: '16px 0', margin: 0 }}>
                No meals logged for {selDate === today ? 'today' : selDate}. Use <b>Snap meal</b> or <b>Manual</b> to log food.
              </p>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--outline-variant)', textAlign: 'left', color: 'var(--on-surface-variant)' }}>
                      <th style={{ padding: '8px 6px', fontWeight: 600 }}>Time</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600 }}>Meal / Food</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Calories</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Protein</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Carbs</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Fat</th>
                      {selDate === today && <th style={{ padding: '8px 4px', width: 32 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {meals.map(m => (
                      <tr key={m.id} style={{ borderBottom: '1px solid color-mix(in srgb, var(--outline-variant) 45%, transparent)' }}>
                        <td className="muted" style={{ padding: '8px 6px', whiteSpace: 'nowrap', fontSize: 12 }}>
                          {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '8px 6px', fontWeight: 600 }}>{m.name}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{m.kcal} kcal</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>{m.protein ? `${m.protein}g` : '—'}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>{m.carbs ? `${m.carbs}g` : '—'}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>{m.fat ? `${m.fat}g` : '—'}</td>
                        {selDate === today && (
                          <td style={{ padding: '4px', textAlign: 'right' }}>
                            <IconBtn icon="close" title="Remove entry" className="danger" onClick={() => removeMeal(m.id)} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--outline-variant)', fontWeight: 700, background: 'var(--surface-container-high)' }}>
                      <td colSpan={2} style={{ padding: '10px 6px' }}>Total ({meals.length} {meals.length === 1 ? 'item' : 'items'})</td>
                      <td style={{ padding: '10px 6px', textAlign: 'right', color: totalKcal > calTarget ? 'var(--error)' : 'var(--primary)', whiteSpace: 'nowrap' }}>
                        {totalKcal.toLocaleString()} kcal
                      </td>
                      <td style={{ padding: '10px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>{totalP}g</td>
                      <td style={{ padding: '10px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>{totalC}g</td>
                      <td style={{ padding: '10px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>{totalF}g</td>
                      {selDate === today && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* Macro Breakdown Card */}
          <section className="card" aria-label="Macronutrients">
            <div className="card-head">
              <h2 className="title"><Icon n="pie_chart" fill /> Macros — {selDate === today ? 'Today' : selDate}</h2>
              <span className="small muted">{totalKcal.toLocaleString()} / {calTarget.toLocaleString()} kcal</span>
            </div>
            <div className="grid-2" style={{ gap: 12, marginTop: 8 }}>
              <div className="sync-box" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700 }}>Protein</span>
                  <span className="small"><b>{totalP}g</b> <span className="muted">/ {pTarget}g</span></span>
                </div>
                <WavyBar value={pTarget > 0 ? Math.min(1, totalP / pTarget) : 0} height={8} color="var(--primary)" />
              </div>

              <div className="sync-box" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700 }}>Carbs</span>
                  <span className="small"><b>{totalC}g</b> <span className="muted">/ {cTarget}g</span></span>
                </div>
                <WavyBar value={cTarget > 0 ? Math.min(1, totalC / cTarget) : 0} height={8} color="var(--tertiary)" />
              </div>

              <div className="sync-box" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700 }}>Fat</span>
                  <span className="small"><b>{totalF}g</b> <span className="muted">/ {fTarget}g</span></span>
                </div>
                <WavyBar value={fTarget > 0 ? Math.min(1, totalF / fTarget) : 0} height={8} color="var(--secondary)" />
              </div>

              <div className="sync-box" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700 }}>Active Burn</span>
                  <span className="small"><b>{(d?.activeKcal || 0).toLocaleString()}</b> <span className="muted">kcal</span></span>
                </div>
                <div className="small muted">
                  Net: <b>{Math.max(0, totalKcal - (d?.activeKcal || 0)).toLocaleString()} kcal</b> · {(d?.steps || 0).toLocaleString()} steps
                </div>
              </div>
            </div>
          </section>

          <BodyMetrics />

          {/* 7-Day Fitness & Nutrition History Table */}
          <section className="card" aria-label="7-day fitness history">
            <div className="card-head">
              <h2 className="title"><Icon n="calendar_month" fill /> Last 7 Days</h2>
              <span className="small muted">Steps target: {stepsTarget.toLocaleString()}</span>
            </div>
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--outline-variant)', textAlign: 'left', color: 'var(--on-surface-variant)' }}>
                    <th style={{ padding: '8px 6px', fontWeight: 600 }}>Day</th>
                    <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Calories</th>
                    <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Protein</th>
                    <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Carbs</th>
                    <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Fat</th>
                    <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Steps</th>
                    <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {last7.map(k => {
                    const day = days[k]
                    const ms = liveMeals(day)
                    const kc = dayCalories(day)
                    const p = ms.reduce((s, m) => s + (m.protein || 0), 0)
                    const c = ms.reduce((s, m) => s + (m.carbs || 0), 0)
                    const f = ms.reduce((s, m) => s + (m.fat || 0), 0)
                    const st = day?.steps || 0
                    const wt = day?.weightKg
                    return (
                      <tr
                        key={k}
                        onClick={() => setSelDate(k)}
                        style={{
                          cursor: 'pointer',
                          borderBottom: '1px solid color-mix(in srgb, var(--outline-variant) 45%, transparent)',
                          background: selDate === k ? 'var(--surface-container-high)' : undefined,
                        }}
                      >
                        <td style={{ padding: '8px 6px', fontWeight: k === today ? 700 : 500 }}>
                          {k === today ? 'Today' : k === addDays(today, -1) ? 'Yesterday' : k.slice(5)}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>{kc ? `${kc} kcal` : '—'}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{p ? `${p}g` : '—'}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{c ? `${c}g` : '—'}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{f ? `${f}g` : '—'}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{st ? st.toLocaleString() : '—'}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>{wt ? `${wt} kg` : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="col-side">
          <CalorieTracker />
          <section className="card">
            <div className="field-label" style={{ marginTop: 0 }}>Daily steps target</div>
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
              {[5000, 8000, 10000, 12000, 15000].map(v => (
                <button
                  key={v}
                  type="button"
                  className={'chip mini' + (stepsTarget === v ? ' on' : '')}
                  onClick={() => setSettings({ stepsTarget: v })}
                >
                  {(v / 1000)}k
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
