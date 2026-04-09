/**
 * 功能名称：知识库管理
 * 实现原理与逻辑：管理弱电领域知识条目（基础/设备/术语/规范/制度），支持按类型、系统、关键词筛选；列表展示知识及附件，
 * 可新增/编辑/删除知识、上传附件、预览 Markdown 内容。数据通过 /api/knowledge 等接口增删改查，附件单独上传与关联。
 */
import { DeleteOutlined, DownloadOutlined, EyeOutlined, FileOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  App,
  Badge,
  Button,
  Card,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
  Upload,
} from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useAuth } from '../auth/AuthContext'
import remarkGfm from 'remark-gfm'

const { Title, Text } = Typography

export type KnowledgeFileRecord = {
  id: number
  knowledge_id: number
  file_name: string
  file_path: string
  file_type: 'pdf' | 'txt' | 'md' | 'image'
  mime_type: string
  file_size: number
  created_at: string
  created_by: string | null
}

export type Knowledge = {
  id: number
  code: string
  title: string
  knowledge_type: 'basic' | 'equipment' | 'term' | 'standard' | 'policy'
  system_type: string
  scene_tags: string | null
  content: string | null
  structured_json: string | null
  keywords: string | null
  enabled: number
  created_at: string
  updated_at: string
  /** 创建者用户名；无记录时仅管理员可删 */
  created_by?: string | null
}

/** 列表项：知识 + 首个附件（1 个附件 = 1 条知识，列表直接展示附件） */
export type KnowledgeListItem = Knowledge & { file?: KnowledgeFileRecord }

const KNOWLEDGE_TYPES = [
  { label: '弱电基础知识', value: 'basic' },
  { label: '设备技术说明', value: 'equipment' },
  { label: '术语解释', value: 'term' },
  { label: '技术规范', value: 'standard' },
  { label: '公司制度', value: 'policy' },
]
const SYSTEM_TYPES = [
  { label: '通用', value: 'general' },
  { label: '视频监控', value: 'video' },
  { label: '门禁', value: 'access' },
  { label: '综合布线', value: 'cabling' },
  { label: '广播', value: 'broadcast' },
  { label: '会议', value: 'meeting' },
]

/** 从文件名去掉扩展名 */
function getBaseNameWithoutExt(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i > 0 ? filename.slice(0, i).trim() : filename.trim() || '未命名'
}

/**
 * 附件在服务端存为「时间戳数字-原始文件名」（multer 用 Date.now() 防重名，多为 13 位毫秒，亦可能更短）。
 * 仅用于展示与下载建议文件名；完整存储名仍可在列表单元格 title 悬停查看。
 */
function stripKnowledgeStoredFilePrefix(storedName: string): string {
  if (!storedName || typeof storedName !== 'string') return storedName
  const t = storedName.trim()
  const m = /^(\d{8,})-(.+)$/.exec(t)
  return m ? m[2].trim() : t
}

/** 根据文件名关键词推断知识类型 */
function inferKnowledgeType(filename: string): Knowledge['knowledge_type'] {
  const lower = filename.toLowerCase()
  if (/\b(公司制度|制度|规定)\b/.test(lower)) return 'policy'
  if (/\b(规范|标准|技术规范)\b/.test(lower)) return 'standard'
  if (/\b(术语|名词|释义)\b/.test(lower)) return 'term'
  if (/\b(设备|技术说明|说明书)\b/.test(lower)) return 'equipment'
  return 'basic'
}

/** 生成默认编码（保证简短且不重复） */
function generateCode(title: string): string {
  const slug = title
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fa5_-]/g, '')
    .slice(0, 30)
  return slug ? `${slug}_${Date.now().toString(36)}` : `K_${Date.now()}`
}

