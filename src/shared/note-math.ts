import katex from 'katex'

const cache = new Map<string, string | null>()

export function mathMarkup(tex: string, display: boolean): string | null {
  if (!tex.trim() || tex.length > 4096) return null
  const key = String(Number(display)) + tex
  if (cache.has(key)) return cache.get(key)!
  let html: string | null = null
  let denied = false
  try {
    const rendered = katex.renderToString(tex, {
      displayMode: display,
      output: 'htmlAndMathml',
      throwOnError: true,
      trust: () => { denied = true; return false },
      maxExpand: 200,
      maxSize: 20,
      macros: {},
    })
    if (!denied) html = rendered
  } catch { /* 公式错误由界面显示固定文案和原式。 */ }
  if (cache.size >= 64) cache.delete(cache.keys().next().value!)
  cache.set(key, html)
  return html
}
