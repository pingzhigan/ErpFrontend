/**
 * 功能名称：库存维护（文档导入）
 * 实现原理与逻辑：上传 Excel 等文档后调用解析接口，将解析结果以表格形式展示并可编辑；支持按 SKU/仓库校验冲突，
 * 冲突时弹窗确认覆盖或跳过；确认后批量写入/更新库存。适用于从表格或文档批量维护库存数据。
 */
import { DownloadOutlined, EyeOutlined, InboxOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { UploadFile } from 'antd'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../auth/AuthContext'
import styles from './InventoryMaintain.module.css'

const { Text } = Typography

/** 解析结果中的一条（与文档解析接口返回结构一致；条码与 sku 二选一必填） */
type ParsedRow = {
  sku?: string | null
  条码?: string | null
  goods_name?: string | null
  brand?: string | null
  model?: string | null
  params?: string | null
  unit?: string | null
  quantity?: number | null
  stock_quantity?: number | null
  unit_price?: number | null
  remark?: string | null
  warehouse?: string | null
  project_name?: string | null
}

/** 带 _key 的表格行 */
type RowWithKey = ParsedRow & { _key: string }

type SkuConflict = { sku: string; warehouse: string | null; goods_name: string; existing_quantity: number; item_index: number }

type MaintainBatchRow = {
  id: number
  item_count: number
  on_duplicate_sku: string | null
  created_at: string
  created_by: string | null
  applied_at: string | null
  audit: {
    audit_status: string
    audit_outcome: string | null
    dingtalk_process_instance_id: string | null
  }
}

function batchStatusText(r: MaintainBatchRow): string {
  if (r.applied_at) return '已写入库存'
  if (r.audit?.audit_status === 'draft') return '草稿'
  if (r.audit?.audit_status === 'approving') return '审批中'
  if (r.audit?.audit_status === 'completed' && r.audit?.audit_outcome === 'approved') return '已通过（待同步）'
  if (r.audit?.audit_status === 'completed' && r.audit?.audit_outcome === 'rejected') return '已拒绝'
  return r.audit?.audit_status ?? '—'
}

/** 取 SKU（支持 sku 或 条码） */
function getSku(row: ParsedRow): string | null {
  const s = row.sku != null ? String(row.sku).trim() || null : null
  if (s) return s
  const b = row.条码 != null ? String(row.条码).trim() || null : null
  return b
}

/** 将解析结果转为库存入库格式（必填：SKU/条码、品牌、型号、数量）；金额=单价×数量由系统计算 */
function toInventoryItem(row: ParsedRow): Record<string, unknown> {
  const qty = row.quantity != null ? Number(row.quantity) : (row.stock_quantity != null ? Number(row.stock_quantity) : null)
  return {
    sku: getSku(row),
    goods_name: (row.goods_name != null && String(row.goods_name).trim()) ? String(row.goods_name).trim() : '',
    brand: row.brand != null ? String(row.brand).trim() || null : null,
    model: row.model != null ? String(row.model).trim() || null : null,
    params: row.params != null ? String(row.params).trim() || null : null,
    unit: row.unit != null ? String(row.unit).trim() || null : null,
    quantity: qty,
    unit_price: row.unit_price != null ? Number(row.unit_price) : null,
    warehouse: row.warehouse != null ? String(row.warehouse).trim() || null : null,
    project_name: row.project_name != null ? String(row.project_name).trim() || null : null,
    remark: row.remark != null ? String(row.remark).trim() || null : null,
  }
}

const InventoryMaintainPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { user } = useAuth()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [parseLoading, setParseLoading] = useState(false)
  const [parseStatus, setParseStatus] = useState<string>('')
  const [saveLoading, setSaveLoading] = useState(false)
  const [list, setList] = useState<RowWithKey[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [skuConflictModal, setSkuConflictModal] = useState<{
    visible: boolean
    conflicts: SkuConflict[]
    payload: { items: Record<string, unknown>[] }
    onSuccess?: () => void
  }>({ visible: false, conflicts: [], payload: { items: [] } })
  const [recordsModalOpen, setRecordsModalOpen] = useState(false)
  const [recordsList, setRecordsList] = useState<{ filename: string; saved_at: string; saved_by: string | null; item_count: number; size: number }[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [previewFilename, setPreviewFilename] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [maintainGate, setMaintainGate] = useState<boolean | null>(null)
  const [batches, setBatches] = useState<MaintainBatchRow[]>([])
  const [batchesLoading, setBatchesLoading] = useState(false)

  const fetchMaintainGate = useCallback(async () => {
    try {
      const res = await axios.get<{ dingtalk_gate: boolean }>('/api/inventory-maintain/gate')
      setMaintainGate(!!res.data?.dingtalk_gate)
    } catch {
      setMaintainGate(false)
    }
  }, [])

  const fetchBatches = useCallback(async () => {
    setBatchesLoading(true)
    try {
      const res = await axios.get<{ list: MaintainBatchRow[] }>('/api/inventory-maintain/batches')
      setBatches(res.data?.list ?? [])
    } catch {
      setBatches([])
    } finally {
      setBatchesLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchMaintainGate()
  }, [fetchMaintainGate])

  useEffect(() => {
    if (maintainGate) void fetchBatches()
  }, [maintainGate, fetchBatches])

  const listWithKeys = useMemo(() => list.map((row, i) => ({ ...row, _key: (row as RowWithKey)._key ?? `row-${i}` })), [list])

  const setRow = (index: number, field: keyof ParsedRow, value: unknown) => {
    setList((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) setFileList([{ uid: '-', name: f.name, status: 'done', originFileObj: f as any }])
  }
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true) }
  const onDragLeave = () => setDragOver(false)

  /** 导出 Excel 模板（.xlsx），由后端生成，填写后上传即为 Excel 格式，规则解析更稳定 */
  const exportTemplate = async () => {
    try {
      const res = await fetch('/api/inventory/template', {
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {},
      })
      if (!res.ok) throw new Error(res.statusText)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = '库存导入模板.xlsx'
      a.click()
      URL.revokeObjectURL(url)
      msg.success('已下载 Excel 模板，填写后上传即可')
    } catch (e: any) {
      msg.error(e?.message || '下载模板失败')
    }
  }

  const handleUpload = async () => {
    if (!fileList.length) {
      msg.warning('请先选择要上传的 Excel、CSV 或图片')
      return
    }
    const file = fileList[0].originFileObj as File
    setParseLoading(true)
    setParseStatus('')
    const formData = new FormData()
    formData.append('file', file)
    const token = user?.token

    try {
      const res = await fetch('/api/inventory/parse-stream', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      })
      const contentType = res.headers.get('Content-Type') ?? ''

      if (!res.ok && !contentType.includes('text/event-stream')) {
        const errData = await res.json().catch(() => ({}))
        msg.error(errData?.message || '解析失败')
        return
      }

      if (contentType.includes('application/json')) {
        const data = await res.json()
        const rawList = data?.list ?? []
        const items: RowWithKey[] = rawList.map((item: ParsedRow, i: number) => ({
          ...item,
          _key: `parse-${Date.now()}-${i}`,
        }))
        setList(items)
        setParseStatus('规则解析')
        msg.success(`规则解析成功，共 ${items.length} 条，请核对后保存`)
        return
      }

      if (contentType.includes('text/event-stream')) {
        setParseStatus('AI 解析中…')
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let listFromStream: ParsedRow[] = []
        let currentEvent = ''

        const processLine = (line: string) => {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
            return
          }
          if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6))
              if (currentEvent === 'chunk' && payload.chunk) {
                setParseStatus((s) => s + (payload.chunk || ''))
              }
              if (currentEvent === 'result' && payload.list) {
                listFromStream = payload.list ?? []
              }
              if (currentEvent === 'error' && payload.message) {
                msg.error(payload.message)
              }
            } catch (_) {
              /* skip */
            }
          }
        }

        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const parts = buffer.split('\n\n')
            buffer = parts.pop() ?? ''
            for (const block of parts) {
              for (const line of block.split('\n')) {
                processLine(line)
              }
            }
          }
          for (const line of buffer.split('\n')) {
            processLine(line)
          }
        }

        if (listFromStream.length > 0) {
          const items: RowWithKey[] = listFromStream.map((item: ParsedRow, i: number) => ({
            ...item,
            _key: `parse-${Date.now()}-${i}`,
          }))
          setList(items)
          setParseStatus('')
          msg.success(`AI 解析完成，共 ${items.length} 条，请核对后保存`)
        }
        return
      }

      const errData = await res.json().catch(() => ({}))
      msg.error(errData?.message || '解析失败')
    } catch (e: any) {
      msg.error(e?.message || '解析失败')
    } finally {
      setParseLoading(false)
      setParseStatus('')
    }
  }

  const saveMaintainRecord = (items: Record<string, unknown>[]) => {
    if (!items?.length) return
    axios.post('/api/inventory-maintain-records', { items }).catch(() => {})
  }

  /** 门禁开启：创建批次并立即发起钉钉审批（通过后由服务端写入库存） */
  const submitMaintainApproval = async (
    items: Record<string, unknown>[],
    onDup?: 'increment' | 'overwrite',
  ) => {
    const body: { items: Record<string, unknown>[]; on_duplicate_sku?: string } = { items }
    if (onDup) body.on_duplicate_sku = onDup
    const cr = await axios.post<{ id: number }>('/api/inventory-maintain/batches', body)
    const id = cr.data?.id
    if (!id) throw new Error('创建批次失败')
    await axios.post(`/api/inventory-maintain/batches/${id}/dingtalk/submit`)
    msg.success(`已发起钉钉审批（批次 #${id}），通过后自动写入库存`)
    void fetchBatches()
  }

  const submitWithDuplicateMode = async (mode: 'increment' | 'overwrite') => {
    const { payload, onSuccess } = skuConflictModal
    if (!payload?.items?.length) return
    setSaveLoading(true)
    try {
      if (maintainGate) {
        await submitMaintainApproval(payload.items, mode)
      } else {
        await axios.post('/api/inventory/bulk', { ...payload, on_duplicate_sku: mode })
        msg.success(`已保存 ${payload.items.length} 条到库存`)
        saveMaintainRecord(payload.items)
      }
      setSkuConflictModal({ visible: false, conflicts: [], payload: { items: [] } })
      onSuccess?.()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || e?.message || '保存失败')
    } finally {
      setSaveLoading(false)
    }
  }

  const handleSaveToInventory = async () => {
    if (!list.length) {
      msg.warning('请先上传并解析文件')
      return
    }
    const items = listWithKeys.map(({ _key, ...rest }) => toInventoryItem(rest))
    const missingRows: number[] = []
    items.forEach((r, i) => {
      const sku = r.sku != null ? String(r.sku).trim() : ''
      const brand = r.brand != null ? String(r.brand).trim() : ''
      const model = r.model != null ? String(r.model).trim() : ''
      const qty = r.quantity != null ? Number(r.quantity) : null
      if (!sku || !brand || !model || qty == null || Number.isNaN(qty) || qty < 0) {
        missingRows.push(i + 1)
      }
    })
    if (missingRows.length > 0) {
      msg.warning(`第 ${missingRows.join('、')} 行缺少必填项（SKU/条码、品牌、型号、数量），请补全后再保存`)
      return
    }
    setSaveLoading(true)
    try {
      if (maintainGate) {
        await submitMaintainApproval(items)
      } else {
        await axios.post('/api/inventory/bulk', { items })
        msg.success(`已保存 ${items.length} 条到库存`)
        saveMaintainRecord(items)
      }
      setList([])
      setFileList([])
    } catch (e: any) {
      const data = e?.response?.data
      if (e?.response?.status === 409 && data?.code === 'SKU_CONFLICT') {
        setSkuConflictModal({
          visible: true,
          conflicts: data.conflicts ?? [],
          payload: { items },
          onSuccess: () => {
            setList([])
            setFileList([])
          },
        })
      } else if (data?.code === 'INVENTORY_MAINTAIN_APPROVAL_REQUIRED') {
        msg.warning(data?.message || '已启用库存维护审批，请刷新页面后使用「提交审批」流程')
        void fetchMaintainGate()
      } else {
        msg.error(data?.message || e?.message || '保存失败')
      }
    } finally {
      setSaveLoading(false)
    }
  }

  const deleteBatch = async (id: number) => {
    try {
      await axios.delete(`/api/inventory-maintain/batches/${id}`)
      msg.success('已删除批次')
      void fetchBatches()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || e?.message || '删除失败')
    }
  }

  const fetchRecords = async () => {
    setRecordsLoading(true)
    try {
      const res = await axios.get<{ list: { filename: string; saved_at: string; saved_by: string | null; item_count: number; size: number }[] }>('/api/inventory-maintain-records')
      setRecordsList(res.data?.list ?? [])
    } catch {
      setRecordsList([])
    } finally {
      setRecordsLoading(false)
    }
  }

  const openRecordsModal = () => {
    setRecordsModalOpen(true)
    fetchRecords()
  }

  const handlePreviewRecord = async (filename: string) => {
    try {
      const res = await axios.get<Record<string, unknown>>(`/api/inventory-maintain-records/${encodeURIComponent(filename)}`)
      setPreviewFilename(filename)
      setPreviewContent(JSON.stringify(res.data, null, 2))
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '读取失败')
    }
  }

  const handleDownloadRecord = async (filename: string) => {
    try {
      const res = await axios.get<Record<string, unknown>>(`/api/inventory-maintain-records/${encodeURIComponent(filename)}`)
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      msg.success('已下载')
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '下载失败')
    }
  }

  const columns: ColumnsType<RowWithKey> = [
    {
      title: 'SKU/条码',
      dataIndex: 'sku',
      width: 110,
      render: (v: string | null, row, i) => (
        <Input
          size="small"
          value={(v ?? row.条码 ?? '')}
          onChange={(e) => setRow(i, 'sku', e.target.value.trim() || null)}
          placeholder="必填"
        />
      ),
    },
    {
      title: '货物名称',
      dataIndex: 'goods_name',
      width: 140,
      render: (v: string | null, _, i) => (
        <Input
          size="small"
          value={v ?? ''}
          onChange={(e) => setRow(i, 'goods_name', e.target.value || null)}
          placeholder="必填"
        />
      ),
    },
    {
      title: '品牌',
      dataIndex: 'brand',
      width: 90,
      render: (v: string | null, _, i) => (
        <Input size="small" value={v ?? ''} onChange={(e) => setRow(i, 'brand', e.target.value || null)} placeholder="必填" />
      ),
    },
    {
      title: '型号',
      dataIndex: 'model',
      width: 100,
      render: (v: string | null, _, i) => (
        <Input size="small" value={v ?? ''} onChange={(e) => setRow(i, 'model', e.target.value || null)} placeholder="必填" />
      ),
    },
    {
      title: '单位',
      dataIndex: 'unit',
      width: 56,
      render: (v: string | null, _, i) => (
        <Input size="small" value={v ?? ''} onChange={(e) => setRow(i, 'unit', e.target.value || null)} placeholder="—" />
      ),
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      width: 80,
      render: (v: number | null, row, i) => (
        <InputNumber
          size="small"
          min={0}
          value={v ?? row.stock_quantity ?? undefined}
          onChange={(val) => setRow(i, 'quantity', val ?? null)}
          style={{ width: 72 }}
          placeholder="必填"
        />
      ),
    },
    {
      title: '单价',
      dataIndex: 'unit_price',
      width: 90,
      render: (v: number | null, _, i) => (
        <InputNumber
          size="small"
          min={0}
          step={0.01}
          value={v ?? undefined}
          onChange={(val) => setRow(i, 'unit_price', val ?? null)}
          style={{ width: 82 }}
          placeholder="成本单价"
        />
      ),
    },
    {
      title: '成本金额',
      key: 'cost_amount',
      width: 90,
      align: 'right' as const,
      render: (_: unknown, row) => {
        const q = row.quantity != null ? Number(row.quantity) : NaN
        const p = row.unit_price != null ? Number(row.unit_price) : NaN
        if (Number.isNaN(q) || Number.isNaN(p)) return '—'
        return (q * p).toFixed(2)
      },
    },
    {
      title: '仓库/仓位',
      dataIndex: 'warehouse',
      width: 100,
      render: (v: string | null, _, i) => (
        <Input
          size="small"
          value={v ?? ''}
          onChange={(e) => setRow(i, 'warehouse', e.target.value || null)}
          placeholder="—"
        />
      ),
    },
    {
      title: '关联项目',
      dataIndex: 'project_name',
      width: 120,
      render: (v: string | null, _, i) => (
        <Input
          size="small"
          value={v ?? ''}
          onChange={(e) => setRow(i, 'project_name', e.target.value || null)}
          placeholder="项目遗留可填"
        />
      ),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      width: 100,
      render: (v: string | null, _, i) => (
        <Input size="small" value={v ?? ''} onChange={(e) => setRow(i, 'remark', e.target.value || null)} placeholder="—" />
      ),
    },
  ]

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <Text type="secondary" className={styles.desc}>
          上传模板或 Excel、CSV、图片，优先按模板规则解析，失败时使用 AI 流式解析；支持拖拽到下方区域或点击选择文件，审阅后保存到库存。<br />
          如果为批量新增，则直接上传模板，然后点击解析，解析成功后，点击保存到库存。如果为批量修改，解析成功后，会弹出处理冲突方式：<br />
          1. 增量（在现有数量上累加）<br />
          2. 覆盖（用本次数据覆盖该条）<br />
          选择后，保存到库存。
        </Text>
        {maintainGate === true && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message="已启用库存维护钉钉审批"
            description="当前不会直接写入库存：点击「提交审批（通过后入库）」将创建批次并发起钉钉流程，审批通过后系统自动同步至库存并生成维护记录。请在钉钉管理后台配置业务类型 inventory_maintain_submit 的流程模板与表单映射。"
          />
        )}
      </div>

      <Card className={styles.uploadCard}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg,.webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) setFileList([{ uid: '-', name: f.name, status: 'done', originFileObj: f as any }])
            e.target.value = ''
          }}
        />
        <div
          className={`${styles.uploadZone} ${dragOver ? styles.uploadZoneDragOver : ''} ${parseLoading ? styles.uploadZoneLoading : ''}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <InboxOutlined className={styles.uploadZoneIcon} />
          <div className={styles.uploadZoneText}>
            {parseLoading
              ? (parseStatus ? 'AI 正在解析…' : '正在解析…')
              : '将 Excel、CSV 或图片拖入此处，或点击选择文件'}
          </div>
          {parseLoading && parseStatus && (
            <pre className={styles.streamingPreview}>{parseStatus.slice(-500)}</pre>
          )}
          <Text type="secondary" className={styles.uploadZoneHint}>
            推荐使用「导出模板」下载 Excel 填写后上传；必填：SKU/条码、品牌、型号、数量；可填单价，成本金额=单价×数量由系统计算
          </Text>
        </div>
      </Card>

      <Card title="解析结果" className={styles.listCard}>
        <div className={styles.listToolbar}>
          <Button type="default" icon={<DownloadOutlined />} onClick={exportTemplate}>
            导出模板
          </Button>
          <Button type="default" onClick={openRecordsModal}>
            维护记录
          </Button>
          <Button
            icon={<UploadOutlined />}
            onClick={() => fileInputRef.current?.click()}
          >
            选择文件
          </Button>
          {fileList.length > 0 && (
            <Text type="secondary" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fileList[0].name}
            </Text>
          )}
          <Button
            type="primary"
            icon={<UploadOutlined />}
            loading={parseLoading}
            onClick={handleUpload}
            disabled={!fileList.length}
          >
            解析
          </Button>
        </div>
        <div className={styles.tableScrollWrap}>
          <Table<RowWithKey>
            rowKey="_key"
            size="small"
            dataSource={listWithKeys}
            columns={columns}
            scroll={{ x: 960 }}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
            className={styles.editableTable}
            locale={{ emptyText: '请在上方拖入或选择文件后点击「解析」，审阅表格后保存到库存。' }}
          />
        </div>
        <div className={styles.listFooter}>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSaveToInventory}
            loading={saveLoading}
            disabled={list.length === 0}
          >
            {maintainGate ? '提交审批（通过后入库）' : '保存到库存'}
          </Button>
        </div>
        {maintainGate === true && (
          <div style={{ marginTop: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              最近批次（最多 200 条）
            </Text>
            <Table<MaintainBatchRow>
              size="small"
              loading={batchesLoading}
              dataSource={batches}
              rowKey="id"
              pagination={{ pageSize: 8, showSizeChanger: false }}
              locale={{ emptyText: '暂无批次' }}
              columns={[
                { title: '批次', dataIndex: 'id', width: 72 },
                { title: '条数', dataIndex: 'item_count', width: 64, align: 'right' as const },
                {
                  title: '状态',
                  key: 'st',
                  width: 120,
                  render: (_: unknown, r: MaintainBatchRow) => <Tag>{batchStatusText(r)}</Tag>,
                },
                {
                  title: '创建时间',
                  dataIndex: 'created_at',
                  width: 168,
                  render: (v: string) => (v ? v.replace('T', ' ').slice(0, 19) : '—'),
                },
                { title: '操作人', dataIndex: 'created_by', width: 88, render: (v: string | null) => v || '—' },
                {
                  title: '操作',
                  key: 'op',
                  width: 88,
                  render: (_: unknown, r: MaintainBatchRow) => {
                    const canDel =
                      !r.applied_at && r.audit?.audit_status !== 'approving'
                    if (!canDel) return '—'
                    return (
                      <Popconfirm title="确定删除该草稿/已拒绝批次？" onConfirm={() => void deleteBatch(r.id)}>
                        <Button type="link" size="small" danger>
                          删除
                        </Button>
                      </Popconfirm>
                    )
                  },
                },
              ]}
            />
          </div>
        )}
      </Card>

      <Modal
        title="同一 SKU/条码 已存在"
        open={skuConflictModal.visible}
        onCancel={() => setSkuConflictModal((s) => ({ ...s, visible: false }))}
        footer={[
          <Button key="cancel" onClick={() => setSkuConflictModal((s) => ({ ...s, visible: false }))}>
            取消
          </Button>,
          <Button key="increment" type="primary" loading={saveLoading} onClick={() => submitWithDuplicateMode('increment')}>
            增量（在现有数量上累加）
          </Button>,
          <Button key="overwrite" loading={saveLoading} onClick={() => submitWithDuplicateMode('overwrite')}>
            覆盖（用本次数据覆盖该条）
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
            { title: '仓库', dataIndex: 'warehouse', width: 80, render: (v: string | null) => v || '—' },
            { title: '货物名称', dataIndex: 'goods_name', ellipsis: true },
            { title: '当前数量', dataIndex: 'existing_quantity', width: 90, align: 'right' as const },
          ]}
        />
      </Modal>

      <Modal
        title="库存维护记录"
        open={recordsModalOpen}
        onCancel={() => setRecordsModalOpen(false)}
        footer={null}
        width={900}
        destroyOnClose
      >
        <Table
          size="small"
          loading={recordsLoading}
          dataSource={recordsList}
          rowKey="filename"
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: '暂无维护记录，保存到库存后会自动生成' }}
          columns={[
            { title: '文件名', dataIndex: 'filename', ellipsis: true, width: 220 },
            { title: '保存时间', dataIndex: 'saved_at', width: 165, render: (v: string) => (v ? v.replace('T', ' ').slice(0, 19) : '—') },
            { title: '操作人', dataIndex: 'saved_by', width: 90, render: (v: string | null) => v || '—' },
            { title: '条数', dataIndex: 'item_count', width: 72, align: 'right' as const },
            {
              title: '操作',
              key: 'action',
              width: 140,
              render: (_: unknown, record: { filename: string }) => (
                <Space size="small">
                  <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handlePreviewRecord(record.filename)}>
                    预览
                  </Button>
                  <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => handleDownloadRecord(record.filename)}>
                    下载
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title={`预览：${previewFilename ?? ''}`}
        open={!!previewContent}
        onCancel={() => { setPreviewContent(null); setPreviewFilename(null) }}
        footer={null}
        width={680}
        destroyOnClose
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <pre style={{ maxHeight: '60vh', overflow: 'auto', fontSize: 12, background: '#f5f5f5', padding: 12, borderRadius: 4, margin: 0 }}>
          {previewContent}
        </pre>
      </Modal>
    </div>
  )
}

export default InventoryMaintainPage
