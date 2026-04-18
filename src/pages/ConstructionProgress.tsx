/**
 * 功能名称：进度管理
 * 实现原理与逻辑：管理施工进度任务，包括项目名称、负责人、计划周期、数量、进度、状态等。支持按项目名称、负责人、计划周期、数量、进度、状态等筛选。支持按日期排序。支持导出为 Excel 文件。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRightOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { App, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Progress, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
  assigneeLabelMap,
  buildConstructionAssigneeOptions,
  type AssigneeInactiveRef,
  type AssigneeUserRow,
} from '../utils/constructionAssigneeOptions'
import styles from './ConstructionProgress.module.css'

const { Title, Text } = Typography
const { Search } = Input

interface ProgressItem {
  id: number
  taskName: string
  content: string
  project: string
  responsible: string
  plannedStart: string
  plannedEnd: string
  requiredQty: number
  doneQty: number
  status: string
  sheet_name?: string | null
  /** 来自关联报价清单（source_product_id），无关联时为 null */
  brand?: string | null
  model?: string | null
  params?: string | null
}

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  not_started: { color: 'default', label: '未开始' },
  in_progress: { color: 'processing', label: '进行中' },
  delayed: { color: 'error', label: '超时' },
  completed: { color: 'success', label: '已完成' },
}

type SummaryState = { total: number; in_progress: number; completed: number; delayed: number; avgProgress: number }

