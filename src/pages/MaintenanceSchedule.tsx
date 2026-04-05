/**
 * 维护管理 - 维护排单
 * 新建后须在详情「分配任务」指定执行人（可「转派」），再提交钉钉审批、填写操作记录与完结；操作记录可粘贴/拖入图片；进度每次至少 +10%；记录保存后已排单→执行中；完结仅抽屉「完结」。
 */
import {
  CalendarOutlined,
  DownloadOutlined,
  EyeOutlined,
  PlusOutlined,
  SendOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Slider,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  DatePicker,
  Upload,
} from 'antd'
import axios from 'axios'
import dayjs, { type Dayjs } from 'dayjs'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DueCountdownCell, useNowEverySecond } from '../components/DueCountdownCell'
import {
  assigneeLabelMap,
  buildConstructionAssigneeOptions,
  type AssigneeInactiveRef,
  type AssigneeUserRow,
} from '../utils/constructionAssigneeOptions'

const { Title, Text, Paragraph } = Typography
const { Search } = Input
const { TextArea } = Input

type MaintenanceTaskStatus = 'scheduled' | 'in_progress' | 'overdue' | 'completed' | 'cancelled'
type TaskType = 'inspect' | 'repair' | 'maintain' | 'routine' | 'upgrade'

type GateAudit = {
  dingtalk_gate: boolean
  audit_status: 'draft' | 'approving' | 'completed'
  audit_outcome: 'approved' | 'rejected' | null
  dingtalk_process_instance_id: string | null
}

function mtAuditLabel(audit: GateAudit | undefined): { text: string; color: string } | null {
  if (!audit?.dingtalk_gate) return null
  if (audit.audit_status === 'draft') return { text: '待提交审批', color: 'default' }
  if (audit.audit_status === 'approving') return { text: '审批中', color: 'processing' }
  if (audit.audit_outcome === 'approved') return { text: '审批通过', color: 'success' }
  if (audit.audit_outcome === 'rejected') return { text: '已拒绝', color: 'error' }
  return null
}

function canDeleteMtWithAudit(audit: GateAudit | undefined): boolean {
  if (!audit?.dingtalk_gate) return true
  return audit.audit_status !== 'approving'
}

function canSubmitMtDingTalk(audit: GateAudit | undefined): boolean {
  if (!audit?.dingtalk_gate) return false
  return (
    audit.audit_status === 'draft' ||
    (audit.audit_status === 'completed' && audit.audit_outcome === 'rejected')
  )
}

function mtOpsUnlocked(audit: GateAudit | undefined): boolean {
  if (!audit?.dingtalk_gate) return true
  return audit.audit_status === 'completed' && audit.audit_outcome === 'approved'
}

type MaintenanceTask = {
  id: number
  code: string
  title: string
  task_type: TaskType | string
  due_at: string
  content: string | null
  status: MaintenanceTaskStatus
  progress: number
  assignee: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  audit?: GateAudit
}

function mtTaskHasAssignee(task: MaintenanceTask | null | undefined): boolean {
  return Boolean(task?.assignee?.trim())
}

/** 审批通过（或未启用门禁）且已分配执行人时，可写操作记录、附图、完结 */
function mtLogActionsAllowed(audit: GateAudit | undefined, task: MaintenanceTask | null): boolean {
  return mtOpsUnlocked(audit) && mtTaskHasAssignee(task)
}

/** 可提交钉钉审批且已分配执行人 */
function mtDingSubmitAllowed(audit: GateAudit | undefined, task: MaintenanceTask | null): boolean {
  return canSubmitMtDingTalk(audit) && mtTaskHasAssignee(task)
}

/** 未完成/未取消且非审批进行中时可分配或转派 */
function canAssignOrReassignMt(task: MaintenanceTask, audit: GateAudit | undefined): boolean {
  if (task.status === 'completed' || task.status === 'cancelled') return false
  if (audit?.dingtalk_gate && audit.audit_status === 'approving') return false
  return true
}

type MaintenanceTaskLog = {
  id: number
  maintenance_task_id: number
  content: string
  action: string
  from_status: string | null
  to_status: string | null
  progress_after: number | null
  created_at: string
  created_by: string | null
}

type MaintenanceTaskLogAttachment = {
  id: number
  maintenance_task_id: number
  log_id: number
  file_name: string
  file_size: number
  mime_type: string | null
  created_at: string
  created_by: string | null
}

