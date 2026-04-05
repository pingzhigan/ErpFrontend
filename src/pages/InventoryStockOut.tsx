/**
 * 功能名称：库存出库
 * 实现原理与逻辑：支持手动选择库存行出库与自然语言描述出库（解析后与库存列表匹配 SKU/货物名等）；维护出库单行列表，
 * 校验数量不超过库存，提交后扣减库存并生成出库记录。出库记录列表支持筛选与导出。
 */
import { DeleteOutlined, ExportOutlined, EyeOutlined, PlusOutlined, RobotOutlined, SearchOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  App,
  Button,
  Card,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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
}

/** 按单汇总（列表每单一行） */
type StockOutOrderSummary = {
  ref_no: string
  project_name: string | null
  source_type: string
  created_at: string
  created_by: string | null
  item_count: number
}

/** 库存完整信息（用于匹配与展示品牌/型号/参数） */
type InventoryItemFull = {
  id: number
  goods_name: string
  brand: string | null
  model: string | null
  params: string | null
  unit: string | null
  quantity: number | null
  warehouse: string | null
  sku: string | null
  project_name?: string | null
  remark?: string | null
}

/** 出库单行：统一用于自然语言添加与手动添加 */
type OrderLine = {
  inventory_id: number
  quantity: number
  remark?: string
  /** 自然语言解析的“需求”描述，仅展示 */
  demandText?: string
  /** 库存快照，用于展示品牌/型号/参数/库存数量 */
  inventory?: InventoryItemFull | null
}

type ParsedItem = {
  goods_name: string
  quantity: number
  unit?: string | null
  warehouse?: string | null
  project_name?: string | null
  remark?: string | null
}

/** 解析结果 + 匹配到的库存（自然语言表达“要什么”，匹配后才是“真正出库的东西”） */
type ParsedItemWithMatch = ParsedItem & {
  matchedInventory: InventoryItemFull | null
  matchCandidates?: InventoryItemFull[]
}

const InventoryStockOutPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const navigate = useNavigate()
  const [list, setList] = useState<StockOutRecord[]>([])
  const [inventoryList, setInventoryList] = useState<InventoryItemFull[]>([])
  const [loading, setLoading] = useState(false)
  const [nlText, setNlText] = useState('')
  const [nlLoading, setNlLoading] = useState(false)
  const [parsed, setParsed] = useState<{ type: string; items: ParsedItemWithMatch[] } | null>(null)
  const [matchLoading, setMatchLoading] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  /** 出库单行：默认保留一行空行，填写后自动追加空行，提交时过滤掉空行 */
  const [orderItems, setOrderItems] = useState<OrderLine[]>(() => [
    { inventory_id: 0, quantity: 0, inventory: null },
  ])
  const [refNo, setRefNo] = useState('')
  const [projectName, setProjectName] = useState<string>('')
  const [projectOptions, setProjectOptions] = useState<string[]>([])
  const [keyword, setKeyword] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const invSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (keyword.trim()) params.set('keyword', keyword.trim())
      if (warehouseFilter.trim()) params.set('warehouse', warehouseFilter.trim())
      const res = await axios.get<{ list: StockOutRecord[]; total: number }>(`/api/inventory/stock-out?${params.toString()}`)
      setList(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, warehouseFilter, msg])

  const fetchInventory = useCallback(async (search?: string) => {
    try {
      const params = new URLSearchParams()
      if (search && search.trim()) params.set('keyword', search.trim())
      const res = await axios.get<{ list: InventoryItemFull[] }>(`/api/inventory?${params.toString()}`)
      setInventoryList(res.data?.list ?? [])
    } catch {
      setInventoryList([])
    }
  }, [])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  useEffect(() => {
    fetchInventory()
  }, [fetchInventory])

  const fetchProjects = useCallback(async (search?: string) => {
    try {
      const params = new URLSearchParams()
      if (search != null && search.trim()) params.set('keyword', search.trim())
      const res = await axios.get<{ list: string[] }>(`/api/products/projects?${params.toString()}`)
      setProjectOptions(res.data?.list ?? [])
    } catch {
      setProjectOptions([])
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  /** 根据货物名称、仓库匹配库存列表；使用按字模糊匹配（如「8口交换机」可匹配「8口POE交换机」） */
  const matchInventory = useCallback(async (goodsName: string, warehouse?: string | null): Promise<InventoryItemFull[]> => {
    const params = new URLSearchParams()
    if (goodsName?.trim()) {
      params.set('keyword', goodsName.trim())
      params.set('fuzzy', '1')
    }
    if (warehouse?.trim()) params.set('warehouse', warehouse.trim())
    const res = await axios.get<{ list: InventoryItemFull[] }>(`/api/inventory?${params.toString()}`)
    const list = res.data?.list ?? []
    return list
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
      const res = await axios.post<{ type: string; items: ParsedItem[] }>('/api/inventory/parse-natural-language', { text, prefer_type: 'out' })
      if (res.data.type !== 'out') {
        msg.warning('当前解析为入库操作，请到「入库管理」确认')
      }
      const rawItems = res.data.items || []
      if (rawItems.length === 0) {
        msg.warning('未解析出有效出库条目，请补充描述')
        setParsed({ type: res.data.type, items: [] })
        return
      }
      setMatchLoading(true)
      const itemsWithMatch: ParsedItemWithMatch[] = []
      for (const item of rawItems) {
        const candidates = await matchInventory(item.goods_name, item.warehouse)
        const matched = candidates.find((r) => r.goods_name === item.goods_name) ?? candidates[0] ?? null
        itemsWithMatch.push({ ...item, matchedInventory: matched, matchCandidates: candidates })
      }
      setParsed({ type: res.data.type, items: itemsWithMatch })
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '解析失败')
    } finally {
      setNlLoading(false)
      setMatchLoading(false)
    }
  }

  const updateParsedItem = (index: number, updates: Partial<ParsedItemWithMatch>) => {
    if (!parsed?.items) return
    const next = parsed.items.map((item, i) => (i === index ? { ...item, ...updates } : item))
    setParsed({ ...parsed, items: next })
  }

  /** 将自然语言解析结果添加到出库单（仅添加已匹配到库存的） */
  const handleAddToOrder = () => {
    if (!parsed?.items?.length) {
      msg.warning('无有效出库条目')
      return
    }
    const toAdd: OrderLine[] = parsed.items
      .filter((i) => i.matchedInventory)
      .map((i) => {
        const inv = i.matchedInventory!
        const stock = inv.quantity != null ? Number(inv.quantity) : 0
        const qty = Math.max(1, Math.floor(Number(i.quantity)))
        const quantity = stock > 0 ? Math.min(qty, stock) : qty
        return {
          inventory_id: inv.id,
          quantity,
          remark: i.remark ?? undefined,
          demandText: i.goods_name,
          inventory: inv,
        }
      })
    if (toAdd.length === 0) {
      msg.warning('没有可添加的条目（请确保每条已匹配到库存）')
      return
    }
    setOrderItems((prev) => [...prev, ...toAdd, { inventory_id: 0, quantity: 0, inventory: null }])
    setParsed(null)
    setNlText('')
    msg.success(`已添加 ${toAdd.length} 条到出库单`)
  }

  const updateOrderItem = (index: number, updates: Partial<OrderLine>) => {
    setOrderItems((prev) => {
      let next = prev.map((row, i) => (i === index ? { ...row, ...updates } : row))
      const updated = next[index]
      const inv = updated.inventory ?? getInventoryById(updated.inventory_id)
      const stockQty = inv?.quantity != null ? Number(inv.quantity) : 0
      if (updated.quantity > stockQty && stockQty > 0) {
        next = next.map((row, i) => (i === index ? { ...row, quantity: stockQty } : row))
      }
      const needTrailingEmpty = updated.inventory_id > 0 && index === next.length - 1
      return needTrailingEmpty ? [...next, { inventory_id: 0, quantity: 0, inventory: null }] : next
    })
  }

  const removeOrderItem = (index: number) => {
    setOrderItems((prev) => {
      const next = prev.filter((_, i) => i !== index)
      const last = next[next.length - 1]
      const needTrailing = next.length > 0 && last && last.inventory_id > 0
      return needTrailing ? [...next, { inventory_id: 0, quantity: 0, inventory: null }] : next
    })
  }

  const addOrderRow = () => {
    setOrderItems((prev) => [...prev, { inventory_id: 0, quantity: 0, inventory: null }])
  }

  /** 提交出库单：仅提交有效行（自动过滤空行），并校验出库数量不超过库存 */
  const handleSubmitOrder = async () => {
    if (!projectName || !projectName.trim()) {
      msg.warning('出库单必须关联项目，请选择关联项目')
      return
    }
    const valid = orderItems.filter((r) => r.inventory_id > 0 && r.quantity > 0)
    if (valid.length === 0) {
      msg.warning('出库单为空或存在无效行，请添加明细后再提交')
      return
    }
    for (const row of valid) {
      const inv = row.inventory ?? getInventoryById(row.inventory_id)
      const stock = inv?.quantity != null ? Number(inv.quantity) : 0
      if (row.quantity > stock) {
        msg.warning(`「${inv?.goods_name ?? '该行'}」出库数量（${row.quantity}）不能大于库存数量（${stock}），请修改后重试`)
        return
      }
    }
    setSubmitLoading(true)
    try {
      await axios.post('/api/inventory/stock-out', {
        ref_no: refNo.trim() || undefined,
        project_name: projectName.trim(),
        items: valid.map((r) => ({ inventory_id: r.inventory_id, quantity: r.quantity, remark: r.remark })),
        source_type: 'manual',
      })
      msg.success('出库成功')
      setOrderItems([{ inventory_id: 0, quantity: 0, inventory: null }])
      setRefNo('')
      setProjectName('')
      fetchList()
      fetchInventory()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '出库失败')
    } finally {
      setSubmitLoading(false)
    }
  }

  const onInventorySearch = (v: string) => {
    if (invSearchRef.current) clearTimeout(invSearchRef.current)
    invSearchRef.current = setTimeout(() => fetchInventory(v), 300)
  }

  /** 根据 id 从列表取库存详情（用于新加行选择后展示） */
  const getInventoryById = useCallback(
    (id: number) => inventoryList.find((inv) => inv.id === id) ?? null,
    [inventoryList]
  )

  /** 按单汇总：列表以每单一行展示 */
  const orderList = useMemo((): StockOutOrderSummary[] => {
    const map = new Map<string, StockOutOrderSummary>()
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
        await axios.delete(`/api/inventory/stock-out/by-ref?ref_no=${encodeURIComponent(refNo)}`)
        msg.success('已删除')
        fetchList()
      } catch (e: any) {
        msg.error(e?.response?.data?.message || '删除失败')
      }
    },
    [msg, fetchList]
  )

  const orderColumns: ColumnsType<StockOutOrderSummary> = [
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
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/inventory-stock-out/detail?ref_no=${encodeURIComponent(row.ref_no)}`)}>
            查看详情
          </Button>
          <Popconfirm title="确定删除该出库单记录？删除后不可恢复。" onConfirm={() => handleDeleteOrder(row.ref_no)}>
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
          <div className="header-icon-wrap" style={{ background: 'linear-gradient(135deg, #d46b08, #fa8c16)' }}>
            <ExportOutlined />
          </div>
          <div>
            <Title level={4} className="header-title" style={{ marginBottom: 0 }}>
              出库管理
            </Title>
            <Text type="secondary" className="header-desc" style={{ display: 'block' }}>
              支持自然语言录入与手动选择库存出库，出库后自动扣减库存；可按仓库、关键词筛选记录。
            </Text>
          </div>
        </div>
      </div>

      <Card title={<><RobotOutlined /> 自然语言出库</>} className="section-card" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Input.TextArea
            rows={3}
            placeholder="例如：出库电缆 50 米；领用 开关 10 个 从 A 仓（回车解析，Alt+回车换行）"
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
            <Button type="primary" loading={nlLoading || matchLoading} onClick={handleParse}>
              {matchLoading ? '匹配库存中…' : '解析'}
            </Button>
            {parsed && parsed.items.length > 0 && parsed.type === 'out' && (
              <Button type="primary" onClick={handleAddToOrder}>
                添加到出库单
              </Button>
            )}
          </Space>
          {parsed && parsed.items.length > 0 && (
            <>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                下表为解析出的「要什么」；匹配库存列为系统根据货物名称匹配的库存（品牌/型号/参数），确认出库以匹配结果为准。
              </Text>
              <Table
                size="small"
                rowKey={(_, i) => String(i)}
                pagination={false}
                dataSource={parsed.items}
                columns={[
                  {
                    title: '需求（解析）',
                    key: 'goods_name',
                    width: 120,
                    render: (_: unknown, row: ParsedItemWithMatch) => row.goods_name || '—',
                  },
                  {
                    title: '匹配库存',
                    key: 'matched',
                    width: 200,
                    render: (_: unknown, row: ParsedItemWithMatch, idx: number) => {
                      const inv = row.matchedInventory
                      const candidates = row.matchCandidates ?? []
                      if (!inv) {
                        return <Text type="danger">未匹配</Text>
                      }
                      if (candidates.length <= 1) {
                        return (
                          <span title={`品牌: ${inv.brand ?? '—'} 型号: ${inv.model ?? '—'} 参数: ${inv.params ?? '—'}`}>
                            {[inv.brand, inv.model, inv.params].filter(Boolean).join(' / ') || inv.goods_name}
                          </span>
                        )
                      }
                      return (
                        <Select
                          value={inv.id}
                          style={{ width: '100%' }}
                          optionFilterProp="label"
                          onChange={(id) => {
                            const next = candidates.find((c) => c.id === id) ?? null
                            updateParsedItem(idx, { matchedInventory: next })
                          }}
                          options={candidates.map((c) => ({
                            label: `${c.goods_name} ${c.brand ? ` ${c.brand}` : ''} ${c.model ? ` ${c.model}` : ''} (库存:${c.quantity ?? 0})`,
                            value: c.id,
                          }))}
                        />
                      )
                    },
                  },
                  {
                    title: '品牌',
                    key: 'brand',
                    width: 90,
                    render: (_: unknown, row: ParsedItemWithMatch) => row.matchedInventory?.brand ?? '—',
                  },
                  {
                    title: '型号',
                    key: 'model',
                    width: 90,
                    render: (_: unknown, row: ParsedItemWithMatch) => row.matchedInventory?.model ?? '—',
                  },
                  {
                    title: '参数',
                    key: 'params',
                    width: 100,
                    ellipsis: true,
                    render: (_: unknown, row: ParsedItemWithMatch) => row.matchedInventory?.params ?? '—',
                  },
                  {
                    title: '库存数量',
                    key: 'stockQty',
                    width: 88,
                    align: 'right',
                    render: (_: unknown, row: ParsedItemWithMatch) =>
                      row.matchedInventory?.quantity != null ? Number(row.matchedInventory.quantity) : '—',
                  },
                  {
                    title: '出库数量',
                    key: 'quantity',
                    width: 100,
                    render: (_: unknown, row: ParsedItemWithMatch, idx: number) => (
                      <InputNumber
                        min={1}
                        step={1}
                        precision={0}
                        value={row.quantity}
                        onChange={(v) => updateParsedItem(idx, { quantity: v != null ? Math.floor(Number(v)) : 0 })}
                        style={{ width: '100%' }}
                      />
                    ),
                  },
                  {
                    title: '单位',
                    key: 'unit',
                    width: 56,
                    render: (_: unknown, row: ParsedItemWithMatch) =>
                      row.matchedInventory?.unit ?? row.unit ?? '—',
                  },
                  {
                    title: '仓库',
                    key: 'warehouse',
                    width: 90,
                    render: (_: unknown, row: ParsedItemWithMatch) =>
                      row.matchedInventory?.warehouse ?? row.warehouse ?? '—',
                  },
                  {
                    title: '备注',
                    key: 'remark',
                    width: 80,
                    render: (_: unknown, row: ParsedItemWithMatch, idx: number) => (
                      <Input
                        value={row.remark ?? ''}
                        onChange={(e) => updateParsedItem(idx, { remark: e.target.value })}
                        placeholder="选填"
                        size="small"
                      />
                    ),
                  },
                ]}
              />
            </>
          )}
        </Space>
      </Card>

      <Card title={<><PlusOutlined /> 出库单</>} className="section-card" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Space wrap align="center" style={{ marginBottom: 6 }}>
              <Text strong>
                关联项目 <Text type="danger">*</Text>
              </Text>
              <Tooltip title="必填项：须先选择或输入项目名称，本单方可提交；用于出库记录归档与按项目追溯。">
                <Select
                  placeholder="【必填】请搜索或选择项目名称"
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  filterOption={false}
                  onSearch={(v) => fetchProjects(v)}
                  onDropdownVisibleChange={(open) => open && fetchProjects()}
                  value={projectName || undefined}
                  onChange={(v) => setProjectName(v ?? '')}
                  style={{ minWidth: 280 }}
                  options={[
                    ...projectOptions.map((p) => ({ label: p, value: p })),
                    ...(projectName && !projectOptions.includes(projectName) ? [{ label: projectName, value: projectName }] : []),
                  ]}
                />
              </Tooltip>
              <Text type="secondary">出库单号（选填）：</Text>
              <Input
                placeholder="留空自动生成，如 CK20250301001"
                value={refNo}
                onChange={(e) => setRefNo(e.target.value)}
                style={{ width: 200 }}
              />
            </Space>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', lineHeight: 1.5 }}>
              提示：关联项目为出库单必填项；未选择时无法提交。可点开下拉搜索已有项目，或直接输入新项目名。
            </Text>
          </div>
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            pagination={false}
            dataSource={orderItems}
            columns={[
              {
                title: '需求',
                key: 'demand',
                width: 100,
                ellipsis: true,
                render: (_: unknown, row: OrderLine) => row.demandText || '—',
              },
              {
                title: '货物名称',
                key: 'goods_name',
                width: 180,
                render: (_: unknown, row: OrderLine, idx: number) => {
                  if (row.inventory_id <= 0) {
                    return (
                      <Select
                        placeholder="选择库存"
                        showSearch
                        optionFilterProp="label"
                        filterOption={false}
                        onSearch={onInventorySearch}
                        style={{ width: '100%' }}
                        value={null}
                        options={inventoryList.map((inv) => ({
                          label: `${inv.goods_name} ${inv.brand ? ` ${inv.brand}` : ''} ${inv.warehouse ? ` @ ${inv.warehouse}` : ''} 库存:${inv.quantity ?? 0}`,
                          value: inv.id,
                        }))}
                        onChange={(id) => {
                          const inv = inventoryList.find((i) => i.id === id)
                          if (inv) updateOrderItem(idx, { inventory_id: inv.id, inventory: inv })
                        }}
                      />
                    )
                  }
                  return row.inventory?.goods_name ?? getInventoryById(row.inventory_id)?.goods_name ?? '—'
                },
              },
              {
                title: '品牌',
                key: 'brand',
                width: 80,
                render: (_: unknown, row: OrderLine) =>
                  row.inventory?.brand ?? getInventoryById(row.inventory_id)?.brand ?? '—',
              },
              {
                title: '型号',
                key: 'model',
                width: 80,
                render: (_: unknown, row: OrderLine) =>
                  row.inventory?.model ?? getInventoryById(row.inventory_id)?.model ?? '—',
              },
              {
                title: '参数',
                key: 'params',
                width: 90,
                ellipsis: true,
                render: (_: unknown, row: OrderLine) =>
                  row.inventory?.params ?? getInventoryById(row.inventory_id)?.params ?? '—',
              },
              {
                title: '库存数量',
                key: 'stockQty',
                width: 88,
                align: 'right',
                render: (_: unknown, row: OrderLine) => {
                  const inv = row.inventory ?? getInventoryById(row.inventory_id)
                  return inv?.quantity != null ? Number(inv.quantity) : '—'
                },
              },
              {
                title: '出库数量',
                key: 'quantity',
                width: 100,
                render: (_: unknown, row: OrderLine, idx: number) => {
                  const inv = row.inventory ?? getInventoryById(row.inventory_id)
                  const stockQty = inv?.quantity != null ? Number(inv.quantity) : 0
                  return (
                    <InputNumber
                      min={1}
                      max={stockQty > 0 ? stockQty : undefined}
                      step={1}
                      precision={0}
                      value={row.quantity}
                      onChange={(v) => {
                        const n = v != null ? Math.floor(Number(v)) : 0
                        const capped = stockQty > 0 ? Math.min(n, stockQty) : n
                        updateOrderItem(idx, { quantity: capped })
                      }}
                      style={{ width: '100%' }}
                    />
                  )
                },
              },
              {
                title: '单位',
                key: 'unit',
                width: 56,
                render: (_: unknown, row: OrderLine) =>
                  row.inventory?.unit ?? getInventoryById(row.inventory_id)?.unit ?? '—',
              },
              {
                title: '仓库',
                key: 'warehouse',
                width: 80,
                render: (_: unknown, row: OrderLine) =>
                  row.inventory?.warehouse ?? getInventoryById(row.inventory_id)?.warehouse ?? '—',
              },
              {
                title: '备注',
                key: 'remark',
                width: 90,
                render: (_: unknown, row: OrderLine, idx: number) => (
                  <Input
                    value={row.remark ?? ''}
                    onChange={(e) => updateOrderItem(idx, { remark: e.target.value })}
                    placeholder="选填"
                    size="small"
                  />
                ),
              },
              {
                title: '操作',
                key: 'action',
                width: 70,
                render: (_: unknown, __: OrderLine, idx: number) => (
                  <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeOrderItem(idx)} />
                ),
              },
            ]}
          />
          {orderItems.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              末尾空行将在提交时自动忽略；出库数量不可超过库存数量。
            </Text>
          )}
          <Space>
            <Button type="dashed" onClick={addOrderRow} icon={<PlusOutlined />}>
              添加一行
            </Button>
            <Button type="primary" loading={submitLoading} onClick={handleSubmitOrder} disabled={!orderItems.some((r) => r.inventory_id > 0 && r.quantity > 0)}>
              提交出库
            </Button>
          </Space>
        </Space>
      </Card>

      <Card title="出库记录" className="section-card section-card-accent-blue">
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
        <Table<StockOutOrderSummary>
          rowKey="ref_no"
          size="small"
          loading={loading}
          columns={orderColumns}
          dataSource={orderList}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 单` }}
          locale={{ emptyText: '暂无出库记录' }}
        />
      </Card>
    </div>
  )
}

export default InventoryStockOutPage
