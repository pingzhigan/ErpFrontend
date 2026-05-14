/**
 * 富文本中 /api/.../preview 图片：浏览器 img 请求无法带 Authorization，需用 query 携带 JWT；
 * 落库前必须 strip，避免把 token 写入数据库。
 */

function withPreviewAccessTokenOnUrl(src: string, token: string | undefined): string {
  const t = token?.trim()
  if (!t) return src
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost.invalid'
  try {
    const u = new URL(src, base)
    if (!/\/preview$/i.test(u.pathname)) return src
    if (u.searchParams.has('access_token')) return src
    u.searchParams.set('access_token', t)
    return u.pathname + (u.searchParams.toString() ? `?${u.searchParams.toString()}` : '')
  } catch {
    return src
  }
}

/** 为所有指向 *\/preview 的 img[src] 追加 access_token（供浏览器加载） */
export function appendAccessTokenToImgPreviewUrls(html: string | undefined, token: string | undefined): string {
  if (!html || !token?.trim()) return html || ''
  const doc = new DOMParser().parseFromString(`<div class="rd-apu-root">${html}</div>`, 'text/html')
  const root = doc.querySelector('.rd-apu-root') ?? doc.body
  for (const img of Array.from(root.querySelectorAll('img[src]'))) {
    const src = img.getAttribute('src')
    if (!src) continue
    const next = withPreviewAccessTokenOnUrl(src, token)
    if (next !== src) img.setAttribute('src', next)
  }
  return root.innerHTML
}

/** 保存 / 上传正文前移除 img 上的 access_token，避免入库或泄露 */
export function stripAccessTokenFromImgPreviewUrls(html: string | undefined): string {
  if (!html) return ''
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost.invalid'
  const doc = new DOMParser().parseFromString(`<div class="rd-spu-root">${html}</div>`, 'text/html')
  const root = doc.querySelector('.rd-spu-root') ?? doc.body
  for (const img of Array.from(root.querySelectorAll('img[src]'))) {
    const src = img.getAttribute('src')
    if (!src || !src.includes('access_token')) continue
    try {
      const u = new URL(src, base)
      if (!u.searchParams.has('access_token')) continue
      u.searchParams.delete('access_token')
      const q = u.searchParams.toString()
      img.setAttribute('src', u.pathname + (q ? `?${q}` : ''))
    } catch {
      continue
    }
  }
  return root.innerHTML
}

/** 单条图片 URL（工具栏上传返回的相对路径） */
export function appendAccessTokenToSinglePreviewUrl(url: string, token: string | undefined): string {
  return withPreviewAccessTokenOnUrl(url, token)
}
