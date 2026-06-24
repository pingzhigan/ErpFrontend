/**
 * 研发管理 — 研发待办：紧凑列表行、主附件与跟踪记录（附图）、闭环状态与系统跟踪；上传前浏览器压缩图片。
 */
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  EyeOutlined,
  HistoryOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  RollbackOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import type { UploadProps } from 'antd'
import axios from 'axios'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  buildConstructionAssigneeOptions,
  type AssigneeInactiveRef,
  type AssigneeUserRow,
  labelForAssigneeUsername,
} from '../utils/constructionAssigneeOptions'
import { CompletionTimingCell } from '../utils/overdueCompletionText'
import { compressImageFilesForUpload, compressImageForUpload } from '../utils/compressImageForUpload'

const { Title, Text, Paragraph } = Typography

export type RdResearchTodoRow = {
  id: number
  title: string
  content: string
  assignee_usernames: string
  due_at: string | null
  notes: string
  status: string
  completed_at: string | null
  completed_by: string | null
  completed_overdue?: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  attachment_count?: number
  track_entry_count?: number
}

export type RdTodoAttachmentRow = {
  id: number
  todo_id: number
  file_name: string
  file_path: string
  mime_type: string
  file_size: number
  created_at: string
  created_by: string | null
}

export type RdTodoTrackEntryDto = {
  id: number
  todo_id: number
  content: string
  kind: string
  created_at: string
  created_by: string | null
  attachments: RdTodoTrackAttachmentDto[]
}

export type RdTodoTrackAttachmentDto = {
  id: number
  todo_id: number
  track_entry_id: number
  file_name: string
  file_size: number
  mime_type: string
  created_at: string
  created_by: string | null
}

type StatusFilter = 'all' | 'open' | 'done' | 'overdue_done'

function parseAssigneeList(raw: unknown): string[] {
  try {
    const p = JSON.parse(String(raw ?? '[]')) as unknown
    return Array.isArray(p)
      ? p.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
      : []
  } catch {
    return []
  }
}

function stripHtml(s: string): string {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractImageFilesFromClipboard(e: React.ClipboardEvent): File[] {
  const out: File[] = []
  const cd = e.clipboardData
  if (!cd) return out
  if (cd.files?.length) {
    for (let i = 0; i < cd.files.length; i++) {
      const f = cd.files.item(i)
      if (f && f.type.startsWith('image/')) out.push(f)
    }
  }
  if (out.length === 0 && cd.items) {
    for (let i = 0; i < cd.items.length; i++) {
      const it = cd.items[i]
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) out.push(f)
      }
    }
  }
  return out
}

type PendingCreateImage = { key: string; file: File; previewUrl: string }

/** 新增跟踪：待上传附图（最多 3 张） */
const TRACK_EXTRA_MAX_IMAGES = 3
type TrackExtraItem = { key: string; file: File; previewUrl: string }

/** 列表与详情中统一展示日期时间（含截止、完成、更新时间等） */
function formatDateTime(s: string | null | undefined): string {
  if (s == null || !String(s).trim()) return '—'
  const d = dayjs(s)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : String(s)
}

const RdResearchTodosPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const navigate = useNavigate()
  const [list, setList] = useState<RdResearchTodoRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [assigneeRows, setAssigneeRows] = useState<AssigneeUserRow[]>([])
  const [assigneeInactive, setAssigneeInactive] = useState<AssigneeInactiveRef[]>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form] = Form.useForm<{
    title: string
    content: string
    assignees: string[]
    due_at: Dayjs | null
    notes: string
  }>()

  const [viewOpen, setViewOpen] = useState(false)
  const [viewRow, setViewRow] = useState<RdResearchTodoRow | null>(null)
  const viewDrawerTrackRef = useRef<HTMLDivElement | null>(null)

  const [editAttachments, setEditAttachments] = useState<RdTodoAttachmentRow[]>([])
  const [editAttachPreviewUrls, setEditAttachPreviewUrls] = useState<Record<number, string>>({})
  const [viewAttachments, setViewAttachments] = useState<RdTodoAttachmentRow[]>([])
  const [viewAttachPreviewUrls, setViewAttachPreviewUrls] = useState<Record<number, string>>({})

  const [trackEntries, setTrackEntries] = useState<RdTodoTrackEntryDto[]>([])
  const [trackLoading, setTrackLoading] = useState(false)
  const [trackSubmitBusy, setTrackSubmitBusy] = useState(false)
  const [trackAttPreviewUrls, setTrackAttPreviewUrls] = useState<Record<number, string>>({})
  const [trackExtraItems, setTrackExtraItems] = useState<TrackExtraItem[]>([])
  const [trackForm] = Form.useForm<{ track_content: string }>()

  /** 新建待办：确定前暂存的图片（粘贴或选择），保存时与待办一并上传 */
  const [pendingCreateImages, setPendingCreateImages] = useState<PendingCreateImage[]>([])
  const [modalSubmitting, setModalSubmitting] = useState(false)
  const pasteUploadBusyRef = useRef(false)

  const clearPendingCreateImages = useCallback(() => {
    setPendingCreateImages((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl))
      return []
    })
  }, [])

  const addPendingCreateImages = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    let toStage = imageFiles
    try {
      toStage = await compressImageFilesForUpload(imageFiles)
    } catch {
      /* 压缩失败则使用原图 */
    }
    setPendingCreateImages((prev) => {
      const next = [...prev]
      for (const file of toStage) {
        next.push({
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        })
      }
      return next
    })
  }, [])

  const removePendingCreateImage = useCallback((key: string) => {
    setPendingCreateImages((prev) => {
      const hit = prev.find((p) => p.key === key)
      if (hit) URL.revokeObjectURL(hit.previewUrl)
      return prev.filter((p) => p.key !== key)
    })
  }, [])

  const postAttachment = useCallback(async (todoId: number, file: File) => {
    const compressed = await compressImageForUpload(file)
    const fd = new FormData()
    fd.append('file', compressed)
    await axios.post(`/api/rd/todos/${todoId}/attachments`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  }, [])

  const loadAssigneeOptions = useCallback(async () => {
    try {
      const res = await axios.get<{ list: AssigneeUserRow[]; inactive_referenced?: AssigneeInactiveRef[] }>(
        '/api/rd/todo-assignee-options',
      )
      setAssigneeRows(res.data?.list ?? [])
      setAssigneeInactive(res.data?.inactive_referenced ?? [])
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载负责人列表失败')
      setAssigneeRows([])
      setAssigneeInactive([])
    }
  }, [msg])

  useEffect(() => {
    void loadAssigneeOptions()
  }, [loadAssigneeOptions])

  const assigneeSelectOptions = useMemo(
    () => buildConstructionAssigneeOptions(assigneeRows, assigneeInactive),
    [assigneeRows, assigneeInactive],
  )

  const assigneeLabelByUser = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of assigneeSelectOptions) m.set(o.value, o.label)
    return m
  }, [assigneeSelectOptions])

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { limit: pageSize, offset: (page - 1) * pageSize }
      if (keyword.trim()) params.keyword = keyword.trim()
      if (statusFilter !== 'all') {
        if (statusFilter === 'overdue_done') params.list_status = 'overdue_done'
        else params.status = statusFilter
      }
      const res = await axios.get<{ list: RdResearchTodoRow[]; total: number }>('/api/rd/todos', { params })
      setList(res.data?.list ?? [])
      setTotal(res.data?.total ?? 0)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, keyword, statusFilter, msg])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const loadEditAttachmentsById = useCallback(async (todoId: number) => {
    try {
      const res = await axios.get<{ list: RdTodoAttachmentRow[] }>(`/api/rd/todos/${todoId}/attachments`)
      setEditAttachments(res.data?.list ?? [])
    } catch {
      setEditAttachments([])
    }
  }, [])

  const loadViewAttachmentsById = useCallback(async (todoId: number) => {
    try {
      const res = await axios.get<{ list: RdTodoAttachmentRow[] }>(`/api/rd/todos/${todoId}/attachments`)
      setViewAttachments(res.data?.list ?? [])
    } catch {
      setViewAttachments([])
    }
  }, [])

  useEffect(() => {
    if (!modalOpen || editingId == null) {
      setEditAttachments([])
      setEditAttachPreviewUrls((prev) => {
        Object.values(prev).forEach(URL.revokeObjectURL)
        return {}
      })
      return
    }
    void loadEditAttachmentsById(editingId)
  }, [modalOpen, editingId, loadEditAttachmentsById])

  useEffect(() => {
    if (editAttachments.length === 0) {
      setEditAttachPreviewUrls((prev) => {
        Object.values(prev).forEach(URL.revokeObjectURL)
        return {}
      })
      return
    }
    let cancelled = false
    void (async () => {
      const next: Record<number, string> = {}
      for (const a of editAttachments) {
        if (cancelled) break
        try {
          const res = await axios.get(`/api/rd/todo-attachments/${a.id}/preview`, { responseType: 'blob' })
          next[a.id] = URL.createObjectURL(res.data)
        } catch {
          /* skip */
        }
      }
      if (!cancelled) {
        setEditAttachPreviewUrls((prev) => {
          Object.values(prev).forEach(URL.revokeObjectURL)
          return next
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editAttachments])

  useEffect(() => {
    if (!viewOpen || viewRow == null) {
      setViewAttachments([])
      setViewAttachPreviewUrls((prev) => {
        Object.values(prev).forEach(URL.revokeObjectURL)
        return {}
      })
      return
    }
    void loadViewAttachmentsById(viewRow.id)
  }, [viewOpen, viewRow, loadViewAttachmentsById])

  useEffect(() => {
    if (viewAttachments.length === 0) {
      setViewAttachPreviewUrls((prev) => {
        Object.values(prev).forEach(URL.revokeObjectURL)
        return {}
      })
      return
    }
    let cancelled = false
    void (async () => {
      const next: Record<number, string> = {}
      for (const a of viewAttachments) {
        if (cancelled) break
        try {
          const res = await axios.get(`/api/rd/todo-attachments/${a.id}/preview`, { responseType: 'blob' })
          next[a.id] = URL.createObjectURL(res.data)
        } catch {
          /* skip */
        }
      }
      if (!cancelled) {
        setViewAttachPreviewUrls((prev) => {
          Object.values(prev).forEach(URL.revokeObjectURL)
          return next
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [viewAttachments])

  const loadTrackEntriesByTodoId = useCallback(async (todoId: number) => {
    setTrackLoading(true)
    try {
      const res = await axios.get<{ list: RdTodoTrackEntryDto[] }>(`/api/rd/todos/${todoId}/track-entries`)
      setTrackEntries(res.data?.list ?? [])
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载跟踪记录失败')
      setTrackEntries([])
    } finally {
      setTrackLoading(false)
    }
  }, [msg])

  useEffect(() => {
    if (!viewOpen || viewRow == null) {
      setTrackEntries([])
      setTrackAttPreviewUrls((prev) => {
        Object.values(prev).forEach(URL.revokeObjectURL)
        return {}
      })
      return
    }
    void loadTrackEntriesByTodoId(viewRow.id)
  }, [viewOpen, viewRow, loadTrackEntriesByTodoId])

  useEffect(() => {
    const ids: number[] = []
    for (const e of trackEntries) {
      for (const a of e.attachments ?? []) ids.push(a.id)
    }
    if (ids.length === 0) {
      setTrackAttPreviewUrls((prev) => {
        Object.values(prev).forEach(URL.revokeObjectURL)
        return {}
      })
      return
    }
    let cancelled = false
    void (async () => {
      const next: Record<number, string> = {}
      for (const id of ids) {
        if (cancelled) break
        try {
          const res = await axios.get(`/api/rd/todo-track-attachments/${id}/preview`, { responseType: 'blob' })
          next[id] = URL.createObjectURL(res.data)
        } catch {
          /* skip */
        }
      }
      if (!cancelled) {
        setTrackAttPreviewUrls((prev) => {
          Object.values(prev).forEach(URL.revokeObjectURL)
          return next
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [trackEntries])

  /** 跟踪附图：压缩后加入列表，最多 3 张 */
  const appendTrackExtraImages = useCallback(async (files: File[]): Promise<{ added: number; skipped: number }> => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return { added: 0, skipped: 0 }
    let toAdd = imageFiles
    try {
      toAdd = await compressImageFilesForUpload(imageFiles)
    } catch {
      /* 压缩失败则使用原图 */
    }

    let added = 0
    let skipped = 0
    flushSync(() => {
      setTrackExtraItems((prev) => {
        const room = Math.max(0, TRACK_EXTRA_MAX_IMAGES - prev.length)
        if (room === 0) {
          skipped = toAdd.length
          return prev
        }
        const slice = toAdd.slice(0, room)
        skipped = toAdd.length - slice.length
        const next: TrackExtraItem[] = slice.map((file) => ({
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        }))
        added = next.length
        return [...prev, ...next]
      })
    })
    return { added, skipped }
  }, [])

  const removeTrackExtraItem = useCallback((key: string) => {
    setTrackExtraItems((prev) => {
      const hit = prev.find((x) => x.key === key)
      if (hit) URL.revokeObjectURL(hit.previewUrl)
      return prev.filter((x) => x.key !== key)
    })
  }, [])

  const clearTrackExtraItems = useCallback(() => {
    setTrackExtraItems((prev) => {
      prev.forEach((x) => URL.revokeObjectURL(x.previewUrl))
      return []
    })
  }, [])

  const closeViewDrawer = () => {
    setViewOpen(false)
    setViewRow(null)
    clearTrackExtraItems()
    trackForm.resetFields()
  }

  const submitTrackRecord = async () => {
    if (!viewRow) return
    const content = (trackForm.getFieldValue('track_content') ?? '').trim()
    if (!content && trackExtraItems.length === 0) {
      msg.warning('请填写跟踪内容或选择图片')
      return
    }
    setTrackSubmitBusy(true)
    try {
      const fd = new FormData()
      fd.append('content', content)
      const compressed = await compressImageFilesForUpload(trackExtraItems.map((x) => x.file))
      for (const f of compressed) {
        fd.append('file', f)
      }
      await axios.post(`/api/rd/todos/${viewRow.id}/track-entries`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      msg.success('已添加跟踪记录')
      trackForm.resetFields()
      clearTrackExtraItems()
      void loadTrackEntriesByTodoId(viewRow.id)
      void fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setTrackSubmitBusy(false)
    }
  }

  const deleteTrackEntry = async (entryId: number) => {
    if (!viewRow) return
    try {
      await axios.delete(`/api/rd/todos/${viewRow.id}/track-entries/${entryId}`)
      msg.success('已删除记录')
      void loadTrackEntriesByTodoId(viewRow.id)
      void fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const deleteTrackAttachment = async (attId: number) => {
    try {
      await axios.delete(`/api/rd/todo-track-attachments/${attId}`)
      msg.success('已删除图片')
      if (viewRow) void loadTrackEntriesByTodoId(viewRow.id)
      void fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const fillFormFromRow = (row: RdResearchTodoRow) => {
    const assignees = parseAssigneeList(row.assignee_usernames)
    form.setFieldsValue({
      title: row.title,
      content: row.content || '',
      assignees,
      due_at: row.due_at && dayjs(row.due_at).isValid() ? dayjs(row.due_at) : null,
      notes: row.notes || '',
    })
  }

  const openCreate = () => {
    setEditingId(null)
    clearPendingCreateImages()
    form.resetFields()
    form.setFieldsValue({
      title: '',
      content: '',
      assignees: [],
      due_at: null,
      notes: '',
    })
    setModalOpen(true)
  }

  const openEdit = (row: RdResearchTodoRow) => {
    setEditingId(row.id)
    fillFormFromRow(row)
    setModalOpen(true)
  }

  const openView = (row: RdResearchTodoRow) => {
    setViewRow(row)
    setViewOpen(true)
    trackForm.resetFields()
    clearTrackExtraItems()
  }

  /** 打开查看抽屉并滚动到「跟踪」区域（列表行「跟踪」按钮） */
  const openViewFocusTrack = (row: RdResearchTodoRow) => {
    openView(row)
    window.setTimeout(() => {
      viewDrawerTrackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 280)
  }

  const closeModal = () => {
    clearPendingCreateImages()
    setEditAttachPreviewUrls((prev) => {
      Object.values(prev).forEach(URL.revokeObjectURL)
      return {}
    })
    setEditAttachments([])
    setModalOpen(false)
    setEditingId(null)
  }

  const handleSubmit = async () => {
    try {
      const v = await form.validateFields()
      const payload = {
        title: v.title.trim(),
        content: (v.content ?? '').trim(),
        assignee_usernames: v.assignees ?? [],
        due_at: v.due_at && v.due_at.isValid() ? v.due_at.format('YYYY-MM-DDTHH:mm:ss') : null,
        notes: v.notes ?? '',
      }
      if (!payload.content) {
        msg.error('请填写具体内容')
        return
      }
      setModalSubmitting(true)
      if (editingId) {
        await axios.put(`/api/rd/todos/${editingId}`, payload)
        msg.success('已保存')
        closeModal()
      } else {
        const pendingSnapshot = [...pendingCreateImages]
        const res = await axios.post<RdResearchTodoRow>('/api/rd/todos', { ...payload, status: 'open' })
        const newId = Number((res.data as RdResearchTodoRow | undefined)?.id)
        if (!Number.isInteger(newId) || newId < 1) {
          msg.error('创建失败')
          return
        }
        for (const p of pendingSnapshot) {
          try {
            await postAttachment(newId, p.file)
          } catch (e: unknown) {
            const m =
              (e as { response?: { data?: { message?: string } } })?.response?.data?.message || '上传失败'
            msg.error(`待办已创建，图片上传失败：${m}。请使用下方「上传图片」重试。`)
            setEditingId(newId)
            clearPendingCreateImages()
            void loadEditAttachmentsById(newId)
            void fetchList()
            return
          }
        }
        clearPendingCreateImages()
        msg.success(pendingSnapshot.length > 0 ? '已创建（含图片）' : '已创建')
        closeModal()
      }
      void fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setModalSubmitting(false)
    }
  }

  const handleContentPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles = extractImageFilesFromClipboard(e)
      if (imageFiles.length === 0) return
      e.preventDefault()
      if (editingId != null) {
        const id = editingId
        if (pasteUploadBusyRef.current) return
        pasteUploadBusyRef.current = true
        void (async () => {
          try {
            for (const f of imageFiles) {
              await postAttachment(id, f)
            }
            msg.success(`已添加 ${imageFiles.length} 张图片`)
            void loadEditAttachmentsById(id)
            void fetchList()
          } catch (err: unknown) {
            msg.error(
              (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '上传失败',
            )
          } finally {
            pasteUploadBusyRef.current = false
          }
        })()
      } else {
        void addPendingCreateImages(imageFiles)
        msg.success(`已加入 ${imageFiles.length} 张图片，保存待办时将一并上传`)
      }
    },
    [editingId, postAttachment, msg, loadEditAttachmentsById, fetchList, addPendingCreateImages],
  )

  const handleTrackPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles = extractImageFilesFromClipboard(e)
      if (imageFiles.length === 0) return
      e.preventDefault()
      void (async () => {
        const { added, skipped } = await appendTrackExtraImages(imageFiles)
        if (added > 0) {
          msg.success(`已加入 ${added} 张附图（已压缩，保存跟踪时上传）`)
        }
        if (skipped > 0) {
          msg.warning(`附图最多 ${TRACK_EXTRA_MAX_IMAGES} 张，已忽略多余 ${skipped} 张`)
        }
      })()
    },
    [appendTrackExtraImages, msg],
  )

  const createPendingUploadProps: UploadProps = useMemo(
    () => ({
      name: 'file',
      multiple: true,
      showUploadList: false,
      accept: 'image/*',
      customRequest: async (options) => {
        const file = options.file as File
        if (!file.type.startsWith('image/')) {
          msg.error('仅支持图片')
          options.onError?.(new Error('类型无效'))
          return
        }
        try {
          await addPendingCreateImages([file])
          options.onSuccess?.({}, new XMLHttpRequest())
        } catch {
          options.onError?.(new Error('处理失败'))
        }
      },
    }),
    [addPendingCreateImages, msg],
  )

  const deleteEditAttachment = async (attId: number) => {
    try {
      await axios.delete(`/api/rd/todo-attachments/${attId}`)
      msg.success('已删除附件')
      if (editingId != null) void loadEditAttachmentsById(editingId)
      void fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const editUploadProps: UploadProps = useMemo(() => {
    if (editingId == null) return { disabled: true, showUploadList: false }
    return {
      name: 'file',
      multiple: true,
      showUploadList: false,
      accept: 'image/*',
      disabled: false,
      customRequest: async (options) => {
        const { file, onError, onSuccess } = options
        try {
          await postAttachment(editingId, file as File)
          msg.success('图片已上传')
          onSuccess?.({}, new XMLHttpRequest())
          void loadEditAttachmentsById(editingId)
          void fetchList()
        } catch (e: unknown) {
          msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '上传失败')
          onError?.(e as Error)
        }
      },
    }
  }, [editingId, msg, loadEditAttachmentsById, fetchList, postAttachment])

  const setRowStatus = async (row: RdResearchTodoRow, next: 'open' | 'done') => {
    if (row.status === next) return
    try {
      await axios.put(`/api/rd/todos/${row.id}`, { status: next })
      msg.success(next === 'done' ? '已标记为已完成' : '已重新打开')
      if (viewOpen && viewRow?.id === row.id) {
        void loadTrackEntriesByTodoId(row.id)
      }
      void fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '更新失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`/api/rd/todos/${id}`)
      msg.success('已删除')
      void fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const statusTag = (row: RdResearchTodoRow) => {
    const done = row.status === 'done'
    if (done && row.completed_overdue) {
      return (
        <Tag color="orange" className="rd-todo-status-tag">
          过期完成
        </Tag>
      )
    }
    if (done) {
      return (
        <Tag icon={<CheckCircleOutlined />} color="success" className="rd-todo-status-tag">
          已完成
        </Tag>
      )
    }
    return (
      <Tag icon={<ClockCircleOutlined />} color="processing" className="rd-todo-status-tag">
        进行中
      </Tag>
    )
  }

  const renderTodoListHead = () => (
    <div className="rd-todo-list-head rd-todo-list-cols" role="row">
      <div className="rd-todo-list-head__accent" aria-hidden />
      <div className="rd-todo-list-head__col" role="columnheader">
        主题
      </div>
      <div className="rd-todo-list-head__col" role="columnheader">
        具体内容
      </div>
      <div className="rd-todo-list-head__col rd-todo-list-head__col--narrow" role="columnheader">
        状态
      </div>
      <div className="rd-todo-list-head__col" role="columnheader">
        负责人
      </div>
      <div className="rd-todo-list-head__col" role="columnheader">
        截止
      </div>
      <div className="rd-todo-list-head__col" role="columnheader">
        更新
      </div>
      <div className="rd-todo-list-head__col rd-todo-list-head__col--narrow" role="columnheader">
        主图
      </div>
      <div className="rd-todo-list-head__col" role="columnheader">
        备注
      </div>
      <div className="rd-todo-list-head__col rd-todo-list-head__col--actions" role="columnheader">
        操作
      </div>
    </div>
  )

  const renderTodoListRow = (row: RdResearchTodoRow) => {
    const done = row.status === 'done'
    const titleText = (row.title && String(row.title).trim()) || '—'
    const contentRaw = row.content && String(row.content).trim() ? String(row.content).trim() : ''
    const notesRaw = row.notes != null && String(row.notes).trim() ? String(row.notes).trim() : ''
    const notesPlain = notesRaw.includes('<') ? stripHtml(notesRaw) : notesRaw
    const us = parseAssigneeList(row.assignee_usernames)
    const nAtt = Number(row.attachment_count ?? 0)
    const nTrack = Number(row.track_entry_count ?? 0)
    const hasAtt = Number.isFinite(nAtt) && nAtt > 0
    const assigneeLine =
      us.length === 0
        ? '未指定负责人'
        : us.map((u) => assigneeLabelByUser.get(u) ?? labelForAssigneeUsername(u, null)).join('、')

    return (
      <div
        key={row.id}
        className={`rd-todo-row rd-todo-list-cols rd-todo-row--${done ? 'done' : 'open'}`}
        role="button"
        tabIndex={0}
        onClick={() => openView(row)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openView(row)
          }
        }}
      >
        <div className="rd-todo-row__accent" aria-hidden />
        <div className="rd-todo-row__col rd-todo-row__col--title">
          <Text strong className="rd-todo-row__title" ellipsis={{ tooltip: titleText }}>
            {titleText}
          </Text>
        </div>
        <div className="rd-todo-row__col rd-todo-row__col--content">
          {contentRaw ? (
            <Paragraph type="secondary" className="rd-todo-row__excerpt" ellipsis={{ rows: 2, tooltip: true }}>
              {contentRaw}
            </Paragraph>
          ) : (
            <Text type="secondary" className="rd-todo-row__excerpt rd-todo-row__excerpt--muted" ellipsis>
              无具体内容
            </Text>
          )}
        </div>
        <div className="rd-todo-row__col rd-todo-row__col--status">{statusTag(row)}</div>
        <div className="rd-todo-row__col rd-todo-row__col--assignee">
          <Text type="secondary" className="rd-todo-row__cell-text" ellipsis={{ tooltip: assigneeLine }}>
            {assigneeLine}
          </Text>
        </div>
        <div className="rd-todo-row__col rd-todo-row__col--due">
          <Text type="secondary" className="rd-todo-row__cell-text" ellipsis>
            {row.due_at && String(row.due_at).trim() ? formatDateTime(row.due_at) : '无'}
          </Text>
        </div>
        <div className="rd-todo-row__col rd-todo-row__col--updated">
          <Text type="secondary" className="rd-todo-row__cell-text" ellipsis={{ tooltip: true }}>
            {done
              ? `${row.completed_by || '—'} · ${formatDateTime(row.completed_at)}`
              : `${row.updated_by || '—'} · ${formatDateTime(row.updated_at)}`}
          </Text>
        </div>
        <div className="rd-todo-row__col rd-todo-row__col--attach">
          {hasAtt ? (
            <Tag icon={<PaperClipOutlined />} color="cyan" className="rd-todo-row__inline-tag">
              {nAtt}
            </Tag>
          ) : (
            <Text type="secondary" className="rd-todo-row__cell-text rd-todo-row__cell-text--muted">
              —
            </Text>
          )}
        </div>
        <div className="rd-todo-row__col rd-todo-row__col--notes">
          {notesPlain ? (
            <Text type="secondary" className="rd-todo-row__excerpt" ellipsis={{ tooltip: true }}>
              {notesPlain}
            </Text>
          ) : (
            <Text type="secondary" className="rd-todo-row__cell-text rd-todo-row__cell-text--muted">
              —
            </Text>
          )}
        </div>
        <div className="rd-todo-row__col rd-todo-row__col--actions" role="presentation" onClick={(e) => e.stopPropagation()}>
          <Space size={0} wrap className="rd-todo-row__action-icons">
            <Tooltip title="查看详情">
              <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openView(row)} />
            </Tooltip>
            <Tooltip title="编辑待办">
              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
            </Tooltip>
            <Popconfirm title="确定删除该待办？" okText="删除" cancelText="取消" onConfirm={() => void handleDelete(row.id)}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="删除" />
            </Popconfirm>
          </Space>
          <Space size={4} wrap className="rd-todo-row__action-btns">
            {done ? (
              <Button
                type="default"
                size="small"
                icon={<RollbackOutlined />}
                onClick={() => void setRowStatus(row, 'open')}
              >
                重新打开
              </Button>
            ) : (
              <Popconfirm
                title="确定将该待办标记为已完成？"
                description="完成后可在「已完成」中查看，也可再点「重新打开」。"
                okText="确定完成"
                cancelText="取消"
                onConfirm={() => void setRowStatus(row, 'done')}
              >
                <Button type="primary" size="small" icon={<CheckCircleOutlined />} onClick={(e) => e.stopPropagation()}>
                  完成
                </Button>
              </Popconfirm>
            )}
            <Button
              color="primary"
              variant="link"
              size="small"
              icon={<HistoryOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                openViewFocusTrack(row)
              }}
            >
              跟踪{nTrack > 0 ? `(${nTrack})` : ''}
            </Button>
          </Space>
        </div>
      </div>
    )
  }

  const segmentedOptions = useMemo(
    () =>
      [
        {
          value: 'open' as const,
          label: (
            <span className="rd-todo-seg-open">
              <ClockCircleOutlined /> 进行中
            </span>
          ),
        },
        {
          value: 'done' as const,
          label: (
            <span className="rd-todo-seg-done">
              <CheckCircleOutlined /> 已完成
            </span>
          ),
        },
        { value: 'overdue_done' as const, label: '过期完成' },
        { value: 'all' as const, label: '全部' },
      ] as const,
    [],
  )

  return (
    <div className="page-content-wrap rd-todo-page" style={{ width: '100%' }}>
      <div className="page-header-banner">
        <div className="header-left">
          <div className="header-icon-wrap">
            <ExperimentOutlined />
          </div>
          <div>
            <Title level={4} className="header-title" style={{ marginBottom: 0 }}>
              研发待办
            </Title>
            <Text type="secondary" className="header-desc" style={{ display: 'block' }}>
              默认显示全部；可用分段筛选进行中 / 已完成。表头与各列对齐，内容区最多两行，窄屏可横向滚动整表。点击行在右侧抽屉查看详情与跟踪；右侧可完成或打开跟踪区。
            </Text>
          </div>
        </div>
      </div>

      <Card
        className="section-card section-card-accent-blue"
        title={
          <span>
            <ClockCircleOutlined style={{ marginRight: 8, color: 'var(--ant-colorPrimary)' }} />
            待办列表
            {total > 0 ? (
              <Text type="secondary" style={{ marginLeft: 8, fontWeight: 400, fontSize: 13 }}>
                共 {total} 条
              </Text>
            ) : null}
          </span>
        }
        extra={
          <Space wrap>
            <Button onClick={() => navigate('/rd/task-timeout')}>任务超时管理</Button>
            <Button onClick={() => navigate('/rd/efficiency')}>效率评估</Button>
            <Button icon={<ReloadOutlined />} onClick={() => void fetchList()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建
            </Button>
          </Space>
        }
      >
        <div className="rd-todo-toolbar">
          <div className="rd-todo-toolbar-filters">
            <Segmented<StatusFilter>
              className="rd-todo-filter-segmented"
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v)
                setPage(1)
              }}
              options={[...segmentedOptions]}
            />
            <Input.Search
              className="rd-todo-toolbar-search"
              allowClear
              placeholder="主题 / 内容 / 备注 / 负责人"
              onSearch={(v) => {
                setKeyword(v)
                setPage(1)
              }}
              enterButton
            />
          </div>
        </div>
        <Spin spinning={loading}>
          {list.length === 0 && !loading ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待办" />
          ) : (
            <div className="rd-todo-list-shell">
              <div className="rd-todo-list rd-todo-list--bordered">
                {renderTodoListHead()}
                {list.map((row) => renderTodoListRow(row))}
              </div>
            </div>
          )}
        </Spin>
        {total > 0 ? (
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger
              showTotal={(t) => `共 ${t} 条`}
              onChange={(p, ps) => {
                setPage(p)
                setPageSize(ps)
              }}
            />
          </div>
        ) : null}
      </Card>

      <Modal
        title={editingId ? '编辑待办' : '新建待办'}
        open={modalOpen}
        onOk={() => void handleSubmit()}
        onCancel={closeModal}
        width={640}
        destroyOnHidden
        confirmLoading={modalSubmitting}
        afterOpenChange={(open) => {
          if (!open) return
          if (editingId == null) {
            form.resetFields()
            form.setFieldsValue({
              title: '',
              content: '',
              assignees: [],
              due_at: null,
              notes: '',
            })
          } else {
            const row = list.find((r) => r.id === editingId)
            if (row) fillFormFromRow(row)
          }
        }}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="title" label="主题名称" rules={[{ required: true, message: '请输入主题名称' }]}>
            <Input placeholder="简要概括待办主题" maxLength={500} showCount />
          </Form.Item>
          <Form.Item
            name="content"
            label="具体内容"
            rules={[
              { required: true, message: '请填写具体内容' },
              { whitespace: true, message: '具体内容不能只含空格' },
            ]}
          >
            <Input.TextArea
              rows={4}
              placeholder="任务说明、验收标准等（必填）；可直接在框内粘贴截图，图片与待办一并保存"
              maxLength={50000}
              showCount
              onPaste={handleContentPaste}
            />
          </Form.Item>
          <Form.Item name="assignees" label="负责人员">
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选择一位或多位负责人"
              options={assigneeSelectOptions}
            />
          </Form.Item>
          <Form.Item name="due_at" label="截止日期时间">
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} placeholder="不选表示无截止时间" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="补充备注（纯文本）" maxLength={20000} showCount />
          </Form.Item>
          <Form.Item label="图片附件">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                在「具体内容」中可直接粘贴截图；也可在此选择图片（上传前在浏览器内自动压缩）。
                {editingId == null ? '点击「确定」创建待办时一并上传。' : null}
              </Typography.Text>
              {editingId != null ? (
                <Upload {...editUploadProps}>
                  <Button icon={<UploadOutlined />} size="small">
                    上传图片
                  </Button>
                </Upload>
              ) : (
                <Upload {...createPendingUploadProps}>
                  <Button icon={<UploadOutlined />} size="small">
                    选择图片
                  </Button>
                </Upload>
              )}
              {editingId == null && pendingCreateImages.length > 0 && (
                <Space wrap size="middle">
                  {pendingCreateImages.map((p) => (
                    <div key={p.key} style={{ position: 'relative', width: 92 }}>
                      <Image
                        width={88}
                        height={88}
                        src={p.previewUrl}
                        alt={p.file.name}
                        style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
                      />
                      <div style={{ textAlign: 'center', marginTop: 4 }}>
                        <Popconfirm title="从待上传列表移除？" onConfirm={() => removePendingCreateImage(p.key)}>
                          <Button type="link" size="small" danger>
                            移除
                          </Button>
                        </Popconfirm>
                      </div>
                    </div>
                  ))}
                </Space>
              )}
              {editingId != null && editAttachments.length > 0 && (
                <Space wrap size="middle">
                  {editAttachments.map((a) => (
                    <div key={a.id} style={{ position: 'relative', width: 92 }}>
                      {editAttachPreviewUrls[a.id] ? (
                        <Image
                          width={88}
                          height={88}
                          src={editAttachPreviewUrls[a.id]}
                          alt={a.file_name}
                          style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 88,
                            height: 88,
                            borderRadius: 6,
                            border: '1px dashed #d9d9d9',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            color: '#999',
                          }}
                        >
                          加载中
                        </div>
                      )}
                      <div style={{ textAlign: 'center', marginTop: 4 }}>
                        <Popconfirm title="删除该图片？" onConfirm={() => void deleteEditAttachment(a.id)}>
                          <Button type="link" size="small" danger>
                            删除
                          </Button>
                        </Popconfirm>
                      </div>
                    </div>
                  ))}
                </Space>
              )}
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={viewRow ? `待办详情 · ${viewRow.title}` : '待办详情'}
        placement="right"
        width={Math.min(720, typeof window !== 'undefined' ? window.innerWidth - 24 : 720)}
        open={viewOpen}
        onClose={closeViewDrawer}
        destroyOnHidden
      >
        {viewRow ? (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="状态">{statusTag(viewRow)}</Descriptions.Item>
              {viewRow.status === 'done' ? (
                <Descriptions.Item label="完成情况">
                  <CompletionTimingCell
                    dueAt={viewRow.due_at}
                    completedAt={viewRow.completed_at}
                    completedOverdue={Boolean(viewRow.completed_overdue)}
                  />
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label="主题名称">{viewRow.title}</Descriptions.Item>
              <Descriptions.Item label="具体内容">
                <div style={{ whiteSpace: 'pre-wrap' }}>{viewRow.content?.trim() ? viewRow.content : '—'}</div>
              </Descriptions.Item>
              <Descriptions.Item label="负责人员">
                {parseAssigneeList(viewRow.assignee_usernames).length === 0 ? (
                  '—'
                ) : (
                  <Space size={[4, 4]} wrap>
                    {parseAssigneeList(viewRow.assignee_usernames).map((u) => (
                      <Tag key={u} color="blue">
                        {assigneeLabelByUser.get(u) ?? labelForAssigneeUsername(u, null)}
                      </Tag>
                    ))}
                  </Space>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="截止时间">{formatDateTime(viewRow.due_at)}</Descriptions.Item>
              <Descriptions.Item label="备注">
                {viewRow.notes?.trim() ? (
                  <div style={{ whiteSpace: 'pre-wrap' }}>
                    {viewRow.notes.includes('<') ? stripHtml(viewRow.notes) : viewRow.notes}
                  </div>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              {viewAttachments.length > 0 && (
                <Descriptions.Item label="图片附件">
                  <Image.PreviewGroup>
                    <Space wrap>
                      {viewAttachments.map((a) =>
                        viewAttachPreviewUrls[a.id] ? (
                          <Image
                            key={a.id}
                            width={120}
                            src={viewAttachPreviewUrls[a.id]}
                            alt={a.file_name}
                            style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
                          />
                        ) : null,
                      )}
                    </Space>
                  </Image.PreviewGroup>
                </Descriptions.Item>
              )}
              {viewRow.status === 'done' && (
                <Descriptions.Item label="完成信息">
                  {(viewRow.completed_by || '—') + ' · ' + formatDateTime(viewRow.completed_at)}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="更新人 / 时间">
                {(viewRow.updated_by || '—') + ' · ' + formatDateTime(viewRow.updated_at)}
              </Descriptions.Item>
            </Descriptions>

            <Divider style={{ margin: '20px 0 12px' }} />
            <div ref={viewDrawerTrackRef}>
              <Title level={5} style={{ marginTop: 0, marginBottom: 10 }}>
                跟踪记录
              </Title>
              <Space style={{ marginBottom: 12 }} wrap>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  闭环：在列表上切换「完成 / 重新打开」将自动写入一条系统跟踪。
                </Text>
              </Space>
              <Spin spinning={trackLoading}>
                <Timeline
                  className="rd-todo-track-timeline"
                  style={{ marginTop: 8 }}
                  items={[...trackEntries].reverse().map((en) => {
                    const hasAtt = Boolean(en.attachments?.length)
                    return {
                      key: en.id,
                      color: en.kind === 'system' ? 'gray' : 'blue',
                      children: (
                        <div
                          className={`rd-todo-track-entry rd-todo-track-entry--${en.kind === 'system' ? 'system' : 'user'}`}
                        >
                          <div className="rd-todo-track-entry__head">
                            <Text type="secondary" className="rd-todo-track-entry__meta">
                              {en.created_by || '—'} · {formatDateTime(en.created_at)}
                            </Text>
                            <Space size={6} wrap className="rd-todo-track-entry__head-actions">
                              <Tag color={en.kind === 'system' ? 'default' : 'processing'} className="rd-todo-track-entry__kind-tag">
                                {en.kind === 'system' ? '系统' : '用户'}
                              </Tag>
                              {en.kind === 'user' ? (
                                <Popconfirm title="删除整条跟踪记录？" onConfirm={() => void deleteTrackEntry(en.id)}>
                                  <Button type="link" size="small" danger style={{ padding: 0, height: 22 }}>
                                    删除记录
                                  </Button>
                                </Popconfirm>
                              ) : null}
                            </Space>
                          </div>
                          <div
                            className={`rd-todo-track-entry__body${hasAtt ? ' rd-todo-track-entry__body--has-att' : ''}`}
                          >
                            <div className="rd-todo-track-entry__content">
                              {en.content?.trim() ? en.content : '—'}
                            </div>
                            {hasAtt ? (
                              <div className="rd-todo-track-entry__atts">
                                <Image.PreviewGroup>
                                  <Space wrap size={8}>
                                    {en.attachments.map((a) =>
                                      trackAttPreviewUrls[a.id] ? (
                                        <div key={a.id} className="rd-todo-track-entry__thumb-wrap">
                                          <Image
                                            width={80}
                                            height={80}
                                            src={trackAttPreviewUrls[a.id]}
                                            alt={a.file_name}
                                            className="rd-todo-track-entry__thumb"
                                            style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
                                          />
                                          {en.kind === 'user' ? (
                                            <Popconfirm title="删除该图？" onConfirm={() => void deleteTrackAttachment(a.id)}>
                                              <Button
                                                type="text"
                                                size="small"
                                                danger
                                                icon={<DeleteOutlined />}
                                                aria-label="删图"
                                                className="rd-todo-track-entry__thumb-del"
                                              />
                                            </Popconfirm>
                                          ) : null}
                                        </div>
                                      ) : null,
                                    )}
                                  </Space>
                                </Image.PreviewGroup>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ),
                    }
                  })}
                />
              </Spin>
              <Divider style={{ margin: '16px 0' }}>新增跟踪</Divider>
              <Form form={trackForm} layout="vertical">
                <Form.Item name="track_content" label="跟踪说明">
                  <Input.TextArea
                    rows={3}
                    placeholder={`进展、问题、下一步等；可在框内粘贴截图（最多 ${TRACK_EXTRA_MAX_IMAGES} 张，自动压缩）`}
                    maxLength={10000}
                    showCount
                    onPaste={handleTrackPaste}
                  />
                </Form.Item>
                {trackExtraItems.length > 0 ? (
                  <div style={{ marginBottom: 16 }}>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                      附图预览（{trackExtraItems.length}/{TRACK_EXTRA_MAX_IMAGES}）· 点击缩略图查看大图
                    </Text>
                    <Image.PreviewGroup>
                      <Space wrap size="middle">
                        {trackExtraItems.map((it) => (
                          <div key={it.key} style={{ position: 'relative', width: 92 }}>
                            <Image
                              width={84}
                              height={84}
                              src={it.previewUrl}
                              alt={it.file.name}
                              style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
                            />
                            <div style={{ textAlign: 'center', marginTop: 4 }}>
                              <Button type="link" size="small" danger onClick={() => removeTrackExtraItem(it.key)}>
                                移除
                              </Button>
                            </div>
                          </div>
                        ))}
                      </Space>
                    </Image.PreviewGroup>
                  </div>
                ) : null}
                <Form.Item
                  label={
                    <span>
                      附图 <Text type="secondary">（最多 {TRACK_EXTRA_MAX_IMAGES} 张，浏览器侧压缩）</Text>
                    </span>
                  }
                >
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    <Upload
                      multiple
                      accept="image/*"
                      showUploadList={false}
                      disabled={trackExtraItems.length >= TRACK_EXTRA_MAX_IMAGES}
                      beforeUpload={(file) => {
                        void appendTrackExtraImages([file as File]).then(({ added, skipped }) => {
                          if (added > 0) msg.success(`已加入 ${added} 张附图`)
                          if (skipped > 0) {
                            msg.warning(`附图最多 ${TRACK_EXTRA_MAX_IMAGES} 张，未加入 ${skipped} 张`)
                          }
                        })
                        return false
                      }}
                    >
                      <Button icon={<UploadOutlined />} size="small" disabled={trackExtraItems.length >= TRACK_EXTRA_MAX_IMAGES}>
                        选择图片
                      </Button>
                    </Upload>
                    {trackExtraItems.length >= TRACK_EXTRA_MAX_IMAGES ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        已达上限，移除上方预览中的图片后可继续添加。
                      </Text>
                    ) : null}
                  </Space>
                </Form.Item>
                <Button type="primary" loading={trackSubmitBusy} onClick={() => void submitTrackRecord()}>
                  保存跟踪记录
                </Button>
              </Form>
            </div>
          </>
        ) : null}
      </Drawer>
    </div>
  )
}

export default RdResearchTodosPage
