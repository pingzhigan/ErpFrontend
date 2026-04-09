/**
 * 功能名称：配单管理
 * 实现原理与逻辑：管理配单（配置单）主表及明细行；列表展示配单名称、关联项目、创建时间等，支持新增/编辑/删除。配单详情以抽屉形式展示，
 * 内含商品明细表（序号、货物、品牌型号、数量、单价、金额等），可编辑明细并自动汇总金额。支持导出与历史版本查看。
 */
import {
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  FolderOutlined,
  HistoryOutlined,
  PlusOutlined,
  ShoppingOutlined,
  FundOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography,
} from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useState } from 'react'

const { Title, Text } = Typography

export type ConfigOrderRecord = {
  id: number
  name: string
  project_name: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export type ConfigOrderItemRow = {
  id: number
  config_order_id: number
  sequence_no: number | null
  goods_name: string | null
  brand: string | null
  model: string | null
  params: string | null
  unit: string | null
  quantity: number | null
  unit_price_excl_tax: number | null
  unit_price_incl_tax: number | null
  amount_excl_tax: number | null
  amount_incl_tax: number | null
  tax_rate: number | null
  remark: string | null
  _key?: string
}

export type ConfigOrderDetail = ConfigOrderRecord & {
  items: ConfigOrderItemRow[]
}

const formatMoney = (v: number | null | undefined) =>
  v != null && Number.isFinite(v)
    ? Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'

const sumItems = (items: ConfigOrderItemRow[]) => {
  let amountIncl = 0
  let amountExcl = 0
  let quantityTotal = 0
  for (const row of items) {
    const incl = row.amount_incl_tax != null ? Number(row.amount_incl_tax) : 0
    const excl = row.amount_excl_tax != null ? Number(row.amount_excl_tax) : 0
    const qty = row.quantity != null ? Number(row.quantity) : 0
    if (Number.isFinite(incl)) amountIncl += incl
    if (Number.isFinite(excl)) amountExcl += excl
    if (Number.isFinite(qty)) quantityTotal += qty
  }
  return { amountIncl, amountExcl, quantityTotal }
}

const ConfigOrdersPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<ConfigOrderRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detail, setDetail] = useState<ConfigOrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [isEdit, setIsEdit] = useState(false)
  const [form] = Form.useForm()
  const [items, setItems] = useState<ConfigOrderItemRow[]>([])
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState<'cost' | 'products' | null>(null)
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [historyList, setHistoryList] = useState<{ id: number; project_name: string; version: number; created_at: string; created_by: string | null }[]>([])
  const [historyListLoading, setHistoryListLoading] = useState(false)
  const [historyDetailOpen, setHistoryDetailOpen] = useState(false)
  const [historyDetail, setHistoryDetail] = useState<{ id: number; project_name: string; version: number; created_at: string; created_by: string | null; snapshot: { name: string; items: ConfigOrderItemRow[] } } | null>(null)
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get<{ list: ConfigOrderRecord[]; total: number }>('/api/config-orders')
      setList(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载配单列表失败')
    } finally {
      setLoading(false)
    }
  }, [msg])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const loadDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true)
      try {
        const res = await axios.get<ConfigOrderDetail>(`/api/config-orders/${id}`)
        setDetail(res.data)
        setItems((res.data.items || []).map((it, i) => ({ ...it, _key: `item-${it.id}-${i}` })))
        form.setFieldsValue({
          name: res.data.name,
          project_name: res.data.project_name ?? undefined,
        })
      } catch (e: any) {
        msg.error(e?.response?.data?.message || '加载配单详情失败')
        setDetail(null)
      } finally {
        setDetailLoading(false)
      }
    },
    [form, msg],
  )

  const updateItem = (index: number, field: keyof ConfigOrderItemRow, value: unknown) => {
    setItems((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const addItemRow = () => {
    setItems((prev) => [
      ...prev,
      {
        id: 0,
        config_order_id: 0,
        sequence_no: prev.length + 1,
        goods_name: null,
        brand: null,
        model: null,
        params: null,
        unit: null,
        quantity: null,
        unit_price_excl_tax: null,
        unit_price_incl_tax: null,
        amount_excl_tax: null,
        amount_incl_tax: null,
        tax_rate: null,
        remark: null,
        _key: `new-${Date.now()}-${prev.length}`,
      } as ConfigOrderItemRow & { _key: string },
    ])
  }

  const removeItemRow = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const openHistoryModal = useCallback(async () => {
    if (!detail?.project_name?.trim()) return
    setHistoryModalOpen(true)
    setHistoryListLoading(true)
    try {
      const res = await axios.get<{ list: { id: number; project_name: string; version: number; created_at: string; created_by: string | null }[] }>(
        '/api/config-orders/history',
        { params: { project_name: detail.project_name.trim() } },
      )
      setHistoryList(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载历史版本失败')
      setHistoryList([])
    } finally {
      setHistoryListLoading(false)
    }
  }, [detail?.project_name, msg])

  const openHistoryDetail = useCallback(async (id: number) => {
    setHistoryDetailLoading(true)
    try {
      const res = await axios.get<{
        id: number
        project_name: string
        version: number
        created_at: string
        created_by: string | null
        snapshot: { name: string; items: ConfigOrderItemRow[] }
      }>(`/api/config-orders/history/${id}`)
      setHistoryDetail(res.data)
      setHistoryDetailOpen(true)
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载历史详情失败')
    } finally {
      setHistoryDetailLoading(false)
    }
  }, [msg])

  const openView = (record: ConfigOrderRecord) => {
    setIsEdit(false)
    setDrawerOpen(true)
    loadDetail(record.id)
  }

  const openEdit = (record: ConfigOrderRecord) => {
    setIsEdit(true)
    setDrawerOpen(true)
    loadDetail(record.id)
  }

  const openCreate = () => {
    setDetail(null)
    setItems([])
    form.resetFields()
    setIsEdit(true)
    setDrawerOpen(true)
  }

  const handleSave = async () => {
    try {
      const { name, project_name } = await form.validateFields()
      setSaving(true)
      const payload = {
        name: (name ?? '').trim() || '未命名配单',
        project_name: (project_name ?? '').trim() || null,
        items: items.map(({ id, config_order_id, _key, ...rest }) => rest),
      }
      if (detail?.id) {
        await axios.put(`/api/config-orders/${detail.id}`, payload)
        msg.success('已更新配单')
      } else {
        await axios.post('/api/config-orders', payload)
        msg.success('已新建配单')
      }
      setDrawerOpen(false)
      fetchList()
    } catch (e: any) {
      if (e?.errorFields) return
      msg.error(e?.response?.data?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`/api/config-orders/${id}`)
      msg.success('已删除配单')
      if (detail?.id === id) setDrawerOpen(false)
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }

  const importToCostList = async (order: ConfigOrderDetail) => {
    if (!order.project_name?.trim()) {
      msg.warning('请先为该配单设置项目名称后再导入成本清单')
      return
    }
    setImporting('cost')
    try {
      const costItems = order.items.map((it) => ({
        sequence_no: it.sequence_no,
        goods_name: it.goods_name ?? '',
        brand: it.brand,
        model: it.model,
        params: it.params,
        unit: it.unit,
        quantity: it.quantity,
        cost_price: it.unit_price_incl_tax,
        cost_amount: it.amount_incl_tax,
        remark: it.remark,
        project_name: order.project_name,
      }))
      await axios.post('/api/cost-list/bulk', { items: costItems })
      msg.success(`已导入 ${costItems.length} 条到成本清单`)
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '导入成本清单失败')
    } finally {
      setImporting(null)
    }
  }

  const importToProducts = async (order: ConfigOrderDetail) => {
    if (!order.project_name?.trim()) {
      msg.warning('请先为该配单设置项目名称后再导入报价清单')
      return
    }
    setImporting('products')
    try {
      const productItems = order.items.map((it) => ({
        sequence_no: it.sequence_no,
        goods_name: it.goods_name ?? '',
        brand: it.brand,
        model: it.model,
        params: it.params,
        unit: it.unit,
        quantity: it.quantity,
        unit_price_excl_tax: it.unit_price_excl_tax,
        unit_price_incl_tax: it.unit_price_incl_tax,
        amount_excl_tax: it.amount_excl_tax,
        amount_incl_tax: it.amount_incl_tax,
        tax_rate: it.tax_rate,
        remark: it.remark,
        project_name: order.project_name,
      }))
      await axios.post('/api/products/bulk', { items: productItems })
      msg.success(`已导入 ${productItems.length} 条到报价清单`)
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '导入报价清单失败')
    } finally {
      setImporting(null)
    }
  }

  const listColumns: ColumnsType<ConfigOrderRecord> = [
    {
      title: '配单名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      ellipsis: true,
      render: (v: string) => (
        <Space>
          <FolderOutlined style={{ color: 'var(--ant-colorPrimary)' }} />
          {v || '—'}
        </Space>
      ),
    },
    {
      title: '关联项目',
      dataIndex: 'project_name',
      key: 'project_name',
      width: 180,
      ellipsis: true,
      render: (v: string | null) => v || '—',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: 340,
      fixed: 'right',
      render: (_, row) => (
        <Space size="small" wrap>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openView(row)}>
            查看
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title="确定导入到成本清单？"
            description="将使用本配单的项目名称，把当前明细写入成本清单。"
            onConfirm={() => {
              axios.get<ConfigOrderDetail>(`/api/config-orders/${row.id}`).then((res) => {
                importToCostList(res.data)
              })
            }}
            okText="导入"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              icon={<FundOutlined />}
              loading={importing === 'cost'}
              disabled={!!importing}
            >
              导入成本
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确定导入到报价清单？"
            description="将使用本配单的项目名称，把当前明细写入报价清单。"
            onConfirm={() => {
              axios.get<ConfigOrderDetail>(`/api/config-orders/${row.id}`).then((res) => {
                importToProducts(res.data)
              })
            }}
            okText="导入"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              icon={<ShoppingOutlined />}
              loading={importing === 'products'}
              disabled={!!importing}
            >
              导入报价
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确定删除该配单？"
            onConfirm={() => handleDelete(row.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      <div className="page-header-banner">
        <div className="header-left">
          <div className="header-icon-wrap" style={{ background: 'linear-gradient(135deg, #531dab, #722ed1)' }}>
            <ExportOutlined />
          </div>
          <div>
            <Title level={4} className="header-title" style={{ marginBottom: 0 }}>
              项目配单
            </Title>
            <Text type="secondary" className="header-desc" style={{ display: 'block' }}>
              对通过自动配单功能保存的数据进行增删改查；可一键导入到成本清单或报价清单，属于过渡清单。
            </Text>
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增配单
        </Button>
      </div>

      <Card className="section-card section-card-accent-purple">
        <Table<ConfigOrderRecord>
          rowKey="id"
          size="small"
          loading={loading}
          columns={listColumns}
          dataSource={list}
          pagination={{
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
          locale={{ emptyText: '暂无配单，请点击右上角「新增配单」创建' }}
        />
      </Card>

      <Drawer
        title={detail ? (isEdit ? '编辑配单' : '查看配单') : '新增配单'}
        placement="right"
        width={1080}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        destroyOnHidden
        extra={
          isEdit ? (
            <Space>
              <Button onClick={() => setDrawerOpen(false)}>取消</Button>
              <Button type="primary" loading={saving} onClick={handleSave}>
                保存
              </Button>
            </Space>
          ) : detail ? (
            <Space>
              {detail.project_name?.trim() && (
                <Button icon={<HistoryOutlined />} onClick={openHistoryModal}>
                  历史版本
                </Button>
              )}
              <Button icon={<EditOutlined />} onClick={() => setIsEdit(true)}>
                编辑
              </Button>
              <Button
                type="primary"
                ghost
                icon={<FundOutlined />}
                onClick={() => detail && importToCostList(detail)}
                loading={importing === 'cost'}
                disabled={!detail.project_name?.trim()}
              >
                一键导入成本清单
              </Button>
              <Button
                type="primary"
                ghost
                icon={<ShoppingOutlined />}
                onClick={() => detail && importToProducts(detail)}
                loading={importing === 'products'}
                disabled={!detail.project_name?.trim()}
              >
                一键导入报价清单
              </Button>
              <Popconfirm
                title="确定删除该配单？"
                onConfirm={() => detail && handleDelete(detail.id)}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          ) : null
        }
      >
        {detailLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>加载中…</div>
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Form form={form} layout="vertical" disabled={!isEdit}>
              <Form.Item name="name" label="配单名称" rules={[{ required: true, message: '请输入配单名称' }]}>
                <Input placeholder="未命名配单" />
              </Form.Item>
              <Form.Item name="project_name" label="关联项目（导入成本/报价清单时使用）">
                <Input placeholder="选填，导入前请填写" />
              </Form.Item>
            </Form>
            <div>
              <Text strong>明细（{items.length} 条）</Text>
              {!isEdit && (
                <Table<ConfigOrderItemRow>
                  size="small"
                  rowKey="id"
                  dataSource={items}
                  pagination={false}
                  scroll={{ x: 900 }}
                  columns={[
                    { title: '序号', dataIndex: 'sequence_no', width: 64, align: 'right' },
                    { title: '货物名称', dataIndex: 'goods_name', width: 120, ellipsis: true },
                    { title: '品牌', dataIndex: 'brand', width: 80 },
                    { title: '型号', dataIndex: 'model', width: 100, ellipsis: true },
                    { title: '单位', dataIndex: 'unit', width: 56 },
                    { title: '数量', dataIndex: 'quantity', width: 72, align: 'right' },
                    {
                      title: '单价(含税)',
                      dataIndex: 'unit_price_incl_tax',
                      width: 96,
                      align: 'right',
                      render: (v) => formatMoney(v),
                    },
                    {
                      title: '金额(含税)',
                      dataIndex: 'amount_incl_tax',
                      width: 96,
                      align: 'right',
                      render: (v) => formatMoney(v),
                    },
                    { title: '税率', dataIndex: 'tax_rate', width: 72, align: 'right', render: (v) => (v != null ? Number(v) : '—') },
                    { title: '备注', dataIndex: 'remark', width: 80, ellipsis: true },
                  ]}
                />
              )}
              {isEdit && (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addItemRow}>
                      添加一行
                    </Button>
                  </div>
                  <Table<ConfigOrderItemRow>
                    size="small"
                    rowKey={(r) => (r as ConfigOrderItemRow & { _key?: string })._key ?? String(r.id)}
                    dataSource={items}
                    pagination={false}
                    scroll={{ x: 1000 }}
                    columns={[
                      {
                        title: '序号',
                        dataIndex: 'sequence_no',
                        width: 64,
                        render: (_, __, i) => (
                          <InputNumber
                            size="small"
                            value={items[i]?.sequence_no ?? undefined}
                            onChange={(v) => updateItem(i, 'sequence_no', v ?? null)}
                            min={0}
                            style={{ width: 56 }}
                          />
                        ),
                      },
                      {
                        title: '货物名称',
                        dataIndex: 'goods_name',
                        width: 120,
                        render: (_, __, i) => (
                          <Input
                            size="small"
                            value={items[i]?.goods_name ?? ''}
                            onChange={(e) => updateItem(i, 'goods_name', e.target.value || null)}
                            placeholder="—"
                          />
                        ),
                      },
                      {
                        title: '品牌',
                        dataIndex: 'brand',
                        width: 80,
                        render: (_, __, i) => (
                          <Input
                            size="small"
                            value={items[i]?.brand ?? ''}
                            onChange={(e) => updateItem(i, 'brand', e.target.value || null)}
                            placeholder="—"
                          />
                        ),
                      },
                      {
                        title: '型号',
                        dataIndex: 'model',
                        width: 90,
                        render: (_, __, i) => (
                          <Input
                            size="small"
                            value={items[i]?.model ?? ''}
                            onChange={(e) => updateItem(i, 'model', e.target.value || null)}
                            placeholder="—"
                          />
                        ),
                      },
                      {
                        title: '单位',
                        dataIndex: 'unit',
                        width: 56,
                        render: (_, __, i) => (
                          <Input
                            size="small"
                            value={items[i]?.unit ?? ''}
                            onChange={(e) => updateItem(i, 'unit', e.target.value || null)}
                            placeholder="—"
                          />
                        ),
                      },
                      {
                        title: '数量',
                        dataIndex: 'quantity',
                        width: 72,
                        render: (_, __, i) => (
                          <InputNumber
                            size="small"
                            value={items[i]?.quantity ?? undefined}
                            onChange={(v) => updateItem(i, 'quantity', v ?? null)}
                            min={0}
                            style={{ width: 64 }}
                          />
                        ),
                      },
                      {
                        title: '单价(含税)',
                        dataIndex: 'unit_price_incl_tax',
                        width: 96,
                        render: (_, __, i) => (
                          <InputNumber
                            size="small"
                            value={items[i]?.unit_price_incl_tax ?? undefined}
                            onChange={(v) => updateItem(i, 'unit_price_incl_tax', v ?? null)}
                            min={0}
                            precision={2}
                            style={{ width: 88 }}
                          />
                        ),
                      },
                      {
                        title: '金额(含税)',
                        dataIndex: 'amount_incl_tax',
                        width: 96,
                        render: (_, __, i) => (
                          <InputNumber
                            size="small"
                            value={items[i]?.amount_incl_tax ?? undefined}
                            onChange={(v) => updateItem(i, 'amount_incl_tax', v ?? null)}
                            min={0}
                            precision={2}
                            style={{ width: 88 }}
                          />
                        ),
                      },
                      {
                        title: '税率',
                        dataIndex: 'tax_rate',
                        width: 72,
                        render: (_, __, i) => (
                          <InputNumber
                            size="small"
                            value={items[i]?.tax_rate ?? undefined}
                            onChange={(v) => updateItem(i, 'tax_rate', v ?? null)}
                            min={0}
                            precision={2}
                            style={{ width: 64 }}
                          />
                        ),
                      },
                      {
                        title: '备注',
                        dataIndex: 'remark',
                        width: 80,
                        render: (_, __, i) => (
                          <Input
                            size="small"
                            value={items[i]?.remark ?? ''}
                            onChange={(e) => updateItem(i, 'remark', e.target.value || null)}
                            placeholder="—"
                          />
                        ),
                      },
                      {
                        title: '操作',
                        key: 'action',
                        width: 56,
                        render: (_, __, i) => (
                          <Button
                            type="link"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => removeItemRow(i)}
                          />
                        ),
                      },
                    ]}
                  />
                </>
              )}
              {items.length > 0 && (() => {
                const { amountIncl, amountExcl, quantityTotal } = sumItems(items)
                return (
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
                    <Space size="large" wrap>
                      <Text type="secondary">共 {items.length} 条</Text>
                      <Text>数量合计：<Text strong>{Number(quantityTotal).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text></Text>
                      <Text>金额(不含税) 合计：<Text strong>{formatMoney(amountExcl)}</Text> 元</Text>
                      <Text>金额(含税) 合计：<Text strong>{formatMoney(amountIncl)}</Text> 元</Text>
                    </Space>
                  </div>
                )
              })()}
            </div>
          </Space>
        )}
      </Drawer>

      <Modal
        title={`配单历史版本${detail?.project_name ? ` · ${detail.project_name}` : ''}`}
        open={historyModalOpen}
        onCancel={() => setHistoryModalOpen(false)}
        footer={null}
        width={560}
      >
        <Table<{ id: number; project_name: string; version: number; created_at: string; created_by: string | null }>
          size="small"
          rowKey="id"
          loading={historyListLoading}
          dataSource={historyList}
          pagination={false}
          columns={[
            { title: '版本', dataIndex: 'version', width: 80, align: 'right' },
            { title: '保存时间', dataIndex: 'created_at', width: 180, render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '—') },
            { title: '操作人', dataIndex: 'created_by', width: 100, ellipsis: true },
            {
              title: '操作',
              key: 'action',
              width: 80,
              render: (_, row) => (
                <Button type="link" size="small" onClick={() => openHistoryDetail(row.id)} loading={historyDetailLoading}>
                  查看
                </Button>
              ),
            },
          ]}
          locale={{ emptyText: '该项目暂无历史版本' }}
        />
      </Modal>

      <Modal
        title={historyDetail ? `历史版本 v${historyDetail.version} · ${historyDetail.snapshot?.name ?? ''}` : '历史版本详情'}
        open={historyDetailOpen}
        onCancel={() => { setHistoryDetailOpen(false); setHistoryDetail(null) }}
        footer={null}
        width={800}
      >
        {historyDetail?.snapshot?.items?.length ? (
          <Table<ConfigOrderItemRow>
            size="small"
            rowKey={(r, i) => String(r.id ?? i)}
            dataSource={historyDetail.snapshot.items}
            pagination={false}
            scroll={{ x: 900 }}
            columns={[
              { title: '序号', dataIndex: 'sequence_no', width: 64, align: 'right' },
              { title: '货物名称', dataIndex: 'goods_name', width: 120, ellipsis: true },
              { title: '品牌', dataIndex: 'brand', width: 80 },
              { title: '型号', dataIndex: 'model', width: 100, ellipsis: true },
              { title: '单位', dataIndex: 'unit', width: 56 },
              { title: '数量', dataIndex: 'quantity', width: 72, align: 'right' },
              { title: '单价(含税)', dataIndex: 'unit_price_incl_tax', width: 96, align: 'right', render: (v) => formatMoney(v) },
              { title: '金额(含税)', dataIndex: 'amount_incl_tax', width: 96, align: 'right', render: (v) => formatMoney(v) },
              { title: '税率', dataIndex: 'tax_rate', width: 72, align: 'right', render: (v) => (v != null ? Number(v) : '—') },
              { title: '备注', dataIndex: 'remark', width: 80, ellipsis: true },
            ]}
          />
        ) : (
          <Text type="secondary">无明细数据</Text>
        )}
      </Modal>
    </div>
  )
}

export default ConfigOrdersPage
