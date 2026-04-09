/**
 * 功能名称：待办事项
 * 实现原理与逻辑：与「机会管理」平级；后端 opportunity_todos + 流程时间线；状态未派单/未处理/处理中/已完成；支持派单与转派并记入流程。
 */
import {
  CarryOutOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  PlusOutlined,
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
  Checkbox,
  DatePicker,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Typography,
  theme,
} from 'antd'
import axios from 'axios'
import dayjs, { type Dayjs } from 'dayjs'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DueCountdownCell, useNowEverySecond } from '../components/DueCountdownCell'
import {
  buildConstructionAssigneeOptions,
  type AssigneeInactiveRef,
  type AssigneeUserRow,
} from '../utils/constructionAssigneeOptions'

const { Title, Text } = Typography
const { TextArea } = Input
const { Search } = Input

const PROCESS_STATUS_LABEL: Record<string, string> = {
  unassigned: '未派单',
  pending: '未处理',
  in_progress: '处理中',
  completed: '已完成',
}

const PROCESS_STATUS_TAG_COLOR: Record<string, string> = {
  unassigned: 'default',
  pending: 'gold',
  in_progress: 'processing',
  completed: 'success',
}

const FLOW_EVENT_COLOR: Record<string, string> = {
  created: 'blue',
  dispatch: 'green',
  reassign: 'orange',
  status: 'cyan',
  complete: 'success',
  reopen: 'warning',
  unassign: 'default',
  edit: 'gray',
}

export type OpportunityTodoRow = {
  id: number
  title: string
  note: string | null
  due_at: string | null
  done: boolean
  process_status: string
  assignee_username: string | null
  assignee_real_name: string | null
  assigned_at: string | null
  assigned_by: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type OpportunityTodoFlowRow = {
  id: number
  todo_id: number
  event_type: string
  summary: string
  detail: string | null
  actor_username: string | null
  from_status: string | null
  to_status: string | null
  meta_json: string | null
  created_at: string
}

/** 办理人头像底色（按登录名哈希，列表内稳定一致） */
const ASSIGNEE_AVATAR_COLORS = ['#1677ff', '#52c41a', '#722ed1', '#eb2f96', '#fa8c16', '#13c2c2', '#2f54eb', '#389e0d']

function hashUsername(u: string): number {
  let h = 0
  for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) >>> 0
  return h
}

