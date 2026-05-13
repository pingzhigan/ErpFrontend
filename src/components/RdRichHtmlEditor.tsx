/**
 * 研发富文本 HTML 编辑器（TipTap），用于研发文档等模块；支持粘贴 / 拖入 / 工具栏插入图片。
 * 未传 uploadImage 时：压缩后以 data URL 写入；传入 uploadImage 时：走服务端落盘，正文中为图片 URL。
 */
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  CodeOutlined,
  CommentOutlined,
  FontSizeOutlined,
  ItalicOutlined,
  LinkOutlined,
  OrderedListOutlined,
  PictureOutlined,
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
import { App, Button, Divider, Dropdown, Space, Tooltip, theme } from 'antd'
import DOMPurify from 'dompurify'
import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react'

/** 单张粘贴图 data URL 长度上限（约对应 ~800KB 原图经压缩后） */
const MAX_DATA_URL_CHARS = 1_100_000

let domPurifyDataImageHookRegistered = false
function ensureDomPurifyDataImageHook(): void {
  if (domPurifyDataImageHookRegistered) return
  domPurifyDataImageHookRegistered = true
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (node.nodeName !== 'IMG' || data.attrName !== 'src') return
    const v = data.attrValue
    if (typeof v !== 'string') return
    if (v.startsWith('data:image/') || v.startsWith('/api/rd/richtext-body-images/')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(data as any).forceKeepAttr = true
    }
  })
}

export function sanitizeRdRichPreviewHtml(html: string): string {
  ensureDomPurifyDataImageHook()
  return DOMPurify.sanitize(html || '', { USE_PROFILES: { html: true } })
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('读取文件失败'))
    r.readAsDataURL(file)
  })
}

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

async function insertImageFromFile(
  editor: Editor,
  file: File,
  uploadImage: ((f: File) => Promise<string>) | undefined,
  onError: (m: string) => void,
): Promise<void> {
  try {
    const src = uploadImage ? await uploadImage(file) : await fileToCompressedDataUrl(file)
    editor.chain().focus().setImage({ src }).run()
  } catch (e: unknown) {
    onError(e instanceof Error ? e.message : '插入图片失败')
  }
}

function tryConsumeImageDataTransfer(
  editor: Editor,
  dt: DataTransfer | null,
  uploadImage: ((f: File) => Promise<string>) | undefined,
  onError: (m: string) => void,
): boolean {
  if (!dt) return false
  const files = Array.from(dt.files || []).filter((f) => f.type.startsWith('image/'))
  if (files.length > 0) {
    void insertImageFromFile(editor, files[0], uploadImage, onError)
    return true
  }
  for (const item of Array.from(dt.items || [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) {
        void insertImageFromFile(editor, f, uploadImage, onError)
        return true
      }
    }
  }
  return false
}

function buildTiptapExtensions(placeholder: string) {
  return [
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
    Placeholder.configure({ placeholder }),
    Image.configure({
      inline: true,
      allowBase64: true,
      HTMLAttributes: { class: 'rd-tiptap-content-img' },
    }),
  ]
}

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

export type RdRichHtmlEditorProps = {
  html: string
  onChange: (next: string) => void
  mountKey: number
  /** TipTap 占位提示 */
  placeholder?: string
  /** 若提供，则插入/粘贴/拖入图片时上传并返回正文中使用的 src（通常为同源相对路径） */
  uploadImage?: (file: File) => Promise<string>
}

/** mountKey 变化时由 useEditor 依赖重建实例 */
export function RdRichHtmlEditor({
  html,
  onChange,
  mountKey,
  placeholder = '请输入正文，可直接粘贴截图或图片…',
  uploadImage,
}: RdRichHtmlEditorProps) {
  const { message: msg } = App.useApp()
  const editorRef = useRef<Editor | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadImageRef = useRef(uploadImage)
  useLayoutEffect(() => {
    uploadImageRef.current = uploadImage
  }, [uploadImage])

  const extensions = useMemo(() => buildTiptapExtensions(placeholder), [placeholder])

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: true,
      extensions,
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
          if (tryConsumeImageDataTransfer(ed, event.clipboardData, uploadImageRef.current, (m) => msg.error(m))) {
            event.preventDefault()
            return true
          }
          return false
        },
        handleDrop: (_view, event) => {
          const ed = editorRef.current
          if (!ed) return false
          if (tryConsumeImageDataTransfer(ed, event.dataTransfer, uploadImageRef.current, (m) => msg.error(m))) {
            event.preventDefault()
            return true
          }
          return false
        },
      },
    },
    [mountKey, extensions],
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
      void insertImageFromFile(ed, f, uploadImageRef.current, (m) => msg.error(m))
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
