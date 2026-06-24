/** 金额展示：null/无效 → —；否则两位小数、千分位 */
export function formatMoney(n: number | null | undefined): string {
  return n != null && Number.isFinite(n)
    ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'
}