const LOG_IMAGE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,image/*'

function validateLogImageFile(file: File): string | null {
  const okExt = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(file.name)
  if (!okExt && !file.type.startsWith('image/')) {
    return '仅支持 jpg、png、gif、webp、bmp、tiff 等图片'
  }
  if (file.size > 8 * 1024 * 1024) {
    return '图片大小不能超过 8MB'
  }
  return null
}

/** 追加操作记录时，更新后进度的默认值与下限：当前 +10%，上限 100% */
function minProgressAfterAppend(current: number): number {
  const p = Math.min(100, Math.max(0, Math.round(Number(current))))
  return Math.min(100, p + 10)
}

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  scheduled: { color: 'blue', label: '已排单' },
  in_progress: { color: 'processing', label: '执行中' },
  overdue: { color: 'error', label: '已逾期' },
  completed: { color: 'success', label: '已完成' },
  cancelled: { color: 'default', label: '已取消' },
}

const TYPE_MAP: Record<string, string> = {
  inspect: '巡检',
  repair: '维修',
  maintain: '维护',
  routine: '例行维护',
  upgrade: '升级改造',
}

const TYPE_OPTIONS = [
  { value: 'inspect', label: '巡检' },
  { value: 'repair', label: '维修' },
  { value: 'maintain', label: '维护' },
  { value: 'routine', label: '例行维护' },
  { value: 'upgrade', label: '升级改造' },
]

const LOG_ACTION_LABEL: Record<string, string> = {
  note: '记录',
  start: '开始执行',
  progress: '更新进度',
  complete: '完成',
  auto_overdue: '逾期（自动）',
  assign: '分配任务',
  reassign: '转派',
}

function formatLogLine(log: MaintenanceTaskLog): string {
  const act = LOG_ACTION_LABEL[log.action] ?? log.action
  const who = log.created_by ? ` · ${log.created_by}` : ''
  if (log.from_status && log.to_status && log.from_status !== log.to_status) {
    const a = STATUS_MAP[log.from_status]?.label ?? log.from_status
    const b = STATUS_MAP[log.to_status]?.label ?? log.to_status
    return `${act}：${a} → ${b}${who}`
  }
  return `${act}${who}`
}

function defaultDueAtHour18(): Dayjs {
  const now = dayjs()
  let d = now.startOf('day').hour(18).minute(0).second(0).millisecond(0)
  if (!d.isAfter(now)) {
    d = d.add(1, 'day')
  }
  return d
}

function dueAtDisabledDate(current: Dayjs) {
  return Boolean(current && current.startOf('day').isBefore(dayjs().startOf('day')))
}

function dueAtDisabledTime(date: Dayjs | null | undefined) {
  if (!date || !date.isSame(dayjs(), 'day')) return {}
  const now = dayjs()
  const disabledHours: number[] = []
  for (let h = 0; h < 24; h++) {
    if (now.startOf('day').hour(h).isBefore(now)) disabledHours.push(h)
  }
  return { disabledHours: () => disabledHours }
}

