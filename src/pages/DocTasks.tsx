/**
 * 功能名称：文档任务（项目维护）
 * 实现原理与逻辑：上传项目相关文档（如清单、报价表），解析为结构化数据并进入审阅表格；用户可编辑、确认后批量入库为项目商品或覆盖已有商品。
 * 支持多文档任务、解析状态展示、冲突处理与历史版本。与项目维度商品/成本数据联动，是「项目维护」的文档驱动入口。
 */
import {
  DeleteOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FormOutlined,
  PlusOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Segmented,
  Space,
  Table,
  Tabs,
  Typography,
  Upload,
} from 'antd'
import type { UploadFile } from 'antd'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../auth/AuthContext'
import { useReauthModal } from '../hooks/useReauthModal'

const { Title, Paragraph } = Typography

/** 审阅中的一条记录（与 products 表字段一致，无 id/created_at 等，用于展示与编辑） */
export type DocReviewItem = {
  _key?: string
  sequence_no?: number | null
  goods_name?: string
  brand?: string | null
  model?: string | null
  params?: string | null
  unit?: string | null
  quantity?: number | null
  unit_price_excl_tax?: number | null
  unit_price_incl_tax?: number | null
  amount_excl_tax?: number | null
  amount_incl_tax?: number | null
  remark?: string | null
  project_name?: string | null
  category?: string | null
  supplier?: string | null
  status?: string | null
  source_file?: string | null
  sku?: string | null
  cost_price?: number | null
  cost_amount?: number | null
  tax_rate?: number | null
  stock_quantity?: number | null
  extra_json?: string | null
}

const statusOptions = [
  { label: '正常', value: '正常' },
  { label: '停用', value: '停用' },
  { label: '待审核', value: '待审核' },
]

type ParseResult = { status: 'idle' | 'success' | 'error'; message: string; count?: number }

