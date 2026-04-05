/**
 * 功能名称：操作日志
 * 实现原理与逻辑：分页展示系统操作日志（用户、动作类型、详情、IP、时间等）；支持按动作类型、用户名、时间范围筛选。用于审计与排查问题，
 * 动作类型与 Dashboard 的 ACTION_LABELS 一致。数据来自 /api/logs。
 */
import type { ColumnsType } from 'antd/es/table'
import { App, Card, DatePicker, Input, Select, Space, Table, Typography } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useState } from 'react'
import dayjs from 'dayjs'

const { Title, Text } = Typography

const ACTION_LABELS: Record<string, string> = {
  login: '登录成功',
  login_dingtalk: '钉钉免登',
  login_fail: '登录失败',
  password_reset_otp_sent: '找回密码验证码已发送',
  password_reset_complete: '找回密码完成',
  dingtalk_jit_register: '钉钉 JIT 注册',
  dingtalk_approval: '钉钉发起审批',
  dingtalk_approval_denied: '钉钉审批被拒绝（策略）',
  doc_upload: '文档上传',
  doc_parse: '文档解析',
  doc_parse_fail: '文档解析失败',
  products_bulk: '商品批量入库',
  products_overwrite: '商品覆盖入库',
  project_soft_delete: '项目软删除',
  product_create: '商品创建',
  product_update: '商品编辑',
  product_delete: '商品删除',
  products_by_project_delete: '按项目删除商品',
  receivable_update: '回款记录编辑',
  receivable_delete: '回款记录删除',
  attachment_delete: '项目附件删除',
  rule_update: '规则编辑',
  rule_delete: '规则删除',
  knowledge_update: '知识编辑',
  knowledge_delete: '知识删除',
  industry_factor_update: '行业系数编辑',
  industry_factor_delete: '行业系数删除',
  tier_factor_update: '档次系数编辑',
  tier_factor_delete: '档次系数删除',
  equipment_spec_update: '设备规格编辑',
  equipment_spec_delete: '设备规格删除',
  formula_update: '公式编辑',
  formula_delete: '公式删除',
  rule_config_update: '规则配置编辑',
  rule_config_delete: '规则配置删除',
  config_order_update: '配单编辑',
  config_order_delete: '配单删除',
  user_update: '用户编辑',
  user_delete: '用户删除',
  role_group_update: '权限组编辑',
  role_group_delete: '权限组删除',
  cost_item_update: '成本项编辑',
  cost_item_delete: '成本项删除',
  cost_list_by_project_delete: '按项目删除成本清单',
  cost_project_soft_delete: '成本项目软删除',
}

export type OperationLog = {
  id: number
  username: string | null
  action: string
  detail: string | null
  extra_json: string | null
  ip: string | null
  created_at: string
  request_method: string | null
  request_path: string | null
  user_agent: string | null
  client_mac: string | null
}

const LogsPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<OperationLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined)
  const [usernameFilter, setUsernameFilter] = useState('')
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null])

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page, page_size: pageSize }
      if (actionFilter) params.action = actionFilter
      if (usernameFilter.trim()) params.username = usernameFilter.trim()
      if (dateRange[0]) params.start_date = dateRange[0].format('YYYY-MM-DD')
      if (dateRange[1]) params.end_date = dateRange[1].format('YYYY-MM-DD')
      const res = await axios.get<{ list: OperationLog[]; total: number; page: number; page_size: number }>('/api/logs', { params })
      setList(res.data.list || [])
      setTotal(res.data.total ?? 0)
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, actionFilter, usernameFilter, dateRange, msg])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const columns: ColumnsType<OperationLog> = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 172,
      render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '—'),
    },
    {
      title: '用户',
      dataIndex: 'username',
      key: 'username',
      width: 100,
      render: (v) => v ?? '—',
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      key: 'action',
      width: 120,
      render: (v: string) => ACTION_LABELS[v] ?? v,
    },
    {
      title: '请求',
      key: 'request',
      width: 140,
      render: (_: unknown, r: OperationLog) =>
        [r.request_method, r.request_path].filter(Boolean).length > 0 ? (
          <span title={r.request_path ?? undefined}>
            {r.request_method ?? '—'} {r.request_path ?? ''}
          </span>
        ) : (
          '—'
        ),
    },
    {
      title: '详情',
      dataIndex: 'detail',
      key: 'detail',
      width: 200,
      ellipsis: true,
      render: (v) => v ?? '—',
    },
    {
      title: 'MAC 地址',
      dataIndex: 'client_mac',
      key: 'client_mac',
      width: 140,
      ellipsis: true,
      render: (v: string | null) => (v ? <span title={v}>{v}</span> : '—'),
    },
    {
      title: '扩展信息',
      dataIndex: 'extra_json',
      key: 'extra_json',
      width: 220,
      render: (v: string | null) => {
        if (!v) return '—'
        try {
          const o = JSON.parse(v) as Record<string, unknown>
          const text = Object.entries(o)
            .map(([k, val]) => `${k}: ${val}`)
            .join('\n')
          return (
            <pre
              style={{
                margin: 0,
                padding: '4px 0',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                lineHeight: 1.4,
              }}
            >
              {text}
            </pre>
          )
        } catch {
          return <span>{v}</span>
        }
      },
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      key: 'ip',
      width: 120,
      render: (v) => (v ? <span title={`客户端 IP: ${v}`}>{v}</span> : '—'),
    },
    {
      title: 'User-Agent',
      dataIndex: 'user_agent',
      key: 'user_agent',
      width: 200,
      ellipsis: true,
      render: (v: string | null) =>
        v ? (
          <span title={v} style={{ fontSize: 11, color: 'var(--ant-colorTextSecondary)' }}>
            {v.length > 60 ? `${v.slice(0, 60)}…` : v}
          </span>
        ) : (
          '—'
        ),
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Title level={4} style={{ marginBottom: 0 }}>
        操作日志
      </Title>
      <Text type="secondary">
        记录登录、项目维护、商品入库、项目软删除等操作，便于审计与排查。
      </Text>
      <Card>
        <Space wrap style={{ marginBottom: 16 }} align="center">
          <Select
            placeholder="操作类型"
            allowClear
            style={{ width: 160 }}
            value={actionFilter}
            onChange={setActionFilter}
            options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ label, value }))}
          />
          <Input
            placeholder="用户名筛选"
            allowClear
            style={{ width: 140 }}
            value={usernameFilter}
            onChange={(e) => setUsernameFilter(e.target.value)}
          />
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null])}
          />
          <Typography.Link onClick={() => fetchList()}>查询</Typography.Link>
        </Space>
        <Table<OperationLog>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={list}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, pSize) => {
              setPage(p)
              setPageSize(pSize ?? 20)
            },
          }}
          scroll={{ x: 1200 }}
        />
      </Card>
    </Space>
  )
}

export default LogsPage
