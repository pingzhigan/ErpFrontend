/**
 * 钉钉集成维护：通讯录树、部门成员、可见审批模板、ERP 流程模板映射（process_template_map）。
 */
import {
  ApartmentOutlined,
  CopyOutlined,
  ReloadOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  DeploymentUnitOutlined,
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import type { ColumnsType } from 'antd/es/table'
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tree,
  Typography,
  Alert,
  Checkbox,
  InputNumber,
  Select,
} from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

const { Title, Text } = Typography

type DingDeptFlat = { dept_id: number; name: string; parent_id: number }

type DingUserRow = {
  userid?: string
  name?: string
  mobile?: string
  job_number?: string
  title?: string
  dept_id_list?: number[]
}

type ProcessTplRow = { process_code?: string; name?: string; icon_url?: string; description?: string }

type MapRow = {
  id: number
  business_type: string
  dingding_process_code: string
  enabled: number
  remark: string | null
  oa_form_field_map_json?: string | null
  created_at: string
  updated_at: string
}

type DeptRoleMapRow = {
  dingtalk_dept_id: number
  dept_name: string | null
  parent_id: number | null
  role_codes: string[]
  remark: string | null
  created_at: string
  updated_at: string
}

/** 与后端 opportunities 默认一致；须与钉钉审批模板控件「名称」一致 */
const OA_FIELD_DEFAULTS = {
  oa_map_name: '机会名称',
  oa_map_customer: '客户名称',
  oa_map_amount: '预计金额',
  oa_map_stage: '销售阶段',
  oa_map_remark: '备注',
} as const

function parseOaFormToModalFields(json: string | null | undefined): typeof OA_FIELD_DEFAULTS {
  const out = { ...OA_FIELD_DEFAULTS }
  if (!json?.trim()) return out
  try {
    const p = JSON.parse(json) as Record<string, unknown>
    const apply = (formKey: keyof typeof OA_FIELD_DEFAULTS, jsonKey: string) => {
      const v = p[jsonKey]
      if (typeof v === 'string' && v.trim()) (out as Record<string, string>)[formKey] = v.trim()
    }
    apply('oa_map_name', 'name')
    apply('oa_map_customer', 'customer')
    apply('oa_map_amount', 'amount')
    apply('oa_map_stage', 'stage')
    apply('oa_map_remark', 'remark')
  } catch {
    /* ignore */
  }
  return out
}

const OA_CONSTRUCTION_DEFAULTS = {
  oa_c_code: '项目编号',
  oa_c_project_name: '项目名称',
  oa_c_client: '业主单位',
  oa_c_manager: '现场负责人',
  oa_c_start_date: '计划开始日期',
  oa_c_end_date: '计划结束日期',
  oa_c_status: '项目状态',
  oa_c_description: '项目描述',
} as const

function parseConstructionOaToModalFields(json: string | null | undefined): typeof OA_CONSTRUCTION_DEFAULTS {
  const out = { ...OA_CONSTRUCTION_DEFAULTS }
  if (!json?.trim()) return out
  try {
    const p = JSON.parse(json) as Record<string, unknown>
    const apply = (formKey: keyof typeof OA_CONSTRUCTION_DEFAULTS, jsonKey: string) => {
      const v = p[jsonKey]
      if (typeof v === 'string' && v.trim()) (out as Record<string, string>)[formKey] = v.trim()
    }
    apply('oa_c_code', 'code')
    apply('oa_c_project_name', 'project_name')
    apply('oa_c_client', 'client')
    apply('oa_c_manager', 'manager')
    apply('oa_c_start_date', 'start_date')
    apply('oa_c_end_date', 'end_date')
    apply('oa_c_status', 'status')
    apply('oa_c_description', 'description')
  } catch {
    /* ignore */
  }
  return out
}

const OA_INVENTORY_MAINTAIN_DEFAULTS = {
  oa_im_item_count: '入库条数',
  oa_im_summary: '明细摘要',
  oa_im_duplicate_mode: 'SKU重复处理',
  oa_im_submitter: '提交人',
  oa_im_submit_time: '提交时间',
} as const

function parseInventoryMaintainOaToModalFields(json: string | null | undefined): typeof OA_INVENTORY_MAINTAIN_DEFAULTS {
  const out = { ...OA_INVENTORY_MAINTAIN_DEFAULTS }
  if (!json?.trim()) return out
  try {
    const p = JSON.parse(json) as Record<string, unknown>
    const apply = (formKey: keyof typeof OA_INVENTORY_MAINTAIN_DEFAULTS, jsonKey: string) => {
      const v = p[jsonKey]
      if (typeof v === 'string' && v.trim()) (out as Record<string, string>)[formKey] = v.trim()
    }
    apply('oa_im_item_count', 'item_count')
    apply('oa_im_summary', 'summary')
    apply('oa_im_duplicate_mode', 'duplicate_mode')
    apply('oa_im_submitter', 'submitter')
    apply('oa_im_submit_time', 'submit_time')
  } catch {
    /* ignore */
  }
  return out
}

const OA_MINOR_WORK_DEFAULTS = {
  oa_mw_code: '工单编号',
  oa_mw_title: '标题',
  oa_mw_customer_name: '客户名称',
  oa_mw_due_at: '截止时间',
  oa_mw_precautions: '注意事项',
  oa_mw_content: '事项内容',
  oa_mw_project_amount: '工程金额（元）',
  oa_mw_cost_budget: '成本预算（元）',
} as const

