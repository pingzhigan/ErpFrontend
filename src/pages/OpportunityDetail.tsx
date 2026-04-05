/**
 * 功能名称：机会详情
 * 实现原理与逻辑：按机会 ID 展示单条机会的完整信息；支持编辑基本信息、上传附件、添加跟进记录。提供 AI 优化能力：
 * 根据当前内容生成/优化描述或方案。附件与跟进记录通过独立接口维护，与机会 ID 关联。
 */
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileAddOutlined,
  MessageOutlined,
  PaperClipOutlined,
  PlusOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { Alert, App, Button, Card, Descriptions, Input, InputNumber, Modal, Popconfirm, Select, Space, Spin, Table, Tag, Typography, Upload } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { OpportunityItem } from './Opportunities'
import {
  canDeleteOpportunity,
  canEditOpportunity,
  canSubmitDingTalk,
  opportunityAuditLabel,
  opportunitySideEffectsLocked,
} from './Opportunities'

const { Title, Text } = Typography

type OpportunityAttachmentRecord = {
  id: number
  opportunity_id: number
  file_name: string
  file_path: string
  file_size: number
  created_at: string
}

type OpportunityFollowUpRecord = {
  id: number
  opportunity_id: number
  content: string
  created_at: string
  created_by: string | null
}

const formatMoney = (v: number | null | undefined) =>
  v != null && Number.isFinite(v)
    ? Number(v).toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '—'

/** 空值或字面量 "null"/"undefined" 显示为 —，与列表页一致 */
const formatEmpty = (v: string | null | undefined): string => {
  const s = v != null ? String(v).trim() : ''
  if (!s || s === 'null' || s === 'undefined') return '—'
  return s
}

/** 编辑表单用：空值或 "null"/"undefined" 转为空字符串 */
const toFormValue = (v: string | null | undefined): string => {
  const s = v != null ? String(v).trim() : ''
  if (!s || s === 'null' || s === 'undefined') return ''
  return s
}

async function axiosBlobErrorMessage(e: unknown): Promise<string> {
  const err = e as { response?: { data?: unknown; status?: number } }
  const data = err?.response?.data
  if (data instanceof Blob) {
    try {
      const t = await data.text()
      const j = JSON.parse(t) as { message?: string }
      return j.message || '请求失败'
    } catch {
      return '请求失败'
    }
  }
  if (data && typeof data === 'object' && 'message' in data) {
    return String((data as { message?: string }).message || '请求失败')
  }
  return '请求失败'
}

const OpportunityDetailPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [detail, setDetail] = useState<OpportunityItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [attachments, setAttachments] = useState<OpportunityAttachmentRecord[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null)
  const [followUps, setFollowUps] = useState<OpportunityFollowUpRecord[]>([])
  const [followUpsLoading, setFollowUpsLoading] = useState(false)
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false)
  const [followUpContent, setFollowUpContent] = useState('')
  const [optimizeLoading, setOptimizeLoading] = useState(false)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [confirmContent, setConfirmContent] = useState('')
  const [dingSubmitting, setDingSubmitting] = useState(false)
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null)

  const fetchDetail = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await axios.get<OpportunityItem>(`/api/opportunities/${id}`)
      setDetail(res.data)
    } catch (e: any) {
      if (e?.response?.status === 404) {
        setDetail(null)
        msg.error('机会不存在')
      } else {
        msg.error(e?.response?.data?.message || '加载失败')
      }
    } finally {
      setLoading(false)
    }
  }, [id, msg])

  const fetchAttachments = useCallback(async () => {
    if (!id) return
    setAttachmentsLoading(true)
    try {
      const res = await axios.get<{ list: OpportunityAttachmentRecord[] }>(`/api/opportunities/${id}/attachments`)
      setAttachments(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载附件失败')
    } finally {
      setAttachmentsLoading(false)
    }
  }, [id, msg])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  const fetchFollowUps = useCallback(async () => {
    if (!id) return
    setFollowUpsLoading(true)
    try {
      const res = await axios.get<{ list: OpportunityFollowUpRecord[] }>(`/api/opportunities/${id}/follow-ups`)
      setFollowUps(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载跟进记录失败')
    } finally {
      setFollowUpsLoading(false)
    }
  }, [id, msg])

  useEffect(() => {
    if (detail?.id) fetchAttachments()
  }, [detail?.id, fetchAttachments])

  useEffect(() => {
    if (detail?.id) fetchFollowUps()
  }, [detail?.id, fetchFollowUps])

  const handleAddFollowUp = async () => {
    const content = followUpContent.trim()
    if (!content) {
      msg.warning('请填写跟进内容')
      return
    }
    setFollowUpSubmitting(true)
    try {
      await axios.post(`/api/opportunities/${id}/follow-ups`, { content })
      msg.success('已添加跟进记录')
      setFollowUpContent('')
      fetchFollowUps()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '添加失败')
    } finally {
      setFollowUpSubmitting(false)
    }
  }

  const handleOptimizeFollowUp = async () => {
    const raw = followUpContent.trim()
    if (!raw) {
      msg.warning('请先填写跟进内容再使用 AI 润色')
      return
    }
    setOptimizeLoading(true)
    try {
      const res = await axios.post<{ content: string }>('/api/opportunities/optimize-follow-up', { content: raw })
      setConfirmContent(res.data?.content?.trim() || raw)
      setConfirmModalOpen(true)
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '润色失败')
    } finally {
      setOptimizeLoading(false)
    }
  }

  const handleConfirmAddFollowUp = async () => {
    const content = confirmContent.trim()
    if (!content) {
      msg.warning('请填写或保留跟进内容')
      return
    }
    setFollowUpSubmitting(true)
    try {
      await axios.post(`/api/opportunities/${id}/follow-ups`, { content })
      msg.success('已添加跟进记录')
      setConfirmModalOpen(false)
      setConfirmContent('')
      setFollowUpContent('')
      fetchFollowUps()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '添加失败')
    } finally {
      setFollowUpSubmitting(false)
    }
  }

  const handleDeleteFollowUp = async (followUpId: number) => {
    try {
      await axios.delete(`/api/opportunities/${id}/follow-ups/${followUpId}`)
      msg.success('已删除')
      fetchFollowUps()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }

  const handleDelete = async () => {
    if (!detail?.id) return
    try {
      await axios.delete(`/api/opportunities/${detail.id}`)
      msg.success('已删除')
      navigate('/opportunities')
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }

  const handleSubmitDingTalk = async () => {
    if (!detail?.id) return
    setDingSubmitting(true)
    try {
      await axios.post(`/api/opportunities/${detail.id}/dingtalk/submit`)
      msg.success('已提交钉钉审批，请在钉钉中处理流程')
      fetchDetail()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '提交失败')
    } finally {
      setDingSubmitting(false)
    }
  }

  const handleEditSuccess = () => {
    setEditModalOpen(false)
    fetchDetail()
  }

  const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10MB
  const handleAttachmentUpload = (file: File) => {
    if (!id) return false
    if (file.size > MAX_ATTACHMENT_SIZE) {
      msg.error('文件大小不能超过 10MB')
      return false
    }
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    axios
      .post(`/api/opportunities/${id}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then(() => {
        msg.success('附件上传成功')
        fetchAttachments()
      })
      .catch((e: any) => {
        msg.error(e?.response?.data?.message || '上传失败')
      })
      .finally(() => setUploading(false))
    return false
  }

  const handleDeleteAttachment = async (attachmentId: number) => {
    try {
      await axios.delete(`/api/opportunities/${id}/attachments/${attachmentId}`)
      msg.success('已删除')
      fetchAttachments()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }

  const downloadAttachment = async (attachmentId: number, fileName: string) => {
    if (!id) return
    try {
      const res = await axios.get(`/api/opportunities/${id}/attachments/${attachmentId}/file`, {
        responseType: 'blob',
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : undefined,
      })
      const blobUrl = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = fileName || 'download'
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(blobUrl)
    } catch (e: unknown) {
      msg.error(await axiosBlobErrorMessage(e))
    }
  }

  const PREVIEW_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico']
  const isPreviewable = (fileName: string) => {
    const ext = (fileName || '').toLowerCase().replace(/^.*\./, '')
    return PREVIEW_EXT.includes(ext)
  }
  const isImagePreviewable = (fileName: string) => {
    const ext = (fileName || '').toLowerCase().replace(/^.*\./, '')
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico'].includes(ext)
  }
  const previewAttachment = async (attachmentId: number, fileName: string) => {
    if (!id) return
    setPreviewLoadingId(attachmentId)
    try {
      const res = await axios.get(`/api/opportunities/${id}/attachments/${attachmentId}/preview`, {
        responseType: 'blob',
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : undefined,
      })
      const blobUrl = URL.createObjectURL(res.data as Blob)
      if (isImagePreviewable(fileName)) {
        setPreviewImage((prev) => {
          if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url)
          return { url: blobUrl, name: fileName }
        })
      } else {
        window.open(blobUrl, '_blank', 'noopener,noreferrer')
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000)
      }
    } catch (e: unknown) {
      msg.error(await axiosBlobErrorMessage(e))
    } finally {
      setPreviewLoadingId(null)
    }
  }

  if (loading) {
    return (
      <div className="page-content-wrap" style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" tip="加载中…" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="page-content-wrap" style={{ padding: 48, textAlign: 'center' }}>
        <Text type="secondary">未找到该机会</Text>
        <div style={{ marginTop: 16 }}>
          <Button type="primary" onClick={() => navigate('/opportunities')}>
            返回列表
          </Button>
        </div>
      </div>
    )
  }

  const auditLab = opportunityAuditLabel(detail.audit)
  const sideLocked = opportunitySideEffectsLocked(detail.audit)

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      <div className="page-header-banner" style={{ marginBottom: 16 }}>
        <div className="header-left" style={{ flex: 1 }}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/opportunities')}
            style={{ marginBottom: 8, padding: 0 }}
          >
            返回机会列表
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="header-icon-wrap">
              <ThunderboltOutlined />
            </div>
            <div>
              <Title level={4} className="header-title" style={{ marginBottom: 4 }}>
                {detail.name}
              </Title>
              <Text type="secondary" className="header-desc">
                机会详情
              </Text>
            </div>
          </div>
        </div>
        <Space wrap>
          {canSubmitDingTalk(detail.audit) && (
            <Button type="primary" loading={dingSubmitting} onClick={handleSubmitDingTalk}>
              提交钉钉审批
            </Button>
          )}
          <Button
            type="primary"
            icon={<EditOutlined />}
            disabled={!canEditOpportunity(detail.audit)}
            onClick={() => setEditModalOpen(true)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除该机会？"
            onConfirm={handleDelete}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />} disabled={!canDeleteOpportunity(detail.audit)}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {sideLocked && detail.audit?.dingtalk_gate && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="钉钉审批未通过前，无法添加或删除跟进记录与附件；编辑请在列表/详情在「草稿」或「已拒绝」状态下进行。"
        />
      )}

      <Card title="基本信息" style={{ marginBottom: 16 }}>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="机会名称">{detail.name}</Descriptions.Item>
          <Descriptions.Item label="客户">{formatEmpty(detail.customer)}</Descriptions.Item>
          <Descriptions.Item label="预计金额（元）">{formatMoney(detail.amount)}</Descriptions.Item>
          <Descriptions.Item label="阶段">{formatEmpty(detail.stage)}</Descriptions.Item>
          <Descriptions.Item label="备注">{formatEmpty(detail.remark)}</Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {detail.created_at ? detail.created_at.slice(0, 19).replace('T', ' ') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="最后更新">
            {detail.updated_at ? detail.updated_at.slice(0, 19).replace('T', ' ') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="创建人">{formatEmpty(detail.created_by)}</Descriptions.Item>
          {detail.audit?.dingtalk_gate && auditLab && (
            <Descriptions.Item label="钉钉审批">
              <Tag color={auditLab.color}>{auditLab.text}</Tag>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      <Card
        title={
          <span>
            <PaperClipOutlined style={{ marginRight: 8, color: '#d46b08' }} />
            附件管理
          </span>
        }
        extra={
          <Space>
            <Upload
              accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.7z,.gz,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff,.tif,.ico"
              showUploadList={false}
              beforeUpload={handleAttachmentUpload}
              disabled={uploading || sideLocked}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading} disabled={sideLocked}>
                上传附件
              </Button>
            </Upload>
            <Text type="secondary">单文件不超过 10MB</Text>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Table<OpportunityAttachmentRecord>
          rowKey="id"
          size="small"
          loading={attachmentsLoading}
          dataSource={attachments}
          pagination={false}
          locale={{ emptyText: '暂无附件，支持 PDF、Word、Excel、压缩包及常见图片格式' }}
          columns={[
            { title: '文件名', dataIndex: 'file_name', key: 'file_name', ellipsis: true },
            {
              title: '大小',
              dataIndex: 'file_size',
              key: 'file_size',
              width: 90,
              render: (v: number) => (v ? `${(v / 1024).toFixed(1)} KB` : '—'),
            },
            {
              title: '上传时间',
              dataIndex: 'created_at',
              key: 'created_at',
              width: 170,
              render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '—'),
            },
            {
              title: '操作',
              key: 'action',
              width: 180,
              render: (_, row) => (
                <Space>
                  {isPreviewable(row.file_name) && (
                    <Button
                      type="link"
                      size="small"
                      icon={<EyeOutlined />}
                      loading={previewLoadingId === row.id}
                      onClick={() => void previewAttachment(row.id, row.file_name)}
                    >
                      预览
                    </Button>
                  )}
                  <Button
                    type="link"
                    size="small"
                    icon={<FileAddOutlined />}
                    onClick={() => void downloadAttachment(row.id, row.file_name)}
                  >
                    下载
                  </Button>
                  <Popconfirm
                    title="确定删除该附件？"
                    onConfirm={() => handleDeleteAttachment(row.id)}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      type="link"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={sideLocked}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card
        title={
          <span>
            <MessageOutlined style={{ marginRight: 8, color: '#389e0d' }} />
            跟进记录
          </span>
        }
        style={{ marginBottom: 16 }}
      >
        <Spin spinning={followUpsLoading}>
          {followUps.length === 0 && !followUpsLoading ? (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <Typography.Text type="secondary">暂无跟进记录，在下方添加一条</Typography.Text>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[...followUps].reverse().map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'stretch',
                    gap: 0,
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: '1px solid #f0f0f0',
                    background: '#fafafa',
                  }}
                >
                  <div
                    style={{
                      width: 4,
                      flexShrink: 0,
                      background: 'linear-gradient(180deg, #52c41a 0%, #73d13d 100%)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0, padding: '12px 16px' }}>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        marginBottom: 8,
                      }}
                    >
                      <Space size="small" style={{ fontSize: 12, color: '#8c8c8c' }}>
                        {formatEmpty(item.created_by) !== '—' && (
                          <span style={{ fontWeight: 500, color: 'rgba(0,0,0,0.65)' }}>{formatEmpty(item.created_by)}</span>
                        )}
                        <span>
                          {item.created_at ? item.created_at.slice(0, 19).replace('T', ' ') : '—'}
                        </span>
                      </Space>
                      <Popconfirm
                        title="确定删除该条跟进记录？"
                        onConfirm={() => handleDeleteFollowUp(item.id)}
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                      >
                        <Button
                          type="text"
                          size="small"
                          danger
                          disabled={sideLocked}
                          style={{ fontSize: 12, padding: '0 4px', height: 'auto' }}
                        >
                          删除
                        </Button>
                      </Popconfirm>
                    </div>
                    <div
                      style={{
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        lineHeight: 1.65,
                        color: 'rgba(0,0,0,0.88)',
                        fontSize: 14,
                      }}
                    >
                      {item.content}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Spin>
        <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #f0f0f0' }}>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            添加新跟进
          </Typography.Text>
          <Input.TextArea
            value={followUpContent}
            onChange={(e) => setFollowUpContent(e.target.value)}
            placeholder="填写本次跟进内容（可口语、要点），使用「AI 润色」生成更专业的表述，审核后再添加"
            rows={3}
            style={{ marginBottom: 12 }}
            disabled={sideLocked}
          />
          <Space wrap>
            <Button
              icon={<RobotOutlined />}
              onClick={handleOptimizeFollowUp}
              loading={optimizeLoading}
              disabled={sideLocked || !followUpContent.trim()}
            >
              AI 润色
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddFollowUp}
              loading={followUpSubmitting}
              disabled={sideLocked}
            >
              直接添加
            </Button>
          </Space>
        </div>
      </Card>

      <Modal
        title="确认跟进记录"
        open={confirmModalOpen}
        onCancel={() => { setConfirmModalOpen(false); setConfirmContent('') }}
        onOk={handleConfirmAddFollowUp}
        okText="确认添加"
        cancelText="取消"
        confirmLoading={followUpSubmitting}
        width={560}
        destroyOnClose
      >
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          AI 已润色为更专业的跟进表述，请核对内容（可修改），确认无误后添加至跟进记录。
        </Typography.Text>
        <Input.TextArea
          value={confirmContent}
          onChange={(e) => setConfirmContent(e.target.value)}
          rows={5}
          placeholder="润色后的内容"
          style={{ marginTop: 8 }}
        />
      </Modal>

      <Modal
        title={previewImage?.name || '图片预览'}
        open={!!previewImage}
        onCancel={() => {
          setPreviewImage((prev) => {
            if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url)
            return null
          })
        }}
        footer={null}
        width="80%"
        style={{ top: 24 }}
        styles={{ body: { maxHeight: 'calc(100vh - 120px)', overflow: 'auto', textAlign: 'center' } }}
        destroyOnClose
      >
        {previewImage && (
          <img
            src={previewImage.url}
            alt={previewImage.name}
            style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }}
          />
        )}
      </Modal>

      {editModalOpen && (
        <OpportunityEditModal
          opportunity={detail}
          open={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          onSuccess={handleEditSuccess}
        />
      )}
    </div>
  )
}

const STAGE_OPTIONS = [
  { value: '线索', label: '线索' },
  { value: '初步沟通', label: '初步沟通' },
  { value: '需求确认', label: '需求确认' },
  { value: '方案报价', label: '方案报价' },
  { value: '商务谈判', label: '商务谈判' },
  { value: '赢单', label: '赢单' },
  { value: '输单', label: '输单' },
]

/** 详情页内嵌的编辑弹窗 */
function OpportunityEditModal({
  opportunity,
  open,
  onClose,
  onSuccess,
}: {
  opportunity: OpportunityItem
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const { message: msg } = App.useApp()
  const [submitting, setSubmitting] = useState(false)
  const [name, setName] = useState(opportunity.name)
  const [customer, setCustomer] = useState(() => toFormValue(opportunity.customer))
  const [amount, setAmount] = useState<number | null>(opportunity.amount ?? null)
  const [stage, setStage] = useState(() => toFormValue(opportunity.stage))
  const [remark, setRemark] = useState(() => toFormValue(opportunity.remark))

  React.useEffect(() => {
    if (open) {
      setName(opportunity.name)
      setCustomer(toFormValue(opportunity.customer))
      setAmount(opportunity.amount ?? null)
      setStage(toFormValue(opportunity.stage))
      setRemark(toFormValue(opportunity.remark))
    }
  }, [open, opportunity])

  const handleSubmit = async () => {
    if (!name.trim()) {
      msg.warning('请填写机会名称')
      return
    }
    setSubmitting(true)
    try {
      await axios.put(`/api/opportunities/${opportunity.id}`, {
        name: name.trim(),
        customer: customer.trim() || null,
        amount: amount,
        stage: stage || null,
        remark: remark.trim() || null,
      })
      msg.success('已更新')
      onSuccess()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="编辑机会"
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText="保存"
      width={520}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>机会名称</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：XX公司弱电项目" />
        </div>
        <div>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>客户</div>
          <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="客户/单位名称" />
        </div>
        <div>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>预计金额（元）</div>
          <InputNumber
            value={amount}
            onChange={(v) => setAmount(v)}
            min={0}
            precision={2}
            style={{ width: '100%' }}
            placeholder="选填"
          />
        </div>
        <div>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>阶段</div>
          <Select
            value={stage || undefined}
            onChange={(v) => setStage(v ?? '')}
            options={STAGE_OPTIONS}
            placeholder="请选择"
            allowClear
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>备注</div>
          <Input.TextArea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" rows={3} />
        </div>
      </Space>
    </Modal>
  )
}

export default OpportunityDetailPage
