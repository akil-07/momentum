import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { getProb } from '../cf'
import { CODE_CAP, REVIEW_PID_RE, askReview, isSolved, reviewStage } from '../review'
import { Btn, Sheet } from './common'
import { Icon } from './fx'
import '../styles/review.css'

/* ═════════ paste code → coach: hints-first bug hunt, or a review of an AC solution ═════════ */

const STAGE = ['no hints yet', 'tags seen', 'editorial hint seen', 'full editorial unlocked']

/** button that opens a sheet to paste code for a coach bug-hunt / solution review of `pid` */
export function ReviewButton({ pid, sess, solved, size = 'sm' }: { pid: string; sess?: string; solved?: boolean; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false)
  useStore(s => s.cp.events) // re-render when an AC lands
  const ac = solved ?? isSolved(pid)
  return <>
    <Btn kind="tonal" size={size === 'sm' ? 'sm' : undefined} icon={ac ? 'speed' : 'bug_report'} onClick={() => setOpen(true)} title={ac ? 'Ask your coach to review this AC' : 'Paste your code — your coach hunts the bug, hints first'}>
      {ac ? 'Review my AC' : 'Paste my code'}
    </Btn>
    <ReviewSheet open={open} onClose={() => setOpen(false)} pid={pid} sess={sess} solved={solved} />
  </>
}

/** the sheet itself; `pickPid` lets the student type/change the problem id (chat quick action) */
export function ReviewSheet({ open, onClose, pid: pid0 = '', sess, solved, pickPid }: { open: boolean; onClose: () => void; pid?: string; sess?: string; solved?: boolean; pickPid?: boolean }) {
  const [pid, setPid] = useState(pid0)
  const [code, setCode] = useState('')
  const [fix, setFix] = useState(false)
  useEffect(() => { if (open) { setPid(pid0); setFix(false) } }, [open, pid0])
  useStore(s => s.cp.events)
  const P = pid.trim().toUpperCase(), okPid = REVIEW_PID_RE.test(P)
  const S = P === pid0.trim().toUpperCase() ? sess : undefined // another problem: count hints from any session
  const stage = okPid ? reviewStage(P, S) : 0
  const ac = okPid ? (solved ?? isSolved(P)) : false
  const prob = okPid ? getProb(P) : undefined
  const send = () => { if (askReview({ pid: P, code, wantFix: fix && stage >= 3, solved: ac, sess: S })) { setCode(''); onClose() } }
  return (
    <Sheet open={open} onClose={onClose} title={ac ? 'Review my AC solution' : 'Find my bug'}
      actions={<>
        <Btn kind="text" onClick={onClose}>Cancel</Btn>
        <Btn icon="send" disabled={!okPid || !code.trim()} onClick={send}>Send to coach</Btn>
      </>}>
      <div className="review-sheet">
        {pickPid
          ? <label className="review-pid"><span className="small muted">Problem</span><input className="cf-input sm" value={pid} onChange={e => setPid(e.target.value)} placeholder="e.g. 1900A" autoCapitalize="characters" spellCheck={false} /></label>
          : null}
        {okPid && <div className="review-meta small">
          <b>{P}</b>{prob ? <> · {prob.n}{prob.r ? ` · ${prob.r}` : ''}</> : null}
          <span className="review-stage"><Icon n="lightbulb" /> {STAGE[stage]}</span>
        </div>}
        <p className="small muted">{ac
          ? 'Your coach compares it with the editorial: complexity, a cleaner or faster way, and a snippet worth keeping as a template.'
          : 'Hints first: your coach points at where the bug lives, gives a tiny failing test and asks one question. You fix it.'}</p>
        <textarea className="review-code" value={code} onChange={e => setCode(e.target.value.slice(0, CODE_CAP))} placeholder="Paste your full code here…" spellCheck={false} autoCorrect="off" autoCapitalize="off" rows={12} />
        <div className="row review-foot">
          {!ac && <label className={'review-fix small' + (stage < 3 ? ' off' : '')}>
            <input type="checkbox" checked={fix && stage >= 3} disabled={stage < 3} onChange={e => setFix(e.target.checked)} />
            {stage >= 3 ? 'Show me the fix' : 'Hints first — unlocks at full editorial'}
          </label>}
          <span className="grow" />
          <span className={'small ' + (code.length >= CODE_CAP ? 'review-cap' : 'muted')}>{code.length.toLocaleString()}/{CODE_CAP.toLocaleString()}</span>
        </div>
      </div>
    </Sheet>
  )
}
