/**
 * 研发富文本 HTML 编辑器（TipTap）：标题 Enter/Tab 大纲键、加粗/对齐/链接/图、文字色与高亮、分割线等；支持粘贴 / 拖入 / 工具栏插入图片。
 * 未传 uploadImage 时：压缩后以 data URL 写入；传入 uploadImage 时：走服务端落盘，正文中为图片 URL。
 * 正文在保存/预览侧经 sanitizeRdRichBodyHtml 清洗；编辑态 onChange 使用 TipTap 原始 HTML，避免清洗与编辑器不同步导致图片或样式丢失。
 */
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  CodeOutlined,
  ColumnHeightOutlined,
  CommentOutlined,
  FontColorsOutlined,
  FontSizeOutlined,
  HighlightOutlined,
  ItalicOutlined,
  LineOutlined,
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
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { InputRef, MenuProps } from 'antd'
import { App, Button, ColorPicker, Divider, Dropdown, Input, InputNumber, Modal, Popover, Select, Space, Tooltip, Typography, theme } from 'antd'
import React, { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RD_RICH_MAX_DATA_URL_CHARS, sanitizeRdRichBodyHtml, sanitizeRichTextLinkHref } from '../utils/rdRichHtmlSanitize'
import { appendAccessTokenToSinglePreviewUrl } from '../utils/rdRichPreviewAuthUrls'
import { RdHeadingOutlineKeys } from './RdHeadingOutlineKeys'

export { sanitizeRdRichBodyHtml, sanitizeRdRichPreviewHtml, sanitizeRichTextLinkHref } from '../utils/rdRichHtmlSanitize'

const FONT_COLOR_PRESETS = [
  '#000000',
  '#262626',
  '#595959',
  '#8c8c8c',
  '#f5222d',
  '#fa8c16',
  '#fadb14',
  '#52c41a',
  '#13c2c2',
  '#1677ff',
  '#722ed1',
  '#eb2f96',
]

