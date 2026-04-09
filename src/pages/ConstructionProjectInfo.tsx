import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, DatePicker, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import { EditOutlined, DeleteOutlined, ExclamationCircleOutlined, PlusOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { useAuth } from '../auth/AuthContext'
import {
  assigneeLabelMap,
  buildConstructionAssigneeOptions,
  type AssigneeInactiveRef,
  type AssigneeUserRow,
} from '../utils/constructionAssigneeOptions'

const { Title } = Typography
const { Search } = Input

type ConstructionAudit = {
  dingtalk_gate: boolean
  audit_status: 'draft' | 'approving' | 'completed'
  audit_outcome: 'approved' | 'rejected' | null
  dingtalk_process_instance_id: string | null
}

interface ProjectInfo {
  id: number
  name: string
  code: string
  location: string
  client: string
  manager: string
  startDate: string
  endDate: string
  status: string
  description: string
  /** 创建人用户 id；历史数据可能为空，仅管理员可删 */
  created_by_user_id?: number | null
  audit?: ConstructionAudit
}

type ProjectFormValues = {
  name?: string
  client?: string
  manager?: string
  startDate?: Dayjs
  endDate?: Dayjs
  status?: string
  description?: string
}

function constructionAuditLabel(audit: ConstructionAudit | undefined): { text: string; color: string } | null {
  if (!audit?.dingtalk_gate) return null
  if (audit.audit_status === 'draft') return { text: '待提交审批', color: 'default' }
  if (audit.audit_status === 'approving') return { text: '审批中', color: 'processing' }
  if (audit.audit_outcome === 'approved') return { text: '审批通过', color: 'success' }
  if (audit.audit_outcome === 'rejected') return { text: '已拒绝', color: 'error' }
  return null
}

function canEditConstructionProject(audit: ConstructionAudit | undefined): boolean {
  if (!audit?.dingtalk_gate) return true
  return audit.audit_status !== 'approving'
}

function canDeleteConstructionProject(audit: ConstructionAudit | undefined): boolean {
  if (!audit?.dingtalk_gate) return true
  return audit.audit_status !== 'approving'
}

/** 删除：审批未拦截时，仅创建者或 admin 角色 */
function canUserDeleteConstructionProject(
  r: ProjectInfo,
  audit: ConstructionAudit | undefined,
  currentUserId: number | undefined,
  isAdmin: boolean,
): boolean {
  if (!canDeleteConstructionProject(audit)) return false
  if (isAdmin) return true
  if (r.created_by_user_id == null) return false
  return currentUserId != null && Number(r.created_by_user_id) === Number(currentUserId)
}

function canSubmitConstructionDingTalk(audit: ConstructionAudit | undefined): boolean {
  if (!audit?.dingtalk_gate) return false
  return (
    audit.audit_status === 'draft' ||
    (audit.audit_status === 'completed' && audit.audit_outcome === 'rejected')
  )
}

/** 将历史展示串或用户名解析为登录名，供下拉回显 */
function resolveStoredManagerToUsername(
  stored: string,
  users: AssigneeUserRow[],
  inactiveRefs: AssigneeInactiveRef[],
): string | undefined {
  const t = stored.trim()
  if (!t) return undefined
  if (users.some((u) => u.username === t)) return t
  if (inactiveRefs.some((u) => u.username === t)) return t
  const byReal = users.find((u) => (u.real_name ?? '').trim() === t)
  if (byReal) return byReal.username
  const m = t.match(/\(([^)]+)\)\s*$/)
  if (m) {
    const un = m[1].trim()
    if (users.some((u) => u.username === un)) return un
  }
  return undefined
}

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  planning: { color: 'blue', label: '筹备中' },
  in_progress: { color: 'processing', label: '施工中' },
  paused: { color: 'warning', label: '暂停' },
  completed: { color: 'success', label: '已竣工' },
}

const ConstructionProjectInfoPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const navigate = useNavigate()
  const { user, hasRole } = useAuth()
  const isAdmin = !!(user && hasRole('admin'))
  const [data, setData] = useState<ProjectInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [projectNameOptions, setProjectNameOptions] = useState<string[]>([])
  const [projectNameLoading, setProjectNameLoading] = useState(false)
  const [managerUsers, setManagerUsers] = useState<AssigneeUserRow[]>([])
  const [inactiveAssigneeRefs, setInactiveAssigneeRefs] = useState<AssigneeInactiveRef[]>([])
  const loadManagerUsers = useCallback(async () => {
    try {
      const res = await axios.get<{
        list: AssigneeUserRow[]
        inactive_referenced?: AssigneeInactiveRef[]
      }>('/api/construction/projects/manager-user-options')
      const list = res.data?.list ?? []
      const inactive = res.data?.inactive_referenced ?? []
      setManagerUsers(list)
      setInactiveAssigneeRefs(inactive)
      return { list, inactive }
    } catch (e: any) {
      msg.error(e?.response?.data?.message ?? '加载用户列表失败')
      return { list: [] as AssigneeUserRow[], inactive: [] as AssigneeInactiveRef[] }
    }
  }, [msg])

  useEffect(() => {
    void loadManagerUsers()
  }, [loadManagerUsers])

  const managerSelectOptions = useMemo(
    () => buildConstructionAssigneeOptions(managerUsers, inactiveAssigneeRefs),
    [managerUsers, inactiveAssigneeRefs],
  )
  const activeAssigneeOptionsOnly = useMemo(
    () => buildConstructionAssigneeOptions(managerUsers, []),
    [managerUsers],
  )
  const managerLabelByUsername = useMemo(() => assigneeLabelMap(managerSelectOptions), [managerSelectOptions])

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get<{ list: ProjectInfo[] }>('/api/construction/projects', { params: keyword ? { keyword } : {} })
      const list = (res.data?.list ?? []).map((r: any) => ({
        id: r.id,
        name: r.name ?? r.project_name ?? '',
        code: r.code ?? '',
        location: r.location ?? '',
        client: r.client ?? '',
        manager: r.manager ?? '',
        startDate: r.startDate ?? r.start_date ?? '',
        endDate: r.endDate ?? r.end_date ?? '',
        status: r.status ?? 'planning',
        description: r.description ?? '',
        created_by_user_id: r.created_by_user_id != null ? Number(r.created_by_user_id) : null,
        audit: r.audit,
      }))
      setData(list)
    } catch (e: any) {
      msg.error(e?.response?.data?.message ?? '加载列表失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, msg])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const fetchProjectNames = useCallback(async () => {
    setProjectNameLoading(true)
    try {
      const res = await axios.get<{ list: { project_name: string }[] }>('/api/projects')
      const names = (res.data?.list ?? []).map((r) => r.project_name).filter(Boolean)
      setProjectNameOptions(names)
    } catch {
      setProjectNameOptions([])
    } finally {
      setProjectNameLoading(false)
    }
  }, [])

  const filtered = keyword
    ? data.filter(
        (r) =>
          r.name.includes(keyword) ||
          r.code.includes(keyword) ||
          r.client.includes(keyword) ||
          r.manager.includes(keyword)
      )
    : data

  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<ProjectInfo | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [form] = Form.useForm<ProjectFormValues>()
  const [createForm] = Form.useForm<ProjectFormValues>()
  const [dingSubmittingId, setDingSubmittingId] = useState<number | null>(null)

  const handleEdit = async (r: ProjectInfo) => {
    setEditingRecord(r)
    fetchProjectNames()
    const { list, inactive } = await loadManagerUsers()
    form.setFieldsValue({
      name: r.name,
      client: r.client,
      manager: resolveStoredManagerToUsername(r.manager, list, inactive),
      startDate: r.startDate ? dayjs(r.startDate) : undefined,
      endDate: r.endDate ? dayjs(r.endDate) : undefined,
      status: r.status,
      description: r.description,
    })
    setEditModalOpen(true)
  }

  const handleEditSubmit = () => {
    form.validateFields().then(async (values) => {
      if (!editingRecord) return
      try {
        await axios.put(`/api/construction/projects/${editingRecord.id}`, {
          project_name: values.name,
          client: values.client,
          manager: values.manager as string,
          status: values.status,
          start_date: dayjs(values.startDate).format('YYYY-MM-DD'),
          end_date: dayjs(values.endDate).format('YYYY-MM-DD'),
          description: values.description,
        })
        msg.success('已更新')
        setEditModalOpen(false)
        setEditingRecord(null)
        form.resetFields()
        fetchList()
      } catch (e: any) {
        msg.error(e?.response?.data?.message ?? '更新失败')
      }
    })
  }

  const requestDelete = (r: ProjectInfo) => {
    void (async () => {
      try {
        const res = await axios.get<{ project_name: string; progress_task_count: number }>(
          `/api/construction/projects/${r.id}/delete-impact`,
        )
        const n = res.data?.progress_task_count ?? 0
        const pname = res.data?.project_name ?? r.name

        Modal.confirm({
          title: '删除施工项目',
          icon: <ExclamationCircleOutlined style={{ color: 'var(--ant-colorWarning)' }} />,
          width: 520,
          content: (
            <div>
              <p style={{ marginBottom: 0 }}>
                您即将删除施工项目：<strong>{pname}</strong>（编号 {r.code}）。
              </p>
              {n > 0 ? (
                <p style={{ marginTop: 12, marginBottom: 0, color: 'var(--ant-colorWarning)' }}>
                  该项目在<strong>进度管理</strong>中已建立 <strong>{n}</strong> 条任务。删除本项目时，系统将
                  <strong>同步删除</strong>上述进度任务，且不可恢复。
                </p>
              ) : (
                <p style={{ marginTop: 12, marginBottom: 0 }}>
                  该项目在进度管理中<strong>暂无</strong>关联任务。
                </p>
              )}
              <p style={{ marginTop: 12, marginBottom: 0 }}>请确认无误后点击「继续」，将进入二次确认。</p>
            </div>
          ),
          okText: '继续，二次确认',
          cancelText: '取消',
          onOk: () => {
            Modal.confirm({
              title: '最终确认删除',
              icon: <ExclamationCircleOutlined style={{ color: 'var(--ant-colorError)' }} />,
              width: 480,
              content:
                n > 0 ? (
                  <span>
                    确定删除项目「{pname}」并<strong>永久删除</strong>其下 <strong>{n}</strong> 条进度任务？
                  </span>
                ) : (
                  <span>确定删除项目「{pname}」？此操作不可恢复。</span>
                ),
              okText: '确认删除',
              okType: 'danger',
              cancelText: '取消',
              onOk: async () => {
                try {
                  const delRes = await axios.delete<{ deleted_progress_tasks?: number }>(
                    `/api/construction/projects/${r.id}`,
                  )
                  const deletedN = delRes.data?.deleted_progress_tasks ?? 0
                  if (deletedN > 0) {
                    msg.success(`已删除项目，并同步删除 ${deletedN} 条进度任务`)
                  } else {
                    msg.success('已删除项目')
                  }
                  fetchList()
                } catch (e: any) {
                  msg.error(e?.response?.data?.message ?? '删除失败')
                  throw e
                }
              },
            })
          },
        })
      } catch (e: any) {
        msg.error(e?.response?.data?.message ?? '无法获取删除说明')
      }
    })()
  }

  const openCreate = () => {
    createForm.resetFields()
    fetchProjectNames()
    void loadManagerUsers()
    setCreateModalOpen(true)
  }

  const handleCreateSubmit = () => {
    createForm.validateFields().then(async (values) => {
      try {
        const createRes = await axios.post<{ audit?: ConstructionAudit }>('/api/construction/projects', {
          project_name: values.name,
          client: values.client,
          manager: values.manager as string,
          start_date: dayjs(values.startDate).format('YYYY-MM-DD'),
          end_date: dayjs(values.endDate).format('YYYY-MM-DD'),
          status: values.status ?? 'planning',
          description: values.description,
        })
        const gate = createRes.data?.audit?.dingtalk_gate
        const st = createRes.data?.audit?.audit_status
        msg.success(
          gate && st === 'draft'
            ? '已新增，请在列表中点击「提交钉钉审批」完成流程'
            : '已新增施工项目',
        )
        setCreateModalOpen(false)
        createForm.resetFields()
        fetchList()
      } catch (e: any) {
        msg.error(e?.response?.data?.message ?? '新增失败')
      }
    })
  }

  const handleSubmitDingTalk = async (r: ProjectInfo) => {
    setDingSubmittingId(r.id)
    try {
      await axios.post(`/api/construction/projects/${r.id}/dingtalk/submit`)
      msg.success('已提交钉钉审批，请在钉钉中处理流程')
      fetchList()
    } catch (e: any) {
      msg.error(e?.response?.data?.message ?? '提交失败')
    } finally {
      setDingSubmittingId(null)
    }
  }

  const columns: ColumnsType<ProjectInfo> = [
    { title: '项目编号（自动生成）', dataIndex: 'code', width: 160 },
    { title: '项目名称（从项目管理获取）', dataIndex: 'name', width: 260 },
    { title: '业主单位（可简称）', dataIndex: 'client', width: 180 },
    {
      title: '现场负责人',
      dataIndex: 'manager',
      width: 200,
      render: (m: string) => (managerLabelByUsername.get(m) ?? m) || '—',
    },
    {
      title: '计划周期',
      width: 200,
      render: (_: unknown, r: ProjectInfo) => `${r.startDate} ~ ${r.endDate}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const s = STATUS_MAP[v] ?? { color: 'default', label: v }
        return <Tag color={s.color}>{s.label}</Tag>
      },
    },
    {
      title: '审批',
      key: 'audit',
      width: 100,
      render: (_: unknown, r: ProjectInfo) => {
        const lab = constructionAuditLabel(r.audit)
        return lab ? <Tag color={lab.color}>{lab.text}</Tag> : <span style={{ color: 'var(--ant-colorTextSecondary)' }}>—</span>
      },
    },
    {
      title: '操作',
      width: 280,
      render: (_: unknown, r: ProjectInfo) => (
        <Space size="small" wrap>
          <Button type="link" size="small" onClick={() => navigate(`/construction/project-info/detail/${r.id}`)}>
            详情
          </Button>
          {canSubmitConstructionDingTalk(r.audit) && (
            <Button
              type="link"
              size="small"
              loading={dingSubmittingId === r.id}
              onClick={() => void handleSubmitDingTalk(r)}
            >
              提交钉钉审批
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            disabled={!canEditConstructionProject(r.audit)}
            onClick={() => handleEdit(r)}
          >
            编辑
          </Button>
          <Button
            type="link"
            danger
            size="small"
            icon={<DeleteOutlined />}
            disabled={!canUserDeleteConstructionProject(r, r.audit, user?.id, isAdmin)}
            onClick={() => requestDelete(r)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <Card>
      <Space style={{ marginBottom: 16 }} size="middle" wrap>
        <Title level={5} style={{ margin: 0 }}>
          施工项目信息
        </Title>
        <Search
          placeholder="搜索项目名称 / 编号 / 业主"
          allowClear
          onSearch={setKeyword}
          style={{ width: 280 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增施工项目
        </Button>
      </Space>
      <Table
        rowKey="id"
        dataSource={filtered}
        columns={columns}
        pagination={{ pageSize: 10 }}
        size="middle"
        loading={loading}
      />

      <Modal
        title="新增施工项目"
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields() }}
        onOk={handleCreateSubmit}
        okText="保存"
        cancelText="取消"
        width={520}
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请选择项目名称' }]}>
            <Select
              showSearch
              allowClear
              placeholder="请从项目管理中选择项目名称"
              loading={projectNameLoading}
              options={projectNameOptions.map((p) => ({ value: p, label: p }))}
              filterOption={(input, opt) => (opt?.label ?? '').toString().toLowerCase().includes((input || '').toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="client" label="业主单位（可简称）">
            <Input placeholder="可填简称" />
          </Form.Item>
          <Form.Item name="manager" label="现场负责人" rules={[{ required: true, message: '请选择现场负责人' }]}>
            <Select
              showSearch
              placeholder="从在职用户中选择"
              options={activeAssigneeOptionsOnly}
              optionFilterProp="label"
              filterOption={(input, opt) =>
                (opt?.label ?? '').toString().toLowerCase().includes((input || '').toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="startDate" label="计划开始日期" rules={[{ required: true, message: '请选择计划开始日期' }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="endDate" label="计划结束日期" rules={[{ required: true, message: '请选择计划结束日期' }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="planning">
            <Select
              placeholder="请选择状态"
              options={Object.entries(STATUS_MAP).map(([value, { label }]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <Input.TextArea rows={3} placeholder="选填" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑项目"
        open={editModalOpen}
        onCancel={() => { setEditModalOpen(false); setEditingRecord(null); form.resetFields() }}
        onOk={handleEditSubmit}
        okText="保存"
        cancelText="取消"
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="项目编号（自动生成）">
            <Typography.Text type="secondary">{editingRecord?.code}</Typography.Text>
          </Form.Item>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请选择项目名称' }]}>
            <Select
              showSearch
              allowClear
              placeholder="请从项目管理中选择项目名称"
              loading={projectNameLoading}
              options={projectNameOptions.map((p) => ({ value: p, label: p }))}
              filterOption={(input, opt) => (opt?.label ?? '').toString().toLowerCase().includes((input || '').toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="client" label="业主单位（可简称）">
            <Input placeholder="可填简称" />
          </Form.Item>
          <Form.Item name="manager" label="现场负责人" rules={[{ required: true, message: '请选择现场负责人' }]}>
            <Select
              showSearch
              placeholder="含已停用但仍挂名的账号，可改选在职用户接手"
              options={managerSelectOptions}
              optionFilterProp="label"
              filterOption={(input, opt) =>
                (opt?.label ?? '').toString().toLowerCase().includes((input || '').toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="startDate" label="计划开始日期" rules={[{ required: true, message: '请选择计划开始日期' }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="endDate" label="计划结束日期" rules={[{ required: true, message: '请选择计划结束日期' }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              placeholder="请选择状态"
              allowClear
              options={Object.entries(STATUS_MAP).map(([value, { label }]) => ({ value, label }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}

export default ConstructionProjectInfoPage
