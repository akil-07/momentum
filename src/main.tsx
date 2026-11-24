import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ensureToday, ensureTreatJar, getState } from './store'
import { applyTheme } from './theme'
import { startSync } from './sync'
import { startTrainerLoop } from './train'
import { startClaude } from './claude'
import { startCoach } from './coach'
import { startPlanner } from './planner'
import { startCoachData } from './coachdata'
import { retireOldGoals } from './store'
import { startArchive } from './archive'
import './styles.css'

ensureToday()
ensureTreatJar()
const st = getState().settings
applyTheme(st.seed, st.mode === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : st.mode === 'dark', st.style)
startSync()
startTrainerLoop()
startClaude()
startCoach()
startPlanner()
startCoachData()
retireOldGoals()
startArchive()
if ('serviceWorker' in navigator && import.meta.env.PROD) addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>)
