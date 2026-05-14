/**
 * 研发管理 — 研发文档：文件夹树、文档（TipTap HTML）、独立阅读页路由预览；本页不提供文件上传入口；文档在页面内编辑（无弹层）；新建文档仅在保存时落库。
 */
import { DeleteOutlined, DownloadOutlined, EditOutlined, EyeOutlined, FolderAddOutlined, FolderOutlined, PlusOutlined } from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import type { ColumnsType } from 'antd/es/table'
import { App, Alert, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Table, Tree, Typography } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { RdRichHtmlEditor, type RdRichHtmlEditorRef } from '../components/RdRichHtmlEditor'
import { useAuth } from '../auth/AuthContext'
import {
  appendAccessTokenToImgPreviewUrls,
  stripAccessTokenFromImgPreviewUrls,
} from '../utils/rdRichPreviewAuthUrls'
import { sanitizeRdRichBodyHtml } from '../utils/rdRichHtmlSanitize'
import {
  rdBodyHtmlContainsDataImage,
  rdResolveBodyHtmlDataImages,
  rdStripInlineDataImagesForCreate,
} from '../utils/rdRichtextDataImages'

const { Text } = Typography

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

type FolderRow = { id: number; parent_id: number | null; name: string; created_at: string }

export type RdDocFileRow = {
  id: number
  folder_id: number
  file_name: string
  file_path: string
  file_type: string
  mime_type: string
  file_size: number
  created_at: string
  created_by: string | null
  /** 列表接口补充：姓名（用户名） */
  created_by_display?: string
}

export type RdRichtextListRow = {
  id: number
  folder_id: number
  title: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  created_by_display?: string
  updated_by_display?: string
  /** doc-library 等列表：正文内嵌图 + HTML 近似占用（字节） */
  storage_bytes?: number
}

type UnifiedRow =
  | { key: string; kind: 'file'; sortAt: string; file: RdDocFileRow; folder_name?: string }
  | { key: string; kind: 'richtext'; sortAt: string; doc: RdRichtextListRow; folder_name?: string }

const RD_LIBRARY_PAGE_SIZE = 30

type RdDocLibraryItem =
  | { kind: 'file'; folder_name: string; file: RdDocFileRow }
  | { kind: 'richtext'; folder_name: string; doc: RdRichtextListRow }

function mapLibraryItemsToUnifiedRows(list: RdDocLibraryItem[]): UnifiedRow[] {
  return list.map((item) => {
    if (item.kind === 'file') {
      return {
        key: `f-${item.file.id}`,
        kind: 'file',
        sortAt: item.file.created_at,
        file: item.file,
        folder_name: item.folder_name,
      }
    }
    return {
      key: `r-${item.doc.id}`,
      kind: 'richtext',
      sortAt: item.doc.updated_at,
      doc: item.doc,
      folder_name: item.folder_name,
    }
  })
}

type PreviewState = { kind: 'file'; file: RdDocFileRow }

function folderPathLabel(folders: FolderRow[], id: number): string {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const parts: string[] = []
  let cur: FolderRow | undefined = byId.get(id)
  const seen = new Set<number>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    parts.unshift(cur.name)
    cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined
  }
  return parts.length > 0 ? parts.join(' / ') : `id:${id}`
}

function buildTreeData(folders: FolderRow[]): DataNode[] {
  const byParent = new Map<string, FolderRow[]>()
  for (const f of folders) {
    const pk = f.parent_id == null ? 'root' : String(f.parent_id)
    if (!byParent.has(pk)) byParent.set(pk, [])
    byParent.get(pk)!.push(f)
  }
  const sortFn = (a: FolderRow, b: FolderRow) => a.name.localeCompare(b.name, 'zh-CN')
  function build(parentId: number | null): DataNode[] {
    const pk = parentId == null ? 'root' : String(parentId)
    const list = (byParent.get(pk) ?? []).slice().sort(sortFn)
    return list.map((f) => {
      const childNodes = build(f.id)
      const hasKids = childNodes.length > 0
      return {
        key: String(f.id),
        title: f.name,
        icon: <FolderOutlined />,
        isLeaf: !hasKids,
        ...(hasKids ? { children: childNodes } : {}),
      }
    })
  }
  return build(null)
}

const RdResearchDocsPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [folderExpandedKeys, setFolderExpandedKeys] = useState<React.Key[]>([])

  const [libraryPage, setLibraryPage] = useState(1)
  const [libraryTotal, setLibraryTotal] = useState(0)
  const [libraryRows, setLibraryRows] = useState<UnifiedRow[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)

  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [folderModalMode, setFolderModalMode] = useState<'create' | 'rename' | 'move'>('create')
  const [folderForm] = Form.useForm<{ name: string; parent_id?: number }>()
  const [folderEditingId, setFolderEditingId] = useState<number | null>(null)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  const [richEditorOpen, setRichEditorOpen] = useState(false)
  const [richEditingId, setRichEditingId] = useState<number | null>(null)
  const [richTitleForm] = Form.useForm<{ title: string }>()
  /** 与 richEditorMountKey 一起作为 Form key，挂载时写入标题（条件渲染下 setFieldsValue 不可靠） */
  const [richTitleInitial, setRichTitleInitial] = useState('')
  const [richBodyHtml, setRichBodyHtml] = useState('')
  const richEditorRef = useRef<RdRichHtmlEditorRef>(null)
  const [richEditorMountKey, setRichEditorMountKey] = useState(0)
  const [richDraftMode, setRichDraftMode] = useState(false)
  const [storageUsage, setStorageUsage] = useState<{
    usedBytes: number
    quotaBytes: number
    remainingBytes: number
    exceeded: boolean
    warnLowRemaining: boolean
  } | null>(null)

  const [richSaveNoteOpen, setRichSaveNoteOpen] = useState(false)
  const [richSaveNote, setRichSaveNote] = useState('')
  const [moveFileOpen, setMoveFileOpen] = useState(false)
  const [moveFileRow, setMoveFileRow] = useState<RdDocFileRow | null>(null)
  const [moveForm] = Form.useForm<{ target_folder_id: number }>()

  const loadStorageUsage = useCallback(async () => {
    try {
      const res = await axios.get<{
        usedBytes: number
        quotaBytes: number
        remainingBytes?: number
        exceeded: boolean
        warnLowRemaining?: boolean
      }>('/api/rd/doc-storage-usage')
      const u = res.data
      if (u && typeof u.usedBytes === 'number' && typeof u.quotaBytes === 'number') {
        const remaining =
          typeof u.remainingBytes === 'number' && Number.isFinite(u.remainingBytes)
            ? Math.max(0, u.remainingBytes)
            : Math.max(0, u.quotaBytes - u.usedBytes)
        setStorageUsage({
          usedBytes: u.usedBytes,
          quotaBytes: u.quotaBytes,
          remainingBytes: remaining,
          exceeded: Boolean(u.exceeded),
          warnLowRemaining: Boolean(u.warnLowRemaining),
        })
      } else {
        setStorageUsage(null)
      }
    } catch {
      setStorageUsage(null)
    }
  }, [])

  useEffect(() => {
    void loadStorageUsage()
  }, [loadStorageUsage])

  const loadFolders = useCallback(async () => {
    setLoadingFolders(true)
    try {
      const res = await axios.get<{ list: FolderRow[] }>('/api/rd/doc-folders')
      setFolders(res.data?.list ?? [])
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载文件夹失败')
    } finally {
      setLoadingFolders(false)
    }
  }, [msg])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  useEffect(() => {
    if (folders.length === 0) {
      setFolderExpandedKeys([])
      return
    }
    setFolderExpandedKeys(folders.map((f) => String(f.id)))
  }, [folders])

  const loadLibraryPage = useCallback(async (folderId: number | null, page: number) => {
    setLoadingFiles(true)
    try {
      const params: Record<string, string | number> = { page, page_size: RD_LIBRARY_PAGE_SIZE }
      if (folderId != null) params.folder_id = folderId
      const res = await axios.get<{ list: RdDocLibraryItem[]; total: number }>('/api/rd/doc-library', { params })
      setLibraryRows(mapLibraryItemsToUnifiedRows(res.data?.list ?? []))
      setLibraryTotal(Number(res.data?.total ?? 0) || 0)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
      setLibraryRows([])
      setLibraryTotal(0)
    } finally {
      setLoadingFiles(false)
    }
  }, [msg])

  useEffect(() => {
    void loadLibraryPage(selectedFolderId, libraryPage)
  }, [selectedFolderId, libraryPage, loadLibraryPage])

  /** 标题 Form 条件挂载：在布局提交后再写一次，避免 initialValues 与 form 实例组合时偶发不同步 */
  useLayoutEffect(() => {
    if (!richEditorOpen) return
    richTitleForm.setFieldsValue({ title: richTitleInitial })
  }, [richEditorOpen, richEditorMountKey, richTitleInitial, richTitleForm])

  const treeData = useMemo(() => buildTreeData(folders), [folders])

  const defaultRootFolderId = useMemo(() => {
    const r = folders.find((f) => f.parent_id == null && f.name === '研发文档')
    return r?.id ?? null
  }, [folders])

  const effectiveFolderId = selectedFolderId ?? defaultRootFolderId

  const onTreeSelect = (keys: React.Key[]) => {
    setLibraryPage(1)
    const k = keys[0]
    if (k == null) {
      setSelectedFolderId(null)
      return
    }
    const id = Number(k)
    setSelectedFolderId(Number.isInteger(id) && id > 0 ? id : null)
  }

  const openCreateFolder = () => {
    setFolderModalMode('create')
    setFolderEditingId(null)
    folderForm.setFieldsValue({
      name: '',
      parent_id: selectedFolderId ?? undefined,
    })
    setFolderModalOpen(true)
  }

  const openRenameFolder = () => {
    if (selectedFolderId == null) return
    const row = folders.find((f) => f.id === selectedFolderId)
    if (!row) return
    setFolderModalMode('rename')
    setFolderEditingId(row.id)
    folderForm.resetFields()
    folderForm.setFieldsValue({ name: row.name })
    setFolderModalOpen(true)
  }

  const openMoveFolder = () => {
    if (selectedFolderId == null) return
    const row = folders.find((f) => f.id === selectedFolderId)
    if (!row) return
    setFolderModalMode('move')
    setFolderEditingId(row.id)
    folderForm.setFieldsValue({ parent_id: row.parent_id ?? undefined, name: row.name })
    setFolderModalOpen(true)
  }

  const submitFolderModal = async () => {
    try {
      const v = await folderForm.validateFields()
      if (folderModalMode === 'create') {
        await axios.post('/api/rd/doc-folders', { name: v.name, parent_id: v.parent_id ?? null })
        msg.success('已创建文件夹')
      } else if (folderModalMode === 'rename' && folderEditingId) {
        await axios.put(`/api/rd/doc-folders/${folderEditingId}`, { name: v.name })
        msg.success('已重命名')
      } else if (folderModalMode === 'move' && folderEditingId) {
        await axios.put(`/api/rd/doc-folders/${folderEditingId}`, {
          parent_id: v.parent_id ?? null,
          name: v.name,
        })
        msg.success('已移动')
      }
      setFolderModalOpen(false)
      void loadFolders()
      void loadLibraryPage(selectedFolderId, libraryPage)
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    }
  }

  const deleteSelectedFolder = async () => {
    if (selectedFolderId == null) return
    try {
      await axios.delete(`/api/rd/doc-folders/${selectedFolderId}`)
      msg.success('已删除')
      setSelectedFolderId(null)
      setLibraryPage(1)
      void loadFolders()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const openPdfInNewTab = useCallback(
    async (file: RdDocFileRow) => {
      try {
        const res = await axios.get(`/api/rd/doc-files/${file.id}/preview`, { responseType: 'blob' })
        const url = window.URL.createObjectURL(res.data)
        window.open(url, '_blank')
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '打开失败')
      }
    },
    [msg],
  )

  const openPreviewFile = useCallback(
    (file: RdDocFileRow) => {
      if (file.file_type === 'pdf') {
        void openPdfInNewTab(file)
        return
      }
      setPreview({ kind: 'file', file })
      setPreviewOpen(true)
      setPreviewObjectUrl(null)
      setPreviewText('')
    },
    [openPdfInNewTab],
  )

  const openPreviewRichtext = useCallback(
    (doc: RdRichtextListRow) => {
      navigate(`/rd/docs/preview/${doc.id}`)
    },
    [navigate],
  )

  useEffect(() => {
    if (!previewOpen || !preview) return
    let objectUrl: string | null = null
    setPreviewLoading(true)
    const file = preview.file
    if (file.file_type === 'pdf') {
      setPreviewLoading(false)
      return
    }
    const isText = file.file_type === 'md'
    const req = isText
      ? axios.get(`/api/rd/doc-files/${file.id}/preview`, { responseType: 'text' })
      : axios.get(`/api/rd/doc-files/${file.id}/preview`, { responseType: 'blob' })
    req
      .then((res) => {
        if (isText) {
          setPreviewText(typeof res.data === 'string' ? res.data : '')
        } else {
          objectUrl = window.URL.createObjectURL(res.data as Blob)
          setPreviewObjectUrl(objectUrl)
        }
      })
      .catch(() => msg.error('预览加载失败'))
      .finally(() => setPreviewLoading(false))
    return () => {
      if (objectUrl) window.URL.revokeObjectURL(objectUrl)
    }
  }, [previewOpen, preview, msg])

  const closePreview = () => {
    setPreviewOpen(false)
    setPreview(null)
    setPreviewObjectUrl(null)
    setPreviewText('')
  }

  const handleDownload = async (file: RdDocFileRow) => {
    try {
      const res = await axios.get(`/api/rd/doc-files/${file.id}/download`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = file.file_name || 'download'
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '下载失败')
    }
  }

  const downloadRichtextHtml = (title: string, html: string) => {
    const safe = sanitizeRdRichBodyHtml(html)
    const blob = new Blob([safe], { type: 'text/html;charset=utf-8' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[/\\?%*:|"<>]/g, '_') || 'document'}.html`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const deleteFile = async (file: RdDocFileRow) => {
    try {
      await axios.delete(`/api/rd/doc-files/${file.id}`)
      msg.success('已删除')
      void loadLibraryPage(selectedFolderId, libraryPage)
      void loadFolders()
      void loadStorageUsage()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const deleteRichtext = async (id: number) => {
    try {
      await axios.delete(`/api/rd/richtext-docs/${id}`)
      msg.success('已删除')
      void loadLibraryPage(selectedFolderId, libraryPage)
      void loadFolders()
      void loadStorageUsage()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const uploadRichBodyImageForDocId = useCallback(
    async (docId: number, file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await axios.post<{ id: number; url: string }>(`/api/rd/richtext-docs/${docId}/body-images`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      void loadStorageUsage()
      const url = res.data?.url ?? ''
      if (!url) throw new Error('上传未返回图片地址')
      return url
    },
    [loadStorageUsage],
  )

  const uploadRichBodyImage = useCallback(
    async (file: File) => {
      if (richEditingId == null) {
        msg.error('文档未就绪，请稍候再试')
        throw new Error('no id')
      }
      try {
        return await uploadRichBodyImageForDocId(richEditingId, file)
      } catch (e: unknown) {
        const m =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e instanceof Error ? e.message : '上传失败')
        msg.error(m)
        throw e
      }
    },
    [richEditingId, msg, uploadRichBodyImageForDocId],
  )

  const openCreateRichtext = () => {
    if (effectiveFolderId == null) {
      msg.warning('未找到默认根目录「研发文档」，请刷新页面或联系管理员')
      return
    }
    setRichDraftMode(true)
    setRichEditingId(null)
    setRichTitleInitial('')
    setRichBodyHtml('<p></p>')
    setRichEditorMountKey((k) => k + 1)
    setRichEditorOpen(true)
  }

  const openEditRichtext = async (doc: RdRichtextListRow) => {
    setRichDraftMode(false)
    try {
      const res = await axios.get<{ title: string; body_html: string }>(`/api/rd/richtext-docs/${doc.id}`)
      const title = res.data?.title ?? doc.title
      setRichTitleInitial(title)
      setRichEditingId(doc.id)
      setRichBodyHtml(appendAccessTokenToImgPreviewUrls(sanitizeRdRichBodyHtml(res.data?.body_html ?? ''), user?.token))
      setRichEditorMountKey((k) => k + 1)
      setRichEditorOpen(true)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    }
  }

  const closeRichModal = () => {
    setRichEditorOpen(false)
    setRichEditingId(null)
    setRichBodyHtml('')
    setRichDraftMode(false)
  }

  const handleRichModalCancel = () => {
    closeRichModal()
    void loadLibraryPage(selectedFolderId, libraryPage)
    void loadStorageUsage()
  }

  const DEFAULT_RICH_EDIT_SUMMARY = '常规保存'

  const startRichSave = async () => {
    try {
      await richTitleForm.validateFields()
      setRichSaveNote('')
      setRichSaveNoteOpen(true)
    } catch {
      /* 标题未通过校验 */
    }
  }

  const confirmRichSaveNote = async () => {
    try {
      await richTitleForm.validateFields()
    } catch {
      return
    }
    const summary = richSaveNote.trim() || DEFAULT_RICH_EDIT_SUMMARY
    setRichSaveNoteOpen(false)
    await executeRichSave(summary)
  }

  const executeRichSave = async (editSummary: string) => {
    if (effectiveFolderId == null) return
    try {
      const { title } = await richTitleForm.validateFields()
      const t = title.trim()
      if (!t) {
        msg.error('请填写标题')
        return
      }
      const htmlSource = stripAccessTokenFromImgPreviewUrls(richEditorRef.current?.getHtml() ?? richBodyHtml)
      const hasDataImg = rdBodyHtmlContainsDataImage(htmlSource)
      const logPayload = { edit_summary: editSummary }

      if (richEditingId == null) {
        if (hasDataImg) {
          const stubHtml = rdStripInlineDataImagesForCreate(htmlSource)
          const createRes = await axios.post<{ id: number; title: string; body_html: string }>(
            `/api/rd/doc-folders/${effectiveFolderId}/richtext-docs`,
            { title: t, body_html: stubHtml, ...logPayload },
          )
          const newId = createRes.data?.id
          if (!Number.isInteger(newId) || newId < 1) {
            msg.error('创建失败')
            return
          }
          try {
            const bodyToSave = await rdResolveBodyHtmlDataImages(htmlSource, (file) => uploadRichBodyImageForDocId(newId, file))
            await axios.put(`/api/rd/richtext-docs/${newId}`, { title: t, body_html: bodyToSave, ...logPayload })
          } catch (resolveErr) {
            try {
              await axios.put(`/api/rd/richtext-docs/${newId}`, { title: t, body_html: stubHtml })
            } catch {
              /* 回滚失败时忽略 */
            }
            msg.error(resolveErr instanceof Error ? resolveErr.message : '处理内联图片失败')
            return
          }
        } else {
          await axios.post(`/api/rd/doc-folders/${effectiveFolderId}/richtext-docs`, { title: t, body_html: htmlSource, ...logPayload })
        }
      } else {
        let bodyToSave = htmlSource
        if (hasDataImg) {
          try {
            bodyToSave = await rdResolveBodyHtmlDataImages(htmlSource, uploadRichBodyImage)
          } catch (resolveErr) {
            msg.error(resolveErr instanceof Error ? resolveErr.message : '处理内联图片失败')
            return
          }
        }
        await axios.put(`/api/rd/richtext-docs/${richEditingId}`, { title: t, body_html: bodyToSave, ...logPayload })
      }
      msg.success('已保存')
      closeRichModal()
      void loadLibraryPage(selectedFolderId, libraryPage)
      void loadFolders()
      void loadStorageUsage()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    }
  }

  const openMoveFile = (row: RdDocFileRow) => {
    setMoveFileRow(row)
    moveForm.setFieldsValue({ target_folder_id: row.folder_id })
    setMoveFileOpen(true)
  }

  const submitMoveFile = async () => {
    if (!moveFileRow) return
    try {
      const v = await moveForm.validateFields()
      await axios.put(`/api/rd/doc-files/${moveFileRow.id}`, { folder_id: v.target_folder_id })
      msg.success('已移动')
      setMoveFileOpen(false)
      setMoveFileRow(null)
      void loadLibraryPage(selectedFolderId, libraryPage)
      void loadFolders()
      void loadStorageUsage()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '移动失败')
    }
  }

  const folderParentOptions = useMemo(
    () =>
      folders
        .filter((f) => f.id !== folderEditingId)
        .map((f) => ({ value: f.id, label: folderPathLabel(folders, f.id) })),
    [folders, folderEditingId],
  )

  const folderMoveTargetOptions = useMemo(
    () => folders.map((f) => ({ value: f.id, label: folderPathLabel(folders, f.id) })),
    [folders],
  )

  const unifiedColumns: ColumnsType<UnifiedRow> = (() => {
    const folderCol: ColumnsType<UnifiedRow>[0] = {
      title: '所在文件夹',
      key: 'folder',
      width: 180,
      ellipsis: true,
      render: (_, row) => row.folder_name ?? '—',
    }
    const cols: ColumnsType<UnifiedRow> = [
      {
        title: '名称',
        key: 'name',
        ellipsis: true,
        render: (_, row) => (row.kind === 'file' ? row.file.file_name : row.doc.title),
      },
      ...(selectedFolderId == null ? [folderCol] : []),
      {
        title: '类型',
        key: 'type',
        width: 100,
        render: (_, row) => (row.kind === 'file' ? row.file.file_type : '文档'),
      },
      {
        title: '大小',
        key: 'meta',
        width: 100,
        render: (_, row) => {
          if (row.kind === 'file') return `${Math.round((row.file.file_size || 0) / 1024)} KB`
          const s = row.doc.storage_bytes ?? 0
          return s > 0 ? formatBytes(s) : '—'
        },
      },
      {
        title: '时间',
        key: 'time',
        width: 180,
        render: (_, row) => (row.kind === 'file' ? row.file.created_at : row.doc.updated_at),
      },
      {
        title: '操作',
        key: 'op',
        width: 260,
        render: (_, row) =>
          row.kind === 'file' ? (
            <Space wrap>
              <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openPreviewFile(row.file)}>
                预览
              </Button>
              <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => void handleDownload(row.file)}>
                下载
              </Button>
              <Button type="link" size="small" onClick={() => openMoveFile(row.file)}>
                移动
              </Button>
              <Popconfirm title="确定删除？" onConfirm={() => void deleteFile(row.file)}>
                <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          ) : (
            <Space wrap>
              <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openPreviewRichtext(row.doc)}>
                预览
              </Button>
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => void openEditRichtext(row.doc)}>
                编辑
              </Button>
              <Button
                type="link"
                size="small"
                icon={<DownloadOutlined />}
                onClick={async () => {
                  try {
                    const res = await axios.get<{ title: string; body_html: string }>(`/api/rd/richtext-docs/${row.doc.id}`)
                    downloadRichtextHtml(res.data?.title ?? row.doc.title, res.data?.body_html ?? '')
                  } catch (e: unknown) {
                    msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '下载失败')
                  }
                }}
              >
                下载
              </Button>
              <Popconfirm title="确定删除？" onConfirm={() => void deleteRichtext(row.doc.id)}>
                <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          ),
      },
    ]
    return cols
  })()

  const previewTitle = preview?.file.file_name ?? '预览'
  const previewIsImage = preview?.kind === 'file' && preview.file.file_type === 'image'

  const isDocsMainExpanded = richEditorOpen

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {storageUsage != null ? (
        <Text type="secondary" style={{ display: 'block', marginTop: 0 }}>
          全系统附件剩余：<Text strong>{formatBytes(storageUsage.remainingBytes)}</Text>
          <span style={{ marginLeft: 8 }}>
            （已用 {formatBytes(storageUsage.usedBytes)} / 配额 {formatBytes(storageUsage.quotaBytes)}，含知识库、合同等已统计模块）
          </span>
        </Text>
      ) : null}
      {storageUsage?.exceeded ? (
        <Alert
          type="warning"
          showIcon
          message="附件总占用已达或超过系统配置上限"
          description="当前仍可继续上传；系统已向管理员发送邮件提醒，可在「系统设置」中上调总容量或清理各模块附件。"
        />
      ) : null}
      {storageUsage != null && !storageUsage.exceeded && storageUsage.warnLowRemaining ? (
        <Alert
          type="info"
          showIcon
          message="附件剩余空间已不足 500MB"
          description="上传仍可继续；每次新增附件会向管理员发送提醒邮件，可在「系统设置」中查看配额与已用情况。"
        />
      ) : null}
      <Row
        gutter={16}
        align="stretch"
        className={`rd-docs-main-row${isDocsMainExpanded ? ' rd-docs-main-row--editor-only' : ''}`}
      >
        {!isDocsMainExpanded ? (
          <Col xs={24} md={8} lg={7}>
            <Card
              className="rd-doc-folder-card"
              title="文件夹树"
              size="small"
              loading={loadingFolders}
              extra={<Button size="small" onClick={() => void loadFolders()}>刷新</Button>}
              styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } }}
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            >
              <Space wrap style={{ marginBottom: 8, flexShrink: 0 }}>
                <Button type="primary" size="small" icon={<FolderAddOutlined />} onClick={openCreateFolder}>
                  新建
                </Button>
                <Button size="small" disabled={selectedFolderId == null} onClick={openRenameFolder}>
                  重命名
                </Button>
                <Button size="small" disabled={selectedFolderId == null} onClick={openMoveFolder}>
                  移动
                </Button>
                <Popconfirm title="删除该文件夹（须为空）？" disabled={selectedFolderId == null} onConfirm={() => void deleteSelectedFolder()}>
                  <Button size="small" danger disabled={selectedFolderId == null}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8, flexShrink: 0 }}>
                根目录与子文件夹以树线展示，点选文件夹后仅显示该目录下内容。
              </Text>
              <Space style={{ marginBottom: 8, flexShrink: 0 }}>
                <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => onTreeSelect([])}>
                  全部文档
                </Button>
              </Space>
              {treeData.length === 0 ? (
                <Text type="secondary" style={{ flex: 1 }}>
                  暂无文件夹，点击「新建」在根目录创建。
                </Text>
              ) : (
                <div className="rd-doc-folder-tree-panel">
                  <Tree
                    className="rd-doc-folder-tree"
                    blockNode
                    showLine
                    showIcon
                    expandedKeys={folderExpandedKeys}
                    onExpand={(keys) => setFolderExpandedKeys(keys as React.Key[])}
                    selectedKeys={selectedFolderId != null ? [String(selectedFolderId)] : []}
                    treeData={treeData}
                    onSelect={onTreeSelect}
                  />
                </div>
              )}
            </Card>
          </Col>
        ) : null}
        <Col xs={24} md={isDocsMainExpanded ? 24 : 16} lg={isDocsMainExpanded ? 24 : 17}>
          {richEditorOpen ? (
            <Card
              className="rd-doc-rich-inline-card rd-doc-main-col-card"
              title={richDraftMode ? '新建文档' : '编辑文档'}
              size="small"
              styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } }}
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              extra={
                <Space>
                  {richEditingId != null ? (
                    <Button
                      onClick={() => window.open(`/rd/docs/preview/${richEditingId}`, '_blank', 'noopener,noreferrer')}
                    >
                      阅读预览
                    </Button>
                  ) : null}
                  <Button onClick={handleRichModalCancel}>取消</Button>
                  <Button type="primary" onClick={() => void startRichSave()}>
                    保存
                  </Button>
                </Space>
              }
            >
              {richDraftMode && richEditingId == null ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ flexShrink: 0, marginBottom: 8 }}
                  message="新建与保存"
                  description="保存前不会在列表中产生记录。点击「保存」将创建文档；正文里粘贴产生的内联图（data:image）会在保存时自动上传并替换为服务器地址。也推荐使用工具栏插入图片。"
                />
              ) : null}
              <Form
                form={richTitleForm}
                key={`rich-doc-title-${richEditorMountKey}`}
                layout="vertical"
                preserve={false}
                initialValues={{ title: richTitleInitial }}
                style={{ flexShrink: 0 }}
              >
                <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
                  <Input placeholder="文档标题" size="large" />
                </Form.Item>
              </Form>

              <div className="rd-doc-rich-editor-only rd-doc-rich-split--fill">
                <div className="rd-doc-rich-split__panel rd-doc-rich-split__panel--editor rd-doc-rich-editor-only__panel">
                  <div className="rd-doc-rich-split__panel-head">
                    <Text strong>正文编辑</Text>
                    <Text type="secondary" className="rd-doc-rich-split__panel-sub">
                      {richDraftMode && richEditingId == null
                        ? '保存时会自动上传正文中的内联图；工具栏插入图片可直接写入服务器'
                        : 'TipTap 富文本，支持粘贴截图与图片；可点右上角「阅读预览」在独立页面查看排版'}
                    </Text>
                  </div>
                  <RdRichHtmlEditor
                    ref={richEditorRef}
                    mountKey={richEditorMountKey}
                    html={richBodyHtml}
                    onChange={setRichBodyHtml}
                    uploadImage={richEditingId != null ? uploadRichBodyImage : undefined}
                    previewAccessToken={user?.token}
                    placeholder="在此编写正文…"
                  />
                </div>
              </div>
            </Card>
          ) : (
            <Card
              className="rd-doc-files-card rd-doc-main-col-card"
              title="文件与文档"
              size="small"
              styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } }}
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              extra={
                <Button type="primary" size="small" icon={<PlusOutlined />} disabled={effectiveFolderId == null} onClick={openCreateRichtext}>
                  新建文档
                </Button>
              }
            >
              <div className="rd-doc-files-table-wrap" style={{ flex: 1, minHeight: 0 }}>
                <Table<UnifiedRow>
                  rowKey="key"
                  size="small"
                  loading={loadingFiles}
                  columns={unifiedColumns}
                  dataSource={libraryRows}
                  pagination={{
                    current: libraryPage,
                    pageSize: RD_LIBRARY_PAGE_SIZE,
                    total: libraryTotal,
                    showSizeChanger: false,
                    showTotal: (t) => `共 ${t} 条`,
                    onChange: (p) => setLibraryPage(p),
                  }}
                />
              </div>
            </Card>
          )}
        </Col>
      </Row>

      <Modal
        title={
          folderModalMode === 'create' ? '新建文件夹' : folderModalMode === 'rename' ? '重命名文件夹' : '移动文件夹'
        }
        open={folderModalOpen}
        onOk={() => void submitFolderModal()}
        onCancel={() => setFolderModalOpen(false)}
        destroyOnHidden
      >
        <Form form={folderForm} layout="vertical" preserve={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="文件夹名称" />
          </Form.Item>
          {(folderModalMode === 'create' || folderModalMode === 'move') && (
            <Form.Item name="parent_id" label="父文件夹">
              <Select allowClear placeholder="不选则为根目录" options={folderParentOptions} showSearch optionFilterProp="label" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal title="移动文件" open={moveFileOpen} onOk={() => void submitMoveFile()} onCancel={() => setMoveFileOpen(false)} destroyOnHidden>
        <Form form={moveForm} layout="vertical" preserve={false}>
          <Form.Item name="target_folder_id" label="目标文件夹" rules={[{ required: true, message: '请选择' }]}>
            <Select options={folderMoveTargetOptions} showSearch optionFilterProp="label" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={previewTitle}
        open={previewOpen}
        onCancel={closePreview}
        footer={null}
        width={previewIsImage ? 800 : 900}
        styles={{ body: { padding: 0, minHeight: 400 } }}
        destroyOnHidden
      >
        {previewLoading && preview && <div style={{ padding: 24, textAlign: 'center' }}>加载中…</div>}
        {!previewLoading && preview?.kind === 'file' && (
          <>
            {preview.file.file_type === 'image' && previewObjectUrl && (
              <div style={{ padding: 16, textAlign: 'center' }}>
                <img src={previewObjectUrl} alt={preview.file.file_name} style={{ maxWidth: '100%', maxHeight: '80vh' }} />
              </div>
            )}
            {preview.file.file_type === 'md' && (
              <div className="markdown-preview" style={{ padding: '20px 24px', margin: 0, maxHeight: '80vh', overflow: 'auto' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewText}</ReactMarkdown>
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal
        title="保存文档"
        open={richSaveNoteOpen}
        okText="确定保存"
        cancelText="取消"
        onOk={() => void confirmRichSaveNote()}
        onCancel={() => setRichSaveNoteOpen(false)}
        destroyOnHidden
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 10 }}>
          可选填本次修改说明；留空将记录为「{DEFAULT_RICH_EDIT_SUMMARY}」
        </Text>
        <Input.TextArea
          value={richSaveNote}
          onChange={(e) => setRichSaveNote(e.target.value)}
          placeholder="例如：补充第三节、修正错别字、更新截图…"
          rows={3}
          maxLength={500}
          showCount
        />
      </Modal>
    </Space>
  )
}

export default RdResearchDocsPage
