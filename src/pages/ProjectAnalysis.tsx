/**
 * 功能名称：项目分析
 * 实现原理与逻辑：报价表/成本表缺漏标红；回款在已有报价前提下：未回款、款未回完（回款小于报价）、不一致（回款大于报价）标黄，已对齐标绿；附件缺漏标蓝。
 * 工作台消息与下表一致：未回款、款未回完、不一致均会提醒；不推送附件缺漏。
 */
import {
  BarChartOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  FolderOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { Alert, App, Card, Progress, Space, Table, Tag, Tooltip, Typography } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const { Title, Text } = Typography

export type ProjectSummary = {
  project_name: string
  product_count: number | null
  last_updated: string | null
  history_version_count: number | null
  quotation_total: number | null
  cost_total: number | null
  total_received: number | null
  unpaid_amount?: number | null
  payment_progress: number | null
}

type ProjectAnalysisRow = ProjectSummary & {
  attachment_count: number
}

const formatMoney = (v: number | null | undefined) =>
  v != null && Number.isFinite(v)
    ? Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'

const moneyRoughlyEqual = (a: number | null | undefined, b: number | null | undefined) => {
  const x = Number(a)
  const y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  return Math.abs(x - y) < 0.01
}

const ProjectAnalysisPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { hasPermission } = useAuth()
  const canViewQuotation = hasPermission('products')
  const canViewCost = hasPermission('cost-list')
  const navigate = useNavigate()
  const [list, setList] = useState<ProjectAnalysisRow[]>([])
  const [loading, setLoading] = useState(false)

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get<{ list: ProjectSummary[]; total: number }>('/api/projects')
      const projects = res.data.list || []
      if (projects.length === 0) {
        setList([])
        setLoading(false)
        return
      }
      const attachmentCounts = await Promise.all(
        projects.map((p) =>
          axios
            .get<{ list: unknown[]; total: number }>('/api/projects/attachments', {
              params: { project_name: p.project_name },
            })
            .then((r) => (r.data.list?.length ?? 0) as number)
            .catch(() => 0)
        )
      )
      const rows: ProjectAnalysisRow[] = projects.map((p, i) => ({
        ...p,
        attachment_count: attachmentCounts[i] ?? 0,
      }))
      setList(rows)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || '加载项目列表失败')
      setList([])
    } finally {
      setLoading(false)
    }
  }, [msg])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const hasQuotation = (row: ProjectAnalysisRow) =>
    (row.product_count != null && row.product_count > 0) ||
    (row.quotation_total != null && Number(row.quotation_total) > 0)
  const hasCost = (row: ProjectAnalysisRow) =>
    row.cost_total != null && Number(row.cost_total) > 0
  const hasReceivables = (row: ProjectAnalysisRow) =>
    row.total_received != null && Number(row.total_received) > 0
  const hasAttachments = (row: ProjectAnalysisRow) => row.attachment_count > 0

  /** 已有报价前提下，回款与含税报价合计（0.01 元容差） */
  const receivableVsQuotation = (row: ProjectAnalysisRow): 'not_paid' | 'aligned' | 'underpaid' | 'overpaid' => {
    const q = Number(row.quotation_total) || 0
    const r = Number(row.total_received) || 0
    if (!hasReceivables(row)) return 'not_paid'
    if (moneyRoughlyEqual(q, r)) return 'aligned'
    if (r < q) return 'underpaid'
    return 'overpaid'
  }

  /** 缺漏汇总：红=报价/成本，黄=未回款/款未回完/不一致，蓝=附件（附件不进消息中心） */
  const missingTags = (
    row: ProjectAnalysisRow,
  ): { label: string; color: string; title?: string }[] => {
    const tags: { label: string; color: string; title?: string }[] = []
    if (canViewQuotation && !hasQuotation(row)) {
      tags.push({ label: '报价表', color: 'error', title: '缺少报价表（商品/报价合计）' })
    }
    if (canViewCost && !hasCost(row)) {
      tags.push({ label: '成本表', color: 'error', title: '缺少成本表数据' })
    }
    if (canViewQuotation && hasQuotation(row)) {
      const amtTitle = `含税报价 ${formatMoney(row.quotation_total)} 元，已回款 ${formatMoney(row.total_received)} 元`
      const v = receivableVsQuotation(row)
      if (v === 'not_paid') {
        tags.push({ label: '未回款', color: 'warning', title: amtTitle })
      } else if (v === 'underpaid') {
        tags.push({ label: '款未回完', color: 'warning', title: amtTitle })
      } else if (v === 'overpaid') {
        tags.push({ label: '不一致', color: 'warning', title: amtTitle })
      }
    }
    if (!hasAttachments(row)) {
      tags.push({ label: '附件', color: 'blue', title: '暂无合同/图纸等附件' })
    }
    return tags
  }

  const columns: ColumnsType<ProjectAnalysisRow> = [
    {
      title: '项目名称',
      dataIndex: 'project_name',
      key: 'project_name',
      width: 220,
      fixed: 'left',
      render: (name: string) => (
        <Space>
          <FolderOutlined style={{ color: 'var(--ant-colorPrimary)' }} />
          <span>{name}</span>
        </Space>
      ),
    },
    {
      title: '商品数',
      dataIndex: 'product_count',
      key: 'product_count',
      width: 80,
      align: 'right',
      render: (v: number | null) => (v == null ? '—' : v),
    },
    {
      title: '报价(元)',
      dataIndex: 'quotation_total',
      key: 'quotation_total',
      width: 110,
      align: 'right',
      render: (v: number | null) => formatMoney(v),
    },
    {
      title: '成本(元)',
      dataIndex: 'cost_total',
      key: 'cost_total',
      width: 110,
      align: 'right',
      render: (v: number | null) => formatMoney(v),
    },
    {
      title: '回款(元)',
      dataIndex: 'total_received',
      key: 'total_received',
      width: 110,
      align: 'right',
      render: (v: number | null) => formatMoney(v),
    },
    {
      title: '回款进度',
      dataIndex: 'payment_progress',
      key: 'payment_progress',
      width: 110,
      render: (v: number | null) =>
        v != null ? (
          <Progress percent={v} size="small" style={{ marginBottom: 0 }} />
        ) : (
          '—'
        ),
    },
    {
      title: '报价表',
      key: 'check_quotation',
      width: 88,
      align: 'center',
      render: (_: unknown, row: ProjectAnalysisRow) =>
        hasQuotation(row) ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            有
          </Tag>
        ) : (
          <Tooltip title="该项目暂无报价数据，可在项目维护或报价清单中补充">
            <Tag color="error" icon={<ExclamationCircleOutlined />}>
              缺漏
            </Tag>
          </Tooltip>
        ),
    },
    {
      title: '成本表',
      key: 'check_cost',
      width: 88,
      align: 'center',
      render: (_: unknown, row: ProjectAnalysisRow) =>
        hasCost(row) ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            有
          </Tag>
        ) : (
          <Tooltip title="该项目暂无成本数据，可在成本清单中按项目维护">
            <Tag color="error" icon={<ExclamationCircleOutlined />}>
              缺漏
            </Tag>
          </Tooltip>
        ),
    },
    {
      title: '回款情况',
      key: 'check_receivables',
      width: 108,
      align: 'center',
      render: (_: unknown, row: ProjectAnalysisRow) => {
        if (!hasQuotation(row)) {
          return (
            <Tooltip title="尚无报价数据，无法核对回款与报价是否一致">
              <Tag>待核对</Tag>
            </Tooltip>
          )
        }
        const amtTip = `含税报价 ${formatMoney(row.quotation_total)} 元，已回款 ${formatMoney(row.total_received)} 元`
        const v = receivableVsQuotation(row)
        if (v === 'not_paid') {
          return (
            <Tooltip title={amtTip}>
              <Tag color="warning" icon={<ExclamationCircleOutlined />}>
                未回款
              </Tag>
            </Tooltip>
          )
        }
        if (v === 'underpaid') {
          return (
            <Tooltip title={amtTip}>
              <Tag color="warning" icon={<ExclamationCircleOutlined />}>
                款未回完
              </Tag>
            </Tooltip>
          )
        }
        if (v === 'overpaid') {
          return (
            <Tooltip title={amtTip}>
              <Tag color="warning" icon={<ExclamationCircleOutlined />}>
                不一致
              </Tag>
            </Tooltip>
          )
        }
        return (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            已对齐
          </Tag>
        )
      },
    },
    {
      title: '附件',
      key: 'check_attachments',
      width: 88,
      align: 'center',
      render: (_: unknown, row: ProjectAnalysisRow) =>
        hasAttachments(row) ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            有 ({row.attachment_count})
          </Tag>
        ) : (
          <Tooltip title="该项目暂无附件，可在项目详情中上传合同、图纸等（不参与消息中心提醒）">
            <Tag color="blue" icon={<ExclamationCircleOutlined />}>
              缺漏
            </Tag>
          </Tooltip>
        ),
    },
    {
      title: '缺漏项汇总',
      key: 'missing_summary',
      width: 160,
      render: (_: unknown, row: ProjectAnalysisRow) => {
        const tags = missingTags(row)
        if (tags.length === 0) {
          return (
            <Tag color="success" icon={<CheckCircleOutlined />}>
              无缺漏
            </Tag>
          )
        }
        return (
          <Tooltip
            title={
              <span>
                <span style={{ color: '#cf1322' }}>红</span>：报价表/成本表 &nbsp;
                <span style={{ color: '#d48806' }}>黄</span>：未回款/款未回完/不一致 &nbsp;
                <span style={{ color: '#1677ff' }}>蓝</span>：附件
              </span>
            }
          >
            <Space size={[4, 4]} wrap>
              {tags.map((t) => (
                <Tag key={t.label} color={t.color} title={t.title}>
                  {t.label}
                </Tag>
              ))}
            </Space>
          </Tooltip>
        )
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right',
      render: (_, row) => (
        <a
          onClick={() =>
            navigate(`/project-products?project_name=${encodeURIComponent(row.project_name)}`)
          }
        >
          查看详情
        </a>
      ),
    },
  ]

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      <div className="page-header-banner">
        <div className="header-left">
          <div className="header-icon-wrap">
            <BarChartOutlined />
          </div>
          <div>
            <Title level={4} className="header-title" style={{ marginBottom: 0 }}>
              项目分析
            </Title>
            <Text type="secondary" className="header-desc" style={{ display: 'block' }}>
              报价表/成本表缺漏标红；回款列：未回款、款未回完（回款小于报价）、不一致（回款大于报价）标黄，已对齐标绿；附件缺漏标蓝（附件不参与消息中心提醒）。
            </Text>
          </div>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        message="说明"
        description="报价表、成本表缺漏为红色。回款列：无回款记录为「未回款」（黄）；有回款且小于含税报价合计为「款未回完」（黄）；大于为「不一致」（黄）；相等（0.01 元内）为「已对齐」（绿）。工作台消息对上述三种黄标情况均会提醒；附件缺漏不进消息。"
        style={{ marginBottom: 16 }}
      />

      <Card
        className="section-card section-card-accent-blue"
        title={
          <span>
            <BarChartOutlined style={{ marginRight: 8, color: '#1677ff' }} />
            项目缺漏分析
            {list.length > 0 && (
              <Text type="secondary" style={{ marginLeft: 8, fontWeight: 400, fontSize: 13 }}>
                共 {list.length} 个项目
              </Text>
            )}
          </span>
        }
      >
        <Table<ProjectAnalysisRow>
          rowKey="project_name"
          loading={loading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 1200 }}
          pagination={{
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          locale={{ emptyText: '暂无项目数据，请先在项目维护中创建项目' }}
        />
      </Card>
    </div>
  )
}

export default ProjectAnalysisPage
