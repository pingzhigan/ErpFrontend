/**
 * 维护管理 - 维护排单
 * 新建后须在详情「分配任务」指定执行人（可「转派」）；可按日补充施工人员（与零星工程一致）；再提交钉钉审批、填写操作记录与完结；操作记录可粘贴/拖入图片；进度每次至少 +10%；记录保存后已排单→执行中；完结仅抽屉「完结」。
 */
import {
  CalendarOutlined,
  DownloadOutlined,
  EyeOutlined,
  PlusOutlined,
  SendOutlined,
  SettingOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import type { ColumnType, ColumnsType } from 'antd/es/table'
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Popover,
  Progress,
  Radio,
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
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DueCountdownCell, useNowEverySecond } from '../components/DueCountdownCell'
import { auditGateAllowsEditWhenNotApproving } from '../utils/auditGateUi'
import {
  assigneeLabelMap,
  buildConstructionAssigneeOptions,
  type AssigneeInactiveRef,
  type AssigneeUserRow,
} from '../utils/constructionAssigneeOptions'
import { parseDueAtHourPickerValue } from '../utils/dueAtHourPickerParse'

const { Title, Text, Paragraph } = Typography
const { Search } = Input
const { TextArea } = Input

type MaintenanceTaskStatus = 'scheduled' | 'in_progress' | 'overdue' | 'completed' | 'cancelled'
type TaskType = 'inspect' | 'repair' | 'maintain' | 'routine'

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
  return auditGateAllowsEditWhenNotApproving(audit)
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
  /** 各施工日人员并集（后端维护） */
  construction_workers?: string[]
}

type MtWorkerPeriod = 'half_day' | 'full_day' | 'overtime'

type MaintenanceTaskWorkerDayRow = {
  id: number
  work_date: string
  construction_workers: string[]
  work_period: MtWorkerPeriod | string
}

/** 与 PUT /api/maintenance-tasks/:id 一致：已完成/已取消不可改；审批中不可改 */
function canEditMtBasicInfo(t: MaintenanceTask): boolean {
  if (t.status === 'completed' || t.status === 'cancelled') return false
  return auditGateAllowsEditWhenNotApproving(t.audit)
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

/** 按日施工人员：与基本信息编辑相同门禁 */
function canEditMtWorkerDays(t: MaintenanceTask): boolean {
  if (t.status === 'completed' || t.status === 'cancelled') return false
  return auditGateAllowsEditWhenNotApproving(t.audit)
}

/** 无按日表数据时，用任务汇总施工人员合成一行，供抽屉/完结预览只读展示 */
function buildMtWorkerDayRowsFromTaskUnion(t: MaintenanceTask): MaintenanceTaskWorkerDayRow[] {
  const cw = (t.construction_workers ?? []).map((x) => String(x).trim()).filter(Boolean)
  if (cw.length === 0) return []
  const raw = String(t.created_at ?? '').trim().replace('T', ' ').slice(0, 10)
  const workDate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : dayjs().format('YYYY-MM-DD')
  return [{ id: -1, work_date: workDate, construction_workers: cw, work_period: 'full_day' }]
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

/** 列表缩略图只需较小边长；大图仍按完整分辨率解码会导致界面卡顿 */
const LOG_PREVIEW_MAX_EDGE = 720
/** 超限的长边会先缩小再提交，减轻上传与后端压力 */
const LOG_UPLOAD_MAX_EDGE = 3840

function loadImageFromObjectUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load'))
    img.src = url
  })
}

/**
 * 生成「小预览 blob URL」并在边过长时缩小待上传文件，避免超大分辨率图片拖慢主线程。
 */
async function prepareLogImageFile(file: File): Promise<{ file: File; previewUrl: string }> {
  const srcUrl = URL.createObjectURL(file)
  try {
    const img = await loadImageFromObjectUrl(srcUrl)
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) {
      throw new Error('无法读取图片')
    }

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return { file, previewUrl: srcUrl }
    }

    const maxDim = Math.max(w, h)
    let outFile = file

    if (maxDim > LOG_UPLOAD_MAX_EDGE) {
      const s = LOG_UPLOAD_MAX_EDGE / maxDim
      const uW = Math.max(1, Math.round(w * s))
      const uH = Math.max(1, Math.round(h * s))
      canvas.width = uW
      canvas.height = uH
      ctx.drawImage(img, 0, 0, uW, uH)
      const upBlob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92))
      if (upBlob) {
        const base = file.name.replace(/\.[^.]+$/, '') || 'image'
        outFile = new File([upBlob], `${base}.jpg`, { type: 'image/jpeg' })
      }
    }

    const previewScale = Math.min(1, LOG_PREVIEW_MAX_EDGE / maxDim)
    const pW = Math.max(1, Math.round(w * previewScale))
    const pH = Math.max(1, Math.round(h * previewScale))
    canvas.width = pW
    canvas.height = pH
    ctx.drawImage(img, 0, 0, pW, pH)
    const previewBlob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88))

    URL.revokeObjectURL(srcUrl)

    let previewUrl: string
    if (previewBlob) {
      previewUrl = URL.createObjectURL(previewBlob)
    } else {
      previewUrl = URL.createObjectURL(outFile)
    }

    const again = validateLogImageFile(outFile)
    if (again) {
      URL.revokeObjectURL(previewUrl)
      throw new Error(again)
    }

    return { file: outFile, previewUrl }
  } catch (e) {
    URL.revokeObjectURL(srcUrl)
    throw e instanceof Error ? e : new Error('处理图片失败')
  }
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
  routine: '其他任务',
  /** 历史数据：展示与 routine 相同 */
  upgrade: '其他任务',
}

const TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: 'inspect', label: '巡检' },
  { value: 'maintain', label: '维护' },
  { value: 'repair', label: '维修' },
  { value: 'routine', label: '其他任务' },
]

const VALID_MAINTENANCE_TASK_TYPES = new Set<string>(TYPE_OPTIONS.map((o) => o.value))

function normalizeTaskTypeForForm(raw: string): TaskType {
  const t = String(raw ?? '').trim()
  if (t === 'upgrade') return 'routine'
  if (VALID_MAINTENANCE_TASK_TYPES.has(t)) return t as TaskType
  return 'inspect'
}

const LOG_ACTION_LABEL: Record<string, string> = {
  note: '记录',
  start: '开始执行',
  progress: '更新进度',
  complete: '完成',
  auto_overdue: '逾期（自动）',
  assign: '分配任务',
  reassign: '转派',
  worker_day: '按日施工人员',
}

