/**
 * 功能名称：商品清单
 * 实现原理与逻辑：按项目或全局展示商品列表（货物名、品牌型号、数量、单价、金额等），支持按项目筛选、关键词搜索；可新增/编辑/删除商品，
 * 支持按项目删除。列表按项目分组排序，支持序号、含税/不含税等字段。数据来自 /api/products 系列接口。
 */
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
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
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useReauthModal } from '../hooks/useReauthModal'

/** 按关联项目分组排序：同一 project_name 挨在一起，空项目排最后；组内按 sequence_no、id */
function sortByProjectThenSequence(items: Product[]): Product[] {
  return [...items].sort((a, b) => {
    const pa = a.project_name?.trim() ?? ''
    const pb = b.project_name?.trim() ?? ''
    if (pa !== pb) {
      const emptyLast = (s: string) => (s === '' ? 1 : 0)
      if (emptyLast(pa) !== emptyLast(pb)) return emptyLast(pa) - emptyLast(pb)
      return pa.localeCompare(pb, 'zh-CN')
    }
    const sa = a.sequence_no ?? 0
    const sb = b.sequence_no ?? 0
    if (sa !== sb) return sa - sb
    return a.id - b.id
  })
}

const { Title, Text } = Typography

export type Product = {
  id: number
  sequence_no: number | null
  goods_name: string
  brand: string | null
  model: string | null
  params: string | null
  unit: string | null
  quantity: number | null
  unit_price_excl_tax: number | null
  unit_price_incl_tax: number | null
  amount_excl_tax: number | null
  amount_incl_tax: number | null
  remark: string | null
  project_name: string | null
  category: string | null
  supplier: string | null
  status: string | null
  source_file: string | null
  sku: string | null
  cost_price: number | null
  tax_rate: number | null
  stock_quantity: number | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  extra_json: string | null
}

const statusOptions = [
  { label: '正常', value: '正常' },
  { label: '停用', value: '停用' },
  { label: '待审核', value: '待审核' },
]

const ProductsPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { askReauth, reauthModal } = useReauthModal()
  const [searchParams] = useSearchParams()
  const [list, setList] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingRow, setEditingRow] = useState<Partial<Product> | null>(null)
  const [form] = Form.useForm()
  /** 按项目筛选：空表示全部；可从 URL ?project_name= 初始化 */
  const [projectFilter, setProjectFilter] = useState<string | null>(() => {
    const p = searchParams.get('project_name')
    return p && p.trim() ? p.trim() : null
  })
  /** 全商品模糊查询关键词（匹配名称、品牌、型号、参数、备注、项目、分类、供应商、SKU、来源文件） */
  const [keyword, setKeyword] = useState('')
  const [projectOptions, setProjectOptions] = useState<string[]>([])
  const projectSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 分页：用于前端序号计算 (序号 = (page-1)*pageSize + index + 1) */
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  /** 关联项目列：双击即改，当前正在编辑的行 id */
  const [projectNameEditingId, setProjectNameEditingId] = useState<number | null>(null)
  const [projectNameDraft, setProjectNameDraft] = useState('')
  /** 表格多选，用于批量删除 */
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false)
  const [conditionDeleteModalOpen, setConditionDeleteModalOpen] = useState(false)

  /** 按关联项目分组、组内按序号与 id 排序，用于表格展示；序号列按此顺序显示 1、2、3… */
  const sortedList = useMemo(() => sortByProjectThenSequence(list), [list])

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

  const fetchList = async (p?: number, ps?: number) => {
    setLoading(true)
    try {
      const currentPage = p ?? page
      const currentSize = ps ?? pageSize
      const params = new URLSearchParams()
      if (projectFilter != null && projectFilter !== '') params.set('project_name', projectFilter)
      if (keyword.trim()) params.set('keyword', keyword.trim())
      params.set('page', String(currentPage))
      params.set('pageSize', String(currentSize))
      const res = await axios.get<{ list: Product[]; total: number }>(
        `/api/products?${params.toString()}`,
      )
      setList(res.data.list || [])
      setTotal(res.data.total ?? 0)
      setPage(currentPage)
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProjects()
  }, [])

  useEffect(() => {
    fetchList(1)
  }, [projectFilter])

  const openCreate = () => {
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (row: Product) => {
    setEditingId(row.id)
    setEditingRow({ ...row })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingRow(null)
  }

  const updateEditingField = (field: keyof Product, value: unknown) => {
    setEditingRow((prev) => (prev ? { ...prev, [field]: value } : null))
  }

  const saveEdit = async () => {
    if (!editingId || !editingRow) return
    if (!editingRow.goods_name?.trim()) {
      msg.error('请输入货物名称')
      return
    }
    try {
      await axios.put(`/api/products/${editingId}`, editingRow)
      msg.success('已保存')
      cancelEdit()
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '保存失败')
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      await axios.post('/api/products', values)
      msg.success('创建成功')
      setModalOpen(false)
      fetchList()
    } catch (e: any) {
      if (e?.errorFields) return
      msg.error(e?.response?.data?.message || '保存失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`/api/products/${id}`)
      msg.success('已删除')
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }

  /** 批量删除选中项 */
  const handleBulkDeleteSelected = async () => {
    const ids = selectedRowKeys.map((k) => Number(k)).filter((id) => Number.isInteger(id) && id > 0)
    if (ids.length === 0) {
      msg.warning('请先勾选要删除的项')
      return
    }
    const pwd = await askReauth(`将删除选中的 ${ids.length} 条报价，请输入登录密码确认`)
    if (!pwd) return
    setBatchDeleteLoading(true)
    try {
      const res = await axios.post<{ deleted: number }>('/api/products/bulk-delete', {
        ids,
        reauth_password: pwd,
      })
      msg.success(`已删除 ${res.data.deleted ?? ids.length} 条`)
      setSelectedRowKeys([])
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '批量删除失败')
    } finally {
      setBatchDeleteLoading(false)
    }
  }

  /** 按当前筛选条件删除（多条件） */
  const handleDeleteByCondition = async () => {
    setConditionDeleteModalOpen(false)
    const pwd = await askReauth('将删除当前筛选条件下的全部报价，请输入登录密码确认')
    if (!pwd) return
    setBatchDeleteLoading(true)
    try {
      const params = new URLSearchParams()
      if (projectFilter != null && projectFilter !== '' && projectFilter !== '__all__') params.set('project_name', projectFilter)
      if (keyword.trim()) params.set('keyword', keyword.trim())
      const res = await axios.delete<{ deleted: number }>(`/api/products/by-condition?${params.toString()}`, {
        data: { reauth_password: pwd },
      })
      msg.success(`已删除 ${res.data.deleted ?? 0} 条`)
      setSelectedRowKeys([])
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '按条件删除失败')
    } finally {
      setBatchDeleteLoading(false)
    }
  }

  /** 单元格内容过长时用 Tooltip 显示全文 */
  const cellTooltip = (text: string) => (
    <Tooltip title={text || '(空)'}>
      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text || ' '}</span>
    </Tooltip>
  )
  /** 参数列：Tooltip 内限制最大尺寸，超出用滚动条 */
  const paramsCellTooltip = (text: string) => (
    <Tooltip
      title={<div style={{ maxHeight: 200, maxWidth: 360, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text || '(空)'}</div>}
      overlayInnerStyle={{ maxHeight: 240, maxWidth: 400 }}
    >
      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text || ' '}</span>
    </Tooltip>
  )

  const saveProjectNameInline = async (id: number, value: string) => {
    if (projectNameEditingId !== id) return
    setProjectNameEditingId(null)
    const trimmed = value.trim()
    try {
      await axios.put(`/api/products/${id}`, { project_name: trimmed || null })
      msg.success('已保存')
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '保存失败')
      setProjectNameEditingId(id)
      setProjectNameDraft(trimmed)
    }
  }

  const isEditing = (row: Product) => row.id === editingId && editingRow != null
  const cell = (field: keyof Product, row: Product, render: (v: unknown) => React.ReactNode, input: React.ReactNode) =>
    isEditing(row) ? input : render(row[field as keyof typeof row])

  const columns: ColumnsType<Product> = [
    {
      title: '序号',
      dataIndex: 'sequence_no',
      width: 64,
      align: 'right',
      render: (v, row, index) =>
        cell(
          'sequence_no',
          row,
          () => (page && pageSize ? (page - 1) * pageSize + index + 1 : index + 1),
          <InputNumber
            size="small"
            min={0}
            style={{ width: '100%' }}
            value={editingRow?.sequence_no ?? undefined}
            onChange={(val) => updateEditingField('sequence_no', val)}
          />,
        ),
    },
    {
      title: '货物名称',
      dataIndex: 'goods_name',
      width: 140,
      ellipsis: true,
      render: (v, row) =>
        cell(
          'goods_name',
          row,
          (x) => cellTooltip(String(x ?? '')),
          <Input
            size="small"
            value={editingRow?.goods_name ?? ''}
            onChange={(e) => updateEditingField('goods_name', e.target.value)}
            placeholder="货物名称"
          />,
        ),
    },
    {
      title: '品牌',
      dataIndex: 'brand',
      width: 90,
      ellipsis: true,
      render: (v, row) =>
        cell('brand', row, (x) => cellTooltip(String(x ?? '')), (
          <Input size="small" value={editingRow?.brand ?? ''} onChange={(e) => updateEditingField('brand', e.target.value)} />
        )),
    },
    {
      title: '型号',
      dataIndex: 'model',
      width: 120,
      ellipsis: true,
      render: (v, row) =>
        cell('model', row, (x) => cellTooltip(String(x ?? '')), (
          <Input size="small" value={editingRow?.model ?? ''} onChange={(e) => updateEditingField('model', e.target.value)} />
        )),
    },
    {
      title: '参数',
      dataIndex: 'params',
      width: 120,
      ellipsis: true,
      render: (v, row) =>
        cell(
          'params',
          row,
          (x) => paramsCellTooltip(String(x ?? '')),
          <Input
            size="small"
            value={editingRow?.params ?? ''}
            onChange={(e) => updateEditingField('params', e.target.value)}
            placeholder="参数"
          />,
        ),
    },
    {
      title: '单位',
      dataIndex: 'unit',
      width: 56,
      render: (v, row) =>
        cell('unit', row, (x) => (x != null ? String(x) : ''), (
          <Input size="small" value={editingRow?.unit ?? ''} onChange={(e) => updateEditingField('unit', e.target.value)} />
        )),
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      width: 72,
      align: 'right',
      render: (v, row) =>
        cell(
          'quantity',
          row,
          (x) => (x != null ? Number(x) : ''),
          <InputNumber
            size="small"
            min={0}
            style={{ width: '100%' }}
            value={editingRow?.quantity ?? undefined}
            onChange={(val) => updateEditingField('quantity', val)}
          />,
        ),
    },
    {
      title: '不含税单价',
      dataIndex: 'unit_price_excl_tax',
      width: 96,
      align: 'right',
      render: (v, row) =>
        cell(
          'unit_price_excl_tax',
          row,
          (x) => (x != null ? Number(x) : ''),
          <InputNumber
            size="small"
            min={0}
            precision={2}
            style={{ width: '100%' }}
            value={editingRow?.unit_price_excl_tax ?? undefined}
            onChange={(val) => updateEditingField('unit_price_excl_tax', val)}
          />,
        ),
    },
    {
      title: '单价(含税)',
      dataIndex: 'unit_price_incl_tax',
      width: 96,
      align: 'right',
      render: (v, row) =>
        cell(
          'unit_price_incl_tax',
          row,
          (x) => (x != null ? Number(x) : ''),
          <InputNumber
            size="small"
            min={0}
            precision={2}
            style={{ width: '100%' }}
            value={editingRow?.unit_price_incl_tax ?? undefined}
            onChange={(val) => updateEditingField('unit_price_incl_tax', val)}
          />,
        ),
    },
    {
      title: '不含税金额',
      dataIndex: 'amount_excl_tax',
      width: 96,
      align: 'right',
      render: (v, row) =>
        cell(
          'amount_excl_tax',
          row,
          (x) => (x != null ? Number(x) : ''),
          <InputNumber
            size="small"
            min={0}
            precision={2}
            style={{ width: '100%' }}
            value={editingRow?.amount_excl_tax ?? undefined}
            onChange={(val) => updateEditingField('amount_excl_tax', val)}
          />,
        ),
    },
    {
      title: '金额(含税)',
      dataIndex: 'amount_incl_tax',
      width: 96,
      align: 'right',
      render: (v, row) =>
        cell(
          'amount_incl_tax',
          row,
          (x) => (x != null ? Number(x) : ''),
          <InputNumber
            size="small"
            min={0}
            precision={2}
            style={{ width: '100%' }}
            value={editingRow?.amount_incl_tax ?? undefined}
            onChange={(val) => updateEditingField('amount_incl_tax', val)}
          />,
        ),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      width: 80,
      ellipsis: true,
      render: (v, row) =>
        cell('remark', row, (x) => cellTooltip(String(x ?? '')), (
          <Input size="small" value={editingRow?.remark ?? ''} onChange={(e) => updateEditingField('remark', e.target.value)} />
        )),
    },
    {
      title: '关联项目',
      dataIndex: 'project_name',
      width: 120,
      ellipsis: true,
      render: (v, row) => {
        if (projectNameEditingId === row.id) {
          return (
            <Input
              size="small"
              value={projectNameDraft}
              onChange={(e) => setProjectNameDraft(e.target.value)}
              onBlur={() => saveProjectNameInline(row.id, projectNameDraft)}
              onPressEnter={() => saveProjectNameInline(row.id, projectNameDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setProjectNameEditingId(null)
                  setProjectNameDraft('')
                }
              }}
              placeholder="项目名称"
              autoFocus
            />
          )
        }
        if (isEditing(row)) {
          return (
            <Input
              size="small"
              value={editingRow?.project_name ?? ''}
              onChange={(e) => updateEditingField('project_name', e.target.value)}
            />
          )
        }
        const text = String(row.project_name ?? '')
        return (
          <Tooltip title={text || '(空)'}>
            <span
              style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
              title="双击修改"
              onDoubleClick={() => {
                setProjectNameEditingId(row.id)
                setProjectNameDraft(text)
              }}
            >
              {text || ' '}
            </span>
          </Tooltip>
        )
      },
    },
    {
      title: 'Sheet',
      dataIndex: 'sheet_name',
      width: 100,
      ellipsis: true,
      render: (v: string | null) => v ? <Tag>{v}</Tag> : null,
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 80,
      ellipsis: true,
      render: (v, row) =>
        cell('category', row, (x) => cellTooltip(String(x ?? '')), (
          <Input size="small" value={editingRow?.category ?? ''} onChange={(e) => updateEditingField('category', e.target.value)} />
        )),
    },
    {
      title: '供应商',
      dataIndex: 'supplier',
      width: 90,
      ellipsis: true,
      render: (v, row) =>
        cell('supplier', row, (x) => cellTooltip(String(x ?? '')), (
          <Input size="small" value={editingRow?.supplier ?? ''} onChange={(e) => updateEditingField('supplier', e.target.value)} />
        )),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 72,
      render: (v, row) =>
        cell(
          'status',
          row,
          (x) => (x != null ? String(x) : ''),
          <Select
            size="small"
            style={{ width: '100%' }}
            allowClear
            options={statusOptions}
            value={editingRow?.status ?? undefined}
            onChange={(val) => updateEditingField('status', val)}
          />,
        ),
    },
    {
      title: '来源文件',
      dataIndex: 'source_file',
      width: 100,
      ellipsis: true,
      render: (v, row) =>
        cell('source_file', row, (x) => cellTooltip(String(x ?? '')), (
          <Input size="small" value={editingRow?.source_file ?? ''} onChange={(e) => updateEditingField('source_file', e.target.value)} />
        )),
    },
    {
      title: '条形码/SKU',
      dataIndex: 'sku',
      width: 100,
      ellipsis: true,
      render: (v, row) =>
        cell('sku', row, (x) => cellTooltip(String(x ?? '')), (
          <Input size="small" value={editingRow?.sku ?? ''} onChange={(e) => updateEditingField('sku', e.target.value)} />
        )),
    },
    {
      title: '成本价',
      dataIndex: 'cost_price',
      width: 80,
      align: 'right',
      render: (v, row) =>
        cell(
          'cost_price',
          row,
          (x) => (x != null ? Number(x) : ''),
          <InputNumber
            size="small"
            min={0}
            precision={2}
            style={{ width: '100%' }}
            value={editingRow?.cost_price ?? undefined}
            onChange={(val) => updateEditingField('cost_price', val)}
          />,
        ),
    },
    {
      title: '税率',
      dataIndex: 'tax_rate',
      width: 72,
      align: 'right',
      render: (v, row) =>
        cell(
          'tax_rate',
          row,
          (x) => (x != null ? Number(x) : ''),
          <InputNumber
            size="small"
            min={0}
            max={1}
            step={0.01}
            style={{ width: '100%' }}
            value={editingRow?.tax_rate ?? undefined}
            onChange={(val) => updateEditingField('tax_rate', val)}
          />,
        ),
    },
    {
      title: '库存数量',
      dataIndex: 'stock_quantity',
      width: 84,
      align: 'right',
      render: (v, row) =>
        cell(
          'stock_quantity',
          row,
          (x) => (x != null ? Number(x) : ''),
          <InputNumber
            size="small"
            min={0}
            style={{ width: '100%' }}
            value={editingRow?.stock_quantity ?? undefined}
            onChange={(val) => updateEditingField('stock_quantity', val)}
          />,
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 92,
      render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : ''),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, row) => (
        <Space size="small" wrap={false}>
          {isEditing(row) ? (
            <>
              <Button type="link" size="small" onClick={saveEdit}>
                保存
              </Button>
              <Button type="link" size="small" onClick={cancelEdit}>
                取消
              </Button>
            </>
          ) : (
            <>
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
                编辑
              </Button>
              <Popconfirm title="确定删除该报价项？" onConfirm={() => handleDelete(row.id)} okText="删除" cancelText="取消">
                <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {reauthModal}
      <style>{`.products-row-editing td { background: #e6f4ff !important; }`}</style>
      
      <Text type="secondary">
        含报价单字段（序号、货物名称、品牌、型号、参数、单位、数量、不含税/含税单价与金额、备注）及关联项目、分类、供应商、状态、来源文件、SKU、成本价、税率、库存、创建/更新人与时间，便于统计、查询与日志。
      </Text>
      <Card>
        <Space wrap style={{ marginBottom: 16 }} align="center">
          <Select
            placeholder="按项目筛选（可输入搜索）"
            allowClear
            showSearch
            optionFilterProp="label"
            filterOption={false}
            style={{ width: 220 }}
            value={projectFilter === null ? '__all__' : projectFilter}
            onChange={(v) => setProjectFilter(v == null || v === '' || v === '__all__' ? null : v)}
            onSearch={(v) => onProjectSearch(v || '')}
            onOpenChange={(open) => open && fetchProjects()}
            options={[
              { label: '全部项目', value: '__all__' },
              ...projectOptions.map((p) => ({ label: p, value: p })),
              ...(projectFilter && projectFilter !== '__all__' && !projectOptions.includes(projectFilter)
                ? [{ label: projectFilter, value: projectFilter }]
                : []),
            ]}
          />
          <Input.Search
            placeholder="模糊查询（名称、品牌、型号、项目、分类等）"
            allowClear
            style={{ width: 320 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={() => fetchList(1)}
            enterButton="查询"
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增报价项
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={batchDeleteLoading}
            disabled={selectedRowKeys.length === 0}
            onClick={() => void handleBulkDeleteSelected()}
          >
            批量删除选中（{selectedRowKeys.length}）
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => setConditionDeleteModalOpen(true)}
            loading={batchDeleteLoading}
          >
            按条件删除
          </Button>
          <Button onClick={fetchList}>刷新</Button>
        </Space>
        <Modal
          title="按条件批量删除"
          open={conditionDeleteModalOpen}
          onCancel={() => setConditionDeleteModalOpen(false)}
          onOk={() => handleDeleteByCondition()}
          okText="确定删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
        >
          <Typography.Paragraph type="secondary">
            将删除符合当前筛选条件的全部记录（项目：{projectFilter == null || projectFilter === '__all__' ? '全部' : projectFilter}，关键词：{keyword.trim() || '无'}），共约 {total} 条。此操作不可恢复，请确认。
          </Typography.Paragraph>
        </Modal>
        <Table<Product>
          rowKey="id"
          size="small"
          loading={loading}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as React.Key[]),
          }}
          columns={columns}
          dataSource={sortedList}
          rowClassName={(row) => (row.id === editingId ? 'products-row-editing' : '')}
          scroll={{ x: 2200 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              const newSize = typeof ps === 'number' ? ps : pageSize
              if (newSize !== pageSize) setPageSize(newSize)
              fetchList(p, newSize)
            },
          }}
        />
      </Card>

      <Modal
        title="新增报价项"
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="sequence_no" label="序号">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="序号" />
          </Form.Item>
          <Form.Item
            name="goods_name"
            label="货物名称"
            rules={[{ required: true, message: '请输入货物名称' }]}
          >
            <Input placeholder="货物名称" />
          </Form.Item>
          <Form.Item name="brand" label="品牌">
            <Input placeholder="品牌" />
          </Form.Item>
          <Form.Item name="model" label="型号">
            <Input placeholder="型号" />
          </Form.Item>
          <Form.Item name="params" label="参数">
            <Input.TextArea rows={3} placeholder="参数/规格（多行）" />
          </Form.Item>
          <Form.Item name="unit" label="单位">
            <Input placeholder="单位（台/个/项等）" />
          </Form.Item>
          <Form.Item name="quantity" label="数量">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="数量" />
          </Form.Item>
          <Form.Item name="unit_price_excl_tax" label="不含税单价">
            <InputNumber
              min={0}
              precision={2}
              style={{ width: '100%' }}
              placeholder="不含税单价"
            />
          </Form.Item>
          <Form.Item name="unit_price_incl_tax" label="单价(含税)">
            <InputNumber
              min={0}
              precision={2}
              style={{ width: '100%' }}
              placeholder="单价(含税)"
            />
          </Form.Item>
          <Form.Item name="amount_excl_tax" label="不含税金额">
            <InputNumber
              min={0}
              precision={2}
              style={{ width: '100%' }}
              placeholder="不含税金额"
            />
          </Form.Item>
          <Form.Item name="amount_incl_tax" label="金额(含税)">
            <InputNumber
              min={0}
              precision={2}
              style={{ width: '100%' }}
              placeholder="金额(含税)"
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="备注" />
          </Form.Item>
          <Form.Item name="project_name" label="关联项目">
            <Input placeholder="关联项目（默认可为文件名）" />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Input placeholder="分类" />
          </Form.Item>
          <Form.Item name="supplier" label="供应商">
            <Input placeholder="供应商" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              placeholder="状态"
              allowClear
              options={statusOptions}
            />
          </Form.Item>
          <Form.Item name="source_file" label="来源文件">
            <Input placeholder="来源文件" />
          </Form.Item>
          <Form.Item name="sku" label="条形码/SKU">
            <Input placeholder="条形码或SKU" />
          </Form.Item>
          <Form.Item name="cost_price" label="成本价">
            <InputNumber
              min={0}
              precision={2}
              style={{ width: '100%' }}
              placeholder="成本价"
            />
          </Form.Item>
          <Form.Item name="tax_rate" label="税率">
            <InputNumber
              min={0}
              max={1}
              step={0.01}
              style={{ width: '100%' }}
              placeholder="税率（如 0.13）"
            />
          </Form.Item>
          <Form.Item name="stock_quantity" label="库存数量">
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              placeholder="库存数量"
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}

export default ProductsPage
