/**
 * 研发管理 — 任务超时管理：当前超时 / 过期完成 / 全部超时相关待办
 */
import { ClockCircleOutlined, DownloadOutlined, ExperimentOutlined, ReloadOutlined } from '@ant-design/icons'
import { App, Button, Input, Segmented, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { CompletionTimingCell } from '../utils/overdueCompletionText'
import type { RdResearchTodoRow } from './RdResearchTodos'

const { Title, Text } = Typography

type TimeoutFilter = 'overdue_open' | 'overdue_done' | 'overdue_all'

function parseAssigneeList(raw: unknown): string[] {
  try {
    const p = JSON.parse(String(raw ?? '[]')) as unknown
    return Array.isArray(p)
      ? p.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
      : []
  } catch {
    return []
  }
}

function formatDateTime(s: string | null | undefined): string {
  if (s == null || !String(s).trim()) return '—'
  return String(s).replace('T', ' ').slice(0, 16)
}

const RdTaskTimeoutManagementPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [list, setList] = useState<RdResearchTodoRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState<TimeoutFilter>('overdue_open')

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get<{ list: RdResearchTodoRow[]; total: number }>('/api/rd/todos', {
        params: {
          list_status: filter,
          keyword: keyword.trim() || undefined,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        },
      })
      setList(res.data?.list ?? [])
      setTotal(res.data?.total ?? 0)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [filter, keyword, page, pageSize, msg])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const handleExport = async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams({ list_status: filter })
      if (keyword.trim()) params.set('keyword', keyword.trim())
      const res = await fetch(`/api/rd/todos/export-excel?${params.toString()}`, {
        method: 'GET',
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {},
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(j.message || `导出失败 ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `研发待办超时_${Date.now()}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      msg.success('导出成功')
    } catch (e: unknown) {
      msg.error(e instanceof Error ? e.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const columns: ColumnsType<RdResearchTodoRow> = useMemo(
    () => [
      {
        title: '主题',
        dataIndex: 'title',
        ellipsis: true,
        width: 220,
      },
      {
        title: '负责人',
        key: 'assignees',
        width: 160,
        ellipsis: true,
        render: (_: unknown, r) => {
          const us = parseAssigneeList(r.assignee_usernames)
          return us.length ? us.join('、') : '—'
        },
      },
      {
        title: '截止时间',
        dataIndex: 'due_at',
        width: 148,
        render: (v: string | null) => formatDateTime(v),
      },
      {
        title: '状态',
        key: 'status',
        width: 96,
        render: (_: unknown, r) => {
          if (r.status === 'done' && r.completed_overdue) {
            return <Tag color="orange">过期完成</Tag>
          }
          if (r.status === 'done') return <Tag color="success">已完成</Tag>
          return <Tag color="error">当前超时</Tag>
        },
      },
      {
        title: '完成情况',
        key: 'completion_timing',
        width: 180,
        render: (_: unknown, r) => {
          if (r.status !== 'done') return <Text type="secondary">进行中</Text>
          return (
            <CompletionTimingCell
              dueAt={r.due_at}
              completedAt={r.completed_at}
              completedOverdue={Boolean(r.completed_overdue)}
            />
          )
        },
      },
      {
        title: '完成时间',
        dataIndex: 'completed_at',
        width: 148,
        render: (v: string | null, r) => (r.status === 'done' ? formatDateTime(v) : '—'),
      },
      {
        title: '操作',
        key: 'actions',
        width: 88,
        fixed: 'right',
        render: (_: unknown, r) => (
          <Button type="link" size="small" onClick={() => navigate('/rd/todos', { state: { openTodoId: r.id } })}>
            查看
          </Button>
        ),
      },
    ],
    [navigate],
  )

  const filterLabel =
    filter === 'overdue_open' ? '当前超时' : filter === 'overdue_done' ? '过期完成' : '全部超时相关'

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      <div className="page-header-banner">
        <div className="header-left">
          <div className="header-icon-wrap">
            <ClockCircleOutlined />
          </div>
          <div>
            <Title level={4} className="header-title" style={{ marginBottom: 0 }}>
              任务超时管理
            </Title>
            <Text type="secondary" className="header-desc" style={{ display: 'block' }}>
              集中查看研发待办中超时进行中与过期完成记录，与维护管理超时逻辑一致。
            </Text>
          </div>
        </div>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented<TimeoutFilter>
          value={filter}
          onChange={(v) => {
            setFilter(v)
            setPage(1)
          }}
          options={[
            { label: '当前超时', value: 'overdue_open' },
            { label: '过期完成', value: 'overdue_done' },
            { label: '全部', value: 'overdue_all' },
          ]}
        />
        <Input.Search
          allowClear
          placeholder="搜主题、内容、负责人"
          style={{ width: 260 }}
          onSearch={(v) => {
            setKeyword(v)
            setPage(1)
          }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void fetchList()}>
          刷新
        </Button>
        <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void handleExport()}>
          导出 Excel
        </Button>
        <Button type="link" icon={<ExperimentOutlined />} onClick={() => navigate('/rd/todos')}>
          研发待办
        </Button>
      </Space>

      <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
        当前筛选：{filterLabel}，共 {total} 条
      </Text>

      <Table<RdResearchTodoRow>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        scroll={{ x: 960 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p)
            setPageSize(ps)
          },
        }}
      />
    </div>
  )
}

export default RdTaskTimeoutManagementPage