const MaintenanceSchedulePage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<MaintenanceTask[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm] = Form.useForm()
  const dueAtLastDayKeyRef = useRef<string | null>(null)
  const listNow = useNowEverySecond()
  const [createSubmitting, setCreateSubmitting] = useState(false)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [task, setTask] = useState<MaintenanceTask | null>(null)
  const [logs, setLogs] = useState<MaintenanceTaskLog[]>([])
  const [logAttachments, setLogAttachments] = useState<MaintenanceTaskLogAttachment[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const [logForm] = Form.useForm()
  const [logProgress, setLogProgress] = useState(0)
  const [logSubmitting, setLogSubmitting] = useState(false)
  const [pendingLogImages, setPendingLogImages] = useState<{ file: File; previewUrl: string }[]>([])

  const [finishOpen, setFinishOpen] = useState(false)
  const [finishNote, setFinishNote] = useState('')
  const [finishSubmitting, setFinishSubmitting] = useState(false)

  const [imgPreviewOpen, setImgPreviewOpen] = useState(false)
  const [imgPreview, setImgPreview] = useState<{ url: string; name: string } | null>(null)
  const [dingSubmittingId, setDingSubmittingId] = useState<number | null>(null)
  const [drawerDingSubmitting, setDrawerDingSubmitting] = useState(false)

  const [assignForm] = Form.useForm()
  const [assignSubmitting, setAssignSubmitting] = useState(false)
  const [assigneeUserRows, setAssigneeUserRows] = useState<AssigneeUserRow[]>([])
  const [assigneeInactiveRef, setAssigneeInactiveRef] = useState<AssigneeInactiveRef[]>([])
  const [assigneeUsersLoading, setAssigneeUsersLoading] = useState(false)

  const assignSelectOptions = useMemo(
    () => buildConstructionAssigneeOptions(assigneeUserRows, assigneeInactiveRef),
    [assigneeUserRows, assigneeInactiveRef],
  )

  const closeImgPreview = useCallback(() => {
    setImgPreview((p) => {
      if (p?.url) URL.revokeObjectURL(p.url)
      return null
    })
    setImgPreviewOpen(false)
  }, [])

  const clearPendingLogImages = useCallback(() => {
    setPendingLogImages((items) => {
      for (const it of items) URL.revokeObjectURL(it.previewUrl)
      return []
    })
  }, [])

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get<{ list: MaintenanceTask[] }>('/api/maintenance-tasks', {
        params: keyword ? { keyword } : {},
      })
      setList(res.data.list ?? [])
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, msg])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  useEffect(() => {
    if (createOpen) {
      const def = defaultDueAtHour18()
      createForm.setFieldValue('due_at', def)
      dueAtLastDayKeyRef.current = def.format('YYYY-MM-DD')
    }
  }, [createOpen, createForm])

  useEffect(() => {
    if (!drawerOpen) return
    let cancelled = false
    setAssigneeUsersLoading(true)
    void axios
      .get<{ list: AssigneeUserRow[]; inactive_referenced?: AssigneeInactiveRef[] }>(
        '/api/maintenance-tasks/assignee-user-options',
      )
      .then((res) => {
        if (cancelled) return
        setAssigneeUserRows(res.data?.list ?? [])
        setAssigneeInactiveRef(res.data?.inactive_referenced ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setAssigneeUserRows([])
        setAssigneeInactiveRef([])
      })
      .finally(() => {
        if (!cancelled) setAssigneeUsersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [drawerOpen])

  const loadDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true)
      try {
        const res = await axios.get<{
          task: MaintenanceTask
          logs: MaintenanceTaskLog[]
          logAttachments?: MaintenanceTaskLogAttachment[]
          audit?: GateAudit
        }>(`/api/maintenance-tasks/${id}`)
        setTask({ ...res.data.task, audit: res.data.audit })
        setLogs(res.data.logs ?? [])
        setLogAttachments(res.data.logAttachments ?? [])
        const t = res.data.task
        setLogProgress(minProgressAfterAppend(t.progress))
        logForm.resetFields()
        assignForm.setFieldsValue({ assignee: t.assignee?.trim() || undefined })
        clearPendingLogImages()
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载详情失败')
      } finally {
        setDetailLoading(false)
      }
    },
    [assignForm, clearPendingLogImages, logForm, msg],
  )

  useEffect(() => {
    if (drawerOpen && detailId != null) {
      void loadDetail(detailId)
    }
  }, [drawerOpen, detailId, loadDetail])

  const openDetail = (r: MaintenanceTask) => {
    setDetailId(r.id)
    setDrawerOpen(true)
  }

  const submitAssign = async () => {
    if (!detailId || !task) return
    const wasAssignee = Boolean(task.assignee?.trim())
    try {
      const v = await assignForm.validateFields()
      setAssignSubmitting(true)
      const res = await axios.post<{
        task: MaintenanceTask
        logs: MaintenanceTaskLog[]
        logAttachments?: MaintenanceTaskLogAttachment[]
      }>(`/api/maintenance-tasks/${detailId}/assign`, { assignee: v.assignee })
      const nt = res.data.task
      setTask({ ...nt, audit: nt.audit })
      setLogs(res.data.logs ?? [])
      setLogAttachments(res.data.logAttachments ?? [])
      assignForm.setFieldsValue({ assignee: res.data.task.assignee?.trim() || undefined })
      msg.success(wasAssignee ? '已转派' : '已分配')
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setAssignSubmitting(false)
    }
  }

  const handleCreate = async () => {
    try {
      const v = await createForm.validateFields()
      const due = v.due_at ? dayjs(v.due_at).startOf('hour') : null
      setCreateSubmitting(true)
      const createRes = await axios.post<{ audit?: GateAudit }>('/api/maintenance-tasks', {
        title: v.title.trim(),
        task_type: v.task_type,
        due_at: due ? due.format('YYYY-MM-DD HH:00') : undefined,
        content: v.content?.trim() || undefined,
      })
      const gate = createRes.data?.audit?.dingtalk_gate
      const st = createRes.data?.audit?.audit_status
      msg.success(
        gate && st === 'draft'
          ? '已创建。请先在详情中「分配任务」指定执行人，再提交钉钉审批；审批通过后方可填写操作记录与完结'
          : '已创建。请先在详情中「分配任务」指定执行人后再办理后续步骤',
      )
      setCreateOpen(false)
      createForm.resetFields()
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '创建失败')
    } finally {
      setCreateSubmitting(false)
    }
  }

  const submitLog = async () => {
    if (!detailId || !task) return
    if (!mtTaskHasAssignee(task)) {
      msg.warning('请先分配任务执行人')
      return
    }
    try {
      const v = await logForm.validateFields()
      const need = minProgressAfterAppend(task.progress)
      if (logProgress < need) {
        msg.warning(`更新后的进度须至少为 ${need}%（较当前至少提高 10%，且不超过 100%）`)
        return
      }
      setLogSubmitting(true)
      const fd = new FormData()
      fd.append('content', (v.log_content ?? '').trim())
      fd.append('progress_after', String(logProgress))
      fd.append('mark_complete', 'false')
      for (const { file } of pendingLogImages) {
        fd.append('files', file)
      }
      const res = await axios.post<{
        task: MaintenanceTask
        logs: MaintenanceTaskLog[]
        logAttachments?: MaintenanceTaskLogAttachment[]
      }>(`/api/maintenance-tasks/${detailId}/logs`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const nt = res.data.task
      setTask({ ...nt, audit: nt.audit })
      setLogs(res.data.logs ?? [])
      setLogAttachments(res.data.logAttachments ?? [])
      setLogProgress(minProgressAfterAppend(nt.progress))
      logForm.resetFields()
      clearPendingLogImages()
      msg.success('已保存操作记录')
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setLogSubmitting(false)
    }
  }

  const submitFinish = async () => {
    if (!detailId || !task) return
    if (!mtTaskHasAssignee(task)) {
      msg.warning('请先分配任务执行人')
      return
    }
    const text = finishNote.trim() || '任务已办结'
    setFinishSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('content', text)
      fd.append('mark_complete', 'true')
      const res = await axios.post<{
        task: MaintenanceTask
        logs: MaintenanceTaskLog[]
        logAttachments?: MaintenanceTaskLogAttachment[]
      }>(`/api/maintenance-tasks/${detailId}/logs`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const nt = res.data.task
      setTask({ ...nt, audit: nt.audit })
      setLogs(res.data.logs ?? [])
      setLogAttachments(res.data.logAttachments ?? [])
      setLogProgress(nt.progress)
      setFinishOpen(false)
      setFinishNote('')
      msg.success('任务已完结')
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '完结失败')
    } finally {
      setFinishSubmitting(false)
    }
  }

  const addPendingLogImage = useCallback((file: File) => {
    if (!mtLogActionsAllowed(task?.audit, task ?? null)) {
      msg.warning(
        !mtTaskHasAssignee(task)
          ? '请先分配任务执行人'
          : '须先在钉钉完成审批通过后，方可添加操作记录附图',
      )
      return
    }
    const err = validateLogImageFile(file)
    if (err) {
      msg.error(err)
      return
    }
    const previewUrl = URL.createObjectURL(file)
    setPendingLogImages((prev) => [...prev, { file, previewUrl }])
  }, [msg, task])

  const onLogContentPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (
        !detailId ||
        !task ||
        task.status === 'completed' ||
        task.status === 'cancelled' ||
        !mtLogActionsAllowed(task.audit, task)
      )
        return
      const cd = e.clipboardData
      if (!cd) return
      if (cd.files && cd.files.length > 0) {
        for (let i = 0; i < cd.files.length; i++) {
          const f = cd.files[i]
          if (f.type.startsWith('image/')) {
            e.preventDefault()
            addPendingLogImage(f)
            return
          }
        }
      }
      if (cd.items) {
        for (let i = 0; i < cd.items.length; i++) {
          const it = cd.items[i]
          if (it.kind === 'file' && it.type.startsWith('image/')) {
            const f = it.getAsFile()
            if (f) {
              e.preventDefault()
              addPendingLogImage(f)
              return
            }
          }
        }
      }
    },
    [addPendingLogImage, detailId, task],
  )

  const onLogContentDragOver = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      if (!detailId || !mtLogActionsAllowed(task?.audit, task ?? null)) return
      if (Array.from(e.dataTransfer.types ?? []).includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    },
    [detailId, task],
  )

  const onLogContentDrop = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      if (!detailId || !mtLogActionsAllowed(task?.audit, task ?? null)) return
      e.preventDefault()
      const list = e.dataTransfer.files
      if (!list?.length) return
      for (let i = 0; i < list.length; i++) {
        const f = list[i]
        if (f.type.startsWith('image/')) addPendingLogImage(f)
      }
    },
    [addPendingLogImage, detailId, task],
  )

  const beforeUploadLogImage = useCallback(
    (file: File) => {
      addPendingLogImage(file)
      return false
    },
    [addPendingLogImage],
  )

  const attachmentsByLogId = useMemo(() => {
    const m: Record<number, MaintenanceTaskLogAttachment[]> = {}
    for (const a of logAttachments) {
      if (!m[a.log_id]) m[a.log_id] = []
      m[a.log_id].push(a)
    }
    return m
  }, [logAttachments])

  const openLogAttachmentPreview = useCallback(
    async (logId: number, att: MaintenanceTaskLogAttachment) => {
      if (!detailId) return
      try {
        const res = await axios.get(
          `/api/maintenance-tasks/${detailId}/logs/${logId}/attachments/${att.id}/preview`,
          { responseType: 'blob' },
        )
        const url = URL.createObjectURL(res.data)
        setImgPreview((old) => {
          if (old?.url) URL.revokeObjectURL(old.url)
          return { url, name: att.file_name }
        })
        setImgPreviewOpen(true)
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '预览失败')
      }
    },
    [detailId, msg],
  )

  const downloadLogAttachment = useCallback(
    async (logId: number, att: MaintenanceTaskLogAttachment) => {
      if (!detailId) return
      try {
        const res = await axios.get(
          `/api/maintenance-tasks/${detailId}/logs/${logId}/attachments/${att.id}/file`,
          { responseType: 'blob' },
        )
        const url = URL.createObjectURL(res.data)
        const a = document.createElement('a')
        a.href = url
        a.download = att.file_name
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '下载失败')
      }
    },
    [detailId, msg],
  )

  const submitMtDingTalk = async (id: number, fromDrawer?: boolean) => {
    if (fromDrawer) setDrawerDingSubmitting(true)
    else setDingSubmittingId(id)
    try {
      await axios.post(`/api/maintenance-tasks/${id}/dingtalk/submit`)
      msg.success('已提交钉钉审批，请在钉钉中处理流程')
      if (fromDrawer && detailId === id) await loadDetail(id)
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '提交失败')
    } finally {
      setDingSubmittingId(null)
      setDrawerDingSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`/api/maintenance-tasks/${id}`)
      msg.success('已删除')
      if (detailId === id) {
        setDrawerOpen(false)
        setDetailId(null)
      }
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const canAddLog = Boolean(task && task.status !== 'completed' && task.status !== 'cancelled')

  const taskAssigneeDisplay = useMemo(() => {
    const a = task?.assignee?.trim()
    if (!a) return null
    return assigneeLabelMap(assignSelectOptions).get(a) ?? a
  }, [task?.assignee, assignSelectOptions])

  const columns: ColumnsType<MaintenanceTask> = [
    { title: '排单号', dataIndex: 'code', width: 130 },
    { title: '任务标题', dataIndex: 'title', ellipsis: true, width: 220 },
    {
      title: '类型',
      dataIndex: 'task_type',
      width: 100,
      render: (v: string) => TYPE_MAP[v] ?? v,
    },
    {
      title: '截止时间',
      dataIndex: 'due_at',
      width: 208,
      render: (v: string) => <DueCountdownCell dueAt={v} now={listNow} />,
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 140,
      render: (v: number) => <Progress percent={v} size="small" />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 96,
      render: (v: string) => {
        const s = STATUS_MAP[v] ?? { color: 'default', label: v }
        return <Tag color={s.color}>{s.label}</Tag>
      },
    },
    {
      title: '执行人',
      dataIndex: 'assignee',
      width: 120,
      ellipsis: true,
      render: (v: string | null) => (v?.trim() ? v : <Text type="secondary">待分配</Text>),
    },
    {
      title: '审批',
      key: 'audit',
      width: 100,
      render: (_: unknown, r: MaintenanceTask) => {
        const lab = mtAuditLabel(r.audit)
        return lab ? <Tag color={lab.color}>{lab.text}</Tag> : <Text type="secondary">—</Text>
      },
    },
    {
      title: '操作',
      width: 260,
      fixed: 'right',
      render: (_, r) => (
        <Space size="small" wrap>
          <a onClick={() => openDetail(r)}>办理</a>
          {mtDingSubmitAllowed(r.audit, r) ? (
            <a
              onClick={() => void submitMtDingTalk(r.id)}
              style={{ opacity: dingSubmittingId === r.id ? 0.5 : 1, pointerEvents: dingSubmittingId === r.id ? 'none' : undefined }}
            >
              {dingSubmittingId === r.id ? '提交中…' : '提交钉钉审批'}
            </a>
          ) : canSubmitMtDingTalk(r.audit) ? (
            <Tooltip title="请先在详情中分配执行人">
              <Text type="secondary">提交钉钉审批</Text>
            </Tooltip>
          ) : null}
          {canDeleteMtWithAudit(r.audit) ? (
            <Popconfirm title="确定删除该任务？" onConfirm={() => void handleDelete(r.id)}>
              <a style={{ color: 'var(--ant-colorError)' }}>删除</a>
            </Popconfirm>
          ) : (
            <Text type="secondary">删除</Text>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Card>
      <Space style={{ marginBottom: 16 }} wrap size="middle">
        <Title level={5} style={{ margin: 0 }}>
          <CalendarOutlined style={{ marginRight: 8 }} />
          维护排单
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          新建后须先在详情「分配任务」指定执行人，方可提交钉钉审批、填写操作记录与完结；执行人可随时「转派」。列表与详情会检测逾期；保存操作记录后已排单→执行中；完结仅能通过抽屉右上角「完结」。
        </Text>
        <Search
          placeholder="搜索排单号/标题/内容/执行人/截止时间"
          allowClear
          onSearch={setKeyword}
          style={{ width: 300 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建任务
        </Button>
      </Space>

      <Table
        rowKey="id"
        dataSource={list}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        size="middle"
        scroll={{ x: 1290 }}
      />

      <Modal
        title="新建维护任务"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={createSubmitting}
        destroyOnClose
        width={560}
      >
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请输入任务标题' }]}>
            <Input placeholder="简要概括" />
          </Form.Item>
          <Form.Item name="task_type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select options={TYPE_OPTIONS} placeholder="巡检 / 维修 / 维护等" />
          </Form.Item>
          <Form.Item
            name="due_at"
            label="截止时间"
            rules={[{ required: true, message: '请选择截止时间（精确到小时）' }]}
            extra="不可选今天之前的日期；选今天时不可选当前时刻之前的整点。"
          >
            <DatePicker
              disabledDate={dueAtDisabledDate}
              disabledTime={dueAtDisabledTime}
              defaultPickerValue={dayjs().hour(18).minute(0).second(0)}
              showTime={{
                format: 'HH',
                showSecond: false,
                disabledMinutes: () => Array.from({ length: 59 }, (_, i) => i + 1),
                disabledSeconds: () => Array.from({ length: 59 }, (_, i) => i + 1),
              }}
              format="YYYY-MM-DD HH:00"
              style={{ width: '100%' }}
              onChange={(d) => {
                if (!d) {
                  createForm.setFieldValue('due_at', null)
                  dueAtLastDayKeyRef.current = null
                  return
                }
                const dayKey = d.format('YYYY-MM-DD')
                const sameCalendarDay = dueAtLastDayKeyRef.current === dayKey
                dueAtLastDayKeyRef.current = dayKey
                const next = sameCalendarDay
                  ? d.startOf('hour')
                  : d.startOf('day').hour(18).minute(0).second(0).millisecond(0)
                createForm.setFieldValue('due_at', next)
              }}
            />
          </Form.Item>
          <Form.Item name="content" label="任务说明">
            <TextArea rows={3} placeholder="选填：范围、要求等" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={task ? `${task.code} · ${task.title}` : '任务详情'}
        open={drawerOpen}
        onClose={() => {
          closeImgPreview()
          clearPendingLogImages()
          setDrawerOpen(false)
          setDetailId(null)
        }}
        width="min(92vw, 1000px)"
        styles={{ body: { paddingTop: 24, paddingBottom: 32, paddingInline: 28 } }}
        destroyOnClose
        extra={
          task ? (
            <Space>
              {canSubmitMtDingTalk(task.audit) ? (
                <Tooltip title={!mtTaskHasAssignee(task) ? '请先在下方「分配任务」中选择执行人' : undefined}>
                  <Button
                    loading={drawerDingSubmitting}
                    disabled={!mtTaskHasAssignee(task)}
                    onClick={() => void submitMtDingTalk(task.id, true)}
                  >
                    提交钉钉审批
                  </Button>
                </Tooltip>
              ) : null}
              {canAddLog && mtOpsUnlocked(task.audit) ? (
                <Tooltip title={!mtTaskHasAssignee(task) ? '请先在下方「分配任务」中选择执行人' : undefined}>
                  <Button type="primary" disabled={!mtTaskHasAssignee(task)} onClick={() => setFinishOpen(true)}>
                    完结
                  </Button>
                </Tooltip>
              ) : null}
            </Space>
          ) : null
        }
      >
        <Spin spinning={detailLoading}>
          {task && (
            <>
              {task.audit?.dingtalk_gate && !mtOpsUnlocked(task.audit) ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="已启用钉钉审批"
                  description="须已分配执行人；审批通过后方可追加操作记录、附图与点击「完结」。请在列表或上方提交钉钉流程。"
                />
              ) : null}
              {canAddLog && !mtTaskHasAssignee(task) ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="请先分配任务"
                  description="在下方选择执行人并确认后，方可提交钉钉审批、填写操作记录与完结。"
                />
              ) : null}
              {canAssignOrReassignMt(task, task.audit) ? (
                <Card
                  size="small"
                  title={mtTaskHasAssignee(task) ? '转派任务' : '分配任务'}
                  style={{ marginBottom: 24 }}
                  extra={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {mtTaskHasAssignee(task) ? '将任务改派给其他执行人' : '新建后须先指定执行人'}
                    </Text>
                  }
                >
                  <Form form={assignForm} layout="vertical" style={{ maxWidth: 420 }}>
                    <Form.Item
                      name="assignee"
                      label="执行人"
                      rules={[{ required: true, message: '请选择执行人' }]}
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="在职系统用户"
                        options={assignSelectOptions}
                        loading={assigneeUsersLoading}
                      />
                    </Form.Item>
                    <Button type="primary" loading={assignSubmitting} onClick={() => void submitAssign()}>
                      {mtTaskHasAssignee(task) ? '确认转派' : '确认分配'}
                    </Button>
                  </Form>
                </Card>
              ) : null}
              <Descriptions
                bordered
                size="middle"
                column={2}
                style={{ marginBottom: 24 }}
                labelStyle={{ minWidth: 120, width: 120, whiteSpace: 'nowrap', verticalAlign: 'top' }}
                contentStyle={{ minWidth: 0, wordBreak: 'break-word', verticalAlign: 'top' }}
              >
                <Descriptions.Item label="状态">
                  <Tag color={STATUS_MAP[task.status]?.color}>{STATUS_MAP[task.status]?.label}</Tag>
                </Descriptions.Item>
                {task.audit?.dingtalk_gate ? (
                  <Descriptions.Item label="钉钉审批">
                    {(() => {
                      const lab = mtAuditLabel(task.audit)
                      return lab ? <Tag color={lab.color}>{lab.text}</Tag> : '—'
                    })()}
                  </Descriptions.Item>
                ) : null}
                <Descriptions.Item label="类型">{TYPE_MAP[task.task_type] ?? task.task_type}</Descriptions.Item>
                <Descriptions.Item label="截止时间">{task.due_at}</Descriptions.Item>
                <Descriptions.Item label="进度">
                  <Progress percent={task.progress} size="small" />
                </Descriptions.Item>
                <Descriptions.Item label="执行人">
                  {taskAssigneeDisplay ?? <Text type="secondary">待分配</Text>}
                </Descriptions.Item>
                <Descriptions.Item label="创建时间">{task.created_at}</Descriptions.Item>
                <Descriptions.Item label="任务说明" span={2}>
                  {task.content ? (
                    <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{task.content}</Paragraph>
                  ) : (
                    '—'
                  )}
                </Descriptions.Item>
              </Descriptions>

              <Title level={5}>操作记录</Title>
              <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                含系统自动产生的逾期记录；每次保存会追加一条操作记录并可能更新状态；进度须较当前至少提高 10%（上限 100%）。
              </Text>
              {logs.length === 0 ? (
                <Text type="secondary">暂无记录</Text>
              ) : (
                <Timeline style={{ marginBottom: 24 }}>
                  {logs.map((log) => {
                    const atts = attachmentsByLogId[log.id] ?? []
                    const logColor =
                      log.action === 'auto_overdue'
                        ? 'red'
                        : log.action === 'assign'
                          ? 'green'
                          : log.action === 'reassign'
                            ? 'cyan'
                            : 'blue'
                    return (
                      <Timeline.Item key={log.id} color={logColor}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {log.created_at} {formatLogLine(log)}
                          {log.progress_after != null ? ` · 进度 ${log.progress_after}%` : ''}
                        </Text>
                        <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{log.content}</div>
                        {atts.length > 0 ? (
                          <Space size="small" wrap style={{ marginTop: 8 }}>
                            {atts.map((att) => (
                              <Space key={att.id} size={4}>
                                <Button
                                  type="link"
                                  size="small"
                                  icon={<EyeOutlined />}
                                  onClick={() => void openLogAttachmentPreview(log.id, att)}
                                >
                                  {att.file_name}
                                </Button>
                                <Button
                                  type="link"
                                  size="small"
                                  icon={<DownloadOutlined />}
                                  onClick={() => void downloadLogAttachment(log.id, att)}
                                >
                                  下载
                                </Button>
                              </Space>
                            ))}
                          </Space>
                        ) : null}
                      </Timeline.Item>
                    )
                  })}
                </Timeline>
              )}

              {canAddLog ? (
                <Card size="small" title="追加操作记录">
                  <Form form={logForm} layout="vertical">
                    <Form.Item
                      name="log_content"
                      label="说明"
                      extra="可在说明框内 Ctrl+V 粘贴截图，或拖入图片；也可使用下方「上传图片」。保存时一并提交。"
                      rules={[{ required: true, message: '请填写操作说明' }]}
                    >
                      <TextArea
                        rows={4}
                        placeholder="现场情况、处理动作、协调结果等；可在此框粘贴或拖入图片"
                        onPaste={onLogContentPaste}
                        onDragOver={onLogContentDragOver}
                        onDrop={onLogContentDrop}
                        disabled={!mtLogActionsAllowed(task.audit, task)}
                      />
                    </Form.Item>
                    <Form.Item label="附图（选填）">
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        <Upload
                          accept={LOG_IMAGE_ACCEPT}
                          showUploadList={false}
                          beforeUpload={beforeUploadLogImage}
                          disabled={!mtLogActionsAllowed(task.audit, task)}
                        >
                          <Button icon={<UploadOutlined />} disabled={!mtLogActionsAllowed(task.audit, task)}>
                            上传图片
                          </Button>
                        </Upload>
                        {pendingLogImages.length > 0 ? (
                          <Space wrap size="small">
                            {pendingLogImages.map((it, idx) => (
                              <span key={it.previewUrl} style={{ position: 'relative', display: 'inline-block' }}>
                                <img
                                  src={it.previewUrl}
                                  alt=""
                                  style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--ant-colorBorder)' }}
                                />
                                <Button
                                  type="text"
                                  danger
                                  size="small"
                                  style={{ position: 'absolute', top: -6, right: -6 }}
                                  disabled={!mtLogActionsAllowed(task.audit, task)}
                                  onClick={() => {
                                    URL.revokeObjectURL(it.previewUrl)
                                    setPendingLogImages((prev) => prev.filter((_, i) => i !== idx))
                                  }}
                                >
                                  ×
                                </Button>
                              </span>
                            ))}
                          </Space>
                        ) : null}
                      </Space>
                    </Form.Item>
                    <Form.Item
                      label="更新进度（%）"
                      extra="滑块范围为 0～100%；打开或保存后会自动定位到「当前进度 +10%」（上限 100%），可手动拖到任意位置；保存时仍须较任务当前进度至少提高 10%。"
                    >
                      <Slider
                        min={0}
                        max={100}
                        value={logProgress}
                        onChange={setLogProgress}
                        marks={{ 0: '0', 100: '100' }}
                        disabled={!mtLogActionsAllowed(task.audit, task)}
                      />
                    </Form.Item>
                    <Button
                      type="primary"
                      loading={logSubmitting}
                      onClick={submitLog}
                      icon={<SendOutlined />}
                      disabled={!mtLogActionsAllowed(task.audit, task)}
                    >
                      保存记录
                    </Button>
                  </Form>
                </Card>
              ) : null}
            </>
          )}
        </Spin>
      </Drawer>

      <Modal
        title="确认完结"
        open={finishOpen}
        onCancel={() => {
          setFinishOpen(false)
          setFinishNote('')
        }}
        onOk={() => void submitFinish()}
        confirmLoading={finishSubmitting}
        okText="确认完结"
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          完结后任务状态将变为「已完成」，进度记为 100%。可填写办结说明（留空则使用默认文案）。
        </Text>
        <TextArea rows={4} value={finishNote} onChange={(e) => setFinishNote(e.target.value)} placeholder="办结说明（可选）" />
      </Modal>

      <Modal
        title={imgPreview?.name ?? '图片预览'}
        open={imgPreviewOpen}
        onCancel={closeImgPreview}
        footer={null}
        width={720}
        destroyOnClose
      >
        {imgPreview?.url ? (
          <img
            src={imgPreview.url}
            alt={imgPreview.name}
            style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto', objectFit: 'contain' }}
          />
        ) : null}
      </Modal>
    </Card>
  )
}

export default MaintenanceSchedulePage