function assigneeAvatarInitial(realName: string | null | undefined, username: string): string {
  const s = ((realName || username).trim() || '?').replace(/^#/, '')
  const ch = s[0]
  return ch && /[\u4e00-\u9fff]/.test(ch) ? ch : (ch || '?').toUpperCase()
}

function dueToApiString(d: Dayjs | null | undefined): string | null {
  if (!d || !d.isValid()) return null
  return d.format('YYYY-MM-DDTHH:mm:ss')
}

function statusLabel(code: string | null | undefined): string {
  if (!code) return '—'
  return PROCESS_STATUS_LABEL[code] ?? code
}

const OpportunityTodosPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { token } = theme.useToken()
  const now = useNowEverySecond()

  const [list, setList] = useState<OpportunityTodoRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [doneFilter, setDoneFilter] = useState<string>('0')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('')
  const [processFilter, setProcessFilter] = useState<string>('')

  const [assigneeList, setAssigneeList] = useState<AssigneeUserRow[]>([])
  const [inactiveAssigneeRefs, setInactiveAssigneeRefs] = useState<AssigneeInactiveRef[]>([])
  const assigneeSelectOptions = useMemo(
    () => buildConstructionAssigneeOptions(assigneeList, inactiveAssigneeRefs),
    [assigneeList, inactiveAssigneeRefs],
  )

  const [editOpen, setEditOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const pendingEditRowRef = useRef<OpportunityTodoRow | null>(null)
  const [form] = Form.useForm<{
    title: string
    note?: string
    due?: Dayjs | null
    assignee_username?: string | null
  }>()

  const [dispatchOpen, setDispatchOpen] = useState(false)
  const [dispatchRow, setDispatchRow] = useState<OpportunityTodoRow | null>(null)
  const pendingDispatchRowRef = useRef<OpportunityTodoRow | null>(null)
  const [dispatchForm] = Form.useForm<{ assignee_username: string }>()
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false)

  const [flowOpen, setFlowOpen] = useState(false)
  const [flowLoading, setFlowLoading] = useState(false)
  const [flowTodo, setFlowTodo] = useState<OpportunityTodoRow | null>(null)
  const [flowList, setFlowList] = useState<OpportunityTodoFlowRow[]>([])

  const loadAssigneeOptions = useCallback(async () => {
    try {
      const res = await axios.get<{
        list: AssigneeUserRow[]
        inactive_referenced?: AssigneeInactiveRef[]
      }>('/api/opportunity-todos/assignee-options')
      setAssigneeList(res.data?.list ?? [])
      setInactiveAssigneeRefs(res.data?.inactive_referenced ?? [])
    } catch {
      setAssigneeList([])
      setInactiveAssigneeRefs([])
    }
  }, [])

  useEffect(() => {
    void loadAssigneeOptions()
  }, [loadAssigneeOptions])

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = {
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }
      if (keyword.trim()) params.keyword = keyword.trim()
      if (doneFilter === '0' || doneFilter === '1') params.done = doneFilter
      if (assigneeFilter.trim()) params.assignee = assigneeFilter.trim()
      if (
        processFilter === 'unassigned' ||
        processFilter === 'pending' ||
        processFilter === 'in_progress' ||
        processFilter === 'completed'
      ) {
        params.process_status = processFilter
      }
      const res = await axios.get<{ list: OpportunityTodoRow[]; total: number }>('/api/opportunity-todos', { params })
      setList(res.data?.list ?? [])
      setTotal(Number(res.data?.total) || 0)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '加载失败')
      setList([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [assigneeFilter, doneFilter, keyword, msg, page, pageSize, processFilter])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const openAdd = useCallback(() => {
    pendingEditRowRef.current = null
    setEditingId(null)
    setEditOpen(true)
  }, [])

  const openEdit = useCallback((row: OpportunityTodoRow) => {
    pendingEditRowRef.current = row
    setEditingId(row.id)
    setEditOpen(true)
  }, [])

  const handleEditModalAfterOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return
      queueMicrotask(() => {
        const row = pendingEditRowRef.current
        if (row) {
          form.setFieldsValue({
            title: row.title,
            note: row.note ?? '',
            due: row.due_at ? dayjs(row.due_at) : null,
            assignee_username: row.assignee_username || undefined,
          })
        } else {
          form.resetFields()
        }
      })
    },
    [form],
  )

  const submitEdit = useCallback(async () => {
    try {
      const v = await form.validateFields()
      const payload = {
        title: v.title.trim(),
        note: (v.note ?? '').trim() || null,
        due_at: dueToApiString(v.due),
        assignee_username: v.assignee_username != null && String(v.assignee_username).trim() !== '' ? v.assignee_username : null,
      }
      if (editingId == null) {
        await axios.post<OpportunityTodoRow>('/api/opportunity-todos', payload)
        msg.success('已添加')
      } else {
        await axios.put<OpportunityTodoRow>(`/api/opportunity-todos/${editingId}`, payload)
        msg.success('已保存')
      }
      setEditOpen(false)
      pendingEditRowRef.current = null
      void fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败')
    }
  }, [editingId, fetchList, form, msg])

  const toggleDone = useCallback(
    async (row: OpportunityTodoRow, done: boolean) => {
      try {
        await axios.put<OpportunityTodoRow>(`/api/opportunity-todos/${row.id}`, { done })
        void fetchList()
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '更新失败')
      }
    },
    [fetchList, msg],
  )

  const startProcessing = useCallback(
    async (row: OpportunityTodoRow) => {
      try {
        await axios.post<OpportunityTodoRow>(`/api/opportunity-todos/${row.id}/start-processing`)
        msg.success('已开始办理')
        void fetchList()
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败')
      }
    },
    [fetchList, msg],
  )

  const remove = useCallback(
    async (id: number) => {
      try {
        await axios.delete(`/api/opportunity-todos/${id}`)
        msg.success('已删除')
        void fetchList()
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败')
      }
    },
    [fetchList, msg],
  )

  const openDispatch = useCallback((row: OpportunityTodoRow) => {
    pendingDispatchRowRef.current = row
    setDispatchRow(row)
    setDispatchOpen(true)
  }, [])

  const handleDispatchModalAfterOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return
      queueMicrotask(() => {
        const row = pendingDispatchRowRef.current
        if (row) {
          dispatchForm.setFieldsValue({
            assignee_username: row.assignee_username || undefined,
          })
        } else {
          dispatchForm.resetFields()
        }
      })
    },
    [dispatchForm],
  )

  const submitDispatch = useCallback(async () => {
    if (!dispatchRow) return
    try {
      const v = await dispatchForm.validateFields()
      setDispatchSubmitting(true)
      await axios.post<OpportunityTodoRow>(`/api/opportunity-todos/${dispatchRow.id}/dispatch`, {
        assignee_username: v.assignee_username,
      })
      msg.success(dispatchRow.assignee_username ? '转派成功' : '派单成功')
      setDispatchOpen(false)
      setDispatchRow(null)
      void fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败')
    } finally {
      setDispatchSubmitting(false)
    }
  }, [dispatchForm, dispatchRow, fetchList, msg])

  const openFlow = useCallback(async (row: OpportunityTodoRow) => {
    setFlowTodo(row)
    setFlowOpen(true)
    setFlowLoading(true)
    setFlowList([])
    try {
      const res = await axios.get<{ list: OpportunityTodoFlowRow[] }>(`/api/opportunity-todos/${row.id}/flow`)
      setFlowList(res.data?.list ?? [])
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '加载流程失败')
    } finally {
      setFlowLoading(false)
    }
  }, [msg])

  const columns: ColumnsType<OpportunityTodoRow> = [
    {
      title: '完成',
      width: 64,
      render: (_, row) => (
        <Checkbox checked={row.done} onChange={(e) => void toggleDone(row, e.target.checked)} />
      ),
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) => {
        const ps = row.process_status || 'unassigned'
        return (
          <Tag color={PROCESS_STATUS_TAG_COLOR[ps] ?? 'default'} style={{ fontWeight: 600, margin: 0 }}>
            {PROCESS_STATUS_LABEL[ps] ?? ps}
          </Tag>
        )
      },
    },
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (t: string, row) => (
        <span style={{ textDecoration: row.done ? 'line-through' : undefined, opacity: row.done ? 0.65 : 1 }}>{t}</span>
      ),
    },
    {
      title: '备注',
      dataIndex: 'note',
      width: 140,
      ellipsis: true,
      render: (n: string | null) => n || '—',
    },
    {
      title: '截止时间 · 倒计时',
      width: 200,
      render: (_, row) =>
        row.due_at ? <DueCountdownCell dueAt={row.due_at} now={now} /> : <span>—</span>,
    },
    {
      title: '办理人',
      width: 228,
      render: (_, row) => {
        if (!row.assignee_username) {
          return (
            <Tag
              icon={<UserOutlined />}
              color="default"
              style={{
                margin: 0,
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                borderStyle: 'dashed',
                borderColor: token.colorWarningBorder,
                color: token.colorWarning,
                background: token.colorWarningBg,
              }}
            >
              待派单
            </Tag>
          )
        }
        const displayName = (row.assignee_real_name ?? '').trim() || row.assignee_username
        const sub =
          (row.assignee_real_name ?? '').trim() !== ''
            ? row.assignee_username
            : null
        const avatarBg = ASSIGNEE_AVATAR_COLORS[hashUsername(row.assignee_username) % ASSIGNEE_AVATAR_COLORS.length]
        return (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 14px 6px 8px',
              borderRadius: token.borderRadiusLG,
              border: `2px solid ${token.colorPrimary}`,
              background: `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorFillAlter} 100%)`,
              boxShadow: token.boxShadowSecondary,
              maxWidth: '100%',
            }}
          >
            <Avatar
              size={44}
              style={{
                backgroundColor: avatarBg,
                color: '#fff',
                fontWeight: 700,
                fontSize: 18,
                flexShrink: 0,
                border: `2px solid ${token.colorBgContainer}`,
                boxShadow: token.boxShadowTertiary,
              }}
            >
              {assigneeAvatarInitial(row.assignee_real_name, row.assignee_username)}
            </Avatar>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 15,
                  lineHeight: 1.35,
                  color: token.colorTextHeading,
                  letterSpacing: '0.02em',
                }}
              >
                {displayName}
              </div>
              {sub ? (
                <Text type="secondary" ellipsis style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
                  @{sub}
                </Text>
              ) : (
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                  经办人
                </Text>
              )}
            </div>
          </div>
        )
      },
    },
    {
      title: '派单信息',
      width: 180,
      ellipsis: true,
      render: (_, row) => {
        if (!row.assigned_at && !row.assigned_by) return '—'
        return (
          <span style={{ fontSize: 12 }}>
            {row.assigned_at ? `${row.assigned_at}` : ''}
            {row.assigned_by ? ` · ${row.assigned_by}` : ''}
          </span>
        )
      },
    },
    {
      title: '操作',
      width: 280,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0} wrap>
          <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => void openFlow(row)}>
            流程
          </Button>
          {!row.done && row.process_status === 'pending' && row.assignee_username ? (
            <Button type="link" size="small" icon={<PlayCircleOutlined />} onClick={() => void startProcessing(row)}>
              开始处理
            </Button>
          ) : null}
          <Button type="link" size="small" icon={<SendOutlined />} onClick={() => openDispatch(row)}>
            {row.assignee_username ? '转派' : '派单'}
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm title="确定删除？" okText="删除" cancelText="取消" onConfirm={() => void remove(row.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const pendingCount = useMemo(() => list.filter((r) => !r.done).length, [list])

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      <div className="page-header-banner">
        <div className="header-left">
          <div className="header-icon-wrap">
            <CarryOutOutlined />
          </div>
          <div>
            <Title level={4} className="header-title" style={{ marginBottom: 0 }}>
              待办事项
            </Title>
            <Text type="secondary" className="header-desc" style={{ display: 'block' }}>
              支持派单与转派（记入流程）；「未处理」下办理人可点「开始处理」进入处理中；完成勾选后状态为已完成。
            </Text>
          </div>
        </div>
      </div>
      <Card
        className="section-card section-card-accent-blue"
        title={
          <span>
            <ThunderboltOutlined style={{ marginRight: 8, color: 'var(--ant-colorWarning)' }} />
            待办列表
            {total > 0 ? (
              <Text type="secondary" style={{ marginLeft: 8, fontWeight: 400, fontSize: 13 }}>
                共 {total} 条 · 本页未完成 {pendingCount}
              </Text>
            ) : null}
          </span>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            新增待办
          </Button>
        }
      >
        <Space wrap style={{ marginBottom: 16 }} size={[12, 8]}>
          <Search
            placeholder="搜索标题、备注"
            allowClear
            style={{ width: 220 }}
            onSearch={(v) => {
              setKeyword(v)
              setPage(1)
            }}
            enterButton="查询"
          />
          <Select
            placeholder="完成状态"
            style={{ width: 120 }}
            value={doneFilter}
            onChange={(v) => {
              setDoneFilter(v)
              setPage(1)
            }}
            options={[
              { value: '', label: '全部' },
              { value: '0', label: '未完成' },
              { value: '1', label: '已完成' },
            ]}
          />
          <Select
            placeholder="处理状态"
            allowClear
            style={{ width: 130 }}
            value={processFilter || undefined}
            onChange={(v) => {
              setProcessFilter(v ?? '')
              setPage(1)
            }}
            options={[
              { value: 'unassigned', label: '未派单' },
              { value: 'pending', label: '未处理' },
              { value: 'in_progress', label: '处理中' },
              { value: 'completed', label: '已完成' },
            ]}
          />
          <Select
            placeholder="办理人"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 200 }}
            value={assigneeFilter || undefined}
            onChange={(v) => {
              setAssigneeFilter(v ?? '')
              setPage(1)
            }}
            options={assigneeSelectOptions}
          />
        </Space>
        <Table<OpportunityTodoRow>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 1380 }}
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
          locale={{ emptyText: '暂无待办' }}
        />
      </Card>

      <Modal
        title={editingId == null ? '新增待办' : '编辑待办'}
        open={editOpen}
        afterOpenChange={handleEditModalAfterOpenChange}
        onCancel={() => {
          setEditOpen(false)
          pendingEditRowRef.current = null
        }}
        onOk={() => void submitEdit()}
        okText="保存"
        destroyOnClose
        width={520}
      >
        <Form form={form} layout="vertical" preserve={false} style={{ marginTop: 8 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请填写标题' }]}>
            <Input placeholder="例如：给客户发送方案报价" maxLength={200} showCount />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <TextArea rows={3} placeholder="可选" maxLength={500} showCount />
          </Form.Item>
          <Form.Item name="due" label="截止时间（含时分）">
            <DatePicker
              showTime
              style={{ width: '100%' }}
              placeholder="可选"
              format="YYYY-MM-DD HH:mm:ss"
            />
          </Form.Item>
          <Form.Item name="assignee_username" label="办理人（可选，可后续派单）">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="从用户列表选择"
              options={assigneeSelectOptions}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={dispatchRow?.assignee_username ? '转派' : '办理派单'}
        open={dispatchOpen}
        afterOpenChange={handleDispatchModalAfterOpenChange}
        onCancel={() => {
          setDispatchOpen(false)
          setDispatchRow(null)
        }}
        onOk={() => void submitDispatch()}
        okText={dispatchRow?.assignee_username ? '确认转派' : '确认派单'}
        confirmLoading={dispatchSubmitting}
        destroyOnClose
        width={440}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
          {dispatchRow?.assignee_username
            ? '选择新的办理人；原办理人将解除，流程中会记录转派轨迹。'
            : '选择在职系统用户作为办理人，事项进入「未处理」状态。'}
        </Typography.Paragraph>
        <Form form={dispatchForm} layout="vertical" preserve={false}>
          <Form.Item
            name="assignee_username"
            label="办理人"
            rules={[{ required: true, message: '请选择办理人' }]}
          >
            <Select showSearch optionFilterProp="label" placeholder="请选择" options={assigneeSelectOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={
          flowTodo ? (
            <span>
              处理流程 · {flowTodo.title}
              <Tag style={{ marginLeft: 8 }} color={PROCESS_STATUS_TAG_COLOR[flowTodo.process_status] ?? 'default'}>
                {PROCESS_STATUS_LABEL[flowTodo.process_status] ?? flowTodo.process_status}
              </Tag>
            </span>
          ) : (
            '处理流程'
          )
        }
        width={420}
        open={flowOpen}
        onClose={() => {
          setFlowOpen(false)
          setFlowTodo(null)
          setFlowList([])
        }}
        destroyOnClose
      >
        <Spin spinning={flowLoading} tip="加载中…">
          {!flowLoading && flowList.length === 0 ? (
            <Text type="secondary">暂无流程记录</Text>
          ) : null}
          {!flowLoading && flowList.length > 0 ? (
            <Timeline
              items={flowList.map((f) => ({
                color: FLOW_EVENT_COLOR[f.event_type] ?? 'gray',
                children: (
                  <div>
                    <Text strong>{f.summary}</Text>
                    {f.detail ? (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {f.detail}
                        </Text>
                      </div>
                    ) : null}
                    <div style={{ marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {f.created_at}
                        {f.actor_username ? ` · ${f.actor_username}` : ''}
                      </Text>
                    </div>
                    {(f.from_status || f.to_status) && (
                      <div style={{ marginTop: 2 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {f.from_status ? `${statusLabel(f.from_status)}` : '—'}
                          {' → '}
                          {f.to_status ? statusLabel(f.to_status) : '—'}
                        </Text>
                      </div>
                    )}
                  </div>
                ),
              }))}
            />
          ) : null}
        </Spin>
      </Drawer>
    </div>
  )
}

export default OpportunityTodosPage
