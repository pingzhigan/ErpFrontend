/**
 * 功能名称：机会管理列表
 * 实现原理与逻辑：展示销售机会列表（名称、客户、金额、阶段等），支持筛选与分页；可新增/编辑/删除机会。提供 AI 对话入口，
 * 通过自然语言补充机会信息并自动创建或更新机会。阶段包括线索至赢单/输单，列表可区分进行中与已结束机会。
 */
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  App,
  Avatar,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import axios from 'axios'
import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import styles from './Opportunities.module.css'

const { Title, Text } = Typography

type ChatMessage = { role: 'assistant' | 'user'; content: string }

type OpportunityDraft = {
  name?: string
  amount?: number
  stage?: string
  customer?: string | null
  remark?: string | null
}

export type OpportunityAudit = {
  dingtalk_gate: boolean
  audit_status: 'draft' | 'approving' | 'completed'
  audit_outcome: 'approved' | 'rejected' | null
  dingtalk_process_instance_id: string | null
}

export type OpportunityItem = {
  id: number
  name: string
  customer: string | null
  amount: number | null
  stage: string | null
  remark: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  audit?: OpportunityAudit
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

/** 阶段对应 Tag 颜色：进行中偏蓝/青，赢单绿，输单红 */
const STAGE_TAG_COLOR: Record<string, string> = {
  线索: 'default',
  初步沟通: 'blue',
  需求确认: 'cyan',
  方案报价: 'geekblue',
  商务谈判: 'orange',
  赢单: 'success',
  输单: 'error',
}

const ADD_DIALOG_WELCOME =
  '请提供新增机会的必填信息：\n\n1. **机会名称**（例如：XX公司弱电项目）\n2. **预计金额**（单位：元，可写「100万」或「50000」）\n3. **阶段**（请从以下选一：线索、初步沟通、需求确认、方案报价、商务谈判、赢单、输单）\n\n可选：**客户名称**、**备注** 会尽量从机会名称或你的描述中自动识别（多数情况下客户名称在机会名称里，如「XX公司弱电项目」→ 客户 XX公司）。\n\n可以一条消息全部填写，也可以分多条补充。'

function opportunityAuditLabel(audit: OpportunityAudit | undefined): { text: string; color: string } | null {
  if (!audit?.dingtalk_gate) return null
  if (audit.audit_status === 'draft') return { text: '草稿', color: 'default' }
  if (audit.audit_status === 'approving') return { text: '审批中', color: 'processing' }
  if (audit.audit_outcome === 'approved') return { text: '已通过', color: 'success' }
  if (audit.audit_outcome === 'rejected') return { text: '已拒绝', color: 'error' }
  return { text: '已完成', color: 'default' }
}

function canEditOpportunity(audit: OpportunityAudit | undefined): boolean {
  if (!audit?.dingtalk_gate) return true
  return audit.audit_status !== 'approving'
}

function canDeleteOpportunity(audit: OpportunityAudit | undefined): boolean {
  if (!audit?.dingtalk_gate) return true
  return audit.audit_status !== 'approving'
}

function canSubmitDingTalk(audit: OpportunityAudit | undefined): boolean {
  if (!audit?.dingtalk_gate) return false
  return (
    audit.audit_status === 'draft' ||
    (audit.audit_status === 'completed' && audit.audit_outcome === 'rejected')
  )
}

/** 未通过钉钉审批时，禁止附件/跟进等副作用操作 */
export function opportunitySideEffectsLocked(audit: OpportunityAudit | undefined): boolean {
  if (!audit?.dingtalk_gate) return false
  return audit.audit_status !== 'completed' || audit.audit_outcome !== 'approved'
}

export { opportunityAuditLabel, canEditOpportunity, canDeleteOpportunity, canSubmitDingTalk }

const formatMoney = (v: number | null | undefined) =>
  v != null && Number.isFinite(v)
    ? Number(v).toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '—'

const OpportunitiesPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [list, setList] = useState<OpportunityItem[]>([])
  const [loading, setLoading] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [form] = Form.useForm()

  /** 新增机会 - AI 对话弹窗 */
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState<OpportunityDraft>({})
  const [addInputValue, setAddInputValue] = useState('')
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addChatLoading, setAddChatLoading] = useState(false)
  const addChatListRef = useRef<HTMLDivElement>(null)
  const [dingSubmittingId, setDingSubmittingId] = useState<number | null>(null)

  const fetchList = async () => {
    setLoading(true)
    try {
      const res = await axios.get<{ list: OpportunityItem[]; total: number }>(
        '/api/opportunities'
      )
      setList(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const openAdd = () => {
    setChatMessages([{ role: 'assistant', content: ADD_DIALOG_WELCOME }])
    setDraft({})
    setAddInputValue('')
    setAddDialogOpen(true)
    setTimeout(() => addChatListRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }), 100)
  }

  const openEdit = (row: OpportunityItem) => {
    setEditingId(row.id)
    const clean = (v: string | null | undefined) => {
      const s = v != null ? String(v).trim() : ''
      return !s || s === 'null' || s === 'undefined' ? '' : s
    }
    form.setFieldsValue({
      name: row.name,
      customer: clean(row.customer),
      amount: row.amount,
      stage: row.stage,
      remark: clean(row.remark),
    })
    setEditModalOpen(true)
  }

  const appendAssistantReply = (content: string) => {
    setChatMessages((prev) => [...prev, { role: 'assistant', content }])
    setTimeout(() => addChatListRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }), 50)
  }

  const handleAddChatSend = async () => {
    const text = addInputValue.trim()
    if (!text || addChatLoading) return
    setChatMessages((prev) => [...prev, { role: 'user', content: text }])
    setAddInputValue('')
    setAddChatLoading(true)
    setChatMessages((prev) => [...prev, { role: 'assistant', content: '' }])
    setTimeout(() => addChatListRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }), 50)
    const messages = [...chatMessages, { role: 'user' as const, content: text }]
    const body = {
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      currentDraft: draft,
    }
    const baseURL = axios.defaults.baseURL || ''
    const url = baseURL ? `${baseURL.replace(/\/$/, '')}/api/opportunities/parse-dialog-stream` : '/api/opportunities/parse-dialog-stream'
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}),
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { message?: string }).message || `请求失败 ${res.status}`)
      }
      const reader = res.body?.getReader()
      if (!reader) throw new Error('无法读取响应流')
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          let eventType = ''
          let dataStr = ''
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim()
            else if (line.startsWith('data: ')) dataStr = line.slice(6)
          }
          if (!eventType || dataStr === undefined) continue
          if (eventType === 'chunk') {
            try {
              const delta = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr
              setChatMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + delta }
                return next
              })
              setTimeout(() => addChatListRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }), 0)
            } catch {
              // ignore
            }
          } else if (eventType === 'done') {
            try {
              const data = JSON.parse(dataStr) as { draft?: OpportunityDraft; complete?: boolean }
              if (data.draft) setDraft(data.draft)
            } catch {
              // ignore
            }
          } else if (eventType === 'error') {
            try {
              const data = JSON.parse(dataStr) as { message?: string }
              const errMsg = data.message || '解析失败'
              msg.error(errMsg)
              setChatMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content || errMsg }
                return next
              })
            } catch {
              msg.error('解析失败')
            }
          }
        }
      }
    } catch (e: any) {
      msg.error(e?.message || e?.response?.data?.message || '解析失败，请重试')
      setChatMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === 'assistant' && last.content === '') next[next.length - 1] = { ...last, content: '抱歉，解析时出错了，请再试一次或直接补充：机会名称、预计金额（元）、阶段。' }
        return next
      })
    } finally {
      setAddChatLoading(false)
    }
  }

  const handleAddConfirmSubmit = async () => {
    if (!draft.name || draft.amount == null || !draft.stage) {
      msg.warning('请先通过对话补全：机会名称、预计金额、阶段')
      return
    }
    setAddSubmitting(true)
    try {
      await axios.post('/api/opportunities', {
        name: draft.name,
        amount: draft.amount,
        stage: draft.stage,
        customer: draft.customer ?? null,
        remark: draft.remark ?? null,
      })
      msg.success('已新增机会')
      setAddDialogOpen(false)
      setDraft({})
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '提交失败')
    } finally {
      setAddSubmitting(false)
    }
  }

  const handleEditSubmit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (values == null) return
    setFormSubmitting(true)
    try {
      const payload = {
        name: values.name?.trim() || '',
        customer: values.customer?.trim() || null,
        amount: values.amount != null && values.amount !== '' ? Number(values.amount) : null,
        stage: values.stage || null,
        remark: values.remark?.trim() || null,
      }
      if (editingId) {
        await axios.put(`/api/opportunities/${editingId}`, payload)
        msg.success('已更新机会')
      }
      setEditModalOpen(false)
      form.resetFields()
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '保存失败')
    } finally {
      setFormSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`/api/opportunities/${id}`)
      msg.success('已删除')
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }

  const handleSubmitDingTalk = async (row: OpportunityItem) => {
    setDingSubmittingId(row.id)
    try {
      await axios.post<{ process_instance_id: string }>(`/api/opportunities/${row.id}/dingtalk/submit`)
      msg.success('已提交钉钉审批，请在钉钉中处理流程')
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '提交失败')
    } finally {
      setDingSubmittingId(null)
    }
  }

  useEffect(() => {
    fetchList()
  }, [])

  const columns: ColumnsType<OpportunityItem> = [
    {
      title: '机会名称',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      render: (name: string) => (
        <Space>
          <ThunderboltOutlined style={{ color: 'var(--ant-colorWarning)' }} />
          <span>{name}</span>
        </Space>
      ),
    },
    {
      title: '客户',
      dataIndex: 'customer',
      key: 'customer',
      width: 160,
      ellipsis: true,
      render: (v: string | null) => {
        const s = v != null ? String(v).trim() : ''
        if (!s || s === 'null' || s === 'undefined') return '—'
        return s
      },
    },
    {
      title: '预计金额(元)',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right',
      render: (v: number | null) => (
        <Text strong={v != null && v > 0}>{formatMoney(v)}</Text>
      ),
    },
    {
      title: '阶段',
      dataIndex: 'stage',
      key: 'stage',
      width: 120,
      render: (v: string | null) =>
        v ? (
          <Tag color={STAGE_TAG_COLOR[v] ?? 'default'}>{v}</Tag>
        ) : (
          <span style={{ color: 'var(--ant-colorTextDisabled)' }}>—</span>
        ),
    },
    {
      title: '审批',
      key: 'audit',
      width: 100,
      render: (_: unknown, row: OpportunityItem) => {
        const lab = opportunityAuditLabel(row.audit)
        if (!lab) return <span style={{ color: 'var(--ant-colorTextDisabled)' }}>—</span>
        return <Tag color={lab.color}>{lab.text}</Tag>
      },
    },
    {
      title: '备注',
      dataIndex: 'remark',
      key: 'remark',
      ellipsis: true,
      render: (v: string | null) => {
        const s = v != null ? String(v).trim() : ''
        if (!s || s === 'null' || s === 'undefined') return '—'
        return s
      },
    },
    {
      title: '最后更新',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 170,
      render: (v: string | null) =>
        v ? v.slice(0, 19).replace('T', ' ') : '—',
    },
    {
      title: '操作',
      key: 'action',
      width: 320,
      render: (_, row) => (
        <Space size="small" wrap>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/opportunities/detail/${row.id}`)}
          >
            查看详情
          </Button>
          {canSubmitDingTalk(row.audit) && (
            <Button
              type="link"
              size="small"
              loading={dingSubmittingId === row.id}
              onClick={() => handleSubmitDingTalk(row)}
            >
              提交钉钉审批
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            disabled={!canEditOpportunity(row.audit)}
            onClick={() => openEdit(row)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除该机会？"
            onConfirm={() => handleDelete(row.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            disabled={!canDeleteOpportunity(row.audit)}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={!canDeleteOpportunity(row.audit)}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      <div className="page-header-banner">
        <div className="header-left">
          <div className="header-icon-wrap">
            <ThunderboltOutlined />
          </div>
          <div>
            <Title level={4} className="header-title" style={{ marginBottom: 0 }}>
              机会管理
            </Title>
            <Text
              type="secondary"
              className="header-desc"
              style={{ display: 'block' }}
            >
              管理销售机会，记录客户、预计金额与阶段；可与项目管理配合使用，赢单后可转为项目。
            </Text>
          </div>
        </div>
      </div>
      <Card
        className="section-card section-card-accent-blue opportunities-table-card"
        title={
          <span>
            <ThunderboltOutlined
              style={{ marginRight: 8, color: 'var(--ant-colorWarning)' }}
            />
            机会列表
            {list.length > 0 && (
              <Text
                type="secondary"
                style={{ marginLeft: 8, fontWeight: 400, fontSize: 13 }}
              >
                共 {list.length} 条
              </Text>
            )}
          </span>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            新增机会
          </Button>
        }
      >
        <Table<OpportunityItem>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={list}
          pagination={{
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
          locale={{ emptyText: '暂无机会，点击「新增机会」添加' }}
        />
      </Card>
      {/* 新增机会：AI 对话弹窗（固定尺寸，超出滚动） */}
      <Modal
        title="新增机会"
        open={addDialogOpen}
        onCancel={() => setAddDialogOpen(false)}
        footer={null}
        destroyOnClose
        width={560}
        styles={{ body: { padding: '12px 16px 16px', height: 500, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        <div className={styles.addChatWrap}>
        <div ref={addChatListRef} className={styles.addChatList}>
          {chatMessages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user'
                  ? `${styles.addChatItem} ${styles.addChatItemUser}`
                  : `${styles.addChatItem} ${styles.addChatItemAssistant}`
              }
            >
              <Avatar
                size={36}
                icon={m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                style={{
                  background: m.role === 'user' ? '#1677ff' : '#f0f0f0',
                  color: m.role === 'user' ? '#fff' : '#262626',
                }}
              />
              <div className={styles.addChatBubble}>
                <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
              </div>
            </div>
          ))}
        </div>
        {draft.name && draft.amount != null && draft.stage && (
          <div className={styles.addChatConfirmBlock}>
            <div className={styles.addChatSummaryCard}>
              <div className={styles.addChatSummaryTitle}>
                <CheckCircleOutlined />
                已识别信息
              </div>
              <div className={styles.addChatSummaryGrid}>
                <span className={styles.addChatSummaryLabel}>机会名称</span>
                <span className={styles.addChatSummaryValue}>{draft.name}</span>
                <span className={styles.addChatSummaryLabel}>预计金额</span>
                <span className={styles.addChatSummaryValue}>{draft.amount.toLocaleString('zh-CN')} 元</span>
                <span className={styles.addChatSummaryLabel}>阶段</span>
                <span className={styles.addChatSummaryValue}>{draft.stage}</span>
                {draft.customer && (
                  <>
                    <span className={styles.addChatSummaryLabel}>客户</span>
                    <span className={styles.addChatSummaryValue}>{draft.customer}</span>
                  </>
                )}
                {draft.remark && (
                  <>
                    <span className={styles.addChatSummaryLabel}>备注</span>
                    <span className={`${styles.addChatSummaryValue} ${styles.addChatSummaryValueRemark}`}>{draft.remark}</span>
                  </>
                )}
              </div>
            </div>
            <Button
              type="primary"
              loading={addSubmitting}
              onClick={handleAddConfirmSubmit}
              icon={<ThunderboltOutlined />}
              size="middle"
            >
              确认提交
            </Button>
          </div>
        )}
        <div className={styles.addChatInputRow}>
          <Input.TextArea
            className={styles.addChatInput}
            value={addInputValue}
            onChange={(e) => setAddInputValue(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault()
                handleAddChatSend()
              }
            }}
            placeholder="输入机会名称、预计金额、阶段（可一条或分多条补充）"
            autoSize={{ minRows: 2, maxRows: 4 }}
            disabled={addSubmitting || addChatLoading}
          />
          <button
            type="button"
            className={styles.addChatSendBtn}
            onClick={() => handleAddChatSend()}
            disabled={!addInputValue.trim() || addSubmitting || addChatLoading}
            title="发送"
          >
            <SendOutlined />
          </button>
        </div>
        </div>
      </Modal>

      {/* 编辑机会：表单弹窗 */}
      <Modal
        title="编辑机会"
        open={editModalOpen}
        onOk={handleEditSubmit}
        onCancel={() => {
          setEditModalOpen(false)
          form.resetFields()
        }}
        confirmLoading={formSubmitting}
        destroyOnClose
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="机会名称"
            rules={[{ required: true, message: '请填写机会名称' }]}
          >
            <Input placeholder="例如：XX公司弱电项目" />
          </Form.Item>
          <Form.Item name="customer" label="客户">
            <Input placeholder="客户/单位名称" />
          </Form.Item>
          <Form.Item name="amount" label="预计金额(元)">
            <InputNumber
              min={0}
              precision={2}
              style={{ width: '100%' }}
              placeholder="选填"
            />
          </Form.Item>
          <Form.Item name="stage" label="阶段">
            <Select
              placeholder="请选择阶段"
              allowClear
              options={STAGE_OPTIONS}
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="选填" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default OpportunitiesPage
