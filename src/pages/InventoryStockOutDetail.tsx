/**
 * 出库单详情：展示单号、关联项目、来源、操作人、时间等基本信息及出库商品明细表
 */
import { ArrowLeftOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { App, Button, Card, Descriptions, Table, Typography } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const { Title, Text } = Typography

type StockOutRecord = {
  id: number
  ref_no: string | null
  inventory_id: number | null
  sku: string | null
  goods_name: string | null
  quantity: number
  unit: string | null
  warehouse: string | null
  project_name: string | null
  remark: string | null
  source_type: string
  created_at: string
  created_by: string | null
  /** 来自库存：品牌、型号、参数、成本单价、成本金额、入库关联项目 */
  brand?: string | null
  model?: string | null
  params?: string | null
  unit_price?: number | null
  cost_amount?: number | null
  inventory_project_name?: string | null
}

type DetailSummary = {
  ref_no: string | null
  project_name: string | null
  source_type: string
  natural_language_text: string | null
  created_at: string
  created_by: string | null
}

const InventoryStockOutDetailPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const refNo = searchParams.get('ref_no') ?? ''
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<DetailSummary | null>(null)
  const [items, setItems] = useState<StockOutRecord[]>([])

  const fetchDetail = useCallback(async () => {
    if (!refNo.trim()) {
      msg.warning('缺少单号')
      return
    }
    setLoading(true)
    try {
      const res = await axios.get<{ summary: DetailSummary; items: StockOutRecord[] }>(
        `/api/inventory/stock-out/detail?ref_no=${encodeURIComponent(refNo)}`
      )
      setSummary(res.data.summary ?? null)
      setItems(res.data.items ?? [])
    } catch (e: any) {
      if (e?.response?.status === 404) {
        msg.error('未找到该出库单')
      } else {
        msg.error(e?.response?.data?.message || '加载失败')
      }
    } finally {
      setLoading(false)
    }
  }, [refNo, msg])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  const columns: ColumnsType<StockOutRecord> = [
    { title: '序号', key: 'idx', width: 64, render: (_, __, i) => i + 1 },
    { title: 'SKU', dataIndex: 'sku', width: 110, ellipsis: true, render: (v) => v || '—' },
    { title: '货物名称', dataIndex: 'goods_name', width: 140, ellipsis: true, render: (v) => v || '—' },
    { title: '品牌', dataIndex: 'brand', width: 90, ellipsis: true, render: (v) => v || '—' },
    { title: '型号', dataIndex: 'model', width: 100, ellipsis: true, render: (v) => v || '—' },
    { title: '参数', dataIndex: 'params', width: 120, ellipsis: true, render: (v) => v || '—' },
    { title: '数量', dataIndex: 'quantity', width: 80, align: 'right' },
    { title: '单位', dataIndex: 'unit', width: 56, render: (v) => v || '—' },
    { title: '成本单价', dataIndex: 'unit_price', width: 95, align: 'right', render: (v) => (v != null ? Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—') },
    { title: '成本金额', dataIndex: 'cost_amount', width: 95, align: 'right', render: (v) => (v != null ? Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—') },
    { title: '关联项目（入库）', dataIndex: 'inventory_project_name', width: 110, ellipsis: true, render: (v) => v || '—' },
    { title: '仓库', dataIndex: 'warehouse', width: 90, ellipsis: true, render: (v) => v || '—' },
    { title: '备注', dataIndex: 'remark', width: 100, ellipsis: true, render: (v) => v || '—' },
  ]

  if (!refNo.trim()) {
    return (
      <div className="page-content-wrap" style={{ padding: 24 }}>
        <Text type="secondary">缺少单号参数</Text>
        <Button type="link" onClick={() => navigate(-1)}>返回</Button>
      </div>
    )
  }

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      <div style={{ marginBottom: 16 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          返回
        </Button>
      </div>
      <Card title="出库单详情" loading={loading} className="section-card">
        {summary && (
          <>
            <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="单号">{summary.ref_no ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="关联项目">{summary.project_name ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="来源">{summary.source_type === 'natural_language' ? '自然语言' : '手动'}</Descriptions.Item>
              <Descriptions.Item label="操作人">{summary.created_by ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="出库时间">{summary.created_at ? summary.created_at.slice(0, 19).replace('T', ' ') : '—'}</Descriptions.Item>
              {summary.natural_language_text && (
                <Descriptions.Item label="自然语言" span={3}>
                  <Text type="secondary" style={{ whiteSpace: 'pre-wrap' }}>{summary.natural_language_text}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>
            <Title level={5} style={{ marginTop: 16, marginBottom: 12 }}>出库商品明细</Title>
            <Table<StockOutRecord>
              rowKey="id"
              size="small"
              columns={columns}
              dataSource={items}
              pagination={false}
              scroll={{ x: 1200 }}
              locale={{ emptyText: '无明细' }}
            />
          </>
        )}
      </Card>
    </div>
  )
}

export default InventoryStockOutDetailPage
