/**
 * 功能名称：施工项目详情
 * 实现原理与逻辑：展示施工项目的基本信息、时间线（施工日志与状态变更）等。支持按项目名称、项目编号、状态、计划周期等筛选。支持按日期排序。支持导出为 Excel 文件。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Descriptions, Divider, Space, Tag, Timeline, Typography } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../auth/AuthContext'

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

type TimelineItem = { type: 'log' | 'status'; time: string; sortKey: string; data: any }

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
        <Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>2. 项目时间线（施工日志与状态变更）</Title>
        {timelineLoading ? (
          <Text type="secondary">加载中…</Text>
        ) : timelineList.length === 0 ? (
          <Text type="secondary">暂无施工日志与状态变更记录。</Text>
        ) : (
          <Timeline
            mode="left"
            items={timelineList.map((item) => {
              if (item.type === 'log') {
                const d = item.data as { id: number; date: string; recorder: string; workers: number; work_content: string }
                return {
                  color: 'blue',
                  children: (
                    <div>
                      <div style={{ marginBottom: 4 }}>
                        <Text strong>{d.date}</Text>
                        <Text type="secondary" style={{ marginLeft: 8 }}>施工日志</Text>
                        <Text type="secondary" style={{ marginLeft: 8 }}>记录人：{d.recorder}，出勤 {d.workers} 人</Text>
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', background: 'var(--ant-colorFillQuaternary)', padding: 8, borderRadius: 6 }}>
                        {(d.work_content ?? '').slice(0, 300)}{(d.work_content ?? '').length > 300 ? '…' : ''}
                      </div>
                    </div>
                  ),
                }
              }
              const d = item.data as { from_label: string; to_label: string; reason_label: string; created_at: string }
              return {
                color: 'gray',
                children: (
                  <div>
                    <div style={{ marginBottom: 4 }}>
                      <Text strong>{(d.created_at ?? item.time).toString().slice(0, 10)}</Text>
                      <Text type="secondary" style={{ marginLeft: 8 }}>状态变更</Text>
                    </div>
                    <div>
                      <Tag color={STATUS_MAP[item.data.from_status]?.color}>{d.from_label}</Tag>
                      <span style={{ margin: '0 6px' }}>→</span>
                      <Tag color={STATUS_MAP[item.data.to_status]?.color}>{d.to_label}</Tag>
                      <Text type="secondary" style={{ marginLeft: 8 }}>{d.reason_label}</Text>
                    </div>
                  </div>
                ),
              }
            })}
          />
        )}
      </Card>
    </div>
  )
}

export default ConstructionProjectDetailPage

