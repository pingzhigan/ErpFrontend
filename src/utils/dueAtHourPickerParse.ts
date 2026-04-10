import dayjs, { type Dayjs } from 'dayjs'

/** 将接口返回的 due 字符串解析为「整点」DatePicker 用的 Dayjs（支持 `HH:mm` / `HH:mm:ss` / ISO） */
export function parseDueAtHourPickerValue(due_at: string | null | undefined): Dayjs | undefined {
  if (!due_at?.trim()) return undefined
  const s = due_at.trim().replace('T', ' ')
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/)
  if (m) {
    const hh = String(Math.min(23, Math.max(0, parseInt(m[2], 10)))).padStart(2, '0')
    const mm = m[3].padStart(2, '0')
    const d = dayjs(`${m[1]} ${hh}:${mm}`, 'YYYY-MM-DD HH:mm', true)
    if (d.isValid()) return d.startOf('hour')
  }
  const d0 = dayjs(s.slice(0, 10), 'YYYY-MM-DD', true)
  return d0.isValid() ? d0.startOf('day').hour(18).minute(0).second(0).millisecond(0) : undefined
}
