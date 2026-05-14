/**
 * 研发文档 — 富文本文档独立阅读页（左目录 + 正文），与编辑页内预览分离。
 */
import { ArrowLeftOutlined, MenuFoldOutlined, MenuUnfoldOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { App, Button, Descriptions, Empty, Spin, Timeline, Typography } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sanitizeRdRichPreviewHtml } from '../components/RdRichHtmlEditor'
import { useAuth } from '../auth/AuthContext'
import { appendAccessTokenToImgPreviewUrls } from '../utils/rdRichPreviewAuthUrls'
import { prepareRdDocArticleHtmlAndToc, type RdDocTocItem } from '../utils/rdDocArticleToc'

const { Text, Title } = Typography

function formatDocBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 1)} MB`
}

type FolderRow = { id: number; parent_id: number | null; name: string; created_at: string }

type RdRichtextEditHistoryItem = {
  id: number
  edited_at: string
  edited_by: string | null
  edited_by_display?: string
  edit_summary: string
}

type RdRichtextFull = {
  id: number
  folder_id: number
  title: string
  body_html: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  created_by_display?: string
  updated_by_display?: string
  storage_bytes?: number
  edit_history?: RdRichtextEditHistoryItem[]
}

/** 后端返回「姓名（用户名）」；旧接口仅有 username 时回退 */
function personDisplay(display: string | undefined, username: string | null | undefined): string {
  const d = display != null ? String(display).trim() : ''
  if (d) return d
  const u = username != null ? String(username).trim() : ''
  return u || '—'
}

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
  return parts.length > 0 ? parts.join(' / ') : `文件夹 id:${id}`
}

function scrollToHeading(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const RdResearchDocPreviewPage: React.FC = () => {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const { message: msg } = App.useApp()
  const { user } = useAuth()

  const idNum = useMemo(() => {
    const n = Number(docId)
    return Number.isInteger(n) && n > 0 ? n : null
  }, [docId])

  const [loading, setLoading] = useState(true)
  const [doc, setDoc] = useState<RdRichtextFull | null>(null)
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tocCollapsed, setTocCollapsed] = useState(false)

  const load = useCallback(async () => {
    if (idNum == null) {
      setLoadError('无效的文档 id')
      setLoading(false)
      setDoc(null)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const [docRes, folderRes] = await Promise.all([
        axios.get<RdRichtextFull>(`/api/rd/richtext-docs/${idNum}`),
        axios.get<{ list: FolderRow[] }>('/api/rd/doc-folders'),
      ])
      setDoc(docRes.data)
      setFolders(folderRes.data?.list ?? [])
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败'
      setLoadError(m)
      setDoc(null)
      setFolders([])
      msg.error(m)
    } finally {
      setLoading(false)
    }
  }, [idNum, msg])

  useEffect(() => {
    void load()
  }, [load])

  const folderLabel = useMemo(() => {
    if (!doc) return ''
    return folderPathLabel(folders, doc.folder_id)
  }, [doc, folders])

  const { articleHtml, tocItems } = useMemo(() => {
    if (!doc?.body_html) return { articleHtml: '', tocItems: [] as RdDocTocItem[] }
    const clean = sanitizeRdRichPreviewHtml(doc.body_html)
    const { htmlWithIds, toc } = prepareRdDocArticleHtmlAndToc(clean)
    const withToken = appendAccessTokenToImgPreviewUrls(htmlWithIds, user?.token)
    return { articleHtml: withToken, tocItems: toc }
  }, [doc?.body_html, user?.token])

  const headlineEditor = useMemo(() => {
    if (!doc) return '—'
    const u = personDisplay(doc.updated_by_display, doc.updated_by)
    if (u !== '—') return u
    return personDisplay(doc.created_by_display, doc.created_by)
  }, [doc])

  const headlineEditorInitial = useMemo(() => {
    if (headlineEditor === '—') return '?'
    return headlineEditor.charAt(0).toUpperCase()
  }, [headlineEditor])

  const metaLine = useMemo(() => {
    if (!doc) return ''
    const parts: string[] = []
    if (doc.updated_at) parts.push(`更新于 ${doc.updated_at}`)
    const editor = personDisplay(doc.updated_by_display, doc.updated_by)
    if (editor !== '—') parts.push(`编辑 ${editor}`)
    return parts.join(' · ')
  }, [doc])

  if (idNum == null) {
    return (
      <div className="rd-doc-article-page">
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/rd/docs')}>
          返回文档库
        </Button>
        <Empty description="无效的文档链接" />
      </div>
    )
  }

  return (
    <div className="rd-doc-article-page">
      <div className="rd-doc-article-page__topbar">
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/rd/docs')}>
          返回文档库
        </Button>
      </div>

      {loading ? (
        <div className="rd-doc-article-page__loading">
          <Spin size="large" />
        </div>
      ) : loadError || !doc ? (
        <Empty className="rd-doc-article-page__empty" description={loadError ?? '未找到文档'} />
      ) : (
        <div className={`rd-doc-article-page__layout${tocCollapsed ? ' rd-doc-article-page__layout--toc-collapsed' : ''}`}>
          <aside className="rd-doc-article-page__toc" aria-label="目录">
            <div className="rd-doc-article-page__toc-head">
              <span className="rd-doc-article-page__toc-title">
                <UnorderedListOutlined /> 目录
              </span>
              <Button
                type="text"
                size="small"
                className="rd-doc-article-page__toc-toggle"
                icon={tocCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setTocCollapsed((c) => !c)}
              >
                {tocCollapsed ? '展开' : '收起'}
              </Button>
            </div>
            {!tocCollapsed && (
              <div className="rd-doc-article-page__toc-body">
                {tocItems.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    正文中暂无标题，无法生成目录
                  </Text>
                ) : (
                  <nav className="rd-doc-article-toc__nav">
                    {tocItems.map((it) => (
                      <a
                        key={it.id}
                        href={`#${it.id}`}
                        className={`rd-doc-article-toc__link rd-doc-article-toc__link--lvl${it.level}`}
                        onClick={(e) => {
                          e.preventDefault()
                          scrollToHeading(it.id)
                        }}
                      >
                        <span className="rd-doc-article-toc__dot" aria-hidden />
                        <span className="rd-doc-article-toc__text">{it.text}</span>
                      </a>
                    ))}
                  </nav>
                )}
              </div>
            )}
          </aside>

          <main className="rd-doc-article-page__main">
            <article className="rd-doc-article-page__article-card">
              <header className="rd-doc-article-page__article-head">
                <Title level={1} className="rd-doc-article-page__h1">
                  {doc.title}
                </Title>
                <div className="rd-doc-article-page__meta-block">
                  <div className="rd-doc-article-page__avatar" aria-hidden>
                    {headlineEditorInitial}
                  </div>
                  <div className="rd-doc-article-page__meta-text">
                    <div className="rd-doc-article-page__author-line">
                      <Text strong>{headlineEditor}</Text>
                    </div>
                    <Text type="secondary" className="rd-doc-article-page__folder-line">
                      {folderLabel || '—'}
                    </Text>
                  </div>
                </div>
                {metaLine ? (
                  <Text type="secondary" className="rd-doc-article-page__social-line">
                    {metaLine}
                  </Text>
                ) : null}
              </header>

              <div
                className="rd-doc-article-page__body rd-rich-html-preview"
                dangerouslySetInnerHTML={{ __html: articleHtml }}
              />
            </article>

            <footer className="rd-doc-article-page__doc-meta">
              <Title level={5} style={{ marginBottom: 12 }}>
                文档信息
              </Title>
              <Descriptions column={1} size="small" bordered className="rd-doc-article-page__doc-meta-desc">
                <Descriptions.Item label="文档大小（正文 HTML + 内嵌图）">
                  {doc.storage_bytes != null ? formatDocBytes(doc.storage_bytes) : '—'}
                </Descriptions.Item>
                <Descriptions.Item label="创建时间">{doc.created_at || '—'}</Descriptions.Item>
                <Descriptions.Item label="创建人">{personDisplay(doc.created_by_display, doc.created_by)}</Descriptions.Item>
                <Descriptions.Item label="最近更新">{doc.updated_at || '—'}</Descriptions.Item>
                <Descriptions.Item label="最近编辑人">{personDisplay(doc.updated_by_display, doc.updated_by)}</Descriptions.Item>
              </Descriptions>

              <Title level={5} style={{ margin: '20px 0 12px' }}>
                修改记录
              </Title>
              {doc.edit_history && doc.edit_history.length > 0 ? (
                <Timeline
                  className="rd-doc-article-page__history-timeline"
                  items={doc.edit_history.map((h) => {
                    const who = personDisplay(h.edited_by_display, h.edited_by)
                    return {
                      key: h.id,
                      children: (
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {h.edited_at}
                            {who !== '—' ? ` · ${who}` : ''}
                          </Text>
                          <div style={{ marginTop: 4 }}>{h.edit_summary}</div>
                        </div>
                      ),
                    }
                  })}
                />
              ) : (
                <Text type="secondary">暂无保存记录（保存文档并填写编辑说明后将显示在此）</Text>
              )}
            </footer>
          </main>
        </div>
      )}
    </div>
  )
}

export default RdResearchDocPreviewPage