const HIGHLIGHT_PRESETS = ['#fff566', '#d9f7be', '#bae7ff', '#ffccc7', '#ffd8bf', '#e6f4ff', '#f9f0ff', '#fff1b8']

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
    if (raw.length <= RD_RICH_MAX_DATA_URL_CHARS) return raw
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
    while (dataUrl.length > RD_RICH_MAX_DATA_URL_CHARS && q > 0.42) {
      q -= 0.08
      dataUrl = canvas.toDataURL('image/jpeg', q)
    }
    if (dataUrl.length > RD_RICH_MAX_DATA_URL_CHARS) {
      throw new Error('图片仍过大，请选择更小的图片')
    }
    return dataUrl
  } catch {
    const raw = await readFileAsDataUrl(file)
    if (raw.length > RD_RICH_MAX_DATA_URL_CHARS) {
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
  decorateUploadedSrc?: (url: string) => string,
): Promise<void> {
  try {
    let src: string
    if (uploadImage) {
      const raw = await uploadImage(file)
      src = decorateUploadedSrc ? decorateUploadedSrc(raw) : raw
    } else {
      src = await fileToCompressedDataUrl(file)
    }
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
  decorateUploadedSrc?: (url: string) => string,
): boolean {
  if (!dt) return false
  const files = Array.from(dt.files || []).filter((f) => f.type.startsWith('image/'))
  if (files.length > 0) {
    void insertImageFromFile(editor, files[0], uploadImage, onError, decorateUploadedSrc)
    return true
  }
  for (const item of Array.from(dt.items || [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) {
        void insertImageFromFile(editor, f, uploadImage, onError, decorateUploadedSrc)
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
    RdHeadingOutlineKeys,
    TextStyleKit.configure({
      fontFamily: false,
      fontSize: {},
      lineHeight: false,
    }),
    Highlight.configure({
      multicolor: true,
      HTMLAttributes: { class: 'rd-tiptap-highlight' },
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
  const { message: msg } = App.useApp()
  const [fontSizeOpen, setFontSizeOpen] = useState(false)
  const [customSizeNum, setCustomSizeNum] = useState<number | null>(16)
  const [customSizeUnit, setCustomSizeUnit] = useState<'px' | 'pt'>('px')
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const linkInputRef = useRef<InputRef>(null)

  const openLinkModal = useCallback(() => {
    if (!editor) return
    const prev = editor.getAttributes('link').href as string | undefined
    setLinkDraft(prev?.trim() ? prev : 'https://')
    setLinkModalOpen(true)
  }, [editor])

  const closeLinkModal = useCallback(() => {
    setLinkModalOpen(false)
  }, [])

  const submitLinkModal = useCallback(() => {
    if (!editor) return
    const result = sanitizeRichTextLinkHref(linkDraft)
    if (!result.ok) {
      msg.error(result.message)
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: result.href }).run()
    setLinkModalOpen(false)
  }, [editor, linkDraft, msg])

  const removeLinkFromModal = useCallback(() => {
    if (!editor) return
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    setLinkModalOpen(false)
  }, [editor])

  const headingMenu: MenuProps['items'] = useMemo(() => {
    if (!editor) return []
    return [
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
  }, [editor])

  const FONT_SIZE_PRESETS = ['12px', '13px', '14px', '15px', '16px', '18px', '20px', '22px', '24px', '28px', '32px', '36px', '40px'] as const
  const fontSizeMenu: MenuProps['items'] = useMemo(() => {
    if (!editor) return []
    return [
      {
        key: 'fs-clear',
        label: '默认字号',
        onClick: () => {
          editor.chain().focus().unsetFontSize().run()
          setFontSizeOpen(false)
        },
      },
      { type: 'divider' },
      ...FONT_SIZE_PRESETS.map((sz) => ({
        key: `fs-${sz}`,
        label: sz,
        onClick: () => {
          editor.chain().focus().setFontSize(sz).run()
          setFontSizeOpen(false)
        },
      })),
    ]
  }, [editor])

  const applyCustomFontSize = () => {
    if (!editor) return
    if (customSizeNum == null || !Number.isFinite(customSizeNum) || customSizeNum <= 0) {
      msg.warning('请输入有效字号')
      return
    }
    const rounded = Math.round(customSizeNum * 100) / 100
    const clamped = Math.min(192, Math.max(8, rounded))
    editor.chain().focus().setFontSize(`${clamped}${customSizeUnit}`).run()
    setFontSizeOpen(false)
  }

  if (!editor) return null

  const linkActive = editor.isActive('link')
  const currentFontSize = editor.getAttributes('textStyle').fontSize as string | undefined

  const syncCustomFromSelection = () => {
    const fs = editor.getAttributes('textStyle').fontSize as string | undefined
    if (fs) {
      const m = /^(\d+(?:\.\d+)?)(px|pt)$/i.exec(String(fs).trim())
      if (m) {
        setCustomSizeNum(Number(m[1]))
        setCustomSizeUnit(m[2].toLowerCase() as 'px' | 'pt')
        return
      }
    }
    setCustomSizeNum(16)
    setCustomSizeUnit('px')
  }

  return (
    <>
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
        <Dropdown
          open={fontSizeOpen}
          onOpenChange={(open) => {
            setFontSizeOpen(open)
            if (open) syncCustomFromSelection()
          }}
          trigger={['click']}
          menu={{ items: fontSizeMenu }}
          dropdownRender={(menu) => (
            <div className="rd-tiptap-fontsize-dropdown">
              {menu}
              <Divider style={{ margin: '8px 0' }} />
              <div
                className="rd-tiptap-fontsize-custom"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 6 }}>自定义</div>
                <Space.Compact style={{ width: '100%' }}>
                  <InputNumber
                    size="small"
                    min={8}
                    max={192}
                    step={0.5}
                    value={customSizeNum}
                    onChange={(v) => setCustomSizeNum(typeof v === 'number' ? v : null)}
                    style={{ width: '100%', minWidth: 0, flex: 1 }}
                    placeholder="数值"
                  />
                  <Select
                    size="small"
                    value={customSizeUnit}
                    onChange={(v) => setCustomSizeUnit(v as 'px' | 'pt')}
                    options={[
                      { value: 'px', label: 'px' },
                      { value: 'pt', label: 'pt' },
                    ]}
                    style={{ width: 64 }}
                  />
                  <Button size="small" type="primary" onClick={applyCustomFontSize}>
                    应用
                  </Button>
                </Space.Compact>
              </div>
            </div>
          )}
        >
          <Tooltip title="字号">
            <Button
              type="text"
              size="small"
              className="rd-tiptap-toolbar-btn rd-tiptap-toolbar-btn-wide rd-tiptap-fontsize-trigger"
              style={{
                color: currentFontSize ? token.colorPrimary : token.colorText,
                background: currentFontSize ? token.colorPrimaryBg : undefined,
              }}
            >
              <ColumnHeightOutlined />
              <span className="rd-tiptap-fontsize-trigger__label">{currentFontSize ?? '字号'}</span>
            </Button>
          </Tooltip>
        </Dropdown>
        <TbIconBtn title="粗体" active={editor.isActive('bold')} icon={<BoldOutlined />} onClick={() => editor.chain().focus().toggleBold().run()} />
        <TbIconBtn title="斜体" active={editor.isActive('italic')} icon={<ItalicOutlined />} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <TbIconBtn title="下划线" active={editor.isActive('underline')} icon={<UnderlineOutlined />} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <TbIconBtn title="删除线" active={editor.isActive('strike')} icon={<StrikethroughOutlined />} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <Divider type="vertical" className="rd-tiptap-toolbar-divider" />
        <Popover
          trigger="click"
          placement="bottomLeft"
          title="文字颜色"
          content={
            <Space direction="vertical" size="small" style={{ minWidth: 240 }}>
              <ColorPicker
                showText
                format="hex"
                defaultValue="#1677ff"
                presets={[{ label: '常用', colors: FONT_COLOR_PRESETS }]}
                onChangeComplete={(c) => {
                  editor.chain().focus().setColor(c.toHexString()).run()
                }}
              />
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => editor.chain().focus().unsetColor().run()}>
                清除文字颜色
              </Button>
            </Space>
          }
        >
          <Tooltip title="文字颜色">
            <Button
              type="text"
              size="small"
              className="rd-tiptap-toolbar-btn rd-tiptap-toolbar-btn-wide"
              icon={<FontColorsOutlined />}
              aria-label="文字颜色"
              style={{
                color: (() => {
                  const c = editor.getAttributes('textStyle').color as string | undefined
                  return c && String(c).trim() ? c : token.colorText
                })(),
                background: editor.getAttributes('textStyle').color ? token.colorPrimaryBg : undefined,
              }}
            />
          </Tooltip>
        </Popover>
        <Popover
          trigger="click"
          placement="bottomLeft"
          title="高亮背景"
          content={
            <Space direction="vertical" size="small">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 220 }}>
                {HIGHLIGHT_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="rd-tiptap-hl-swatch"
                    title={c}
                    style={{ backgroundColor: c }}
                    onClick={() => editor.chain().focus().setHighlight({ color: c }).run()}
                  />
                ))}
              </div>
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => editor.chain().focus().unsetHighlight().run()}>
                清除高亮
              </Button>
            </Space>
          }
        >
          <Tooltip title="高亮背景">
            <Button
              type="text"
              size="small"
              className="rd-tiptap-toolbar-btn rd-tiptap-toolbar-btn-wide"
              icon={<HighlightOutlined />}
              aria-label="高亮背景"
              style={{
                color: editor.isActive('highlight') ? token.colorPrimary : token.colorText,
                background: editor.isActive('highlight') ? token.colorPrimaryBg : undefined,
              }}
            />
          </Tooltip>
        </Popover>
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
          onClick={() => editor.chain().focus().toggleTextAlign('left').run()}
        />
        <TbIconBtn
          title="居中"
          active={editor.isActive({ textAlign: 'center' })}
          icon={<AlignCenterOutlined />}
          onClick={() => editor.chain().focus().toggleTextAlign('center').run()}
        />
        <TbIconBtn
          title="右对齐"
          active={editor.isActive({ textAlign: 'right' })}
          icon={<AlignRightOutlined />}
          onClick={() => editor.chain().focus().toggleTextAlign('right').run()}
        />
        <TbIconBtn title="分割线" icon={<LineOutlined />} onClick={() => editor.chain().focus().setHorizontalRule().run()} />
        <Divider type="vertical" className="rd-tiptap-toolbar-divider" />
        <TbIconBtn title="链接" active={linkActive} icon={<LinkOutlined />} onClick={openLinkModal} />
        <TbIconBtn title="插入图片" icon={<PictureOutlined />} onClick={onInsertImagePick} />
        </Space>
      </div>
      <Modal
        title="链接"
        open={linkModalOpen}
        onCancel={closeLinkModal}
        destroyOnHidden
        width={480}
        afterOpenChange={(open) => {
          if (!open) return
          requestAnimationFrame(() => {
            const el = linkInputRef.current?.input
            el?.focus({ preventScroll: true })
            el?.select()
          })
        }}
        footer={
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            {linkActive ? (
              <Button danger type="text" onClick={removeLinkFromModal}>
                移除链接
              </Button>
            ) : null}
            <Button onClick={closeLinkModal}>取消</Button>
            <Button type="primary" onClick={submitLinkModal}>
              确定
            </Button>
          </Space>
        }
      >
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 10 }}>
          仅允许 http(s)、mailto: 或以 / 开头的站内路径；禁止 javascript、data、file 等协议。提交前会再次校验。
        </Typography.Text>
        <Input
          ref={linkInputRef}
          value={linkDraft}
          onChange={(e) => setLinkDraft(e.target.value)}
          placeholder="https://example.com 或 /api/… 或 mailto:a@b.com"
          allowClear
          onPressEnter={submitLinkModal}
        />
      </Modal>
    </>
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
  /** 与 uploadImage 配合：预览类 URL 需在 query 中带 access_token，否则浏览器 img 请求无 Authorization */
  previewAccessToken?: string
}

