import { Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import React from 'react'

dayjs.extend(customParseFormat)

const { Text } = Typography

function parseDateTime(raw: string | null | undefined): dayjs.Dayjs | null {
  const s = String(raw ?? '').trim().replace('T', ' ')
  if (!s) return null
  const formats = ['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm', 'YYYY-MM-DD']
  for (const f of formats) {
    const d = dayjs(s, f, true)
    if (d.isValid()) return d
  }
  const loose = dayjs(s)
  return loose.isValid() ? loose : null
}

function formatDurationCompact(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}天`)
  if (hours > 0) parts.push(`${hours}小时`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}分`)
  return parts.join('')
}

/** 超时完成时长，如「3天11小时1分」 */
export function formatOverdueDurationCompact(
  dueAt: string | null | undefined,
  completedAt: string | null | undefined,
): string | null {
  const due = parseDateTime(dueAt)
  const done = parseDateTime(completedAt)
  if (!due || !done || !done.isAfter(due)) return null

  const totalMinutes = Math.floor(done.diff(due, 'minute', true))
  if (totalMinutes <= 0) return null
  return formatDurationCompact(totalMinutes)
}

/** 截止前完成时的剩余时间，如「3天11小时1分」 */
export function formatRemainingBeforeDueCompact(
  dueAt: string | null | undefined,
  completedAt: string | null | undefined,
): string | null {
  const due = parseDateTime(dueAt)
  const done = parseDateTime(completedAt)
  if (!due || !done || !done.isBefore(due)) return null

  const totalMinutes = Math.floor(due.diff(done, 'minute', true))
  if (totalMinutes <= 0) return null
  return formatDurationCompact(totalMinutes)
}

export function isOverdueCompletion(
  dueAt: string | null | undefined,
  completedAt: string | null | undefined,
  completedOverdue?: boolean,
): boolean {
  if (completedOverdue === true) return true
  if (completedOverdue === false) return false
  return formatOverdueDurationCompact(dueAt, completedAt) != null
}

export function getCompletionTimingDuration(
  dueAt: string | null | undefined,
  completedAt: string | null | undefined,
  completedOverdue: boolean,
): string | null {
  if (!completedAt) return null
  if (completedOverdue) return formatOverdueDurationCompact(dueAt, completedAt)
  return formatRemainingBeforeDueCompact(dueAt, completedAt)
}

/** 提前/超时 + 时长 Tag + 完成 */
export const CompletionTimingCell: React.FC<{
  dueAt: string | null | undefined
  completedAt: string | null | undefined
  completedOverdue: boolean
}> = ({ dueAt, completedAt, completedOverdue }) => {
  const overdue =
    completedOverdue ||
    (completedAt != null && formatOverdueDurationCompact(dueAt, completedAt) != null)
  const duration = overdue
    ? formatOverdueDurationCompact(dueAt, completedAt)
    : formatRemainingBeforeDueCompact(dueAt, completedAt)

  if (!duration || !completedAt) return <Text type="secondary">—</Text>

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 4,
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <Text style={{ fontSize: 12 }}>{overdue ? '超时' : '提前'}</Text>
      <Tag bordered={false} color={overdue ? 'orange' : 'blue'} style={{ marginInlineEnd: 0 }}>
        {duration}
      </Tag>
      <Text style={{ fontSize: 12 }}>完成</Text>
    </span>
  )
}
