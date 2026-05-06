/**
 * 功能名称：施工项目详情
 * 实现原理与逻辑：展示项目基本信息；施工日志、状态变更按列表展示；进度超时按自然日分别汇总（不跨天），当日详情弹窗查看。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Descriptions, Divider, List, Modal, Space, Tag, Typography } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../auth/AuthContext'
import { assigneeDisplayNameOnly, assigneeLabelMap, type AssigneeUserRow } from '../utils/constructionAssigneeOptions'

const { Title, Text } = Typography

type ProjectInfo = {
  id: number
  name: string
  code: string
  location: string
  client: string
  manager: string
  startDate: string
  endDate: string
  status: string
  description: string
}

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  planning: { color: 'blue', label: '筹备中' },
  in_progress: { color: 'processing', label: '施工中' },
  paused: { color: 'warning', label: '暂停中' },
  completed: { color: 'success', label: '已竣工' },
}

type TimelineItem = { type: 'log' | 'status' | 'timeout'; time: string; sortKey: string; data: any }

type TimeoutTimelineData = {
  id: number
  task_id: number
  task_name: string
  content: string
  planned_end: string
  created_at: string
}

/** 超时记录所属自然日 YYYY-MM-DD（与列表排序一致，按 created_at 日历日） */
function timeoutItemDayKey(item: TimelineItem): string {
  const d = item.data as TimeoutTimelineData
  const raw = (d.created_at ?? item.time ?? '').toString().trim()
  if (!raw) return ''
  return raw.replace('T', ' ').slice(0, 10)
}

const ConstructionProjectDetailPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { id } = useParams()
  const projectId = Number(id)
  const headers = useMemo(() => (user?.token ? { Authorization: `Bearer ${user.token}` } : {}), [user?.token])
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [projectLoading, setProjectLoading] = useState(false)
  const [timelineList, setTimelineList] = useState<TimelineItem[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  /** 非 null 时表示打开「该日」超时列表弹窗 */
  const [timeoutsModalDay, setTimeoutsModalDay] = useState<string | null>(null)
  const [timeoutDetail, setTimeoutDetail] = useState<TimeoutTimelineData | null>(null)
  const [attendanceUserRows, setAttendanceUserRows] = useState<AssigneeUserRow[]>([])

  const attendanceSelectOptions = useMemo(
    () =>
      attendanceUserRows.map((u) => ({
        value: u.username,
        label: assigneeDisplayNameOnly(u.username, u.real_name),
      })),
    [attendanceUserRows],
  )
  const attendanceDisplayByUsername = useMemo(() => assigneeLabelMap(attendanceSelectOptions), [attendanceSelectOptions])

  const { timeoutItems, mainTimelineItems } = useMemo(() => {
    const timeouts: TimelineItem[] = []
    const main: TimelineItem[] = []
    for (const it of timelineList) {
      if (it.type === 'timeout') timeouts.push(it)
      else main.push(it)
    }
    return { timeoutItems: timeouts, mainTimelineItems: main }
  }, [timelineList])

  /** 按自然日分组，日内顺序与接口一致；日期从新到旧 */
  const timeoutsByDay = useMemo(() => {
    const map = new Map<string, TimelineItem[]>()
    for (const it of timeoutItems) {
      const k = timeoutItemDayKey(it) || '—'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(it)
    }
    const keys = [...map.keys()].sort((a, b) => b.localeCompare(a))
    return keys.map((dayKey) => ({ dayKey, items: map.get(dayKey)! }))
  }, [timeoutItems])

  const timeoutsInModal = useMemo(() => {
    if (!timeoutsModalDay) return []
    return timeoutItems.filter((it) => timeoutItemDayKey(it) === timeoutsModalDay)
  }, [timeoutItems, timeoutsModalDay])

  const fetchProject = useCallback(async () => {
    if (!Number.isFinite(projectId)) return
    setProjectLoading(true)
    try {
      const res = await axios.get<ProjectInfo>(`/api/construction/projects/${projectId}`, { headers })
      setProject(res.data)
    } catch {
      setProject(null)
    } finally {
      setProjectLoading(false)
    }
  }, [projectId, headers])

  const fetchTimeline = useCallback(async () => {
    if (!Number.isFinite(projectId)) return
    setTimelineLoading(true)
    try {
      const res = await axios.get<{ list: TimelineItem[] }>(`/api/construction/projects/${projectId}/timeline`, { headers })
      setTimelineList(res.data?.list ?? [])
    } catch {
      setTimelineList([])
    } finally {
      setTimelineLoading(false)
    }
  }, [projectId, headers])

  useEffect(() => {
    let cancelled = false
    void axios
      .get<{ list: AssigneeUserRow[] }>('/api/construction/logs/attendance-user-options', { headers })
      .then((res) => {
        if (!cancelled) setAttendanceUserRows(res.data?.list ?? [])
      })
      .catch(() => {
        if (!cancelled) setAttendanceUserRows([])
      })
    return () => {
      cancelled = true
    }
  }, [headers])

  useEffect(() => {
    fetchProject()
  }, [fetchProject])
  useEffect(() => {
    fetchTimeline()
  }, [fetchTimeline])

  if (!Number.isFinite(projectId)) {
    return (
      <Card>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Title level={5} style={{ margin: 0 }}>施工项目详情</Title>
          <Text type="secondary">无效的项目 ID。</Text>
          <Button onClick={() => navigate(-1)}>返回</Button>
        </Space>
      </Card>
    )
  }
  if (projectLoading || !project) {
    return (
      <Card>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Title level={5} style={{ margin: 0 }}>施工项目详情</Title>
          {projectLoading ? <Text type="secondary">加载中…</Text> : <Text type="secondary">未找到对应项目。</Text>}
          <Button onClick={() => navigate(-1)}>返回</Button>
        </Space>
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <Space align="baseline" style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Title level={5} style={{ margin: 0 }}>{project.name}</Title>
            <Text type="secondary">{project.code}</Text>
          </div>
          <Button onClick={() => navigate(-1)}>返回列表</Button>
        </Space>

        <Divider style={{ margin: '12px 0' }} />

        <Title level={5} style={{ marginTop: 0 }}>1. 项目基本信息</Title>
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="项目编号">{project.code}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={STATUS_MAP[project.status]?.color}>{STATUS_MAP[project.status]?.label ?? project.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="项目名称" span={2}>{project.name}</Descriptions.Item>
          <Descriptions.Item label="业主单位">{project.client}</Descriptions.Item>
          <Descriptions.Item label="现场负责人">{project.manager}</Descriptions.Item>
          <Descriptions.Item label="施工地点">{project.location}</Descriptions.Item>
          <Descriptions.Item label="计划周期">{project.startDate} ~ {project.endDate}</Descriptions.Item>
          <Descriptions.Item label="项目描述" span={2}>{project.description}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card>
        <Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>2. 施工日志、状态变更与进度超时</Title>
        {timelineLoading ? (
          <Text type="secondary">加载中…</Text>
        ) : timelineList.length === 0 ? (
          <Text type="secondary">暂无施工日志、状态变更与进度超时记录。</Text>
        ) : (
          <>
            <Space direction="vertical" size={0} style={{ width: '100%' }}>
              {timeoutsByDay.map(({ dayKey, items }) => (
                <div
                  key={`timeout-day-${dayKey}`}
                  style={{
                    marginBottom: 16,
                    padding: 12,
                    borderRadius: 8,
                    border: '1px solid var(--ant-colorErrorBorder)',
                    background: 'var(--ant-colorErrorBg)',
                  }}
                >
                  <Space align="center" wrap style={{ marginBottom: 8 }}>
                    <Text strong>{dayKey}</Text>
                    <Text strong>进度超时</Text>
                    <Tag color="error">当日共 {items.length} 条</Tag>
                  </Space>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                    不含其它日期的超时记录。
                  </Text>
                  <Button type="primary" danger ghost size="small" onClick={() => setTimeoutsModalDay(dayKey)}>
                    查看当日超时详情
                  </Button>
                </div>
              ))}
              {mainTimelineItems.map((item, idx) => {
                if (item.type === 'log') {
                  const d = item.data as {
                    id: number
                    date: string
                    recorder: string
                    workers: number
                    attendance_staff?: string[]
                    attendance_line?: string
                    work_content: string
                  }
                  const att = Array.isArray(d.attendance_staff) ? d.attendance_staff : []
                  const attendanceText =
                    att.length > 0
                      ? att.map((u) => attendanceDisplayByUsername.get(u) ?? u).join('、')
                      : (d.attendance_line ?? '').trim() ||
                        (Number(d.workers) > 0 ? `历史 ${d.workers} 人（仅人数）` : '')
                  return (
                    <div key={`log-${d.id}`}>
                      {idx > 0 || timeoutsByDay.length > 0 ? <Divider style={{ margin: '12px 0' }} /> : null}
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          alignItems: 'baseline',
                          marginBottom: 8,
                        }}
                      >
                        <Text strong>{d.date}</Text>
                        <Tag color="blue">施工日志</Tag>
                        <Text type="secondary">
                          记录人：{d.recorder}
                          {attendanceText ? `，出勤：${attendanceText}` : ''}
                        </Text>
                      </div>
                      <div
                        style={{
                          whiteSpace: 'pre-wrap',
                          background: 'var(--ant-colorFillQuaternary)',
                          padding: 10,
                          borderRadius: 8,
                        }}
                      >
                        {(d.work_content ?? '').slice(0, 300)}
                        {(d.work_content ?? '').length > 300 ? '…' : ''}
                      </div>
                    </div>
                  )
                }
                const d = item.data as {
                  id: number
                  from_label: string
                  to_label: string
                  reason_label: string
                  created_at: string
                  from_status: string
                  to_status: string
                }
                const day = (d.created_at ?? item.time).toString().slice(0, 10)
                return (
                  <div key={`status-${d.id}`}>
                    {idx > 0 || timeoutsByDay.length > 0 ? <Divider style={{ margin: '12px 0' }} /> : null}
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        alignItems: 'baseline',
                        marginBottom: 8,
                      }}
                    >
                      <Text strong>{day}</Text>
                      <Tag>状态变更</Tag>
                    </div>
                    <div>
                      <Tag color={STATUS_MAP[item.data.from_status]?.color}>{d.from_label}</Tag>
                      <span style={{ margin: '0 6px' }}>→</span>
                      <Tag color={STATUS_MAP[item.data.to_status]?.color}>{d.to_label}</Tag>
                      <Text type="secondary" style={{ marginLeft: 8 }}>
                        {d.reason_label}
                      </Text>
                    </div>
                  </div>
                )
              })}
            </Space>
            <Modal
              title={timeoutsModalDay ? `进度超时记录（${timeoutsModalDay}）` : '进度超时记录'}
              open={timeoutsModalDay != null}
              onCancel={() => setTimeoutsModalDay(null)}
              footer={null}
              width={640}
              destroyOnClose
            >
              <List
                dataSource={timeoutsInModal}
                locale={{ emptyText: '暂无记录' }}
                renderItem={(item) => {
                  const d = item.data as TimeoutTimelineData
                  const day = (d.created_at ?? item.time).toString().slice(0, 10)
                  return (
                    <List.Item
                      actions={[
                        <Button key="detail" type="link" size="small" onClick={() => setTimeoutDetail(d)}>
                          查看详情
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space wrap size={8}>
                            <Text strong>{d.task_name || '未命名任务'}</Text>
                            <Tag color="error">计划截止 {d.planned_end || '—'}</Tag>
                          </Space>
                        }
                        description={
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            记录日期 {day}
                            {(d.content ?? '').trim()
                              ? ` · ${(d.content ?? '').trim().slice(0, 80)}${(d.content ?? '').trim().length > 80 ? '…' : ''}`
                              : ''}
                          </Text>
                        }
                      />
                    </List.Item>
                  )
                }}
              />
            </Modal>
            <Modal
              title="进度超时详情"
              open={timeoutDetail != null}
              onCancel={() => setTimeoutDetail(null)}
              footer={
                <Button type="primary" onClick={() => setTimeoutDetail(null)}>
                  关闭
                </Button>
              }
              width={560}
              destroyOnClose
            >
              {timeoutDetail ? (
                <Descriptions bordered column={1} size="small">
                  <Descriptions.Item label="任务名称">{timeoutDetail.task_name || '—'}</Descriptions.Item>
                  <Descriptions.Item label="计划截止">{timeoutDetail.planned_end || '—'}</Descriptions.Item>
                  <Descriptions.Item label="记录时间">
                    {timeoutDetail.created_at ? String(timeoutDetail.created_at).replace('T', ' ').slice(0, 19) : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="任务 ID">{timeoutDetail.task_id}</Descriptions.Item>
                  <Descriptions.Item label="说明">
                    <div style={{ whiteSpace: 'pre-wrap' }}>{timeoutDetail.content?.trim() || '—'}</div>
                  </Descriptions.Item>
                </Descriptions>
              ) : null}
            </Modal>
          </>
        )}
      </Card>
    </div>
  )
}

export default ConstructionProjectDetailPage

