export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const { base64, mime, provider, apiKey, prompt } = req.body || {}
    const key = String(apiKey || '').replace(/\s+/g, '')
    if (!key) return res.status(400).json({ error: 'Missing API key' })
    if (!base64) return res.status(400).json({ error: 'Missing image data' })

    if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          }],
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || `OpenAI error (${r.status})` })
      return res.status(200).json({ text: data.choices?.[0]?.message?.content || '' })
    }

    // Gemini: try gemini-2.5-flash, fallback to gemini-2.0-flash if needed
    for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash']) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.ok) {
        return res.status(200).json({ text: data.candidates?.[0]?.content?.parts?.[0]?.text || '' })
      }
      if (r.status !== 404 && model === 'gemini-2.5-flash') {
        return res.status(r.status).json({ error: data?.error?.message || `Gemini error (${r.status})` })
      }
    }
    return res.status(500).json({ error: 'Gemini request failed' })
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Vision proxy error' })
  }
}
