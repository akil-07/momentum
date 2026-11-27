import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { addMeal, dateKey, dayCalories, liveMeals, removeMeal, setSettings, setSteps, toast, useStore } from '../store'
import { getSyncCfg } from '../sync'
import { analyzeFoodPhoto, compressFoodImage, type DetectedFood } from '../foodVision'
import { Btn, Chips, Field, IconBtn, Sheet, spring } from './common'
import { Icon } from './fx'
import { Shape, WavyBar } from './shapes'

const MULT_OPTIONS = [0.5, 1, 1.5, 2]

export function CalorieTracker() {
  const k = dateKey()
  const d = useStore(s => s.days[k])
  const target = useStore(s => s.settings.calorieTarget || 2000)
  const stepsTarget = useStore(s => s.settings.stepsTarget || 10000)
  const visionProvider = useStore(s => s.settings.visionProvider || 'gemini')
  const visionKey = useStore(s => s.settings.visionKey || '')

  const steps = d?.steps || 0
  const activeKcal = d?.activeKcal || 0

  const [watchOpen, setWatchOpen] = useState(false)
  const [editingSteps, setEditingSteps] = useState(false)
  const [stepsInput, setStepsInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingTarget, setEditingTarget] = useState(false)
  const [showList, setShowList] = useState(false)

  // Manual entry state
  const [name, setName] = useState('')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [targetInput, setTargetInput] = useState(String(target))

  // Snap photo scanner state
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [snapOpen, setSnapOpen] = useState(false)
  const [snapImg, setSnapImg] = useState<{ base64: string; mime: string; dataUrl: string } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanErr, setScanErr] = useState('')
  const [summary, setSummary] = useState('')
  const [items, setItems] = useState<DetectedFood[]>([])
  const [keyInput, setKeyInput] = useState(visionKey)
  const [provInput, setProvInput] = useState<'gemini' | 'openai'>(visionProvider)

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
    setName(''); setKcal(''); setProtein(''); setCarbs(''); setFat(''); setAdding(false)
  }

  const handleSaveTarget = (v: number) => {
    if (v >= 500 && v <= 10000) {
      setSettings({ calorieTarget: Math.round(v) })
      setEditingTarget(false)
    }
  }

  const runAnalysis = async (img: { base64: string; mime: string }, prov: 'gemini' | 'openai', key: string) => {
    setScanning(true)
    setScanErr('')
    setItems([])
    setSummary('')
    try {
      const res = await analyzeFoodPhoto(img.base64, img.mime, prov, key)
      setSummary(res.summary)
      setItems(res.items)
    } catch (err) {
      setScanErr(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const img = await compressFoodImage(file)
      setSnapImg(img)
      setKeyInput(visionKey)
      setProvInput(visionProvider)
      setSnapOpen(true)
      if (visionKey.trim()) {
        void runAnalysis(img, visionProvider, visionKey)
      } else {
        setScanErr('')
        setItems([])
      }
    } catch {
      toast('Could not read the selected image', 'error')
    }
  }

  const saveKeyAndScan = () => {
    const kTrim = keyInput.trim()
    if (!kTrim) return
    setSettings({ visionProvider: provInput, visionKey: kTrim })
    if (snapImg) void runAnalysis(snapImg, provInput, kTrim)
  }

  const toggleKeep = (id: string) => setItems(xs => xs.map(x => x.id === id ? { ...x, keep: !x.keep } : x))
  const setQty = (id: string, qty: number) => setItems(xs => xs.map(x => x.id === id ? { ...x, qty } : x))

  const selectedItems = items.filter(x => x.keep)
  const snapTotalKcal = selectedItems.reduce((s, x) => s + Math.round(x.kcal * x.qty), 0)
  const snapTotalP = selectedItems.reduce((s, x) => s + Math.round(x.protein * x.qty), 0)
  const snapTotalC = selectedItems.reduce((s, x) => s + Math.round(x.carbs * x.qty), 0)
  const snapTotalF = selectedItems.reduce((s, x) => s + Math.round(x.fat * x.qty), 0)

  const logScannedMeal = () => {
    if (!selectedItems.length) return
    for (const it of selectedItems) {
      const qLabel = it.qty !== 1 ? ` (${it.qty}×)` : ''
      addMeal(`${it.name}${qLabel}`, Math.round(it.kcal * it.qty), {
        protein: Math.round(it.protein * it.qty),
        carbs: Math.round(it.carbs * it.qty),
        fat: Math.round(it.fat * it.qty),
      })
    }
    setSnapOpen(false)
    setSnapImg(null)
    setItems([])
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
                  <button key={v} type="button" className={'chip' + (target === v ? ' on' : '')} onClick={() => handleSaveTarget(v)}>
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

      {/* Hidden inputs for Camera & Gallery */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFilePicked} />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFilePicked} />

      <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
        <Btn
          size="sm"
          kind="filled"
          icon="photo_camera"
          onClick={() => cameraRef.current?.click()}
        >
          Snap meal
        </Btn>
        <IconBtn
          icon="photo_library"
          kind="tonal"
          title="Upload food photo from gallery"
          onClick={() => fileRef.current?.click()}
        />
        <Btn
          size="sm"
          kind={adding ? 'filled' : 'tonal'}
          icon={adding ? 'close' : 'add'}
          onClick={() => { setAdding(v => !v); setEditingTarget(false) }}
        >
          {adding ? 'Cancel' : 'Manual'}
        </Btn>
        {[100, 250].map(amt => (
          <button key={amt} type="button" className="chip mini" onClick={() => addMeal(`Quick +${amt}`, amt)}>
            +{amt}
          </button>
        ))}
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
                  <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Chicken & rice" />
                </Field>
                <Field label="Calories (kcal)">
                  <input type="number" min={1} required value={kcal} onChange={e => setKcal(e.target.value)} placeholder="450" />
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
                <IconBtn icon="close" title="Remove meal" onClick={() => removeMeal(m.id)} className="danger" />
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      {/* Steps & Apple Watch Active Burn */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--outline-variant, rgba(255,255,255,0.08))' }}>
        <div className="row" style={{ gap: 8, marginBottom: 6 }}>
          <Icon n="directions_walk" style={{ color: 'var(--primary)' }} />
          <div className="grow" style={{ fontSize: 13 }}>
            <b>{steps.toLocaleString()}</b>
            <span className="muted"> / {stepsTarget.toLocaleString()} steps</span>
            {activeKcal > 0 && <span className="muted"> · <b>{activeKcal} kcal</b> burned</span>}
          </div>
          <IconBtn
            icon="edit"
            title="Update steps manually"
            onClick={() => { setStepsInput(String(steps || '')); setEditingSteps(v => !v) }}
          />
          <Btn size="sm" kind="tonal" icon="watch" onClick={() => setWatchOpen(true)}>
            Apple Watch
          </Btn>
        </div>
        <WavyBar
          value={stepsTarget > 0 ? Math.min(1, steps / stepsTarget) : 0}
          height={8}
          color={steps >= stepsTarget ? 'var(--tertiary)' : 'var(--secondary)'}
        />

        <AnimatePresence>
          {editingSteps && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              style={{ overflow: 'hidden', marginTop: 8 }}
            >
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="number"
                  min={0}
                  value={stepsInput}
                  onChange={e => setStepsInput(e.target.value)}
                  placeholder="Today's steps"
                  style={{ flex: 1, minWidth: 0, padding: '6px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--outline-variant)', color: 'inherit' }}
                />
                <Btn size="sm" onClick={() => { setSteps(Number(stepsInput) || 0); setEditingSteps(false) }}>Save</Btn>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Apple Watch / Health Auto-Sync Setup Sheet */}
      <Sheet open={watchOpen} onClose={() => setWatchOpen(false)} title="Apple Watch Steps Sync">
        {(() => {
          const cfg = getSyncCfg()
          const netIps = (typeof window !== 'undefined' ? (window as unknown as { __MOMENTUM_NET__?: { ips?: string[]; port?: number } }).__MOMENTUM_NET__?.ips : []) || []
          const netPort = (typeof window !== 'undefined' ? (window as unknown as { __MOMENTUM_NET__?: { ips?: string[]; port?: number } }).__MOMENTUM_NET__?.port : null) || 8787
          const base = netIps[0] ? `http://${netIps[0]}:${netPort}` : (cfg?.url || (typeof window !== 'undefined' ? window.location.origin : 'http://100.94.1.89:8787'))
          const webhookUrl = cfg ? `${base}/api/health/sync?key=${encodeURIComponent(cfg.token)}` : `${base}/api/health/sync?key=YOUR_SYNC_KEY`
          return (
            <div className="form">
              <p className="small muted" style={{ marginTop: 0 }}>
                Apple Watch automatically saves your Steps and Active Energy to <b>Apple Health</b>. Use iPhone&apos;s built-in <b>Shortcuts</b> app to push them straight into Momentum automatically.
              </p>

              <div className="sync-box" style={{ padding: 12 }}>
                <div className="field-label" style={{ marginTop: 0 }}>1. Copy your Webhook URL</div>
                <div className="row" style={{ gap: 8 }}>
                  <input readOnly value={webhookUrl} style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '6px 8px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--outline-variant)', color: 'inherit' }} />
                  <Btn size="sm" icon="content_copy" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast('Webhook URL copied!', 'check') }}>Copy</Btn>
                </div>
              </div>

              <div className="sync-box" style={{ padding: 12 }}>
                <div className="field-label" style={{ marginTop: 0 }}>2. Create this 3-action Shortcut on iPhone</div>
                <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>Open <b>Shortcuts</b> app → tap <b>+</b> → add <b>Find Health Samples</b>: Type = <b>Steps</b>, Start Date = <b>is today</b>.</li>
                  <li>Add <b>Calculate Statistics</b> (<b>Sum</b> of Health Samples). <i>(Optional: repeat for <b>Active Energy</b>).</i></li>
                  <li>Add <b>Get Contents of URL</b> → paste the URL above, Method = <b>POST</b>, Request Body = <b>JSON</b>, add field <code>steps</code> (Number) = <i>Sum</i> (and optional <code>activeKcal</code>).</li>
                </ol>
              </div>

              <div className="sync-box" style={{ padding: 12 }}>
                <div className="field-label" style={{ marginTop: 0 }}>3. Make it automatic</div>
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                  In Shortcuts → <b>Automation</b> tab → <b>+</b> → pick <b>Time of Day</b> (e.g. every evening) or <b>App</b> (whenever you open Safari / Momentum), choose <b>Run Immediately</b>, and select your Shortcut.
                </p>
              </div>
            </div>
          )
        })()}
      </Sheet>

      {/* HealthifyMe-style Snap Scanner Review Sheet */}
      <Sheet
        open={snapOpen}
        onClose={() => { setSnapOpen(false); setScanning(false) }}
        title="Snap Meal Analysis"
        actions={
          items.length > 0 ? (
            <>
              <Btn kind="text" onClick={() => fileRef.current?.click()}>Retake</Btn>
              <span className="grow" />
              <Btn icon="check" disabled={!selectedItems.length} onClick={logScannedMeal}>
                Log {snapTotalKcal} kcal
              </Btn>
            </>
          ) : undefined
        }
      >
        <div className="form">
          {snapImg && (
            <div style={{ borderRadius: 16, overflow: 'hidden', maxHeight: 220, background: '#000', display: 'flex', justifyContent: 'center' }}>
              <img src={snapImg.dataUrl} alt="Meal preview" style={{ maxHeight: 220, maxWidth: '100%', objectFit: 'contain' }} />
            </div>
          )}

          {(!visionKey || scanErr) && !scanning && (
            <div className="sync-box" style={{ padding: 14 }}>
              {scanErr && <p className="small err" style={{ marginTop: 0 }}>{scanErr}</p>}
              <p className="small muted" style={{ marginTop: 0 }}>
                To analyze food photos automatically, connect a free <b>Google Gemini</b> API key (from{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>
                  aistudio.google.com/apikey
                </a>
                ) or OpenAI key. It is saved & synced across all your devices.
              </p>
              <Chips
                value={provInput}
                onChange={v => setProvInput(v)}
                options={[{ v: 'gemini' as const, label: 'Gemini (Free)' }, { v: 'openai' as const, label: 'OpenAI' }]}
              />
              <Field label={provInput === 'gemini' ? 'Gemini API Key' : 'OpenAI API Key'}>
                <input
                  type="password"
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  placeholder={provInput === 'gemini' ? 'AIzaSy...' : 'sk-...'}
                />
              </Field>
              <Btn icon="auto_awesome" disabled={!keyInput.trim()} onClick={saveKeyAndScan}>
                Save Key & Analyze Photo
              </Btn>
            </div>
          )}

          {scanning && (
            <div className="sync-box" style={{ textAlign: 'center', padding: 24 }}>
              <div className="spin" style={{ display: 'inline-block', marginBottom: 8 }}>
                <Icon n="progress_activity" style={{ fontSize: 32, color: 'var(--primary)' }} />
              </div>
              <div style={{ fontWeight: 650 }}>Scanning your meal…</div>
              <div className="small muted">Identifying dishes, estimating portions & macros</div>
            </div>
          )}

          {!scanning && items.length > 0 && (
            <>
              {summary && <p className="small muted" style={{ margin: '4px 0' }}>{summary}</p>}

              <div className="sync-box" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div className="overline">ESTIMATED TOTAL</div>
                  <div className="headline">{snapTotalKcal} kcal</div>
                </div>
                <div className="small muted">
                  P: <b>{snapTotalP}g</b> · C: <b>{snapTotalC}g</b> · F: <b>{snapTotalF}g</b>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map(it => (
                  <div
                    key={it.id}
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      background: it.keep ? 'var(--surface-container-high)' : 'var(--surface-container)',
                      opacity: it.keep ? 1 : 0.55,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div className="row" style={{ gap: 10 }}>
                      <IconBtn
                        icon={it.keep ? 'check_box' : 'check_box_outline_blank'}
                        kind="standard"
                        title={it.keep ? 'Exclude item' : 'Include item'}
                        onClick={() => toggleKeep(it.id)}
                      />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 650 }}>{it.name}</div>
                        <div className="small muted">{it.portion}</div>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700 }}>{Math.round(it.kcal * it.qty)} kcal</div>
                        <div className="small muted" style={{ fontSize: 11 }}>
                          P:{Math.round(it.protein * it.qty)} C:{Math.round(it.carbs * it.qty)} F:{Math.round(it.fat * it.qty)}
                        </div>
                      </div>
                    </div>

                    {it.keep && (
                      <div className="row wrap" style={{ gap: 6, paddingLeft: 42 }}>
                        <span className="small muted" style={{ marginRight: 4 }}>Portion:</span>
                        {MULT_OPTIONS.map(m => (
                          <button
                            key={m}
                            type="button"
                            className={'chip mini' + (it.qty === m ? ' on' : '')}
                            onClick={() => setQty(it.id, m)}
                          >
                            {m}×
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Sheet>
    </section>
  )
}
