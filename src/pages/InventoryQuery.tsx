/**
 * 功能名称：库存查询
 * 实现原理与逻辑：按关键词、SKU、仓库、项目等条件查询当前库存列表，支持分页；可对单条库存进行编辑（数量、单价等）
 * 与删除。项目筛选支持远程搜索。数据来自 /api/inventory 的列表与更新接口。
 */
import { DeleteOutlined, EditOutlined, ExportOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
} from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useRef, useState } from 'react'

const { Title, Text } = Typography

export type InventoryItem = {
  id: number
  sku: string | null
  goods_name: string
  brand: string | null
  model: string | null
  params: string | null
  unit: string | null
  quantity: number | null
  unit_price: number | null
  warehouse: string | null
  project_name: string | null
  remark: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

const InventoryQueryPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<InventoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingRow, setEditingRow] = useState<InventoryItem | null>(null)
  const [form] = Form.useForm()
  const [keyword, setKeyword] = useState('')
  const [skuFilter, setSkuFilter] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [projectOptions, setProjectOptions] = useState<string[]>([])
  const [exportLoading, setExportLoading] = useState(false)
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false)
  const projectSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchProjects = useCallback(async (searchKeyword?: string) => {
    try {
      const params = new URLSearchParams()
      if (searchKeyword != null && searchKeyword.trim()) params.set('keyword', searchKeyword.trim())
      const res = await axios.get<{ list: string[] }>(`/api/products/projects?${params.toString()}`)
      setProjectOptions(res.data.list || [])
    } catch {
      setProjectOptions([])
    }
  }, [])

  const onProjectSearch = useCallback((value: string) => {
    if (projectSearchTimerRef.current) clearTimeout(projectSearchTimerRef.current)
    projectSearchTimerRef.current = setTimeout(() => fetchProjects(value || ''), 300)
  }, [fetchProjects])

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (keyword.trim()) params.set('keyword', keyword.trim())
      if (skuFilter.trim()) params.set('sku', skuFilter.trim())
      if (warehouseFilter.trim()) params.set('warehouse', warehouseFilter.trim())
      if (projectFilter != null && projectFilter.trim()) params.set('project_name', projectFilter.trim())
      const res = await axios.get<{ list: InventoryItem[]; total: number }>(`/api/inventory?${params.toString()}`)
      setList(res.data.list || [])
      setTotal(res.data.total ?? 0)
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, skuFilter, warehouseFilter, projectFilter, msg])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  /** 打开导出确认弹窗（显示当前查询条数） */
  const openExportConfirm = useCallback(() => {
    setExportConfirmOpen(true)
  }, [])

  /** 确认后按当前查询条件导出库存记录为 Excel（使用 axios 携带 token，避免未授权） */
  const handleExportExcel = useCallback(async () => {
    setExportConfirmOpen(false)
    setExportLoading(true)
    try {
      const params: Record<string, string> = {}
      if (keyword.trim()) params.keyword = keyword.trim()
      if (skuFilter.trim()) params.sku = skuFilter.trim()
      if (warehouseFilter.trim()) params.warehouse = warehouseFilter.trim()
      if (projectFilter != null && projectFilter.trim()) params.project_name = projectFilter.trim()
      const res = await axios.get<Blob>('/api/inventory/export-excel', {
        params,
        responseType: 'blob',
      })
      const disposition = res.headers['content-disposition']
      let filename = `库存记录_${new Date().toISOString().slice(0, 10)}.xlsx`
      if (disposition) {
        const m = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i)
        if (m?.[1]) filename = decodeURIComponent(m[1].trim().replace(/^["']|["']$/g, ''))
      }
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data])
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
      msg.success('导出成功')
    } catch (e: any) {
      if (e?.response?.status === 403) {
        let tip = '无权限导出，请在「用户管理」中为当前角色分配「库存查询」或「库存维护」权限'
        if (e?.response?.data instanceof Blob) {
          try {
            const text = await (e.response.data as Blob).text()
            const j = JSON.parse(text || '{}')
            if (j?.message) tip = j.message
          } catch { /* use default */ }
        } else if (typeof e?.response?.data?.message === 'string') {
          tip = e.response.data.message
        }
        msg.error(tip)
      } else if (e?.response?.status === 401) {
        msg.error('未授权或登录已失效，请重新登录')
      } else {
        const msgText = e?.response?.data?.message ?? e?.message ?? '导出失败'
        try {
          if (e?.response?.data instanceof Blob) {
            const text = await (e.response.data as Blob).text()
            const err = JSON.parse(text || '{}')
            msg.error(err?.message || msgText)
          } else {
            msg.error(typeof e?.response?.data?.message === 'string' ? e.response.data.message : msgText)
          }
        } catch {
          msg.error(msgText)
        }
      }
    } finally {
      setExportLoading(false)
    }
  }, [keyword, skuFilter, warehouseFilter, projectFilter, msg])

  const openCreate = () => {
    setEditingId(null)
    setEditingRow(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (row: InventoryItem) => {
    setEditingId(row.id)
    setEditingRow(row)
    setModalOpen(true)
  }

  // 编辑时等弹窗和表单挂载后再回填；延迟一帧确保 Form 已挂载（destroyOnClose 时子组件会重建）
  useEffect(() => {
    if (!modalOpen || !editingRow) return
    const t = setTimeout(() => {
      form.setFieldsValue({
        sku: editingRow.sku ?? undefined,
        goods_name: editingRow.goods_name,
        brand: editingRow.brand ?? undefined,
        model: editingRow.model ?? undefined,
        params: editingRow.params ?? undefined,
        unit: editingRow.unit ?? undefined,
        quantity: editingRow.quantity ?? undefined,
        unit_price: editingRow.unit_price ?? undefined,
        warehouse: editingRow.warehouse ?? undefined,
        project_name: editingRow.project_name ?? undefined,
        remark: editingRow.remark ?? undefined,
      })
    }, 0)
    return () => clearTimeout(t)
  }, [modalOpen, editingRow, form])

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingId) {
        await axios.put(`/api/inventory/${editingId}`, values)
        msg.success('更新成功')
      } else {
        await axios.post('/api/inventory', values)
        msg.success('创建成功')
      }
      setModalOpen(false)
      setEditingRow(null)
      fetchList()
    } catch (e: any) {
      if (e?.errorFields) return
      msg.error(e?.response?.data?.message || '保存失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`/api/inventory/${id}`)
      msg.success('已删除')
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }

  const columns: ColumnsType<InventoryItem> = [
    { title: 'SKU/条码', dataIndex: 'sku', width: 110, ellipsis: true },
    { title: '货物名称', dataIndex: 'goods_name', width: 140, ellipsis: true },
    { title: '品牌', dataIndex: 'brand', width: 90, ellipsis: true },
    { title: '型号', dataIndex: 'model', width: 110, ellipsis: true },
    { title: '单位', dataIndex: 'unit', width: 56 },
    {
      title: '数量',
      dataIndex: 'quantity',
      width: 80,
      align: 'right',
      render: (v) => (v != null ? Number(v) : '—'),
    },
    {
      title: '成本单价',
      dataIndex: 'unit_price',
      width: 95,
      align: 'right',
      render: (v) => (v != null && !Number.isNaN(Number(v)) ? Number(v) : '—'),
    },
    {
      title: '成本金额',
      key: 'cost_amount',
      width: 95,
      align: 'right',
      render: (_, row) => {
        const q = row.quantity != null ? Number(row.quantity) : NaN
        const p = row.unit_price != null ? Number(row.unit_price) : NaN
        if (Number.isNaN(q) || Number.isNaN(p)) return '—'
        return (q * p).toFixed(2)
      },
    },
    { title: '仓库/仓位', dataIndex: 'warehouse', width: 100, ellipsis: true },
    { title: '关联项目', dataIndex: 'project_name', width: 120, ellipsis: true, render: (v: string | null) => v || '—' },
    { title: '备注', dataIndex: 'remark', width: 100, ellipsis: true },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 160,
      render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right',
      render: (_, row) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(row.id)} okText="删除" cancelText="取消">
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
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
          <div className="header-icon-wrap" style={{ background: 'linear-gradient(135deg, #08979c, #13c2c2)' }}>
            <SearchOutlined />
          </div>
          <div>
            <Title level={4} className="header-title" style={{ marginBottom: 0 }}>
              库存查询
            </Title>
            <Text type="secondary" className="header-desc" style={{ display: 'block' }}>
              库存记录的增删改查，支持关联项目（项目遗留物品）；可按项目、SKU、仓库、关键词筛选。
            </Text>
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增
        </Button>
      </div>

      <Card className="section-card section-card-accent-blue">
        <Space wrap style={{ marginBottom: 16 }} align="center">
          <Select
            placeholder="按项目筛选（可输入搜索）"
            allowClear
            showSearch
            optionFilterProp="label"
            filterOption={false}
            style={{ width: 200 }}
            value={projectFilter === null ? undefined : projectFilter}
            onChange={(v) => setProjectFilter(v == null || v === '' ? null : v)}
            onSearch={(v) => onProjectSearch(v || '')}
            onOpenChange={(open) => open && fetchProjects()}
            options={[
              ...projectOptions.map((p) => ({ label: p, value: p })),
              ...(projectFilter && !projectOptions.includes(projectFilter) ? [{ label: projectFilter, value: projectFilter }] : []),
            ]}
          />
          <Input
            placeholder="关键词（名称、品牌、型号等）"
            allowClear
            style={{ width: 200 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => fetchList()}
          />
          <Input
            placeholder="SKU/条码"
            allowClear
            style={{ width: 120 }}
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            onPressEnter={() => fetchList()}
          />
          <Input
            placeholder="仓库/仓位"
            allowClear
            style={{ width: 120 }}
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            onPressEnter={() => fetchList()}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={() => fetchList()}>
            查询
          </Button>
          <Button onClick={fetchList}>刷新</Button>
          <Button icon={<ExportOutlined />} loading={exportLoading} onClick={openExportConfirm}>
            导出 Excel
          </Button>
        </Space>
        <Modal
          title="导出库存记录"
          open={exportConfirmOpen}
          onCancel={() => setExportConfirmOpen(false)}
          onOk={() => handleExportExcel()}
          okText="确定导出"
          cancelText="取消"
        >
          <Typography.Text>
            将按当前查询条件导出库存记录，共 <Typography.Text strong>{total}</Typography.Text> 条，确定导出？
          </Typography.Text>
        </Modal>
        <Table<InventoryItem>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 1400 }}
          pagination={{
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
          locale={{ emptyText: '暂无库存记录' }}
        />
      </Card>

      <Modal
        title={editingId ? '编辑库存' : '新增库存'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => { setModalOpen(false); setEditingRow(null) }}
        width={520}
      >
        <Form form={form} layout="vertical" validateTrigger={['onSubmit', 'onBlur']}>
          <Form.Item name="sku" label="SKU/条码" rules={[{ required: true, message: '请输入 SKU/条码' }]}>
            <Input placeholder="请输入 SKU/条码" disabled={!!editingId} />
          </Form.Item>
          <Form.Item name="goods_name" label="货物名称" rules={[{ required: true, message: '请输入货物名称' }]}>
            <Input placeholder="请输入货物名称" />
          </Form.Item>
          <Form.Item name="brand" label="品牌" rules={[{ required: true, message: '请输入品牌' }]}>
            <Input placeholder="请输入品牌" />
          </Form.Item>
          <Form.Item name="model" label="型号" rules={[{ required: true, message: '请输入型号' }]}>
            <Input placeholder="请输入型号" />
          </Form.Item>
          <Form.Item name="params" label="参数/规格">
            <Input.TextArea rows={2} placeholder="参数（选填）" />
          </Form.Item>
          <Form.Item name="unit" label="单位" rules={[{ required: true, message: '请输入单位' }]}>
            <Input placeholder="单位（台/个/箱等）" />
          </Form.Item>
          <Form.Item
            name="quantity"
            label="数量"
            rules={[
              { required: true, message: '请输入数量' },
              { type: 'number', min: 0, message: '数量不能小于 0' },
            ]}
          >
            <InputNumber min={0} style={{ width: '100%' }} placeholder="请输入数量" />
          </Form.Item>
          <Form.Item name="unit_price" label="成本单价">
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="单价（选填）" />
          </Form.Item>
          <Form.Item name="warehouse" label="仓库/仓位">
            <Input placeholder="仓库或仓位（选填）" />
          </Form.Item>
          <Form.Item name="project_name" label="关联项目">
            <Input placeholder="项目遗留可填项目名称（选填）" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="备注（选填）" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default InventoryQueryPage