function parseMinorWorkOaToModalFields(json: string | null | undefined): typeof OA_MINOR_WORK_DEFAULTS {
  const out = { ...OA_MINOR_WORK_DEFAULTS }
  if (!json?.trim()) return out
  try {
    const p = JSON.parse(json) as Record<string, unknown>
    const apply = (formKey: keyof typeof OA_MINOR_WORK_DEFAULTS, jsonKey: string) => {
      const v = p[jsonKey]
      if (typeof v === 'string' && v.trim()) (out as Record<string, string>)[formKey] = v.trim()
    }
    apply('oa_mw_code', 'code')
    apply('oa_mw_title', 'title')
    apply('oa_mw_customer_name', 'customer_name')
    apply('oa_mw_due_at', 'due_at')
    apply('oa_mw_precautions', 'precautions')
    apply('oa_mw_content', 'content')
    apply('oa_mw_project_amount', 'project_amount')
    apply('oa_mw_cost_budget', 'cost_budget')
  } catch {
    /* ignore */
  }
  return out
}

const OA_MAINTENANCE_TASK_DEFAULTS = {
  oa_mt_code: '任务编号',
  oa_mt_title: '任务标题',
  oa_mt_task_type: '任务类型',
  oa_mt_due_at: '截止时间',
  oa_mt_content: '任务说明',
  oa_mt_assignee: '执行人',
} as const

function parseMaintenanceTaskOaToModalFields(json: string | null | undefined): typeof OA_MAINTENANCE_TASK_DEFAULTS {
  const out = { ...OA_MAINTENANCE_TASK_DEFAULTS }
  if (!json?.trim()) return out
  try {
    const p = JSON.parse(json) as Record<string, unknown>
    const apply = (formKey: keyof typeof OA_MAINTENANCE_TASK_DEFAULTS, jsonKey: string) => {
      const v = p[jsonKey]
      if (typeof v === 'string' && v.trim()) (out as Record<string, string>)[formKey] = v.trim()
    }
    apply('oa_mt_code', 'code')
    apply('oa_mt_title', 'title')
    apply('oa_mt_task_type', 'task_type')
    apply('oa_mt_due_at', 'due_at')
    apply('oa_mt_content', 'content')
    apply('oa_mt_assignee', 'assignee')
  } catch {
    /* ignore */
  }
  return out
}

const BUILTIN_MAP_TYPES = [
  'opportunity_create',
  'construction_project_create',
  'inventory_maintain_submit',
  'minor_work_create',
  'maintenance_task_create',
] as const

function flatToTreeData(flat: DingDeptFlat[]): DataNode[] {
  type N = DingDeptFlat & { children: N[] }
  const byId = new Map<number, N>()
  flat.forEach((f) => byId.set(f.dept_id, { ...f, children: [] }))
  const roots: N[] = []
  flat.forEach((f) => {
    const n = byId.get(f.dept_id)!
    const p = f.parent_id
    if (p && byId.has(p)) {
      byId.get(p)!.children.push(n)
    } else {
      roots.push(n)
    }
  })
  const toNode = (n: N): DataNode => ({
    key: String(n.dept_id),
    title: `${n.name} (${n.dept_id})`,
    isLeaf: n.children.length === 0,
    children: n.children.length > 0 ? n.children.map(toNode) : undefined,
  })
  return roots.map(toNode)
}

