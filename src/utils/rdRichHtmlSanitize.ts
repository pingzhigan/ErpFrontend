/**
 * 研发富文本 body HTML：DOMPurify 清洗 + 少量业务钩子（危险链接、超大 data 图等）。
 * 建议在保存、预览、下载、从服务端打开文档时调用；编辑态不必每次 onChange 调用，以免与 TipTap 序列化细节不一致。
 */
import DOMPurify from 'dompurify'

/** 与 RdRichHtmlEditor 粘贴压缩上限一致，防止巨型 data URL 卡死页面 */
export const RD_RICH_MAX_DATA_URL_CHARS = 1_100_000

let rdRichDomPurifyHooksRegistered = false

/**
 * 校验并规范化富文本中的链接地址（与工具栏插入逻辑一致）。
 * 仅允许 http(s)、mailto:、以 / 开头的站内绝对路径；禁止 javascript、data、file 等危险协议。
 */
export function sanitizeRichTextLinkHref(input: string): { ok: true; href: string } | { ok: false; message: string } {
  const raw = input.trim()
  if (raw.length === 0) {
    return { ok: false, message: '请输入链接地址' }
  }
  if (raw.length > 2048) {
    return { ok: false, message: '链接过长（最多 2048 个字符）' }
  }
  if (/[\u0000-\u001F\u007F]/.test(raw)) {
    return { ok: false, message: '链接包含非法控制字符' }
  }
  if (/[<>]/.test(raw)) {
    return { ok: false, message: '链接中不允许包含 < 或 >' }
  }
  if (raw.includes('\\')) {
    return { ok: false, message: '链接中不允许使用反斜杠' }
  }

  const schemeHead = /^([a-z][\w+.-]*):/i.exec(raw)
  if (schemeHead) {
    const s = schemeHead[1].toLowerCase()
    if (s === 'javascript' || s === 'data' || s === 'vbscript' || s === 'file' || s === 'blob') {
      return { ok: false, message: `不允许使用 ${s}: 协议的链接` }
    }
  }

  if (raw.startsWith('//')) {
    const rest = raw.slice(2)
    if (!/^[\w.-]+/.test(rest)) {
      return { ok: false, message: '协议相对链接格式无效' }
    }
    try {
      const u = new URL(`https://${rest}`)
      if (u.protocol !== 'https:') return { ok: false, message: '链接格式无效' }
      return { ok: true, href: u.href }
    } catch {
      return { ok: false, message: '链接格式无效' }
    }
  }

  if (/^mailto:/i.test(raw)) {
    const tail = raw.slice('mailto:'.length)
    if (/javascript:/i.test(tail) || /data:/i.test(tail)) {
      return { ok: false, message: '邮箱链接中包含不安全内容' }
    }
    try {
      const u = new URL(raw)
      if (u.protocol !== 'mailto:') return { ok: false, message: '邮箱链接格式无效' }
      return { ok: true, href: u.href }
    } catch {
      return { ok: false, message: '邮箱链接格式无效' }
    }
  }

  if (raw.startsWith('/') && !raw.startsWith('//')) {
    if (!isSafeAbsoluteSitePath(raw)) {
      return { ok: false, message: '路径中包含非法字符' }
    }
    return { ok: true, href: raw }
  }

  let toParse = raw
  if (!/^[a-z][\w+.-]*:/i.test(raw)) {
    toParse = `https://${raw}`
  }
  try {
    const u = new URL(toParse)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, message: '仅支持 http、https、mailto: 或以 / 开头的站内路径' }
    }
    return { ok: true, href: u.href }
  } catch {
    return { ok: false, message: '链接格式无效，请检查域名或路径' }
  }
}

/** 站内绝对路径：禁止 .. 与明显危险字符 */
function isSafeAbsoluteSitePath(v: string): boolean {
  if (!v.startsWith('/') || v.startsWith('//')) return false
  if (v.includes('..')) return false
  if (v.length > 2048) return false
  return /^\/[a-zA-Z0-9\-._~/?#[\]@!$&'()*+,;=%:]*$/i.test(v)
}

function registerRdRichDomPurifyHooks(): void {
  if (rdRichDomPurifyHooksRegistered) return
  rdRichDomPurifyHooksRegistered = true

  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    const tag = node.nodeName
    const name = data.attrName

    if (tag === 'A' && name === 'target') {
      const t = String(data.attrValue ?? '').trim().toLowerCase()
      if (t && t !== '_blank' && t !== '_self') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(data as any).keepAttr = false
      }
      return
    }

    if (tag === 'A' && name === 'href') {
      const v = String(data.attrValue ?? '').trim()
      const r = sanitizeRichTextLinkHref(v)
      if (r.ok) {
        data.attrValue = r.href
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(data as any).keepAttr = false
      }
      return
    }

    /** 超大 data 图、可执行型 data/svg — 其余交给 DOMPurify 默认规则 */
    if (tag === 'IMG' && name === 'src') {
      const v = String(data.attrValue ?? '').trim()
      if (v.startsWith('data:image/svg+xml')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(data as any).keepAttr = false
        return
      }
      if (v.startsWith('data:image/') && v.length > RD_RICH_MAX_DATA_URL_CHARS) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(data as any).keepAttr = false
        return
      }
      return
    }

    /** TipTap 多色高亮：保留 data-color（DOMPurify 默认可能剥掉） */
    if (name === 'data-color' && tag === 'MARK') {
      const v = String(data.attrValue ?? '').trim()
      if (v.length > 0 && v.length < 80 && /^[\w#%,().\s+-]+$/.test(v)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(data as any).forceKeepAttr = true
      }
      return
    }

    /** 富文本内联样式（色/字号/对齐等）：与早期实现一致，仅放行常见安全片段 */
    if (name !== 'style') return
    if (tag !== 'SPAN' && tag !== 'MARK' && tag !== 'H1' && tag !== 'H2' && tag !== 'H3' && tag !== 'P') return
    const raw = String(data.attrValue ?? '').trim()
    if (raw.length === 0 || raw.length > 500) return
    const parts = raw
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    const safePart = (p: string): boolean => {
      const m = /^([\w-]+)\s*:\s*(.+)$/i.exec(p)
      if (!m) return false
      const key = m[1].toLowerCase()
      const val = m[2].trim()
      if (val.length > 120) return false
      if (key === 'color') {
        return val === 'inherit' || /^[\w#%,().\s+-]+$/.test(val)
      }
      if (key === 'background-color') {
        return /^[\w#%,().\s+-]+$/.test(val)
      }
      if (key === 'font-size') {
        return /^\d+(\.\d+)?(px|pt|em|rem|%)$/.test(val)
      }
      if (key === 'text-align' && (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'P')) {
        return /^(left|right|center|justify)$/.test(val)
      }
      return false
    }
    if (parts.length >= 1 && parts.every(safePart)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(data as any).forceKeepAttr = true
    }
  })
}

const RD_RICH_PURIFY_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { html: true },
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'link', 'meta', 'style', 'form'],
}

/**
 * 清洗研发富文本正文 HTML（保存、预览、下载、打开文档时用）。
 * 空片段时返回最小段落，便于 TipTap 挂载。
 */
export function sanitizeRdRichBodyHtml(html: string): string {
  registerRdRichDomPurifyHooks()
  const out = DOMPurify.sanitize(html || '', RD_RICH_PURIFY_CONFIG).trim()
  return out.length > 0 ? out : '<p></p>'
}

/** 与历史命名一致：阅读页等处的预览清洗 */
export const sanitizeRdRichPreviewHtml = sanitizeRdRichBodyHtml
