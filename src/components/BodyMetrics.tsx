import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { dateKey, latestWeight, setSettings, setWeight, toast, useStore } from '../store'
import { Btn, Chips, Field, IconBtn, spring } from './common'
import { Icon } from './fx'

const ACTIVITY_MULT = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
} as const

export function BodyMetrics() {
  const today = dateKey()
  const st = useStore(s => s.settings)
  const todayWeight = useStore(s => s.days[today]?.weightKg)
  const lastW = useStore(s => latestWeight(s))

  const heightCm = st.heightCm || 0
  const age = st.age || 22
  const sex = st.sex || 'male'
  const activity = st.activityLevel || 'light'
  const goalKg = st.goalWeightKg

  const currentKg = todayWeight ?? lastW?.kg ?? 0

  const [weightInput, setWeightInput] = useState(currentKg ? String(currentKg) : '')
  const [editProfile, setEditProfile] = useState(!heightCm)
  const [hInput, setHInput] = useState(heightCm ? String(heightCm) : '')
  const [ageInput, setAgeInput] = useState(String(age))
  const [sexInput, setSexInput] = useState<'male' | 'female'>(sex)
  const [actInput, setActInput] = useState<'sedentary' | 'light' | 'moderate' | 'active'>(activity)
  const [goalInput, setGoalInput] = useState(goalKg ? String(goalKg) : '')

  const handleLogWeight = (e?: React.FormEvent) => {
    e?.preventDefault()
    const val = Number(weightInput)
    if (!val || val < 20 || val > 350) return
    setWeight(val, today)
  }

  const handleSaveProfile = (e?: React.FormEvent) => {
    e?.preventDefault()
    const h = Number(hInput)
    if (!h || h < 100 || h > 250) {
      toast('Please enter a valid height in cm (100–250)', 'error')
      return
    }
    const a = Math.max(12, Math.min(100, Number(ageInput) || 22))
    const g = Number(goalInput)
    setSettings({
      heightCm: Math.round(h),
      age: Math.round(a),
      sex: sexInput,
      activityLevel: actInput,
      goalWeightKg: g >= 20 && g <= 350 ? Math.round(g * 10) / 10 : undefined,
    })
    setEditProfile(false)
    toast('Body profile saved', 'check')
  }

  // Calculations
  const hM = heightCm / 100
  const bmi = heightCm > 0 && currentKg > 0 ? currentKg / (hM * hM) : 0
  const minHealthy = heightCm > 0 ? 18.5 * hM * hM : 0
  const maxHealthy = heightCm > 0 ? 24.9 * hM * hM : 0
  const idealKg = heightCm > 0 ? 22.0 * hM * hM : 0

  let bmiLabel = ''
  let bmiTone = 'var(--primary)'
  if (bmi > 0) {
    if (bmi < 18.5) { bmiLabel = 'Underweight'; bmiTone = 'var(--tertiary)' }
    else if (bmi < 25) { bmiLabel = 'Healthy'; bmiTone = 'var(--primary)' }
    else if (bmi < 30) { bmiLabel = 'Overweight'; bmiTone = 'var(--tertiary)' }
    else { bmiLabel = 'Obese'; bmiTone = 'var(--error)' }
  }

  // How much to lose or gain
  const targetRefKg = goalKg || (bmi >= 25 ? maxHealthy : bmi < 18.5 ? minHealthy : idealKg)
  const diffKg = currentKg > 0 && targetRefKg > 0 ? Math.round((currentKg - targetRefKg) * 10) / 10 : 0
  const healthyDiffKg = currentKg > 0 && maxHealthy > 0 ? Math.round((currentKg - maxHealthy) * 10) / 10 : 0

  // Mifflin-St Jeor BMR & TDEE
  const bmr = heightCm > 0 && currentKg > 0
    ? 10 * currentKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161)
    : 0
  const maintenance = bmr > 0 ? Math.round(bmr * ACTIVITY_MULT[activity]) : 0
  const floorKcal = sex === 'male' ? 1500 : 1200

  let recKcal = maintenance
  let recMode = 'Maintenance'
  if (maintenance > 0) {
    if (diffKg > 0.5 || bmi >= 25) {
      recKcal = Math.max(floorKcal, maintenance - 500)
      recMode = 'Fat loss (−500 kcal/day · ~0.5 kg/wk)'
    } else if (diffKg < -0.5 || bmi < 18.5) {
      recKcal = maintenance + 300
      recMode = 'Healthy gain (+300 kcal/day)'
    }
  }

  return (
    <section className="card" aria-label="Body profile, daily weight, and BMI">
      <div className="card-head">
        <h2 className="title"><Icon n="monitor_weight" fill /> Weight, BMI &amp; Goal</h2>
        <IconBtn
          icon={editProfile ? 'close' : 'tune'}
          title="Edit height & body profile"
          onClick={() => {
            setHInput(heightCm ? String(heightCm) : '')
            setAgeInput(String(age))
            setSexInput(sex)
            setActInput(activity)
            setGoalInput(goalKg ? String(goalKg) : '')
            setEditProfile(v => !v)
          }}
        />
      </div>

      {/* Daily Weight Logger */}
      <form onSubmit={handleLogWeight} className="row wrap" style={{ gap: 8, marginTop: 8 }}>
        <div className="grow" style={{ minWidth: 140 }}>
          <input
            type="number"
            step="0.1"
            min={20}
            max={350}
            value={weightInput}
            onChange={e => setWeightInput(e.target.value)}
            placeholder="Today's weight (kg)"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 10, background: 'var(--surface-container-highest)', border: '1px solid var(--outline-variant)', color: 'inherit', fontWeight: 600 }}
          />
        </div>
        <Btn type="submit" size="sm" icon="check" disabled={!weightInput || Number(weightInput) < 20}>
          {todayWeight ? 'Update Weight' : 'Log Today'}
        </Btn>
      </form>
      <div className="small muted" style={{ marginTop: 6 }}>
        {todayWeight
          ? <>Logged today: <b>{todayWeight} kg</b></>
          : lastW
            ? <>Last logged: <b>{lastW.kg} kg</b> ({lastW.date}) · log today&apos;s weight above</>
            : 'Enter your current weight in kg to track daily progress'}
      </div>

      {/* Height & Body Profile Form */}
      <AnimatePresence>
        {editProfile && (
          <motion.form
            onSubmit={handleSaveProfile}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            style={{ overflow: 'hidden', marginTop: 12 }}
          >
            <div className="form sync-box" style={{ padding: 12, gap: 10 }}>
              <div className="row two" style={{ gap: 8 }}>
                <Field label="Height (cm)">
                  <input type="number" min={100} max={250} required value={hInput} onChange={e => setHInput(e.target.value)} placeholder="e.g. 175" />
                </Field>
                <Field label="Age">
                  <input type="number" min={12} max={100} value={ageInput} onChange={e => setAgeInput(e.target.value)} placeholder="22" />
                </Field>
              </div>
              <div className="row two" style={{ gap: 8 }}>
                <Field label="Goal weight (kg, opt)">
                  <input type="number" step="0.1" min={20} max={350} value={goalInput} onChange={e => setGoalInput(e.target.value)} placeholder="Auto from BMI" />
                </Field>
                <div>
                  <div className="field-label" style={{ marginTop: 0 }}>Sex</div>
                  <Chips value={sexInput} onChange={v => setSexInput(v)} options={[{ v: 'male' as const, label: 'Male' }, { v: 'female' as const, label: 'Female' }]} />
                </div>
              </div>
              <div>
                <div className="field-label" style={{ marginTop: 0 }}>Activity level</div>
                <Chips
                  value={actInput}
                  onChange={v => setActInput(v)}
                  options={[
                    { v: 'sedentary' as const, label: 'Sedentary' },
                    { v: 'light' as const, label: 'Light' },
                    { v: 'moderate' as const, label: 'Moderate' },
                    { v: 'active' as const, label: 'Active' },
                  ]}
                />
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <Btn type="submit" size="sm" icon="check">Save Profile</Btn>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* BMI, Weight Loss Target & Calorie Recommendation */}
      {bmi > 0 && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="grid-2" style={{ gap: 10 }}>
            <div className="sync-box" style={{ padding: 12 }}>
              <div className="overline">YOUR BMI</div>
              <div className="headline" style={{ color: bmiTone, marginTop: 2 }}>
                {bmi.toFixed(1)} <span className="small" style={{ fontWeight: 700 }}>· {bmiLabel}</span>
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                Healthy range: <b>{minHealthy.toFixed(1)} – {maxHealthy.toFixed(1)} kg</b> ({heightCm} cm)
              </div>
            </div>

            <div className="sync-box" style={{ padding: 12 }}>
              <div className="overline">WEIGHT TARGET</div>
              {goalKg ? (
                <>
                  <div className="headline" style={{ marginTop: 2 }}>
                    {diffKg > 0.2 ? `Lose ${diffKg} kg` : diffKg < -0.2 ? `Gain ${Math.abs(diffKg)} kg` : 'At Goal!'}
                  </div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    Target: <b>{goalKg} kg</b> {healthyDiffKg > 0 && !goalKg ? '' : `(Healthy max: ${maxHealthy.toFixed(1)} kg)`}
                  </div>
                </>
              ) : bmi >= 25 ? (
                <>
                  <div className="headline" style={{ color: bmiTone, marginTop: 2 }}>
                    Lose {healthyDiffKg} kg
                  </div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    To reach healthy BMI 24.9 (Ideal: {idealKg.toFixed(1)} kg)
                  </div>
                </>
              ) : bmi < 18.5 ? (
                <>
                  <div className="headline" style={{ color: bmiTone, marginTop: 2 }}>
                    Gain {Math.abs(Math.round((currentKg - minHealthy) * 10) / 10)} kg
                  </div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    To reach healthy BMI 18.5
                  </div>
                </>
              ) : (
                <>
                  <div className="headline" style={{ color: 'var(--primary)', marginTop: 2 }}>
                    Healthy Range
                  </div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    Ideal midpoint: {idealKg.toFixed(1)} kg
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="sync-box" style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div className="overline">RECOMMENDED CALORIES</div>
              <div className="headline" style={{ marginTop: 2 }}>{recKcal.toLocaleString()} kcal / day</div>
              <div className="small muted">
                {recMode} · Maintenance: {maintenance.toLocaleString()} kcal
              </div>
            </div>
            {st.calorieTarget !== recKcal && (
              <Btn
                size="sm"
                kind="tonal"
                icon="auto_awesome"
                onClick={() => {
                  setSettings({ calorieTarget: recKcal })
                  toast(`Daily calorie target set to ${recKcal.toLocaleString()} kcal`, 'check')
                }}
              >
                Use {recKcal.toLocaleString()} kcal
              </Btn>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
