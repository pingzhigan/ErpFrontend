/**
 * 功能名称：设备规格管理
 * 实现原理与逻辑：维护设备规格条目（分类、品牌型号、系统类型、参数、规格范围等）；支持按分类、系统、启用状态、关键词筛选，
 * 新增/编辑/删除。用于弱电设备参数与规格约束，供配单、规则等引用。数据来自 /api/equipment-specs。
 */
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { App, Badge, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useState } from 'react'

const { Title, Text } = Typography

type Row = {
  id: number
  code: string
  name: string
  category: string
  brand: string | null
  model: string | null
  system_type: string
  params: string | null
  spec_min: number | null
  spec_max: number | null
  unit: string | null
  description: string | null
  enabled: number
  created_at: string
  updated_at: string
}

const SYSTEM_TYPES = [
  { label: '通用', value: 'general' },
  { label: '视频监控', value: 'video' },
  { label: '门禁', value: 'access' },
  { label: '综合布线', value: 'cabling' },
  { label: '广播', value: 'broadcast' },
  { label: '会议', value: 'meeting' },
]

const EquipmentSpecsPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form] = Form.useForm()
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined)
  const [systemFilter, setSystemFilter] = useState<string | undefined>(undefined)
  const [enabledFilter, setEnabledFilter] = useState<string | undefined>(undefined)
  const [keywordSearch, setKeywordSearch] = useState('')

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (categoryFilter) params.set('category', categoryFilter)
      if (systemFilter) params.set('system_type', systemFilter)
      if (enabledFilter !== undefined) params.set('enabled', enabledFilter)
      if (keywordSearch.trim()) params.set('keyword', keywordSearch.trim())
      const res = await axios.get<{ list: Row[]; total: number }>(`/api/equipment-specs?${params.toString()}`)
      setList(res.data.list || [])
      setTotal(res.data.total ?? 0)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [categoryFilter, systemFilter, enabledFilter, keywordSearch, msg])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const openCreate = () => {
    setEditingId(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (row: Row) => {
    setEditingId(row.id)
    form.setFieldsValue({
      code: row.code,
      name: row.name,
      category: row.category,
      brand: row.brand ?? '',
      model: row.model ?? '',
      system_type: row.system_type,
      params: row.params ?? '',
      spec_min: row.spec_min,
      spec_max: row.spec_max,
      unit: row.unit ?? '',
      description: row.description ?? '',
      enabled: row.enabled === 1,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      const payload = {
        ...values,
        brand: values.brand?.trim() || null,
        model: values.model?.trim() || null,
        params: values.params?.trim() || null,
        unit: values.unit?.trim() || null,
        description: values.description?.trim() || null,
        enabled: values.enabled === true ? 1 : 0,
      }
      if (editingId) {
        await axios.put(`/api/equipment-specs/${editingId}`, payload)
        msg.success('更新成功')
      } else {
        await axios.post('/api/equipment-specs', payload)
        msg.success('创建成功')
      }
      setModalOpen(false)
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`/api/equipment-specs/${id}`)
      msg.success('已删除')
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const columns: ColumnsType<Row> = [
    { title: '编码', dataIndex: 'code', width: 120, ellipsis: true },
    { title: '名称', dataIndex: 'name', width: 120 },
    { title: '类别', dataIndex: 'category', width: 90 },
    { title: '品牌', dataIndex: 'brand', width: 80, ellipsis: true },
    { title: '型号', dataIndex: 'model', width: 100, ellipsis: true },
    { title: '子系统', dataIndex: 'system_type', width: 90 },
    { title: '单位', dataIndex: 'unit', width: 56 },
    { title: '状态', dataIndex: 'enabled', width: 72, render: (v) => (v === 1 ? <Badge status="success" text="启用" /> : <Badge status="default" text="停用" />) },
    { title: '操作', key: 'action', width: 140, render: (_, row) => (
      <Space size="small">
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
        <Popconfirm title="确定删除？" onConfirm={() => handleDelete(row.id)} okText="删除" cancelText="取消">
          <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    ) },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Title level={4} style={{ marginBottom: 0 }}>设备规格库</Title>
      <Text type="secondary">设备选型、参数范围，供公式引擎与 AI 引用。</Text>
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input placeholder="类别筛选" allowClear style={{ width: 120 }} value={categoryFilter ?? ''} onChange={(e) => setCategoryFilter(e.target.value || undefined)} />
          <Select placeholder="子系统" allowClear style={{ width: 120 }} value={systemFilter} onChange={setSystemFilter} options={SYSTEM_TYPES} />
          <Select placeholder="状态" allowClear style={{ width: 100 }} value={enabledFilter} onChange={setEnabledFilter} options={[{ label: '启用', value: '1' }, { label: '停用', value: '0' }]} />
          <Input.Search placeholder="编码/名称/型号" allowClear style={{ width: 180 }} value={keywordSearch} onChange={(e) => setKeywordSearch(e.target.value)} onSearch={() => fetchList()} enterButton="查询" />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>
          <Button onClick={fetchList}>刷新</Button>
        </Space>
        <Table<Row> rowKey="id" size="small" loading={loading} columns={columns} dataSource={list} pagination={{ total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }} />
      </Card>
      <Modal title={editingId ? '编辑设备规格' : '新增设备规格'} open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)} width={560} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="编码" rules={[{ required: true }]}><Input placeholder="唯一编码" disabled={!!editingId} /></Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="设备名称" /></Form.Item>
          <Form.Item name="category" label="类别" rules={[{ required: true }]}><Input placeholder="如 摄像机/交换机/NVR/线缆" /></Form.Item>
          <Form.Item name="brand" label="品牌"><Input placeholder="品牌" /></Form.Item>
          <Form.Item name="model" label="型号"><Input placeholder="型号" /></Form.Item>
          <Form.Item name="system_type" label="子系统"><Select options={SYSTEM_TYPES} placeholder="general/video/..." /></Form.Item>
          <Form.Item name="params" label="参数(JSON)"><Input.TextArea rows={2} placeholder='如 {"resolution":"4MP","poe":true}' /></Form.Item>
          <Space style={{ width: '100%' }}>
            <Form.Item name="spec_min" label="规格下限"><InputNumber placeholder="可选" style={{ width: 120 }} /></Form.Item>
            <Form.Item name="spec_max" label="规格上限"><InputNumber placeholder="可选" style={{ width: 120 }} /></Form.Item>
          </Space>
          <Form.Item name="unit" label="单位"><Input placeholder="如 台/个/米" /></Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="enabled" label="启用" initialValue={true}><Select options={[{ label: '启用', value: true }, { label: '停用', value: false }]} /></Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}

export default EquipmentSpecsPage