const DingTalkAdminPage: React.FC = () => {
  const { message: msg } = App.useApp()

  const [orgLoading, setOrgLoading] = useState(false)
  const [orgFlat, setOrgFlat] = useState<DingDeptFlat[]>([])
  const [orgTruncated, setOrgTruncated] = useState(false)
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [users, setUsers] = useState<DingUserRow[]>([])

  const [tplUserid, setTplUserid] = useState('')
  const [tplProcessCodeQ, setTplProcessCodeQ] = useState('')
  const [tplLoading, setTplLoading] = useState(false)
  const [tplList, setTplList] = useState<ProcessTplRow[]>([])
  const [tplResolvedUserid, setTplResolvedUserid] = useState('')

  const tplFilteredList = useMemo(() => {
    const s = tplProcessCodeQ.trim().toLowerCase()
    if (!s) return tplList
    return tplList.filter((r) => String(r.process_code ?? '').toLowerCase().includes(s))
  }, [tplList, tplProcessCodeQ])

  const [deptRoleLoading, setDeptRoleLoading] = useState(false)
  const [deptRoleList, setDeptRoleList] = useState<DeptRoleMapRow[]>([])
  const [roleGroupOptions, setRoleGroupOptions] = useState<{ label: string; value: string }[]>([])
  const [deptRoleModalOpen, setDeptRoleModalOpen] = useState(false)
  const [editingDeptRole, setEditingDeptRole] = useState<DeptRoleMapRow | 'new' | null>(null)
  /** 弹窗内只读展示：部门名称 + dept_id（编辑时携带列表/镜像中的名称） */
  const [deptRoleModalDeptLabel, setDeptRoleModalDeptLabel] = useState<string | null>(null)
  const [deptRoleForm] = Form.useForm<{ dingtalk_dept_id: number; role_codes: string[]; remark: string }>()
  const [orgSyncLoading, setOrgSyncLoading] = useState(false)
  const [orgSyncIncludeUsers, setOrgSyncIncludeUsers] = useState(true)

  const [mapLoading, setMapLoading] = useState(false)
  const [mapList, setMapList] = useState<MapRow[]>([])
  const [mapModalOpen, setMapModalOpen] = useState(false)
  const [mapForm] = Form.useForm<{
    business_type: string
    dingding_process_code: string
    enabled: boolean
    remark: string
    oa_map_name: string
    oa_map_customer: string
    oa_map_amount: string
    oa_map_stage: string
    oa_map_remark: string
    oa_c_code: string
    oa_c_project_name: string
    oa_c_client: string
    oa_c_manager: string
    oa_c_start_date: string
    oa_c_end_date: string
    oa_c_status: string
    oa_c_description: string
    oa_im_item_count: string
    oa_im_summary: string
    oa_im_duplicate_mode: string
    oa_im_submitter: string
    oa_im_submit_time: string
    oa_mw_code: string
    oa_mw_title: string
    oa_mw_customer_name: string
    oa_mw_due_at: string
    oa_mw_precautions: string
    oa_mw_content: string
    oa_mw_project_amount: string
    oa_mw_cost_budget: string
    oa_mt_code: string
    oa_mt_title: string
    oa_mt_task_type: string
    oa_mt_due_at: string
    oa_mt_content: string
    oa_mt_assignee: string
  }>()
  const [editingMap, setEditingMap] = useState<MapRow | 'new' | null>(null)
  const watchedBusinessType = Form.useWatch('business_type', mapForm)

  const treeData = useMemo(() => flatToTreeData(orgFlat), [orgFlat])

  const mapEffectiveBusinessType = React.useMemo(() => {
    if (editingMap !== 'new' && editingMap != null) return editingMap.business_type
    return String(watchedBusinessType ?? '').trim()
  }, [editingMap, watchedBusinessType])

  const fetchOrg = useCallback(async () => {
    setOrgLoading(true)
    try {
      const res = await axios.get<{ list: DingDeptFlat[]; truncated: boolean }>(
        '/api/dingtalk/admin/org/departments',
      )
      setOrgFlat(res.data.list || [])
      setOrgTruncated(Boolean(res.data.truncated))
      setSelectedDeptId(null)
      setUsers([])
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载部门失败')
    } finally {
      setOrgLoading(false)
    }
  }, [msg])

  const fetchDeptUsers = useCallback(
    async (deptId: number) => {
      setUsersLoading(true)
      try {
        const res = await axios.get<{ list: DingUserRow[] }>(`/api/dingtalk/admin/org/departments/${deptId}/users`)
        setUsers(res.data.list || [])
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载成员失败')
        setUsers([])
      } finally {
        setUsersLoading(false)
      }
    },
    [msg],
  )

  const fetchTemplates = useCallback(async () => {
    setTplLoading(true)
    try {
      const q = tplUserid.trim() ? `?userid=${encodeURIComponent(tplUserid.trim())}` : ''
      const res = await axios.get<{ list: ProcessTplRow[]; userid: string }>(
        `/api/dingtalk/admin/approval-templates${q}`,
      )
      setTplList(res.data.list || [])
      setTplResolvedUserid(res.data.userid || '')
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载审批模板失败')
      setTplList([])
    } finally {
      setTplLoading(false)
    }
  }, [msg, tplUserid])

  const fetchMap = useCallback(async () => {
    setMapLoading(true)
    try {
      const res = await axios.get<{ list: MapRow[] }>('/api/dingtalk/admin/process-template-map')
      setMapList(res.data.list || [])
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载映射失败')
    } finally {
      setMapLoading(false)
    }
  }, [msg])

  const fetchRoleGroups = useCallback(async () => {
    try {
      const res = await axios.get<{ list: { name: string; code: string }[] }>('/api/role-groups')
      setRoleGroupOptions(
        (res.data.list || []).map((r) => ({ label: `${r.name}（${r.code}）`, value: r.code })),
      )
    } catch {
      setRoleGroupOptions([])
    }
  }, [])

  const fetchDeptRoleMap = useCallback(async () => {
    setDeptRoleLoading(true)
    try {
      const res = await axios.get<{ list: DeptRoleMapRow[] }>('/api/dingtalk/admin/dept-role-map')
      setDeptRoleList(res.data.list || [])
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载部门权限映射失败')
    } finally {
      setDeptRoleLoading(false)
    }
  }, [msg])

  const postOrgSync = useCallback(async () => {
    setOrgSyncLoading(true)
    try {
      const res = await axios.post<{
        departments: { count: number; truncated: boolean }
        users?: { total: number; updated: number; errors: number }
      }>('/api/dingtalk/admin/org/sync', { sync_users: orgSyncIncludeUsers })
      const d = res.data.departments
      const u = res.data.users
      msg.success(
        `已同步部门镜像 ${d.count} 个${d.truncated ? '（可能截断）' : ''}` +
          (u ? `；刷新用户 ${u.updated}/${u.total}，失败 ${u.errors}` : ''),
      )
      void fetchDeptRoleMap()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '同步失败')
    } finally {
      setOrgSyncLoading(false)
    }
  }, [fetchDeptRoleMap, msg, orgSyncIncludeUsers])

  useEffect(() => {
    void fetchOrg()
    void fetchMap()
    void fetchRoleGroups()
    void fetchDeptRoleMap()
  }, [fetchOrg, fetchMap, fetchRoleGroups, fetchDeptRoleMap])

  const onTreeSelect = (_keys: React.Key[], info: { node: { key: string | number } }) => {
    const id = Number(info.node.key)
    if (!Number.isInteger(id) || id < 1) return
    setSelectedDeptId(id)
    void fetchDeptUsers(id)
  }

  const copyText = (label: string, text: string) => {
    const t = text.trim()
    if (!t) return
    void navigator.clipboard.writeText(t).then(
      () => msg.success(`已复制${label}`),
      () => msg.error('复制失败'),
    )
  }

  const userColumns: ColumnsType<DingUserRow> = [
    { title: '姓名', dataIndex: 'name', width: 120, render: (v) => v || '—' },
    {
      title: 'userid',
      dataIndex: 'userid',
      ellipsis: true,
      render: (v: string) =>
        v ? (
          <Space>
            <Text code copyable={{ text: v }}>
              {v}
            </Text>
          </Space>
        ) : (
          '—'
        ),
    },
    { title: '职位', dataIndex: 'title', width: 140, ellipsis: true, render: (v) => v || '—' },
    { title: '手机', dataIndex: 'mobile', width: 130, render: (v) => v || '—' },
    { title: '工号', dataIndex: 'job_number', width: 100, render: (v) => v || '—' },
  ]

  const tplColumns: ColumnsType<ProcessTplRow> = [
    { title: '模板名称', dataIndex: 'name', ellipsis: true, render: (v) => v || '—' },
    {
      title: 'process_code',
      dataIndex: 'process_code',
      ellipsis: true,
      render: (v: string) =>
        v ? (
          <Space>
            <Text code>{v}</Text>
            <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => copyText('process_code', v)} />
          </Space>
        ) : (
          '—'
        ),
    },
  ]

  const openEditMap = (row: MapRow) => {
    setEditingMap(row)
    const oaFields =
      row.business_type === 'construction_project_create'
        ? parseConstructionOaToModalFields(row.oa_form_field_map_json)
        : row.business_type === 'inventory_maintain_submit'
          ? parseInventoryMaintainOaToModalFields(row.oa_form_field_map_json)
          : row.business_type === 'minor_work_create'
            ? parseMinorWorkOaToModalFields(row.oa_form_field_map_json)
            : row.business_type === 'maintenance_task_create'
              ? parseMaintenanceTaskOaToModalFields(row.oa_form_field_map_json)
              : parseOaFormToModalFields(row.oa_form_field_map_json)
    mapForm.setFieldsValue({
      business_type: row.business_type,
      dingding_process_code: row.dingding_process_code || '',
      enabled: row.enabled === 1,
      remark: row.remark || '',
      ...OA_FIELD_DEFAULTS,
      ...OA_CONSTRUCTION_DEFAULTS,
      ...OA_INVENTORY_MAINTAIN_DEFAULTS,
      ...OA_MINOR_WORK_DEFAULTS,
      ...OA_MAINTENANCE_TASK_DEFAULTS,
      ...oaFields,
    })
    setMapModalOpen(true)
  }

  const openNewMap = () => {
    setEditingMap('new')
    mapForm.setFieldsValue({
      business_type: '',
      dingding_process_code: '',
      enabled: false,
      remark: '',
      ...OA_FIELD_DEFAULTS,
      ...OA_CONSTRUCTION_DEFAULTS,
      ...OA_INVENTORY_MAINTAIN_DEFAULTS,
      ...OA_MINOR_WORK_DEFAULTS,
      ...OA_MAINTENANCE_TASK_DEFAULTS,
    })
    setMapModalOpen(true)
  }

  const submitMap = async () => {
    const v = await mapForm.validateFields().catch(() => null)
    if (!v) return
    const bt =
      editingMap === 'new'
        ? String(v.business_type || '')
            .trim()
            .replace(/\s/g, '_')
        : String(editingMap && editingMap !== 'new' ? editingMap.business_type : '').trim()
    if (!bt) {
      msg.warning('请填写业务类型')
      return
    }
    let oa_form_field_map_json: Record<string, string> | null = null
    if (bt === 'construction_project_create') {
      const o: Record<string, string> = {}
      const putC = (key: string, formKey: keyof typeof OA_CONSTRUCTION_DEFAULTS) => {
        const s = String(v[formKey] ?? '').trim()
        if (s) o[key] = s
      }
      putC('code', 'oa_c_code')
      putC('project_name', 'oa_c_project_name')
      putC('client', 'oa_c_client')
      putC('manager', 'oa_c_manager')
      putC('start_date', 'oa_c_start_date')
      putC('end_date', 'oa_c_end_date')
      putC('status', 'oa_c_status')
      putC('description', 'oa_c_description')
      oa_form_field_map_json = Object.keys(o).length > 0 ? o : null
    } else if (bt === 'inventory_maintain_submit') {
      const o: Record<string, string> = {}
      const putI = (key: string, formKey: keyof typeof OA_INVENTORY_MAINTAIN_DEFAULTS) => {
        const s = String(v[formKey] ?? '').trim()
        if (s) o[key] = s
      }
      putI('item_count', 'oa_im_item_count')
      putI('summary', 'oa_im_summary')
      putI('duplicate_mode', 'oa_im_duplicate_mode')
      putI('submitter', 'oa_im_submitter')
      putI('submit_time', 'oa_im_submit_time')
      oa_form_field_map_json = Object.keys(o).length > 0 ? o : null
    } else if (bt === 'minor_work_create') {
      const o: Record<string, string> = {}
      const putM = (key: string, formKey: keyof typeof OA_MINOR_WORK_DEFAULTS) => {
        const s = String(v[formKey] ?? '').trim()
        if (s) o[key] = s
      }
      putM('code', 'oa_mw_code')
      putM('title', 'oa_mw_title')
      putM('customer_name', 'oa_mw_customer_name')
      putM('due_at', 'oa_mw_due_at')
      putM('precautions', 'oa_mw_precautions')
      putM('content', 'oa_mw_content')
      putM('project_amount', 'oa_mw_project_amount')
      putM('cost_budget', 'oa_mw_cost_budget')
      oa_form_field_map_json = Object.keys(o).length > 0 ? o : null
    } else if (bt === 'maintenance_task_create') {
      const o: Record<string, string> = {}
      const putT = (key: string, formKey: keyof typeof OA_MAINTENANCE_TASK_DEFAULTS) => {
        const s = String(v[formKey] ?? '').trim()
        if (s) o[key] = s
      }
      putT('code', 'oa_mt_code')
      putT('title', 'oa_mt_title')
      putT('task_type', 'oa_mt_task_type')
      putT('due_at', 'oa_mt_due_at')
      putT('content', 'oa_mt_content')
      putT('assignee', 'oa_mt_assignee')
      oa_form_field_map_json = Object.keys(o).length > 0 ? o : null
    } else {
      const oaPayload: Record<string, string> = {}
      const putOa = (key: string, formKey: keyof typeof OA_FIELD_DEFAULTS) => {
        const s = String(v[formKey] ?? '').trim()
        if (s) oaPayload[key] = s
      }
      putOa('name', 'oa_map_name')
      putOa('customer', 'oa_map_customer')
      putOa('amount', 'oa_map_amount')
      putOa('stage', 'oa_map_stage')
      putOa('remark', 'oa_map_remark')
      oa_form_field_map_json = Object.keys(oaPayload).length > 0 ? oaPayload : null
    }
    try {
      await axios.put(`/api/dingtalk/admin/process-template-map/${encodeURIComponent(bt)}`, {
        dingding_process_code: v.dingding_process_code?.trim() || '',
        enabled: v.enabled,
        remark: v.remark?.trim() || '',
        oa_form_field_map_json,
      })
      msg.success('已保存')
      setMapModalOpen(false)
      setEditingMap(null)
      void fetchMap()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    }
  }

  const mapColumns: ColumnsType<MapRow> = [
    { title: '业务类型', dataIndex: 'business_type', width: 180, render: (v) => <Text code>{v}</Text> },
    {
      title: '钉钉 process_code',
      dataIndex: 'dingding_process_code',
      ellipsis: true,
      render: (v: string) => v || <Text type="secondary">（空）</Text>,
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (v: number) => (v === 1 ? <Tag color="success">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: '审批表单映射',
      key: 'oa_map',
      width: 120,
      render: (_, row) =>
        row.oa_form_field_map_json?.trim() ? <Tag color="processing">已配置</Tag> : <Text type="secondary">环境变量/默认</Text>,
    },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v) => v || '—' },
    {
      title: '操作',
      key: 'op',
      width: 160,
      render: (_, row) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEditMap(row)}>
            编辑
          </Button>
          {!BUILTIN_MAP_TYPES.includes(row.business_type as (typeof BUILTIN_MAP_TYPES)[number]) && (
            <Popconfirm
              title="确定删除该映射？"
              onConfirm={async () => {
                try {
                  await axios.delete(`/api/dingtalk/admin/process-template-map/${encodeURIComponent(row.business_type)}`)
                  msg.success('已删除')
                  void fetchMap()
                } catch (e: unknown) {
                  msg.error(
                    (e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败',
                  )
                }
              }}
            >
              <Button type="link" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  const buildDeptModalLabel = useCallback((deptId: number, nameFromApi: string | null | undefined) => {
    const trimmed = (nameFromApi ?? '').trim()
    const fromTree = orgFlat.find((x) => x.dept_id === deptId)?.name?.trim()
    const name = trimmed || fromTree
    return name ? `${name}（dept_id ${deptId}）` : `dept_id ${deptId}（镜像中暂无部门名称）`
  }, [orgFlat])

  const openNewDeptRole = () => {
    setEditingDeptRole('new')
    const id = selectedDeptId ?? undefined
    setDeptRoleModalDeptLabel(
      id != null && Number.isInteger(id) && id >= 1 ? buildDeptModalLabel(id, null) : null,
    )
    deptRoleForm.setFieldsValue({
      dingtalk_dept_id: selectedDeptId ?? undefined,
      role_codes: [],
      remark: '',
    })
    setDeptRoleModalOpen(true)
  }

  const openEditDeptRole = (row: DeptRoleMapRow) => {
    setEditingDeptRole(row)
    setDeptRoleModalDeptLabel(buildDeptModalLabel(row.dingtalk_dept_id, row.dept_name))
    deptRoleForm.setFieldsValue({
      dingtalk_dept_id: row.dingtalk_dept_id,
      role_codes: row.role_codes,
      remark: row.remark ?? '',
    })
    setDeptRoleModalOpen(true)
  }

  const submitDeptRole = async () => {
    try {
      const v = await deptRoleForm.validateFields()
      await axios.put(`/api/dingtalk/admin/dept-role-map/${v.dingtalk_dept_id}`, {
        role_codes: v.role_codes || [],
        remark: v.remark?.trim() || '',
      })
      msg.success('已保存')
      setDeptRoleModalOpen(false)
      setEditingDeptRole(null)
      setDeptRoleModalDeptLabel(null)
      void fetchDeptRoleMap()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    }
  }

  const deptRoleColumns: ColumnsType<DeptRoleMapRow> = [
    { title: '部门 ID', dataIndex: 'dingtalk_dept_id', width: 100, render: (v) => <Text code>{v}</Text> },
    { title: '部门名称（镜像）', dataIndex: 'dept_name', ellipsis: true, render: (v) => v || <Text type="secondary">—</Text> },
    {
      title: '权限组',
      dataIndex: 'role_codes',
      render: (codes: string[]) =>
        codes?.length ? (
          <Space wrap size={[0, 4]}>
            {codes.map((c) => (
              <Tag key={c}>{c}</Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">（空）</Text>
        ),
    },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v) => v || '—' },
    {
      title: '操作',
      key: 'op',
      width: 140,
      render: (_, row) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEditDeptRole(row)}>
            编辑
          </Button>
          <Popconfirm
            title="删除该部门的权限映射？"
            onConfirm={async () => {
              try {
                await axios.delete(`/api/dingtalk/admin/dept-role-map/${row.dingtalk_dept_id}`)
                msg.success('已删除')
                void fetchDeptRoleMap()
              } catch (e: unknown) {
                msg.error(
                  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败',
                )
              }
            }}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      <div className="page-header-banner" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          钉钉集成
        </Title>
        <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
          通讯录与部门只读拉取；可配置「钉钉部门 → 本系统权限组」供免登 JIT 与同步使用；流程模板映射仍在「流程模板映射」页。应用须开通通讯录与 OA 审批等权限。
        </Text>
      </div>

      <Tabs
        items={[
          {
            key: 'org',
            label: (
              <span>
                <TeamOutlined /> 组织架构与成员
              </span>
            ),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Card
                  size="small"
                  title="部门树"
                  extra={
                    <Button icon={<ReloadOutlined />} loading={orgLoading} onClick={() => void fetchOrg()}>
                      刷新部门
                    </Button>
                  }
                >
                  {orgTruncated && (
                    <Text type="warning" style={{ display: 'block', marginBottom: 8 }}>
                      部门数量已达上限（可在服务端配置 DINGTALK_ORG_SYNC_MAX_NODES），列表可能不完整。
                    </Text>
                  )}
                  {orgLoading && !orgFlat.length ? (
                    <Text type="secondary">加载中…</Text>
                  ) : (
                    <Tree
                      showLine
                      treeData={treeData}
                      onSelect={onTreeSelect}
                      style={{ maxHeight: 420, overflow: 'auto' }}
                    />
                  )}
                </Card>
                <Card size="small" title={selectedDeptId ? `部门成员（dept_id=${selectedDeptId}）` : '部门成员'}>
                  {!selectedDeptId ? (
                    <Text type="secondary">请在上方选择部门</Text>
                  ) : (
                    <Table<DingUserRow>
                      rowKey={(r, i) => (r.userid ? String(r.userid) : `u-${i}`)}
                      size="small"
                      loading={usersLoading}
                      dataSource={users}
                      columns={userColumns}
                      pagination={{ pageSize: 15, showSizeChanger: true }}
                      locale={{ emptyText: '该部门下暂无成员或无权查看' }}
                    />
                  )}
                </Card>
              </Space>
            ),
          },
          {
            key: 'dept-roles',
            label: (
              <span>
                <ApartmentOutlined /> 部门与权限组
              </span>
            ),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Alert
                  type="info"
                  showIcon
                  message="权限如何生效"
                  description={
                    <span>
                      列表以<strong>已同步的部门镜像</strong>为准：全量同步后会为每个部门自动生成一行映射（权限组可先为空，再逐部门勾选）；与「用户管理」中权限组 code 一致。成员在多个部门时，各部门及上级部门上的映射会合并；若整条链上均为空，则使用环境变量{' '}
                      <Text code>DINGTALK_JIT_DEFAULT_ROLES</Text>（默认普通用户）。本地手动赋予的 <Text code>admin</Text>{' '}
                      不会在同步时被移除。
                    </span>
                  }
                />
                <Card
                  size="small"
                  title="部门 → 权限组映射"
                  extra={
                    <Space wrap>
                      <Checkbox checked={orgSyncIncludeUsers} onChange={(e) => setOrgSyncIncludeUsers(e.target.checked)}>
                        全量同步时刷新已绑定用户
                      </Checkbox>
                      <Button type="primary" loading={orgSyncLoading} onClick={() => void postOrgSync()}>
                        全量同步（部门镜像 + 用户）
                      </Button>
                      <Button icon={<ReloadOutlined />} loading={deptRoleLoading} onClick={() => void fetchDeptRoleMap()}>
                        刷新列表
                      </Button>
                      <Button type="primary" onClick={openNewDeptRole}>
                        添加映射
                      </Button>
                    </Space>
                  }
                >
                  <Table<DeptRoleMapRow>
                    rowKey="dingtalk_dept_id"
                    size="small"
                    loading={deptRoleLoading}
                    dataSource={deptRoleList}
                    columns={deptRoleColumns}
                    pagination={false}
                    locale={{
                      emptyText:
                        '暂无已同步部门；请先点「全量同步」拉取钉钉架构（将自动生成映射行，权限组可为空后再编辑）',
                    }}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: 'tpl',
            label: (
              <span>
                <UnorderedListOutlined /> 审批模板
              </span>
            ),
            children: (
              <Card
                size="small"
                title="可见审批表单（topapi/process/listbyuserid）"
                extra={
                  <Space wrap>
                    <Input
                      style={{ width: 260 }}
                      placeholder="覆盖 userid（可选，默认当前登录用户绑定的钉钉）"
                      value={tplUserid}
                      onChange={(e) => setTplUserid(e.target.value)}
                      allowClear
                    />
                    <Button type="primary" icon={<ReloadOutlined />} loading={tplLoading} onClick={() => void fetchTemplates()}>
                      拉取模板
                    </Button>
                  </Space>
                }
              >
                {tplResolvedUserid ? (
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    当前查询身份 userid：<Text code>{tplResolvedUserid}</Text>
                  </Text>
                ) : null}
                <Space style={{ display: 'flex', marginBottom: 12 }} wrap>
                  <Input
                    style={{ width: 280 }}
                    placeholder="按 process_code 筛选（客户端，不请求接口）"
                    value={tplProcessCodeQ}
                    onChange={(e) => setTplProcessCodeQ(e.target.value)}
                    allowClear
                  />
                  {tplProcessCodeQ.trim() ? (
                    <Text type="secondary">
                      显示 {tplFilteredList.length} / {tplList.length} 条
                    </Text>
                  ) : null}
                </Space>
                <Table<ProcessTplRow>
                  rowKey={(r, i) => (r.process_code ? String(r.process_code) : `p-${i}`)}
                  size="small"
                  loading={tplLoading}
                  dataSource={tplFilteredList}
                  columns={tplColumns}
                  pagination={{ pageSize: 12, showSizeChanger: true }}
                  locale={{
                    emptyText:
                      '点击「拉取模板」；若失败请在用户管理中绑定钉钉 userid，或使用上方覆盖 userid / 服务端环境变量 DINGTALK_TEMPLATE_QUERY_USERID',
                  }}
                />
              </Card>
            ),
          },
          {
            key: 'map',
            label: (
              <span>
                <DeploymentUnitOutlined /> 流程模板映射
              </span>
            ),
            children: (
              <Card
                size="small"
                title="process_template_map（业务类型 → 钉钉 process_code）"
                extra={
                  <Space>
                    <Button icon={<ReloadOutlined />} loading={mapLoading} onClick={() => void fetchMap()}>
                      刷新
                    </Button>
                    <Button type="primary" onClick={openNewMap}>
                      新增映射
                    </Button>
                  </Space>
                }
              >
                <Table<MapRow>
                  rowKey="id"
                  size="small"
                  loading={mapLoading}
                  dataSource={mapList}
                  columns={mapColumns}
                  pagination={false}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title={
          editingDeptRole === 'new'
            ? '添加部门权限映射'
            : deptRoleModalDeptLabel
              ? `编辑部门权限映射 — ${deptRoleModalDeptLabel.split('（')[0]?.trim() ?? ''}`
              : '编辑部门权限映射'
        }
        open={deptRoleModalOpen}
        onCancel={() => {
          setDeptRoleModalOpen(false)
          setEditingDeptRole(null)
          setDeptRoleModalDeptLabel(null)
        }}
        onOk={() => void submitDeptRole()}
        destroyOnClose
        width={520}
      >
        <Form form={deptRoleForm} layout="vertical">
          {deptRoleModalDeptLabel ? (
            <Form.Item label="部门名称（钉钉镜像）">
              <Input readOnly value={deptRoleModalDeptLabel} />
            </Form.Item>
          ) : editingDeptRole === 'new' ? (
            <Alert
              type="info"
              showIcon
              message="未带出部门名称"
              description="可在「组织架构」页选中部门后点「添加映射」，将自动显示部门名称；或直接填写 dept_id。"
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <Form.Item
            name="dingtalk_dept_id"
            label="钉钉部门 dept_id"
            rules={[{ required: true, message: '必填' }]}
          >
            <InputNumber
              min={1}
              precision={0}
              style={{ width: '100%' }}
              disabled={editingDeptRole !== 'new' && editingDeptRole != null}
              placeholder="在「组织架构」页选部门后点添加可预填"
            />
          </Form.Item>
          <Form.Item name="role_codes" label="权限组（多选，可留空则走默认角色）">
            <Select
              mode="multiple"
              options={roleGroupOptions}
              placeholder="选择 role_groups.code"
              optionFilterProp="label"
              allowClear
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingMap === 'new' ? '新增流程模板映射' : '编辑流程模板映射'}
        open={mapModalOpen}
        onCancel={() => {
          setMapModalOpen(false)
          setEditingMap(null)
        }}
        onOk={() => void submitMap()}
        destroyOnClose
        width={640}
      >
        <Form form={mapForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="business_type"
            label="业务类型（英文标识）"
            rules={[
              { required: editingMap === 'new', message: '必填' },
              { pattern: /^[a-zA-Z][a-zA-Z0-9_-]*$/, message: '须以字母开头，仅字母数字下划线连字符' },
            ]}
          >
            <Input placeholder="如 opportunity_create" disabled={editingMap !== 'new'} />
          </Form.Item>
          <Form.Item name="dingding_process_code" label="钉钉 process_code">
            <Input placeholder="从「审批模板」页复制" />
          </Form.Item>
          <Form.Item name="enabled" label="启用门禁" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="关闭" />
          </Form.Item>
          {mapEffectiveBusinessType === 'minor_work_create' ? (
            <Form.Item label="零星工程 → 钉钉表单 name 映射">
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                发起「零星工程」审批时写入对应控件；名称须与钉钉模板控件完全一致。留空保存则使用环境变量 DINGTALK_MINOR_WORK_OA_FORM
                或内置默认。
              </Text>
              <Form.Item name="oa_mw_code" label="工单编号 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_MINOR_WORK_DEFAULTS.oa_mw_code} />
              </Form.Item>
              <Form.Item name="oa_mw_title" label="标题 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_MINOR_WORK_DEFAULTS.oa_mw_title} />
              </Form.Item>
              <Form.Item name="oa_mw_customer_name" label="客户名称 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_MINOR_WORK_DEFAULTS.oa_mw_customer_name} />
              </Form.Item>
              <Form.Item name="oa_mw_due_at" label="截止时间 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_MINOR_WORK_DEFAULTS.oa_mw_due_at} />
              </Form.Item>
              <Form.Item name="oa_mw_precautions" label="注意事项 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_MINOR_WORK_DEFAULTS.oa_mw_precautions} />
              </Form.Item>
              <Form.Item name="oa_mw_content" label="事项内容 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_MINOR_WORK_DEFAULTS.oa_mw_content} />
              </Form.Item>
              <Form.Item name="oa_mw_project_amount" label="工程金额 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_MINOR_WORK_DEFAULTS.oa_mw_project_amount} />
              </Form.Item>
              <Form.Item name="oa_mw_cost_budget" label="成本预算 →" style={{ marginBottom: 0 }}>
                <Input placeholder={OA_MINOR_WORK_DEFAULTS.oa_mw_cost_budget} />
              </Form.Item>
            </Form.Item>
          ) : mapEffectiveBusinessType === 'maintenance_task_create' ? (
            <Form.Item label="维护排单 → 钉钉表单 name 映射">
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                发起「维护排单」审批时写入对应控件；名称须与钉钉模板控件完全一致。留空保存则使用环境变量
                DINGTALK_MAINTENANCE_TASK_OA_FORM 或内置默认。
              </Text>
              <Form.Item name="oa_mt_code" label="任务编号 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_MAINTENANCE_TASK_DEFAULTS.oa_mt_code} />
              </Form.Item>
              <Form.Item name="oa_mt_title" label="任务标题 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_MAINTENANCE_TASK_DEFAULTS.oa_mt_title} />
              </Form.Item>
              <Form.Item name="oa_mt_task_type" label="任务类型 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_MAINTENANCE_TASK_DEFAULTS.oa_mt_task_type} />
              </Form.Item>
              <Form.Item name="oa_mt_due_at" label="截止时间 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_MAINTENANCE_TASK_DEFAULTS.oa_mt_due_at} />
              </Form.Item>
              <Form.Item name="oa_mt_content" label="任务说明 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_MAINTENANCE_TASK_DEFAULTS.oa_mt_content} />
              </Form.Item>
              <Form.Item name="oa_mt_assignee" label="执行人 →" style={{ marginBottom: 0 }}>
                <Input placeholder={OA_MAINTENANCE_TASK_DEFAULTS.oa_mt_assignee} />
              </Form.Item>
            </Form.Item>
          ) : mapEffectiveBusinessType === 'construction_project_create' ? (
            <Form.Item label="施工项目 → 钉钉表单 name 映射">
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                发起「新增施工项目」审批时，字段会写入对应控件；名称须与钉钉模板控件完全一致。留空保存则使用环境变量
                DINGTALK_CONSTRUCTION_PROJECT_OA_FORM 或内置默认。
              </Text>
              <Form.Item name="oa_c_code" label="项目编号 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_CONSTRUCTION_DEFAULTS.oa_c_code} />
              </Form.Item>
              <Form.Item name="oa_c_project_name" label="项目名称 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_CONSTRUCTION_DEFAULTS.oa_c_project_name} />
              </Form.Item>
              <Form.Item name="oa_c_client" label="业主单位 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_CONSTRUCTION_DEFAULTS.oa_c_client} />
              </Form.Item>
              <Form.Item name="oa_c_manager" label="现场负责人 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_CONSTRUCTION_DEFAULTS.oa_c_manager} />
              </Form.Item>
              <Form.Item name="oa_c_start_date" label="计划开始日期 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_CONSTRUCTION_DEFAULTS.oa_c_start_date} />
              </Form.Item>
              <Form.Item name="oa_c_end_date" label="计划结束日期 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_CONSTRUCTION_DEFAULTS.oa_c_end_date} />
              </Form.Item>
              <Form.Item name="oa_c_status" label="项目状态 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_CONSTRUCTION_DEFAULTS.oa_c_status} />
              </Form.Item>
              <Form.Item name="oa_c_description" label="项目描述 →" style={{ marginBottom: 0 }}>
                <Input placeholder={OA_CONSTRUCTION_DEFAULTS.oa_c_description} />
              </Form.Item>
            </Form.Item>
          ) : mapEffectiveBusinessType === 'inventory_maintain_submit' ? (
            <Form.Item label="库存维护提交 → 钉钉表单 name 映射">
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                发起「库存维护批量入库」审批时写入对应控件；名称须与钉钉模板控件完全一致。留空保存则使用环境变量
                DINGTALK_INVENTORY_MAINTAIN_OA_FORM 或内置默认。
              </Text>
              <Form.Item name="oa_im_item_count" label="入库条数 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_INVENTORY_MAINTAIN_DEFAULTS.oa_im_item_count} />
              </Form.Item>
              <Form.Item name="oa_im_summary" label="明细摘要 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_INVENTORY_MAINTAIN_DEFAULTS.oa_im_summary} />
              </Form.Item>
              <Form.Item name="oa_im_duplicate_mode" label="SKU重复处理 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_INVENTORY_MAINTAIN_DEFAULTS.oa_im_duplicate_mode} />
              </Form.Item>
              <Form.Item name="oa_im_submitter" label="提交人 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_INVENTORY_MAINTAIN_DEFAULTS.oa_im_submitter} />
              </Form.Item>
              <Form.Item name="oa_im_submit_time" label="提交时间 →" style={{ marginBottom: 0 }}>
                <Input placeholder={OA_INVENTORY_MAINTAIN_DEFAULTS.oa_im_submit_time} />
              </Form.Item>
            </Form.Item>
          ) : (
            <Form.Item label="机会 → 钉钉表单 name 映射">
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                发起「机会创建」审批时，ERP 字段会写入对应控件；每项须与钉钉 OA
                模板里该控件的名称完全一致。留空并保存为清空映射时，使用环境变量 DINGTALK_OPPORTUNITY_OA_FORM 或内置默认。
              </Text>
              <Form.Item name="oa_map_name" label="机会名称 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_FIELD_DEFAULTS.oa_map_name} />
              </Form.Item>
              <Form.Item name="oa_map_customer" label="客户名称 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_FIELD_DEFAULTS.oa_map_customer} />
              </Form.Item>
              <Form.Item name="oa_map_amount" label="预计金额 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_FIELD_DEFAULTS.oa_map_amount} />
              </Form.Item>
              <Form.Item name="oa_map_stage" label="销售阶段 →" style={{ marginBottom: 8 }}>
                <Input placeholder={OA_FIELD_DEFAULTS.oa_map_stage} />
              </Form.Item>
              <Form.Item name="oa_map_remark" label="备注 →" style={{ marginBottom: 0 }}>
                <Input placeholder={OA_FIELD_DEFAULTS.oa_map_remark} />
              </Form.Item>
            </Form.Item>
          )}
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default DingTalkAdminPage
