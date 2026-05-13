/**
 * 研发管理 — 研发文档：文件夹树、文件上传与图片/PDF/Markdown 预览。
 */
import { DeleteOutlined, DownloadOutlined, EyeOutlined, FolderAddOutlined, FolderOutlined, UploadOutlined } from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import type { ColumnsType } from 'antd/es/table'
import { App, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Table, Tree, Typography, Upload } from 'antd'
import type { UploadProps } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const { Title, Text } = Typography

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
    return list.map((f) => ({
      key: String(f.id),
      title: f.name,
      icon: <FolderOutlined />,
      children: build(f.id),
    }))
  }
  return build(null)
}

const RdResearchDocsPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)

  const [files, setFiles] = useState<RdDocFileRow[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)

  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [folderModalMode, setFolderModalMode] = useState<'create' | 'rename' | 'move'>('create')
  const [folderForm] = Form.useForm<{ name: string; parent_id?: number }>()
  const [folderEditingId, setFolderEditingId] = useState<number | null>(null)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState<RdDocFileRow | null>(null)
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

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

  const loadFiles = useCallback(
    async (folderId: number) => {
      setLoadingFiles(true)
      try {
        const res = await axios.get<{ list: RdDocFileRow[] }>(`/api/rd/doc-folders/${folderId}/files`)
        setFiles(res.data?.list ?? [])
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载文件失败')
        setFiles([])
      } finally {
        setLoadingFiles(false)
      }
    },
    [msg],
  )

  useEffect(() => {
    if (selectedFolderId != null) void loadFiles(selectedFolderId)
    else setFiles([])
  }, [selectedFolderId, loadFiles])

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

  const uploadProps: UploadProps = useMemo(() => {
    if (selectedFolderId == null) {
      return { disabled: true }
    }
    return {
      name: 'file',
      multiple: false,
      showUploadList: false,
      customRequest: async (options) => {
        const { file, onError, onSuccess } = options
        const fd = new FormData()
        fd.append('file', file as File)
        try {
          await axios.post(`/api/rd/doc-folders/${selectedFolderId}/files`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          msg.success('上传成功')
          onSuccess?.({}, new XMLHttpRequest())
          void loadFiles(selectedFolderId)
          void loadFolders()
        } catch (e: unknown) {
          msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '上传失败')
          onError?.(e as Error)
        }
      },
    }
  }, [selectedFolderId, msg, loadFiles, loadFolders])

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

  const openPreview = useCallback(
    (file: RdDocFileRow) => {
      if (file.file_type === 'pdf') {
        void openPdfInNewTab(file)
        return
      }
      setPreviewFile(file)
      setPreviewOpen(true)
      setPreviewObjectUrl(null)
      setPreviewText('')
    },
    [openPdfInNewTab],
  )

  useEffect(() => {
    if (!previewOpen || !previewFile || previewFile.file_type === 'pdf') return
    let objectUrl: string | null = null
    setPreviewLoading(true)
    const isText = previewFile.file_type === 'md'
    const req = isText
      ? axios.get(`/api/rd/doc-files/${previewFile.id}/preview`, { responseType: 'text' })
      : axios.get(`/api/rd/doc-files/${previewFile.id}/preview`, { responseType: 'blob' })
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
  }, [previewOpen, previewFile, msg])

  const closePreview = () => {
    setPreviewOpen(false)
    setPreviewFile(null)
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

  const deleteFile = async (file: RdDocFileRow) => {
    try {
      await axios.delete(`/api/rd/doc-files/${file.id}`)
      msg.success('已删除')
      if (selectedFolderId != null) void loadFiles(selectedFolderId)
      void loadFolders()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
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
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '移动失败')
    }
  }

  const folderParentOptions = useMemo(
    () =>
      folders
        .filter((f) => f.id !== folderEditingId)
        .map((f) => ({ value: f.id, label: `${f.name}（id: ${f.id}）` })),
    [folders, folderEditingId],
  )

  const fileColumns: ColumnsType<RdDocFileRow> = [
    { title: '文件名', dataIndex: 'file_name', key: 'file_name', ellipsis: true },
    { title: '类型', dataIndex: 'file_type', key: 'file_type', width: 80 },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 100,
      render: (n: number) => `${Math.round((n || 0) / 1024)} KB`,
    },
    { title: '上传时间', dataIndex: 'created_at', key: 'created_at', width: 180 },
    {
      title: '操作',
      key: 'op',
      width: 220,
      render: (_, row) => (
        <Space wrap>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openPreview(row)}>
            预览
          </Button>
          <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => void handleDownload(row)}>
            下载
          </Button>
          <Button type="link" size="small" onClick={() => openMoveFile(row)}>
            移动
          </Button>
          <Popconfirm title="确定删除？" onConfirm={() => void deleteFile(row)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Title level={4} style={{ margin: 0 }}>
        研发文档
      </Title>
      <Row gutter={16}>
        <Col xs={24} md={8} lg={7}>
          <Card title="文件夹" size="small" loading={loadingFolders} extra={<Button size="small" onClick={() => void loadFolders()}>刷新</Button>}>
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
            {treeData.length === 0 ? (
              <Text type="secondary">暂无文件夹，点击「新建」在根目录创建。</Text>
            ) : (
              <Tree showIcon defaultExpandAll selectedKeys={selectedFolderId != null ? [String(selectedFolderId)] : []} treeData={treeData} onSelect={onTreeSelect} />
            )}
          </Card>
        </Col>
        <Col xs={24} md={16} lg={17}>
          <Card
            title="文件"
            size="small"
            extra={
              <Upload {...uploadProps}>
                <Button size="small" icon={<UploadOutlined />} disabled={selectedFolderId == null}>
                  上传
                </Button>
              </Upload>
            }
          >
            {selectedFolderId == null ? (
              <Text type="secondary">请先在左侧选择文件夹。</Text>
            ) : (
              <Table<RdDocFileRow>
                rowKey="id"
                size="small"
                loading={loadingFiles}
                columns={fileColumns}
                dataSource={files}
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
            <Select options={folders.map((f) => ({ value: f.id, label: `${f.name}（id: ${f.id}）` }))} showSearch optionFilterProp="label" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={previewFile?.file_name ?? '预览'}
        open={previewOpen}
        onCancel={closePreview}
        footer={null}
        width={previewFile?.file_type === 'image' ? 800 : 900}
        styles={{ body: { padding: 0, minHeight: 400 } }}
        destroyOnHidden
      >
        {previewLoading && previewFile && <div style={{ padding: 24, textAlign: 'center' }}>加载中…</div>}
        {!previewLoading && previewFile && (
          <>
            {previewFile.file_type === 'image' && previewObjectUrl && (
              <div style={{ padding: 16, textAlign: 'center' }}>
                <img src={previewObjectUrl} alt={previewFile.file_name} style={{ maxWidth: '100%', maxHeight: '80vh' }} />
              </div>
            )}
            {previewFile.file_type === 'md' && (
              <div className="markdown-preview" style={{ padding: '20px 24px', margin: 0, maxHeight: '80vh', overflow: 'auto' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewText}</ReactMarkdown>
              </div>
            )}
          </>
        )}
      </Modal>
    </Space>
  )
}

export default RdResearchDocsPage
