/**
 * 功能名称：智能配单（自动配置）
 * 实现原理与逻辑：上传清单文件（如 Excel）后，通过规则或向量匹配解析表头与行数据，生成可编辑的配单表格；用户可修正后保存为配单或商品。
 * 支持拖拽上传、表头映射确认、模板记忆。可选接入向量匹配 API 做智能列映射。保存时写入配单或项目商品。
 */
import { SaveOutlined, UploadOutlined, InboxOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { App, AutoComplete, Button, Card, Input, InputNumber, Select, Table, Typography } from 'antd'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import axios from 'axios'
import type { Product } from './Products'
import styles from './AutoConfig.module.css'

const { Text } = Typography

/** 内置列 key 顺序（与后端 formTemplates 一致） */
const BUILTIN_COLUMN_KEYS = [
  'sequence_no', 'goods_name', 'brand', 'model', 'params', 'unit', 'quantity',
  'unit_price_excl_tax', 'unit_price_incl_tax', 'amount_excl_tax', 'amount_incl_tax', 'tax_rate', 'remark',
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
  'unit_price_incl_tax': '单价(含税)',
  amount_excl_tax: '不含税金额',
  amount_incl_tax: '金额(含税)',
  tax_rate: '税率',
  remark: '备注',
}

/** 上传解析返回的表头映射，用于展示来源与「确认加入规则」 */
export type HeaderMappingItem = { header: string; columnKey: string; source: 'rule' | 'vector' }

const NUMERIC_KEYS = new Set([
  'sequence_no', 'quantity', 'unit_price_excl_tax', 'unit_price_incl_tax', 'amount_excl_tax', 'amount_incl_tax', 'tax_rate',
])

/** 与表单列对应的单条清单项 */
export type FormListItem = {
  sequence_no?: number | null
  goods_name?: string | null
  brand?: string | null
  model?: string | null
  params?: string | null
  unit?: string | null
  quantity?: number | null
  unit_price_excl_tax?: number | null
  unit_price_incl_tax?: number | null
  amount_excl_tax?: number | null
  amount_incl_tax?: number | null
  tax_rate?: number | null
  remark?: string | null
}

/** 带 key 的表格行，用于可编辑表格 */
type FormListRow = FormListItem & { _key: string }

const AutoConfigPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { user } = useAuth()
  const [formList, setFormList] = useState<FormListRow[]>([])
  const [orderNameForSave, setOrderNameForSave] = useState('')
  const [projectNameForSave, setProjectNameForSave] = useState('')
  const [saveLoading, setSaveLoading] = useState(false)
  const [defaultTemplate, setDefaultTemplate] = useState<{ columnKeys: string[]; rows?: Record<string, unknown>[] } | null>(null)
  const [sessionTemplate, setSessionTemplate] = useState<{ columnKeys: string[] } | null>(null)
  const [, setHeaderMapping] = useState<HeaderMappingItem[] | null>(null)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [goodsSearchResults, setGoodsSearchResults] = useState<Product[]>([])
  const [goodsSearchLoading, setGoodsSearchLoading] = useState(false)
  const [goodsSearchActiveRowKey, setGoodsSearchActiveRowKey] = useState<string | null>(null)
  const [referenceProjectNames, setReferenceProjectNames] = useState<string[]>([])
  const [projectOptions, setProjectOptions] = useState<{ label: string; value: string }[]>([])
  const [applyRefLoading, setApplyRefLoading] = useState(false)
  const goodsSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const defaultTemplateInputRef = useRef<HTMLInputElement>(null)
  const uploadZoneInputRef = useRef<HTMLInputElement>(null)
  const token = user?.token

  const currentColumnKeys = useMemo(() => {
    const fromSession = sessionTemplate?.columnKeys
    const fromDefault = defaultTemplate?.columnKeys
    if (fromSession?.length) return fromSession
    if (fromDefault?.length) return fromDefault
    return [...BUILTIN_COLUMN_KEYS]
  }, [sessionTemplate, defaultTemplate])

  const fetchDefaultTemplate = useCallback(async () => {
    try {
      const res = await axios.get<{ columnKeys: string[]; rows?: Record<string, unknown>[] }>('/api/form-templates/default')
      setDefaultTemplate({ columnKeys: res.data.columnKeys || [], rows: res.data.rows || [] })
    } catch {
      setDefaultTemplate(null)
    }
  }, [])

  useEffect(() => {
    fetchDefaultTemplate()
  }, [fetchDefaultTemplate])

  const fetchProjectOptions = useCallback(async () => {
    try {
      const res = await axios.get<{ list: { project_name: string; product_count: number | null }[] }>('/api/projects')
      const list = res.data?.list ?? []
      setProjectOptions(
        list.map((p) => ({
          label: `${p.project_name}（${p.product_count == null ? '—' : p.product_count}）`,
          value: p.project_name,
        })),
      )
    } catch {
      setProjectOptions([])
    }
  }, [])

  useEffect(() => {
    fetchProjectOptions()
  }, [fetchProjectOptions])

  const applyReferenceProjects = useCallback(async () => {
    if (referenceProjectNames.length === 0) {
      msg.warning('请先选择参考项目')
      return
    }
    if (formList.length === 0) {
      msg.warning('请先加载配单清单')
      return
    }
    setApplyRefLoading(true)
    try {
      const combinedProducts: Product[] = []
      for (const projectName of referenceProjectNames) {
        const res = await axios.get<{ list: Product[] }>('/api/products', {
          params: { project_name: projectName },
        })
        combinedProducts.push(...(res.data?.list ?? []))
      }
      const normalize = (s: string | null | undefined) => (s ?? '').toString().trim()
      const remaining = [...combinedProducts]
      setFormList((prev) =>
        prev.map((row) => {
          const rowName = normalize(row.goods_name)
          if (!rowName) return row
          const idx = remaining.findIndex((p) => {
            const pName = normalize(p.goods_name)
            return pName && (pName === rowName || pName.includes(rowName) || rowName.includes(pName))
          })
          if (idx < 0) return row
          const product = remaining[idx]
          remaining.splice(idx, 1)
          return {
            ...row,
            goods_name: product.goods_name ?? row.goods_name,
            brand: product.brand ?? row.brand,
            model: product.model ?? row.model,
            params: product.params ?? row.params,
            unit: product.unit ?? row.unit,
            quantity: product.quantity ?? row.quantity,
            unit_price_excl_tax: product.unit_price_excl_tax ?? row.unit_price_excl_tax,
            unit_price_incl_tax: product.unit_price_incl_tax ?? row.unit_price_incl_tax,
            amount_excl_tax: product.amount_excl_tax ?? row.amount_excl_tax,
            amount_incl_tax: product.amount_incl_tax ?? row.amount_incl_tax,
            tax_rate: product.tax_rate ?? row.tax_rate,
            remark: product.remark ?? row.remark,
          }
        }),
      )
      msg.success('已按参考项目顺序应用匹配商品')
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '应用失败')
    } finally {
      setApplyRefLoading(false)
    }
  }, [referenceProjectNames, formList.length, msg])

  const handleUploadDefaultTemplate = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setTemplateLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await axios.post('/api/form-templates/default', formData, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      msg.success('默认模板已更新')
      await fetchDefaultTemplate()
    } catch (err: unknown) {
      msg.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || '上传失败')
    } finally {
      setTemplateLoading(false)
    }
  }, [fetchDefaultTemplate, msg, token])

  const handleUploadUseTemplate = useCallback(
    async (file: File) => {
      if (!file) return
      setTemplateLoading(true)
      setStreamingText('')
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/form-templates/parse-file-stream', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error((err as { message?: string }).message || `请求失败 ${res.status}`)
        }
        const reader = res.body?.getReader()
        if (!reader) throw new Error('无法读取响应流')
        const decoder = new TextDecoder()
        let buffer = ''
        let columnKeys: string[] = []
        let rows: Record<string, unknown>[] = []
        const handleEvent = (eventType: string, dataStr: string) => {
          if (eventType === 'chunk') {
            try {
              const delta = JSON.parse(dataStr) as string
              setStreamingText((prev) => prev + delta)
            } catch {
              // ignore
            }
          } else if (eventType === 'done') {
            try {
              const data = JSON.parse(dataStr) as {
                columnKeys?: string[]
                rows?: Record<string, unknown>[]
                headerMapping?: HeaderMappingItem[]
              }
              columnKeys = data.columnKeys || []
              rows = data.rows || []
              setHeaderMapping(Array.isArray(data.headerMapping) ? data.headerMapping : null)
            } catch {
              // ignore
            }
          } else if (eventType === 'error') {
            try {
              const data = JSON.parse(dataStr) as { message?: string }
              msg.error(data.message || '解析失败')
            } catch {
              msg.error('解析失败')
            }
          }
        }
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          for (const part of parts) {
            let eventType = ''
            let dataStr = ''
            for (const line of part.split('\n')) {
              if (line.startsWith('event: ')) eventType = line.slice(7).trim()
              else if (line.startsWith('data: ')) dataStr = line.slice(6)
            }
            if (eventType && dataStr) handleEvent(eventType, dataStr)
          }
        }
        setSessionTemplate({ columnKeys })
        setFormList(rows.map((row, i) => ({ ...row, _key: `upload-${Date.now()}-${i}` })) as FormListRow[])
        msg.success(rows.length ? `已加载模板与 ${rows.length} 条数据` : '已应用模板，可编辑后保存')
        if (!Array.isArray(columnKeys) || columnKeys.length === 0) setHeaderMapping(null)
      } catch (err: unknown) {
        msg.error((err as Error)?.message || '解析失败')
      } finally {
        setTemplateLoading(false)
        setStreamingText('')
      }
    },
    [msg, token],
  )

  const handleUseDefaultTemplate = useCallback(async () => {
    setTemplateLoading(true)
    try {
      const res = await axios.get<{ columnKeys: string[]; rows?: Record<string, unknown>[] }>('/api/form-templates/default')
      setSessionTemplate(null)
      setHeaderMapping(null)
      setDefaultTemplate({ columnKeys: res.data.columnKeys || [], rows: res.data.rows || [] })
      const rows = res.data.rows || []
      setFormList(rows.map((r, i) => ({ ...r, _key: `default-${Date.now()}-${i}` })) as FormListRow[])
      msg.success(rows.length ? `已加载默认模板与 ${rows.length} 条数据` : '已切换为默认模板')
    } catch {
      setSessionTemplate(null)
      setFormList([])
      setHeaderMapping(null)
      msg.success('已切换为默认模板')
    } finally {
      setTemplateLoading(false)
    }
  }, [msg])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file && /\.(xlsx|xls|csv)$/i.test(file.name)) handleUploadUseTemplate(file)
      else if (file) msg.warning('请上传 Excel(.xlsx/.xls) 或 CSV 文件')
    },
    [handleUploadUseTemplate, msg],
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const updateFormRow = useCallback((index: number, field: keyof FormListItem, value: unknown) => {
    setFormList((prev) => {
      const next = [...prev]
      if (!next[index]) return next
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }, [])

  const deleteFormRow = useCallback((key: string) => {
    setFormList((prev) => prev.filter((row) => row._key !== key))
  }, [])

  const fetchGoodsSearch = useCallback((keyword: string, rowKey: string) => {
    setGoodsSearchActiveRowKey(rowKey)
    if (keyword.trim().length < 2) {
      setGoodsSearchResults([])
      return
    }
    setGoodsSearchLoading(true)
    axios
      .get<{ list: Product[]; total: number }>('/api/products', { params: { keyword: keyword.trim() } })
      .then((res) => setGoodsSearchResults(res.data.list || []))
      .catch(() => setGoodsSearchResults([]))
      .finally(() => setGoodsSearchLoading(false))
  }, [])

  const onGoodsNameSearch = useCallback(
    (value: string, rowKey: string) => {
      if (goodsSearchDebounceRef.current) {
        clearTimeout(goodsSearchDebounceRef.current)
        goodsSearchDebounceRef.current = null
      }
      setGoodsSearchActiveRowKey(rowKey)
      if ((value ?? '').toString().trim().length < 2) {
        setGoodsSearchResults([])
        return
      }
      goodsSearchDebounceRef.current = setTimeout(() => {
        fetchGoodsSearch((value ?? '').toString().trim(), rowKey)
      }, 300)
    },
    [fetchGoodsSearch],
  )

  const fillRowWithProduct = useCallback((rowKey: string, product: Product) => {
    setFormList((prev) =>
      prev.map((row) =>
        row._key !== rowKey
          ? row
          : {
              ...row,
              goods_name: product.goods_name ?? row.goods_name,
              brand: product.brand ?? row.brand,
              model: product.model ?? row.model,
              params: product.params ?? row.params,
              unit: product.unit ?? row.unit,
              quantity: product.quantity ?? row.quantity,
              unit_price_excl_tax: product.unit_price_excl_tax ?? row.unit_price_excl_tax,
              unit_price_incl_tax: product.unit_price_incl_tax ?? row.unit_price_incl_tax,
              amount_excl_tax: product.amount_excl_tax ?? row.amount_excl_tax,
              amount_incl_tax: product.amount_incl_tax ?? row.amount_incl_tax,
              tax_rate: product.tax_rate ?? row.tax_rate,
              remark: product.remark ?? row.remark,
            },
      ),
    )
    setGoodsSearchResults([])
    msg.success('已填入本行')
  }, [msg])

  /** 货物名称失焦时：若该行税率为空且当前有匹配到的商品，用第一个匹配商品的税率自动填充 */
  const autoFillTaxRateFromFirstMatch = useCallback(
    (rowKey: string) => {
      if (goodsSearchActiveRowKey !== rowKey || !goodsSearchResults.length) return
      const first = goodsSearchResults[0]
      if (first.tax_rate == null) return
      setFormList((prev) => {
        const row = prev.find((r) => r._key === rowKey)
        if (!row || row.tax_rate != null) return prev
        return prev.map((r) => (r._key !== rowKey ? r : { ...r, tax_rate: first.tax_rate }))
      })
      msg.success('已根据匹配商品填充税率')
    },
    [goodsSearchActiveRowKey, goodsSearchResults, msg],
  )

  const saveFormList = useCallback(async () => {
    const projectName = projectNameForSave.trim()
    if (!projectName) {
      msg.error('请填写项目名称')
      return
    }
    if (formList.length === 0) {
      msg.warning('请先加载或填写配单清单后再保存')
      return
    }
    setSaveLoading(true)
    try {
      const items = formList.map(({ _key, ...rest }) => rest)
      const name = orderNameForSave.trim() || projectName
      const res = await axios.post<{ overwrote?: boolean; history_version?: number }>('/api/config-orders/save-by-project', {
        name,
        project_name: projectName,
        items,
      })
      if (res.data?.overwrote) {
        msg.success(`已覆盖该项目配单并存入历史版本 v${res.data.history_version ?? ''}，共 ${items.length} 条`)
      } else {
        msg.success(`已保存到配单库，共 ${items.length} 条`)
      }
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setSaveLoading(false)
    }
  }, [formList, orderNameForSave, projectNameForSave, msg])

  const formColumns: ColumnsType<FormListRow> = useMemo(() => {
    const keyToCol = (key: string) => {
      const title = COLUMN_TITLES[key] ?? key
      const isNum = NUMERIC_KEYS.has(key)
      const width =
        key === 'goods_name'
          ? 140
          : key === 'params'
            ? 220
            : key === 'remark'
              ? 100
              : isNum
                ? key === 'quantity' || key === 'sequence_no'
                  ? 80
                  : 100
                : 90
      if (key === 'goods_name') {
        return {
          title,
          dataIndex: key,
          width,
          render: (v: unknown, record: FormListRow, index: number) => {
            const isActive = goodsSearchActiveRowKey === record._key
            const options = isActive
              ? goodsSearchResults.map((p) => ({
                  value: String(p.id),
                  label: [p.goods_name, p.project_name, p.model].filter(Boolean).join(' · ') || p.goods_name,
                }))
              : []
            const currentVal = (v as string) ?? ''
            const hasEnoughChars = currentVal.trim().length >= 2
            return (
              <AutoComplete
                size="small"
                className={styles.tableInput}
                value={currentVal}
                options={options}
                onFocus={() => {
                  setGoodsSearchActiveRowKey(record._key)
                  if (hasEnoughChars) fetchGoodsSearch(currentVal.trim(), record._key)
                }}
                onBlur={() => {
                  setTimeout(() => autoFillTaxRateFromFirstMatch(record._key), 150)
                }}
                onSearch={(val) => onGoodsNameSearch(val, record._key)}
                onChange={(val) => updateFormRow(index, 'goods_name', val)}
                onSelect={(val) => {
                  const product = goodsSearchResults.find((p) => p.id === Number(val))
                  if (product) fillRowWithProduct(record._key, product)
                }}
                placeholder="输入 2 字以上自动搜商品库"
                notFoundContent={
                  goodsSearchLoading ? '搜索中…' : hasEnoughChars ? '无匹配' : '输入至少 2 字自动搜索'
                }
              />
            )
          },
        }
      }
      if (key === 'params') {
        return {
          title,
          dataIndex: key,
          width,
          render: (v: unknown, _r: FormListRow, index: number) => (
            <Input.TextArea
              size="small"
              className={styles.tableTextArea}
              value={(v as string) ?? ''}
              onChange={(e) => updateFormRow(index, 'params', e.target.value)}
              placeholder="—"
              rows={2}
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          ),
        }
      }
      return {
        title,
        dataIndex: key,
        width,
        align: (isNum ? 'right' : undefined) as 'right' | undefined,
        render: (v: unknown, _r: FormListRow, index: number) =>
          isNum ? (
            <InputNumber
              size="small"
              className={styles.tableInput}
              value={v as number | undefined}
              onChange={(val) => updateFormRow(index, key as keyof FormListItem, val)}
              placeholder="—"
              min={key !== 'sequence_no' ? 0 : undefined}
            />
          ) : (
            <Input
              size="small"
              className={styles.tableInput}
              value={(v as string) ?? ''}
              onChange={(e) => updateFormRow(index, key as keyof FormListItem, e.target.value)}
              placeholder="—"
            />
          ),
      }
    }
    const actionCol: ColumnsType<FormListRow>[number] = {
      title: '操作',
      key: '_action',
      width: 72,
      fixed: 'right',
      render: (_: unknown, record: FormListRow) => (
        <Button
          type="link"
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => deleteFormRow(record._key)}
          title="删除本行"
        />
      ),
    }
    return [...currentColumnKeys.map(keyToCol), actionCol]
  }, [
    currentColumnKeys,
    updateFormRow,
    deleteFormRow,
    onGoodsNameSearch,
    fetchGoodsSearch,
    fillRowWithProduct,
    autoFillTaxRateFromFirstMatch,
    goodsSearchActiveRowKey,
    goodsSearchResults,
    goodsSearchLoading,
  ])

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <Text type="secondary" className={styles.desc}>
          上传 Excel 或 CSV 文件，由 AI 解析表头与数据生成配单清单；可编辑后保存到配单库。支持拖拽到下方区域或点击选择文件。
        </Text>
      </div>

      <Card className={styles.uploadCard}>
        <input
          ref={uploadZoneInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleUploadUseTemplate(f)
            e.target.value = ''
          }}
        />
        <div
          className={`${styles.uploadZone} ${dragOver ? styles.uploadZoneDragOver : ''} ${templateLoading ? styles.uploadZoneLoading : ''}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => uploadZoneInputRef.current?.click()}
        >
          <InboxOutlined className={styles.uploadZoneIcon} />
          <div className={styles.uploadZoneText}>
            {templateLoading
              ? (streamingText ? 'AI 正在解析…' : '正在解析…')
              : '将 Excel 或 CSV 拖入此处，或点击选择文件'}
          </div>
          {templateLoading && streamingText && (
            <pre className={styles.streamingPreview}>{streamingText.slice(-500)}</pre>
          )}
          <Text type="secondary" className={styles.uploadZoneHint}>
            AI 解析表头与数据生成配单清单...
          </Text>
        </div>
      </Card>

      {/* 表头映射：已注释
      {headerMapping && headerMapping.length > 0 && (
        <Card size="small" title="表头映射" className={styles.listCard} style={{ marginTop: 16 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            若某列匹配正确，可点击「确认加入规则」写入规则库，后续上传将优先按规则匹配，提高准确率。
          </Text>
          <Space size={[8, 8]} wrap>
            {headerMapping.map((item, idx) => (
              <Tag key={idx} color={item.source === 'vector' ? 'blue' : 'green'}>
                {item.header} → {COLUMN_TITLES[item.columnKey] ?? item.columnKey}
                <span style={{ marginLeft: 4, color: '#999' }}>({item.source === 'vector' ? '向量' : '规则'})</span>
                <Button
                  type="link"
                  size="small"
                  style={{ padding: '0 4px', height: 'auto' }}
                  onClick={() => confirmHeaderRule(item)}
                >
                  确认加入规则
                </Button>
              </Tag>
            ))}
          </Space>
        </Card>
      )}
      */}

      <Card title="配单清单" className={styles.listCard}>
        <div className={styles.listToolbar}>
          <input
            ref={defaultTemplateInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleUploadDefaultTemplate}
          />
          <Button
            icon={<UploadOutlined />}
            loading={templateLoading}
            onClick={() => defaultTemplateInputRef.current?.click()}
          >
            上传默认模板
          </Button>
          <Button onClick={handleUseDefaultTemplate} loading={templateLoading}>
            使用默认模板
          </Button>
          <Button
            icon={<DeleteOutlined />}
            onClick={() => {
              setFormList([])
              msg.success('已清空当前表格')
            }}
            disabled={formList.length === 0}
          >
            清空当前表格
          </Button>
          {sessionTemplate && (
            <Button type="link" size="small" onClick={() => setSessionTemplate(null)}>
              清除本次模板
            </Button>
          )}
          <Select
            mode="multiple"
            placeholder="参考项目（多选，按顺序匹配）"
            value={referenceProjectNames}
            onChange={setReferenceProjectNames}
            options={projectOptions}
            style={{ minWidth: 260 }}
            maxTagCount="responsive"
            allowClear
          />
          <Button
            type="default"
            onClick={applyReferenceProjects}
            loading={applyRefLoading}
            disabled={referenceProjectNames.length === 0 || formList.length === 0}
          >
            应用参考项目
          </Button>
        </div>
        <div className={styles.tableScrollWrap}>
          <Table<FormListRow>
            size="small"
            rowKey="_key"
            dataSource={formList}
            columns={formColumns}
            pagination={false}
            scroll={{ x: 1400 }}
            className={styles.editableTable}
            locale={{ emptyText: '请在上方上传文件加载清单，或点击「使用默认模板」加载已保存的模板数据。' }}
          />
        </div>
        <div className={styles.listFooter}>
          <Input
            placeholder="配单名称（不填则使用项目名称）"
            value={orderNameForSave}
            onChange={(e) => setOrderNameForSave(e.target.value)}
            style={{ width: 240 }}
            allowClear
          />
          <Input
            placeholder="项目名称（必填）"
            value={projectNameForSave}
            onChange={(e) => {
              const v = e.target.value
              setProjectNameForSave(v)
              if (!orderNameForSave.trim()) setOrderNameForSave(v)
            }}
            style={{ width: 200 }}
            allowClear
          />
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={saveFormList}
            loading={saveLoading}
            disabled={formList.length === 0}
          >
            保存到配单库
          </Button>
        </div>
      </Card>
    </div>
  )
}

export default AutoConfigPage