function normalizeMtWorkerPeriodUi(p: string | undefined | null): MtWorkerPeriod {
  const s = String(p ?? '').trim()
  if (s === 'half_day' || s === 'full_day' || s === 'overtime') return s
  return 'full_day'
}

function mtWorkerPeriodTagEl(period: string | undefined | null) {
  const p = normalizeMtWorkerPeriodUi(period)
  if (p === 'half_day') return <Tag>半天</Tag>
  if (p === 'overtime') return <Tag color="purple">加班</Tag>
  return <Tag color="blue">整天</Tag>
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

/** 操作记录附图：鉴权拉取预览 blob 作缩略图，点击缩略图或「预览」打开大图 Modal */
const LogAttachmentRow: React.FC<{
  taskId: number
  logId: number
  att: MaintenanceTaskLogAttachment
  onOpenPreview: (logId: number, att: MaintenanceTaskLogAttachment) => void
  onDownload: (logId: number, att: MaintenanceTaskLogAttachment) => void
}> = ({ taskId, logId, att, onOpenPreview, onDownload }) => {
  const urlRef = useRef<string | null>(null)
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void axios
      .get(`/api/maintenance-tasks/${taskId}/logs/${logId}/attachments/${att.id}/preview`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        const u = URL.createObjectURL(res.data)
        urlRef.current = u
        setThumbUrl(u)
      })
      .catch(() => {
        if (!cancelled) setThumbUrl(null)
      })
    return () => {
      cancelled = true
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [taskId, logId, att.id])
  return (
    <Space align="start" size={10} style={{ maxWidth: 360 }}>
      <button
        type="button"
        onClick={() => void onOpenPreview(logId, att)}
        title="大图预览"
        style={{
          border: '1px solid var(--ant-colorBorder)',
          borderRadius: 6,
          padding: 0,
          cursor: 'pointer',
          background: 'var(--ant-colorFillAlter)',
          flexShrink: 0,
        }}
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt="" style={{ width: 72, height: 72, objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: 72, height: 72, background: 'var(--ant-colorFillSecondary)' }} />
        )}
      </button>
      <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
        <Text ellipsis style={{ fontSize: 12, maxWidth: 240 }} title={att.file_name}>
          {att.file_name}
        </Text>
        <Space size={4}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => void onOpenPreview(logId, att)}>
            预览
          </Button>
          <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => void onDownload(logId, att)}>
            下载
          </Button>
        </Space>
      </Space>
    </Space>
  )
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

type MtListColKey =
  | 'code'
  | 'title'
  | 'task_type'
  | 'due_at'
  | 'progress'
  | 'status'
  | 'assignee'
  | 'construction_workers'
  | 'audit'

const MT_LIST_COL_ORDER: MtListColKey[] = [
  'code',
  'title',
  'task_type',
  'due_at',
  'progress',
  'status',
  'assignee',
  'construction_workers',
  'audit',
]

/** 列表列显示（不含「操作」，操作列始终展示）；持久化 localStorage */
const MT_LIST_COLS_LS = 'maintenance_task.list.columns.v1'

const MT_LIST_COL_LABEL: Record<MtListColKey, string> = {
  code: '排单号',
  title: '任务标题',
  task_type: '类型',
  due_at: '截止时间',
  progress: '进度',
  status: '状态',
  assignee: '执行人',
  construction_workers: '施工人员',
  audit: '审批',
}

const MT_LIST_COL_WIDTH: Record<MtListColKey, number> = {
  code: 130,
  title: 220,
  task_type: 100,
  due_at: 208,
  progress: 140,
  status: 96,
  assignee: 120,
  construction_workers: 140,
  audit: 100,
}

function defaultMtListColVisibility(): Record<MtListColKey, boolean> {
  return Object.fromEntries(MT_LIST_COL_ORDER.map((k) => [k, true])) as Record<MtListColKey, boolean>
}

function loadMtListColVisibility(): Record<MtListColKey, boolean> {
  const allOn = defaultMtListColVisibility()
  try {
    const raw = localStorage.getItem(MT_LIST_COLS_LS)
    if (!raw?.trim()) return allOn
    const p = JSON.parse(raw) as unknown
    if (!p || typeof p !== 'object') return allOn
    const o = p as Record<string, unknown>
    const out = { ...allOn }
    for (const k of MT_LIST_COL_ORDER) {
      if (typeof o[k] === 'boolean') out[k] = o[k] as boolean
    }
    return out
  } catch {
    return allOn
  }
}

function auditSortKey(audit: GateAudit | undefined): string {
  if (!audit?.dingtalk_gate) return '0'
  const st = audit.audit_status
  const oc = audit.audit_outcome ?? ''
  return `${st}\t${oc}`
}

function compareMtListRows(a: MaintenanceTask, b: MaintenanceTask, k: MtListColKey): number {
  switch (k) {
    case 'code':
      return String(a.code ?? '').localeCompare(String(b.code ?? ''), 'zh-CN')
    case 'title':
      return String(a.title ?? '').localeCompare(String(b.title ?? ''), 'zh-CN')
    case 'task_type': {
      const la = TYPE_MAP[String(a.task_type)] ?? String(a.task_type)
      const lb = TYPE_MAP[String(b.task_type)] ?? String(b.task_type)
      return la.localeCompare(lb, 'zh-CN')
    }
    case 'due_at':
      return String(a.due_at ?? '').localeCompare(String(b.due_at ?? ''), 'zh-CN')
    case 'progress':
      return (Number(a.progress) || 0) - (Number(b.progress) || 0)
    case 'status': {
      const la = STATUS_MAP[a.status]?.label ?? a.status
      const lb = STATUS_MAP[b.status]?.label ?? b.status
      return la.localeCompare(lb, 'zh-CN')
    }
    case 'assignee': {
      const sa = sanitizeNullableText(a.assignee) ?? ''
      const sb = sanitizeNullableText(b.assignee) ?? ''
      return sa.localeCompare(sb, 'zh-CN')
    }
    case 'construction_workers': {
      const sa = [...(a.construction_workers ?? [])].sort((x, y) => x.localeCompare(y, 'zh-CN')).join('\u0001')
      const sb = [...(b.construction_workers ?? [])].sort((x, y) => x.localeCompare(y, 'zh-CN')).join('\u0001')
      return sa.localeCompare(sb, 'zh-CN')
    }
    case 'audit':
      return auditSortKey(a.audit).localeCompare(auditSortKey(b.audit), 'zh-CN')
    default:
      return 0
  }
}

