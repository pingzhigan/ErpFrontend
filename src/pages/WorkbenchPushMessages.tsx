/**
 * 工作台推送消息查询：分页展示持久化的钉钉审批、机器人等推送记录。
 */
import type { ColumnsType } from 'antd/es/table'
import { App, Button, Card, Select, Space, Table, Typography } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const { Title, Text } = Typography

type PushCategory = 'approval' | 'dingtalk' | 'system'

type WorkbenchPushRow = {
  id: string
  ts: number
  category: PushCategory
  title: string
  detail?: string
  linkPath?: string
}

const CATEGORY_LABEL: Record<PushCategory, string> = {
  approval: '审批',
  dingtalk: '钉钉',
  system: '系统',
}

const WorkbenchPushMessagesPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const navigate = useNavigate()
  const [list, setList] = useState<WorkbenchPushRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [category, setCategory] = useState<PushCategory | 'all'>('all')

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page, page_size: pageSize }
      if (category !== 'all') params.category = category
      const res = await axios.get<{
        items: WorkbenchPushRow[]
        total: number
        page: number
        page_size: number
      }>('/api/workbench/push-events', { params })
      setList(res.data.items || [])
      setTotal(res.data.total ?? 0)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, category, msg])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const columns: ColumnsType<WorkbenchPushRow> = [
    {
      title: '时间',
      width: 168,
      render: (_, row) => <Text type="secondary">{new Date(row.ts).toLocaleString('zh-CN')}</Text>,
    },
    {
      title: '类型',
      width: 72,
      dataIndex: 'category',
      render: (c: PushCategory) => CATEGORY_LABEL[c] ?? c,
    },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    { title: '详情', dataIndex: 'detail', ellipsis: true, render: (t: string | undefined) => t ?? '—' },
    {
      title: '操作',
      width: 88,
      render: (_, row) =>
        row.linkPath ? (
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(row.linkPath!)}>
            打开
          </Button>
        ) : (
          '—'
        ),
    },
  ]

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      <div className="page-header-banner" style={{ marginBottom: 16 }}>
        <div className="header-left" style={{ flex: 1 }}>
          <Title level={4} className="header-title" style={{ marginBottom: 4 }}>
            推送消息查询
          </Title>
          <Text type="secondary" className="header-desc">
            钉钉审批结果、机器人消息等工作台推送记录（数据库持久化）
          </Text>
        </div>
      </div>
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <span>类型：</span>
          <Select
            style={{ width: 140 }}
            value={category}
            onChange={(v) => {
              setCategory(v)
              setPage(1)
            }}
            options={[
              { value: 'all', label: '全部' },
              { value: 'approval', label: '审批' },
              { value: 'dingtalk', label: '钉钉' },
              { value: 'system', label: '系统' },
            ]}
          />
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={list}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p)
              setPageSize(ps || 20)
            },
          }}
        />
      </Card>
    </div>
  )
}

export default WorkbenchPushMessagesPage
