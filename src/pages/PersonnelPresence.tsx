/**
 * 人员在岗状态 — 团队日历：名单来自用户管理；按周一至周日展示；
 * 工作日无记录默认在岗，周日无记录默认休息；格子分「状态 / 说明」两块分别编辑。
 */
import { LeftOutlined, RightOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { App, Alert, Button, Card, Input, Popover, Radio, Space, Table, Typography } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { labelForAssigneeUsername } from '../utils/constructionAssigneeOptions'

const { Title, Text } = Typography

type DayCell = {
  date: string
  weekday_index: number
  weekday_label: string
  status: string
  status_label: string
  remark: string | null
  is_default: boolean
  row_id: number | null
}

type WeekPerson = {
  username: string
  real_name: string | null
  days: DayCell[]
}

type WeekPayload = {
  week_start: string
  week_end: string
  prev_week_start: string
  next_week_start: string
  today_ymd: string
  people: WeekPerson[]
}

type DayStatusKey = 'on_duty' | 'rest' | 'business_trip' | 'leave'

const STATUS_RADIO_OPTIONS: { value: DayStatusKey; label: string }[] = [
  { value: 'on_duty', label: '在岗' },
  { value: 'rest', label: '休息' },
  { value: 'business_trip', label: '出差' },
  { value: 'leave', label: '请假' },
]

function coerceToAllowedDayStatus(status: string): DayStatusKey {
  return STATUS_RADIO_OPTIONS.some((o) => o.value === status) ? (status as DayStatusKey) : 'on_duty'
}

type StatusVisual = {
  border: string
  cardBg: string
  shadow: string
  statusZoneBg: string
  statusText: string
  barColor: string
  remarkZoneBg: string
}

const PP_SOFT_SHADOW = '0 1px 2px 0 var(--ant-color-split, rgba(0,0,0,0.06))'

/**
 * 与 Ant Design / ProLayout 一致的语义色与填充色，低饱和、弱阴影，避免与整站风格冲突。
 */
function getStatusVisual(status: string): StatusVisual {
  const remark = 'var(--ant-color-bg-container, #fff)'
  switch (status) {
    case 'on_duty':
      return {
        border: 'var(--ant-color-success-border, #b7eb8f)',
        cardBg: 'var(--ant-color-success-bg, #f6ffed)',
        shadow: PP_SOFT_SHADOW,
        statusZoneBg: 'var(--ant-color-success-bg-hover, #d9f7be)',
        statusText: 'var(--ant-color-success, #52c41a)',
        barColor: 'var(--ant-color-success, #52c41a)',
        remarkZoneBg: remark,
      }
    case 'rest':
      return {
        border: 'var(--ant-color-border-secondary, #f0f0f0)',
        cardBg: 'var(--ant-color-fill-quaternary, rgba(0,0,0,0.02))',
        shadow: PP_SOFT_SHADOW,
        statusZoneBg: 'var(--ant-color-fill-tertiary, rgba(0,0,0,0.04))',
        statusText: 'var(--ant-color-text-secondary, rgba(0,0,0,0.65))',
        barColor: 'var(--ant-color-text-quaternary, rgba(0,0,0,0.25))',
        remarkZoneBg: remark,
      }
    case 'business_trip':
      return {
        border: 'var(--ant-color-info-border, #91caff)',
        cardBg: 'var(--ant-color-info-bg, #e6f4ff)',
        shadow: PP_SOFT_SHADOW,
        statusZoneBg: 'var(--ant-color-info-bg-hover, #bae0ff)',
        statusText: 'var(--ant-color-info, #1677ff)',
        barColor: 'var(--ant-color-info, #1677ff)',
        remarkZoneBg: remark,
      }
    case 'leave':
      return {
        border: 'var(--ant-color-warning-border, #ffd591)',
        cardBg: 'var(--ant-color-warning-bg, #fffbe6)',
        shadow: PP_SOFT_SHADOW,
        statusZoneBg: 'var(--ant-color-warning-bg-hover, #fff1b8)',
        statusText: 'var(--ant-color-warning, #faad14)',
        barColor: 'var(--ant-color-warning, #faad14)',
        remarkZoneBg: remark,
      }
    default:
      /* 历史数据中的 remote/out/other 等：用中性样式展示 */
      return {
        border: 'var(--ant-color-border-secondary, #f0f0f0)',
        cardBg: 'var(--ant-color-fill-alter, #fafafa)',
        shadow: PP_SOFT_SHADOW,
        statusZoneBg: 'var(--ant-color-fill-tertiary, rgba(0,0,0,0.04))',
        statusText: 'var(--ant-color-text-secondary, rgba(0,0,0,0.65))',
        barColor: 'var(--ant-color-text-quaternary, rgba(0,0,0,0.25))',
        remarkZoneBg: remark,
      }
  }
}

function formatWeekRangeLabel(weekStart: string, weekEnd: string): string {
  const a = weekStart.replace(/-/g, '.')
  const b = weekEnd.replace(/-/g, '.')
  return `${a} ~ ${b}`
}

const WEEK_FALLBACK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

type ActivePopover = { mode: 'status' | 'remark'; username: string; date: string } | null

const outerBoxBase: React.CSSProperties = {
  borderRadius: 8,
  minHeight: 108,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
}

const DayCalendarCell: React.FC<{
  person: WeekPerson
  cell: DayCell
  isToday: boolean
  active: ActivePopover
  setActive: React.Dispatch<React.SetStateAction<ActivePopover>>
  draftStatus: DayStatusKey
  setDraftStatus: React.Dispatch<React.SetStateAction<DayStatusKey>>
  draftRemark: string
  setDraftRemark: React.Dispatch<React.SetStateAction<string>>
  saving: boolean
  onSaveStatus: (username: string, date: string, status: DayStatusKey, remarkKeep: string | null) => Promise<void>
  onSaveRemark: (username: string, date: string, status: string, remark: string | null) => Promise<void>
}> = ({
  person,
  cell,
  isToday,
  active,
  setActive,
  draftStatus,
  setDraftStatus,
  draftRemark,
  setDraftRemark,
  saving,
  onSaveStatus,
  onSaveRemark,
}) => {
  const statusOpen = active?.mode === 'status' && active.username === person.username && active.date === cell.date
  const remarkOpen = active?.mode === 'remark' && active.username === person.username && active.date === cell.date
  const visual = getStatusVisual(cell.status)

  const openStatus = () => {
    setDraftStatus(coerceToAllowedDayStatus(cell.status))
    setActive({ mode: 'status', username: person.username, date: cell.date })
  }

  const openRemark = () => {
    setDraftRemark(cell.remark ?? '')
    setActive({ mode: 'remark', username: person.username, date: cell.date })
  }

  const close = () => setActive(null)

  const statusBody = (
    <div style={{ minWidth: 200, padding: '4px 0' }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        选择当日状态
      </Text>
      <Radio.Group
        optionType="button"
        buttonStyle="solid"
        value={draftStatus}
        onChange={(e) => setDraftStatus(e.target.value as DayStatusKey)}
        style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}
      >
        {STATUS_RADIO_OPTIONS.map((o) => (
          <Radio.Button key={o.value} value={o.value} style={{ width: '100%', textAlign: 'center', height: 36, lineHeight: '34px' }}>
            {o.label}
          </Radio.Button>
        ))}
      </Radio.Group>
      <Space style={{ marginTop: 12, width: '100%', justifyContent: 'flex-end' }}>
        <Button size="small" onClick={close}>
          取消
        </Button>
        <Button
          type="primary"
          size="small"
          loading={saving}
          onClick={() =>
            void onSaveStatus(person.username, cell.date, draftStatus, cell.remark?.trim() ? cell.remark : null)
          }
        >
          确定
        </Button>
      </Space>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 10 }}>
        选择与系统默认一致且说明为空并确定，将清除该日记录：工作日恢复默认在岗，周日恢复默认休息。
      </Text>
    </div>
  )

  const remarkBody = (
    <div style={{ width: 280, padding: '4px 0' }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        编辑说明（可空）
      </Text>
      <Input.TextArea
        rows={4}
        value={draftRemark}
        onChange={(e) => setDraftRemark(e.target.value)}
        maxLength={500}
        showCount
        placeholder=""
      />
      <Space style={{ marginTop: 12, width: '100%', justifyContent: 'flex-end' }}>
        <Button size="small" onClick={close}>
          取消
        </Button>
        <Button
          type="primary"
          size="small"
          loading={saving}
          onClick={() => void onSaveRemark(person.username, cell.date, cell.status, draftRemark.trim() || null)}
        >
          确定
        </Button>
      </Space>
    </div>
  )

  return (
    <div
      style={{
        ...outerBoxBase,
        border: `1px solid ${isToday ? 'var(--ant-color-primary, #1677ff)' : visual.border}`,
        boxShadow: isToday ? `0 0 0 1px var(--ant-color-primary-bg, #e6f4ff), ${visual.shadow}` : visual.shadow,
        background: visual.cardBg,
        position: 'relative',
      }}
      className="pp-cal-cell-wrap"
    >
      <Popover
        trigger="click"
        placement="bottom"
        open={statusOpen}
        onOpenChange={(o) => {
          if (o) openStatus()
          else if (statusOpen) close()
        }}
        content={statusBody}
      >
        <button
          type="button"
          className="pp-cal-status-zone"
          style={{
            flex: 1,
            minHeight: 56,
            width: '100%',
            border: 'none',
            padding: '12px 10px 10px',
            cursor: 'pointer',
            textAlign: 'center',
            background: visual.statusZoneBg,
            borderBottom: '1px dashed var(--ant-color-split, rgba(5,5,5,0.06))',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              height: 4,
              width: '80%',
              maxWidth: 120,
              borderRadius: 2,
              background: visual.barColor,
              opacity: 0.85,
            }}
          />
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.35,
              color: visual.statusText,
            }}
          >
            {cell.status_label}
          </span>
        </button>
      </Popover>
      <Popover
        trigger="click"
        placement="bottom"
        open={remarkOpen}
        onOpenChange={(o) => {
          if (o) openRemark()
          else if (remarkOpen) close()
        }}
        content={remarkBody}
      >
        <button
          type="button"
          className="pp-cal-remark-zone"
          style={{
            flex: 1,
            minHeight: 52,
            width: '100%',
            border: 'none',
            padding: '10px 10px 12px',
            cursor: 'pointer',
            textAlign: 'left',
            background: visual.remarkZoneBg,
            color: cell.remark ? 'var(--ant-color-text-secondary, rgba(0,0,0,0.65))' : 'var(--ant-color-text-quaternary, rgba(0,0,0,0.25))',
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {cell.remark ? cell.remark : ''}
        </button>
      </Popover>
    </div>
  )
}