function sanitizeNullableText(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const l = s.toLowerCase()
  if (l === 'null' || l === 'undefined') return null
  return s
}

function formatDueAtText(v: string | null | undefined): string {
  const s = sanitizeNullableText(v)
  if (!s) return '—'
  const d = dayjs(s)
  return d.isValid() ? s : '—'
}

/**
 * 列表单独订阅 useNowEverySecond，避免每秒刷新整个页面（含办理 Drawer），造成抽屉内滚动卡顿。
 */
const MaintenanceScheduleListTable = memo(function MaintenanceScheduleListTable({
  list,
  loading,
  openDetail,
  onEditClick,
  onSubmitDingTalk,
  onDelete,
  dingSubmittingId,
  assigneeDisplayMap,
  userRealNameOnlyMap,
  listSort,
  onListSortChange,
  listColVisibility,
  listTableScrollX,
}: {
  list: MaintenanceTask[]
  loading: boolean
  openDetail: (r: MaintenanceTask) => void
  onEditClick: (r: MaintenanceTask) => void
  onSubmitDingTalk: (id: number) => void | Promise<void>
  onDelete: (id: number) => void | Promise<void>
  dingSubmittingId: number | null
  assigneeDisplayMap: Map<string, string>
  userRealNameOnlyMap: Map<string, string>
  listSort: { columnKey: MtListColKey; order: 'ascend' | 'descend' } | null
  onListSortChange: (sorter: {
    columnKey?: React.Key | null
    order?: 'ascend' | 'descend' | null
  }) => void
  listColVisibility: Record<MtListColKey, boolean>
  listTableScrollX: number
}) {
  const listNow = useNowEverySecond()
  const withSort = useCallback(
    (k: MtListColKey, col: ColumnType<MaintenanceTask>): ColumnType<MaintenanceTask> => ({
      ...col,
      key: k,
      showSorterTooltip: { title: '点击切换升序 / 降序' },
      sorter: (a: MaintenanceTask, b: MaintenanceTask) => compareMtListRows(a, b, k),
      sortOrder: listSort?.columnKey === k ? listSort.order : undefined,
    }),
    [listSort],
  )

  const columns: ColumnsType<MaintenanceTask> = useMemo(() => {
    const dataColsOrdered: { key: MtListColKey; col: ColumnType<MaintenanceTask> }[] = [
      { key: 'code', col: { title: '排单号', dataIndex: 'code', width: MT_LIST_COL_WIDTH.code } },
      {
        key: 'title',
        col: { title: '任务标题', dataIndex: 'title', ellipsis: true, width: MT_LIST_COL_WIDTH.title },
      },
      {
        key: 'task_type',
        col: {
          title: '类型',
          dataIndex: 'task_type',
          width: MT_LIST_COL_WIDTH.task_type,
          render: (v: string) => TYPE_MAP[v] ?? v,
        },
      },
      {
        key: 'due_at',
        col: {
          title: '截止时间',
          dataIndex: 'due_at',
          width: MT_LIST_COL_WIDTH.due_at,
          render: (v: string, r: MaintenanceTask) =>
            r.status === 'completed' ? formatDueAtText(v) : <DueCountdownCell dueAt={v} now={listNow} />,
        },
      },
      {
        key: 'progress',
        col: {
          title: '进度',
          dataIndex: 'progress',
          width: MT_LIST_COL_WIDTH.progress,
          render: (v: number) => <Progress percent={v} size="small" />,
        },
      },
      {
        key: 'status',
        col: {
          title: '状态',
          dataIndex: 'status',
          width: MT_LIST_COL_WIDTH.status,
          render: (v: string) => {
            const s = STATUS_MAP[v] ?? { color: 'default', label: v }
            return <Tag color={s.color}>{s.label}</Tag>
          },
        },
      },
      {
        key: 'assignee',
        col: {
          title: '执行人',
          dataIndex: 'assignee',
          width: MT_LIST_COL_WIDTH.assignee,
          ellipsis: true,
          render: (v: string | null) => {
            const username = sanitizeNullableText(v)
            if (!username) return <Text type="secondary">待分配</Text>
            return assigneeDisplayMap.get(username) ?? username
          },
        },
      },
      {
        key: 'construction_workers',
        col: {
          title: '施工人员',
          width: MT_LIST_COL_WIDTH.construction_workers,
          ellipsis: true,
          render: (_: unknown, r: MaintenanceTask) => {
            const arr = r.construction_workers ?? []
            if (!arr.length) return <Text type="secondary">—</Text>
            return arr.map((u) => userRealNameOnlyMap.get(u) ?? u).join('、')
          },
        },
      },
      {
        key: 'audit',
        col: {
          title: '审批',
          key: 'audit',
          width: MT_LIST_COL_WIDTH.audit,
          render: (_: unknown, r: MaintenanceTask) => {
            const lab = mtAuditLabel(r.audit)
            return lab ? <Tag color={lab.color}>{lab.text}</Tag> : <Text type="secondary">—</Text>
          },
        },
      },
    ]

    const actionCol: ColumnType<MaintenanceTask> = {
      title: '操作',
      width: 198,
      fixed: 'right',
      render: (_, r) => (
        <Space size={[4, 4]} wrap>
          <a onClick={() => openDetail(r)}>办理</a>
          {canEditMtBasicInfo(r) ? (
            <a
              onClick={() => {
                onEditClick(r)
              }}
            >
              编辑
            </a>
          ) : null}
          {mtDingSubmitAllowed(r.audit, r) ? (
            <a
              onClick={() => void onSubmitDingTalk(r.id)}
              style={{
                opacity: dingSubmittingId === r.id ? 0.5 : 1,
                pointerEvents: dingSubmittingId === r.id ? 'none' : undefined,
              }}
            >
              {dingSubmittingId === r.id ? '提交中…' : '提交钉钉审批'}
            </a>
          ) : canSubmitMtDingTalk(r.audit) ? (
            <Tooltip title="请先在详情中分配执行人">
              <Text type="secondary">提交钉钉审批</Text>
            </Tooltip>
          ) : null}
          {canDeleteMtWithAudit(r.audit) ? (
            <Popconfirm title="确定删除该任务？" onConfirm={() => void onDelete(r.id)}>
              <a style={{ color: 'var(--ant-colorError)' }}>删除</a>
            </Popconfirm>
          ) : (
            <Text type="secondary">删除</Text>
          )}
        </Space>
      ),
    }

    return [
      ...dataColsOrdered.filter((d) => listColVisibility[d.key]).map((d) => withSort(d.key, d.col)),
      actionCol,
    ]
  }, [
    listNow,
    listColVisibility,
    openDetail,
    onEditClick,
    onSubmitDingTalk,
    onDelete,
    dingSubmittingId,
    assigneeDisplayMap,
    userRealNameOnlyMap,
    withSort,
  ])

  return (
    <Table
      rowKey="id"
      dataSource={list}
      columns={columns}
      loading={loading}
      pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
      size="middle"
      scroll={{ x: listTableScrollX }}
      sortDirections={['ascend', 'descend']}
      onChange={(_pagination, _filters, sorter) => {
        const s = Array.isArray(sorter) ? sorter[0] : sorter
        onListSortChange({ columnKey: s?.columnKey, order: s?.order ?? null })
      }}
    />
  )
})

