/**
 * 功能名称：成本清单
 * 实现原理与逻辑：按项目或全局维护成本明细（货物、品牌型号、数量、成本价、税额、含税价等）；支持筛选、分页、新增/编辑/删除成本项，
 * 支持按项目删除。与商品清单结构类似但侧重成本字段，用于成本核算与项目利润分析。数据来自 /api/cost-list 等接口。
 */
import { CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  App,
  Button,
  Card,
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

const { Title, Text } = Typography

const DEFAULT_TAX_RATE = 13

export type CostListItem = {
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
  tax_rate: number | null
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
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

const statusOptions = [
  { label: '正常', value: '正常' },
  { label: '停用', value: '停用' },
  { label: '待审核', value: '待审核' },
]

const NEW_ROW_ID = -1

const emptyDraft: Partial<CostListItem> = {
  sequence_no: null,
  goods_name: '',
  brand: null,
  model: null,
  params: null,
  unit: null,
  quantity: null,
  cost_price: null,
  cost_amount: null,
  tax_rate: DEFAULT_TAX_RATE,
  unit_price_excl_tax: null,
  unit_price_incl_tax: null,
  amount_excl_tax: null,
  amount_incl_tax: null,
  remark: null,
  project_name: null,
  category: null,
  supplier: null,
  status: null,
  source_file: null,
  sku: null,
}

const CostListPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { askReauth, reauthModal } = useReauthModal()
  const [searchParams] = useSearchParams()
  const [list, setList] = useState<CostListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  /** 当前编辑行 id：null=无，NEW_ROW_ID=新增行，>0=编辑该条 */
  const [editingId, setEditingId] = useState<number | null>(null)
  /** 当前编辑/新增行的表单数据（含新增时的空行） */
  const [draft, setDraft] = useState<Partial<CostListItem>>(emptyDraft)
  const [saveLoading, setSaveLoading] = useState(false)
  const [projectFilter, setProjectFilter] = useState<string | null>(() => {
    const p = searchParams.get('project_name')
    return p && p.trim() ? p.trim() : null
  })
  const [keyword, setKeyword] = useState('')
  const [projectOptions, setProjectOptions] = useState<string[]>([])
  const projectSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 关联项目列：双击即改 */
  const [projectNameEditingId, setProjectNameEditingId] = useState<number | null>(null)
  const [projectNameDraft, setProjectNameDraft] = useState('')
  /** 表格多选，用于批量删除 */
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false)
  const [conditionDeleteModalOpen, setConditionDeleteModalOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

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
      const res = await axios.get<{ list: CostListItem[]; total: number }>(
        `/api/cost-list?${params.toString()}`,
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

  /** 新增行插在 dataSource 首位；Table 分页在非第 1 页时不会显示首条，故必须回到第 1 页并拉取当页数据 */
  const openCreate = () => {
    setEditingId(NEW_ROW_ID)
    setDraft({ ...emptyDraft })
    void fetchList(1)
  }

  const openEdit = useCallback((row: CostListItem) => {
    const taxRate = row.tax_rate ?? DEFAULT_TAX_RATE
    const r = 1 + taxRate / 100
    const amountIncl = row.amount_incl_tax ?? row.cost_amount ?? null
    const amountExcl = row.amount_excl_tax ?? (amountIncl != null ? Math.round((amountIncl / r) * 100) / 100 : null)
    const unitIncl = row.unit_price_incl_tax ?? row.cost_price ?? null
    const unitExcl = row.unit_price_excl_tax ?? (unitIncl != null ? Math.round((unitIncl / r) * 100) / 100 : null)
    setEditingId(row.id)
    setDraft({
      sequence_no: row.sequence_no,
      goods_name: row.goods_name,
      brand: row.brand,
      model: row.model,
      params: row.params,
      unit: row.unit,
      quantity: row.quantity,
      cost_price: row.cost_price,
      cost_amount: row.cost_amount,
      tax_rate: taxRate,
      unit_price_excl_tax: unitExcl,
      unit_price_incl_tax: unitIncl,
      amount_excl_tax: amountExcl,
      amount_incl_tax: amountIncl,
      remark: row.remark,
      project_name: row.project_name,
      category: row.category,
      supplier: row.supplier,
      status: row.status,
      source_file: row.source_file,
      sku: row.sku,
    })
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setDraft(emptyDraft)
  }, [])

  const updateDraft = useCallback((field: keyof CostListItem, value: unknown) => {
    setDraft((prev) => ({ ...prev, [field]: value }))
  }, [])

  /** 更新单价/金额时按税率互算另一侧（税率默认 13%） */
  const updateDraftWithTaxDerive = useCallback((field: 'unit_price_excl_tax' | 'unit_price_incl_tax' | 'amount_excl_tax' | 'amount_incl_tax', value: number | null) => {
    setDraft((prev) => {
      const rate = (prev.tax_rate ?? DEFAULT_TAX_RATE) / 100
      const r = 1 + rate
      const next = { ...prev }
      if (field === 'unit_price_excl_tax') {
        next.unit_price_excl_tax = value
        next.unit_price_incl_tax = value != null ? Math.round(value * r * 100) / 100 : null
      } else if (field === 'unit_price_incl_tax') {
        next.unit_price_incl_tax = value
        next.unit_price_excl_tax = value != null ? Math.round((value / r) * 100) / 100 : null
      } else if (field === 'amount_excl_tax') {
        next.amount_excl_tax = value
        next.amount_incl_tax = value != null ? Math.round(value * r * 100) / 100 : null
      } else {
        next.amount_incl_tax = value
        next.amount_excl_tax = value != null ? Math.round((value / r) * 100) / 100 : null
      }
      return next
    })
  }, [])

  const handleSave = useCallback(async () => {
    const name = (draft.goods_name ?? '').toString().trim()
    if (!name) {
      msg.error('请输入货物名称')
      return
    }
    const taxRate = draft.tax_rate ?? DEFAULT_TAX_RATE
    setSaveLoading(true)
    try {
      const payload = {
        sequence_no: draft.sequence_no,
        goods_name: name,
        brand: draft.brand ?? null,
        model: draft.model ?? null,
        params: draft.params ?? null,
        unit: draft.unit ?? null,
        quantity: draft.quantity,
        cost_price: draft.cost_price,
        cost_amount: draft.cost_amount,
        tax_rate: taxRate,
        unit_price_excl_tax: draft.unit_price_excl_tax,
        unit_price_incl_tax: draft.unit_price_incl_tax,
        amount_excl_tax: draft.amount_excl_tax,
        amount_incl_tax: draft.amount_incl_tax,
        remark: draft.remark ?? null,
        project_name: draft.project_name ?? null,
        category: draft.category ?? null,
        supplier: draft.supplier ?? null,
        status: draft.status ?? null,
        source_file: draft.source_file ?? null,
        sku: draft.sku ?? null,
      }
      if (editingId === NEW_ROW_ID) {
        await axios.post('/api/cost-list', payload)
        msg.success('创建成功')
      } else {
        await axios.put(`/api/cost-list/${editingId}`, payload)
        msg.success('更新成功')
      }
      setEditingId(null)
      setDraft(emptyDraft)
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '保存失败')
    } finally {
      setSaveLoading(false)
    }
  }, [draft, editingId, msg])

  const handleDelete = useCallback(async (id: number) => {
    try {
      await axios.delete(`/api/cost-list/${id}`)
      msg.success('已删除')
      if (editingId === id) {
        setEditingId(null)
        setDraft(emptyDraft)
      }
      if (projectNameEditingId === id) {
        setProjectNameEditingId(null)
        setProjectNameDraft('')
      }
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }, [editingId, projectNameEditingId, msg])

  /** 批量删除选中项 */
  const handleBulkDeleteSelected = useCallback(async () => {
    const ids = selectedRowKeys.map((k) => Number(k)).filter((id) => Number.isInteger(id) && id > 0)
    if (ids.length === 0) {
      msg.warning('请先勾选要删除的项')
      return
    }
    const pwd = await askReauth(`将删除选中的 ${ids.length} 条成本项，请输入登录密码确认`)
    if (!pwd) return
    setBatchDeleteLoading(true)
    try {
      const res = await axios.post<{ deleted: number }>('/api/cost-list/bulk-delete', {
        ids,
        reauth_password: pwd,
      })
      msg.success(`已删除 ${res.data.deleted ?? ids.length} 条`)
      setSelectedRowKeys([])
      if (editingId != null && ids.includes(editingId)) {
        setEditingId(null)
        setDraft(emptyDraft)
      }
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '批量删除失败')
    } finally {
      setBatchDeleteLoading(false)
    }
  }, [selectedRowKeys, editingId, msg, askReauth])

  /** 按当前筛选条件删除（多条件） */
  const handleDeleteByCondition = useCallback(async () => {
    setConditionDeleteModalOpen(false)
    const pwd = await askReauth('将删除当前筛选条件下的全部成本项，请输入登录密码确认')
    if (!pwd) return
    setBatchDeleteLoading(true)
    try {
      const params = new URLSearchParams()
      if (projectFilter != null && projectFilter !== '' && projectFilter !== '__all__') params.set('project_name', projectFilter)
      if (keyword.trim()) params.set('keyword', keyword.trim())
      const res = await axios.delete<{ deleted: number }>(`/api/cost-list/by-condition?${params.toString()}`, {
        data: { reauth_password: pwd },
      })
      msg.success(`已删除 ${res.data.deleted ?? 0} 条`)
      setSelectedRowKeys([])
      if (editingId != null && list.some((r) => r.id === editingId)) {
        setEditingId(null)
        setDraft(emptyDraft)
      }
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '按条件删除失败')
    } finally {
      setBatchDeleteLoading(false)
    }
  }, [projectFilter, keyword, editingId, list, msg, askReauth])

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

  const saveProjectNameInline = useCallback(
    async (id: number, value: string) => {
      if (projectNameEditingId !== id) return
      setProjectNameEditingId(null)
      const trimmed = value.trim()
      try {
        await axios.put(`/api/cost-list/${id}`, { project_name: trimmed || null })
        msg.success('已保存')
        fetchList()
      } catch (e: any) {
        msg.error(e?.response?.data?.message || '保存失败')
        setProjectNameEditingId(id)
        setProjectNameDraft(trimmed)
      }
    },
    [projectNameEditingId, msg],
  )

  const isEditing = (row: CostListItem) => row.id === editingId
  /** 前端排序：按关联项目分组，同一项目挨在一起；组内按 id 升序。序号列按此顺序显示 1、2、3… */
  const sortedList = useMemo(() => {
    return [...list].sort((a, b) => {
      const pa = (a.project_name ?? '').trim()
      const pb = (b.project_name ?? '').trim()
      if (pa !== pb) return pa.localeCompare(pb, 'zh-CN')
      return (a.id ?? 0) - (b.id ?? 0)
    })
  }, [list])
  const dataSource: CostListItem[] =
    editingId === NEW_ROW_ID
      ? [
          {
            id: NEW_ROW_ID,
            sequence_no: draft.sequence_no ?? null,
            goods_name: (draft.goods_name ?? '') as string,
            brand: draft.brand ?? null,
            model: draft.model ?? null,
            params: draft.params ?? null,
            unit: draft.unit ?? null,
            quantity: draft.quantity ?? null,
            cost_price: draft.cost_price ?? null,
            cost_amount: draft.cost_amount ?? null,
            tax_rate: draft.tax_rate ?? null,
            unit_price_excl_tax: draft.unit_price_excl_tax ?? null,
            unit_price_incl_tax: draft.unit_price_incl_tax ?? null,
            amount_excl_tax: draft.amount_excl_tax ?? null,
            amount_incl_tax: draft.amount_incl_tax ?? null,
            remark: draft.remark ?? null,
            project_name: draft.project_name ?? null,
            category: draft.category ?? null,
            supplier: draft.supplier ?? null,
            status: draft.status ?? null,
            source_file: draft.source_file ?? null,
            sku: draft.sku ?? null,
            created_at: '',
            updated_at: '',
            created_by: null,
            updated_by: null,
          },
          ...sortedList,
        ]
      : sortedList

  const columns: ColumnsType<CostListItem> = [
    {
      title: '序号',
      key: 'displayIndex',
      width: 72,
      align: 'right',
      render: (_: unknown, row: CostListItem) =>
        row.id === NEW_ROW_ID ? '—' : sortedList.indexOf(row) + 1,
    },
    {
      title: '货物名称',
      dataIndex: 'goods_name',
      width: 140,
      ellipsis: true,
      render: (v: string, row) =>
        isEditing(row) ? (
          <Input
            size="small"
            placeholder="货物名称"
            value={(draft.goods_name ?? '') as string}
            onChange={(e) => updateDraft('goods_name', e.target.value)}
          />
        ) : (
          cellTooltip(v ?? '')
        ),
    },
    {
      title: '品牌',
      dataIndex: 'brand',
      width: 90,
      ellipsis: true,
      render: (v: string | null, row) =>
        isEditing(row) ? (
          <Input
            size="small"
            placeholder="品牌"
            value={(draft.brand ?? '') as string}
            onChange={(e) => updateDraft('brand', e.target.value || null)}
          />
        ) : (
          cellTooltip(v ?? '')
        ),
    },
    {
      title: '型号',
      dataIndex: 'model',
      width: 120,
      ellipsis: true,
      render: (v: string | null, row) =>
        isEditing(row) ? (
          <Input
            size="small"
            placeholder="型号"
            value={(draft.model ?? '') as string}
            onChange={(e) => updateDraft('model', e.target.value || null)}
          />
        ) : (
          cellTooltip(v ?? '')
        ),
    },
    {
      title: '参数',
      dataIndex: 'params',
      width: 120,
      ellipsis: true,
      render: (v: string | null, row) =>
        isEditing(row) ? (
          <Input
            size="small"
            placeholder="参数"
            value={(draft.params ?? '') as string}
            onChange={(e) => updateDraft('params', e.target.value || null)}
          />
        ) : (
          paramsCellTooltip(v ?? '')
        ),
    },
    {
      title: '单位',
      dataIndex: 'unit',
      width: 56,
      render: (v: string | null, row) =>
        isEditing(row) ? (
          <Input
            size="small"
            placeholder="单位"
            value={(draft.unit ?? '') as string}
            onChange={(e) => updateDraft('unit', e.target.value || null)}
          />
        ) : (
          (v ?? '')
        ),
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      width: 72,
      align: 'right',
      render: (v: number | null, row) =>
        isEditing(row) ? (
          <InputNumber
            min={0}
            size="small"
            style={{ width: '100%' }}
            value={draft.quantity ?? undefined}
            onChange={(val) => updateDraft('quantity', val ?? null)}
          />
        ) : (
          (v != null ? Number(v) : '')
        ),
    },
    {
      title: '税率(%)',
      dataIndex: 'tax_rate',
      width: 80,
      align: 'right',
      render: (_v: number | null, row) => {
        const display =
          row.tax_rate != null
            ? row.tax_rate
            : row.cost_amount != null || row.cost_price != null
              ? DEFAULT_TAX_RATE
              : null
        return isEditing(row) ? (
          <InputNumber
            min={0}
            max={100}
            precision={2}
            size="small"
            style={{ width: '100%' }}
            value={draft.tax_rate ?? DEFAULT_TAX_RATE}
            onChange={(val) => updateDraft('tax_rate', val ?? DEFAULT_TAX_RATE)}
            placeholder="必填，默认13"
          />
        ) : (
          (display != null ? Number(display) : '')
        )
      },
    },
    {
      title: '不含税单价',
      dataIndex: 'unit_price_excl_tax',
      width: 96,
      align: 'right',
      render: (_v: number | null, row) => {
        const taxRate = row.tax_rate ?? DEFAULT_TAX_RATE
        const r = 1 + taxRate / 100
        const display = row.unit_price_excl_tax ?? (row.unit_price_incl_tax != null ? Math.round((row.unit_price_incl_tax / r) * 100) / 100 : null) ?? (row.cost_price != null ? Math.round((row.cost_price / r) * 100) / 100 : null)
        return isEditing(row) ? (
          <InputNumber
            min={0}
            precision={2}
            size="small"
            style={{ width: '100%' }}
            value={draft.unit_price_excl_tax ?? undefined}
            onChange={(val) => updateDraftWithTaxDerive('unit_price_excl_tax', val ?? null)}
          />
        ) : (
          (display != null ? Number(display) : '')
        )
      },
    },
    {
      title: '含税单价',
      dataIndex: 'unit_price_incl_tax',
      width: 96,
      align: 'right',
      render: (_v: number | null, row) => {
        const taxRate = row.tax_rate ?? DEFAULT_TAX_RATE
        const r = 1 + taxRate / 100
        const display = row.unit_price_incl_tax ?? row.cost_price ?? (row.unit_price_excl_tax != null ? Math.round(row.unit_price_excl_tax * r * 100) / 100 : null)
        return isEditing(row) ? (
          <InputNumber
            min={0}
            precision={2}
            size="small"
            style={{ width: '100%' }}
            value={draft.unit_price_incl_tax ?? undefined}
            onChange={(val) => updateDraftWithTaxDerive('unit_price_incl_tax', val ?? null)}
          />
        ) : (
          (display != null ? Number(display) : '')
        )
      },
    },
    {
      title: '不含税金额',
      dataIndex: 'amount_excl_tax',
      width: 96,
      align: 'right',
      render: (_v: number | null, row) => {
        const taxRate = row.tax_rate ?? DEFAULT_TAX_RATE
        const r = 1 + taxRate / 100
        const incl = row.amount_incl_tax ?? row.cost_amount
        const display = row.amount_excl_tax ?? (incl != null ? Math.round((incl / r) * 100) / 100 : null)
        return isEditing(row) ? (
          <InputNumber
            min={0}
            precision={2}
            size="small"
            style={{ width: '100%' }}
            value={draft.amount_excl_tax ?? undefined}
            onChange={(val) => updateDraftWithTaxDerive('amount_excl_tax', val ?? null)}
          />
        ) : (
          (display != null ? Number(display) : '')
        )
      },
    },
    {
      title: '含税金额',
      dataIndex: 'amount_incl_tax',
      width: 96,
      align: 'right',
      render: (_v: number | null, row) => {
        const taxRate = row.tax_rate ?? DEFAULT_TAX_RATE
        const r = 1 + taxRate / 100
        const display = row.amount_incl_tax ?? row.cost_amount ?? (row.amount_excl_tax != null ? Math.round(row.amount_excl_tax * r * 100) / 100 : null)
        return isEditing(row) ? (
          <InputNumber
            min={0}
            precision={2}
            size="small"
            style={{ width: '100%' }}
            value={draft.amount_incl_tax ?? undefined}
            onChange={(val) => updateDraftWithTaxDerive('amount_incl_tax', val ?? null)}
          />
        ) : (
          (display != null ? Number(display) : '')
        )
      },
    },
    {
      title: '备注',
      dataIndex: 'remark',
      width: 80,
      ellipsis: true,
      render: (v: string | null, row) =>
        isEditing(row) ? (
          <Input
            size="small"
            placeholder="备注"
            value={(draft.remark ?? '') as string}
            onChange={(e) => updateDraft('remark', e.target.value || null)}
          />
        ) : (
          cellTooltip(v ?? '')
        ),
    },
    {
      title: '关联项目',
      dataIndex: 'project_name',
      width: 120,
      ellipsis: true,
      render: (v: string | null, row) => {
        if (row.id !== NEW_ROW_ID && projectNameEditingId === row.id) {
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
              placeholder="关联项目"
              value={(draft.project_name ?? '') as string}
              onChange={(e) => updateDraft('project_name', e.target.value || null)}
            />
          )
        }
        const text = v ?? ''
        return (
          <Tooltip title={text || '(空)'}>
            <span
              style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
              title="双击修改"
              onDoubleClick={() => {
                if (row.id !== NEW_ROW_ID) {
                  setProjectNameEditingId(row.id)
                  setProjectNameDraft(text)
                }
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
      render: (v: string | null, row) =>
        isEditing(row) ? (
          <Input
            size="small"
            placeholder="分类"
            value={(draft.category ?? '') as string}
            onChange={(e) => updateDraft('category', e.target.value || null)}
          />
        ) : (
          cellTooltip(v ?? '')
        ),
    },
    {
      title: '供应商',
      dataIndex: 'supplier',
      width: 90,
      ellipsis: true,
      render: (v: string | null, row) =>
        isEditing(row) ? (
          <Input
            size="small"
            placeholder="供应商"
            value={(draft.supplier ?? '') as string}
            onChange={(e) => updateDraft('supplier', e.target.value || null)}
          />
        ) : (
          cellTooltip(v ?? '')
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 88,
      render: (v: string | null, row) =>
        isEditing(row) ? (
          <Select
            size="small"
            placeholder="状态"
            allowClear
            style={{ width: '100%' }}
            value={draft.status ?? undefined}
            onChange={(val) => updateDraft('status', val ?? null)}
            options={statusOptions}
          />
        ) : (
          (v ?? '')
        ),
    },
    {
      title: '来源文件',
      dataIndex: 'source_file',
      width: 100,
      ellipsis: true,
      render: (v: string | null, row) =>
        isEditing(row) ? (
          <Input
            size="small"
            placeholder="来源文件"
            value={(draft.source_file ?? '') as string}
            onChange={(e) => updateDraft('source_file', e.target.value || null)}
          />
        ) : (
          cellTooltip(v ?? '')
        ),
    },
    {
      title: '条形码/SKU',
      dataIndex: 'sku',
      width: 100,
      ellipsis: true,
      render: (v: string | null, row) =>
        isEditing(row) ? (
          <Input
            size="small"
            placeholder="SKU"
            value={(draft.sku ?? '') as string}
            onChange={(e) => updateDraft('sku', e.target.value || null)}
          />
        ) : (
          cellTooltip(v ?? '')
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
      width: 140,
      fixed: 'right' as const,
      render: (_: unknown, row: CostListItem) => {
        if (isEditing(row)) {
          return (
            <Space size="small" wrap={false}>
              <Button
                type="link"
                size="small"
                icon={<CheckOutlined />}
                loading={saveLoading}
                onClick={handleSave}
              >
                保存
              </Button>
              <Button type="link" size="small" icon={<CloseOutlined />} onClick={cancelEdit}>
                取消
              </Button>
            </Space>
          )
        }
        return (
          <Space size="small" wrap={false}>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
              编辑
            </Button>
            <Popconfirm
              title="确定删除该成本项？"
              onConfirm={() => handleDelete(row.id)}
              okText="删除"
              cancelText="取消"
            >
              <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {reauthModal}
      <Title level={4} style={{ marginBottom: 0 }}>
        成本清单
      </Title>
      <Text type="secondary">
        维护项目成本明细：序号、货物名称、品牌、型号、参数、单位、数量、成本单价、成本金额、备注、关联项目、分类、供应商等。新增与编辑均在表格内完成；点击「新增成本项」后会在表格顶部出现一行可编辑记录（无单独弹窗）。
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
              ...(projectFilter && projectFilter !== '__all__' && !projectOptions.includes(projectFilter ?? '')
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
          {editingId === null && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增成本项
            </Button>
          )}
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
          <Button onClick={() => void fetchList()}>刷新</Button>
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
            将删除符合当前筛选条件的全部记录（项目：{projectFilter == null || projectFilter === '__all__' ? '全部' : projectFilter}，关键词：{keyword.trim() || '无'}），共约 {list.length} 条。此操作不可恢复，请确认。
          </Typography.Paragraph>
        </Modal>
        <Table<CostListItem>
          rowKey="id"
          size="small"
          loading={loading}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as React.Key[]),
            getCheckboxProps: (row) => ({ disabled: row.id === NEW_ROW_ID }),
          }}
          columns={columns}
          dataSource={dataSource}
          scroll={{ x: 1700 }}
          pagination={{
            current: page,
            pageSize,
            total: editingId === NEW_ROW_ID ? total + 1 : total,
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
    </Space>
  )
}

export default CostListPage