export type RdRichHtmlEditorRef = {
  /** 保存前调用，获取 TipTap 当前 HTML（避免仅依赖 React state 滞后） */
  getHtml: () => string
}

/** mountKey 变化时由 useEditor 依赖重建实例 */
export const RdRichHtmlEditor = forwardRef<RdRichHtmlEditorRef, RdRichHtmlEditorProps>(function RdRichHtmlEditor(
  { html, onChange, mountKey, placeholder = '请输入正文，可直接粘贴截图或图片…', uploadImage, previewAccessToken },
  ref,
) {
  const { message: msg } = App.useApp()
  const editorRef = useRef<Editor | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadImageRef = useRef(uploadImage)
  const previewAccessTokenRef = useRef(previewAccessToken)
  useLayoutEffect(() => {
    uploadImageRef.current = uploadImage
  }, [uploadImage])
  useLayoutEffect(() => {
    previewAccessTokenRef.current = previewAccessToken
  }, [previewAccessToken])

  const decorateUploadedPreviewSrc = useCallback((url: string) => {
    return appendAccessTokenToSinglePreviewUrl(url, previewAccessTokenRef.current)
  }, [])

  const extensions = useMemo(() => buildTiptapExtensions(placeholder), [placeholder])

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: true,
      extensions,
      content: sanitizeRdRichBodyHtml(html || '<p></p>'),
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
          if (
            tryConsumeImageDataTransfer(ed, event.clipboardData, uploadImageRef.current, (m) => msg.error(m), decorateUploadedPreviewSrc)
          ) {
            event.preventDefault()
            return true
          }
          return false
        },
        handleDrop: (_view, event) => {
          const ed = editorRef.current
          if (!ed) return false
          if (
            tryConsumeImageDataTransfer(ed, event.dataTransfer, uploadImageRef.current, (m) => msg.error(m), decorateUploadedPreviewSrc)
          ) {
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

  useImperativeHandle(
    ref,
    () => ({
      getHtml: () => {
        const ed = editorRef.current
        if (ed && !ed.isDestroyed) return sanitizeRdRichBodyHtml(ed.getHTML())
        return sanitizeRdRichBodyHtml(html)
      },
    }),
    [html],
  )

  const onPickFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const ed = editorRef.current
      const f = e.target.files?.[0]
      e.target.value = ''
      if (!ed || !f) return
      void insertImageFromFile(ed, f, uploadImageRef.current, (m) => msg.error(m), decorateUploadedPreviewSrc)
    },
    [msg, decorateUploadedPreviewSrc],
  )

  return (
    <div className="rd-tiptap-shell">
      <input ref={fileInputRef} type="file" accept="image/*" className="rd-tiptap-file-input" onChange={onFileChange} aria-hidden />
      <RdTiptapMenuBar editor={editor} onInsertImagePick={onPickFile} />
      {editor ? <EditorContent editor={editor} /> : <div className="rd-tiptap-prosemirror">加载编辑器…</div>}
    </div>
  )
})