/** 办理抽屉分区：浅色底 + 边框，便于与抽屉底色区分 */
const mtDrawerSectionShell: React.CSSProperties = {
  marginBottom: 22,
  padding: 16,
  borderRadius: 10,
  background: 'var(--ant-color-fill-quaternary, rgba(0, 0, 0, 0.02))',
  border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
}

const mtDrawerSectionHeading: React.CSSProperties = {
  marginBottom: 14,
  paddingBottom: 10,
  borderBottom: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
}

const MaintenanceSchedulePage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<MaintenanceTask[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm] = Form.useForm()
  const dueAtLastDayKeyRef = useRef<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<MaintenanceTask | null>(null)
  const [editForm] = Form.useForm()
  const editDueAtLastDayKeyRef = useRef<string | null>(null)
  const editRecordRef = useRef<MaintenanceTask | null>(null)
  const [editSubmitting, setEditSubmitting] = useState(false)
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
  const [finishPreviewRows, setFinishPreviewRows] = useState<MaintenanceTaskWorkerDayRow[]>([])
  const [finishPreviewLoading, setFinishPreviewLoading] = useState(false)
  const [finishPreviewFromDaily, setFinishPreviewFromDaily] = useState(true)

  const [imgPreviewOpen, setImgPreviewOpen] = useState(false)
  const [imgPreview, setImgPreview] = useState<{ url: string; name: string } | null>(null)
  const [dingSubmittingId, setDingSubmittingId] = useState<number | null>(null)
  const [drawerDingSubmitting, setDrawerDingSubmitting] = useState(false)

  const [assignForm] = Form.useForm()
  const [assignSubmitting, setAssignSubmitting] = useState(false)
  const [assigneeUserRows, setAssigneeUserRows] = useState<AssigneeUserRow[]>([])
  const [assigneeInactiveRef, setAssigneeInactiveRef] = useState<AssigneeInactiveRef[]>([])
  const [assigneeUsersLoading, setAssigneeUsersLoading] = useState(false)
  const [constructionWorkerRows, setConstructionWorkerRows] = useState<AssigneeUserRow[]>([])

  const [listSort, setListSort] = useState<{ columnKey: MtListColKey; order: 'ascend' | 'descend' } | null>(null)
  const [listColVisibility, setListColVisibility] = useState(loadMtListColVisibility)

  const [workerDays, setWorkerDays] = useState<MaintenanceTaskWorkerDayRow[]>([])
  const [workerDayForm] = Form.useForm()
  const [workerDaySubmitting, setWorkerDaySubmitting] = useState(false)

  const workerDaysRef = useRef(workerDays)
  workerDaysRef.current = workerDays
  const taskRef = useRef(task)
  taskRef.current = task

  const assignSelectOptions = useMemo(
    () => buildConstructionAssigneeOptions(assigneeUserRows, assigneeInactiveRef),
    [assigneeUserRows, assigneeInactiveRef],
  )
  const assigneeDisplayMap = useMemo(() => assigneeLabelMap(assignSelectOptions), [assignSelectOptions])

  const constructionWorkerSelectOptions = useMemo(
    () => buildConstructionAssigneeOptions(constructionWorkerRows, []),
    [constructionWorkerRows],
  )

  const userRealNameOnlyMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of assigneeUserRows) {
      const rn = r.real_name?.trim()
      if (rn) m.set(r.username, rn)
    }
    for (const r of constructionWorkerRows) {
      const rn = r.real_name?.trim()
      if (rn) m.set(r.username, rn)
    }
    return m
  }, [assigneeUserRows, constructionWorkerRows])

  const listTableScrollX = useMemo(() => {
    let w = 198
    for (const k of MT_LIST_COL_ORDER) {
      if (listColVisibility[k]) w += MT_LIST_COL_WIDTH[k]
    }
    return Math.max(w, 640)
  }, [listColVisibility])

  const updateListColVisibility = useCallback((key: MtListColKey, checked: boolean) => {
    setListColVisibility((prev) => {
      const next = { ...prev, [key]: checked }
      try {
        localStorage.setItem(MT_LIST_COLS_LS, JSON.stringify(next))
      } catch {
        /* 忽略存储失败 */
      }
      return next
    })
  }, [])

  const resetListColVisibility = useCallback(() => {
    const next = defaultMtListColVisibility()
    setListColVisibility(next)
    try {
      localStorage.setItem(MT_LIST_COLS_LS, JSON.stringify(next))
    } catch {
      /* 忽略 */
    }
  }, [])

  useEffect(() => {
    if (listSort && !listColVisibility[listSort.columnKey]) {
      setListSort(null)
    }
  }, [listColVisibility, listSort])

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

  const filteredList = useMemo(() => {
    if (!listSort) return list
    const dir = listSort.order === 'ascend' ? 1 : -1
    return [...list].sort((a, b) => dir * compareMtListRows(a, b, listSort.columnKey))
  }, [list, listSort])

  const handleListSorterChange = useCallback(
    (s: { columnKey?: React.Key | null; order?: 'ascend' | 'descend' | null }) => {
      const ck = s?.columnKey
      const ord = s?.order
      if (
        typeof ck === 'string' &&
        MT_LIST_COL_ORDER.includes(ck as MtListColKey) &&
        (ord === 'ascend' || ord === 'descend')
      ) {
        setListSort({ columnKey: ck as MtListColKey, order: ord })
      } else {
        setListSort(null)
      }
    },
    [],
  )

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

  const fillEditFormFromRecord = useCallback(
    (rec: MaintenanceTask) => {
      const d = parseDueAtHourPickerValue(rec.due_at)
      const tt = String(rec.task_type)
      editForm.setFieldsValue({
        title: rec.title,
        task_type: normalizeTaskTypeForForm(tt),
        due_at: d,
        content: rec.content ?? '',
      })
      editDueAtLastDayKeyRef.current = d ? d.format('YYYY-MM-DD') : null
    },
    [editForm],
  )

  useEffect(() => {
    let cancelled = false
    setAssigneeUsersLoading(true)
    void axios
      .get<{
        list: AssigneeUserRow[]
        inactive_referenced?: AssigneeInactiveRef[]
        construction_worker_user_options?: AssigneeUserRow[]
      }>('/api/maintenance-tasks/assignee-user-options')
      .then((res) => {
        if (cancelled) return
        setAssigneeUserRows(res.data?.list ?? [])
        setAssigneeInactiveRef(res.data?.inactive_referenced ?? [])
        setConstructionWorkerRows(res.data?.construction_worker_user_options ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setAssigneeUserRows([])
        setAssigneeInactiveRef([])
        setConstructionWorkerRows([])
      })
      .finally(() => {
        if (!cancelled) setAssigneeUsersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true)
      try {
        const res = await axios.get<{
          task: MaintenanceTask
          logs: MaintenanceTaskLog[]
          logAttachments?: MaintenanceTaskLogAttachment[]
          audit?: GateAudit
          worker_days?: MaintenanceTaskWorkerDayRow[]
        }>(`/api/maintenance-tasks/${id}`)
        setTask({ ...res.data.task, audit: res.data.audit })
        setLogs(res.data.logs ?? [])
        setLogAttachments(res.data.logAttachments ?? [])
        setWorkerDays(Array.isArray(res.data.worker_days) ? res.data.worker_days : [])
        const t = res.data.task
        setLogProgress(minProgressAfterAppend(t.progress))
        logForm.resetFields()
        assignForm.setFieldsValue({ assignee: t.assignee?.trim() || undefined })
        workerDayForm.setFieldsValue({
          work_date: dayjs(),
          construction_workers: [],
          work_period: 'full_day',
          worker_day_id: undefined,
        })
        clearPendingLogImages()
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载详情失败')
      } finally {
        setDetailLoading(false)
      }
    },
    [assignForm, clearPendingLogImages, logForm, msg, workerDayForm],
  )

  useEffect(() => {
    if (drawerOpen && detailId != null) {
      void loadDetail(detailId)
    }
  }, [drawerOpen, detailId, loadDetail])

  /** 完结弹窗打开时单独拉取施工人员数据，避免与抽屉内 state 更新不同步导致表格为空 */
  useEffect(() => {
    if (!finishOpen) {
      setFinishPreviewRows([])
      setFinishPreviewLoading(false)
      return
    }
    if (detailId == null) {
      setFinishPreviewLoading(false)
      return
    }

    let cancelled = false
    setFinishPreviewLoading(true)

    const applyFallback = () => {
      const wd = workerDaysRef.current
      if (wd.length > 0) {
        setFinishPreviewFromDaily(true)
        setFinishPreviewRows(wd)
        return
      }
      const t = taskRef.current
      if (t) {
        const union = buildMtWorkerDayRowsFromTaskUnion(t)
        if (union.length > 0) {
          setFinishPreviewFromDaily(false)
          setFinishPreviewRows(union)
          return
        }
      }
      setFinishPreviewFromDaily(false)
      setFinishPreviewRows([])
    }

    void axios
      .get<{ task: MaintenanceTask; worker_days?: MaintenanceTaskWorkerDayRow[] }>(`/api/maintenance-tasks/${detailId}`)
      .then((res) => {
        if (cancelled) return
        const any = res.data as {
          task: MaintenanceTask
          worker_days?: MaintenanceTaskWorkerDayRow[]
          workerDays?: MaintenanceTaskWorkerDayRow[]
        }
        const rawWd = any.worker_days ?? any.workerDays
        const wd = Array.isArray(rawWd) ? rawWd : []
        if (wd.length > 0) {
          setFinishPreviewFromDaily(true)
          setFinishPreviewRows(wd)
          return
        }
        const union = buildMtWorkerDayRowsFromTaskUnion(any.task)
        if (union.length > 0) {
          setFinishPreviewFromDaily(false)
          setFinishPreviewRows(union)
          return
        }
        setFinishPreviewFromDaily(false)
        setFinishPreviewRows([])
      })
      .catch(() => {
        if (!cancelled) applyFallback()
      })
      .finally(() => {
        if (!cancelled) setFinishPreviewLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [finishOpen, detailId])

  const openDetail = useCallback((r: MaintenanceTask) => {
    setDetailId(r.id)
    setDrawerOpen(true)
  }, [])

  const onTableEditClick = useCallback((r: MaintenanceTask) => {
    editRecordRef.current = r
    setEditRecord(r)
    setEditOpen(true)
  }, [])

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
      await loadDetail(detailId)
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setAssignSubmitting(false)
    }
  }

  const submitWorkerDaySave = async () => {
    if (!detailId || !task) return
    if (!mtTaskHasAssignee(task)) {
      msg.warning('请先在「分配任务」中指定执行人')
      return
    }
    try {
      const v = await workerDayForm.validateFields(['work_date', 'work_period', 'construction_workers'])
      setWorkerDaySubmitting(true)
      const workDate = dayjs(v.work_date).format('YYYY-MM-DD')
      const wid = v.worker_day_id
      const res = await axios.post<{
        task: MaintenanceTask
        logs: MaintenanceTaskLog[]
        logAttachments?: MaintenanceTaskLogAttachment[]
        worker_days?: MaintenanceTaskWorkerDayRow[]
      }>(`/api/maintenance-tasks/${detailId}/worker-days`, {
        work_date: workDate,
        work_period: normalizeMtWorkerPeriodUi(v.work_period != null ? String(v.work_period) : 'full_day'),
        construction_workers: Array.isArray(v.construction_workers) ? v.construction_workers : [],
        ...(typeof wid === 'number' && wid > 0 ? { worker_day_id: wid } : {}),
      })
      const nt = res.data.task
      setTask({ ...nt, audit: nt.audit })
      setLogs(res.data.logs ?? [])
      setLogAttachments(res.data.logAttachments ?? [])
      setWorkerDays(Array.isArray(res.data.worker_days) ? res.data.worker_days : [])
      workerDayForm.setFieldsValue({
        work_date: dayjs(workDate),
        construction_workers: [],
        work_period: 'full_day',
        worker_day_id: undefined,
      })
      msg.success('已保存该日施工人员')
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setWorkerDaySubmitting(false)
    }
  }

  const removeWorkerDay = useCallback(
    async (row: MaintenanceTaskWorkerDayRow) => {
      if (!detailId || !task) return
      if (!mtTaskHasAssignee(task)) return
      setWorkerDaySubmitting(true)
      try {
        const res = await axios.post<{
          task: MaintenanceTask
          logs: MaintenanceTaskLog[]
          logAttachments?: MaintenanceTaskLogAttachment[]
          worker_days?: MaintenanceTaskWorkerDayRow[]
        }>(`/api/maintenance-tasks/${detailId}/worker-days`, {
          work_date: row.work_date,
          construction_workers: [],
          ...(row.id != null && row.id > 0 ? { worker_day_id: row.id } : {}),
        })
        const nt = res.data.task
        setTask({ ...nt, audit: nt.audit })
        setLogs(res.data.logs ?? [])
        setLogAttachments(res.data.logAttachments ?? [])
        setWorkerDays(Array.isArray(res.data.worker_days) ? res.data.worker_days : [])
        msg.success('已删除该条记录')
        fetchList()
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
      } finally {
        setWorkerDaySubmitting(false)
      }
    },
    [detailId, task, msg, fetchList],
  )

  const fillWorkerDayForm = useCallback(
    (d: MaintenanceTaskWorkerDayRow) => {
      workerDayForm.setFieldsValue({
        work_date: dayjs(d.work_date),
        work_period: normalizeMtWorkerPeriodUi(d.work_period),
        construction_workers: Array.isArray(d.construction_workers) ? [...d.construction_workers] : [],
        worker_day_id: d.id != null && d.id > 0 ? d.id : undefined,
      })
    },
    [workerDayForm],
  )

  const workerDayListColumns = useMemo<ColumnsType<MaintenanceTaskWorkerDayRow>>(
    () => [
      { title: '施工日期', dataIndex: 'work_date', key: 'work_date', width: 120 },
      {
        title: '工时',
        key: 'period',
        width: 100,
        render: (_, r) => mtWorkerPeriodTagEl(r.work_period),
      },
      {
        title: '施工人员',
        key: 'w',
        render: (_, r) => {
          const names = (r.construction_workers ?? []).map((u) => userRealNameOnlyMap.get(u) ?? u).join('、')
          return names || '—'
        },
      },
      {
        title: '操作',
        key: 'a',
        width: 168,
        render: (_, r) => (
          <Space size="small">
            <Button type="link" size="small" onClick={() => fillWorkerDayForm(r)}>
              填入表单
            </Button>
            <Popconfirm title="确定删除该条施工记录？" onConfirm={() => void removeWorkerDay(r)}>
              <Button type="link" size="small" danger disabled={workerDaySubmitting}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [fillWorkerDayForm, removeWorkerDay, userRealNameOnlyMap, workerDaySubmitting],
  )

  const workerDayReadOnlyColumns = useMemo<ColumnsType<MaintenanceTaskWorkerDayRow>>(
    () => [
      { title: '施工日期', dataIndex: 'work_date', key: 'work_date', width: 120 },
      {
        title: '工时',
        key: 'period',
        width: 100,
        render: (_, r) => mtWorkerPeriodTagEl(r.work_period),
      },
      {
        title: '施工人员',
        key: 'w',
        ellipsis: true,
        render: (_, r) => {
          const names = (r.construction_workers ?? []).map((u) => userRealNameOnlyMap.get(u) ?? u).join('、')
          return names || '—'
        },
      },
    ],
    [userRealNameOnlyMap],
  )

  /** 完结预览表：显式渲染表头单元格，避免在 Modal / 横向滚动容器内表头行被压成不可见 */
  const finishWorkerPreviewTableComponents = useMemo(
    () => ({
      header: {
        cell: (cellProps: React.ThHTMLAttributes<HTMLTableCellElement>) => (
          <th
            {...cellProps}
            style={{
              ...(cellProps.style as React.CSSProperties | undefined),
              minHeight: 40,
              padding: '10px 12px',
              fontWeight: 600,
              background: 'var(--ant-color-fill-alter, #fafafa)',
              color: 'var(--ant-color-text, rgba(0, 0, 0, 0.88))',
            }}
          />
        ),
      },
    }),
    [],
  )

  /** 抽屉内只读展示：已完成/审批中等不可编辑时仍显示按日表（无按日数据则汇总合成一行） */
  const drawerWorkerDayDisplayRows = useMemo((): MaintenanceTaskWorkerDayRow[] => {
    if (!task) return []
    if (workerDays.length > 0) return workerDays
    return buildMtWorkerDayRowsFromTaskUnion(task)
  }, [task, workerDays])

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

  const handleEditBasicSave = async () => {
    if (!editRecord) return
    try {
      const v = await editForm.validateFields()
      const due = v.due_at ? dayjs(v.due_at).startOf('hour') : null
      if (!due) {
        msg.error('请选择截止时间')
        return
      }
      setEditSubmitting(true)
      const res = await axios.put<MaintenanceTask & { audit?: GateAudit }>(`/api/maintenance-tasks/${editRecord.id}`, {
        title: (v.title ?? '').trim(),
        task_type: v.task_type,
        due_at: due.format('YYYY-MM-DD HH:00'),
        content: (v.content ?? '').trim() || undefined,
      })
      msg.success('已保存')
      const savedId = editRecord.id
      setEditOpen(false)
      setEditRecord(null)
      editRecordRef.current = null
      editForm.resetFields()
      fetchList()
      if (drawerOpen && detailId === savedId && res.data) {
        setTask({ ...res.data, audit: res.data.audit })
      }
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setEditSubmitting(false)
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

  const addPendingLogImage = useCallback(
    (file: File) => {
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
      void (async () => {
        try {
          const prepared = await prepareLogImageFile(file)
          setPendingLogImages((prev) => [...prev, prepared])
        } catch (e) {
          msg.error(e instanceof Error ? e.message : '处理图片失败')
        }
      })()
    },
    [msg, task],
  )

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

  const submitMtDingTalk = useCallback(
    async (id: number, fromDrawer?: boolean) => {
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
    },
    [detailId, fetchList, loadDetail, msg],
  )

  const handleDelete = useCallback(
    async (id: number) => {
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
    },
    [detailId, fetchList, msg],
  )

  const submitMtDingTalkFromList = useCallback((id: number) => void submitMtDingTalk(id), [submitMtDingTalk])

  const canAddLog = Boolean(task && task.status !== 'completed' && task.status !== 'cancelled')

  const taskAssigneeDisplay = useMemo(() => {
    const a = task?.assignee?.trim()
    if (!a) return null
    return assigneeLabelMap(assignSelectOptions).get(a) ?? a
  }, [task?.assignee, assignSelectOptions])

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
        <Popover
          title="列表列显示"
          trigger="click"
          placement="bottomLeft"
          content={
            <div style={{ maxWidth: 280 }}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                {MT_LIST_COL_ORDER.map((colKey) => (
                  <Checkbox
                    key={colKey}
                    checked={listColVisibility[colKey]}
                    onChange={(e) => updateListColVisibility(colKey, e.target.checked)}
                  >
                    {MT_LIST_COL_LABEL[colKey]}
                  </Checkbox>
                ))}
                <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={resetListColVisibility}>
                  恢复默认（全部显示）
                </Button>
              </Space>
            </div>
          }
        >
          <Button icon={<SettingOutlined />}>列设置</Button>
        </Popover>
      </Space>

      <MaintenanceScheduleListTable
        list={filteredList}
        loading={loading}
        openDetail={openDetail}
        onEditClick={onTableEditClick}
        onSubmitDingTalk={submitMtDingTalkFromList}
        onDelete={handleDelete}
        dingSubmittingId={dingSubmittingId}
        assigneeDisplayMap={assigneeDisplayMap}
        userRealNameOnlyMap={userRealNameOnlyMap}
        listSort={listSort}
        onListSortChange={handleListSorterChange}
        listColVisibility={listColVisibility}
        listTableScrollX={listTableScrollX}
      />

      <Modal
        title="编辑基本信息"
        open={editOpen}
        onCancel={() => {
          setEditOpen(false)
          setEditRecord(null)
          editRecordRef.current = null
          editForm.resetFields()
        }}
        afterOpenChange={(opened) => {
          if (!opened) return
          const rec = editRecordRef.current
          if (rec) {
            requestAnimationFrame(() => {
              fillEditFormFromRecord(rec)
            })
          }
        }}
        onOk={() => void handleEditBasicSave()}
        confirmLoading={editSubmitting}
        destroyOnClose
        width={560}
        okText="保存"
      >
        <Form
          key={editRecord ? `mt-edit-${editRecord.id}` : 'mt-edit-closed'}
          form={editForm}
          layout="vertical"
          preserve={false}
        >
          <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请输入任务标题' }]}>
            <Input placeholder="简要概括" />
          </Form.Item>
          <Form.Item name="task_type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select options={TYPE_OPTIONS} placeholder="巡检 / 维护 / 维修 / 其他任务" />
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
                  editForm.setFieldValue('due_at', null)
                  editDueAtLastDayKeyRef.current = null
                  return
                }
                const dayKey = d.format('YYYY-MM-DD')
                const sameCalendarDay = editDueAtLastDayKeyRef.current === dayKey
                editDueAtLastDayKeyRef.current = dayKey
                const next = sameCalendarDay
                  ? d.startOf('hour')
                  : d.startOf('day').hour(18).minute(0).second(0).millisecond(0)
                editForm.setFieldValue('due_at', next)
              }}
            />
          </Form.Item>
          <Form.Item name="content" label="任务说明">
            <TextArea rows={3} placeholder="选填：范围、要求等" />
          </Form.Item>
        </Form>
      </Modal>

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
            <Select options={TYPE_OPTIONS} placeholder="巡检 / 维护 / 维修 / 其他任务" />
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
          setWorkerDays([])
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
                  <Button
                    type="primary"
                    disabled={!mtTaskHasAssignee(task)}
                    onClick={() => setFinishOpen(true)}
                  >
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
              <div style={{ marginBottom: 18 }}>
                {task.audit?.dingtalk_gate && !mtOpsUnlocked(task.audit) ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="已启用钉钉审批"
                    description="须已分配执行人；审批通过后方可追加操作记录、附图与点击「完结」。请在列表或上方提交钉钉流程。"
                  />
                ) : null}
                {canAddLog && !mtTaskHasAssignee(task) ? (
                  <Alert
                    type="info"
                    showIcon
                    message="请先分配任务"
                    description="在下方选择执行人并确认后，方可提交钉钉审批、填写操作记录与完结。"
                  />
                ) : null}
              </div>

              <div style={mtDrawerSectionShell}>
                <div style={mtDrawerSectionHeading}>
                  <Title level={5} style={{ margin: 0 }}>
                    分配与施工
                  </Title>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    执行人、按日施工人员；与列表「提交钉钉审批」、抽屉右上角「完结」配合完成闭环。
                  </Text>
                </div>
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  {canAssignOrReassignMt(task, task.audit) ? (
                    <Card
                      size="small"
                      title={mtTaskHasAssignee(task) ? '转派任务' : '分配任务'}
                      style={{ marginBottom: 0 }}
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
                  {canEditMtWorkerDays(task) ? (
                    <Card size="small" title="施工人员（按日）" style={{ marginBottom: 0 }}>
                      {!mtTaskHasAssignee(task) ? (
                        <Text type="secondary">请先在上方「分配任务」中指定执行人。</Text>
                      ) : (
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                          <Table<MaintenanceTaskWorkerDayRow>
                            size="small"
                            rowKey={(r) => `${r.id ?? 0}-${r.work_date}-${normalizeMtWorkerPeriodUi(r.work_period)}`}
                            dataSource={workerDays}
                            columns={workerDayListColumns}
                            pagination={false}
                            locale={{ emptyText: '尚无按日记录，请在下方选择日期并添加人员' }}
                          />
                          <Form form={workerDayForm} layout="vertical" style={{ maxWidth: 480 }}>
                            <Form.Item name="worker_day_id" hidden>
                              <Input type="hidden" />
                            </Form.Item>
                            <Form.Item
                              name="work_date"
                              label="施工日期"
                              rules={[{ required: true, message: '请选择施工日期' }]}
                              extra="按自然日分派。该日已有记录时，不带已选条目保存会新增一条；要改已有条目请先在表格点「填入表单」再保存。"
                            >
                              <DatePicker format="YYYY-MM-DD" style={{ width: '100%' }} />
                            </Form.Item>
                            <Form.Item
                              name="work_period"
                              label="工时类型"
                              rules={[{ required: true, message: '请选择工时类型' }]}
                              extra="半天、整天或加班，与该日施工人员一并保存。"
                            >
                              <Radio.Group>
                                <Radio value="half_day">半天</Radio>
                                <Radio value="full_day">整天</Radio>
                                <Radio value="overtime">加班</Radio>
                              </Radio.Group>
                            </Form.Item>
                            <Form.Item
                              name="construction_workers"
                              label="施工人员"
                              extra="须已绑定钉钉 userId 的在职用户。"
                            >
                              <Select
                                mode="multiple"
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                placeholder="选择施工人员"
                                options={constructionWorkerSelectOptions}
                                loading={assigneeUsersLoading}
                              />
                            </Form.Item>
                            <Space wrap>
                              <Button type="primary" loading={workerDaySubmitting} onClick={() => void submitWorkerDaySave()}>
                                保存该日施工人员
                              </Button>
                              
                            </Space>
                          </Form>
                        </Space>
                      )}
                    </Card>
                  ) : null}
                  {!canEditMtWorkerDays(task) ? (
                    <Card
                      size="small"
                      title="施工人员（按日）"
                      style={{ marginBottom: 0 }}
                      extra={
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {workerDays.length > 0 ? '只读' : '无按日条目时按汇总展示一行'}
                        </Text>
                      }
                    >
                      {drawerWorkerDayDisplayRows.length > 0 ? (
                        <div style={{ width: '100%', overflowX: 'auto' }}>
                          <Table<MaintenanceTaskWorkerDayRow>
                            size="small"
                            showHeader
                            rowKey={(r, index) =>
                              `drawer-ro-${index}-${r.id}-${r.work_date}-${normalizeMtWorkerPeriodUi(r.work_period)}`
                            }
                            dataSource={drawerWorkerDayDisplayRows}
                            columns={workerDayReadOnlyColumns}
                            pagination={false}
                            bordered
                            locale={{ emptyText: '无记录' }}
                            scroll={{ x: 520 }}
                            components={finishWorkerPreviewTableComponents}
                          />
                        </div>
                      ) : (
                        <Text type="secondary">暂无按日与汇总施工人员记录。</Text>
                      )}
                    </Card>
                  ) : null}
                </Space>
              </div>

              <div style={mtDrawerSectionShell}>
                <div style={mtDrawerSectionHeading}>
                  <Title level={5} style={{ margin: 0 }}>
                    任务概况
                  </Title>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    状态、截止时间、进度与说明；施工人员（汇总）为各施工日人员并集。
                  </Text>
                </div>
                <Descriptions
                  bordered
                  size="middle"
                  column={2}
                  style={{ marginBottom: 0 }}
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
                  <Descriptions.Item label="施工人员（汇总）" span={2}>
                    {(() => {
                      const arr = task.construction_workers ?? []
                      if (!arr.length) return <Text type="secondary">—</Text>
                      return arr.map((u) => userRealNameOnlyMap.get(u) ?? u).join('、')
                    })()}
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
              </div>

              <div style={mtDrawerSectionShell}>
                <div style={mtDrawerSectionHeading}>
                  <Title level={5} style={{ margin: 0 }}>
                    操作记录
                  </Title>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    含系统自动产生的逾期记录；每次保存会追加一条并可能更新状态；进度须较当前至少提高 10%（上限 100%）。
                  </Text>
                </div>
                {logs.length === 0 ? (
                  <Text type="secondary">暂无记录</Text>
                ) : (
                  <Timeline style={{ marginBottom: canAddLog ? 16 : 0 }}>
                    {logs.map((log) => {
                      const atts = attachmentsByLogId[log.id] ?? []
                      const logColor =
                        log.action === 'auto_overdue'
                          ? 'red'
                          : log.action === 'assign'
                            ? 'green'
                            : log.action === 'reassign'
                              ? 'cyan'
                              : log.action === 'worker_day'
                                ? 'geekblue'
                                : 'blue'
                      return (
                        <Timeline.Item key={log.id} color={logColor}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {log.created_at} {formatLogLine(log)}
                            {log.progress_after != null ? ` · 进度 ${log.progress_after}%` : ''}
                          </Text>
                          <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{log.content}</div>
                          {atts.length > 0 && detailId != null ? (
                            <Space wrap size={[12, 12]} style={{ marginTop: 8 }}>
                              {atts.map((att) => (
                                <LogAttachmentRow
                                  key={att.id}
                                  taskId={detailId}
                                  logId={log.id}
                                  att={att}
                                  onOpenPreview={openLogAttachmentPreview}
                                  onDownload={downloadLogAttachment}
                                />
                              ))}
                            </Space>
                          ) : null}
                        </Timeline.Item>
                      )
                    })}
                  </Timeline>
                )}

                {canAddLog ? (
                  <Card size="small" title="追加操作记录" style={{ marginBottom: 0 }}>
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
                                  decoding="async"
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
              </div>
            </>
          )}
        </Spin>
      </Drawer>

      <Modal
        title="确认完结"
        open={finishOpen}
        destroyOnClose
        onCancel={() => {
          setFinishOpen(false)
          setFinishNote('')
        }}
        onOk={() => void submitFinish()}
        confirmLoading={finishSubmitting}
        okText="确认完结"
        width={640}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          完结后任务状态将变为「已完成」，进度记为 100%。可填写办结说明（留空则使用默认文案）。
        </Text>
        <Spin spinning={finishPreviewLoading}>
          {finishPreviewRows.length > 0 ? (
            <>
              <Text strong style={{ display: 'block', marginTop: 4, marginBottom: 8 }}>
                施工人员{finishPreviewFromDaily ? '（按日）' : '（汇总）'}
              </Text>
              <div style={{ width: '100%', overflowX: 'auto', marginBottom: 16 }}>
                <Table<MaintenanceTaskWorkerDayRow>
                  size="small"
                  showHeader
                  rowKey={(r, index) => `${index}-${r.id}-${r.work_date}-${normalizeMtWorkerPeriodUi(r.work_period)}`}
                  dataSource={finishPreviewRows}
                  columns={workerDayReadOnlyColumns}
                  pagination={false}
                  bordered
                  locale={{ emptyText: '无记录' }}
                  scroll={{ x: 520 }}
                  components={finishWorkerPreviewTableComponents}
                />
              </div>
            </>
          ) : finishPreviewLoading ? null : (
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              暂无施工人员记录。
            </Text>
          )}
        </Spin>
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
