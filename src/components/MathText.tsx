import { Fragment, useMemo, type ReactNode } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/* Math in text: Codeforces' $$$…$$$ (inline) and $$$$$$…$$$$$$ (display), $$…$$ (display) and $…$ (inline), rendered with KaTeX (bundled, works
   offline). A bad formula falls back to its source instead of breaking the page. */

const MATH = /(\$\$\$\$\$\$[\s\S]+?\$\$\$\$\$\$|\$\$\$[\s\S]+?\$\$\$|\$\$[\s\S]+?\$\$|\$(?!\s)(?:\\\$|[^$\n])+?(?<!\s)\$)/g
const cache = new Map<string, string>()
function tex(src: string, display: boolean) {
  const k = (display ? 'D' : 'I') + src
  let html = cache.get(k)
  if (html === undefined) {
    try { html = katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' }) }
    catch { html = '' }
    if (cache.size > 2000) cache.clear()
    cache.set(k, html)
  }
  return html
}
/** splits `s` into text and math pieces; `text` renders the plain parts (bold / code / …) */
export function withMath(s: string, text: (t: string, key: number) => ReactNode = t => t): ReactNode[] {
  if (!s.includes('$')) return [<Fragment key={0}>{text(s, 0)}</Fragment>]
  return s.split(MATH).map((p, i) => {
    if (i % 2 === 0) return p ? <Fragment key={i}>{text(p, i)}</Fragment> : null
    const six = p.startsWith('$$$$$$'), display = six || (p.startsWith('$$') && !p.startsWith('$$$'))
    const src = six ? p.slice(6, -6) : p.startsWith('$$$') ? p.slice(3, -3) : display ? p.slice(2, -2) : p.slice(1, -1)
    const html = tex(src.trim(), display)
    return html ? <span key={i} className={display ? 'mx-d' : 'mx'} dangerouslySetInnerHTML={{ __html: html }} /> : <code key={i}>{src}</code>
  })
}
export function MathText({ text }: { text: string }) {
  const out = useMemo(() => withMath(text), [text])
  return <>{out}</>
}

/** a Codeforces statement (as the server keeps it: "## Section" headings, "- " bullets, sample tests verbatim) */
export function Statement({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const out: ReactNode[] = []
    const lines = text.split('\n')
    let inSamples = false, pre: string[] | null = null, list: string[] = []
    const flushList = () => { if (list.length) { out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{withMath(l)}</li>)}</ul>); list = [] } }
    const flushPre = () => { if (pre) { out.push(<pre key={out.length} className="stm-pre">{pre.join('\n').replace(/^\n+|\n+$/g, '')}</pre>); pre = null } }
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '')
      const h = line.match(/^##\s*(.*)$/)
      if (h) {
        flushList(); flushPre()
        const t = h[1].trim()
        if (/^examples?$/i.test(t)) inSamples = true
        else if (/^note$/i.test(t)) inSamples = false
        if (out.length === 0 && /^[A-Z]\d?\.\s/.test(t)) out.push(<h3 key={out.length} className="stm-title">{withMath(t)}</h3>)
        else out.push(<h4 key={out.length} className="stm-h">{t}</h4>)
        if (inSamples && /^(input|output)$/i.test(t)) pre = []
        continue
      }
      if (pre) { pre.push(raw); continue }
      if (!line.trim()) { flushList(); continue }
      if (/^(time|memory) limit per test:|^(input|output): (standard|.*\.txt)/i.test(line)) { out.push(<p key={out.length} className="stm-meta">{line}</p>); continue }
      const li = line.match(/^\s*-\s+(.*)$/)
      if (li) { list.push(li[1]); continue }
      flushList()
      out.push(<p key={out.length}>{withMath(line)}</p>)
    }
    flushList(); flushPre()
    return out
  }, [text])
  return <div className="stm">{blocks}</div>
}
