/**
 * 研发管理 — 研发待办：富文本编辑与预览、增删改查。
 * 正文使用 TipTap（HTML）；支持粘贴 / 拖入 / 工具栏插入图片（压缩后以 data URL 写入，便于无鉴权 URL 的持久化展示）。
 */
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  CommentOutlined,
  BoldOutlined,
  CodeOutlined,
  DeleteOutlined,
  EditOutlined,
  FontSizeOutlined,
  ItalicOutlined,
  LinkOutlined,
  OrderedListOutlined,
  PictureOutlined,
  PlusOutlined,
  RedoOutlined,
  StrikethroughOutlined,
  UnderlineOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import type { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { MenuProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  App,
  Button,
  Card,
  Divider,
  Dropdown,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tabs,
  Tooltip,
  Typography,
  theme,
} from 'antd'
import axios from 'axios'
import DOMPurify from 'dompurify'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

const { Title } = Typography

/** 单张粘贴图 data URL 长度上限（约对应 ~800KB 原图经压缩后） */
const MAX_DATA_URL_CHARS = 1_100_000

let domPurifyDataImageHookRegistered = false
function ensureDomPurifyDataImageHook(): void {
  if (domPurifyDataImageHookRegistered) return
  domPurifyDataImageHookRegistered = true
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (node.nodeName !== 'IMG' || data.attrName !== 'src') return
    const v = data.attrValue
    if (typeof v === 'string' && v.startsWith('data:image/')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(data as any).forceKeepAttr = true
    }
  })
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('读取文件失败'))
    r.readAsDataURL(file)
  })
}

/** 将光栅图压到合适尺寸并尽量转为 JPEG，控制 data URL 长度 */
async function fileToCompressedDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件')
  }
  if (file.type === 'image/gif') {
    const raw = await readFileAsDataUrl(file)
    if (raw.length <= MAX_DATA_URL_CHARS) return raw
    throw new Error('GIF 动图过大，请换用较小的静态图或另存为 PNG/JPEG')
  }
  try {
    const bmp = await createImageBitmap(file)
    let { width, height } = bmp
    const maxW = 1600
    if (width > maxW) {
      height = Math.round((height * maxW) / width)
      width = maxW
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bmp.close()
      throw new Error('无法处理图片')
    }
    ctx.drawImage(bmp, 0, 0, width, height)
    bmp.close()
    let q = 0.88
    let dataUrl = canvas.toDataURL('image/jpeg', q)
    while (dataUrl.length > MAX_DATA_URL_CHARS && q > 0.42) {
      q -= 0.08
      dataUrl = canvas.toDataURL('image/jpeg', q)
    }
    if (dataUrl.length > MAX_DATA_URL_CHARS) {
      throw new Error('图片仍过大，请选择更小的图片')
    }
    return dataUrl
  } catch {
    const raw = await readFileAsDataUrl(file)
    if (raw.length > MAX_DATA_URL_CHARS) {
      throw new Error('图片过大，请换用较小的图片')
    }
    return raw
  }
}

async function insertImageFromFile(editor: Editor, file: File, onError: (m: string) => void): Promise<void> {
  try {
    const src = await fileToCompressedDataUrl(file)
    editor.chain().focus().setImage({ src }).run()
  } catch (e: unknown) {
    onError(e instanceof Error ? e.message : '插入图片失败')
  }
}

function tryConsumeImageDataTransfer(editor: Editor, dt: DataTransfer | null, onError: (m: string) => void): boolean {
  if (!dt) return false
  const files = Array.from(dt.files || []).filter((f) => f.type.startsWith('image/'))
  if (files.length > 0) {
    void insertImageFromFile(editor, files[0], onError)
    return true
  }
  for (const item of Array.from(dt.items || [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) {
        void insertImageFromFile(editor, f, onError)
        return true
      }
    }
  }
  return false
}

const tiptapExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
  }),
  Underline,
  Link.configure({
    openOnClick: false,
    autolink: true,
    linkOnPaste: true,
    defaultProtocol: 'https',
  }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Placeholder.configure({ placeholder: '请输入正文，可直接粘贴截图或图片…' }),
  Image.configure({
    inline: true,
    allowBase64: true,
    HTMLAttributes: { class: 'rd-tiptap-content-img' },
  }),
]

function TbIconBtn({
  title,
  active,
  disabled,
  icon,
  onClick,
}: {
  title: string
  active?: boolean
  disabled?: boolean
  icon: React.ReactNode
  onClick: () => void
}) {
  const { token } = theme.useToken()
  return (
    <Tooltip title={title}>
      <Button
        type="text"
        size="small"
        className="rd-tiptap-toolbar-btn"
        disabled={disabled}
        icon={icon}
        onClick={onClick}
        style={{
          color: active ? token.colorPrimary : token.colorText,
          background: active ? token.colorPrimaryBg : undefined,
        }}
      />
    </Tooltip>
  )
}

