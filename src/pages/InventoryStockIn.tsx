/**
 * 功能名称：库存入库
 * 实现原理与逻辑：支持手动添加入库行与自然语言解析入库（调用后端解析接口得到 SKU/货物名/数量等）；
 * 校验必填项（SKU 或条码、品牌、型号、单位、数量等；关联项目选填），处理同仓同 SKU 冲突后提交入库单，并刷新入库记录列表。
 */
import { DeleteOutlined, EyeOutlined, InboxOutlined, PlusOutlined, RobotOutlined, SearchOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  App,
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const { Title, Text } = Typography

type StockInRecord = {
  id: number
  ref_no: string | null
  sku: string | null
  goods_name: string
  brand: string | null
  model: string | null
  unit: string | null
  quantity: number
  warehouse: string | null
  project_name: string | null
  remark: string | null
  source_type: string
  created_at: string
  created_by: string | null
}

/** 按单汇总（列表每单一行） */
type StockInOrderSummary = {
  ref_no: string
  project_name: string | null
  source_type: string
  created_at: string
  created_by: string | null
  item_count: number
}

type ParsedItem = {
  goods_name: string
  quantity: number
  unit?: string | null
  warehouse?: string | null
  project_name?: string | null
  remark?: string | null
  sku?: string | null
  条码?: string | null
  brand?: string | null
  model?: string | null
}

function getSkuFromItem(item: ParsedItem): string | null {
  const s = item.sku != null ? String(item.sku).trim() || null : null
  if (s) return s
  const b = item.条码 != null ? String(item.条码).trim() || null : null
  return b
}

function getMissingRequired(item: ParsedItem, index: number): { index: number; missing: string[] } | null {
  const missing: string[] = []
  if (!getSkuFromItem(item)) missing.push('SKU/条码')
  if (!(item.goods_name && item.goods_name.trim())) missing.push('货物名称')
  if (!(item.brand && item.brand.trim())) missing.push('品牌')
  if (!(item.model && item.model.trim())) missing.push('型号')
  if (!(item.unit && item.unit.trim())) missing.push('单位')
  if (!(item.quantity != null && Number(item.quantity) > 0)) missing.push('数量')
  return missing.length ? { index, missing } : null
}

type SkuConflict = { sku: string; warehouse: string | null; goods_name: string; existing_quantity: number; item_index: number }

/** 库存项（用于搜索匹配） */
type InventoryMatchItem = {
  id: number
  sku: string | null
  goods_name: string
  brand: string | null
  model: string | null
  unit: string | null
  warehouse: string | null
  project_name: string | null
}

const InventoryStockInPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const navigate = useNavigate()
  const [list, setList] = useState<StockInRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [nlText, setNlText] = useState('')
  const [nlLoading, setNlLoading] = useState(false)
  const [parsed, setParsed] = useState<{ type: string; items: ParsedItem[] } | null>(null)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [manualForm] = Form.useForm()
  const [keyword, setKeyword] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [inventoryOptionsByKey, setInventoryOptionsByKey] = useState<Record<string, InventoryMatchItem[]>>({})
  const [inventorySearchLoadingByKey, setInventorySearchLoadingByKey] = useState<Record<string, boolean>>({})
  const [projectOptions, setProjectOptions] = useState<string[]>([])
  const [projectSearchLoading, setProjectSearchLoading] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [skuConflictModal, setSkuConflictModal] = useState<{
    visible: boolean
    conflicts: SkuConflict[]
    payload: Record<string, any>
    onSuccess?: () => void
  }>({ visible: false, conflicts: [], payload: {} })

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (keyword.trim()) params.set('keyword', keyword.trim())
      if (warehouseFilter.trim()) params.set('warehouse', warehouseFilter.trim())
      const res = await axios.get<{ list: StockInRecord[]; total: number }>(`/api/inventory/stock-in?${params.toString()}`)
      setList(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, warehouseFilter, msg])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  /** 按指定字段模糊搜索库存：sku 框搜只匹配 sku，货物名称框只匹配货物名称，品牌/型号同理 */
  const fetchInventoryForMatch = useCallback(
    async (
      searchValue: string,
      field: 'sku' | 'goods_name' | 'brand' | 'model',
      projectName?: string | null,
      rowKey?: string
    ) => {
      if (!rowKey) return
      const val = (searchValue ?? '').trim()
      if (!val) {
        setInventoryOptionsByKey((prev) => ({ ...prev, [rowKey]: [] }))
        return
      }
      setInventorySearchLoadingByKey((prev) => ({ ...prev, [rowKey]: true }))
      try {
        const params = new URLSearchParams()
        params.set(field, val)
        if (projectName != null && String(projectName).trim()) params.set('project_name', String(projectName).trim())
        const res = await axios.get<{ list: InventoryMatchItem[] }>(`/api/inventory?${params.toString()}`)
        setInventoryOptionsByKey((prev) => ({ ...prev, [rowKey]: res.data?.list ?? [] }))
      } catch {
        setInventoryOptionsByKey((prev) => ({ ...prev, [rowKey]: [] }))
      } finally {
        setInventorySearchLoadingByKey((prev) => ({ ...prev, [rowKey]: false }))
      }
    },
    []
  )

  /** 关联项目下拉：按关键词搜索项目名 */
  const fetchProjectOptions = useCallback(async (searchKeyword?: string) => {
    setProjectSearchLoading(true)
    try {
      const params = new URLSearchParams()
      if (searchKeyword != null && String(searchKeyword).trim()) params.set('keyword', String(searchKeyword).trim())
      params.set('limit', '100')
      const res = await axios.get<{ list: string[] }>(`/api/products/projects?${params.toString()}`)
      setProjectOptions(res.data?.list ?? [])
    } catch {
      setProjectOptions([])
    } finally {
      setProjectSearchLoading(false)
    }
  }, [])

  const handleParse = async () => {
    const text = nlText.trim()
    if (!text) {
      msg.warning('请输入自然语言描述')
      return
    }
    setNlLoading(true)
    setParsed(null)
    try {
      const res = await axios.post<{ type: string; items: ParsedItem[] }>('/api/inventory/parse-natural-language', { text, prefer_type: 'in' })
      if (res.data.type !== 'in') {
        msg.warning('当前解析为出库操作，请到「出库管理」确认')
      }
      setParsed({ type: res.data.type, items: res.data.items || [] })
      if ((res.data.items?.length ?? 0) === 0) {
        msg.warning('未解析出有效入库条目，请补充描述')
      }
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '解析失败')
    } finally {
      setNlLoading(false)
    }
  }

  const updateParsedItem = (index: number, field: keyof ParsedItem, value: string | number | null | undefined) => {
    if (!parsed?.items) return
    const next = parsed.items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    )
    setParsed({ ...parsed, items: next })
  }

  const submitWithDuplicateMode = async (mode: 'increment' | 'overwrite') => {
    const { payload, onSuccess } = skuConflictModal
    if (!payload || !payload.items?.length) return
    setSubmitLoading(true)
    try {
      await axios.post('/api/inventory/stock-in', { ...payload, on_duplicate_sku: mode })
      msg.success('入库成功')
      setSkuConflictModal({ visible: false, conflicts: [], payload: {} })
      onSuccess?.()
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '入库失败')
    } finally {
      setSubmitLoading(false)
    }
  }

  const handleConfirmStockIn = async () => {
    if (!parsed?.items?.length) {
      msg.warning('无有效入库条目')
      return
    }
    const firstMissing = parsed.items.map((item, i) => getMissingRequired(item, i)).find(Boolean)
    if (firstMissing) {
      msg.warning(`第 ${firstMissing!.index + 1} 条缺少必填项，请补充：${firstMissing!.missing.join('、')}`)
      return
    }
    const payload = {
      items: parsed.items.map((i) => ({
        sku: getSkuFromItem(i) ?? undefined,
        goods_name: i.goods_name?.trim(),
        brand: i.brand?.trim(),
        model: i.model?.trim() || undefined,
        project_name: i.project_name?.trim(),
        unit: i.unit?.trim(),
        quantity: Number(i.quantity),
        warehouse: i.warehouse?.trim() || undefined,
        remark: i.remark?.trim() || undefined,
      })),
      source_type: 'natural_language',
      natural_language_text: nlText.trim() || undefined,
    }
    setSubmitLoading(true)
    try {
      await axios.post('/api/inventory/stock-in', payload)
      msg.success('入库成功')
      setParsed(null)
      setNlText('')
      fetchList()
    } catch (e: any) {
      const data = e?.response?.data
      if (e?.response?.status === 409 && data?.code === 'SKU_CONFLICT') {
        setSkuConflictModal({
          visible: true,
          conflicts: data.conflicts ?? [],
          payload,
          onSuccess: () => {
            setParsed(null)
            setNlText('')
          },
        })
      } else {
        msg.error(data?.message || '入库失败')
      }
    } finally {
      setSubmitLoading(false)
    }
  }

  const handleManualSubmit = async () => {
    try {
      const values = await manualForm.validateFields()
      const items = values.items && Array.isArray(values.items) ? values.items : []
      if (items.length === 0) {
        msg.warning('请至少添加一条入库明细')
        return
      }
      const payload = {
        ref_no: values.ref_no || undefined,
        items: items.map((r: any) => ({
          sku: r.sku,
          goods_name: r.goods_name,
          brand: r.brand,
          project_name: r.project_name,
          unit: r.unit,
          quantity: r.quantity,
          warehouse: r.warehouse,
          remark: r.remark,
          model: r.model,
        })),
        source_type: 'manual',
      }
      setSubmitLoading(true)
      await axios.post('/api/inventory/stock-in', payload)
      msg.success('入库成功')
      manualForm.resetFields()
      fetchList()
    } catch (e: any) {
      if (e?.errorFields) return
      const data = e?.response?.data
      if (e?.response?.status === 409 && data?.code === 'SKU_CONFLICT') {
        const values = manualForm.getFieldsValue()
        setSkuConflictModal({
          visible: true,
          conflicts: data.conflicts ?? [],
          payload: {
            ref_no: values.ref_no || undefined,
            items: (values.items || []).map((r: any) => ({
              sku: r.sku,
              goods_name: r.goods_name,
              brand: r.brand,
              project_name: r.project_name,
              unit: r.unit,
              quantity: r.quantity,
              warehouse: r.warehouse,
              remark: r.remark,
              model: r.model,
            })),
            source_type: 'manual',
          },
          onSuccess: () => manualForm.resetFields(),
        })
      } else {
        msg.error(data?.message || '入库失败')
      }
    } finally {
      setSubmitLoading(false)
    }
  }

  /** 按单汇总：列表以每单一行展示 */
  const orderList = useMemo((): StockInOrderSummary[] => {
    const map = new Map<string, StockInOrderSummary>()
    for (const row of list) {
      const ref = row.ref_no ?? ''
      if (!ref) continue
      const existing = map.get(ref)
      if (!existing) {
        map.set(ref, {
          ref_no: ref,
          project_name: row.project_name ?? null,
          source_type: row.source_type ?? 'manual',
          created_at: row.created_at,
          created_by: row.created_by ?? null,
          item_count: 1,
        })
      } else {
        existing.item_count += 1
      }
    }
    return [...map.values()].sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
  }, [list])

  const handleDeleteOrder = useCallback(
    async (refNo: string) => {
      try {
        await axios.delete(`/api/inventory/stock-in/by-ref?ref_no=${encodeURIComponent(refNo)}`)
        msg.success('已删除')
        fetchList()
      } catch (e: any) {
        msg.error(e?.response?.data?.message || '删除失败')
      }
    },
    [msg, fetchList]
  )

  const orderColumns: ColumnsType<StockInOrderSummary> = [
    { title: '单号', dataIndex: 'ref_no', width: 120, ellipsis: true },
    { title: '关联项目', dataIndex: 'project_name', width: 120, ellipsis: true, render: (v) => v || '—' },
    { title: '来源', dataIndex: 'source_type', width: 90, render: (v) => (v === 'natural_language' ? '自然语言' : '手动') },
    { title: '明细数', dataIndex: 'item_count', width: 80, align: 'right' },
    { title: '操作人', dataIndex: 'created_by', width: 90, render: (v) => v || '—' },
    { title: '时间', dataIndex: 'created_at', width: 165, render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '—') },
    {
      title: '操作',
      key: 'action',
      width: 140,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/inventory-stock-in/detail?ref_no=${encodeURIComponent(row.ref_no)}`)}>
            查看详情
          </Button>
          <Popconfirm title="确定删除该入库单记录？删除后不可恢复。" onConfirm={() => handleDeleteOrder(row.ref_no)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      <div className="page-header-banner">
        <div className="header-left">
          <div className="header-icon-wrap" style={{ background: 'linear-gradient(135deg, #389e0d, #52c41a)' }}>
            <InboxOutlined />
          </div>
          <div>
            <Title level={4} className="header-title" style={{ marginBottom: 0 }}>
              入库管理
            </Title>
            <Text type="secondary" className="header-desc" style={{ display: 'block' }}>
              支持自然语言录入与手动表单录入，入库后自动增加库存；可按仓库、关键词筛选记录。
            </Text>
          </div>
        </div>
      </div>

      <Card title={<><RobotOutlined /> 自然语言入库</>} className="section-card" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Input.TextArea
            rows={3}
            placeholder="例如：入库电缆 100 米到 A 仓；到货 开关 20 个、插座 30 个（回车解析，Alt+回车换行）"
            value={nlText}
            onChange={(e) => setNlText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.altKey) {
                e.preventDefault()
                handleParse()
              }
            }}
          />
          <Space>
            <Button type="primary" loading={nlLoading} onClick={handleParse}>
              解析
            </Button>
            {parsed && parsed.items.length > 0 && parsed.type === 'in' && (
              <Button type="primary" loading={submitLoading} onClick={handleConfirmStockIn}>
                确认入库
              </Button>
            )}
          </Space>
          {parsed && parsed.items.length > 0 && parsed.type === 'in' && (
            <>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                入库必填：SKU/条码（须手动填写，不自动生成）、货物名称、品牌、型号、单位、数量；关联项目选填。若解析未识别请在下表补充后点击「确认入库」。
              </Text>
              <Table
                size="small"
                rowKey={(_, i) => String(i)}
                pagination={false}
                dataSource={parsed.items}
                columns={[
                  {
                    title: 'SKU/条码',
                    width: 110,
                    render: (_, row, i) => (
                      <Input
                        value={row.sku ?? row.条码 ?? ''}
                        onChange={(e) => {
                          const v = e.target.value.trim() || undefined
                          updateParsedItem(i, 'sku', v ?? null)
                          updateParsedItem(i, '条码', v ?? null)
                        }}
                        placeholder="必填"
                      />
                    ),
                  },
                  {
                    title: '货物名称',
                    dataIndex: 'goods_name',
                    width: 140,
                    render: (val, _, i) => (
                      <Input
                        value={val ?? ''}
                        onChange={(e) => updateParsedItem(i, 'goods_name', e.target.value)}
                        placeholder="必填"
                      />
                    ),
                  },
                  {
                    title: '品牌',
                    dataIndex: 'brand',
                    width: 100,
                    render: (val, _, i) => (
                      <Input
                        value={val ?? ''}
                        onChange={(e) => updateParsedItem(i, 'brand', e.target.value)}
                        placeholder="必填"
                      />
                    ),
                  },
                  {
                    title: '型号',
                    dataIndex: 'model',
                    width: 100,
                    render: (val, _, i) => (
                      <Input
                        value={val ?? ''}
                        onChange={(e) => updateParsedItem(i, 'model', e.target.value)}
                        placeholder="必填"
                      />
                    ),
                  },
                  {
                    title: '关联项目',
                    dataIndex: 'project_name',
                    width: 120,
                    render: (val, _, i) => (
                      <Input
                        value={val ?? ''}
                        onChange={(e) => updateParsedItem(i, 'project_name', e.target.value)}
                        placeholder="选填"
                      />
                    ),
                  },
                  {
                    title: '单位',
                    dataIndex: 'unit',
                    width: 80,
                    render: (val, _, i) => (
                      <Input
                        value={val ?? ''}
                        onChange={(e) => updateParsedItem(i, 'unit', e.target.value)}
                        placeholder="必填"
                      />
                    ),
                  },
                  {
                    title: '数量',
                    dataIndex: 'quantity',
                    width: 100,
                    render: (val, _, i) => (
                      <InputNumber
                        min={0.0001}
                        value={val}
                        onChange={(v) => updateParsedItem(i, 'quantity', v ?? 0)}
                        placeholder="必填"
                        style={{ width: '100%' }}
                      />
                    ),
                  },
                  { title: '仓库', dataIndex: 'warehouse', width: 90, render: (v) => v || '—' },
                  {
                    title: '备注',
                    dataIndex: 'remark',
                    width: 100,
                    render: (val, _, i) => (
                      <Input
                        value={val ?? ''}
                        onChange={(e) => updateParsedItem(i, 'remark', e.target.value)}
                        placeholder="选填"
                      />
                    ),
                  },
                ]}
              />
            </>
          )}
        </Space>
      </Card>

      <Card title={<><PlusOutlined /> 手动入库</>} className="section-card" style={{ marginBottom: 16 }}>
        <Form form={manualForm} layout="vertical" onFinish={handleManualSubmit}>
          <Form.Item name="ref_no" label="入库单号（选填）">
            <Input placeholder="留空自动生成，如 RK20250301001" />
          </Form.Item>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => {
                  const rowKey = String(key)
                  const options = inventoryOptionsByKey[rowKey] ?? []
                  const searchLoading = inventorySearchLoadingByKey[rowKey] ?? false
                  const fullRowTitle = (item: InventoryMatchItem) => (
                    <div style={{ whiteSpace: 'pre-line', textAlign: 'left' }}>
                      {[
                        `SKU: ${item.sku ?? '—'}`,
                        `货物名称: ${item.goods_name || '—'}`,
                        `品牌: ${item.brand ?? '—'}`,
                        `型号: ${item.model ?? '—'}`,
                        `单位: ${item.unit ?? '—'}`,
                        `仓库: ${item.warehouse ?? '—'}`,
                        `关联项目: ${item.project_name ?? '—'}`,
                      ].join('\n')}
                    </div>
                  )
                  const autoCompleteOptions = options.map((item, idx) => ({
                    key: idx,
                    value: `${item.sku ?? ''} ${item.goods_name} ${item.brand ?? ''} ${item.model ?? ''}`.trim(),
                    label: (
                      <Tooltip title={fullRowTitle(item)} placement="left">
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span>{item.sku ?? '—'}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.goods_name}</span>
                          <span>{[item.brand, item.model].filter(Boolean).join(' ')}</span>
                        </div>
                      </Tooltip>
                    ),
                  }))
                  const doSearchByField = (val: string, field: 'sku' | 'goods_name' | 'brand' | 'model') => {
                    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
                    searchDebounceRef.current = setTimeout(() => {
                      const projectName = manualForm.getFieldValue(['items', name, 'project_name'])
                      fetchInventoryForMatch(val, field, projectName, rowKey)
                    }, 300)
                  }
                  const fillRow = (item: InventoryMatchItem) => {
                    if (item.sku != null) manualForm.setFieldValue(['items', name, 'sku'], item.sku)
                    manualForm.setFieldValue(['items', name, 'goods_name'], item.goods_name || '')
                    if (item.brand != null) manualForm.setFieldValue(['items', name, 'brand'], item.brand)
                    if (item.model != null) manualForm.setFieldValue(['items', name, 'model'], item.model)
                    if (item.unit != null) manualForm.setFieldValue(['items', name, 'unit'], item.unit)
                    if (item.project_name != null) manualForm.setFieldValue(['items', name, 'project_name'], item.project_name)
                    if (item.warehouse != null) manualForm.setFieldValue(['items', name, 'warehouse'], item.warehouse)
                  }
                  const onSelectMatch = (_: string, opt: { key?: number | string }) => {
                    const idx = typeof opt?.key === 'number' ? opt.key : Number(opt?.key)
                    const item = options[idx]
                    if (item) fillRow(item)
                  }
                  return (
                    <Space key={key} align="baseline" style={{ marginBottom: 8 }} wrap>
                      <Form.Item {...rest} name={[name, 'sku']} rules={[{ required: true, message: '必填' }]} style={{ width: 110 }}>
                        <AutoComplete
                          placeholder="SKU/条码（输入按 SKU 匹配）"
                          options={autoCompleteOptions}
                          onSearch={(val) => doSearchByField(val, 'sku')}
                          onSelect={onSelectMatch}
                          notFoundContent={searchLoading ? '搜索中…' : (options.length === 0 ? '按 SKU 搜索' : null)}
                        />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'goods_name']} rules={[{ required: true, message: '必填' }]} style={{ width: 140 }}>
                        <AutoComplete
                          placeholder="货物名称（输入按货物名匹配）"
                          options={autoCompleteOptions}
                          onSearch={(val) => doSearchByField(val, 'goods_name')}
                          onSelect={onSelectMatch}
                          notFoundContent={searchLoading ? '搜索中…' : (options.length === 0 ? '按货物名称搜索' : null)}
                        />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'brand']} rules={[{ required: true, message: '必填' }]} style={{ width: 100 }}>
                        <AutoComplete
                          placeholder="品牌（输入按品牌匹配）"
                          options={autoCompleteOptions}
                          onSearch={(val) => doSearchByField(val, 'brand')}
                          onSelect={onSelectMatch}
                          notFoundContent={searchLoading ? '搜索中…' : (options.length === 0 ? '按品牌搜索' : null)}
                        />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'model']} rules={[{ required: true, message: '必填' }]} style={{ width: 100 }}>
                        <AutoComplete
                          placeholder="型号（输入按型号匹配）"
                          options={autoCompleteOptions}
                          onSearch={(val) => doSearchByField(val, 'model')}
                          onSelect={onSelectMatch}
                          notFoundContent={searchLoading ? '搜索中…' : (options.length === 0 ? '按型号搜索' : null)}
                        />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'project_name']} style={{ width: 140 }}>
                        <AutoComplete
                          placeholder="关联项目（选填，可下拉选或直接输入）"
                          allowClear
                          options={projectOptions.map((p) => ({ value: p, label: p }))}
                          onSearch={(q) => fetchProjectOptions(q || '')}
                          onDropdownVisibleChange={(open) => open && projectOptions.length === 0 && fetchProjectOptions('')}
                          notFoundContent={projectSearchLoading ? '加载中…' : '输入搜索或直接输入项目名'}
                        />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'unit']} rules={[{ required: true, message: '必填' }]} style={{ width: 70 }}>
                        <Input placeholder="单位" />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'quantity']} rules={[{ required: true, message: '必填' }]} style={{ width: 90 }}>
                        <InputNumber min={0.0001} placeholder="数量" style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'warehouse']} style={{ width: 100 }}>
                        <Input placeholder="仓库" />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'remark']} style={{ width: 100 }}>
                        <Input placeholder="备注" />
                      </Form.Item>
                      <Button type="text" danger onClick={() => remove(name)}>删除</Button>
                    </Space>
                  )
                })}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>添加明细</Button>
                </Form.Item>
              </>
            )}
          </Form.List>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitLoading}>提交入库</Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="入库记录" className="section-card section-card-accent-blue">
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            placeholder="关键词"
            allowClear
            style={{ width: 160 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={fetchList}
          />
          <Input
            placeholder="仓库"
            allowClear
            style={{ width: 120 }}
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            onPressEnter={fetchList}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={fetchList}>查询</Button>
        </Space>
        <Table<StockInOrderSummary>
          rowKey="ref_no"
          size="small"
          loading={loading}
          columns={orderColumns}
          dataSource={orderList}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 单` }}
          locale={{ emptyText: '暂无入库记录' }}
        />
      </Card>

      <Modal
        title="同一 SKU/条码 已存在"
        open={skuConflictModal.visible}
        onCancel={() => setSkuConflictModal((s) => ({ ...s, visible: false }))}
        footer={[
          <Button key="cancel" onClick={() => setSkuConflictModal((s) => ({ ...s, visible: false }))}>
            取消
          </Button>,
          <Button key="increment" type="primary" loading={submitLoading} onClick={() => submitWithDuplicateMode('increment')}>
            增量（在现有数量上累加）
          </Button>,
          <Button key="overwrite" loading={submitLoading} onClick={() => submitWithDuplicateMode('overwrite')}>
            覆盖（用本次数量覆盖现有数量）
          </Button>,
        ]}
        width={560}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          以下 SKU/条码 在对应仓库中已存在，请选择处理方式：
        </Text>
        <Table
          size="small"
          rowKey={(_, i) => String(i)}
          pagination={false}
          dataSource={skuConflictModal.conflicts}
          columns={[
            { title: 'SKU/条码', dataIndex: 'sku', width: 100 },
            { title: '仓库', dataIndex: 'warehouse', width: 80, render: (v) => v || '—' },
            { title: '货物名称', dataIndex: 'goods_name', ellipsis: true },
            { title: '当前数量', dataIndex: 'existing_quantity', width: 90, align: 'right' as const },
          ]}
        />
      </Modal>
    </div>
  )
}

export default InventoryStockInPage