const ConstructionProgressPage: React.FC = () => {
  const navigate = useNavigate()
  const { message: msg } = App.useApp()
  const [data, setData] = useState<ProgressItem[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<SummaryState>({ total: 0, in_progress: 0, completed: 0, delayed: 0, avgProgress: 0 })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [responsibleFilter, setResponsibleFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [projectOptions, setProjectOptions] = useState<{ value: string; label: string }[]>([])
  const [responsibleOptions, setResponsibleOptions] = useState<{ value: string; label: string }[]>([])
  const [assigneeList, setAssigneeList] = useState<AssigneeUserRow[]>([])
  const [inactiveAssigneeRefs, setInactiveAssigneeRefs] = useState<AssigneeInactiveRef[]>([])

  const loadAssigneeOptions = useCallback(async () => {
    try {
      const res = await axios.get<{
        list: AssigneeUserRow[]
        inactive_referenced?: AssigneeInactiveRef[]
      }>('/api/construction/projects/manager-user-options')
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

  const assigneeSelectOptions = useMemo(
    () => buildConstructionAssigneeOptions(assigneeList, inactiveAssigneeRefs),
    [assigneeList, inactiveAssigneeRefs],
  )
  const activeAssigneeOptionsOnly = useMemo(
    () => buildConstructionAssigneeOptions(assigneeList, []),
    [assigneeList],
  )
  const responsibleDisplayMap = useMemo(() => assigneeLabelMap(assigneeSelectOptions), [assigneeSelectOptions])

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page, pageSize }
      if (projectFilter) params.project_name = projectFilter
      if (statusFilter) params.status = statusFilter
      if (responsibleFilter) params.responsible = responsibleFilter
      if (keyword.trim()) params.keyword = keyword.trim()
      const res = await axios.get<{ list: any[]; total: number; summary: SummaryState }>('/api/construction/tasks', { params })
      const list = (res.data?.list ?? []).map((r: any) => ({
        id: r.id,
        taskName: r.taskName ?? r.task_name ?? '',
        content: r.content ?? '',
        project: r.project ?? r.project_name ?? '',
        responsible: r.responsible ?? '',
        plannedStart: r.plannedStart ?? r.planned_start ?? '',
        plannedEnd: r.plannedEnd ?? r.planned_end ?? '',
        requiredQty: Number(r.requiredQty ?? r.required_qty) || 0,
        doneQty: Number(r.doneQty ?? r.done_qty) || 0,
        status: r.status ?? 'not_started',
        sheet_name: r.sheet_name ?? r.sheetName ?? null,
        brand: r.brand ?? null,
        model: r.model ?? null,
        params: r.params ?? null,
      }))
      setData(list)
      setTotal(res.data?.total ?? 0)
      setSummary(res.data?.summary ?? { total: 0, in_progress: 0, completed: 0, delayed: 0, avgProgress: 0 })
    } catch (e: any) {
      msg.error(e?.response?.data?.message ?? '加载失败')
    } finally {
      setLoading(false)
    }
  }, [msg, page, pageSize, projectFilter, statusFilter, responsibleFilter, keyword])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const resetFilters = useCallback(() => {
    setProjectFilter(null)
    setResponsibleFilter(null)
    setStatusFilter(null)
    setKeyword('')
    setPage(1)
  }, [])

  useEffect(() => {
    axios.get<{ list?: { name?: string; project_name?: string }[] }>('/api/construction/projects').then((res) => {
      const arr = res.data?.list ?? []
      const names = [...new Set((arr as any[]).map((x) => x.name ?? x.project_name).filter(Boolean))].sort()
      setProjectOptions(names.map((p) => ({ value: String(p), label: String(p) })))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const params: Record<string, string> = {}
    if (projectFilter) params.project_name = projectFilter
    axios.get<{ responsibles?: string[] }>('/api/construction/tasks/filters', { params }).then((res) => {
      const arr = res.data?.responsibles ?? []
      setResponsibleOptions(arr.map((p) => ({ value: p, label: p })))
    }).catch(() => {})
  }, [projectFilter])

  const calcProgress = (r: ProgressItem) => {
    const req = Number(r.requiredQty ?? 0)
    const done = Number(r.doneQty ?? 0)
    if (!Number.isFinite(req) || req <= 0) return 0
    const pct = (Math.max(0, Math.min(done, req)) / req) * 100
    return Math.max(0, Math.min(100, pct))
  }

  const trimCell = (v: string | null | undefined) => ((v ?? '').trim() ? (v ?? '').trim() : '—')

  const columns: ColumnsType<ProgressItem> = [
    { title: '施工内容', dataIndex: 'content', width: 220, ellipsis: true },
    {
      title: '品牌',
      width: 100,
      ellipsis: true,
      render: (_: unknown, r: ProgressItem) => trimCell(r.brand),
    },
    {
      title: '型号',
      width: 100,
      ellipsis: true,
      render: (_: unknown, r: ProgressItem) => trimCell(r.model),
    },
    {
      title: '参数',
      width: 140,
      ellipsis: true,
      render: (_: unknown, r: ProgressItem) => trimCell(r.params),
    },
    { title: '所属项目', dataIndex: 'project', width: 200, ellipsis: true, sorter: (a, b) => a.project.localeCompare(b.project) },
    {
      title: '负责人',
      dataIndex: 'responsible',
      width: 160,
      sorter: (a, b) => a.responsible.localeCompare(b.responsible),
      render: (v: string) => (responsibleDisplayMap.get(v) ?? v) || '—',
    },
    {
      title: '计划周期',
      width: 220,
      render: (_: unknown, r: ProgressItem) => `${r.plannedStart} ~ ${r.plannedEnd}`,
      sorter: (a, b) => a.plannedEnd.localeCompare(b.plannedEnd),
    },
    {
      title: '数量（已完成/总量）',
      width: 150,
      align: 'right',
      render: (_: unknown, r: ProgressItem) => `${r.doneQty ?? 0} / ${r.requiredQty ?? 0}`,
    },
    {
      title: '进度（自动计算）',
      width: 200,
      render: (_: unknown, r: ProgressItem) => (
        <Progress
          percent={Math.round(calcProgress(r))}
          size="small"
          status={r.status === 'delayed' ? 'exception' : undefined}
        />
      ),
      sorter: (a, b) => calcProgress(a) - calcProgress(b),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      sorter: (a, b) => (a.status || '').localeCompare(b.status || ''),
      render: (v: string) => {
        const s = STATUS_MAP[v] ?? { color: 'default', label: v }
        return <Tag color={s.color}>{s.label}</Tag>
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      fixed: 'right',
      render: (_: unknown, r) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              void loadAssigneeOptions()
              setEditing(r)
              editForm.setFieldsValue({
                project: r.project,
                responsible: r.responsible,
                status: r.status,
                plannedStart: r.plannedStart,
                plannedEnd: r.plannedEnd,
                content: r.content,
                requiredQty: r.requiredQty ?? 0,
                doneQty: r.doneQty ?? 0,
              })
              setEditOpen(true)
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除该任务？"
            okText="删除"
            cancelText="取消"
            onConfirm={async () => {
              try {
                await axios.delete(`/api/construction/tasks/${r.id}`)
                msg.success('已删除')
                fetchList()
              } catch (e: any) {
                msg.error(e?.response?.data?.message ?? '删除失败')
              }
            }}
          >
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const [createOpen, setCreateOpen] = useState(false)
  const [createStep, setCreateStep] = useState<1 | 2>(1)
  const [createStep2Project, setCreateStep2Project] = useState<string>('')
  const [projectOptionsForCreate, setProjectOptionsForCreate] = useState<string[]>([])
  const [projectOptionsLoading, setProjectOptionsLoading] = useState(false)

  const fetchConstructionProjects = useCallback(async (keyword?: string) => {
    try {
      setProjectOptionsLoading(true)
      const params = new URLSearchParams()
      if (keyword != null && keyword.trim()) params.set('keyword', keyword.trim())
      const res = await axios.get<{ list: { project_name: string }[]; total: number }>(
        `/api/construction/projects?${params.toString()}`,
      )
      const list = (res.data?.list ?? []).map((r) => r.project_name).filter(Boolean)
      setProjectOptionsForCreate(list)
    } catch {
      setProjectOptionsForCreate([])
    } finally {
      setProjectOptionsLoading(false)
    }
  }, [])

  const [createForm] = Form.useForm<{
    project: string
    responsible: string
    status: string
    plannedStart: string
    plannedEnd: string
    content: string
    requiredQty: number
    doneQty: number
  }>()

  useEffect(() => {
    if (createStep === 2 && createStep2Project) {
      createForm.setFieldsValue({ project: createStep2Project })
    }
  }, [createStep, createStep2Project, createForm])

  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<ProgressItem | null>(null)
  const [editForm] = Form.useForm<{
    project: string
    responsible: string
    status: string
    plannedStart: string
    plannedEnd: string
    content: string
    requiredQty: number
    doneQty: number
  }>()

  return (
    <Card
      variant="borderless"
      style={{
        borderRadius: 12,
        boxShadow: 'var(--ant-boxShadowTertiary)',
        border: '1px solid var(--ant-colorBorderSecondary)',
        background: 'var(--ant-colorBgContainer)',
      }}
      styles={{ body: { padding: '16px 20px 24px' } }}
    >
      <Space align="baseline" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Title level={5} style={{ margin: 0, color: 'var(--ant-colorTextHeading)' }}>
          进度管理
        </Title>
        <Space wrap>
          <Button
            className={styles.bulkQuoteOutlined}
            color="geekblue"
            variant="outlined"
            icon={<UnorderedListOutlined />}
            onClick={() => navigate('/construction/progress/bulk-create')}
          >
            批量创建（从报价清单）
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setCreateOpen(true)
              setCreateStep(1)
              setCreateStep2Project('')
              createForm.resetFields()
              fetchConstructionProjects()
              void loadAssigneeOptions()
            }}
          >
            单项创建
          </Button>
        </Space>
      </Space>

      <div
        style={{
          marginBottom: 12,
          padding: '8px 12px',
          background: 'var(--ant-colorPrimaryBg)',
          borderRadius: 8,
          border: '1px solid var(--ant-colorPrimaryBorder)',
          boxShadow: 'var(--ant-boxShadowTertiary)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <Space wrap size={[8, 6]} align="center">
          <Select
            allowClear
            placeholder="项目"
            style={{ width: 188 }}
            value={projectFilter ?? undefined}
            options={projectOptions}
            onChange={(v) => {
              setProjectFilter(v ?? null)
              setPage(1)
            }}
          />
          <Select
            allowClear
            placeholder="负责人"
            style={{ width: 132 }}
            value={responsibleFilter ?? undefined}
            options={responsibleOptions}
            onChange={(v) => {
              setResponsibleFilter(v ?? null)
              setPage(1)
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 108 }}
            value={statusFilter ?? undefined}
            options={Object.entries(STATUS_MAP).map(([value, v]) => ({ value, label: v.label }))}
            onChange={(v) => {
              setStatusFilter(v ?? null)
              setPage(1)
            }}
          />
          <Search
            allowClear
            placeholder="关键词（内容、负责人、规格等）"
            style={{ width: 220, maxWidth: '100%', background: 'var(--ant-colorBgElevated)' }}
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value)
              setPage(1)
            }}
            onSearch={(v) => {
              setKeyword(v)
              setPage(1)
            }}
          />
          <Button size="small" variant="outlined" color="default" icon={<UndoOutlined />} onClick={resetFilters}>
            重置
          </Button>
        </Space>
        <div style={{ fontSize: 12, whiteSpace: 'nowrap', lineHeight: '22px' }}>
          <Text type="secondary">共 </Text>
          <Text strong style={{ color: 'var(--ant-colorPrimary)' }}>{summary.total}</Text>
          <Text type="secondary"> · 完成 </Text>
          <Text strong style={{ color: 'var(--ant-colorSuccess)' }}>{summary.completed}</Text>
          <Text type="secondary"> · 超时 </Text>
          <Text strong style={{ color: 'var(--ant-colorError)' }}>{summary.delayed}</Text>
          <Text type="secondary"> · 均 </Text>
          <Text strong style={{ color: 'var(--ant-colorWarning)' }}>{summary.avgProgress}</Text>
          <Text type="secondary">%</Text>
        </div>
      </div>

      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        pagination={{
          total,
          current: page,
          pageSize,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, size) => {
            setPage(p)
            setPageSize(size || 10)
          },
        }}
        size="middle"
        scroll={{ x: 1840 }}
        loading={loading}
      />

      <Modal
        title={createStep === 1 ? '单项创建进度任务 - 选择项目' : '单项创建进度任务'}
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false)
          setCreateStep(1)
        }}
        onOk={
          createStep === 1
            ? undefined
            : async () => {
                const v = await createForm.validateFields()
                const projectName = ((v.project ?? createStep2Project) || '').toString().trim()
                if (!projectName) {
                  msg.warning('请先选择项目名称（若已选择请重新打开本弹窗）')
                  return
                }
                try {
                  await axios.post('/api/construction/tasks', {
                    project_name: projectName,
                    task_name: (v.content ?? '').slice(0, 50) || '任务',
                    content: v.content,
                    responsible: v.responsible,
                    planned_start: v.plannedStart,
                    planned_end: v.plannedEnd,
                    required_qty: Number(v.requiredQty ?? 0),
                    done_qty: Number(v.doneQty ?? 0),
                    status: v.status ?? 'not_started',
                  })
                  msg.success('已创建')
                  setCreateOpen(false)
                  setCreateStep(1)
                  fetchList()
                } catch (e: any) {
                  msg.error(e?.response?.data?.message ?? '创建失败')
                }
              }
        }
        okText={createStep === 1 ? undefined : '创建'}
        cancelText="取消"
        width={560}
        destroyOnClose
        footer={
          createStep === 1
            ? [
                <Button
                  key="cancel"
                  variant="outlined"
                  color="default"
                  onClick={() => {
                    setCreateOpen(false)
                    setCreateStep(1)
                  }}
                >
                  取消
                </Button>,
                <Button
                  key="next"
                  type="primary"
                  icon={<ArrowRightOutlined />}
                  onClick={async () => {
                    const v = await createForm.validateFields(['project'])
                    if (!v.project) return
                    setCreateStep2Project(v.project)
                    setCreateStep(2)
                  }}
                >
                  下一步
                </Button>,
              ]
            : undefined
        }
      >
        {createStep === 1 && (
          <div style={{ paddingTop: 8 }}>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              第一步：请选择要创建进度任务所属的施工项目（仅来自“施工管理-项目信息”）。
            </Typography.Text>
            <Form form={createForm} layout="vertical">
              <Form.Item name="project" label="项目名称" rules={[{ required: true, message: '请选择项目名称' }]}>
                <Select
                  showSearch
                  allowClear
                  placeholder="请选择施工项目"
                  loading={projectOptionsLoading}
                  options={projectOptionsForCreate.map((p) => ({ value: p, label: p }))}
                  onSearch={(v) => fetchConstructionProjects(v)}
                  filterOption={false}
                />
              </Form.Item>
            </Form>
          </div>
        )}
        {createStep === 2 && (
          <Form form={createForm} layout="vertical" style={{ marginTop: 12 }}>
            <Form.Item name="project" hidden initialValue={createStep2Project}>
              <Input type="hidden" />
            </Form.Item>
            <Space style={{ width: '100%' }} size="middle">
              <Form.Item label="项目名称" style={{ flex: 1 }}>
                <Input value={createStep2Project} disabled />
              </Form.Item>
              <Form.Item
                name="responsible"
                label="负责人"
                style={{ flex: 1 }}
                rules={[{ required: true, message: '请选择负责人' }]}
              >
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
            </Space>
            <Space style={{ width: '100%' }} size="middle">
              <Form.Item
                name="plannedStart"
                label="计划开始"
                style={{ flex: 1 }}
                rules={[{ required: true, message: '请选择开始日期' }]}
              >
                <Input type="date" />
              </Form.Item>
              <Form.Item
                name="plannedEnd"
                label="计划结束"
                style={{ flex: 1 }}
                rules={[{ required: true, message: '请选择结束日期' }]}
              >
                <Input type="date" />
              </Form.Item>
            </Space>
            <Form.Item
              name="status"
              label="状态"
              rules={[{ required: true, message: '请选择状态' }]}
              initialValue="not_started"
            >
              <Select options={Object.entries(STATUS_MAP).map(([value, v]) => ({ value, label: v.label }))} />
            </Form.Item>
            <Space style={{ width: '100%' }} size="middle">
              <Form.Item
                name="requiredQty"
                label="施工内容总量"
                style={{ flex: 1 }}
                initialValue={0}
                rules={[{ required: true, message: '请填写总量' }]}
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                name="doneQty"
                label="已完成数量"
                style={{ flex: 1 }}
                initialValue={0}
                rules={[{ required: true, message: '请填写已完成数量' }]}
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Space>
            <Form.Item name="content" label="施工内容" rules={[{ required: true, message: '请填写施工内容' }]}>
              <Input.TextArea rows={3} placeholder="例如：摄像头安装与调试（B区）" />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title="编辑进度任务"
        open={editOpen}
        onCancel={() => {
          setEditOpen(false)
          setEditing(null)
          editForm.resetFields()
        }}
        onOk={async () => {
          const v = await editForm.validateFields()
          if (!editing) return
          try {
            await axios.put(`/api/construction/tasks/${editing.id}`, {
              project_name: v.project,
              content: v.content,
              task_name: (v.content ?? '').slice(0, 50) || editing.taskName,
              responsible: v.responsible,
              planned_start: v.plannedStart,
              planned_end: v.plannedEnd,
              required_qty: Number(v.requiredQty ?? 0),
              done_qty: Number(v.doneQty ?? 0),
              status: v.status ?? 'not_started',
            })
            msg.success('已保存')
            setEditOpen(false)
            setEditing(null)
            editForm.resetFields()
            fetchList()
          } catch (e: any) {
            msg.error(e?.response?.data?.message ?? '保存失败')
          }
        }}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 12 }}>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="project" label="项目名称" style={{ flex: 1 }} rules={[{ required: true, message: '请填写项目名称' }]}>
              <Input placeholder="例如：某科技园区弱电系统工程" />
            </Form.Item>
            <Form.Item
              name="responsible"
              label="负责人"
              style={{ flex: 1 }}
              rules={[{ required: true, message: '请选择负责人' }]}
            >
              <Select
                showSearch
                placeholder="可保留原负责人或改选接手人"
                options={assigneeSelectOptions}
                optionFilterProp="label"
                filterOption={(input, opt) =>
                  (opt?.label ?? '').toString().toLowerCase().includes((input || '').toLowerCase())
                }
              />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="plannedStart" label="计划开始" style={{ flex: 1 }} rules={[{ required: true, message: '请选择开始日期' }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="plannedEnd" label="计划结束" style={{ flex: 1 }} rules={[{ required: true, message: '请选择结束日期' }]}>
              <Input type="date" />
            </Form.Item>
          </Space>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select options={Object.entries(STATUS_MAP).map(([value, v]) => ({ value, label: v.label }))} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="requiredQty" label="施工内容总量" style={{ flex: 1 }} rules={[{ required: true, message: '请填写总量' }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="doneQty" label="已完成数量" style={{ flex: 1 }} rules={[{ required: true, message: '请填写已完成数量' }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="content" label="施工内容" rules={[{ required: true, message: '请填写施工内容' }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}

export default ConstructionProgressPage
