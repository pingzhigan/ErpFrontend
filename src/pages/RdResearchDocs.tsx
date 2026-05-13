/**
 * 研发管理 — 研发文档：文件夹树、文档（TipTap HTML）、预览；本页不提供文件上传入口。
 */
import { DeleteOutlined, DownloadOutlined, EditOutlined, EyeOutlined, FolderAddOutlined, FolderOutlined, PlusOutlined } from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import type { ColumnsType } from 'antd/es/table'
import { App, Alert, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Table, Tree, Typography } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { RdRichHtmlEditor, sanitizeRdRichPreviewHtml } from '../components/RdRichHtmlEditor'

const { Title, Text } = Typography

/** 新建文档时先落库的占位标题（与后端草稿一致，取消且未编辑时可删草稿） */
const RICHTEXT_DRAFT_TITLE = '未命名文档'

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function isBlankRichBody(html: string): boolean {
  const plain = String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length === 0
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
}

export type RdRichtextListRow = {
  id: number
  folder_id: number
  title: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

type UnifiedRow =
  | { key: string; kind: 'file'; sortAt: string; file: RdDocFileRow }
  | { key: string; kind: 'richtext'; sortAt: string; doc: RdRichtextListRow }

type PreviewState = { kind: 'file'; file: RdDocFileRow } | { kind: 'richtext'; id: number; title: string }

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
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [folderExpandedKeys, setFolderExpandedKeys] = useState<React.Key[]>([])

  const [files, setFiles] = useState<RdDocFileRow[]>([])
  const [richtextDocs, setRichtextDocs] = useState<RdRichtextListRow[]>([])
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

  const [richModalOpen, setRichModalOpen] = useState(false)
  const [richEditingId, setRichEditingId] = useState<number | null>(null)
  const [richTitleForm] = Form.useForm<{ title: string }>()
  const [richBodyHtml, setRichBodyHtml] = useState('')
  const [richEditorMountKey, setRichEditorMountKey] = useState(0)
  const [richDraftMode, setRichDraftMode] = useState(false)
  const [storageUsage, setStorageUsage] = useState<{
    usedBytes: number
    quotaBytes: number
    remainingBytes: number
    exceeded: boolean
    warnLowRemaining: boolean
  } | null>(null)

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

  const loadFiles = useCallback(
    async (folderId: number) => {
      setLoadingFiles(true)
      try {
        const [fRes, rRes] = await Promise.all([
          axios.get<{ list: RdDocFileRow[] }>(`/api/rd/doc-folders/${folderId}/files`),
          axios.get<{ list: RdRichtextListRow[] }>(`/api/rd/doc-folders/${folderId}/richtext-docs`),
        ])
        setFiles(fRes.data?.list ?? [])
        setRichtextDocs(rRes.data?.list ?? [])
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
        setFiles([])
        setRichtextDocs([])
      } finally {
        setLoadingFiles(false)
      }
    },
    [msg],
  )

  useEffect(() => {
    if (selectedFolderId != null) void loadFiles(selectedFolderId)
    else {
      setFiles([])
      setRichtextDocs([])
    }
  }, [selectedFolderId, loadFiles])

  const unifiedRows = useMemo((): UnifiedRow[] => {
    const rows: UnifiedRow[] = [
      ...files.map((f) => ({
        key: `f-${f.id}`,
        kind: 'file' as const,
        sortAt: f.created_at,
        file: f,
      })),
      ...richtextDocs.map((d) => ({
        key: `r-${d.id}`,
        kind: 'richtext' as const,
        sortAt: d.updated_at,
        doc: d,
      })),
    ]
    rows.sort((a, b) => (a.sortAt < b.sortAt ? 1 : a.sortAt > b.sortAt ? -1 : 0))
    return rows
  }, [files, richtextDocs])

  const treeData = useMemo(() => buildTreeData(folders), [folders])

  const onTreeSelect = (keys: React.Key[]) => {
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

  const openPreviewRichtext = useCallback((doc: RdRichtextListRow) => {
    setPreview({ kind: 'richtext', id: doc.id, title: doc.title })
    setPreviewOpen(true)
    setPreviewObjectUrl(null)
    setPreviewText('')
  }, [])

  useEffect(() => {
    if (!previewOpen || !preview) return
    let objectUrl: string | null = null
    setPreviewLoading(true)
    if (preview.kind === 'richtext') {
      axios
        .get<{ body_html: string }>(`/api/rd/richtext-docs/${preview.id}`)
        .then((res) => {
          setPreviewText(typeof res.data?.body_html === 'string' ? res.data.body_html : '')
        })
        .catch(() => msg.error('预览加载失败'))
        .finally(() => setPreviewLoading(false))
      return () => {
        if (objectUrl) window.URL.revokeObjectURL(objectUrl)
      }
    }
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
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
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
      if (selectedFolderId != null) void loadFiles(selectedFolderId)
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
      if (selectedFolderId != null) void loadFiles(selectedFolderId)
      void loadFolders()
      void loadStorageUsage()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const uploadRichBodyImage = useCallback(
    async (file: File) => {
      if (richEditingId == null) {
        msg.error('文档未就绪，请稍候再试')
        throw new Error('no id')
      }
      const fd = new FormData()
      fd.append('file', file)
      try {
        const res = await axios.post<{ id: number; url: string }>(`/api/rd/richtext-docs/${richEditingId}/body-images`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        void loadStorageUsage()
        const url = res.data?.url ?? ''
        if (!url) throw new Error('上传未返回图片地址')
        return url
      } catch (e: unknown) {
        const m =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e instanceof Error ? e.message : '上传失败')
        msg.error(m)
        throw new Error(m)
      }
    },
    [richEditingId, msg, loadStorageUsage],
  )

  const openCreateRichtext = async () => {
    if (selectedFolderId == null) {
      msg.warning('请先选择文件夹')
      return
    }
    setRichDraftMode(true)
    try {
      const res = await axios.post<{ id: number; title: string; body_html: string }>(
        `/api/rd/doc-folders/${selectedFolderId}/richtext-docs`,
        { title: RICHTEXT_DRAFT_TITLE, body_html: '<p></p>' },
      )
      const newId = res.data?.id
      if (!Number.isInteger(newId) || newId < 1) {
        msg.error('创建草稿失败')
        setRichDraftMode(false)
        return
      }
      setRichEditingId(newId)
      setRichBodyHtml(res.data?.body_html ?? '<p></p>')
      setRichEditorMountKey((k) => k + 1)
      richTitleForm.resetFields()
      richTitleForm.setFieldsValue({ title: res.data?.title ?? RICHTEXT_DRAFT_TITLE })
      setRichModalOpen(true)
      void loadFiles(selectedFolderId)
      void loadStorageUsage()
    } catch (e: unknown) {
      setRichDraftMode(false)
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '创建失败')
    }
  }

  const openEditRichtext = async (doc: RdRichtextListRow) => {
    setRichDraftMode(false)
    try {
      const res = await axios.get<{ title: string; body_html: string }>(`/api/rd/richtext-docs/${doc.id}`)
      setRichEditingId(doc.id)
      setRichBodyHtml(res.data?.body_html ?? '')
      setRichEditorMountKey((k) => k + 1)
      richTitleForm.setFieldsValue({ title: res.data?.title ?? doc.title })
      setRichModalOpen(true)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    }
  }

  const closeRichModal = () => {
    setRichModalOpen(false)
    setRichEditingId(null)
    setRichBodyHtml('')
    setRichDraftMode(false)
  }

  const handleRichModalCancel = async () => {
    if (richDraftMode && richEditingId != null) {
      const t = String(richTitleForm.getFieldValue('title') ?? '').trim()
      if (t === RICHTEXT_DRAFT_TITLE && isBlankRichBody(richBodyHtml)) {
        try {
          await axios.delete(`/api/rd/richtext-docs/${richEditingId}`)
        } catch {
          /* ignore */
        }
      }
    }
    closeRichModal()
    if (selectedFolderId != null) {
      void loadFiles(selectedFolderId)
      void loadStorageUsage()
    }
  }

  const submitRichModal = async () => {
    if (selectedFolderId == null) return
    if (richEditingId == null) {
      msg.error('文档未初始化')
      return
    }
    try {
      const { title } = await richTitleForm.validateFields()
      const t = title.trim()
      if (!t) {
        msg.error('请填写标题')
        return
      }
      await axios.put(`/api/rd/richtext-docs/${richEditingId}`, { title: t, body_html: richBodyHtml })
      msg.success('已保存')
      closeRichModal()
      void loadFiles(selectedFolderId)
      void loadFolders()
      void loadStorageUsage()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    }
  }

  const [moveFileOpen, setMoveFileOpen] = useState(false)
  const [moveFileRow, setMoveFileRow] = useState<RdDocFileRow | null>(null)
  const [moveForm] = Form.useForm<{ target_folder_id: number }>()

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
      if (selectedFolderId != null) void loadFiles(selectedFolderId)
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

  const safeRichtextPreview = useMemo(() => sanitizeRdRichPreviewHtml(previewText), [previewText])

  const unifiedColumns: ColumnsType<UnifiedRow> = [
    {
      title: '名称',
      key: 'name',
      ellipsis: true,
      render: (_, row) => (row.kind === 'file' ? row.file.file_name : row.doc.title),
    },
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
      render: (_, row) => (row.kind === 'file' ? `${Math.round((row.file.file_size || 0) / 1024)} KB` : '—'),
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

  const previewTitle = preview?.kind === 'file' ? preview.file.file_name : preview?.title ?? '预览'
  const previewIsImage = preview?.kind === 'file' && preview.file.file_type === 'image'

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Title level={4} style={{ margin: 0 }}>
        研发文档
      </Title>
      {storageUsage != null ? (
        <Text type="secondary" style={{ display: 'block', marginTop: -8 }}>
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
      <Row gutter={16}>
        <Col xs={24} md={8} lg={7}>
          <Card title="文件夹树" size="small" loading={loadingFolders} extra={<Button size="small" onClick={() => void loadFolders()}>刷新</Button>}>
            <Space wrap style={{ marginBottom: 8 }}>
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
            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
              根目录与子文件夹以树线展示；点击节点选中，再于右侧管理文件。
            </Text>
            {treeData.length === 0 ? (
              <Text type="secondary">暂无文件夹，点击「新建」在根目录创建。</Text>
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
        <Col xs={24} md={16} lg={17}>
          <Card
            title="文件与文档"
            size="small"
            extra={
              <Button type="primary" size="small" icon={<PlusOutlined />} disabled={selectedFolderId == null} onClick={openCreateRichtext}>
                新建文档
              </Button>
            }
          >
            {selectedFolderId == null ? (
              <Text type="secondary">请先在左侧文件夹树中选中一个节点。</Text>
            ) : (
              <Table<UnifiedRow>
                rowKey="key"
                size="small"
                loading={loadingFiles}
                columns={unifiedColumns}
                dataSource={unifiedRows}
                pagination={false}
              />
            )}
          </Card>
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
        title={richDraftMode ? '新建文档' : '编辑文档'}
        open={richModalOpen}
        onOk={() => void submitRichModal()}
        onCancel={() => void handleRichModalCancel()}
        width={1120}
        destroyOnHidden
        styles={{ body: { paddingTop: 12, paddingBottom: 8 } }}
        afterOpenChange={(open) => {
          if (!open) return
          if (richEditingId == null) {
            richTitleForm.resetFields()
            richTitleForm.setFieldsValue({ title: '' })
          }
        }}
      >
        <Form form={richTitleForm} layout="vertical" preserve={false}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="文档标题" size="large" />
          </Form.Item>
        </Form>
        <Row gutter={[16, 16]} className="rd-doc-rich-split">
          <Col xs={24} lg={10} xl={9}>
            <div className="rd-doc-rich-split__panel">
              <div className="rd-doc-rich-split__panel-head">
                <Text strong>预览</Text>
                <Text type="secondary" className="rd-doc-rich-split__panel-sub">
                  左侧实时预览，与右侧编辑同步
                </Text>
              </div>
              <div
                className="rd-rich-html-preview rd-doc-rich-split__preview-body"
                dangerouslySetInnerHTML={{ __html: sanitizeRdRichPreviewHtml(richBodyHtml) }}
              />
            </div>
          </Col>
          <Col xs={24} lg={14} xl={15}>
            <div className="rd-doc-rich-split__panel rd-doc-rich-split__panel--editor">
              <div className="rd-doc-rich-split__panel-head">
                <Text strong>编辑</Text>
                <Text type="secondary" className="rd-doc-rich-split__panel-sub">
                  TipTap 富文本，支持粘贴截图与图片
                </Text>
              </div>
              <RdRichHtmlEditor
                mountKey={richEditorMountKey}
                html={richBodyHtml}
                onChange={setRichBodyHtml}
                uploadImage={richEditingId != null ? uploadRichBodyImage : undefined}
                placeholder="在此编写正文…"
              />
            </div>
          </Col>
        </Row>
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
        {!previewLoading && preview?.kind === 'richtext' && (
          <div
            className="rd-rich-html-preview"
            style={{ padding: '20px 24px', margin: 0, maxHeight: '80vh', overflow: 'auto' }}
            dangerouslySetInnerHTML={{ __html: safeRichtextPreview }}
          />
        )}
      </Modal>
    </Space>
  )
}

export default RdResearchDocsPage
