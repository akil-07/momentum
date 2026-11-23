import { useEffect, useMemo, useRef, useState } from 'react'
import { ACHIEVEMENTS, addDays, bestWorkDay, totalWork, dateKey, dayPct, getState, keyToDate, levelInfo, qualifies, streakOf, useStore } from '../store'
import { Icon } from './fx'
import { DetailCharts, PeakCharts, ProgressCharts, RivalsCard } from './Charts'
import { Ladder } from './Ladder'
import { Timeline } from './Timeline'
import { Seg } from './Seg'
import { Shape } from './shapes'
import { fmtDay, fmtDur, fmtHours } from '../ui'

type PView = 'ladder' | 'stats' | 'timeline'
const VIEWS: { v: PView; label: string }[] = [{ v: 'ladder', label: 'Ladder' }, { v: 'stats', label: 'Stats & habits' }, { v: 'timeline', label: 'Timeline' }]
/** App keeps 'ladder' | 'stats'; the Timeline segment is held here (App may also pass view="timeline") */
export function Stats({ view: pv = 'ladder', onView }: { view?: PView; onView?: (v: 'ladder' | 'stats') => void }) {
  const [tl, setTl] = useState(false)
  const prev = useRef(pv)
  useEffect(() => { if (prev.current !== pv) { prev.current = pv; setTl(false) } }, [pv])
  const view: PView = tl || pv === 'timeline' ? 'timeline' : pv
  const pickView = (v: PView) => { if (v === 'timeline') setTl(true); else { setTl(false); onView?.(v) } }
  return (
    <div className="view stats">
      <header className="greet"><div><div className="overline">Progress</div><h1 className="display-sm">{view === 'ladder' ? 'Climb the ladder' : view === 'timeline' ? 'What you actually did' : "Look how far you've come"}</h1></div></header>
      <Seg className="tm-seg3" label="Progress view" value={view} onChange={pickView} options={VIEWS} />
      {view === 'ladder' ? <Ladder /> : view === 'timeline' ? <Timeline /> : <StatsView />}
    </div>
  )
}

const MORE_KEY = 'mom.stats.more'
function StatsView() {
  const [more, setMore] = useState(() => { try { return localStorage.getItem(MORE_KEY) === '1' } catch { return false } })
  const toggle = (o: boolean) => { setMore(o); try { localStorage.setItem(MORE_KEY, o ? '1' : '0') } catch { /* private mode */ } }
  return <>
    <ProgressCharts aside={<HabitsCard />} />
    <details className="more-stats" open={more} onToggle={e => toggle(e.currentTarget.open)}>
      <summary><Icon n="insights" fill /><span className="grow"><b>More stats</b><span className="small muted">solves, speed, errors, peak hours, chain, achievements, rivals</span></span><Icon n="expand_more" /></summary>
      {more && <div className="more-body">
        <div className="grid-2"><DetailCharts /></div>
        <div className="overline sect">When you think best</div>
        <PeakCharts />
        <div className="grid-2 top"><ChainCard /><AchievementsCard /></div>
        <RivalsCard />
      </div>}
    </details>
  </>
}

