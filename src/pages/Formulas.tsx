/**
 * 功能名称：公式管理
 * 实现原理与逻辑：维护计算公式（公式表达式、输入变量、输出变量、所属系统等）；支持按系统、启用状态、关键词筛选，新增/编辑/删除公式。
 * 支持 AI 辅助生成公式描述。公式用于配单或业务中的价格、数量等推导。数据来自 /api/formulas。
 */
import { DeleteOutlined, EditOutlined, PlusOutlined, RobotOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { App, Badge, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useState } from 'react'

const { Title, Text } = Typography

type Row = {
  id: number
  code: string
  name: string
  formula_expr: string
  input_vars: string
  output_var: string
  system_type: string
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

const FormulasPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form] = Form.useForm()
  const [systemFilter, setSystemFilter] = useState<string | undefined>(undefined)
  const [enabledFilter, setEnabledFilter] = useState<string | undefined>(undefined)
  const [keywordSearch, setKeywordSearch] = useState('')
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (systemFilter) params.set('system_type', systemFilter)
      if (enabledFilter !== undefined) params.set('enabled', enabledFilter)
      if (keywordSearch.trim()) params.set('keyword', keywordSearch.trim())
      const res = await axios.get<{ list: Row[]; total: number }>(`/api/formulas?${params.toString()}`)
      setList(res.data.list || [])
      setTotal(res.data.total ?? 0)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [systemFilter, enabledFilter, keywordSearch, msg])

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
    let inputVars = row.input_vars
    if (typeof inputVars === 'string' && inputVars.startsWith('[')) {
      try {
        inputVars = JSON.parse(inputVars)
      } catch {
        inputVars = row.input_vars
      }
    }
    form.setFieldsValue({
      code: row.code,
      name: row.name,
      formula_expr: row.formula_expr,
      input_vars: Array.isArray(inputVars) ? inputVars.join(', ') : inputVars,
      output_var: row.output_var,
      system_type: row.system_type,
      description: row.description ?? '',
      enabled: row.enabled === 1,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      let inputVars = values.input_vars
      if (typeof inputVars === 'string') {
        inputVars = inputVars.split(/[,，\s]+/).filter(Boolean)
      }
      const payload = {
        ...values,
        input_vars: inputVars,
        description: values.description?.trim() || null,
        enabled: values.enabled === true ? 1 : 0,
      }
      if (editingId) {
        await axios.put(`/api/formulas/${editingId}`, payload)
        msg.success('更新成功')
      } else {
        await axios.post('/api/formulas', payload)
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
      await axios.delete(`/api/formulas/${id}`)
      msg.success('已删除')
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const handleAiCreate = async () => {
    const text = aiText.trim()
    if (!text) {
      msg.warning('请用自然语言描述要新增的公式')
      return
    }
    setAiLoading(true)
    try {
      await axios.post('/api/formulas/from-natural-language', { text })
      msg.success('已根据描述生成并保存公式')
      setAiModalOpen(false)
      setAiText('')
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'AI 解析或保存失败')
    } finally {
      setAiLoading(false)
    }
  }

  const columns: ColumnsType<Row> = [
    { title: '编码', dataIndex: 'code', width: 120, ellipsis: true },
    { title: '名称', dataIndex: 'name', width: 120 },
    { title: '公式表达式', dataIndex: 'formula_expr', width: 220, ellipsis: true },
    { title: '输入变量', dataIndex: 'input_vars', width: 140, ellipsis: true },
    { title: '输出变量', dataIndex: 'output_var', width: 90 },
    { title: '子系统', dataIndex: 'system_type', width: 90 },
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
      <Title level={4} style={{ marginBottom: 0 }}>计算公式引擎</Title>
      <Text type="secondary">根据输入变量计算派生量（如 NVR 路数、存储容量、线缆长度等）。</Text>
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Select placeholder="子系统" allowClear style={{ width: 120 }} value={systemFilter} onChange={setSystemFilter} options={SYSTEM_TYPES} />
          <Select placeholder="状态" allowClear style={{ width: 100 }} value={enabledFilter} onChange={setEnabledFilter} options={[{ label: '启用', value: '1' }, { label: '停用', value: '0' }]} />
          <Input.Search placeholder="编码/名称/说明" allowClear style={{ width: 180 }} value={keywordSearch} onChange={(e) => setKeywordSearch(e.target.value)} onSearch={() => fetchList()} enterButton="查询" />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>
          <Button icon={<RobotOutlined />} onClick={() => setAiModalOpen(true)}>AI 新增公式</Button>
          <Button onClick={fetchList}>刷新</Button>
        </Space>
        <Table<Row> rowKey="id" size="small" loading={loading} columns={columns} dataSource={list} pagination={{ total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }} />
      </Card>
      <Modal title={editingId ? '编辑公式' : '新增公式'} open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)} width={560} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="编码" rules={[{ required: true }]}><Input placeholder="唯一编码" disabled={!!editingId} /></Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="公式名称" /></Form.Item>
          <Form.Item name="formula_expr" label="公式表达式" rules={[{ required: true }]}><Input.TextArea rows={2} placeholder='如 nvr_channels = ceil(camera_count / 32)' /></Form.Item>
          <Form.Item name="input_vars" label="输入变量（逗号或空格分隔）" rules={[{ required: true }]}><Input placeholder='如 camera_count, store_days' /></Form.Item>
          <Form.Item name="output_var" label="输出变量名" rules={[{ required: true }]}><Input placeholder="如 nvr_channels" /></Form.Item>
          <Form.Item name="system_type" label="子系统"><Select options={SYSTEM_TYPES} placeholder="general/video/..." /></Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="enabled" label="启用" initialValue={true}><Select options={[{ label: '启用', value: true }, { label: '停用', value: false }]} /></Form.Item>
        </Form>
      </Modal>
      <Modal
        title="AI 新增公式"
        open={aiModalOpen}
        onOk={handleAiCreate}
        onCancel={() => { setAiModalOpen(false); setAiText('') }}
        confirmLoading={aiLoading}
        okText="生成并保存"
        width={520}
        destroyOnHidden
      >
        <Input.TextArea
          value={aiText}
          onChange={(e) => setAiText(e.target.value)}
          placeholder={'用自然语言描述要新增的公式，例如：\n根据摄像机数量计算 NVR 所需路数，每 32 路一台向上取整；输入变量是 camera_count，输出 nvr_channels。'}
          rows={6}
          autoSize={{ minRows: 5, maxRows: 12 }}
        />
      </Modal>
    </Space>
  )
}

export default FormulasPage
