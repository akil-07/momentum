export interface DetectedFood {
  id: string
  name: string
  portion: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  qty: number
  keep: boolean
}

export interface FoodAnalysis {
  items: DetectedFood[]
  summary: string
}

/** Resize & compress an image file to a lightweight JPEG base64 string (max 1280px for crisp label text) */
export function compressFoodImage(file: File, maxDim = 1280): Promise<{ base64: string; mime: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas not supported'))
      ctx.drawImage(img, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
      const base64 = dataUrl.split(',')[1]
      resolve({ base64, mime: 'image/jpeg', dataUrl })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read image'))
    }
    img.src = url
  })
}

const NUTRITION_PROMPT = `You are a precision nutritionist AI (like HealthifyMe Snap).
Analyze the image carefully. It will be either:
(A) A **Nutrition Facts / Nutritional Information label** on the back of a packaged food/drink, OR
(B) A **packaged product** (brand/front visible), OR
(C) A **cooked / plated meal**.

Follow these exact rules:
- **IF A NUTRITION LABEL IS VISIBLE (back of packet):**
  - Read the **EXACT printed numbers** directly from the label (Energy/Calories in kcal, Protein in g, Carbohydrates in g, Total Fat in g). Do NOT guess or approximate when exact numbers are printed!
  - If Energy is only given in kJ, convert kJ / 4.184 = kcal.
  - Use the **per serving / per pack** column if shown (e.g., "1 serving (30g)" or "1 pack (50g)"); if only "Per 100g" / "Per 100ml" is printed, use that and clearly state "Per 100g" in \`portion\`.
  - Include the product name if visible (else "Packaged Food (Label)") and mention "Exact values read from nutrition label" in \`summary\`.
- **IF A PACKAGED PRODUCT FRONT IS VISIBLE (no label):**
  - Identify the exact brand/product and pack size if readable, and provide its standard official nutrition values.
- **IF A PLATED / COOKED MEAL:**
  - Identify every distinct food item, side dish, gravy, or beverage visible.
  - Estimate realistic portion sizes (e.g., "2 medium chapatis", "1 katori dal (150g)", "1 cup rice (180g)").
  - Account accurately for Indian (South & North Indian) and global cuisines including cooking oil/ghee/butter.

Return ONLY valid JSON matching this exact structure (no markdown, no extra text):
{
  "summary": "Brief 1-sentence description (or note that exact nutrition label values were read)",
  "items": [
    {
      "name": "Food or product name",
      "portion": "Exact label serving size or estimated serving",
      "kcal": 250,
      "protein": 8,
      "carbs": 35,
      "fat": 7
    }
  ]
}`

function parseResult(rawText: string): FoodAnalysis {
  const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('AI did not return valid food data')
  const parsed = JSON.parse(match[0]) as { summary?: string; items?: Array<Record<string, unknown>> }
  const rawItems = Array.isArray(parsed.items) ? parsed.items : []
  if (!rawItems.length) throw new Error('No food items detected in the photo')

  const items: DetectedFood[] = rawItems.map((it, i) => ({
    id: `snap-${Date.now()}-${i}`,
    name: String(it.name || 'Food item'),
    portion: String(it.portion || '1 serving'),
    kcal: Math.max(0, Math.round(Number(it.kcal) || 0)),
    protein: Math.max(0, Math.round(Number(it.protein) || 0)),
    carbs: Math.max(0, Math.round(Number(it.carbs) || 0)),
    fat: Math.max(0, Math.round(Number(it.fat) || 0)),
    qty: 1,
    keep: true,
  }))

  return {
    summary: String(parsed.summary || 'Detected meal'),
    items,
  }
}

export async function analyzeFoodPhoto(
  base64: string,
  mime: string,
  provider: 'gemini' | 'openai',
  apiKey: string
): Promise<FoodAnalysis> {
  const key = apiKey.replace(/\s+/g, '')
  if (!key) throw new Error('Please add your free Gemini API key first')

  // 1. Try same-origin /api/vision proxy first (avoids iOS Safari CORS / "Load failed" issues on Vercel & local server)
  try {
    const proxyRes = await fetch('/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, mime, provider, apiKey: key, prompt: NUTRITION_PROMPT }),
    })
    const ct = proxyRes.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      const pData = await proxyRes.json() as { text?: string; error?: string }
      if (proxyRes.ok && pData.text) return parseResult(pData.text)
      if (!proxyRes.ok && pData.error && proxyRes.status !== 404) throw new Error(pData.error)
    }
  } catch (e) {
    // Only rethrow real API errors returned from the proxy; network/404 falls through to direct fetch
    if (e instanceof Error && !e.message.includes('Load failed') && !e.message.includes('Failed to fetch')) {
      throw e
    }
  }

  // 2. Direct browser fallback
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: NUTRITION_PROMPT },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(err?.error?.message || `OpenAI API error (${res.status})`)
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const text = data.choices?.[0]?.message?.content || ''
    return parseResult(text)
  }

  // Default: Google Gemini (try 2.5-flash, fallback to 2.0-flash)
  for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash']) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: NUTRITION_PROMPT },
              { inline_data: { mime_type: mime, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    })
    if (res.ok) {
      const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      return parseResult(text)
    }
    if (res.status === 404 && model === 'gemini-2.5-flash') continue
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err?.error?.message || `Gemini API error (${res.status})`)
  }
  throw new Error('Gemini API request failed')
}