const KnowledgePage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { user, hasRole } = useAuth()
  const [list, setList] = useState<KnowledgeListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId] = useState<number | null>(null)
  const [form] = Form.useForm()
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined)
  const [enabledFilter, setEnabledFilter] = useState<string | undefined>(undefined)
  const [keywordSearch, setKeywordSearch] = useState('')
  const [titleFilter, setTitleFilter] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  /** 无附件时预览正文 */
  const [previewContentRow, setPreviewContentRow] = useState<KnowledgeListItem | null>(null)
  const [previewFile, setPreviewFile] = useState<KnowledgeFileRecord | null>(null)
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)
  // 新增知识（先上传附件 → 识别名称/类型 → 审核保存）
  const [addByUploadOpen, setAddByUploadOpen] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [reviewTitle, setReviewTitle] = useState('')
  const [reviewType, setReviewType] = useState<Knowledge['knowledge_type']>('basic')
  const [reviewCode, setReviewCode] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const addSuggestedRef = useRef(false)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (typeFilter) params.set('knowledge_type', typeFilter)
      if (enabledFilter !== undefined) params.set('enabled', enabledFilter)
      if (titleFilter.trim()) params.set('title', titleFilter.trim())
      if (keywordSearch.trim()) params.set('keyword', keywordSearch.trim())
      const res = await axios.get<{ list: KnowledgeListItem[]; total: number }>(`/api/knowledge?${params.toString()}`)
      setList(res.data.list || [])
      setTotal(res.data.total ?? 0)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [typeFilter, enabledFilter, titleFilter, keywordSearch, msg])

  const handleDownloadFile = useCallback(async (file: KnowledgeFileRecord) => {
    try {
      const res = await axios.get(`/api/knowledge/files/${file.id}/download`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = stripKnowledgeStoredFilePrefix(file.file_name) || file.file_name || 'download'
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '下载失败')
    }
  }, [msg])

  const openPdfInNewTab = useCallback(
    async (file: KnowledgeFileRecord) => {
      try {
        const res = await axios.get(`/api/knowledge/files/${file.id}/preview`, { responseType: 'blob' })
        const url = window.URL.createObjectURL(res.data)
        window.open(url, '_blank')
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '打开失败')
      }
    },
    [msg]
  )

  const openPreview = useCallback((file: KnowledgeFileRecord) => {
    if (file.file_type === 'pdf') {
      openPdfInNewTab(file)
      return
    }
    setPreviewContentRow(null)
    setPreviewFile(file)
    setPreviewOpen(true)
    setPreviewObjectUrl(null)
    setPreviewText('')
  }, [openPdfInNewTab])

  const openContentPreview = useCallback((row: KnowledgeListItem) => {
    const text = (row.content ?? '').trim()
    if (!text) return
    setPreviewFile(null)
    setPreviewContentRow(row)
    setPreviewOpen(true)
    setPreviewObjectUrl(null)
    setPreviewText(row.content ?? '')
  }, [])

  const handleDownloadContent = useCallback(
    (row: KnowledgeListItem) => {
      const text = row.content ?? ''
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeName = (row.title || row.code || '知识正文').replace(/[/\\?%*:|"<>]/g, '_')
      a.download = `${safeName}.txt`
      a.click()
      window.URL.revokeObjectURL(url)
    },
    [],
  )

  useEffect(() => {
    if (!previewOpen || !previewFile || previewFile.file_type === 'pdf') return
    let objectUrl: string | null = null
    setPreviewLoading(true)
    const isText = previewFile.file_type === 'txt' || previewFile.file_type === 'md'
    const req = isText
      ? axios.get(`/api/knowledge/files/${previewFile.id}/preview`, { responseType: 'text' })
      : axios.get(`/api/knowledge/files/${previewFile.id}/preview`, { responseType: 'blob' })
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
  }, [previewOpen, previewFile?.id, previewFile?.file_type, msg])

  const closePreview = useCallback(() => {
    setPreviewOpen(false)
    setPreviewFile(null)
    setPreviewContentRow(null)
    setPreviewObjectUrl(null)
    setPreviewText('')
  }, [])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  // 首次选择附件时根据文件名识别名称与类型，供用户审核
  useEffect(() => {
    if (pendingFiles.length > 0 && !addSuggestedRef.current) {
      const first = pendingFiles[0].name
      setReviewTitle(getBaseNameWithoutExt(first))
      setReviewType(inferKnowledgeType(first))
      setReviewCode(generateCode(getBaseNameWithoutExt(first)))
      addSuggestedRef.current = true
    }
    if (pendingFiles.length === 0) addSuggestedRef.current = false
  }, [pendingFiles])

  const openCreate = () => {
    setAddByUploadOpen(true)
    setPendingFiles([])
    setReviewTitle('')
    setReviewType('basic')
    setReviewCode('')
  }

  const closeAddByUpload = () => {
    setAddByUploadOpen(false)
    setPendingFiles([])
    setReviewTitle('')
    setReviewType('basic')
    setReviewCode('')
    setAddSaving(false)
    addSuggestedRef.current = false
  }

  const addFiles = useCallback((files: File | FileList | null) => {
    if (!files) return
    const list = Array.isArray(files) ? files : [files]
    const allowed = list.filter((f) => {
      const name = f.name.toLowerCase()
      return name.endsWith('.pdf') || name.endsWith('.txt') || name.endsWith('.md') ||
        /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(name)
    })
    setPendingFiles((prev) => [...prev, ...allowed])
    if (allowed.length < list.length) msg.warning('已跳过不支持的文件，仅支持 PDF、TXT、MD、图片')
  }, [msg])

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleAddByUploadSave = async () => {
    const title = reviewTitle.trim()
    const code = reviewCode.trim() || generateCode(title)
    if (!title) {
      msg.error('请填写知识名称')
      return
    }
    if (pendingFiles.length === 0) {
      msg.error('请先选择至少一个附件')
      return
    }
    setAddSaving(true)
    try {
      const res = await axios.post<Knowledge>('/api/knowledge', {
        code,
        title,
        knowledge_type: reviewType,
        system_type: 'general',
        enabled: 1,
      })
      const newId = res.data.id
      for (const file of pendingFiles) {
        const formData = new FormData()
        formData.append('file', file)
        await axios.post(`/api/knowledge/${newId}/files`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }
      msg.success(`已创建知识并上传 ${pendingFiles.length} 个附件`)
      closeAddByUpload()
      fetchList()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || '保存失败')
    } finally {
      setAddSaving(false)
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      const payload = {
        ...values,
        scene_tags: values.scene_tags?.trim() ? values.scene_tags.trim() : null,
        content: values.content ?? null,
        structured_json: values.structured_json?.trim() ? values.structured_json.trim() : null,
        keywords: values.keywords?.trim() || null,
        enabled: values.enabled === true ? 1 : 0,
      }
      if (editingId) {
        await axios.put(`/api/knowledge/${editingId}`, payload)
        msg.success('更新成功')
      } else {
        await axios.post('/api/knowledge', payload)
        msg.success('创建成功')
      }
      setModalOpen(false)
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`/api/knowledge/${id}`)
      msg.success('已删除')
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const runReconcileDisk = useCallback(() => {
    Modal.confirm({
      title: '从磁盘修复附件索引',
      content:
        '界面上的附件来自数据库表 knowledge_files。若 data/knowledge_files 下按知识编号建的子目录里仍有文件但列表不显示，可补登记。若该知识条目曾被软删，会先恢复；若库中已无该编号，会新建占位条目（code=_disk_orphan_编号）再登记附件，之后请在列表中核对标题与分类。是否执行？（需管理员）',
      okText: '执行修复',
      cancelText: '取消',
      onOk: async () => {
        try {
          const { data } = await axios.post<{
            registered: number
            skippedExisting: number
            skippedNoKnowledge: number
            skippedUnsupported: number
            restoredKnowledge?: number
            createdPlaceholderKnowledge?: number
            message?: string
            details?: string[]
          }>('/api/knowledge/admin/reconcile-files', { dryRun: false })
          msg.success(
            data.message ||
              `已登记 ${data.registered} 条；跳过已有 ${data.skippedExisting}；无对应知识 ${data.skippedNoKnowledge}`,
          )
          if (data.details?.length) {
            Modal.info({
              title: '登记明细（节选）',
              width: 680,
              content: (
                <pre style={{ maxHeight: 360, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {data.details.join('\n')}
                </pre>
              ),
            })
          }
          fetchList()
        } catch (e: unknown) {
          const err = e as { response?: { data?: { message?: string } } }
          msg.error(err?.response?.data?.message || '修复失败（需管理员且具备知识库权限）')
        }
      },
    })
  }, [fetchList, msg])

  const columns: ColumnsType<KnowledgeListItem> = [
    {
      title: '名称',
      dataIndex: 'title',
      ellipsis: true,
      render: (_: string, row: KnowledgeListItem) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 500 }} title={row.file?.file_name}>
            {row.file ? stripKnowledgeStoredFilePrefix(row.file.file_name) || row.title : row.title}
          </span>
          {/* <Text type="secondary" style={{ fontSize: 12 }}>{row.code}</Text> */}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'knowledge_type',
      width: 120,
      render: (t: KnowledgeListItem['knowledge_type']) => KNOWLEDGE_TYPES.find((k) => k.value === t)?.label ?? t,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 72,
      render: (v: number) => (v === 1 ? <Badge status="success" text="启用" /> : <Badge status="default" text="停用" />),
    },
    {
      title: '创建人',
      dataIndex: 'created_by',
      width: 100,
      ellipsis: true,
      render: (_: string | null | undefined, row: KnowledgeListItem) => {
        const c = (row.created_by ?? '').trim()
        if (!c) return <Text type="secondary">—</Text>
        if (c === '_disk_reconcile') return <Text type="secondary">系统修复索引</Text>
        return <span title={c}>{c}</span>
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 96,
      render: (v: string) => (v ? v.slice(0, 16).replace('T', ' ') : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      fixed: 'right',
      render: (_, row) => {
        const hasFile = Boolean(row.file)
        const hasContent = Boolean((row.content ?? '').trim())
        const canPreview = hasFile || hasContent
        const canDownload = hasFile || hasContent
        const isAdmin = hasRole('admin')
        const me = (user?.username ?? '').trim()
        const owner = (row.created_by ?? '').trim()
        const canDelete = isAdmin || (!!owner && owner === me)
        return (
          <Space size="small" wrap>
            {canPreview ? (
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => (hasFile ? openPreview(row.file!) : openContentPreview(row))}
              >
                预览
              </Button>
            ) : null}
            {canDownload ? (
              <Button
                type="link"
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => (hasFile ? handleDownloadFile(row.file!) : handleDownloadContent(row))}
              >
                下载
              </Button>
            ) : null}
            {canDelete ? (
              <Popconfirm title="确定删除该条知识？" onConfirm={() => handleDelete(row.id)} okText="删除" cancelText="取消">
                <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            ) : null}
          </Space>
        )
      },
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Title level={4} style={{ marginBottom: 4 }}>
            知识库
          </Title>
          <Text type="secondary">
            {`列表中的附件来自数据库记录；物理文件在服务端 data/knowledge_files/{知识ID}/。若磁盘有文件但列表无附件，可由管理员点击「从磁盘修复附件索引」。`}
          </Text>
        </div>
        <Space wrap>
          {hasRole('admin') ? (
            <Button onClick={() => runReconcileDisk()}>从磁盘修复附件索引</Button>
          ) : null}
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增知识
          </Button>
        </Space>
      </div>
      <Card>
        <Space wrap style={{ marginBottom: 16 }} align="center">
          <Input
            placeholder="按名称搜索"
            allowClear
            style={{ width: 180 }}
            value={titleFilter}
            onChange={(e) => setTitleFilter(e.target.value)}
            onPressEnter={() => fetchList()}
          />
          <Input.Search
            placeholder="关键词"
            allowClear
            style={{ width: 160 }}
            value={keywordSearch}
            onChange={(e) => setKeywordSearch(e.target.value)}
            onSearch={() => fetchList()}
            enterButton="搜索"
          />
          <Select
            placeholder="类型"
            allowClear
            style={{ width: 120 }}
            value={typeFilter}
            onChange={setTypeFilter}
            options={KNOWLEDGE_TYPES}
          />
          <Select
            placeholder="状态"
            allowClear
            style={{ width: 90 }}
            value={enabledFilter}
            onChange={setEnabledFilter}
            options={[
              { label: '启用', value: '1' },
              { label: '停用', value: '0' },
            ]}
          />
          <Button onClick={fetchList}>刷新</Button>
        </Space>
        <Table<KnowledgeListItem>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 'max-content' }}
          pagination={{ total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>

      <Modal
        title="新增知识"
        open={addByUploadOpen}
        onCancel={closeAddByUpload}
        footer={null}
        width={520}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>1. 选择附件</Text>
            <Upload.Dragger
              multiple
              accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff,.tif"
              showUploadList={false}
              beforeUpload={(file) => {
                addFiles(file)
                return Upload.LIST_IGNORE
              }}
            >
              <p className="ant-upload-drag-icon">
                <UploadOutlined style={{ fontSize: 40, color: '#1890ff' }} />
              </p>
              <p className="ant-upload-text">点击或拖拽 PDF、TXT、MD、图片到此处</p>
              <p className="ant-upload-hint">将根据文件名识别知识名称与类型，您可审核后保存</p>
            </Upload.Dragger>
          </div>

          {pendingFiles.length > 0 && (
            <>
              <div>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>已选 {pendingFiles.length} 个文件</Text>
                <List
                  size="small"
                  dataSource={pendingFiles}
                  renderItem={(file, idx) => (
                    <List.Item
                      actions={[
                        <Button type="link" size="small" danger key="del" onClick={() => removePendingFile(idx)}>
                          移除
                        </Button>,
                      ]}
                    >
                      <FileOutlined /> {file.name}
                    </List.Item>
                  )}
                />
              </div>
              <div>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>2. 审核并填写</Text>
                <Form layout="vertical" size="small">
                  <Form.Item label="知识名称" required>
                    <Input
                      placeholder="根据文件名已识别，可修改"
                      value={reviewTitle}
                      onChange={(e) => setReviewTitle(e.target.value)}
                    />
                  </Form.Item>
                  <Form.Item label="知识类型">
                    <Select
                      style={{ width: '100%' }}
                      value={reviewType}
                      onChange={setReviewType}
                      options={KNOWLEDGE_TYPES}
                    />
                  </Form.Item>
                  <Form.Item label="编码（可选，留空自动生成）">
                    <Input
                      placeholder="如不填将根据名称自动生成"
                      value={reviewCode}
                      onChange={(e) => setReviewCode(e.target.value)}
                    />
                  </Form.Item>
                </Form>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <Button onClick={() => setPendingFiles([])}>重新选择附件</Button>
                <Space>
                  <Button onClick={closeAddByUpload}>取消</Button>
                  <Button type="primary" loading={addSaving} onClick={handleAddByUploadSave}>
                    保存
                  </Button>
                </Space>
              </div>
            </>
          )}
        </Space>
      </Modal>

      <Modal
        title={
          previewFile
            ? stripKnowledgeStoredFilePrefix(previewFile.file_name) || previewFile.file_name
            : (previewContentRow?.title ?? '预览')
        }
        open={previewOpen}
        onCancel={closePreview}
        footer={null}
        width={previewFile?.file_type === 'image' ? 800 : 900}
        styles={{ body: { padding: 0, minHeight: 400 } }}
        destroyOnClose
      >
        {previewLoading && previewFile && <div style={{ padding: 24, textAlign: 'center' }}>加载中…</div>}
        {!previewLoading && previewFile && (
          <>
            {previewFile.file_type === 'image' && previewObjectUrl && (
              <div style={{ padding: 16, textAlign: 'center' }}>
                <img
                  src={previewObjectUrl}
                  alt={stripKnowledgeStoredFilePrefix(previewFile.file_name) || previewFile.file_name}
                  style={{ maxWidth: '100%', maxHeight: '80vh' }}
                />
              </div>
            )}
            {previewFile.file_type === 'txt' && (
              <pre style={{ whiteSpace: 'pre-wrap', padding: 16, margin: 0, maxHeight: '80vh', overflow: 'auto' }}>
                {previewText}
              </pre>
            )}
            {previewFile.file_type === 'md' && (
              <div
                className="markdown-preview"
                style={{
                  padding: '20px 24px',
                  margin: 0,
                  maxHeight: '80vh',
                  overflow: 'auto',
                }}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children, ...props }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                        {children}
                      </a>
                    ),
                  }}
                >
                  {previewText}
                </ReactMarkdown>
              </div>
            )}
          </>
        )}
        {previewContentRow && !previewFile && (
          <div
            className="markdown-preview"
            style={{
              padding: '20px 24px',
              margin: 0,
              maxHeight: '80vh',
              overflow: 'auto',
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...props }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                    {children}
                  </a>
                ),
              }}
            >
              {previewText}
            </ReactMarkdown>
          </div>
        )}
      </Modal>

      <Modal
        title={editingId ? '编辑知识' : '新增知识'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="code" label="编码" rules={[{ required: true, message: '请输入编码' }]}>
            <Input placeholder="如 EQ_IPC_4MP" disabled={!!editingId} />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="知识标题" />
          </Form.Item>
          <Form.Item name="knowledge_type" label="知识类型" rules={[{ required: true }]}>
            <Select options={KNOWLEDGE_TYPES} placeholder="选择知识类型" />
          </Form.Item>
          <Form.Item name="system_type" label="子系统类型">
            <Select options={SYSTEM_TYPES} placeholder="general/video/access/cabling 等" />
          </Form.Item>
          <Form.Item name="scene_tags" label="适用场景(JSON 数组)">
            <Input placeholder='如 ["office","parking"]，留空表示通用' />
          </Form.Item>
          <Form.Item name="content" label="正文内容">
            <Input.TextArea rows={6} placeholder="Markdown 或纯文本，供检索与 AI 引用" />
          </Form.Item>
          <Form.Item name="structured_json" label="结构化数据(JSON)">
            <Input.TextArea rows={3} placeholder="设备参数、模板清单等 JSON，可选" />
          </Form.Item>
          <Form.Item name="keywords" label="检索关键词">
            <Input placeholder="逗号或空格分隔，便于 LIKE 检索" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" initialValue={true}>
            <Select
              options={[
                { label: '启用', value: true },
                { label: '停用', value: false },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}

export default KnowledgePage
