export function formatUserDisplayName(username: string | null | undefined, realName: string | null | undefined): string {
  const un = String(username ?? '').trim()
  if (!un) return '—'
  const rn = String(realName ?? '').trim()
  return rn ? `${rn}（${un}）` : un
}
