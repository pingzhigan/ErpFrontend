/**
 * 功能名称：项目列表
 * 实现原理与逻辑：展示项目汇总列表（项目名、商品数、报价/成本/回款、回款进度等）；支持软删除项目。通过抽屉查看/编辑回款记录，
 * 可新增回款、编辑金额与到账日期。数据来自 /api/projects、/api/receivables，与项目关联的报价与成本由后端聚合计算。
 */
import {
  DeleteOutlined,
  DollarOutlined,
  EditOutlined,
  FolderOutlined,
  PlusOutlined,
  SearchOutlined,
  ShoppingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { App, Avatar, Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Progress, Select, Space, Table, Tooltip, Typography } from 'antd'
import axios from 'axios'
import dayjs from 'dayjs'
import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useReauthModal } from '../hooks/useReauthModal'

const { Title, Text } = Typography

/** 参与人员头像底色（按用户 id 取模，列表内稳定一致） */
const PARTICIPANT_AVATAR_COLORS = ['#1677ff', '#52c41a', '#722ed1', '#eb2f96', '#fa8c16', '#13c2c2', '#2f54eb', '#389e0d']

function participantInitial(u: { id: number; username: string; real_name: string | null }): string {
  const s = ((u.real_name || u.username).trim() || `#${u.id}`).replace(/^#/, '')
  const ch = s[0]
  return ch && /[\u4e00-\u9fff]/.test(ch) ? ch : (ch || '?').toUpperCase()
}

export type ProjectSummary = {
  project_name: string
  product_count: number | null
  last_updated: string | null
  history_version_count: number | null
  quotation_total: number | null
  cost_total: number | null
  total_received: number | null
  /** 含税报价 − 已回款（≥0）；无报价权限时为 null */
  unpaid_amount: number | null
  payment_progress: number | null
  /** 项目创建时间（用于按日期范围筛选） */
  created_at?: string | null
  /** 参与人员（系统用户 id），空数组表示不限制 */
  participant_user_ids?: number[]
  participant_users?: { id: number; username: string; real_name: string | null }[]
  /** 启用报价项目软删除钉钉门禁时由后端返回 */
  soft_delete_audit?: {
    dingtalk_gate: boolean
    audit_status: 'draft' | 'approving' | 'completed'
    audit_outcome: 'approved' | 'rejected' | null
    dingtalk_process_instance_id: string | null
  }
}

type ParticipantUserOption = { id: number; username: string; real_name: string | null }

export type ReceivableRecord = {
  id: number
  project_name: string
  amount: number
  received_at: string | null
  remark: string | null
  created_at: string
  created_by: string | null
  updated_at: string
}

const formatMoney = (v: number | null | undefined) =>
  v != null && Number.isFinite(v) ? Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'

const ProjectsPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { hasPermission, hasRole } = useAuth()
  const canConfigureProjectTeams = hasRole('admin') || hasRole('company_management')
  const canViewQuotation = hasPermission('products')
  const canViewCost = hasPermission('cost-list')
  const { askReauth, reauthModal } = useReauthModal()
  const navigate = useNavigate()
  const location = useLocation()
  const [list, setList] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(false)
  /** 多条件筛选：项目名称关键词、报价/成本/回款是否具备、创建日期范围 */
  const [filterKeyword, setFilterKeyword] = useState('')
  const [filterQuotation, setFilterQuotation] = useState<'all' | 'has' | 'none'>('all')
  const [filterCost, setFilterCost] = useState<'all' | 'has' | 'none'>('all')
  const [filterReceived, setFilterReceived] = useState<'all' | 'has' | 'none'>('all')
  const [filterDateRange, setFilterDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null])
  const [receivableDrawer, setReceivableDrawer] = useState<{
    project_name: string
    quotation_total: number | null
  } | null>(null)
  const [receivableList, setReceivableList] = useState<ReceivableRecord[]>([])
  const [receivableLoading, setReceivableLoading] = useState(false)
  const [receivableForm] = Form.useForm()
  const [editingRecord, setEditingRecord] = useState<ReceivableRecord | null>(null)
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [participantUserOptions, setParticipantUserOptions] = useState<ParticipantUserOption[]>([])
  const [teamModal, setTeamModal] = useState<{ project_name: string; user_ids: number[] } | null>(null)
  const [teamSaving, setTeamSaving] = useState(false)
  const [teamForm] = Form.useForm<{ user_ids: number[] }>()

  const fetchList = async () => {
    setLoading(true)
    try {
      const res = await axios.get<{ list: ProjectSummary[]; total: number }>('/api/projects')
      setList(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSoftDelete = async (projectName: string) => {
    const pwd = await askReauth(`将软删除项目「${projectName}」及关联报价数据，请输入登录密码确认`)
    if (!pwd) return
    try {
      const res = await axios.post<{
        needs_approval?: boolean
        process_instance_id?: string
        success?: boolean
        updated?: number
      }>('/api/projects/soft-delete', {
        project_name: projectName,
        reauth_password: pwd,
      })
      if (res.data?.needs_approval) {
        msg.success('已提交钉钉审批，通过后将自动软删除该项目及关联报价商品')
      } else {
        msg.success('已软删除该项目及其关联商品')
      }
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '软删除失败')
    }
  }

  const fetchReceivables = async (projectName: string) => {
    setReceivableLoading(true)
    try {
      const res = await axios.get<{ list: ReceivableRecord[]; total: number }>('/api/receivables', {
        params: { project_name: projectName },
      })
      setReceivableList(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载回款记录失败')
    } finally {
      setReceivableLoading(false)
    }
  }

  const setReceivableFormDefaults = () => {
    receivableForm.setFieldsValue({ received_at: dayjs(), remark: '常规回款' })
  }

  const openReceivableDrawer = (row: ProjectSummary) => {
    setReceivableDrawer({
      project_name: row.project_name,
      quotation_total: canViewQuotation ? row.quotation_total : null,
    })
    setEditingRecord(null)
    receivableForm.resetFields()
    setReceivableFormDefaults()
    fetchReceivables(row.project_name)
  }

  const handleAddReceivable = async (values: { amount: number; received_at?: dayjs.Dayjs; remark?: string }) => {
    if (!receivableDrawer) return
    setFormSubmitting(true)
    try {
      await axios.post('/api/receivables', {
        project_name: receivableDrawer.project_name,
        amount: values.amount,
        received_at: values.received_at ? values.received_at.format('YYYY-MM-DD') : undefined,
        remark: values.remark,
      })
      msg.success('已添加回款记录')
      receivableForm.resetFields()
      setReceivableFormDefaults()
      fetchReceivables(receivableDrawer.project_name)
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '添加失败')
    } finally {
      setFormSubmitting(false)
    }
  }

  const handleUpdateReceivable = async (values: { amount: number; received_at?: dayjs.Dayjs; remark?: string }) => {
    if (!editingRecord) return
    setFormSubmitting(true)
    try {
      await axios.put(`/api/receivables/${editingRecord.id}`, {
        amount: values.amount,
        received_at: values.received_at ? values.received_at.format('YYYY-MM-DD') : null,
        remark: values.remark,
      })
      msg.success('已更新回款记录')
      setEditingRecord(null)
      receivableForm.resetFields()
      if (receivableDrawer) fetchReceivables(receivableDrawer.project_name)
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '更新失败')
    } finally {
      setFormSubmitting(false)
    }
  }

  const handleDeleteReceivable = async (id: number) => {
    try {
      await axios.delete(`/api/receivables/${id}`)
      msg.success('已删除回款记录')
      if (receivableDrawer) fetchReceivables(receivableDrawer.project_name)
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }

  const startEditRecord = (record: ReceivableRecord) => {
    setEditingRecord(record)
    receivableForm.setFieldsValue({
      amount: record.amount,
      received_at: record.received_at ? dayjs(record.received_at) : undefined,
      remark: record.remark ?? '',
    })
  }

  useEffect(() => {
    fetchList()
  }, [])

  // 从详情页「在项目管理中维护回款」跳转时，自动打开该项目的回款抽屉
  useEffect(() => {
    const openReceivable = (location.state as { openReceivable?: string } | null)?.openReceivable
    if (openReceivable && list.length > 0) {
      const row = list.find((r) => r.project_name === openReceivable)
      if (row) {
        openReceivableDrawer(row)
        navigate(location.pathname, { replace: true, state: {} })
      }
    }
  }, [list, location.state])

  /** 按关键词、报价/成本/回款、创建日期范围筛选后的列表（表格与合计均基于此） */
  const filteredList = React.useMemo(() => {
    let result = list
    const kw = filterKeyword.trim().toLowerCase()
    if (kw) {
      result = result.filter((r) => r.project_name.toLowerCase().includes(kw))
    }
    if (canViewQuotation) {
      if (filterQuotation === 'has') result = result.filter((r) => (r.quotation_total ?? 0) > 0)
      else if (filterQuotation === 'none')
        result = result.filter((r) => !(r.quotation_total != null && r.quotation_total > 0))
    }
    if (canViewCost) {
      if (filterCost === 'has') result = result.filter((r) => (r.cost_total ?? 0) > 0)
      else if (filterCost === 'none') result = result.filter((r) => !(r.cost_total != null && r.cost_total > 0))
    }
    if (filterReceived === 'has') result = result.filter((r) => (r.total_received ?? 0) > 0)
    else if (filterReceived === 'none') result = result.filter((r) => !(r.total_received != null && r.total_received > 0))
    const [dateFrom, dateTo] = filterDateRange
    if (dateFrom || dateTo) {
      result = result.filter((r) => {
        const created = r.created_at ? dayjs(r.created_at) : null
        if (!created) return false
        if (dateFrom && created.isBefore(dateFrom, 'day')) return false
        if (dateTo && created.isAfter(dateTo, 'day')) return false
        return true
      })
    }
    return result
  }, [list, filterKeyword, filterQuotation, filterCost, filterReceived, filterDateRange, canViewQuotation, canViewCost])

  const openTeamModal = async (row: ProjectSummary) => {
    const ids = row.participant_user_ids ?? []
    setTeamModal({ project_name: row.project_name, user_ids: ids })
    teamForm.setFieldsValue({ user_ids: ids })
    if (participantUserOptions.length === 0 && canConfigureProjectTeams) {
      try {
        const res = await axios.get<{ list: ParticipantUserOption[] }>('/api/projects/participant-user-options')
        setParticipantUserOptions(res.data.list || [])
      } catch {
        msg.error('加载用户列表失败')
      }
    }
  }

  const handleSaveTeamModal = async () => {
    if (!teamModal) return
    const values = await teamForm.validateFields().catch(() => null)
    if (!values) return
    setTeamSaving(true)
    try {
      await axios.patch('/api/projects/participants', {
        project_name: teamModal.project_name,
        user_ids: values.user_ids ?? [],
      })
      msg.success('已保存参与人员')
      setTeamModal(null)
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '保存失败')
    } finally {
      setTeamSaving(false)
    }
  }

  /** 列表汇总：报价、成本、回款合计（基于筛选后的数据，用于表格底部汇总行） */
  const listTotals = React.useMemo(() => {
    let quotation = 0
    let cost = 0
    let received = 0
    let unpaid = 0
    for (const row of filteredList) {
      if (row.quotation_total != null && Number.isFinite(row.quotation_total)) quotation += row.quotation_total
      if (row.cost_total != null && Number.isFinite(row.cost_total)) cost += row.cost_total
      if (row.total_received != null && Number.isFinite(row.total_received)) received += row.total_received
      if (row.unpaid_amount != null && Number.isFinite(row.unpaid_amount)) unpaid += row.unpaid_amount
    }
    return { quotation, cost, received, unpaid }
  }, [filteredList])

  const receivableMoneyOverview = React.useMemo(() => {
    if (!receivableDrawer) return null
    const cap = receivableDrawer.quotation_total
    const sum = receivableList.reduce((s, r) => s + (Number(r.amount) || 0), 0)
    if (cap != null && Number.isFinite(cap)) {
      const raw = Math.round((cap - sum) * 100) / 100
      return { quotation: cap, received: sum, unpaid: raw > 0 ? raw : 0 }
    }
    return { quotation: null as number | null, received: sum, unpaid: null as number | null }
  }, [receivableDrawer, receivableList])

  const columns: ColumnsType<ProjectSummary> = useMemo(() => {
    const cols: ColumnsType<ProjectSummary> = [
      {
        title: '项目名称',
        dataIndex: 'project_name',
        key: 'project_name',
        width: 240,
        render: (name: string) => (
          <Space>
            <FolderOutlined style={{ color: 'var(--ant-colorPrimary)' }} />
            <span>{name}</span>
          </Space>
        ),
      },
      {
        title: '参与人员',
        key: 'participant_users_col',
        width: 128,
        render: (_: unknown, row) => {
          const users = row.participant_users ?? []
          if (users.length === 0) {
            return (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, var(--ant-color-fill-quaternary) 0%, var(--ant-color-fill-tertiary) 100%)',
                  border: '1px dashed var(--ant-color-border-secondary)',
                  fontSize: 12,
                  color: 'var(--ant-color-text-tertiary)',
                  lineHeight: 1.25,
                }}
              >
                <TeamOutlined style={{ opacity: 0.75 }} />
                <span>全员可见</span>
              </span>
            )
          }
          const label = (u: { id: number; username: string; real_name: string | null }) => {
            const main = (u.real_name || u.username).trim() || `#${u.id}`
            return u.real_name ? `${main} (${u.username})` : main
          }
          const fullTip = users.map((u) => label(u)).join('\n')
          const show = users.slice(0, 3)
          const rest = users.length - show.length
          const plusStyle = {
            color: 'var(--ant-color-primary)',
            backgroundColor: 'var(--ant-color-primary-bg)',
            fontSize: 12,
            fontWeight: 600,
            border: '2px solid var(--ant-color-bg-container)',
          } as const
          return (
            <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{fullTip}</span>} placement="topLeft">
              <span style={{ display: 'inline-flex', alignItems: 'center', cursor: 'default' }}>
                <Avatar.Group size={28}>
                  {show.map((u) => {
                    const ini = participantInitial(u)
                    return (
                      <Avatar
                        key={u.id}
                        style={{
                          backgroundColor: PARTICIPANT_AVATAR_COLORS[Math.abs(u.id) % PARTICIPANT_AVATAR_COLORS.length],
                          border: '2px solid var(--ant-color-bg-container)',
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        {ini === '?' ? <UserOutlined style={{ fontSize: 14 }} /> : ini}
                      </Avatar>
                    )
                  })}
                  {rest > 0 ? (
                    <Avatar style={plusStyle}>+{rest}</Avatar>
                  ) : null}
                </Avatar.Group>
              </span>
            </Tooltip>
          )
        },
      },
    ]
    if (canViewQuotation) {
      cols.push(
        {
          title: '商品数量',
          dataIndex: 'product_count',
          key: 'product_count',
          width: 90,
          align: 'right',
          render: (v: number | null) => (v == null ? '—' : v),
        },
        {
          title: '报价(元)',
          dataIndex: 'quotation_total',
          key: 'quotation_total',
          width: 110,
          align: 'right',
          render: (v: number | null) => formatMoney(v),
        },
      )
    }
    if (canViewCost) {
      cols.push({
        title: '成本(元)',
        dataIndex: 'cost_total',
        key: 'cost_total',
        width: 110,
        align: 'right',
        render: (v: number | null) => formatMoney(v),
      })
    }
    cols.push({
      title: '回款金额(元)',
      dataIndex: 'total_received',
      key: 'total_received',
      width: 140,
      align: 'right',
      render: (v: number | null, row) => (
        <Space size="small">
          <span>{formatMoney(v)}</span>
          <Button
            type="link"
            size="small"
            icon={<DollarOutlined />}
            onClick={() => openReceivableDrawer(row)}
          >
            回款记录
          </Button>
        </Space>
      ),
    })
    if (canViewQuotation) {
      cols.push(
        {
          title: '未回款(元)',
          dataIndex: 'unpaid_amount',
          key: 'unpaid_amount',
          width: 120,
          align: 'right',
          render: (v: number | null) => (
            <Text type={v != null && v > 0 ? 'warning' : 'secondary'}>{formatMoney(v)}</Text>
          ),
        },
        {
          title: '回款进度',
          dataIndex: 'payment_progress',
          key: 'payment_progress',
          width: 120,
          render: (v: number | null) =>
            v != null ? (
              <Progress percent={v} size="small" style={{ marginBottom: 0 }} />
            ) : (
              '—'
            ),
        },
        {
          title: '历史版本数',
          dataIndex: 'history_version_count',
          key: 'history_version_count',
          width: 100,
          align: 'right',
          render: (v: number | null) => (v != null && v > 0 ? v : '—'),
        },
      )
    }
    cols.push(
      {
        title: '最后更新',
        dataIndex: 'last_updated',
        key: 'last_updated',
        width: 170,
        render: (v: string | null) => (v ? v.slice(0, 19).replace('T', ' ') : '—'),
      },
      {
        title: '操作',
        key: 'action',
        width: 120,
        align: 'center',
        render: (_, row) => {
          const approving = row.soft_delete_audit?.audit_status === 'approving'
          const rejected =
            row.soft_delete_audit?.audit_status === 'completed' && row.soft_delete_audit?.audit_outcome === 'rejected'
          const deleteTip = approving
            ? '软删审批进行中，请在钉钉处理'
            : rejected
              ? '上次软删已拒绝，可再次提交'
              : '软删除项目'
          return (
            <Space size={4} wrap={false}>
              <Tooltip title="查看项目详情">
                <Button
                  type="text"
                  size="small"
                  icon={<ShoppingOutlined />}
                  onClick={() =>
                    navigate(`/project-products?project_name=${encodeURIComponent(row.project_name)}`)
                  }
                  aria-label="查看项目详情"
                />
              </Tooltip>
              {canConfigureProjectTeams ? (
                <Tooltip title="配置参与人员">
                  <Button
                    type="text"
                    size="small"
                    icon={<TeamOutlined />}
                    onClick={() => openTeamModal(row)}
                    aria-label="配置参与人员"
                  />
                </Tooltip>
              ) : null}
              <Popconfirm
                title="软删除项目"
                description={
                  row.soft_delete_audit?.dingtalk_gate
                    ? `已启用钉钉审批：将发起「报价项目软删除」流程，通过后方软删除项目「${row.project_name}」下全部商品。`
                    : `确定软删除项目「${row.project_name}」？该项目下全部商品将一并软删除，不再在列表中显示，数据仅可在数据库中恢复。`
                }
                onConfirm={() => handleSoftDelete(row.project_name)}
                okText={row.soft_delete_audit?.dingtalk_gate ? '提交审批' : '确定软删除'}
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Tooltip title={deleteTip}>
                  <span>
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={approving}
                      aria-label={deleteTip}
                    />
                  </span>
                </Tooltip>
              </Popconfirm>
            </Space>
          )
        },
      },
    )
    return cols
  }, [canViewQuotation, canViewCost, navigate, canConfigureProjectTeams])

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      {reauthModal}
      <div className="page-header-banner">
        <div className="header-left">
          <div className="header-icon-wrap">
            <FolderOutlined />
          </div>
          <div>
            <Title level={4} className="header-title" style={{ marginBottom: 0 }}>
              项目列表
            </Title>
            <Text type="secondary" className="header-desc" style={{ display: 'block' }}>
              展示关联了商品表的项目；可配置「参与人员」后，仅被选中的系统用户可查看该项目数据（系统管理员与公司管理角色不受限；未配置人员时全员可见）。报价/成本仍受敏感权限控制。
            </Text>
          </div>
        </div>
      </div>
      <Card
        className="section-card section-card-accent-blue projects-table-card"
        title={
          <span>
            <FolderOutlined style={{ marginRight: 8, color: '#1677ff' }} />
            项目列表
            {list.length > 0 && (
              <Text type="secondary" style={{ marginLeft: 8, fontWeight: 400, fontSize: 13 }}>
                共 {filteredList.length}
                {filteredList.length !== list.length ? ` / ${list.length}` : ''} 个项目
              </Text>
            )}
          </span>
        }
      >
        <Space wrap size="middle" style={{ marginBottom: 16 }}>
          <Input
            placeholder="项目名称关键词"
            allowClear
            style={{ width: 180 }}
            value={filterKeyword}
            onChange={(e) => setFilterKeyword(e.target.value)}
            onPressEnter={() => {}}
          />
          {canViewQuotation ? (
            <Select
              value={filterQuotation}
              onChange={setFilterQuotation}
              options={[
                { value: 'all', label: '报价：全部' },
                { value: 'has', label: '有报价' },
                { value: 'none', label: '无报价' },
              ]}
              style={{ width: 120 }}
            />
          ) : null}
          {canViewCost ? (
            <Select
              value={filterCost}
              onChange={setFilterCost}
              options={[
                { value: 'all', label: '成本：全部' },
                { value: 'has', label: '有成本' },
                { value: 'none', label: '无成本' },
              ]}
              style={{ width: 120 }}
            />
          ) : null}
          <Select
            value={filterReceived}
            onChange={setFilterReceived}
            options={[
              { value: 'all', label: '回款：全部' },
              { value: 'has', label: '有回款' },
              { value: 'none', label: '无回款' },
            ]}
            style={{ width: 120 }}
          />
          <DatePicker.RangePicker
            value={filterDateRange}
            onChange={(dates) => setFilterDateRange(dates ?? [null, null])}
            placeholder={['创建开始', '创建结束']}
            allowClear
            style={{ width: 240 }}
          />
          <Space.Compact>
            <Button
              onClick={() => {
                const y = dayjs()
                setFilterDateRange([y.startOf('year'), y.endOf('year')])
              }}
            >
              年度
            </Button>
            <Button
              onClick={() => {
                const now = dayjs()
                const startQ = now.month(Math.floor(now.month() / 3) * 3).startOf('month')
                setFilterDateRange([startQ, startQ.add(2, 'month').endOf('month')])
              }}
            >
              季度
            </Button>
            <Button
              onClick={() => {
                const m = dayjs()
                setFilterDateRange([m.startOf('month'), m.endOf('month')])
              }}
            >
              月度
            </Button>
          </Space.Compact>
          {(filterKeyword ||
            (canViewQuotation && filterQuotation !== 'all') ||
            (canViewCost && filterCost !== 'all') ||
            filterReceived !== 'all' ||
            filterDateRange[0] != null ||
            filterDateRange[1] != null) && (
            <Button
              icon={<SearchOutlined />}
              onClick={() => {
                setFilterKeyword('')
                setFilterQuotation('all')
                setFilterCost('all')
                setFilterReceived('all')
                setFilterDateRange([null, null])
              }}
            >
              清空筛选
            </Button>
          )}
        </Space>
        <Table<ProjectSummary>
          rowKey="project_name"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={filteredList}
          pagination={{
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
          locale={{ emptyText: '暂无项目，请先在 项目管理 → 项目维护 中上传报价列表并存入商品表' }}
          summary={(pageData) => {
            if (!pageData.length) return null
            let idx = 0
            const next = () => idx++
            const cells: React.ReactNode[] = [
              <Table.Summary.Cell key="label" index={next()}>
                <Text strong>合计</Text>
              </Table.Summary.Cell>,
              <Table.Summary.Cell key="pt" index={next()} />,
            ]
            if (canViewQuotation) {
              cells.push(<Table.Summary.Cell key="pc" index={next()} />)
              cells.push(
                <Table.Summary.Cell key="qt" index={next()} align="right">
                  <Text strong>{formatMoney(listTotals.quotation)}</Text>
                </Table.Summary.Cell>,
              )
            }
            if (canViewCost) {
              cells.push(
                <Table.Summary.Cell key="ct" index={next()} align="right">
                  <Text strong>{formatMoney(listTotals.cost)}</Text>
                </Table.Summary.Cell>,
              )
            }
            cells.push(
              <Table.Summary.Cell key="rc" index={next()} align="right">
                <Text strong>{formatMoney(listTotals.received)}</Text>
              </Table.Summary.Cell>,
            )
            if (canViewQuotation) {
              cells.push(
                <Table.Summary.Cell key="un" index={next()} align="right">
                  <Text strong>{formatMoney(listTotals.unpaid)}</Text>
                </Table.Summary.Cell>,
              )
            }
            if (canViewQuotation) {
              cells.push(<Table.Summary.Cell key="pg" index={next()} />)
              cells.push(<Table.Summary.Cell key="hi" index={next()} />)
            }
            cells.push(<Table.Summary.Cell key="lu" index={next()} />)
            cells.push(<Table.Summary.Cell key="act" index={next()} />)
            return (
              <Table.Summary fixed>
                <Table.Summary.Row>{cells}</Table.Summary.Row>
              </Table.Summary>
            )
          }}
        />
      </Card>
      <Drawer
        title={receivableDrawer ? `回款记录：${receivableDrawer.project_name}` : '回款记录'}
        placement="right"
        width={560}
        open={!!receivableDrawer}
        onClose={() => { setReceivableDrawer(null); setEditingRecord(null); receivableForm.resetFields() }}
        destroyOnHidden
      >
        {receivableDrawer && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {receivableDrawer.quotation_total == null ? (
              <Text type="secondary" style={{ fontSize: 13 }}>
                当前账号无报价清单权限，无法校验「回款总额是否超过报价」；录入金额请自行与业务核对。
              </Text>
            ) : null}
            {receivableMoneyOverview && (receivableMoneyOverview.quotation != null || receivableMoneyOverview.received > 0) ? (
              <Card size="small" title="金额概览（随列表实时更新）">
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {receivableMoneyOverview.quotation != null ? (
                    <Text>
                      含税报价合计：<Text strong>{formatMoney(receivableMoneyOverview.quotation)}</Text> 元
                    </Text>
                  ) : null}
                  <Text>
                    已回款合计：<Text strong>{formatMoney(receivableMoneyOverview.received)}</Text> 元
                  </Text>
                  {receivableMoneyOverview.unpaid != null ? (
                    <Text>
                      未回款金额：
                      <Text strong type={receivableMoneyOverview.unpaid > 0 ? 'warning' : 'secondary'}>
                        {formatMoney(receivableMoneyOverview.unpaid)}
                      </Text>{' '}
                      元
                    </Text>
                  ) : null}
                </Space>
              </Card>
            ) : null}
            <Card size="small" className="drawer-card-form" title={editingRecord ? '编辑回款记录' : '新增回款记录'}>
              <Form
                form={receivableForm}
                layout="vertical"
                onFinish={editingRecord ? handleUpdateReceivable : handleAddReceivable}
              >
                <Form.Item
                  name="amount"
                  label="回款金额（元）"
                  rules={[
                    { required: true, message: '请输入金额' },
                    {
                      validator: (_, value) => {
                        if (value == null || value === '' || !receivableDrawer) return Promise.resolve()
                        const cap = receivableDrawer.quotation_total
                        if (cap == null || !Number.isFinite(cap)) return Promise.resolve()
                        const currentSum = receivableList.reduce((s, r) => s + r.amount, 0)
                        const newTotal = editingRecord ? currentSum - editingRecord.amount + Number(value) : currentSum + Number(value)
                        if (newTotal > cap) {
                          return Promise.reject(new Error(`总回款不能超过报价金额（报价 ${formatMoney(cap)} 元）`))
                        }
                        return Promise.resolve()
                      },
                    },
                  ]}
                >
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="received_at" label="回款日期">
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="remark" label="备注">
                  <Input.TextArea rows={2} placeholder="常规回款" />
                </Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit" loading={formSubmitting} icon={<PlusOutlined />}>
                    {editingRecord ? '保存' : '添加'}
                  </Button>
                  {editingRecord && (
                    <Button onClick={() => { setEditingRecord(null); receivableForm.resetFields(); setReceivableFormDefaults() }}>
                      取消编辑
                    </Button>
                  )}
                </Space>
              </Form>
            </Card>
            <Card size="small" className="drawer-card-list" title={`已记录 ${receivableList.length} 条，合计 ${formatMoney(receivableList.reduce((s, r) => s + r.amount, 0))} 元`}>
              <Table<ReceivableRecord>
                rowKey="id"
                size="small"
                loading={receivableLoading}
                dataSource={receivableList}
                pagination={false}
                columns={[
                  {
                    title: '回款日期',
                    dataIndex: 'received_at',
                    key: 'received_at',
                    width: 110,
                    render: (v: string | null) => (v ? v.slice(0, 10) : '—'),
                  },
                  {
                    title: '金额(元)',
                    dataIndex: 'amount',
                    key: 'amount',
                    width: 100,
                    align: 'right',
                    render: (v: number) => formatMoney(v),
                  },
                  { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true, render: (v: string | null) => v || '—' },
                  {
                    title: '操作',
                    key: 'action',
                    width: 100,
                    render: (_, row) => (
                      <Space size="small">
                        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => startEditRecord(row)}>
                          编辑
                        </Button>
                        <Popconfirm
                          title="确定删除该条回款记录？"
                          onConfirm={() => handleDeleteReceivable(row.id)}
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                        >
                          <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                            删除
                          </Button>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          </Space>
        )}
      </Drawer>
      <Modal
        title={teamModal ? `参与人员：${teamModal.project_name}` : '参与人员'}
        open={!!teamModal}
        onCancel={() => setTeamModal(null)}
        onOk={() => void handleSaveTeamModal()}
        confirmLoading={teamSaving}
        destroyOnHidden
        width={560}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          按<strong>系统用户</strong>点名：仅列表中的账号可查看该项目（需同时具备「项目管理」等菜单权限）。留空表示不限制（凡有权限者可见）。
        </Text>
        <Form form={teamForm} layout="vertical">
          <Form.Item name="user_ids" label="参与用户（多选）">
            <Select
              mode="multiple"
              allowClear
              placeholder="不选则全员可见"
              options={participantUserOptions.map((u) => ({
                value: u.id,
                label: u.real_name ? `${u.real_name}（${u.username}）` : u.username,
              }))}
              optionFilterProp="label"
              showSearch
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ProjectsPage
