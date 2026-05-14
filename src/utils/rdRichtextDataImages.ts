/**
 * 研发富文本：处理正文中的 data:image 内联图（后端禁止落库 base64）。
 */

/** 与后端 bodyHtmlContainsInlineDataImage 一致，略放宽边界（不依赖 \\b） */
export function rdBodyHtmlContainsDataImage(html: string): boolean {
  return /data:\s*image\//i.test(String(html ?? ''))
}

function stripDataImageUrlsFromStyleAttr(style: string): string {
  if (!style || !/data:\s*image\//i.test(style)) return style
  let s = style.replace(/url\s*\(\s*["']?data:image[^)]*\)/gi, 'none')
  s = s.replace(/\s*;\s*;/g, ';').replace(/^\s*;\s*|\s*;\s*$/g, '').trim()
  return s
}

function stripDataImageFromAllInlineStyles(root: Element): void {
  root.querySelectorAll('[style]').forEach((el) => {
    const st = el.getAttribute('style')
    if (!st || !/data:\s*image\//i.test(st)) return
    const next = stripDataImageUrlsFromStyleAttr(st)
    if (next) el.setAttribute('style', next)
    else el.removeAttribute('style')
  })
}

function collectDataImageElements(root: Element): HTMLImageElement[] {
  return Array.from(root.querySelectorAll('img')).filter((n) => {
    const src = n.getAttribute('src') || ''
    return /^data:image\//i.test(src)
  }) as HTMLImageElement[]
}

/** 不经过 fetch(data:)，避免部分浏览器 / 扩展 / 策略下 “Failed to fetch” */
function dataImageUrlToFile(dataUrl: string, index: number): File {
  const s = String(dataUrl ?? '').trim()
  if (!/^data:image\//i.test(s)) {
    throw new Error('不是 data:image URL')
  }
  const comma = s.indexOf(',')
  if (comma === -1) {
    throw new Error('data URL 缺少逗号后的数据段')
  }
  const meta = s.slice('data:'.length, comma)
  const payload = s.slice(comma + 1)
  if (!payload) {
    throw new Error('data URL 数据为空')
  }
  const isBase64 = /;base64/i.test(meta)
  const semi = meta.indexOf(';')
  const mime = (semi === -1 ? meta : meta.slice(0, semi)).trim() || 'image/png'
  if (!mime.toLowerCase().startsWith('image/')) {
    throw new Error(`非图片类型: ${mime}`)
  }

  let bytes: Uint8Array
  try {
    if (isBase64) {
      const b64 = payload.replace(/\s/g, '')
      const bin = atob(b64)
      bytes = new Uint8Array(bin.length)
      for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j)
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload))
    }
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : '无法解码 data URL')
  }

  const mt = mime.toLowerCase()
  const ext = mt.includes('png')
    ? 'png'
    : mt.includes('jpeg') || mt.includes('jpg')
      ? 'jpg'
      : mt.includes('gif')
        ? 'gif'
        : mt.includes('webp')
          ? 'webp'
          : mt.includes('svg')
            ? 'svg'
            : 'png'

  return new File([new Uint8Array(bytes)], `inline-${index}.${ext}`, { type: mime })
}

/**
 * 首次创建文档尚无 id 时，去掉 data:image（img 与 style 中的 url），以便 POST 通过校验。
 */
export function rdStripInlineDataImagesForCreate(html: string): string {
  if (!html || !rdBodyHtmlContainsDataImage(html)) return html
  const doc = new DOMParser().parseFromString(`<div class="rd-dpu-root">${html}</div>`, 'text/html')
  const root = doc.querySelector('.rd-dpu-root') ?? doc.body
  collectDataImageElements(root).forEach((img) => {
    img.setAttribute('src', 'about:blank')
  })
  stripDataImageFromAllInlineStyles(root)
  return root.innerHTML
}

/**
 * 将正文中所有 data:image 转为 uploadFile 返回的 URL；任一张失败则抛错。
 */
export async function rdResolveBodyHtmlDataImages(html: string, uploadFile: (file: File) => Promise<string>): Promise<string> {
  if (!html || !rdBodyHtmlContainsDataImage(html)) return html
  const doc = new DOMParser().parseFromString(`<div class="rd-dpu-root">${html}</div>`, 'text/html')
  const root = doc.querySelector('.rd-dpu-root') ?? doc.body
  const imgs = collectDataImageElements(root)

  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i]
    const src = img.getAttribute('src')
    if (!src || !/^data:image\//i.test(src)) continue
    let file: File
    try {
      file = dataImageUrlToFile(src, i)
    } catch (e) {
      throw new Error(`第 ${i + 1} 张内联图无法读取: ${e instanceof Error ? e.message : '未知错误'}`)
    }
    const url = await uploadFile(file)
    if (!url || !String(url).trim()) {
      throw new Error(`第 ${i + 1} 张内联图上传未返回地址`)
    }
    img.setAttribute('src', url)
  }

  stripDataImageFromAllInlineStyles(root)

  const out = root.innerHTML
  if (rdBodyHtmlContainsDataImage(out)) {
    throw new Error('正文中仍含有内联 base64 图片（可能位于样式或其它属性），请删除后重试。')
  }
  return out
}
