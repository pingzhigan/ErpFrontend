/**
 * 研发文档阅读页：为正文中的 h1–h3 补齐稳定 id，并生成目录项（用于锚点滚动）。
 */

export type RdDocTocItem = { id: string; text: string; level: 1 | 2 | 3 }

function headingLevel(tag: string): 1 | 2 | 3 | null {
  const t = tag.toLowerCase()
  if (t === 'h1') return 1
  if (t === 'h2') return 2
  if (t === 'h3') return 3
  return null
}

/**
 * @param html 已通过业务侧 sanitize 的 HTML 片段
 * @returns 带 id 的正文 HTML（不含外层包裹）与目录列表
 */
export function prepareRdDocArticleHtmlAndToc(html: string): { htmlWithIds: string; toc: RdDocTocItem[] } {
  const raw = html || ''
  const doc = new DOMParser().parseFromString(`<div class="rd-toc-parse-root">${raw}</div>`, 'text/html')
  const root = doc.querySelector('.rd-toc-parse-root')
  if (!root) return { htmlWithIds: raw, toc: [] }

  const used = new Set<string>()
  const toc: RdDocTocItem[] = []
  let seq = 0

  for (const el of Array.from(root.querySelectorAll('h1, h2, h3'))) {
    const level = headingLevel(el.tagName)
    if (level == null) continue

    let id = el.getAttribute('id')?.trim() ?? ''
    if (!id || used.has(id)) {
      id = `rd-doc-h-${seq}`
      while (used.has(id)) {
        seq += 1
        id = `rd-doc-h-${seq}`
      }
      el.setAttribute('id', id)
    }
    used.add(id)

    const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (text) toc.push({ id, text, level })
    seq += 1
  }

  return { htmlWithIds: root.innerHTML, toc }
}
