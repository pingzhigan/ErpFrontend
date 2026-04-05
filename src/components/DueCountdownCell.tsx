import { theme } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import React, { useEffect, useState } from 'react'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export function useNowEverySecond(): Dayjs {
  const [now, setNow] = useState(() => dayjs())
  useEffect(() => {
    const id = window.setInterval(() => setNow(dayjs()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function parseDueAt(raw: string | null | undefined): Dayjs | null {
  if (raw == null || String(raw).trim() === '') return null
  const d = dayjs(String(raw).trim())
  return d.isValid() ? d : null
}

/** diffMs = due - now；正数为未到期 */
function formatCountdown(diffMs: number): { text: string; overdue: boolean } {
  const overdue = diffMs <= 0
  const abs = Math.abs(diffMs)

  if (overdue && abs < 1000) {
    return { text: '已到期', overdue: true }
  }

  if (abs >= ONE_DAY_MS) {
    const totalMin = Math.floor(abs / 60_000)
    const days = Math.floor(totalMin / (24 * 60))
    const hours = Math.floor((totalMin % (24 * 60)) / 60)
    const mins = totalMin % 60
    const parts: string[] = []
    if (days > 0) parts.push(`${days}天`)
    if (hours > 0) parts.push(`${hours}小时`)
    parts.push(`${mins}分钟`)
    const body = parts.join('')
    return { text: overdue ? `已逾期 ${body}` : `剩余 ${body}`, overdue }
  }

  const totalSec = Math.max(0, Math.floor(abs / 1000))
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  let body: string
  if (hours > 0) body = `${hours}小时${mins}分${secs}秒`
  else if (mins > 0) body = `${mins}分${secs}秒`
  else body = `${secs}秒`
  return { text: overdue ? `已逾期 ${body}` : `剩余 ${body}`, overdue }
}

type Props = {
  dueAt: string | null | undefined
  now: Dayjs
}

/** 列表截止时间 + 距截止倒计时（>1 天精确到分钟，≤1 天精确到秒） */
export const DueCountdownCell: React.FC<Props> = ({ dueAt, now }) => {
  const { token } = theme.useToken()
  const due = parseDueAt(dueAt)
  if (!due) {
    return <span>—</span>
  }

  const diffMs = due.diff(now)
  const { text, overdue } = formatCountdown(diffMs)
  const urgent = !overdue && diffMs < ONE_DAY_MS

  const countdownBox = overdue
    ? {
        background: token.colorErrorBg,
        color: token.colorError,
        borderColor: token.colorErrorBorder,
      }
    : urgent
      ? {
          background: token.colorWarningBg,
          color: token.colorWarning,
          borderColor: token.colorWarningBorder,
        }
      : {
          background: token.colorPrimaryBg,
          color: token.colorPrimary,
          borderColor: token.colorPrimaryBorder,
        }

  return (
    <div style={{ lineHeight: 1.45 }}>
      <div style={{ color: token.colorText, fontVariantNumeric: 'tabular-nums' }}>{String(dueAt).trim()}</div>
      <div
        style={{
          marginTop: 6,
          fontSize: token.fontSizeSM,
          fontWeight: token.fontWeightStrong,
          fontVariantNumeric: 'tabular-nums',
          padding: `${token.paddingXXS}px ${token.paddingSM}px`,
          borderRadius: token.borderRadiusSM,
          border: `${token.lineWidth}px ${token.lineType}`,
          boxShadow: token.boxShadowTertiary,
          ...countdownBox,
          width: 'fit-content',
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        {text}
      </div>
    </div>
  )
}
