/** 上传前在浏览器侧压缩大图，减轻带宽与后端压力（后端仍会再做无损/有损处理） */
const DEFAULT_MAX_EDGE = 1920
const DEFAULT_QUALITY = 0.82

function loadImageFromObjectUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

/** 将常见位图压缩为 JPEG（保持动画 GIF 原样返回） */
export async function compressImageForUpload(
  file: File,
  options?: { maxEdge?: number; quality?: number },
): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/gif') return file

  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE
  const quality = options?.quality ?? DEFAULT_QUALITY

  const srcUrl = URL.createObjectURL(file)
  try {
    const img = await loadImageFromObjectUrl(srcUrl)
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return file

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    const maxDim = Math.max(w, h)
    const scale = maxDim > maxEdge ? maxEdge / maxDim : 1
    const outW = Math.max(1, Math.round(w * scale))
    const outH = Math.max(1, Math.round(h * scale))
    canvas.width = outW
    canvas.height = outH
    ctx.drawImage(img, 0, 0, outW, outH)

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
    if (!blob) return file

    const base = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(srcUrl)
  }
}

export async function compressImageFilesForUpload(files: File[]): Promise<File[]> {
  const out: File[] = []
  for (const f of files) {
    out.push(await compressImageForUpload(f))
  }
  return out
}