function RdTiptapMenuBar({
  editor,
  onInsertImagePick,
}: {
  editor: Editor | null
  onInsertImagePick: () => void
}) {
  const { token } = theme.useToken()

  if (!editor) return null

  const headingMenu: MenuProps['items'] = [
    {
      key: 'p',
      label: '正文',
      onClick: () => editor.chain().focus().setParagraph().run(),
    },
    { type: 'divider' },
    {
      key: 'h1',
      label: '标题 1',
      onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      key: 'h2',
      label: '标题 2',
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: 'h3',
      label: '标题 3',
      onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
  ]

  const linkActive = editor.isActive('link')

  return (
    <div className="rd-tiptap-menubar">
      <Space size={2} wrap align="center">
        <TbIconBtn title="撤销" disabled={!editor.can().undo()} icon={<UndoOutlined />} onClick={() => editor.chain().focus().undo().run()} />
        <TbIconBtn title="重做" disabled={!editor.can().redo()} icon={<RedoOutlined />} onClick={() => editor.chain().focus().redo().run()} />
        <Divider type="vertical" className="rd-tiptap-toolbar-divider" />
        <Dropdown menu={{ items: headingMenu }} trigger={['click']}>
          <Tooltip title="标题 / 正文">
            <Button
              type="text"
              size="small"
              className="rd-tiptap-toolbar-btn rd-tiptap-toolbar-btn-wide"
              icon={<FontSizeOutlined />}
              style={{
                color: editor.isActive('heading') ? token.colorPrimary : token.colorText,
                background: editor.isActive('heading') ? token.colorPrimaryBg : undefined,
              }}
            />
          </Tooltip>
        </Dropdown>
        <TbIconBtn title="粗体" active={editor.isActive('bold')} icon={<BoldOutlined />} onClick={() => editor.chain().focus().toggleBold().run()} />
        <TbIconBtn title="斜体" active={editor.isActive('italic')} icon={<ItalicOutlined />} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <TbIconBtn title="下划线" active={editor.isActive('underline')} icon={<UnderlineOutlined />} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <TbIconBtn title="删除线" active={editor.isActive('strike')} icon={<StrikethroughOutlined />} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <Divider type="vertical" className="rd-tiptap-toolbar-divider" />
        <TbIconBtn
          title="无序列表"
          active={editor.isActive('bulletList')}
          icon={<UnorderedListOutlined />}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <TbIconBtn
          title="有序列表"
          active={editor.isActive('orderedList')}
          icon={<OrderedListOutlined />}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <TbIconBtn title="引用" active={editor.isActive('blockquote')} icon={<CommentOutlined />} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
        <TbIconBtn title="代码块" active={editor.isActive('codeBlock')} icon={<CodeOutlined />} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
        <Divider type="vertical" className="rd-tiptap-toolbar-divider" />
        <TbIconBtn
          title="左对齐"
          active={editor.isActive({ textAlign: 'left' })}
          icon={<AlignLeftOutlined />}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
        />
        <TbIconBtn
          title="居中"
          active={editor.isActive({ textAlign: 'center' })}
          icon={<AlignCenterOutlined />}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
        />
        <TbIconBtn
          title="右对齐"
          active={editor.isActive({ textAlign: 'right' })}
          icon={<AlignRightOutlined />}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
        />
        <Divider type="vertical" className="rd-tiptap-toolbar-divider" />
        <TbIconBtn
          title="链接"
          active={linkActive}
          icon={<LinkOutlined />}
          onClick={() => {
            const prev = editor.getAttributes('link').href as string | undefined
            const url = window.prompt('链接地址（留空则移除链接）', prev || 'https://')
            if (url === null) return
            const t = url.trim()
            if (t === '') {
              editor.chain().focus().extendMarkRange('link').unsetLink().run()
              return
            }
            editor.chain().focus().extendMarkRange('link').setLink({ href: t }).run()
          }}
        />
        <TbIconBtn title="插入图片" icon={<PictureOutlined />} onClick={onInsertImagePick} />
      </Space>
    </div>
  )
}

/** mountKey 变化时由 useEditor 依赖重建实例 */
function RdTodoTiptapEditor({
  html,
  onChange,
  mountKey,
}: {
  html: string
  onChange: (next: string) => void
  mountKey: number
}) {
  const { message: msg } = App.useApp()
  const editorRef = useRef<Editor | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: true,
      extensions: tiptapExtensions,
      content: html || '<p></p>',
      onUpdate: ({ editor: ed }) => {
        onChange(ed.getHTML())
      },
      editorProps: {
        attributes: {
          class: 'rd-tiptap-prosemirror',
        },
        handlePaste: (_view, event) => {
          const ed = editorRef.current
          if (!ed) return false
          if (tryConsumeImageDataTransfer(ed, event.clipboardData, (m) => msg.error(m))) {
            event.preventDefault()
            return true
          }
          return false
        },
        handleDrop: (_view, event) => {
          const ed = editorRef.current
          if (!ed) return false
          if (tryConsumeImageDataTransfer(ed, event.dataTransfer, (m) => msg.error(m))) {
            event.preventDefault()
            return true
          }
          return false
        },
      },
    },
    [mountKey],
  )

  useLayoutEffect(() => {
    editorRef.current = editor
  }, [editor])

  const onPickFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const ed = editorRef.current
      const f = e.target.files?.[0]
      e.target.value = ''
      if (!ed || !f) return
      void insertImageFromFile(ed, f, (m) => msg.error(m))
    },
    [msg],
  )

  return (
    <div className="rd-tiptap-shell">
      <input ref={fileInputRef} type="file" accept="image/*" className="rd-tiptap-file-input" onChange={onFileChange} aria-hidden />
      <RdTiptapMenuBar editor={editor} onInsertImagePick={onPickFile} />
      {editor ? <EditorContent editor={editor} /> : <div className="rd-tiptap-prosemirror">加载编辑器…</div>}
    </div>
  )
}