/** 文档处理状态：文档信息、处理时长、错误、AI 参数等 */
type ProcessStatus = {
  status: 'idle' | 'loading' | 'success' | 'error'
  docName?: string
  docSize?: number
  docType?: string
  durationMs?: number
  count?: number
  model?: string
  error?: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** 去掉文件名后缀，用作关联项目默认名 */
function fileNameWithoutExt(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

/** 根据文件名判断是否为成本清单（含“成本”“成本清单”“成本表”等视为成本） */
function detectListTypeFromFileName(fileName: string): 'cost' | 'quote' {
  if (!fileName || typeof fileName !== 'string') return 'quote'
  const lower = fileName.replace(/\.[^.]+$/, '').toLowerCase()
  if (/成本/.test(lower) || /成本清单/.test(lower) || /成本表/.test(lower)) return 'cost'
  return 'quote'
}

const DocTasksPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { user } = useAuth()
  const { askReauth, reauthModal } = useReauthModal()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [parseLoading, setParseLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [list, setList] = useState<DocReviewItem[]>([])
  const [parseResult, setParseResult] = useState<ParseResult>({ status: 'idle', message: '' })
  const [displayMode, setDisplayMode] = useState<'table' | 'json'>('table')
  const [batchProjectInput, setBatchProjectInput] = useState('')
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [projectModalValue, setProjectModalValue] = useState('')
  const [overwriteModalOpen, setOverwriteModalOpen] = useState(false)
  const [overwriteProjectName, setOverwriteProjectName] = useState('')
  /** 根据当前解析的文件名识别的清单类型，用于保存时默认选中 */
  const [detectedListType, setDetectedListType] = useState<'cost' | 'quote'>('quote')
  /** 保存目标选择弹窗：用户确认存入成本清单或报价清单 */
  const [saveTargetModalOpen, setSaveTargetModalOpen] = useState(false)
  const [saveTargetChoice, setSaveTargetChoice] = useState<'cost' | 'quote'>('quote')
  const [processStatus, setProcessStatus] = useState<ProcessStatus>({ status: 'idle' })
  /** 流式解析时实时追加的原始内容，用于“正在输出”的视觉反馈 */
  const [streamingText, setStreamingText] = useState('')
  const streamingPreRef = useRef<HTMLPreElement>(null)
  /** 解析前确认关联项目：弹窗开关、用户输入的项目名、已有项目列表 */
  const [parseProjectModalOpen, setParseProjectModalOpen] = useState(false)
  const [parseProjectName, setParseProjectName] = useState('')
  const [existingProjectNames, setExistingProjectNames] = useState<string[]>([])
  const [parseProjectNamesLoading, setParseProjectNamesLoading] = useState(false)
  /** 清单格式化流程：为 true 时弹窗确认后走格式化接口 */
  const [isFormatFlow, setIsFormatFlow] = useState(false)
  const [formatListType, setFormatListType] = useState<'cost' | 'quote'>('quote')
  /** 清单格式化：根据文件名识别目标格式后的确认弹窗 */
  const [formatConfirmModalOpen, setFormatConfirmModalOpen] = useState(false)
  /** 多 sheet 时：选择要处理的 sheet 弹窗、列表、已选名称、加载态 */
  const [formatSheetSelectModalOpen, setFormatSheetSelectModalOpen] = useState(false)
  const [formatSheetList, setFormatSheetList] = useState<{ name: string; index: number; hasData: boolean }[]>([])
  const [formatSelectedSheetNames, setFormatSelectedSheetNames] = useState<string[]>([])
  const [formatSheetsLoading, setFormatSheetsLoading] = useState(false)
  /** 当前功能 Tab：parse=清单解析，format=清单格式化 */
  const [activeListTab, setActiveListTab] = useState<'parse' | 'format'>('parse')
  /** 当前列表来源：parse=解析结果（可入库），format=格式化结果（仅预览/下载，不入库） */
  const [listSource, setListSource] = useState<'parse' | 'format' | null>(null)
  const [downloadExcelLoading, setDownloadExcelLoading] = useState(false)
  const [templateDownloadLoading, setTemplateDownloadLoading] = useState(false)
  /** 已保存的结构化文件：弹窗与列表 */
  const [filesModalOpen, setFilesModalOpen] = useState(false)
  const [exportedFilesList, setExportedFilesList] = useState<{ filename: string; project_name: string; list_type: 'cost' | 'quote'; saved_at: string; item_count: number; size: number }[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [viewFileContent, setViewFileContent] = useState<string | null>(null)
  const [viewFileName, setViewFileName] = useState('')
  const [saveAsModalOpen, setSaveAsModalOpen] = useState(false)
  const [saveAsFilename, setSaveAsFilename] = useState('')
  const [updateTargetFilename, setUpdateTargetFilename] = useState<string | null>(null)
  const [updateTargetListType, setUpdateTargetListType] = useState<'cost' | 'quote'>('quote')
  useEffect(() => {
    if (streamingText && streamingPreRef.current) {
      streamingPreRef.current.scrollTop = streamingPreRef.current.scrollHeight
    }
  }, [streamingText])

  const listWithKeys = useMemo(() => {
    return list.map((row, index) => ({ ...row, _key: row._key ?? `row-${index}` }))
  }, [list])

  const setRow = (index: number, field: keyof DocReviewItem, value: unknown) => {
    setList((prev) => {
      const next = [...prev]
      const item = { ...next[index], [field]: value }
      next[index] = item
      return next
    })
  }

  const loadTestData = async () => {
    try {
      const res = await fetch('/docReview.json')
      if (!res.ok) throw new Error('加载失败')
      const data = (await res.json()) as DocReviewItem[]
      const items = (Array.isArray(data) ? data : []).map((item, i) => ({
        ...item,
        project_name: item.project_name ?? '测试数据',
        _key: `test-${Date.now()}-${i}`,
      }))
      setList(items)
      setListSource('parse')
      setBatchProjectInput('测试数据')
      setParseResult({ status: 'success', message: '已加载测试数据', count: items.length })
      setProcessStatus({ status: 'success', docName: 'docReview.json', count: items.length, model: '本地测试数据' })
      msg.success(`已加载 ${items.length} 条测试数据，可用于调试表格与数据结构预览`)
    } catch (e: any) {
      msg.error(e?.message || '加载测试数据失败')
      setParseResult({ status: 'error', message: e?.message || '加载测试数据失败' })
      setProcessStatus({ status: 'error', error: e?.message || '加载测试数据失败' })
    }
  }

  /** 点击「清单解析」时先弹出关联项目确认；确认后执行解析，解析结果中每条记录使用该项目名 */
  const openParseProjectModal = () => {
    if (!fileList.length) {
      msg.warning('请先选择要上传的 Excel 或图片')
      return
    }
    setIsFormatFlow(false)
    const file = fileList[0].originFileObj as File
    const defaultName = fileNameWithoutExt(file.name)
    setParseProjectName(defaultName)
    setParseProjectModalOpen(true)
    setExistingProjectNames([])
    setParseProjectNamesLoading(true)
    axios
      .get<{ list: string[] }>('/api/products/projects')
      .then((res) => setExistingProjectNames(res.data?.list ?? []))
      .catch(() => {})
      .finally(() => setParseProjectNamesLoading(false))
  }

  const handleUpload = async (chosenProjectName?: string) => {
    if (!fileList.length) {
      msg.warning('请先选择要上传的 Excel 或图片')
      return
    }
    const file = fileList[0].originFileObj as File
    setParseProjectModalOpen(false)
    setParseLoading(true)
    setStreamingText('')
    setProcessStatus({
      status: 'loading',
      docName: file.name,
      docSize: file.size,
      docType: file.type,
    })
    const formData = new FormData()
    formData.append('file', file)
    const token = user?.token
    const headers: HeadersInit = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    try {
      const res = await fetch('/api/docs/process-stream', {
        method: 'POST',
        headers,
        body: formData,
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error((errData as { message?: string })?.message || `请求失败 ${res.status}`)
      }
      const reader = res.body?.getReader()
      if (!reader) throw new Error('无法读取响应流')

      const decoder = new TextDecoder()
      let buffer = ''
      let streamTerminal = false

      const handleEvent = (eventType: string, dataStr: string) => {
        if (eventType === 'chunk') {
          try {
            const delta = JSON.parse(dataStr) as string
            setStreamingText((prev) => prev + delta)
          } catch {
            // ignore
          }
        } else if (eventType === 'result') {
          try {
            const { list: resultList, meta } = JSON.parse(dataStr) as {
              list: DocReviewItem[]
              meta?: { fileName: string; fileSize: number; mimeType: string; durationMs: number; count: number; model?: string }
            }
            const fileName = file?.name ?? ''
            const projectNameDefault = (chosenProjectName && chosenProjectName.trim()) || fileNameWithoutExt(fileName)
            setDetectedListType(detectListTypeFromFileName(fileName))
            const items = (resultList ?? []).map((item, i) => ({
              ...item,
              project_name: (item.project_name ?? projectNameDefault) || null,
              _key: `parse-${Date.now()}-${i}`,
            }))
            setList(items)
            setListSource('parse')
            setBatchProjectInput(projectNameDefault)
            setParseResult({ status: 'success', message: '解析成功', count: items.length })
            setProcessStatus({
              status: 'success',
              docName: fileName,
              docSize: meta?.fileSize ?? file.size,
              docType: meta?.mimeType ?? file.type,
              durationMs: meta?.durationMs,
              count: meta?.count ?? items.length,
              model: meta?.model,
            })
            setStreamingText('')
            streamTerminal = true
            msg.success(`已解析 ${items.length} 条，请审阅后存入数据库`)
          } catch (e) {
            console.error('parse result', e)
            const errMsg = e instanceof Error ? e.message : '解析结果格式异常，无法展示'
            streamTerminal = true
            setParseResult({ status: 'error', message: errMsg })
            setProcessStatus((prev) => ({ ...prev, status: 'error', error: errMsg }))
            setStreamingText('')
            msg.error(errMsg)
          }
        } else if (eventType === 'error') {
          try {
            const { message: errMsg } = JSON.parse(dataStr) as { message?: string }
            setParseResult({ status: 'error', message: errMsg || '解析失败' })
            setProcessStatus((prev) => ({ ...prev, status: 'error', error: errMsg || '解析失败' }))
            setStreamingText('')
            streamTerminal = true
            msg.error(errMsg || '解析失败')
          } catch {
            setParseResult({ status: 'error', message: '解析失败' })
            setProcessStatus((prev) => ({ ...prev, status: 'error', error: '解析失败' }))
            setStreamingText('')
            streamTerminal = true
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
      if (!streamTerminal) {
        const errMsg = '未收到解析结束信号（连接可能中断或代理截断了流式响应），请检查网络、Vite/网关配置或大模型服务'
        setParseResult({ status: 'error', message: errMsg })
        setProcessStatus((prev) => ({ ...prev, status: 'error', error: errMsg }))
        setStreamingText('')
        msg.warning(errMsg)
      }
    } catch (e: any) {
      const errMsg = e?.message || '解析失败'
      setParseResult({ status: 'error', message: errMsg })
      setProcessStatus((prev) => ({ ...prev, status: 'error', error: errMsg }))
      setStreamingText('')
      msg.error(errMsg)
    } finally {
      setParseLoading(false)
    }
  }

  /** 判断是否为 Excel 文件（按扩展名） */
  const isExcelFile = (f: File) => /\.(xlsx|xls)$/i.test(f.name)

  /** 点击「清单格式化」：若为多 sheet 的 Excel 先弹 sheet 选择，否则直接弹目标格式确认 */
  const openFormatConfirmModal = async () => {
    if (!fileList.length) {
      msg.warning('请先选择要上传的 Excel 或图片')
      return
    }
    const file = fileList[0].originFileObj as File
    const detected = detectListTypeFromFileName(file.name)
    setFormatListType(detected)

    if (!isExcelFile(file)) {
      setFormatSelectedSheetNames([])
      setFormatConfirmModalOpen(true)
      return
    }

    setFormatSheetsLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/docs/excel-sheets', {
        method: 'POST',
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {},
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        msg.error((err as { message?: string })?.message || '读取 Excel 失败')
        return
      }
      const data = (await res.json()) as { sheets: { name: string; index: number; hasData: boolean }[]; sheetsWithData: string[] }
      const sheets = data?.sheets ?? []
      const withData = data?.sheetsWithData ?? sheets.filter((s: { hasData: boolean }) => s.hasData).map((s: { name: string }) => s.name)

      if (withData.length <= 1) {
        setFormatSelectedSheetNames([])
        setFormatConfirmModalOpen(true)
        return
      }

      setFormatSheetList(sheets)
      setFormatSelectedSheetNames(withData)
      setFormatSheetSelectModalOpen(true)
    } catch (e: any) {
      msg.error(e?.message || '读取 Excel 失败')
    } finally {
      setFormatSheetsLoading(false)
    }
  }

  /** 用户确认要处理的 sheet 后，关闭 sheet 选择弹窗并打开目标格式确认弹窗 */
  const onFormatSheetSelectOk = () => {
    if (formatSelectedSheetNames.length === 0) {
      msg.warning('请至少选择一个 sheet')
      return
    }
    setFormatSheetSelectModalOpen(false)
    setFormatConfirmModalOpen(true)
  }

  /** 用户确认目标格式后执行格式化 */
  const handleFormatConfirmOk = () => {
    setFormatConfirmModalOpen(false)
    handleFormatList()
  }

  /** 清单格式化：纯工具，不关联项目、不入库，仅预览与下载 Excel */
  const handleFormatList = async () => {
    if (!fileList.length) return
    const file = fileList[0].originFileObj as File
    setIsFormatFlow(true)
    setParseLoading(true)
    setStreamingText('')
    setProcessStatus({
      status: 'loading',
      docName: file.name,
      docSize: file.size,
      docType: file.type,
    })
    const formData = new FormData()
    formData.append('file', file)
    formData.append('list_type', formatListType)
    if (formatSelectedSheetNames.length > 0) {
      formData.append('sheets', JSON.stringify(formatSelectedSheetNames))
    }
    const token = user?.token
    const headers: HeadersInit = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    try {
      const res = await fetch('/api/docs/format-list-stream', {
        method: 'POST',
        headers,
        body: formData,
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error((errData as { message?: string })?.message || `请求失败 ${res.status}`)
      }
      const reader = res.body?.getReader()
      if (!reader) throw new Error('无法读取响应流')

      const decoder = new TextDecoder()
      let buffer = ''
      let streamTerminal = false

      const handleEvent = (eventType: string, dataStr: string) => {
        if (eventType === 'chunk') {
          try {
            const delta = JSON.parse(dataStr) as string
            setStreamingText((prev) => prev + delta)
          } catch {
            // ignore
          }
        } else if (eventType === 'result') {
          try {
            const { list: resultList, meta } = JSON.parse(dataStr) as {
              list: DocReviewItem[]
              meta?: { fileName: string; fileSize: number; mimeType: string; durationMs: number; count: number; model?: string }
            }
            const fileName = file?.name ?? ''
            const items = (resultList ?? []).map((item, i) => ({
              ...item,
              project_name: null,
              _key: `format-${Date.now()}-${i}`,
            }))
            setList(items)
            setListSource('format')
            setParseResult({ status: 'success', message: '格式化成功', count: items.length })
            setProcessStatus({
              status: 'success',
              docName: fileName,
              docSize: meta?.fileSize ?? file.size,
              docType: meta?.mimeType ?? file.type,
              durationMs: meta?.durationMs,
              count: meta?.count ?? items.length,
              model: meta?.model,
            })
            setStreamingText('')
            setFormatSelectedSheetNames([])
            streamTerminal = true
            msg.success(`已格式化 ${items.length} 条，可预览表格或下载 Excel`)
          } catch (e) {
            console.error('format result', e)
            const errMsg = e instanceof Error ? e.message : '格式化结果格式异常，无法展示'
            streamTerminal = true
            setParseResult({ status: 'error', message: errMsg })
            setProcessStatus((prev) => ({ ...prev, status: 'error', error: errMsg }))
            setStreamingText('')
            msg.error(errMsg)
          }
        } else if (eventType === 'error') {
          try {
            const { message: errMsg } = JSON.parse(dataStr) as { message?: string }
            setParseResult({ status: 'error', message: errMsg || '格式化失败' })
            setProcessStatus((prev) => ({ ...prev, status: 'error', error: errMsg || '格式化失败' }))
            setStreamingText('')
            streamTerminal = true
            msg.error(errMsg || '格式化失败')
          } catch {
            setParseResult({ status: 'error', message: '格式化失败' })
            setProcessStatus((prev) => ({ ...prev, status: 'error', error: '格式化失败' }))
            setStreamingText('')
            streamTerminal = true
            msg.error('格式化失败')
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
      if (!streamTerminal) {
        const errMsg = '未收到格式化结束信号（连接可能中断或代理截断了流式响应），请检查网络或网关配置'
        setParseResult({ status: 'error', message: errMsg })
        setProcessStatus((prev) => ({ ...prev, status: 'error', error: errMsg }))
        setStreamingText('')
        msg.warning(errMsg)
      }
    } catch (e: any) {
      const errMsg = e?.message || '格式化失败'
      setParseResult({ status: 'error', message: errMsg })
      setProcessStatus((prev) => ({ ...prev, status: 'error', error: errMsg }))
      setStreamingText('')
      msg.error(errMsg)
    } finally {
      setParseLoading(false)
      setIsFormatFlow(false)
    }
  }

  /** 下载当前列表为 Excel（仅用于格式化结果） */
  const handleDownloadFormatExcel = async () => {
    if (!list.length) return
    setDownloadExcelLoading(true)
    try {
      const items = listWithKeys.map(({ _key, ...rest }) => rest)
      const token = user?.token
      const res = await fetch('/api/docs/export-list-excel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ items }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { message?: string }).message || '导出失败')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const timeStr = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 12)
      const baseName = (processStatus.docName || '清单').replace(/\.[^.]+$/, '')
      a.download = `${baseName}_格式化_${timeStr}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      msg.success('已下载 Excel')
    } catch (e: any) {
      msg.error(e?.message || '下载失败')
    } finally {
      setDownloadExcelLoading(false)
    }
  }

  /** 下载清单模板（表头与格式化后标准一致，便于填写后上传做格式化） */
  const handleDownloadListTemplate = async () => {
    setTemplateDownloadLoading(true)
    try {
      const token = user?.token
      const res = await fetch('/api/docs/list-template', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(res.statusText)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = '清单模板_格式化标准.xlsx'
      a.click()
      URL.revokeObjectURL(url)
      msg.success('已下载清单模板，按表头填写后上传可进行清单格式化')
    } catch (e: any) {
      msg.error(e?.message || '下载模板失败')
    } finally {
      setTemplateDownloadLoading(false)
    }
  }

  /** 清空格式化结果（仅用于格式化工具） */
  const handleClearFormatResult = () => {
    setList([])
    setListSource(null)
    setParseResult({ status: 'idle', message: '' })
    setProcessStatus({ status: 'idle' })
  }

  /** 将审阅项转为成本清单接口所需格式（含税/不含税、税率与 cost_price/cost_amount 均映射，后端会归一化） */
  const mapToCostListItems = (items: DocReviewItem[]): Record<string, unknown>[] => {
    const defaultTax = 13
    return items.map((row) => {
      const qty = row.quantity != null ? Number(row.quantity) : null
      const taxRate = row.tax_rate != null ? Number(row.tax_rate) : defaultTax
      const r = 1 + taxRate / 100
      const unitIncl = row.unit_price_incl_tax != null ? Number(row.unit_price_incl_tax) : row.cost_price != null ? Number(row.cost_price) : null
      const unitExcl = row.unit_price_excl_tax != null ? Number(row.unit_price_excl_tax) : unitIncl != null ? Math.round((unitIncl / r) * 100) / 100 : null
      const amountIncl = row.amount_incl_tax != null ? Number(row.amount_incl_tax) : row.cost_amount != null ? Number(row.cost_amount) : unitIncl != null && qty != null ? Math.round(unitIncl * qty * 100) / 100 : unitExcl != null && qty != null ? Math.round(unitExcl * qty * r * 100) / 100 : null
      const amountExcl = row.amount_excl_tax != null ? Number(row.amount_excl_tax) : amountIncl != null ? Math.round((amountIncl / r) * 100) / 100 : null
      return {
        sequence_no: row.sequence_no,
        goods_name: row.goods_name,
        brand: row.brand,
        model: row.model,
        params: row.params,
        unit: row.unit,
        quantity: qty,
        tax_rate: taxRate,
        unit_price_excl_tax: unitExcl,
        unit_price_incl_tax: unitIncl,
        amount_excl_tax: amountExcl,
        amount_incl_tax: amountIncl,
        cost_price: unitIncl,
        cost_amount: amountIncl,
        remark: row.remark,
        project_name: row.project_name,
        category: row.category,
        supplier: row.supplier,
        status: row.status,
        source_file: row.source_file,
        sku: row.sku,
      }
    })
  }

  /** 实际执行入库：target 为 cost 时存入成本清单，否则存入报价清单；overwrite 仅对报价清单有效；成功后同时写入一份结构化文件 */
  const doSaveToDb = async (target: 'cost' | 'quote', overwrite: boolean) => {
    if (!list.length) return
    const projectName = list[0]?.project_name?.trim() ?? ''
    const items = listWithKeys.map(({ _key, ...rest }) => rest)
    let reauth_password: string | undefined
    if (target === 'quote' && overwrite && projectName) {
      const pwd = await askReauth('覆盖报价将替换该项目下已有数据，请输入登录密码确认')
      if (!pwd) return
      reauth_password = pwd
    }
    setSaveLoading(true)
    try {
      if (target === 'cost') {
        const costItems = mapToCostListItems(items)
        await axios.post('/api/cost-list/bulk', { items: costItems })
        msg.success('已存入成本清单')
        await axios.post('/api/structured-exports', { items: costItems, project_name: projectName || '未命名项目', list_type: 'cost' }).catch(() => {})
      } else {
        if (overwrite && projectName) {
          await axios.post('/api/products/overwrite', {
            project_name: projectName,
            items,
            reauth_password,
          })
          msg.success('已保存历史版本并覆盖存入报价清单')
        } else {
          await axios.post('/api/products/bulk', { items })
          msg.success('已存入报价清单')
        }
        await axios.post('/api/structured-exports', { items, project_name: projectName || '未命名项目', list_type: 'quote' }).catch(() => {})
      }
      setList([])
      setListSource(null)
      setFileList([])
      setParseResult({ status: 'idle', message: '' })
      setOverwriteModalOpen(false)
      setOverwriteProjectName('')
      setSaveTargetModalOpen(false)
    } catch (e: any) {
      msg.error(e?.response?.data?.message || e?.message || '入库失败')
    } finally {
      setSaveLoading(false)
    }
  }

  /** 拉取已保存的结构化文件列表 */
  const fetchExportedFiles = async () => {
    setFilesLoading(true)
    try {
      const res = await axios.get<{ list: { filename: string; project_name: string; list_type: 'cost' | 'quote'; saved_at: string; item_count: number; size: number }[] }>('/api/structured-exports')
      setExportedFilesList(res.data?.list ?? [])
    } catch {
      setExportedFilesList([])
    } finally {
      setFilesLoading(false)
    }
  }

  const openFilesModal = () => {
    setFilesModalOpen(true)
    fetchExportedFiles()
  }

  const handleViewFile = async (filename: string) => {
    try {
      const res = await axios.get<Record<string, unknown>>(`/api/structured-exports/${encodeURIComponent(filename)}`)
      setViewFileName(filename)
      setViewFileContent(JSON.stringify(res.data, null, 2))
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '读取失败')
    }
  }

  const handleDeleteFile = async (filename: string) => {
    try {
      await axios.delete(`/api/structured-exports/${encodeURIComponent(filename)}`)
      msg.success('已删除')
      fetchExportedFiles()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }

  const handleOverwriteFile = (filename: string, listType: 'cost' | 'quote') => {
    setUpdateTargetFilename(filename)
    setUpdateTargetListType(listType)
  }

  const confirmOverwriteFile = async () => {
    if (!updateTargetFilename || !list.length) return
    const items = listWithKeys.map(({ _key, ...rest }) => rest)
    const projectName = list[0]?.project_name?.trim() ?? ''
    const body =
      updateTargetListType === 'cost'
        ? { items: mapToCostListItems(items), project_name: projectName || '未命名项目', list_type: 'cost' as const }
        : { items, project_name: projectName || '未命名项目', list_type: 'quote' as const }
    try {
      await axios.put(`/api/structured-exports/${encodeURIComponent(updateTargetFilename)}`, body)
      msg.success('已覆盖更新')
      setUpdateTargetFilename(null)
      fetchExportedFiles()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '更新失败')
    }
  }

  const handleSaveAsFile = async () => {
    const name = saveAsFilename.trim()
    if (!name) {
      msg.warning('请输入文件名')
      return
    }
    if (!list.length) {
      msg.warning('当前无数据可保存')
      return
    }
    const items = listWithKeys.map(({ _key, ...rest }) => rest)
    const projectName = list[0]?.project_name?.trim() ?? ''
    const listType = detectedListType
    const body =
      listType === 'cost'
        ? { items: mapToCostListItems(items), project_name: projectName || '未命名项目', list_type: 'cost' as const, filename: name.endsWith('.json') ? name : `${name}.json` }
        : { items, project_name: projectName || '未命名项目', list_type: 'quote' as const, filename: name.endsWith('.json') ? name : `${name}.json` }
    try {
      await axios.post('/api/structured-exports', body)
      msg.success('已另存为文件')
      setSaveAsModalOpen(false)
      setSaveAsFilename('')
      if (filesModalOpen) fetchExportedFiles()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '保存失败')
    }
  }

  /** 点击「存入数据库」时先打开保存目标选择弹窗 */
  const handleSaveToDbClick = () => {
    if (!list.length) {
      msg.warning('没有可入库的数据，请先上传并解析文档')
      return
    }
    setSaveTargetChoice(detectedListType)
    setSaveTargetModalOpen(true)
  }

  /** 用户在选择弹窗中确认保存到成本清单 */
  const handleConfirmSaveToCost = () => {
    setSaveTargetModalOpen(false)
    doSaveToDb('cost', false)
  }

  /** 用户在选择弹窗中确认保存到报价清单（若项目已有数据会再弹覆盖确认） */
  const handleConfirmSaveToQuote = async () => {
    const projectName = list[0]?.project_name?.trim() ?? ''
    setSaveTargetModalOpen(false)
    if (!projectName) {
      await doSaveToDb('quote', false)
      return
    }
    try {
      const res = await axios.get<{ total: number }>('/api/products', { params: { project_name: projectName } })
      const total = res.data?.total ?? 0
      if (total > 0) {
        setOverwriteProjectName(projectName)
        setOverwriteModalOpen(true)
        return
      }
    } catch {
      // 查询失败时仍尝试直接入库
    }
    await doSaveToDb('quote', false)
  }

  /** 覆盖确认弹窗中用户确认覆盖报价清单 */
  const handleOverwriteQuoteConfirm = () => {
    doSaveToDb('quote', true)
  }

  const addRow = () => {
    const defaultProject = list[0]?.project_name ?? undefined
    setList((prev) => [...prev, { _key: `new-${Date.now()}`, goods_name: '', status: '正常', project_name: defaultProject ?? null }])
  }

  const openProjectModal = () => {
    setProjectModalValue(list[0]?.project_name ?? batchProjectInput ?? '')
    setProjectModalOpen(true)
  }

  const saveBatchProjectName = () => {
    const value = projectModalValue.trim()
    if (!value) return
    setList((prev) => prev.map((row) => ({ ...row, project_name: value })))
    setBatchProjectInput(value)
    setProjectModalOpen(false)
    msg.success(`已将所有 ${list.length} 条的关联项目设为「${value}」`)
  }

  const removeRow = (index: number) => {
    setList((prev) => prev.filter((_, i) => i !== index))
  }

  const columns: ColumnsType<DocReviewItem & { _key: string }> = [
    {
      title: '序号',
      dataIndex: 'sequence_no',
      width: 72,
      render: (val, _, index) => (
        <InputNumber
          size="small"
          style={{ width: '100%' }}
          value={val ?? undefined}
          onChange={(v) => setRow(index, 'sequence_no', v ?? null)}
        />
      ),
    },
    {
      title: '货物名称',
      dataIndex: 'goods_name',
      width: 140,
      render: (val, _, index) => (
        <Input
          size="small"
          value={val ?? ''}
          onChange={(e) => setRow(index, 'goods_name', e.target.value || null)}
          placeholder="必填"
        />
      ),
    },
    {
      title: '品牌',
      dataIndex: 'brand',
      width: 90,
      render: (val, _, index) => (
        <Input
          size="small"
          value={val ?? ''}
          onChange={(e) => setRow(index, 'brand', e.target.value || null)}
        />
      ),
    },
    {
      title: '型号',
      dataIndex: 'model',
      width: 100,
      render: (val, _, index) => (
        <Input
          size="small"
          value={val ?? ''}
          onChange={(e) => setRow(index, 'model', e.target.value || null)}
        />
      ),
    },
    {
      title: '参数',
      dataIndex: 'params',
      width: 120,
      render: (val, _, index) => (
        <Input
          size="small"
          value={val ?? ''}
          onChange={(e) => setRow(index, 'params', e.target.value || null)}
        />
      ),
    },
    {
      title: '单位',
      dataIndex: 'unit',
      width: 64,
      render: (val, _, index) => (
        <Input
          size="small"
          value={val ?? ''}
          onChange={(e) => setRow(index, 'unit', e.target.value || null)}
        />
      ),
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      width: 80,
      render: (val, _, index) => (
        <InputNumber
          size="small"
          style={{ width: '100%' }}
          value={val ?? undefined}
          onChange={(v) => setRow(index, 'quantity', v ?? null)}
        />
      ),
    },
    {
      title: '不含税单价',
      dataIndex: 'unit_price_excl_tax',
      width: 96,
      render: (val, _, index) => (
        <InputNumber
          size="small"
          style={{ width: '100%' }}
          value={val ?? undefined}
          onChange={(v) => setRow(index, 'unit_price_excl_tax', v ?? null)}
        />
      ),
    },
    {
      title: '单价(含税)',
      dataIndex: 'unit_price_incl_tax',
      width: 96,
      render: (val, row, index) => {
        const displayVal = val ?? (row as DocReviewItem).cost_price ?? undefined
        return (
          <InputNumber
            size="small"
            style={{ width: '100%' }}
            value={displayVal}
            onChange={(v) => {
              setRow(index, 'unit_price_incl_tax', v ?? null)
              if ((row as DocReviewItem).cost_price != null && val == null) setRow(index, 'cost_price', v ?? null)
            }}
          />
        )
      },
    },
    {
      title: '不含税金额',
      dataIndex: 'amount_excl_tax',
      width: 96,
      render: (val, _, index) => (
        <InputNumber
          size="small"
          style={{ width: '100%' }}
          value={val ?? undefined}
          onChange={(v) => setRow(index, 'amount_excl_tax', v ?? null)}
        />
      ),
    },
    {
      title: '金额(含税)',
      dataIndex: 'amount_incl_tax',
      width: 96,
      render: (val, _, index) => (
        <InputNumber
          size="small"
          style={{ width: '100%' }}
          value={val ?? undefined}
          onChange={(v) => setRow(index, 'amount_incl_tax', v ?? null)}
        />
      ),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      width: 100,
      render: (val, _, index) => (
        <Input
          size="small"
          value={val ?? ''}
          onChange={(e) => setRow(index, 'remark', e.target.value || null)}
        />
      ),
    },
    {
      title: '关联项目',
      dataIndex: 'project_name',
      width: 120,
      render: (val, _, index) => (
        <Input
          size="small"
          value={val ?? ''}
          onChange={(e) => setRow(index, 'project_name', e.target.value || null)}
        />
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 80,
      render: (val, _, index) => (
        <Input
          size="small"
          value={val ?? ''}
          onChange={(e) => setRow(index, 'category', e.target.value || null)}
        />
      ),
    },
    {
      title: '供应商',
      dataIndex: 'supplier',
      width: 90,
      render: (val, _, index) => (
        <Input
          size="small"
          value={val ?? ''}
          onChange={(e) => setRow(index, 'supplier', e.target.value || null)}
        />
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 88,
      render: (val, _, index) => (
        <Select
          size="small"
          style={{ width: '100%' }}
          value={val ?? '正常'}
          options={statusOptions}
          onChange={(v) => setRow(index, 'status', v)}
        />
      ),
    },
    {
      title: '来源文件',
      dataIndex: 'source_file',
      width: 100,
      render: (val, _, index) => (
        <Input
          size="small"
          value={val ?? ''}
          onChange={(e) => setRow(index, 'source_file', e.target.value || null)}
        />
      ),
    },
    {
      title: '条形码/SKU',
      dataIndex: 'sku',
      width: 100,
      render: (val, _, index) => (
        <Input
          size="small"
          value={val ?? ''}
          onChange={(e) => setRow(index, 'sku', e.target.value || null)}
        />
      ),
    },
    {
      title: '成本价',
      dataIndex: 'cost_price',
      width: 88,
      render: (val, _, index) => (
        <InputNumber
          size="small"
          style={{ width: '100%' }}
          value={val ?? undefined}
          onChange={(v) => setRow(index, 'cost_price', v ?? null)}
        />
      ),
    },
    {
      title: '成本金额',
      dataIndex: 'cost_amount',
      width: 96,
      render: (val, _, index) => (
        <InputNumber
          size="small"
          style={{ width: '100%' }}
          value={val ?? undefined}
          onChange={(v) => setRow(index, 'cost_amount', v ?? null)}
        />
      ),
    },
    {
      title: '税率',
      dataIndex: 'tax_rate',
      width: 72,
      render: (val, _, index) => (
        <InputNumber
          size="small"
          style={{ width: '100%' }}
          min={0}
          max={1}
          step={0.01}
          value={val ?? undefined}
          onChange={(v) => setRow(index, 'tax_rate', v ?? null)}
        />
      ),
    },
    {
      title: '库存数量',
      dataIndex: 'stock_quantity',
      width: 88,
      render: (val, _, index) => (
        <InputNumber
          size="small"
          style={{ width: '100%' }}
          min={0}
          value={val ?? undefined}
          onChange={(v) => setRow(index, 'stock_quantity', v ?? null)}
        />
      ),
    },
    {
      title: '扩展(JSON)',
      dataIndex: 'extra_json',
      width: 120,
      render: (val, _, index) => (
        <Input
          size="small"
          value={typeof val === 'string' ? val : val != null ? JSON.stringify(val) : ''}
          onChange={(e) => {
            const raw = e.target.value.trim()
            if (!raw) {
              setRow(index, 'extra_json', null)
              return
            }
            try {
              setRow(index, 'extra_json', JSON.parse(raw))
            } catch {
              setRow(index, 'extra_json', raw)
            }
          }}
          placeholder="JSON"
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right',
      render: (_, __, index) => (
        <Popconfirm title="确定删除该行？" onConfirm={() => removeRow(index)} okText="删除" cancelText="取消">
          <Button type="link" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ]

  return (
    <div>
      {reauthModal}
      <Title level={3} style={{ marginBottom: 8 }}>
        商品列表维护
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        上传 Excel 或图片后，在下方通过 Tab 选择「清单解析」或「清单格式化」；解析/格式化结果在底部表格中审阅、编辑后可存入数据库（成本清单或报价清单）。<strong>存入时必填：货物名称、数量、单价（含税或不含税二选一）、关联项目。</strong>
      </Paragraph>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flexShrink: 0 }}>
            <Upload.Dragger
              accept=".xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp"
              fileList={fileList}
              maxCount={1}
              beforeUpload={(file) => {
                setFileList([{ uid: file.name, name: file.name, originFileObj: file }])
                return false
              }}
              onRemove={() => setFileList([])}
              showUploadList={{ showPreviewIcon: false }}
              style={{ width: 280 }}
            >
              <p className="ant-upload-drag-icon">
                <UploadOutlined style={{ fontSize: 40, color: 'var(--ant-colorPrimary)' }} />
              </p>
              <p className="ant-upload-text">点击或拖拽文件到此处</p>
              <p className="ant-upload-hint">支持 Excel、CSV、图片（.xlsx / .xls / .csv / .png / .jpg / .webp）</p>
            </Upload.Dragger>
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <Tabs
              activeKey={activeListTab}
              onChange={(k) => setActiveListTab(k as 'parse' | 'format')}
              items={[
                {
                  key: 'parse',
                  label: '清单解析',
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        适用于表头、列名较规范的 Excel/CSV 或图片，直接按表格结构解析为清单数据。
                      </Typography.Text>
                      <div style={{ display: 'flex', flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Button
                          type="primary"
                          icon={<FileTextOutlined />}
                          loading={parseLoading}
                          onClick={openParseProjectModal}
                          disabled={!fileList.length}
                          style={{ width: 'fit-content' }}
                        >
                          清单解析
                        </Button>
                        <Button type="default" onClick={loadTestData} style={{ width: 'fit-content' }}>
                          加载测试数据
                        </Button>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'format',
                  label: '清单格式化',
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        纯工具：上传文件后点击「清单格式化」，系统将根据文件名判断目标格式并弹窗供您确认，确认后开始格式化。不关联项目、不入库，仅支持预览与下载 Excel。也可先下载清单模板，按表头填写后上传进行格式化。
                      </Typography.Text>
                      <div style={{ display: 'flex', flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Button
                          type="default"
                          icon={<DownloadOutlined />}
                          loading={templateDownloadLoading}
                          onClick={handleDownloadListTemplate}
                          style={{ width: 'fit-content' }}
                        >
                          清单模板下载
                        </Button>
                        <Button
                          type="primary"
                          icon={<FormOutlined />}
                          loading={parseLoading || formatSheetsLoading}
                          onClick={openFormatConfirmModal}
                          disabled={!fileList.length}
                          style={{ width: 'fit-content' }}
                        >
                          清单格式化
                        </Button>
                      </div>
                    </div>
                  ),
                },
              ]}
            />
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: 'var(--ant-colorFillQuaternary)',
                borderRadius: 6,
                fontSize: 12,
                minHeight: 80,
              }}
            >
              <Typography.Text strong style={{ marginBottom: 8, display: 'block' }}>
                状态与处理信息
              </Typography.Text>
              {processStatus.status === 'loading' && (
                <div style={{ width: '100%' }}>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    {isFormatFlow ? '正在格式化文档，大模型分析并转换中…' : '正在解析文档，大模型输出中…'}
                  </Typography.Text>
                  {isFormatFlow && formatSelectedSheetNames.length > 1 && (
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      已按 sheet 分次请求，每个表会依次流式输出，首个 sheet 会较快开始返回。
                    </Typography.Text>
                  )}
                  {streamingText && (
                    <pre
                      ref={streamingPreRef}
                      style={{
                        margin: 0,
                        padding: 8,
                        background: 'var(--ant-colorBgContainer)',
                        borderRadius: 4,
                        fontSize: 12,
                        maxHeight: 160,
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        border: '1px solid var(--ant-colorBorderSecondary)',
                      }}
                    >
                      {streamingText || '…'}
                    </pre>
                  )}
                </div>
              )}
              {processStatus.status === 'error' && processStatus.error && (
                <Alert type="error" message={processStatus.error} showIcon style={{ marginBottom: 8 }} />
              )}
              {(processStatus.status === 'success' || processStatus.docName) && (
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <div>
                    <Typography.Text type="secondary">文档：</Typography.Text> {processStatus.docName}
                    {processStatus.docSize != null && (
                      <Typography.Text type="secondary"> · {formatFileSize(processStatus.docSize)}</Typography.Text>
                    )}
                    {processStatus.docType && (
                      <Typography.Text type="secondary"> · {processStatus.docType}</Typography.Text>
                    )}
                  </div>
                  {processStatus.durationMs != null && (
                    <div>
                      <Typography.Text type="secondary">处理时长：</Typography.Text> {(processStatus.durationMs / 1000).toFixed(2)} 秒
                    </div>
                  )}
                  {processStatus.count != null && (
                    <div>
                      <Typography.Text type="secondary">{isFormatFlow ? '格式化' : '解析'}条数：</Typography.Text> {processStatus.count} 条
                    </div>
                  )}
                  {processStatus.model && (
                    <div>
                      <Typography.Text type="secondary">AI 模型：</Typography.Text> {processStatus.model}
                    </div>
                  )}
                  {processStatus.status === 'success' && processStatus.docName && !isFormatFlow && (
                    <div>
                      <Typography.Text type="secondary">清单类型：</Typography.Text>{' '}
                      {detectListTypeFromFileName(processStatus.docName) === 'cost' ? (
                        <Typography.Text type="warning">已识别为成本清单（文件名含「成本」），存入时可选择成本清单或报价清单</Typography.Text>
                      ) : (
                        '报价清单'
                      )}
                    </div>
                  )}
                </Space>
              )}
              {processStatus.status === 'idle' && !processStatus.docName && !processStatus.error && (
                <Typography.Text type="secondary">
                  {activeListTab === 'parse'
                    ? '选择文件后点击「清单解析」，将显示文档信息与 AI 处理结果。'
                    : '选择文件后点击「清单格式化」，系统将根据文件名识别目标格式并弹窗供您确认，确认后开始格式化。'}
                </Typography.Text>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="处理结果"
        style={{ marginTop: 16 }}
        extra={
          listSource === 'format' ? (
            <Space wrap size="middle">
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={downloadExcelLoading}
                disabled={list.length === 0}
                onClick={handleDownloadFormatExcel}
              >
                下载为 Excel
              </Button>
              <Button type="default" onClick={handleClearFormatResult} disabled={list.length === 0}>
                清空
              </Button>
            </Space>
          ) : (
            <Space wrap size="middle">
              <Button type="primary" ghost icon={<PlusOutlined />} onClick={addRow}>
                新增一行
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={saveLoading}
                disabled={list.length === 0}
                onClick={handleSaveToDbClick}
              >
                存入数据库
              </Button>
              <Button type="default" icon={<FolderOpenOutlined />} onClick={openFilesModal}>
                已保存文件
              </Button>
              <Button type="default" onClick={openProjectModal} disabled={list.length === 0}>
                修改关联项目
              </Button>
              <Button type="default" disabled={list.length === 0} onClick={() => { setSaveAsModalOpen(true); setSaveAsFilename('') }}>
                另存为文件
              </Button>
            </Space>
          )
        }
      >
        {listSource === 'format' && (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            以下为格式化结果预览，可下载为 Excel，不会存入数据库。
          </Typography.Paragraph>
        )}
        <Modal
          title="确定关联项目"
          open={parseProjectModalOpen}
          onCancel={() => setParseProjectModalOpen(false)}
          onOk={() => handleUpload(parseProjectName.trim() || undefined)}
          okText="开始解析"
          cancelText="取消"
          destroyOnClose
        >
          <div style={{ padding: '8px 0' }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              解析前请确认本清单关联的项目名称，解析后每条记录将使用该项目名。可从已有项目中选择或直接输入，默认为当前文件名。
            </Typography.Paragraph>
            <AutoComplete
              style={{ width: '100%' }}
              placeholder="项目名称（默认：当前文件名）"
              value={parseProjectName}
              onChange={setParseProjectName}
              options={existingProjectNames.map((name) => ({ value: name }))}
              notFoundContent={parseProjectNamesLoading ? '加载中…' : '可输入新项目名称'}
            />
          </div>
        </Modal>
        <Modal
          title="选择要处理的 Sheet"
          open={formatSheetSelectModalOpen}
          onCancel={() => setFormatSheetSelectModalOpen(false)}
          onOk={onFormatSheetSelectOk}
          okText="确定"
          cancelText="取消"
          destroyOnClose
        >
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            该 Excel 包含多个有数据的 sheet，请勾选需要参与格式化的 sheet（可多选），确认后将进入目标格式选择。
          </Typography.Paragraph>
          <Checkbox.Group
            value={formatSelectedSheetNames}
            onChange={(vals) => setFormatSelectedSheetNames(vals as string[])}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {formatSheetList
              .filter((s) => s.hasData)
              .map((s) => (
                <Checkbox key={s.name} value={s.name}>
                  {s.name}
                  <Typography.Text type="secondary" style={{ marginLeft: 6 }}>(有数据)</Typography.Text>
                </Checkbox>
              ))}
          </Checkbox.Group>
        </Modal>
        <Modal
          title="确认目标格式"
          open={formatConfirmModalOpen}
          onCancel={() => setFormatConfirmModalOpen(false)}
          onOk={handleFormatConfirmOk}
          okText="开始格式化"
          cancelText="取消"
          destroyOnClose
        >
          <div style={{ padding: '8px 0' }}>
            {fileList.length > 0 && (() => {
              const file = fileList[0].originFileObj as File
              const fileName = file?.name ?? ''
              const detected = detectListTypeFromFileName(fileName)
              const typeLabel = detected === 'cost' ? '成本清单' : '报价清单'
              return (
                <>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                    根据文件名「{fileName}」已识别为【{typeLabel}】。请确认或修改目标格式后开始格式化。
                  </Typography.Paragraph>
                  <div style={{ marginBottom: 0 }}>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>目标格式</Typography.Text>
                    <Select
                      value={formatListType}
                      onChange={setFormatListType}
                      options={[
                        { label: '报价清单', value: 'quote' },
                        { label: '成本清单', value: 'cost' },
                      ]}
                      style={{ width: '100%' }}
                    />
                  </div>
                </>
              )
            })()}
          </div>
        </Modal>
        <Modal
          title="修改关联项目"
          open={projectModalOpen}
          onCancel={() => setProjectModalOpen(false)}
          onOk={saveBatchProjectName}
          okText="保存"
          cancelText="取消"
          destroyOnHidden
        >
          <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 8 }}>关联项目名称（将应用到当前全部 {list.length} 条）：</div>
            <Input
              placeholder="请输入关联项目名称"
              value={projectModalValue}
              onChange={(e) => setProjectModalValue(e.target.value)}
              onPressEnter={saveBatchProjectName}
            />
          </div>
        </Modal>
        <Modal
          title="选择保存目标"
          open={saveTargetModalOpen}
          onCancel={() => setSaveTargetModalOpen(false)}
          footer={null}
          destroyOnHidden
        >
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            请选择将当前 {list.length} 条数据存入「成本清单」或「报价清单」。系统已根据文件名识别为{detectedListType === 'cost' ? '成本清单' : '报价清单'}，您可修改选择。
          </Typography.Paragraph>
          <Space size="middle">
            <Button
              type={saveTargetChoice === 'cost' ? 'primary' : 'default'}
              onClick={() => setSaveTargetChoice('cost')}
            >
              存入成本清单
            </Button>
            <Button
              type={saveTargetChoice === 'quote' ? 'primary' : 'default'}
              onClick={() => setSaveTargetChoice('quote')}
            >
              存入报价清单
            </Button>
          </Space>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setSaveTargetModalOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={saveLoading}
              onClick={saveTargetChoice === 'cost' ? handleConfirmSaveToCost : handleConfirmSaveToQuote}
            >
              确定存入
            </Button>
          </div>
        </Modal>
        <Modal
          title="该项目已存在报价数据"
          open={overwriteModalOpen}
          onCancel={() => { setOverwriteModalOpen(false); setOverwriteProjectName('') }}
          onOk={handleOverwriteQuoteConfirm}
          okText="覆盖并存入"
          cancelText="取消"
          confirmLoading={saveLoading}
          destroyOnHidden
        >
          <Typography.Paragraph>
            项目「{overwriteProjectName}」下已有报价数据。覆盖会<strong>先将当前数据保存为历史版本</strong>，再写入当前 {list.length} 条数据。是否继续？
          </Typography.Paragraph>
        </Modal>
        <Modal
          title="已保存的结构化文件"
          open={filesModalOpen}
          onCancel={() => setFilesModalOpen(false)}
          footer={null}
          width={720}
          destroyOnClose
          styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        >
          <Table
            size="small"
            loading={filesLoading}
            dataSource={exportedFilesList}
            rowKey="filename"
            pagination={{ pageSize: 10 }}
            scroll={{ y: '50vh' }}
            columns={[
              { title: '文件名', dataIndex: 'filename', ellipsis: true, width: 200 },
              { title: '项目', dataIndex: 'project_name', ellipsis: true, width: 120 },
              { title: '类型', dataIndex: 'list_type', width: 72, render: (v: string) => (v === 'cost' ? '成本清单' : '报价清单') },
              { title: '条数', dataIndex: 'item_count', width: 64, align: 'right' },
              { title: '保存时间', dataIndex: 'saved_at', width: 160, render: (v: string) => (v ? v.replace('T', ' ').slice(0, 19) : '') },
              {
                title: '操作',
                key: 'action',
                width: 200,
                render: (_, record: { filename: string; list_type: 'cost' | 'quote' }) => (
                  <Space size="small">
                    <Button type="link" size="small" onClick={() => handleViewFile(record.filename)}>
                      查看
                    </Button>
                    <Button type="link" size="small" disabled={list.length === 0} onClick={() => handleOverwriteFile(record.filename, record.list_type)}>
                      覆盖更新
                    </Button>
                    <Popconfirm title="确定删除该文件？" onConfirm={() => handleDeleteFile(record.filename)} okText="删除" cancelText="取消">
                      <Button type="link" danger size="small">
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </Modal>
        <Modal
          title={`查看：${viewFileName}`}
          open={!!viewFileContent}
          onCancel={() => { setViewFileContent(null); setViewFileName('') }}
          footer={null}
          width={640}
          destroyOnClose
          styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        >
          <pre style={{ maxHeight: '60vh', overflow: 'auto', fontSize: 12, background: '#f5f5f5', padding: 12, borderRadius: 4, margin: 0 }}>{viewFileContent}</pre>
        </Modal>
        <Modal
          title="另存为文件"
          open={saveAsModalOpen}
          onCancel={() => { setSaveAsModalOpen(false); setSaveAsFilename('') }}
          onOk={handleSaveAsFile}
          okText="保存"
          cancelText="取消"
          destroyOnClose
        >
          <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 8 }}>文件名（.json 可省略）：</div>
            <Input
              placeholder="例如：项目A_报价.json"
              value={saveAsFilename}
              onChange={(e) => setSaveAsFilename(e.target.value)}
              onPressEnter={handleSaveAsFile}
            />
          </div>
        </Modal>
        <Modal
          title="覆盖更新文件"
          open={!!updateTargetFilename}
          onCancel={() => setUpdateTargetFilename(null)}
          onOk={confirmOverwriteFile}
          okText="覆盖"
          cancelText="取消"
        >
          <Typography.Paragraph>
            将用当前表格中的 {list.length} 条数据覆盖文件「{updateTargetFilename}」，是否继续？
          </Typography.Paragraph>
        </Modal>
        {parseResult.status === 'success' && (
          <Alert
            type="success"
            showIcon
            message={`解析成功，共 ${parseResult.count ?? list.length} 条。请审阅或编辑后点击「存入数据库」。`}
            style={{ marginBottom: 16 }}
          />
        )}
        {parseResult.status === 'error' && (
          <Alert type="error" showIcon message={parseResult.message} style={{ marginBottom: 16 }} />
        )}
        {list.length > 0 && (
          <>
            <div style={{ marginBottom: 12 }}>
              <Segmented
                options={[
                  { label: '表格', value: 'table' },
                  { label: '数据结构预览', value: 'json' },
                ]}
                value={displayMode}
                onChange={(v) => setDisplayMode(v as 'table' | 'json')}
              />
            </div>
            {displayMode === 'table' && (
              <div style={{ minHeight: 420 }}>
                <Table
                  size="small"
                  rowKey="_key"
                  pagination={false}
                  scroll={{ x: 1400, y: 420 }}
                  columns={columns}
                  dataSource={listWithKeys}
                />
              </div>
            )}
            {displayMode === 'json' && (
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  background: 'var(--ant-colorFillQuaternary)',
                  borderRadius: 6,
                  fontSize: 12,
                  maxHeight: 480,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {JSON.stringify(
                  list.map(({ _key, ...rest }) => rest),
                  null,
                  2,
                )}
              </pre>
            )}
          </>
        )}
        {list.length === 0 && (
          <Typography.Text type="secondary">
            {parseResult.status === 'idle'
              ? '暂无数据。请在上方上传文件并点击「清单解析」或「加载测试数据」，也可点击右侧「新增一行」添加数据。'
              : '暂无数据。可点击右侧「新增一行」添加，或重新解析/加载数据。'}
          </Typography.Text>
        )}
      </Card>
    </div>
  )
}

export default DocTasksPage
