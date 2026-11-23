import { CoachPanel } from './CoachPanel'
import '../styles/today.css'

/* ═════════ the one-to-one coach: chat on the left; its questions, to-dos, weakness board and notebook on the right ═════════ */
export function Coach(_: { onPomodoro?: () => void }) {
  return (
    <div className="view coach-page">
      <header className="greet"><div><div className="overline">Coach</div><h1 className="display-sm">Talk it through</h1></div></header>
      <CoachPanel />
    </div>
  )
}
