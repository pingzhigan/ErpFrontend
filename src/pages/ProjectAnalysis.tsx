/**
 * 功能名称：项目分析
 * 实现原理与逻辑：展示项目列表及每个项目的基本信息与缺漏项检测（报价表、成本表、回款情况、附件情况）。
 * 缺漏项仅作为提示，不影响项目正常使用。
 */
import {
  BarChartOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  FolderOutlined,
  PaperClipOutlined,
  ShoppingOutlined,
  WalletOutlined,
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
  payment_progress: number | null
}

type ProjectAnalysisRow = ProjectSummary & {
  attachment_count: number
}

const formatMoney = (v: number | null | undefined) =>
  v != null && Number.isFinite(v)
    ? Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'

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

  const missingItems = (row: ProjectAnalysisRow): string[] => {
    const items: string[] = []
    if (canViewQuotation && !hasQuotation(row)) items.push('报价表')
    if (canViewCost && !hasCost(row)) items.push('成本表')
    if (!hasReceivables(row)) items.push('回款情况')
    if (!hasAttachments(row)) items.push('附件')
    return items
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
            <Tag color="warning" icon={<ExclamationCircleOutlined />}>
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
            <Tag color="warning" icon={<ExclamationCircleOutlined />}>
              缺漏
            </Tag>
          </Tooltip>
        ),
    },
    {
      title: '回款情况',
      key: 'check_receivables',
      width: 96,
      align: 'center',
      render: (_: unknown, row: ProjectAnalysisRow) =>
        hasReceivables(row) ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            有
          </Tag>
        ) : (
          <Tooltip title="该项目暂无回款记录，可在项目列表中点击「回款记录」添加">
            <Tag color="warning" icon={<ExclamationCircleOutlined />}>
              缺漏
            </Tag>
          </Tooltip>
        ),
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
          <Tooltip title="该项目暂无附件，可在项目详情中上传合同、图纸等">
            <Tag color="warning" icon={<ExclamationCircleOutlined />}>
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
        const missing = missingItems(row)
        if (missing.length === 0) {
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
                <FileTextOutlined /> 报价表 &nbsp;
                <ShoppingOutlined /> 成本表 &nbsp;
                <WalletOutlined /> 回款 &nbsp;
                <PaperClipOutlined /> 附件
              </span>
            }
          >
            <Text type="secondary">缺 {missing.join('、')}</Text>
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
              分析各项目的基本信息与缺漏项（报价表、成本表、回款情况、附件）。缺漏项仅作提示，不影响项目正常使用。
            </Text>
          </div>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        message="说明"
        description="下表对每个项目检测：是否已有报价表（商品）、成本表、回款记录、附件。标记为「缺漏」仅表示该项尚未维护，您仍可正常使用该项目；可根据提示到对应模块补充。"
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
