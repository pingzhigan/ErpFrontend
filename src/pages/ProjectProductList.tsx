/**
 * 功能名称：项目商品与成本（项目维护）
 * 实现原理与逻辑：以项目维度展示该项目的商品清单、成本清单、附件、回款等；支持上传文档解析为商品、编辑商品与成本、管理附件与回款记录。
 * 聚合项目报价、成本、回款进度等统计。相当于项目维度的「项目维护」页，与项目列表、配单等数据联动。
 */
import {
  ArrowLeftOutlined,
  DollarOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileAddOutlined,
  FolderOutlined,
  FundOutlined,
  HistoryOutlined,
  LineChartOutlined,
  ShoppingOutlined,
  UploadOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { Alert, App, Button, Card, Col, Row, Space, Statistic, Table, Tabs, Typography, Upload, Modal, Tooltip, List } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { Product } from './Products'

const { Title, Text } = Typography

/** 单据风格表格的样式 */
const docTableWrapStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  overflow: 'hidden',
}

type ProjectSummary = {
  project_name: string
  product_count: number | null
  last_updated: string | null
  history_version_count: number | null
  quotation_total: number
  cost_total: number
  total_received: number
  payment_progress: number | null
}

type CostListItem = {
  id: number
  sequence_no: number | null
  goods_name: string
  brand: string | null
  model: string | null
  params: string | null
  unit: string | null
  quantity: number | null
  cost_price: number | null
  cost_amount: number | null
  remark: string | null
  project_name: string | null
  category: string | null
  supplier: string | null
  status: string | null
  source_file: string | null
  sku: string | null
  created_at: string
  updated_at: string
}

type AttachmentRecord = {
  id: number
  project_name: string
  file_name: string
  file_path: string
  file_size: number
  created_at: string
}

type ReceivableRecord = {
  id: number
  project_name: string
  amount: number
  received_at: string | null
  remark: string | null
  created_at: string
  created_by: string | null
  updated_at: string
}

const formatMoney = (v: number | null | undefined) =>
  v != null && Number.isFinite(v)
    ? Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'

/** 前端排序：按 sequence_no、id，用于详情页商品列表展示顺序与序号 */
function sortBySequenceNoThenId<T extends { sequence_no?: number | null; id: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const sa = a.sequence_no ?? 0
    const sb = b.sequence_no ?? 0
    if (sa !== sb) return sa - sb
    return a.id - b.id
  })
}

/** 成本清单前端排序：按关联项目分组（同一项目挨在一起），组内按 id 升序 */
function sortCostListByProject<T extends { project_name?: string | null; id: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pa = (a.project_name ?? '').trim()
    const pb = (b.project_name ?? '').trim()
    if (pa !== pb) return pa.localeCompare(pb, 'zh-CN')
    return a.id - b.id
  })
}

async function axiosBlobErrorMessage(e: unknown): Promise<string> {
  const err = e as { response?: { data?: unknown; status?: number } }
  const data = err?.response?.data
  if (data instanceof Blob) {
    try {
      const t = await data.text()
      const j = JSON.parse(t) as { message?: string }
      return j.message || '请求失败'
    } catch {
      return '请求失败'
    }
  }
  if (data && typeof data === 'object' && 'message' in data) {
    return String((data as { message?: string }).message || '请求失败')
  }
  return '请求失败'
}

const ProjectProductListPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { hasPermission, user } = useAuth()
  const canViewQuotation = hasPermission('products')
  const canViewCost = hasPermission('cost-list')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const projectName = searchParams.get('project_name')?.trim() ?? ''
  const [summary, setSummary] = useState<ProjectSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [costList, setCostList] = useState<CostListItem[]>([])
  const [costListLoading, setCostListLoading] = useState(false)
  const [receivableList, setReceivableList] = useState<ReceivableRecord[]>([])
  const [receivableLoading, setReceivableLoading] = useState(false)
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null)
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null)
  /** 历史版本弹窗：quotation=报价清单历史，cost=成本清单历史 */
  const [historyModalType, setHistoryModalType] = useState<'quotation' | 'cost' | null>(null)
  const [historyList, setHistoryList] = useState<{ id: number; version: number; created_at: string; created_by: string | null }[]>([])
  const [historyListLoading, setHistoryListLoading] = useState(false)
  const [historyDetail, setHistoryDetail] = useState<{ snapshot: Product[] | CostListItem[] } | null>(null)
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false)
  const [historySelectedId, setHistorySelectedId] = useState<number | null>(null)

  /** 商品列表前端排序：按序号、id，序号列展示为 1、2、3… */
  const sortedProducts = useMemo(() => sortBySequenceNoThenId(products), [products])
  /** 成本清单前端排序：按关联项目分组，同一项目挨在一起；序号列按此顺序显示 */
  const sortedCostList = useMemo(() => sortCostListByProject(costList), [costList])
  /** 历史版本弹窗中的快照：报价按序号+id，成本按关联项目+id */
  const sortedHistorySnapshot = useMemo(() => {
    if (!historyDetail?.snapshot?.length) return []
    const snapshot = historyDetail.snapshot as { sequence_no?: number | null; project_name?: string | null; id: number }[]
    return historyModalType === 'cost'
      ? sortCostListByProject([...snapshot])
      : sortBySequenceNoThenId([...snapshot])
  }, [historyDetail?.snapshot, historyModalType])

  const fetchSummary = useCallback(async () => {
    if (!projectName) return
    setSummaryLoading(true)
    try {
      const res = await axios.get<ProjectSummary>('/api/projects/summary', {
        params: { project_name: projectName },
      })
      setSummary(res.data)
    } catch (e: any) {
      if (e?.response?.status === 404) setSummary(null)
      else msg.error(e?.response?.data?.message || '加载项目信息失败')
    } finally {
      setSummaryLoading(false)
    }
  }, [projectName, msg])

  const fetchAttachments = useCallback(async () => {
    if (!projectName) return
    setAttachmentsLoading(true)
    try {
      const res = await axios.get<{ list: AttachmentRecord[] }>('/api/projects/attachments', {
        params: { project_name: projectName },
      })
      setAttachments(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载项目附件失败')
    } finally {
      setAttachmentsLoading(false)
    }
  }, [projectName, msg])

  const fetchProducts = useCallback(async () => {
    if (!projectName) return
    setProductsLoading(true)
    try {
      const res = await axios.get<{ list: Product[] }>('/api/products', {
        params: { project_name: projectName },
      })
      setProducts(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载报价清单失败')
    } finally {
      setProductsLoading(false)
    }
  }, [projectName, msg])

  const fetchCostList = useCallback(async () => {
    if (!projectName) return
    setCostListLoading(true)
    try {
      const res = await axios.get<{ list: CostListItem[] }>('/api/cost-list', {
        params: { project_name: projectName },
      })
      setCostList(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载成本清单失败')
    } finally {
      setCostListLoading(false)
    }
  }, [projectName, msg])

  const fetchReceivables = useCallback(async () => {
    if (!projectName) return
    setReceivableLoading(true)
    try {
      const res = await axios.get<{ list: ReceivableRecord[]; total: number }>('/api/receivables', {
        params: { project_name: projectName },
      })
      setReceivableList(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载回款记录失败')
    } finally {
      setReceivableLoading(false)
    }
  }, [projectName, msg])

  const openHistoryModal = useCallback(
    (type: 'quotation' | 'cost') => {
      if (type === 'quotation' && !canViewQuotation) return
      if (type === 'cost' && !canViewCost) return
      setHistoryModalType(type)
      setHistoryDetail(null)
      setHistorySelectedId(null)
      setHistoryListLoading(true)
      setHistoryList([])
      const api = type === 'quotation' ? '/api/products/history' : '/api/cost-list/history'
      axios
        .get<{ list: { id: number; version: number; created_at: string; created_by: string | null }[] }>(api, {
          params: { project_name: projectName },
        })
        .then((res) => setHistoryList(res.data.list || []))
        .catch(() => msg.error('加载历史版本列表失败'))
        .finally(() => setHistoryListLoading(false))
    },
    [projectName, msg, canViewQuotation, canViewCost],
  )

  const loadHistoryDetail = useCallback(
    (id: number) => {
      setHistorySelectedId(id)
      setHistoryDetailLoading(true)
      setHistoryDetail(null)
      const api =
        historyModalType === 'quotation' ? '/api/products/history/' + id : '/api/cost-list/history/' + id
      axios
        .get<{ snapshot: Product[] | CostListItem[] }>(api)
        .then((res) => setHistoryDetail({ snapshot: res.data.snapshot || [] }))
        .catch(() => msg.error('加载该版本详情失败'))
        .finally(() => setHistoryDetailLoading(false))
    },
    [historyModalType, msg],
  )

  const closeHistoryModal = useCallback(() => {
    setHistoryModalType(null)
    setHistoryList([])
    setHistoryDetail(null)
    setHistorySelectedId(null)
  }, [])

  useEffect(() => {
    if (!projectName) return
    fetchSummary()
  }, [projectName, fetchSummary])

  useEffect(() => {
    if (!projectName) return
    fetchAttachments()
  }, [projectName, fetchAttachments])

  useEffect(() => {
    if (!projectName) return
    fetchReceivables()
  }, [projectName, fetchReceivables])

  useEffect(() => {
    if (!projectName || !canViewQuotation) return
    fetchProducts()
  }, [projectName, canViewQuotation, fetchProducts])

  const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10MB
  const handleAttachmentUpload = (file: File) => {
    if (!projectName) return false
    if (file.size > MAX_ATTACHMENT_SIZE) {
      msg.error('文件大小不能超过 10MB')
      return false
    }
    setUploading(true)
    const form = new FormData()
    form.append('project_name', projectName)
    form.append('file', file)
    axios
      .post('/api/projects/attachments', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then(() => {
        msg.success('项目附件上传成功')
        fetchAttachments()
      })
      .catch((e: any) => {
        msg.error(e?.response?.data?.message || '上传失败')
      })
      .finally(() => setUploading(false))
    return false
  }

  const handleDeleteAttachment = async (id: number) => {
    try {
      await axios.delete(`/api/projects/attachments/${id}`)
      msg.success('已删除')
      fetchAttachments()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }

  const authHeaders = user?.token ? { Authorization: `Bearer ${user.token}` } : undefined

  const downloadAttachment = async (id: number, fileName: string) => {
    try {
      const res = await axios.get(`/api/projects/attachments/${id}/file`, {
        responseType: 'blob',
        headers: authHeaders,
      })
      const blobUrl = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = fileName || 'download'
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(blobUrl)
    } catch (e: unknown) {
      msg.error(await axiosBlobErrorMessage(e))
    }
  }

  const PREVIEW_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico']
  const isPreviewable = (fileName: string) => {
    const ext = (fileName || '').toLowerCase().replace(/^.*\./, '')
    return PREVIEW_EXT.includes(ext)
  }

  const isImagePreviewable = (fileName: string) => {
    const ext = (fileName || '').toLowerCase().replace(/^.*\./, '')
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico'].includes(ext)
  }

  const previewAttachment = async (id: number, fileName: string) => {
    setPreviewLoadingId(id)
    try {
      const res = await axios.get(`/api/projects/attachments/${id}/preview`, {
        responseType: 'blob',
        headers: authHeaders,
      })
      const blobUrl = URL.createObjectURL(res.data as Blob)
      if (isImagePreviewable(fileName)) {
        setPreviewImage((prev) => {
          if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url)
          return { url: blobUrl, name: fileName }
        })
      } else {
        window.open(blobUrl, '_blank', 'noopener,noreferrer')
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000)
      }
    } catch (e: unknown) {
      msg.error(await axiosBlobErrorMessage(e))
    } finally {
      setPreviewLoadingId(null)
    }
  }

  const closePreviewImage = () => {
    setPreviewImage((prev) => {
      if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url)
      return null
    })
  }

  const quotation = canViewQuotation ? (summary?.quotation_total ?? null) : null
  const cost = canViewCost ? (summary?.cost_total ?? null) : null
  const received = summary?.total_received ?? 0
  const grossProfit =
    quotation != null && cost != null && Number.isFinite(quotation) && Number.isFinite(cost) ? quotation - cost : null
  const grossMargin =
    quotation != null && quotation > 0 && grossProfit != null ? (grossProfit / quotation) * 100 : null
  const receivableRate =
    quotation != null && quotation > 0 ? (received / quotation) * 100 : null

  const quotationColumns: ColumnsType<Product> = [
    { title: '序号', key: 'displayIndex', width: 64, align: 'right', render: (_: unknown, __: Product, index: number) => index + 1 },
    { title: '货物名称', dataIndex: 'goods_name', width: 140, ellipsis: true },
    { title: '品牌', dataIndex: 'brand', width: 90, ellipsis: true },
    { title: '型号', dataIndex: 'model', width: 120, ellipsis: true },
    {
      title: '参数',
      dataIndex: 'params',
      width: 140,
      ellipsis: true,
      render: (v: string | null) =>
        v ? (
          <Tooltip
            title={<div style={{ maxHeight: 200, maxWidth: 360, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v}</div>}
            overlayInnerStyle={{ maxHeight: 240, maxWidth: 400 }}
          >
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    { title: '单位', dataIndex: 'unit', width: 56 },
    { title: '数量', dataIndex: 'quantity', width: 72, align: 'right', render: (v) => (v != null ? Number(v) : '') },
    {
      title: '单价(含税)',
      dataIndex: 'unit_price_incl_tax',
      width: 96,
      align: 'right',
      render: (v) => (v != null ? Number(v) : ''),
    },
    {
      title: '金额(含税)',
      dataIndex: 'amount_incl_tax',
      width: 96,
      align: 'right',
      render: (v) => (v != null ? Number(v) : ''),
    },
    { title: '备注', dataIndex: 'remark', width: 100, ellipsis: true },
    { title: '供应商', dataIndex: 'supplier', width: 90, ellipsis: true },
  ]

  const costColumns: ColumnsType<CostListItem> = [
    { title: '序号', key: 'displayIndex', width: 64, align: 'right', render: (_: unknown, __: CostListItem, index: number) => index + 1 },
    { title: '货物名称', dataIndex: 'goods_name', width: 140, ellipsis: true },
    { title: '品牌', dataIndex: 'brand', width: 90, ellipsis: true },
    { title: '型号', dataIndex: 'model', width: 120, ellipsis: true },
    {
      title: '参数',
      dataIndex: 'params',
      width: 140,
      ellipsis: true,
      render: (v: string | null) =>
        v ? (
          <Tooltip
            title={<div style={{ maxHeight: 200, maxWidth: 360, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v}</div>}
            overlayInnerStyle={{ maxHeight: 240, maxWidth: 400 }}
          >
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    { title: '单位', dataIndex: 'unit', width: 56 },
    { title: '数量', dataIndex: 'quantity', width: 72, align: 'right', render: (v) => (v != null ? Number(v) : '') },
    {
      title: '成本单价',
      dataIndex: 'cost_price',
      width: 96,
      align: 'right',
      render: (v) => (v != null ? Number(v) : ''),
    },
    {
      title: '成本金额',
      dataIndex: 'cost_amount',
      width: 96,
      align: 'right',
      render: (v) => (v != null ? Number(v) : ''),
    },
    { title: '备注', dataIndex: 'remark', width: 100, ellipsis: true },
    { title: '供应商', dataIndex: 'supplier', width: 90, ellipsis: true },
  ]

  const productListTabItems = useMemo(() => {
    type TabItem = { key: string; label: string; children: React.ReactNode }
    const items: TabItem[] = []
    if (canViewQuotation) {
      items.push({
        key: 'quotation',
        label: '报价',
        children: (
          <>
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ color: '#666', fontSize: 13 }}>
                共 {products.length} 条，来源于报价清单（products）
              </span>
              <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => openHistoryModal('quotation')}>
                历史版本
              </Button>
            </div>
            <div className="doc-table-wrap" style={docTableWrapStyle}>
              <Table<Product>
                rowKey="id"
                size="middle"
                loading={productsLoading}
                columns={quotationColumns}
                dataSource={sortedProducts}
                scroll={{ x: 1000 }}
                bordered
                pagination={{ showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
                locale={{ emptyText: '该项目暂无报价商品' }}
                rowClassName={(_: Product, index: number) => (index % 2 === 1 ? 'doc-table-row-alt' : '')}
              />
            </div>
          </>
        ),
      })
    }
    if (canViewCost) {
      items.push({
        key: 'cost',
        label: '成本',
        children: (
          <>
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ color: '#666', fontSize: 13 }}>
                共 {costList.length} 条，来源于成本清单（cost_list）
              </span>
              <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => openHistoryModal('cost')}>
                历史版本
              </Button>
            </div>
            <div className="doc-table-wrap" style={docTableWrapStyle}>
              <Table<CostListItem>
                rowKey="id"
                size="middle"
                loading={costListLoading}
                columns={costColumns}
                dataSource={sortedCostList}
                scroll={{ x: 1000 }}
                bordered
                pagination={{ showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
                locale={{ emptyText: '该项目暂无成本商品' }}
                rowClassName={(_: CostListItem, index: number) => (index % 2 === 1 ? 'doc-table-row-alt' : '')}
              />
            </div>
          </>
        ),
      })
    }
    return items
  }, [
    canViewQuotation,
    canViewCost,
    products,
    productsLoading,
    sortedProducts,
    costList,
    costListLoading,
    sortedCostList,
    openHistoryModal,
    quotationColumns,
    costColumns,
  ])

  if (!projectName) {
    return (
      <Card>
        <Typography.Paragraph type="secondary">未指定项目，请从项目管理进入。</Typography.Paragraph>
        <Button type="primary" icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')}>
          返回项目管理
        </Button>
      </Card>
    )
  }

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      <div className="page-header-banner">
        <div className="header-left">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')} style={{ marginRight: 8 }}>
            返回
          </Button>
          <div className="header-icon-wrap">
            <FolderOutlined />
          </div>
          <div>
            <Title level={4} className="header-title" style={{ marginBottom: 0 }}>
              {projectName}
            </Title>
            <Text type="secondary" className="header-desc" style={{ display: 'block' }}>
              项目详情看板 ·{' '}
              {canViewQuotation || canViewCost
                ? `${canViewQuotation ? '报价' : ''}${canViewQuotation && canViewCost ? '、' : ''}${canViewCost ? '成本' : ''}、回款与附件`
                : '回款与附件'}
            </Text>
          </div>
        </div>
        {canViewQuotation ? (
          <Button
            type="primary"
            ghost
            icon={<EditOutlined />}
            onClick={() => navigate(`/products?project_name=${encodeURIComponent(projectName)}`)}
          >
            在报价清单中编辑
          </Button>
        ) : null}
      </div>

      {/* 项目基础信息看板 */}
      <Card
        className="section-card section-card-accent-blue"
        title={
          <span>
            <LineChartOutlined style={{ marginRight: 8, color: '#1677ff' }} />
            项目基础信息
          </span>
        }
        loading={summaryLoading}
      >
        <Row gutter={[16, 16]} className="stat-cards-row">
          {canViewQuotation ? (
            <Col xs={24} sm={12} md={8}>
              <Card
                size="small"
                style={{
                  borderLeft: '4px solid #1677ff',
                  background: 'linear-gradient(135deg, #f0f7ff 0%, #fff 100%)',
                }}
              >
                <Statistic
                  title={<Space><DollarOutlined style={{ color: '#1677ff' }} /><span>报价总额（元）</span></Space>}
                  value={formatMoney(summary?.quotation_total ?? null)}
                  valueStyle={{ color: '#1677ff', fontWeight: 600, fontSize: 20 }}
                />
              </Card>
            </Col>
          ) : null}
          {canViewCost ? (
            <Col xs={24} sm={12} md={8}>
              <Card
                size="small"
                style={{
                  borderLeft: '4px solid #d46b08',
                  background: 'linear-gradient(135deg, #fff7e6 0%, #fff 100%)',
                }}
              >
                <Statistic
                  title={<Space><FundOutlined style={{ color: '#d46b08' }} /><span>成本总额（元）</span></Space>}
                  value={formatMoney(summary?.cost_total ?? null)}
                  valueStyle={{ color: '#d46b08', fontWeight: 600, fontSize: 20 }}
                />
              </Card>
            </Col>
          ) : null}
          <Col xs={24} sm={12} md={8}>
            <Card
              size="small"
              style={{
                borderLeft: '4px solid #389e0d',
                background: 'linear-gradient(135deg, #f6ffed 0%, #fff 100%)',
              }}
            >
              <Statistic
                title={<Space><WalletOutlined style={{ color: '#389e0d' }} /><span>回款总额（元）</span></Space>}
                value={formatMoney(summary?.total_received ?? null)}
                valueStyle={{ color: '#389e0d', fontWeight: 600, fontSize: 20 }}
              />
            </Card>
          </Col>
          {canViewQuotation && canViewCost ? (
            <Col xs={24} sm={12} md={8}>
              <Card
                size="small"
                style={{
                  borderLeft: '4px solid #08979c',
                  background: 'linear-gradient(135deg, #e6fffb 0%, #fff 100%)',
                }}
              >
                <Statistic
                  title={<Space><LineChartOutlined style={{ color: '#08979c' }} /><span>毛利（元）</span></Space>}
                  value={formatMoney(grossProfit)}
                  valueStyle={{
                    color:
                      grossProfit == null ? undefined : grossProfit >= 0 ? '#08979c' : '#cf1322',
                    fontWeight: 600,
                    fontSize: 20,
                  }}
                />
              </Card>
            </Col>
          ) : null}
          {canViewQuotation && canViewCost ? (
            <Col xs={24} sm={12} md={8}>
              <Card
                size="small"
                style={{
                  borderLeft: '4px solid #531dab',
                  background: 'linear-gradient(135deg, #f9f0ff 0%, #fff 100%)',
                }}
              >
                <Statistic
                  title={<span>毛利率（%）</span>}
                  value={grossMargin != null ? grossMargin.toFixed(1) : '—'}
                  suffix={grossMargin != null ? '%' : ''}
                  valueStyle={{
                    color: grossMargin != null ? (grossMargin >= 0 ? '#531dab' : '#cf1322') : undefined,
                    fontWeight: 600,
                    fontSize: 20,
                  }}
                />
              </Card>
            </Col>
          ) : null}
          {canViewQuotation ? (
            <Col xs={24} sm={12} md={8}>
              <Card
                size="small"
                style={{
                  borderLeft: '4px solid #0958d9',
                  background: 'linear-gradient(135deg, #e6f4ff 0%, #fff 100%)',
                }}
              >
                <Statistic
                  title={<span>回款率（%）</span>}
                  value={receivableRate != null ? receivableRate.toFixed(1) : '—'}
                  suffix={receivableRate != null ? '%' : ''}
                  valueStyle={{ color: '#0958d9', fontWeight: 600, fontSize: 20 }}
                />
              </Card>
            </Col>
          ) : null}
        </Row>
      </Card>

      {/* 回款记录 */}
      <Card
        className="section-card section-card-accent-green"
        title={
          <span>
            <WalletOutlined style={{ marginRight: 8, color: '#389e0d' }} />
            回款记录
          </span>
        }
        extra={
          <Button
            type="link"
            size="small"
            icon={<DollarOutlined />}
            onClick={() => navigate('/projects', { state: { openReceivable: projectName } })}
          >
            在项目管理中维护回款
          </Button>
        }
      >
        <Row gutter={[16, 16]} className="receivable-stats-bar">
          {canViewQuotation ? (
            <Col xs={24} sm={12} md={6}>
              <Statistic
                title="报价总额（元）"
                value={formatMoney(summary?.quotation_total ?? null)}
                valueStyle={{ fontSize: 16 }}
              />
            </Col>
          ) : (
            <Col xs={24} sm={12} md={6}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                报价与回款率统计暂不可见；下方回款记录仍可正常维护。
              </Text>
            </Col>
          )}
          <Col xs={24} sm={12} md={6}>
            <Statistic
              title="已回款（元）"
              value={formatMoney(receivableList.length > 0 ? receivableList.reduce((s, r) => s + r.amount, 0) : (summary?.total_received ?? null))}
              valueStyle={{ color: '#389e0d', fontSize: 16 }}
            />
          </Col>
          {canViewQuotation ? (
            <>
              <Col xs={24} sm={12} md={6}>
                <Statistic
                  title="回款率"
                  value={receivableRate != null ? receivableRate.toFixed(1) : '—'}
                  suffix={receivableRate != null ? '%' : ''}
                  valueStyle={{ color: '#0958d9', fontSize: 16 }}
                />
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Statistic
                  title="剩余未回款（元）"
                  value={formatMoney(
                    quotation != null && quotation > 0 ? quotation - received : null,
                  )}
                  valueStyle={{
                    color:
                      quotation != null && quotation - received > 0 ? '#d46b08' : '#389e0d',
                    fontSize: 16,
                  }}
                />
              </Col>
            </>
          ) : null}
        </Row>
        <Table<ReceivableRecord>
          rowKey="id"
          size="small"
          loading={receivableLoading}
          dataSource={receivableList}
          pagination={false}
          locale={{ emptyText: '暂无回款记录，可在项目管理中点击「回款记录」添加' }}
          columns={[
            {
              title: '回款日期',
              dataIndex: 'received_at',
              key: 'received_at',
              width: 120,
              render: (v: string | null) => (v ? v.slice(0, 10) : '—'),
            },
            {
              title: '金额(元)',
              dataIndex: 'amount',
              key: 'amount',
              width: 120,
              align: 'right',
              render: (v: number) => formatMoney(v),
            },
            { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true, render: (v: string | null) => v || '—' },
          ]}
        />
        {receivableList.length > 0 && (
          <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
            共 {receivableList.length} 条，合计 {formatMoney(receivableList.reduce((s, r) => s + r.amount, 0))} 元
          </div>
        )}
      </Card>

      {/* 项目附件（合同、中标通知书、项目图纸等） */}
      <Card
        className="section-card section-card-accent-orange"
        title={
          <span>
            <FileAddOutlined style={{ marginRight: 8, color: '#d46b08' }} />
            项目附件
          </span>
        }
        extra={
          <Space>
            <Upload
              accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.7z,.gz,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff,.tif,.ico"
              showUploadList={false}
              beforeUpload={handleAttachmentUpload}
              disabled={uploading}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                上传项目附件
              </Button>
            </Upload>
            <Text type="secondary">单文件不超过 10MB</Text>
          </Space>
        }
      >
        <Table<AttachmentRecord>
          rowKey="id"
          size="small"
          loading={attachmentsLoading}
          dataSource={attachments}
          pagination={false}
          locale={{ emptyText: '暂无附件，支持 PDF、Word、Excel、压缩包及常见图片格式' }}
          columns={[
            { title: '文件名', dataIndex: 'file_name', key: 'file_name', ellipsis: true },
            {
              title: '大小',
              dataIndex: 'file_size',
              key: 'file_size',
              width: 90,
              render: (v: number) => (v ? `${(v / 1024).toFixed(1)} KB` : '—'),
            },
            {
              title: '上传时间',
              dataIndex: 'created_at',
              key: 'created_at',
              width: 170,
              render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '—'),
            },
            {
              title: '操作',
              key: 'action',
              width: 180,
              render: (_, row) => (
                <Space>
                  {isPreviewable(row.file_name) && (
                    <Button
                      type="link"
                      size="small"
                      icon={<EyeOutlined />}
                      loading={previewLoadingId === row.id}
                      onClick={() => previewAttachment(row.id, row.file_name)}
                    >
                      预览
                    </Button>
                  )}
                  <Button
                    type="link"
                    size="small"
                    icon={<FileAddOutlined />}
                    onClick={() => downloadAttachment(row.id, row.file_name)}
                  >
                    下载
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteAttachment(row.id)}
                  >
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={previewImage?.name || '图片预览'}
        open={!!previewImage}
        onCancel={closePreviewImage}
        footer={null}
        width="80%"
        style={{ top: 24 }}
        styles={{ body: { maxHeight: 'calc(100vh - 120px)', overflow: 'auto', textAlign: 'center' } }}
        destroyOnHidden
      >
        {previewImage && (
          <img
            src={previewImage.url}
            alt={previewImage.name}
            style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }}
          />
        )}
      </Modal>

      {/* 商品列表：成本 / 报价 Tab（单据风格） */}
      <style>{`
        .doc-table-wrap .ant-table-thead > tr > th {
          font-weight: 600;
          color: #262626;
          padding: 12px 16px;
          background: linear-gradient(180deg, #f5f5f5 0%, #e8e8e8 100%) !important;
          border-bottom: 2px solid #d9d9d9;
        }
        .doc-table-wrap .ant-table-tbody > tr > td {
          padding: 10px 16px;
          border-color: #e8e8e8;
        }
        .doc-table-wrap .ant-table-tbody > tr.doc-table-row-alt > td {
          background: #fafafa;
        }
        .doc-table-wrap .ant-table-tbody > tr:hover > td {
          background: #f5f9ff !important;
        }
      `}</style>
      <Card
        className="section-card section-card-accent-purple"
        title={
          <span>
            <ShoppingOutlined style={{ marginRight: 8, color: '#531dab' }} />
            商品列表
          </span>
        }
      >
        {productListTabItems.length === 0 ? (
          <Alert type="info" showIcon message="无法显示报价/成本清单，请联系管理员" />
        ) : (
          <Tabs
            defaultActiveKey={canViewQuotation ? 'quotation' : 'cost'}
            items={productListTabItems}
            onChange={(key) => {
              if (key === 'cost' && canViewCost) fetchCostList()
            }}
          />
        )}
      </Card>

      {/* 历史版本弹窗 */}
      <Modal
        title={
          historyModalType === 'quotation' ? '报价清单历史版本' : historyModalType === 'cost' ? '成本清单历史版本' : '历史版本'
        }
        open={!!historyModalType}
        onCancel={closeHistoryModal}
        footer={
          <Button type="primary" onClick={closeHistoryModal}>
            关闭
          </Button>
        }
        width="90%"
        style={{ top: 24 }}
        destroyOnHidden
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: 'calc(100vh - 160px)', overflow: 'hidden' }}>
          <div>
            <Text strong>版本列表</Text>
            {historyListLoading ? (
              <div style={{ padding: 16, color: '#999' }}>加载中…</div>
            ) : historyList.length === 0 ? (
              <div style={{ padding: 16, color: '#999' }}>暂无历史版本记录</div>
            ) : (
              <List
                size="small"
                dataSource={historyList}
                style={{ marginTop: 8, maxHeight: 180, overflow: 'auto' }}
                renderItem={(item) => (
                  <List.Item
                    key={item.id}
                    onClick={() => loadHistoryDetail(item.id)}
                    style={{
                      cursor: 'pointer',
                      background: historySelectedId === item.id ? '#e6f4ff' : undefined,
                      padding: '8px 12px',
                      borderRadius: 6,
                    }}
                  >
                    <Space>
                      <Text strong>版本 {item.version}</Text>
                      <Text type="secondary">
                        {item.created_at ? item.created_at.slice(0, 19).replace('T', ' ') : '—'}
                      </Text>
                      {item.created_by && <Text type="secondary">操作人：{item.created_by}</Text>}
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </div>
          {historySelectedId != null && (
            <div style={{ flex: 1, minHeight: 200, overflow: 'auto' }}>
              <Text strong>版本明细</Text>
              {historyDetailLoading ? (
                <div style={{ padding: 24, color: '#999' }}>加载中…</div>
              ) : historyDetail && historyModalType === 'quotation' ? (
                <div className="doc-table-wrap" style={{ ...docTableWrapStyle, marginTop: 8 }}>
                  <Table<Product>
                    rowKey={(r) => String(r.id ?? Math.random())}
                    size="small"
                    columns={quotationColumns}
                    dataSource={sortedHistorySnapshot as Product[]}
                    scroll={{ x: 900 }}
                    bordered
                    pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
                  />
                </div>
              ) : historyDetail && historyModalType === 'cost' ? (
                <div className="doc-table-wrap" style={{ ...docTableWrapStyle, marginTop: 8 }}>
                  <Table<CostListItem>
                    rowKey={(r) => String(r.id ?? Math.random())}
                    size="small"
                    columns={costColumns}
                    dataSource={sortedHistorySnapshot as CostListItem[]}
                    scroll={{ x: 900 }}
                    bordered
                    pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

export default ProjectProductListPage
