/**
 * 功能：规则引擎
 * 以同级 Card 展示各类规则：当前为 Excel 智能解析规则（表头映射）；后续可扩展其他功能规则卡片。
 * Excel 规则仅支持查询、编辑、删除；添加在上传/解析 Excel 时通过「确认加入规则」完成。
 */
import { DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tooltip, Typography } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useState } from 'react'

const { Title, Text } = Typography

/** 与 formTemplates 一致的列 key 与中文标题 */
const COLUMN_KEYS = [
  'sequence_no',
  'goods_name',
  'brand',
  'model',
  'params',
  'unit',
  'quantity',
  'unit_price_excl_tax',
  'unit_price_incl_tax',
  'amount_excl_tax',
  'amount_incl_tax',
  'tax_rate',
  'remark',
] as const

const COLUMN_TITLES: Record<string, string> = {
  sequence_no: '序号',
  goods_name: '货物名称',
  brand: '品牌',
  model: '型号',
  params: '参数',
  unit: '单位',
  quantity: '数量',
  unit_price_excl_tax: '不含税单价',
  unit_price_incl_tax: '单价(含税)',
  amount_excl_tax: '不含税金额',
  amount_incl_tax: '金额(含税)',
  tax_rate: '税率',
  remark: '备注',
}

export type HeaderRuleItem = {
  id: number
  header_normalized: string
  column_key: string
  created_at: string
}

const ExcelParseRulesPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<HeaderRuleItem[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<HeaderRuleItem | null>(null)
  const [form] = Form.useForm()
  const [searchHeader, setSearchHeader] = useState('')
  const [searchColumnKey, setSearchColumnKey] = useState<string | undefined>(undefined)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get<{ list: HeaderRuleItem[] }>('/api/form-templates/header-rules')
      setList(res.data.list || [])
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [msg])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const filteredList = React.useMemo(() => {
    let data = list
    if (searchHeader.trim()) {
      const k = searchHeader.trim().toLowerCase()
      data = data.filter((r) => r.header_normalized.toLowerCase().includes(k))
    }
    if (searchColumnKey) {
      data = data.filter((r) => r.column_key === searchColumnKey)
    }
    return data
  }, [list, searchHeader, searchColumnKey])

  const openEdit = (row: HeaderRuleItem) => {
    setEditingItem(row)
    form.setFieldsValue({ column_key: row.column_key })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    if (!editingItem) return
    try {
      const values = await form.validateFields()
      await axios.put(`/api/form-templates/header-rules/${editingItem.id}`, { columnKey: values.column_key })
      msg.success('更新成功')
      setModalOpen(false)
      setEditingItem(null)
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '更新失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`/api/form-templates/header-rules/${id}`)
      msg.success('已删除')
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const columns: ColumnsType<HeaderRuleItem> = [
    { title: 'ID', dataIndex: 'id', width: '6%', align: 'right' },
    {
      title: '表头（规范化）',
      dataIndex: 'header_normalized',
      width: '38%',
      ellipsis: true,
      render: (v: string) =>
        v ? (
          <Tooltip title={v}>
            <span>{v}</span>
          </Tooltip>
        ) : '—',
    },
    {
      title: '映射列',
      dataIndex: 'column_key',
      width: '16%',
      render: (key: string) => COLUMN_TITLES[key] ?? key,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: '18%',
      render: (v: string) => (v ? v.slice(0, 16).replace('T', ' ') : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: '22%',
      render: (_, row) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm title="确定删除该规则？" onConfirm={() => handleDelete(row.id)} okText="删除" cancelText="取消">
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const columnOptions = COLUMN_KEYS.map((k) => ({ label: `${COLUMN_TITLES[k] ?? k} (${k})`, value: k }))

  return (
    <Space direction="vertical" size={16} style={{ width: '100%', maxWidth: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ minWidth: 0, flex: '1 1 200px' }}>
          <Title level={4} style={{ marginBottom: 4 }}>
            规则引擎
          </Title>
          <Text type="secondary">
            各类功能规则以卡片展示；下方为 Excel 智能解析规则（表头→标准列映射），支持查询、编辑、删除。
          </Text>
        </div>
      </div>

      <Card
        title="Excel 智能解析规则"
        size="small"
        extra={
          <Tooltip title="新规则需在「项目维护(智能格式化)」或「AI配单检查」中解析表头后点击「加入规则」添加">
            <Text type="secondary" style={{ fontSize: 12 }}>仅支持查询/编辑/删除</Text>
          </Tooltip>
        }
        style={{ overflow: 'hidden' }}
      >
        <Space wrap style={{ marginBottom: 16 }} align="center" size="middle">
          <Input.Search
            placeholder="按表头筛选"
            allowClear
            style={{ width: 180 }}
            value={searchHeader}
            onChange={(e) => setSearchHeader(e.target.value)}
            onSearch={fetchList}
            enterButton="查询"
          />
          <Select
            placeholder="按映射列筛选"
            allowClear
            style={{ width: 140 }}
            value={searchColumnKey}
            onChange={setSearchColumnKey}
            options={columnOptions}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchList}>
            刷新
          </Button>
        </Space>
        <div style={{ width: '100%', overflow: 'hidden' }}>
          <Table<HeaderRuleItem>
            rowKey="id"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={filteredList}
            style={{ width: '100%' }}
            tableLayout="fixed"
            pagination={{
              total: filteredList.length,
              showSizeChanger: true,
              showTotal: (t) => `共 ${t} 条`,
              pageSizeOptions: ['10', '20', '50'],
            }}
            locale={{ emptyText: '暂无规则，可在项目维护(智能格式化)或 AI配单检查 中解析表头后加入' }}
          />
        </div>
      </Card>

      <Modal
        title="编辑映射列"
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => { setModalOpen(false); setEditingItem(null) }}
        okText="保存"
        cancelText="取消"
        width={480}
        destroyOnClose
      >
        {editingItem && (
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">表头：</Text> <Text strong>{editingItem.header_normalized}</Text>
          </div>
        )}
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="column_key" label="映射到标准列" rules={[{ required: true, message: '请选择列' }]}>
            <Select options={columnOptions} placeholder="选择标准列" showSearch optionFilterProp="label" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}

export default ExcelParseRulesPage