/** streaks, totals and level in one card (the top bar already shows level and discipline) */
function HabitsCard() {
  const days = useStore(s => s.days), frozen = useStore(s => s.frozen), threshold = useStore(s => s.settings.threshold), stats = useStore(s => s.stats), xp = useStore(s => s.xp)
  const h = useMemo(() => {
    const s = getState(), streak = streakOf(s)
    const planned = Object.values(days).filter(d => d.tasks.length).length, kept = Object.keys(days).filter(d => qualifies(s, d)).length
    return { streak, best: Math.max(stats.bestStreak, streak), kept: planned ? Math.round(kept / planned * 100) + '%' : '—', total: totalWork(s), bestDay: bestWorkDay(s) }
  }, [days, frozen, threshold, stats.bestStreak]) // eslint-disable-line react-hooks/exhaustive-deps
  const L = levelInfo(xp)
  const rows: [string, string, string | number][] = [
    ['local_fire_department', 'current streak', h.streak], ['emoji_events', 'best streak', h.best], ['percent', 'days kept', h.kept],
    ['task_alt', 'tasks done', stats.tasksDone], ['verified', 'perfect days', stats.perfectDays], ['work', 'real work, all time', h.total < 60 ? fmtDur(Math.round(h.total)) : fmtHours(h.total)],
    ['trending_up', 'best work day', fmtDur(h.bestDay)], ['timer', 'in focus mode', fmtDur(stats.focusMin)],
  ]
  return (
    <section className="card habits">
      <div className="card-head"><h3 className="title"><Icon n="local_fire_department" fill /> Habits</h3><span className="small muted">Level {L.lvl} · {L.title} · {L.need - L.into} XP to {L.lvl + 1}</span></div>
      <dl className="habit-grid">{rows.map(([ic, l, v]) => <div key={l}><dt><Icon n={ic} fill /> {l}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  )
}

const WEEKS = 18
function ChainCard() {
  const days = useStore(s => s.days), frozen = useStore(s => s.frozen), threshold = useStore(s => s.settings.threshold)
  const k = dateKey()
  const cells = useMemo(() => {
    const s = getState(), start = addDays(k, -(WEEKS * 7 - 1))
    const first = addDays(start, -((keyToDate(start).getDay() + 6) % 7)) // columns are Mon..Sun
    const out: { d: string; lvl: number; fz: boolean }[] = []
    for (let i = 0; ; i++) {
      const d = addDays(first, i); if (d > k) break
      const day = days[d], p = dayPct(day), q = qualifies(s, d)
      out.push({ d, fz: frozen.includes(d), lvl: !day || !day.tasks.length ? 0 : p >= 1 ? 4 : q ? 3 : p >= 0.4 ? 2 : p > 0 ? 1 : 0.5 })
    }
    return out
  }, [days, frozen, threshold, k]) // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState<string | null>(null)
  const hd = sel ? days[sel] : null
  return (
    <section className="card">
      <div className="card-head"><h3 className="title"><Icon n="calendar_month" fill /> Don't break the chain</h3>
        <span className="small muted heat-read" aria-live="polite">{sel ? `${fmtDay(sel)} · ${hd && hd.tasks.length ? Math.round(dayPct(hd) * 100) + '% · ' + hd.xp + ' XP' : 'no plan'}${frozen.includes(sel) ? ' · frozen' : ''}` : `last ${WEEKS} weeks · tap a day`}</span></div>
      <div className="heat" onMouseLeave={() => setSel(null)}>
        {cells.map(c => <div key={c.d} className={`hc l${String(c.lvl).replace('.', '')}` + (c.fz ? ' fz' : '') + (c.d === k ? ' today' : '') + (sel === c.d ? ' sel' : '')}
          onMouseEnter={() => setSel(c.d)} onClick={() => setSel(x => x === c.d ? null : c.d)} />)}
      </div>
      <div className="legend small muted">less <i className="hc l0" /><i className="hc l1" /><i className="hc l2" /><i className="hc l3" /><i className="hc l4" /> perfect · <i className="hc fz" /> frozen</div>
    </section>
  )
}

function AchievementsCard() {
  const got = useStore(s => s.achievements)
  return (
    <section className="card">
      <div className="card-head"><h3 className="title"><Icon n="military_tech" fill /> Achievements</h3><span className="small muted">{got.length}/{ACHIEVEMENTS.length}</span></div>
      <div className="ach-grid">
        {ACHIEVEMENTS.map(a => {
          const on = got.includes(a.id)
          return (
            <div key={a.id} className={'ach' + (on ? ' on' : '')}>
              <div className="ach-ic"><Shape shape={on ? 'burst' : 'cookie6'} size={100} spin={on ? 10 : 0} /><Icon n={on ? a.icon : 'lock'} fill /></div>
              <div className="ach-t">{a.title}</div><div className="small muted">{a.desc}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
