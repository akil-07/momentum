const DEFAULT_FB_URL = 'https://momentum-cf6fa-default-rtdb.asia-southeast1.firebasedatabase.app'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const key = String(req.query?.key || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '').trim()
    if (!key) return res.status(401).json({ error: 'Missing sync key' })

    const fbUrl = String(req.query?.fb || DEFAULT_FB_URL).replace(/\/+$/, '')
    const endpoint = `${fbUrl}/momentum/${encodeURIComponent(key)}.json`

    const b = req.body || {}
    const now = new Date()
    // Default to IST (+05:30) or provided YYYY-MM-DD date
    const istDate = new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
    const dayKey = String(b.date || istDate).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      return res.status(400).json({ error: 'Bad date' })
    }

    const stepsVal = b.steps !== undefined && b.steps !== null && b.steps !== '' ? Math.max(0, Math.round(Number(b.steps))) : null
    const kcalVal = b.activeKcal !== undefined && b.activeKcal !== null && b.activeKcal !== '' ? Math.max(0, Math.round(Number(b.activeKcal))) : null
    if ((stepsVal !== null && Number.isNaN(stepsVal)) || (kcalVal !== null && Number.isNaN(kcalVal))) {
      return res.status(400).json({ error: 'Invalid steps or activeKcal' })
    }

    const getRes = await fetch(endpoint)
    if (!getRes.ok) return res.status(getRes.status).json({ error: 'Firebase read failed' })
    const cur = await getRes.json()
    let doc = cur?.doc
    if (typeof doc === 'string') {
      try { doc = JSON.parse(doc) } catch { doc = null }
    }
    if (!doc || typeof doc !== 'object') {
      return res.status(409).json({ error: 'Open Momentum once first to initialize state' })
    }

    if (!doc.days) doc.days = {}
    if (!doc.days[dayKey]) {
      doc.days[dayKey] = {
        date: dayKey, tasks: [], del: {}, goals: {}, goalsU: {},
        goalsHit: [], locked: false, perfect: false, quests: [],
        focusBy: {}, bonus: {}, combo: 0, maxCombo: 0, xp: 0, focusMin: 0,
      }
    }

    const nowMs = Date.now()
    if (stepsVal !== null) {
      doc.days[dayKey].steps = stepsVal
      doc.days[dayKey].stepsU = nowMs
    }
    if (kcalVal !== null) {
      doc.days[dayKey].activeKcal = kcalVal
      doc.days[dayKey].activeKcalU = nowMs
    }

    const nextRev = (Number(cur?.rev) || 0) + 1
    const putRes = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: nextRev, doc: JSON.stringify(doc) }),
    })
    if (!putRes.ok) return res.status(putRes.status).json({ error: 'Firebase write failed' })

    return res.status(200).json({
      ok: true,
      date: dayKey,
      steps: doc.days[dayKey].steps,
      activeKcal: doc.days[dayKey].activeKcal,
      rev: nextRev,
    })
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Health sync error' })
  }
}
