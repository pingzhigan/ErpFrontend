/**
 * 功能名称：档次系数管理
 * 实现原理与逻辑：维护按项目档次（小型/中型/大型）的调整系数，支持乘数/加数及目标字段；按档次、系统、启用状态筛选，
 * 新增/编辑/删除。用于报价或成本按项目规模差异化。数据来自 /api/tier-factors。
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
  tier_code: string
  system_type: string
  coefficient: number
  adjustment_type: 'multiply' | 'add'
  target_field: string | null
  description: string | null
  enabled: number
  created_at: string
  updated_at: string
}

const ADJUSTMENT_TYPES = [
  { label: '乘数(multiply)', value: 'multiply' },
  { label: '加数(add)', value: 'add' },
]
const SYSTEM_TYPES = [
  { label: '通用', value: 'general' },
  { label: '视频监控', value: 'video' },
  { label: '门禁', value: 'access' },
  { label: '综合布线', value: 'cabling' },
  { label: '广播', value: 'broadcast' },
  { label: '会议', value: 'meeting' },
]
const TIER_CODES = [
  { label: '小型', value: 'small' },
  { label: '中型', value: 'medium' },
  { label: '大型', value: 'large' },
]

const TierFactorsPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form] = Form.useForm()
  const [tierFilter, setTierFilter] = useState<string | undefined>(undefined)
  const [systemFilter, setSystemFilter] = useState<string | undefined>(undefined)
  const [enabledFilter, setEnabledFilter] = useState<string | undefined>(undefined)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (tierFilter) params.set('tier_code', tierFilter)
      if (systemFilter) params.set('system_type', systemFilter)
      if (enabledFilter !== undefined) params.set('enabled', enabledFilter)
      const res = await axios.get<{ list: Row[]; total: number }>(`/api/tier-factors?${params.toString()}`)
      setList(res.data.list || [])
      setTotal(res.data.total ?? 0)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [tierFilter, systemFilter, enabledFilter, msg])

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
      tier_code: row.tier_code,
      system_type: row.system_type,
      coefficient: row.coefficient,
      adjustment_type: row.adjustment_type,
      target_field: row.target_field ?? '',
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
        target_field: values.target_field?.trim() || null,
        description: values.description?.trim() || null,
        enabled: values.enabled === true ? 1 : 0,
      }
      if (editingId) {
        await axios.put(`/api/tier-factors/${editingId}`, payload)
        msg.success('更新成功')
      } else {
        await axios.post('/api/tier-factors', payload)
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
      await axios.delete(`/api/tier-factors/${id}`)
      msg.success('已删除')
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const columns: ColumnsType<Row> = [
    { title: '编码', dataIndex: 'code', width: 120, ellipsis: true },
    { title: '名称', dataIndex: 'name', width: 120 },
    { title: '档位', dataIndex: 'tier_code', width: 80, render: (v) => TIER_CODES.find((t) => t.value === v)?.label ?? v },
    { title: '子系统', dataIndex: 'system_type', width: 90 },
    { title: '系数', dataIndex: 'coefficient', width: 80, align: 'right' },
    { title: '类型', dataIndex: 'adjustment_type', width: 90, render: (v) => (v === 'multiply' ? '乘数' : '加数') },
    { title: '作用目标', dataIndex: 'target_field', width: 90, ellipsis: true },
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
      <Title level={4} style={{ marginBottom: 0 }}>档位修正系数</Title>
      <Text type="secondary">按项目档位（小型/中型/大型）对数量或单价做修正。</Text>
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Select placeholder="档位" allowClear style={{ width: 100 }} value={tierFilter} onChange={setTierFilter} options={TIER_CODES} />
          <Select placeholder="子系统" allowClear style={{ width: 120 }} value={systemFilter} onChange={setSystemFilter} options={SYSTEM_TYPES} />
          <Select placeholder="状态" allowClear style={{ width: 100 }} value={enabledFilter} onChange={setEnabledFilter} options={[{ label: '启用', value: '1' }, { label: '停用', value: '0' }]} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>
          <Button onClick={fetchList}>刷新</Button>
        </Space>
        <Table<Row> rowKey="id" size="small" loading={loading} columns={columns} dataSource={list} pagination={{ total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }} />
      </Card>
      <Modal title={editingId ? '编辑档位修正系数' : '新增档位修正系数'} open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)} width={520} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="编码" rules={[{ required: true }]}><Input placeholder="唯一编码" disabled={!!editingId} /></Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="名称" /></Form.Item>
          <Form.Item name="tier_code" label="档位" rules={[{ required: true }]}><Select options={TIER_CODES} placeholder="small/medium/large" /></Form.Item>
          <Form.Item name="system_type" label="子系统"><Select options={SYSTEM_TYPES} placeholder="general/video/..." /></Form.Item>
          <Form.Item name="coefficient" label="系数" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} placeholder="乘数或加数" /></Form.Item>
          <Form.Item name="adjustment_type" label="修正类型" rules={[{ required: true }]}><Select options={ADJUSTMENT_TYPES} /></Form.Item>
          <Form.Item name="target_field" label="作用目标（可选）"><Input placeholder="如 quantity / unit_price" /></Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="enabled" label="启用" initialValue={true}><Select options={[{ label: '启用', value: true }, { label: '停用', value: false }]} /></Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}

export default TierFactorsPage