const PersonnelPresencePage: React.FC = () => {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [weekQuery, setWeekQuery] = useState<string | undefined>(undefined)
  const [week, setWeek] = useState<WeekPayload | null>(null)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<ActivePopover>(null)
  const [draftStatus, setDraftStatus] = useState<DayStatusKey>('on_duty')
  const [draftRemark, setDraftRemark] = useState('')
  const [saving, setSaving] = useState(false)

  const loadWeek = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get<WeekPayload>('/api/personnel-presence/week', {
        params: weekQuery ? { week_start: weekQuery } : {},
      })
      setWeek(data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      message.error(err?.response?.data?.message || '加载失败')
      setWeek(null)
    } finally {
      setLoading(false)
    }
  }, [message, weekQuery])

  useEffect(() => {
    void loadWeek()
  }, [loadWeek])

  const filteredPeople = useMemo(() => {
    const list = week?.people ?? []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((p) => {
      const rn = (p.real_name ?? '').toLowerCase()
      return p.username.toLowerCase().includes(q) || rn.includes(q)
    })
  }, [week, search])

  const onSaveStatus = useCallback(
    async (username: string, date: string, status: DayStatusKey, remarkKeep: string | null) => {
      setSaving(true)
      try {
        await axios.put('/api/personnel-presence/day', {
          username,
          work_date: date,
          status,
          remark: remarkKeep,
        })
        message.success('状态已更新')
        setActive(null)
        await loadWeek()
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string } } }
        message.error(err?.response?.data?.message || '保存失败')
      } finally {
        setSaving(false)
      }
    },
    [loadWeek, message],
  )

  const onSaveRemark = useCallback(
    async (username: string, date: string, status: string, remark: string | null) => {
      setSaving(true)
      try {
        await axios.put('/api/personnel-presence/day', {
          username,
          work_date: date,
          status,
          remark,
        })
        message.success('说明已保存')
        setActive(null)
        await loadWeek()
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string } } }
        message.error(err?.response?.data?.message || '保存失败')
      } finally {
        setSaving(false)
      }
    },
    [loadWeek, message],
  )

  const columns: ColumnsType<WeekPerson> = useMemo(() => {
    const first = week?.people?.[0]
    const dayTitles = first?.days ?? []
    const base: ColumnsType<WeekPerson> = [
      {
        title: (
          <div style={{ padding: '4px 0' }}>
            <Text strong>成员</Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                团队日历
              </Text>
            </div>
          </div>
        ),
        key: 'person',
        fixed: 'left',
        width: 196,
        onHeaderCell: () =>
          ({
            style: {
              background: 'var(--ant-color-fill-alter, #fafafa)',
              verticalAlign: 'middle',
            },
          }) as React.HTMLAttributes<HTMLTableCellElement>,
        onCell: () =>
          ({
            style: {
              background: 'var(--ant-color-fill-alter, #fafafa)',
              verticalAlign: 'top',
              padding: '12px 10px',
            },
          }) as React.HTMLAttributes<HTMLTableCellElement>,
        render: (_, p) => (
          <Text style={{ fontSize: 14, fontWeight: 500 }}>{labelForAssigneeUsername(p.username, p.real_name)}</Text>
        ),
      },
    ]
    for (let i = 0; i < 7; i++) {
      const dt = dayTitles[i]
      const isTodayCol = Boolean(week && dt && dt.date === week.today_ymd)
      const weekend = i >= 5
      base.push({
        title: (
          <div style={{ textAlign: 'center', padding: '6px 4px' }}>
            <Space size={4} style={{ justifyContent: 'center', width: '100%' }}>
              <Text strong style={{ fontSize: 13 }}>
                {dt?.weekday_label ?? WEEK_FALLBACK[i]}
              </Text>
              {i === 6 ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    color: 'var(--ant-color-text-secondary, rgba(0,0,0,0.65))',
                    background: 'var(--ant-color-fill-tertiary, rgba(0,0,0,0.04))',
                    border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
                    borderRadius: 4,
                    padding: '0 6px',
                    lineHeight: '18px',
                  }}
                >
                  默认休
                </span>
              ) : null}
            </Space>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {dt?.date ?? ''}
              </Text>
            </div>
          </div>
        ),
        key: `day-${i}`,
        width: 138,
        align: 'center' as const,
        onHeaderCell: () =>
          ({
            style: {
              background: isTodayCol
                ? 'var(--ant-color-primary-bg, #e6f4ff)'
                : weekend
                  ? 'var(--ant-color-fill-quaternary, rgba(0,0,0,.02))'
                  : 'var(--ant-color-fill-alter, #fafafa)',
              verticalAlign: 'middle',
            },
          }) as React.HTMLAttributes<HTMLTableCellElement>,
        onCell: () =>
          ({
            style: {
              background: isTodayCol
                ? 'var(--ant-color-primary-bg, #e6f4ff)'
                : weekend
                  ? 'var(--ant-color-fill-quaternary, rgba(0,0,0,.02))'
                  : undefined,
              verticalAlign: 'top',
              padding: '10px 8px',
            },
          }) as React.HTMLAttributes<HTMLTableCellElement>,
        render: (_, p) => {
          const cell = p.days[i]
          if (!cell) return null
          return (
            <DayCalendarCell
              person={p}
              cell={cell}
              isToday={isTodayCol}
              active={active}
              setActive={setActive}
              draftStatus={draftStatus}
              setDraftStatus={setDraftStatus}
              draftRemark={draftRemark}
              setDraftRemark={setDraftRemark}
              saving={saving}
              onSaveStatus={onSaveStatus}
              onSaveRemark={onSaveRemark}
            />
          )
        },
      })
    }
    return base
  }, [week, active, draftStatus, draftRemark, saving, onSaveStatus, onSaveRemark])

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginTop: 0 }}>
        人员在岗状态
      </Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="团队日历：名单与「用户管理」同步（在职且已绑定钉钉；排除名称中含机器人/大屏等关键字的功能账号）。工作日未设置默认为「在岗」，周日未设置默认为「休息」。上框为状态、下框为说明，分别点击编辑。"
      />
      <Card
        styles={{ body: { padding: '16px 16px 20px' } }}
        style={{ borderRadius: 12 }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
            marginBottom: 16,
            paddingBottom: 14,
            borderBottom: '1px solid var(--ant-color-split, rgba(5,5,5,.06))',
          }}
        >
          <Space wrap>
            <Button
              icon={<LeftOutlined />}
              disabled={!week || loading}
              onClick={() => week && setWeekQuery(week.prev_week_start)}
            >
              上一周
            </Button>
            <Button
              icon={<RightOutlined />}
              disabled={!week || loading}
              onClick={() => week && setWeekQuery(week.next_week_start)}
            >
              下一周
            </Button>
            <Button type="primary" disabled={loading} onClick={() => setWeekQuery(undefined)}>
              本周
            </Button>
          </Space>
          <Text strong style={{ fontSize: 15 }}>
            {week ? formatWeekRangeLabel(week.week_start, week.week_end) : '—'}
          </Text>
          <Input.Search
            allowClear
            placeholder="筛选成员"
            style={{ width: 220 }}
            onSearch={setSearch}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void loadWeek()} loading={loading}>
            刷新
          </Button>
        </div>
        <div
          className="pp-team-calendar"
          style={{
            borderRadius: 10,
            border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
            overflow: 'hidden',
          }}
        >
          <style>{`
            .pp-team-calendar .ant-table-thead > tr > th { padding: 10px 8px !important; }
            .pp-team-calendar .ant-table-tbody > tr > td { padding: 10px 8px !important; vertical-align: top !important; }
            .pp-team-calendar .pp-cal-cell-wrap:hover {
              box-shadow: 0 2px 6px 0 var(--ant-color-fill-secondary, rgba(0,0,0,0.06)) !important;
            }
            .pp-team-calendar .pp-cal-status-zone:hover,
            .pp-team-calendar .pp-cal-remark-zone:hover {
              filter: brightness(0.985);
            }
          `}</style>
          <Table<WeekPerson>
            rowKey="username"
            loading={loading}
            columns={columns}
            dataSource={filteredPeople}
            pagination={false}
            scroll={{ x: 1180 }}
            size="middle"
            bordered={false}
            showHeader
            className="pp-team-calendar"
          />
        </div>
      </Card>
    </div>
  )
}

export default PersonnelPresencePage
