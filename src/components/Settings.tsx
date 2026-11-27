import { useEffect, useRef, useState } from 'react'
import { addDays, dateKey, deleteSeason, exportData, fmtDur, importData, keyToDate, setSeason, setSettings, toast, useStore } from '../store'
import { EXAM_DEFAULTS, makeSeason, seasonLabel, upcomingSeasons, type Season } from '../season'
import { resetEverything } from '../reset'
import { configureSync, DEFAULT_FIREBASE_CFG, getSyncCfg, isFirebaseUrl, syncNow, useSync } from '../sync'
import { install, isIOS, isStandalone, useCanInstall } from '../pwa'
import { PRESETS, SEEDS, STYLES, previewColors, tierSeed, type Preset } from '../theme'
import { useCf } from '../cf'
import '../styles/themes.css'
import { motion } from 'motion/react'
import { Btn, Chips, Field, Sheet, Switch, spring } from './common'
import { sfx } from '../sound'
import { confirmAsk } from '../ui'
import { Icon } from './fx'

function SyncSection() {
  const sync = useSync()
  const cfg = getSyncCfg()
  const [url, setUrl] = useState(cfg?.url || (import.meta.env.PROD ? location.origin : ''))
  const [key, setKey] = useState(cfg?.token || '')
  const [showQR, setShowQR] = useState(false)

  const netIps = (typeof window !== 'undefined' ? (window as unknown as { __MOMENTUM_NET__?: { ips?: string[]; port?: number } }).__MOMENTUM_NET__?.ips : []) || []
  const netPort = (typeof window !== 'undefined' ? (window as unknown as { __MOMENTUM_NET__?: { ips?: string[]; port?: number } }).__MOMENTUM_NET__?.port : null) || 8787
  const bestHost = netIps[0] ? `http://${netIps[0]}:${netPort}` : (cfg?.url || (typeof window !== 'undefined' ? window.location.origin : ''))
  const mobilePairUrl = cfg ? `${bestHost}/?key=${encodeURIComponent(cfg.token)}` : ''

  if (!cfg) return (
    <div className="sync-box">
      <p className="small muted">The coach, planner and backups talk to the local server. Run <code>python3 server.py</code> and paste its URL and the key it prints here.</p>
      <Field label="Server URL"><input value={url} onChange={e => setUrl(e.target.value)} placeholder="http://localhost:8787" inputMode="url" /></Field>
      <Field label="Server key"><input value={key} onChange={e => setKey(e.target.value)} placeholder="printed by server.py" /></Field>
      <Btn icon="cloud_sync" disabled={!url || !key} onClick={() => configureSync({ url, token: key })}>Connect</Btn>
    </div>
  )
  return (
    <div className="sync-box">
      <div className="sync-line">
        <Icon n={sync.state === 'error' ? 'sync_problem' : 'cloud_done'} fill />
        <div className="grow">
          <b>{sync.state === 'error' ? 'Not reachable right now' : isFirebaseUrl(cfg.url) ? 'Firebase Cloud Synced' : 'Connected'}</b>
          <div className="small muted">{isFirebaseUrl(cfg.url) ? 'Firebase Realtime DB' : cfg.url}{sync.at ? ` · last synced ${new Date(sync.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}{sync.msg ? ` · ${sync.msg}` : ''}</div>
        </div>
        <Btn kind="tonal" size="sm" icon="sync" onClick={() => syncNow(true)}>Now</Btn>
        <Btn kind="text" size="sm" className="danger" icon="link_off" onClick={() => configureSync(null)}>Disconnect</Btn>
      </div>
      {!isFirebaseUrl(cfg.url) && (
        <div style={{ marginTop: 10 }}>
          <Btn kind="tonal" size="sm" icon="cloud" onClick={() => {
            configureSync(DEFAULT_FIREBASE_CFG)
            toast('Switched to Firebase Cloud Sync!', 'cloud_done')
          }}>Switch to Firebase Cloud Sync (Recommended)</Btn>
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--outline-variant, rgba(255,255,255,0.1))' }}>
        <div className="small muted" style={{ marginBottom: 8 }}>
          <b>Pair Mobile / Other Devices:</b>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <Btn kind="tonal" size="sm" icon="content_copy" onClick={() => {
            navigator.clipboard.writeText(mobilePairUrl)
            toast('Mobile pairing link copied!', 'content_copy')
          }}>Copy Pairing Link</Btn>
          <Btn kind="tonal" size="sm" icon="qr_code_2" onClick={() => setShowQR(v => !v)}>
            {showQR ? 'Hide QR' : 'Show Pairing QR'}
          </Btn>
        </div>
        {showQR && (
          <div style={{ marginTop: 12, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', background: '#ffffff', padding: '12px', borderRadius: 12 }}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(mobilePairUrl)}`}
              alt="Scan to pair phone"
              width={160}
              height={160}
              style={{ display: 'block' }}
            />
            <span style={{ color: '#111', fontSize: 11, fontWeight: 700, marginTop: 6 }}>Scan with Phone Camera</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** exam weeks / breaks: the current or next season, a quick exam-season form, delete. Every target in the app follows it */
const fmtDay = (k: string) => keyToDate(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
function SeasonSection() {
  useStore(s => s.seasons) // re-render on season edits (here or synced)
  const today = dateKey(), list = upcomingSeasons(undefined, today)
  const [form, setForm] = useState(false), [from, setFrom] = useState(today), [until, setUntil] = useState(addDays(today, 14))
  const [cp, setCp] = useState<number>(EXAM_DEFAULTS.cpMin), [mock, setMock] = useState(false), [rounds, setRounds] = useState<Season['contests']>(EXAM_DEFAULTS.contests)
  const save = () => {
    if (!from || !until || until < from) { toast('The season needs a start and an end on or after it', 'error'); return }
    setSeason(makeSeason({ kind: 'exam', from, until, cpMin: cp, mock, contests: rounds })); setForm(false)
    toast(`Exam season set: ${fmtDay(from)} – ${fmtDay(until)} · ${fmtDur(cp)} CP a day`, 'school')
  }
  return <div className="sync-box">
    {list.length ? list.slice(0, 3).map(x => (
      <div key={x.id} className="sync-line">
        <Icon n={x.kind === 'exam' ? 'school' : 'beach_access'} fill />
        <div className="grow">
          <b>{seasonLabel(x)}{x.from <= today ? ' · now' : ''}</b>
          <div className="small muted">{fmtDay(x.from)} – {fmtDay(x.until)} · {x.cpMin ? fmtDur(x.cpMin) + ' CP a day' : 'no CP target'} · {x.mock ? 'daily mock' : 'no mock'} · rated rounds {x.contests}{x.note ? ` · ${x.note}` : ''}</div>
        </div>
        <Btn kind="text" size="sm" className="danger" icon="delete" onClick={() => { void confirmAsk({ title: `Delete this ${seasonLabel(x).toLowerCase()}?`, body: 'Days in it go back to the normal 4.5 h + mock target.', danger: true }).then(ok => { if (ok) deleteSeason(x.id) }) }}>Delete</Btn>
      </div>
    )) : <p className="small muted">No season set: every day targets 4.5 h practice + a 2 h mock and every rated round. Set exam weeks here (or tell the planner) and the targets, discipline, planner and coach all go light for those days.</p>}
    {!form ? <Btn kind="tonal" size="sm" icon="school" onClick={() => setForm(true)}>Exam season…</Btn> : <>
      <div className="row wrap">
        <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="Until (inclusive)"><input type="date" value={until} min={from} onChange={e => setUntil(e.target.value)} /></Field>
      </div>
      <div className="field-label">CP practice a day</div>
      <Chips value={cp} onChange={setCp} options={[0, 30, 45, 60, 90].map(v => ({ v, label: v ? v + ' min' : 'none' }))} />
      <Switch on={mock} onChange={setMock} label="Daily mock contest" />
      <div className="field-label">Rated rounds</div>
      <Chips value={rounds} onChange={setRounds} options={[{ v: 'optional' as const, label: 'Optional' }, { v: 'all' as const, label: 'All (mandatory)' }, { v: 'none' as const, label: 'None' }]} />
      <div className="row wrap">
        <Btn icon="check" onClick={save}>Save season</Btn>
        <Btn kind="text" onClick={() => setForm(false)}>Cancel</Btn>
      </div>
    </>}
  </div>
}

function InstallSection() {
  const can = useCanInstall()
  if (isStandalone()) return <p className="small muted"><Icon n="check_circle" fill /> Running as an installed app.</p>
  if (can) return <Btn icon="install_mobile" onClick={install}>Install Momentum as an app</Btn>
  return <p className="small muted"><Icon n="install_mobile" /> {isIOS() ? 'On iPhone: tap Share → “Add to Home Screen”.' : 'Use your browser menu → “Install app” / “Add to Home screen”. (Needs the app to be served over HTTPS.)'}</p>
}

function useDark() {
  const mode = useStore(s => s.settings.mode)
  const [sys, setSys] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => { const m = matchMedia('(prefers-color-scheme: dark)'), f = () => setSys(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return mode === 'system' ? sys : mode === 'dark'
}

function PresetCard({ p, on, dark }: { p: Preset; on: boolean; dark: boolean }) {
  const c = previewColors(p.seed, p.style, dark, p.contrast ?? 0, dark && !!p.amoled)
  return (
    <motion.button type="button" className={'preset' + (on ? ' on' : '')} whileTap={{ scale: 0.95 }} transition={spring} aria-pressed={on}
      onClick={() => { sfx.tap(); setSettings({ seed: p.seed, style: p.style, contrast: p.contrast ?? 0, amoled: !!p.amoled, preset: p.id, tierTheme: false }) }}>
      <div className="preset-sw" style={{ background: c.surfaceContainer }}>
        <i style={{ background: c.primary }} /><i style={{ background: c.secondary }} /><i style={{ background: c.tertiary }} /><i style={{ background: c.primaryContainer }} /><i style={{ background: c.surface, boxShadow: `inset 0 0 0 1px ${c.secondary}55` }} />
      </div>
      <div className="preset-n">{on && <Icon n="check" />}<span>{p.name}</span></div>
    </motion.button>
  )
}

function ThemeSection() {
  const st = useStore(s => s.settings)
  const dark = useDark()
  const rating = useCf().user?.rating || 0
  const seed = st.tierTheme ? tierSeed(rating) : st.seed
  const con = st.contrast ?? 0
  const custom = (patch: Parameters<typeof setSettings>[0]) => setSettings({ ...patch, preset: undefined })
  return <>
    <div className="field-label">Theme</div>
    <Chips value={st.mode} onChange={m => setSettings({ mode: m })} options={[{ v: 'system', label: 'System', icon: 'contrast' }, { v: 'light', label: 'Light', icon: 'light_mode' }, { v: 'dark', label: 'Dark', icon: 'dark_mode' }]} />
    <div className="field-label">Presets</div>
    <div className="preset-grid">{PRESETS.map(p => <PresetCard key={p.id} p={p} dark={dark} on={!st.tierTheme && st.preset === p.id} />)}</div>
    <Switch on={!!st.tierTheme} onChange={v => setSettings({ tierTheme: v })} label="Rank colours" />
    <div className="switch-hint">The app takes your Codeforces rank colour and changes when you rank up.</div>
    <div className={st.tierTheme ? 'switch-off' : ''}>
      <div className="field-label">Seed colour</div>
      <div className="swatches">
        {SEEDS.map(c => <button key={c} className={'sw' + (st.seed.toLowerCase() === c.toLowerCase() ? ' on' : '')} style={{ background: c }} onClick={() => custom({ seed: c })} aria-label={`Colour ${c}`} aria-pressed={st.seed.toLowerCase() === c.toLowerCase()}>{st.seed.toLowerCase() === c.toLowerCase() && <Icon n="check" />}</button>)}
        <label className="sw custom" title="Custom colour"><Icon n="palette" /><input type="color" aria-label="Custom colour" value={st.seed} onChange={e => custom({ seed: e.target.value })} /></label>
      </div>
    </div>
    <div className="field-label">Colour style</div>
    <div className="style-row" role="radiogroup" aria-label="Colour style">
      {STYLES.map(o => { const c = previewColors(seed, o.v, dark, con), on = st.style === o.v
        return <motion.button type="button" role="radio" aria-checked={on} key={o.v} className={'chip' + (on ? ' on' : '')} whileTap={{ scale: 0.92 }} transition={spring} onClick={() => { sfx.tap(); custom({ style: o.v }) }}>
          <span className="dots3"><i style={{ background: c.primary }} /><i style={{ background: c.secondary }} /><i style={{ background: c.tertiary }} /></span>{o.label}
        </motion.button> })}
    </div>
    <div className="field-label">Contrast</div>
    <Chips value={con} onChange={v => custom({ contrast: v })} options={[{ v: 0 as const, label: 'Standard' }, { v: 0.5 as const, label: 'Medium' }, { v: 1 as const, label: 'High' }]} />
    <div className={dark ? '' : 'switch-off'}><Switch on={!!st.amoled} onChange={v => custom({ amoled: v })} label="AMOLED black" /></div>
    <div className="switch-hint">{dark ? 'Pure black backgrounds — saves battery on OLED screens.' : 'Only applies in dark mode.'}</div>
  </>
}

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = useStore(s => s.settings)
  const file = useRef<HTMLInputElement>(null)
  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="form">
        <div className="field-label">Local server</div>
        <SyncSection />
        <div className="field-label">Season — exam weeks lighten every target</div>
        <SeasonSection />
        <div className="field-label">App</div>
        <InstallSection />
        <Field label="Your name"><input value={st.name} onChange={e => setSettings({ name: e.target.value })} placeholder="What should I call you?" /></Field>
        <div className="field-label">Daily work target (deep work + study + admin)</div>
        <Chips value={st.workTarget} onChange={t => setSettings({ workTarget: t })} options={[3, 4, 5, 6, 7, 8, 10, 12].map(v => ({ v, label: v + 'h' }))} />
        <div className="field-label">Calorie Scanner AI (Snap Meal)</div>
        <div className="sync-box">
          <p className="small muted" style={{ marginTop: 0 }}>Used by Snap Meal to detect dishes & calories from food photos. Get a free Gemini key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>aistudio.google.com/apikey</a>.</p>
          <Chips value={st.visionProvider || 'gemini'} onChange={v => setSettings({ visionProvider: v })} options={[{ v: 'gemini' as const, label: 'Gemini (Free)' }, { v: 'openai' as const, label: 'OpenAI' }]} />
          <Field label={(st.visionProvider || 'gemini') === 'gemini' ? 'Gemini API key' : 'OpenAI API key'}>
            <input type="password" value={st.visionKey || ''} onChange={e => setSettings({ visionKey: e.target.value })} placeholder={(st.visionProvider || 'gemini') === 'gemini' ? 'AIzaSy...' : 'sk-...'} />
          </Field>
        </div>
        <div className="field-label">Streak strictness — % of tasks needed to keep a day</div>
        <Chips value={st.threshold} onChange={t => setSettings({ threshold: t })} options={[60, 70, 80, 90, 100].map(v => ({ v, label: v + '%' }))} />
        <ThemeSection />
        <div className="field-label">Pomodoro (work / break)</div>
        <Chips value={`${st.pomoWork ?? 50}/${st.pomoBreak ?? 10}`} onChange={v => { const [w, b] = v.split('/').map(Number); setSettings({ pomoWork: w, pomoBreak: b, pomoLong: b * 2 }) }} options={['25/5', '50/10', '90/15'].map(v => ({ v, label: v }))} />
        <Switch on={st.autoBreak !== false} onChange={v => setSettings({ autoBreak: v })} label="Automatic breaks in Focus mode, Pomodoro and CP practice / free solve / drills" />
        {st.autoBreak !== false && <>
          <div className="field-label">Break after this much work</div>
          <Chips value={st.breakEvery ?? 55} onChange={v => setSettings({ breakEvery: v })} options={[45, 50, 55, 60, 90].map(v => ({ v, label: v + ' min' }))} />
          <div className="field-label">Break length</div>
          <Chips value={st.breakLen ?? 5} onChange={v => setSettings({ breakLen: v })} options={[5, 10, 15].map(v => ({ v, label: v + ' min' }))} />
        </>}
        <p className="small muted">The timer stops during a break and it's logged as a break, not work. Pomodoro takes it inside a work phase longer than this (90/15); shorter phases keep their own cycle. Mock rounds, real virtual rounds and live contests never break (real contest timing).</p>
        <div className="field-label">Discipline bar — the day score you must hit to keep discipline rising</div>
        <Chips value={st.disciplineBar ?? 85} onChange={v => setSettings({ disciplineBar: v })} options={[75, 85, 95].map(v => ({ v, label: v + '%' }))} />
        <Switch on={st.coachAutoAdd !== false} onChange={v => setSettings({ coachAutoAdd: v })} label="Coach's assignments go straight into Today" />
        <Switch on={st.sound} onChange={v => setSettings({ sound: v })} label="Sound effects" />
        <Switch on={st.haptics} onChange={v => setSettings({ haptics: v })} label="Haptics (supported browsers)" />
        {'Notification' in window && <Btn kind="outlined" icon="notifications_active" onClick={async () => {
          const p = await Notification.requestPermission()
          toast(p === 'granted' ? 'Reminders on — pinged at every block start and at 21:00 if your streak is at risk' : 'Notifications blocked in browser settings', p === 'granted' ? 'notifications_active' : 'notifications_off')
        }}>Enable block reminders</Btn>}
        <div className="field-label">Backup</div>
        <div className="row wrap">
          <Btn kind="tonal" icon="download" onClick={dl}>Export</Btn>
          <Btn kind="tonal" icon="upload" onClick={() => file.current?.click()}>Import</Btn>
        </div>
        <input ref={file} type="file" accept="application/json" hidden onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return
          try { importData(await f.text()); toast('Backup merged in', 'cloud_done') } catch { toast('That file is not a Momentum backup', 'error') }
          e.target.value = ''
        }} />
        <ResetZone onDone={onClose} />
      </div>
    </Sheet>
  )
}

function dl() {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([exportData()], { type: 'application/json' }))
  a.download = `momentum-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click()
}

/** start over everywhere: typed confirmation, optional keep-appearance, offers a backup first */
function ResetZone({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false), [keep, setKeep] = useState(true), [typed, setTyped] = useState(''), [busy, setBusy] = useState(false)
  const synced = !!getSyncCfg()
  const go = async () => {
    setBusy(true)
    const notes = await resetEverything(keep)
    toast(notes.length ? `Reset done here; couldn't reach the server for: ${notes.join(', ')}. It will follow when the server is reachable again.` : 'Everything reset. Fresh start.', 'restart_alt')
    onDone(); setTimeout(() => location.reload(), 600)
  }
  return (
    <div className="reset-zone">
      <div className="field-label">Start over</div>
      {!open ? <Btn kind="text" icon="restart_alt" className="danger" onClick={() => setOpen(true)}>Reset everything…</Btn> : (
        <div className="reset-card">
          <p className="small"><b>This erases everything:</b> tasks, plans, routine, goals, streaks, XP, discipline, your Codeforces link and all trainer data (attempts, mocks, ideas, rivals), and the coach's and planner's memory{synced ? ' — in this browser and on the server' : ' in this browser'}. It can't be undone.</p>
          <p className="small muted">Your Codeforces account itself is untouched; relink it to rebuild your skill from your submissions. Export a backup first if you might want it back.</p>
          <label className="row small"><input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} /> Keep my appearance and timer settings</label>
          <input className="cf-input" aria-label="Type RESET to confirm" placeholder="Type RESET to confirm" value={typed} onChange={e => setTyped(e.target.value)} autoCapitalize="characters" />
          <div className="row wrap">
            <Btn kind="tonal" icon="download" onClick={dl}>Export backup first</Btn>
            <Btn icon="restart_alt" className="danger-fill" disabled={typed.trim() !== 'RESET' || busy} onClick={go}>{busy ? 'Resetting…' : 'Reset everything'}</Btn>
            <Btn kind="text" onClick={() => { setOpen(false); setTyped('') }}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  )
}