export type RdResearchTodoRow = {
  id: number
  title: string
  body_html: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

const RdResearchTodosPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<RdResearchTodoRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form] = Form.useForm<{ title: string }>()
  const [bodyHtml, setBodyHtml] = useState('')
  const [editTab, setEditTab] = useState<string>('edit')
  const [editorMountKey, setEditorMountKey] = useState(0)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { limit: pageSize, offset: (page - 1) * pageSize }
      if (keyword.trim()) params.keyword = keyword.trim()
      const res = await axios.get<{ list: RdResearchTodoRow[]; total: number }>('/api/rd/todos', { params })
      setList(res.data?.list ?? [])
      setTotal(res.data?.total ?? 0)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, keyword, msg])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const openCreate = () => {
    setEditingId(null)
    setBodyHtml('')
    setEditTab('edit')
    setEditorMountKey((k) => k + 1)
    setModalOpen(true)
  }

  const openEdit = (row: RdResearchTodoRow) => {
    setEditingId(row.id)
    setBodyHtml(row.body_html || '')
    setEditTab('edit')
    setEditorMountKey((k) => k + 1)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingId(null)
    setBodyHtml('')
    setEditTab('edit')
  }

  const handleSubmit = async () => {
    try {
      const { title } = await form.validateFields()
      const payload = { title, body_html: bodyHtml }
      if (editingId) {
        await axios.put(`/api/rd/todos/${editingId}`, payload)
        msg.success('已保存')
      } else {
        await axios.post('/api/rd/todos', payload)
        msg.success('已创建')
      }
      closeModal()
      void fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    }
  }

  const columns: ColumnsType<RdResearchTodoRow> = [
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true },
    { title: '更新人', dataIndex: 'updated_by', key: 'updated_by', width: 120, render: (v) => v || '—' },
    { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 180 },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_, row) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm title="确定删除？" onConfirm={() => void handleDelete(row.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`/api/rd/todos/${id}`)
      msg.success('已删除')
      void fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const safePreviewHtml = useMemo(() => {
    ensureDomPurifyDataImageHook()
    return DOMPurify.sanitize(bodyHtml || '', { USE_PROFILES: { html: true } })
  }, [bodyHtml])

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Title level={4} style={{ margin: 0 }}>
        研发待办
      </Title>
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder="标题 / 正文关键词"
            style={{ width: 280 }}
            onSearch={(v) => {
              setKeyword(v)
              setPage(1)
            }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建
          </Button>
          <Button onClick={() => void fetchList()}>刷新</Button>
        </Space>
        <Table<RdResearchTodoRow>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={list}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p)
              setPageSize(ps)
            },
          }}
        />
      </Card>

      <Modal
        title={editingId ? '编辑待办' : '新建待办'}
        open={modalOpen}
        onOk={() => void handleSubmit()}
        onCancel={closeModal}
        width={900}
        destroyOnHidden
        afterOpenChange={(open) => {
          if (!open) return
          if (editingId == null) {
            form.resetFields()
          } else {
            const row = list.find((r) => r.id === editingId)
            if (row) form.setFieldsValue({ title: row.title })
          }
        }}
        styles={{ body: { paddingTop: 12 } }}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="标题" />
          </Form.Item>
        </Form>
        <Tabs
          destroyInactiveTabPane
          activeKey={editTab}
          onChange={(key) => {
            setEditTab(key)
            if (key === 'edit') setEditorMountKey((k) => k + 1)
          }}
          items={[
            {
              key: 'edit',
              label: '编辑',
              children: <RdTodoTiptapEditor mountKey={editorMountKey} html={bodyHtml} onChange={setBodyHtml} />,
            },
            {
              key: 'preview',
              label: '预览',
              children: (
                <div
                  className="rd-rich-html-preview"
                  style={{
                    minHeight: 360,
                    padding: 12,
                    border: '1px solid #f0f0f0',
                    borderRadius: 6,
                    overflow: 'auto',
                  }}
                  dangerouslySetInnerHTML={{ __html: safePreviewHtml }}
                />
              ),
            },
          ]}
        />
      </Modal>
    </Space>
  )
}

export default RdResearchTodosPage
