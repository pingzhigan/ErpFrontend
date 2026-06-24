/**
 * 维护管理 - 零星工程
 * 业务流：① 分配到部门（部门负责人）→ ② 按日分派施工人员并记录（闭环前须至少一日有人员）→ ③ 派单确认 → ④ 跟踪 → ⑤ 闭环。负责人与按日施工人员写入跟踪时间线。
 */
import {
  FormOutlined,
  ToolOutlined,
  PlusOutlined,
  CheckCircleOutlined,
  SendOutlined,
  UploadOutlined,
  EyeOutlined,
  DeleteOutlined,
  DownloadOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import type { ColumnType, ColumnsType } from 'antd/es/table'
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Popover,
  Progress,
  Radio,
  Select,
  Segmented,
  Slider,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Timeline,
  Typography,
  Upload,
} from 'antd'
import axios from 'axios'
import dayjs, { type Dayjs } from 'dayjs'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DueCountdownCell, useNowEverySecond } from '../components/DueCountdownCell'
import { auditGateAllowsEditWhenNotApproving } from '../utils/auditGateUi'
import {
  assigneeLabelMap,
  buildConstructionAssigneeOptions,
  labelForAssigneeUsername,
  type AssigneeInactiveRef,
  type AssigneeUserRow,
} from '../utils/constructionAssigneeOptions'
import { parseDueAtHourPickerValue } from '../utils/dueAtHourPickerParse'
import { formatMoney } from '../utils/formatMoney'
import { CompletionTimingCell, getCompletionTimingDuration } from '../utils/overdueCompletionText'
import { useAuth } from '../auth/AuthContext'

const EXPORT_EXCEL_MAX_ROWS = 2000
type MwListStatusFilter = 'all' | 'open' | 'done' | 'overdue_done'

const { Title, Text, Paragraph, Link } = Typography
const { Search } = Input
const { TextArea } = Input

type MinorWorkStatus = 'pending' | 'dispatched' | 'in_progress' | 'closed'

type GateAudit = {
  dingtalk_gate: boolean
  audit_status: 'draft' | 'approving' | 'completed'
  audit_outcome: 'approved' | 'rejected' | null
  dingtalk_process_instance_id: string | null
}

function minorWorkAuditLabel(audit: GateAudit | undefined): { text: string; color: string } | null {
  if (!audit?.dingtalk_gate) return null
  if (audit.audit_status === 'draft') return { text: '待提交审批', color: 'default' }
  if (audit.audit_status === 'approving') return { text: '审批中', color: 'processing' }
  if (audit.audit_outcome === 'approved') return { text: '审批通过', color: 'success' }
  if (audit.audit_outcome === 'rejected') return { text: '已拒绝', color: 'error' }
  return null
}

function canEditMinorWorkWithAudit(audit: GateAudit | undefined): boolean {
  return auditGateAllowsEditWhenNotApproving(audit)
}

function canDeleteMinorWorkWithAudit(audit: GateAudit | undefined): boolean {
  return auditGateAllowsEditWhenNotApproving(audit)
}

function canSubmitMinorWorkDingTalk(audit: GateAudit | undefined): boolean {
  if (!audit?.dingtalk_gate) return false
  return (
    audit.audit_status === 'draft' ||
    (audit.audit_status === 'completed' && audit.audit_outcome === 'rejected')
  )
}

/** 派单、附件、跟踪、闭环等须审批通过（门禁关闭时不限制） */
function minorWorkOpsUnlocked(audit: GateAudit | undefined): boolean {
  if (!audit?.dingtalk_gate) return true
  return audit.audit_status === 'completed' && audit.audit_outcome === 'approved'
}

/** 抽屉展示：登记/创建时间（与列表 created_at 一致） */
function formatMinorWorkCreatedAt(s: string | null | undefined): string {
  const t = String(s ?? '').trim()
  if (!t) return '—'
  const l = t.toLowerCase()
  if (l === 'null' || l === 'undefined') return '—'
  const v = t.replace('T', ' ')
  return v.length >= 16 ? v.slice(0, 16) : v.slice(0, 10)
}

/** 派单表单默认计划完成：优先已保存 plan_date（支持仅日期或含时），否则用截止时间（含整点） */
function parseMinorPlanDateDefault(
  plan_date: string | null | undefined,
  due_at: string | null | undefined,
): Dayjs | undefined {
  const p = plan_date?.trim()
  if (p) {
    const norm = p.replace('T', ' ')
    if (/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}/.test(norm)) {
      const d = dayjs(norm, 'YYYY-MM-DD HH:mm', true)
      if (d.isValid()) return d.startOf('hour')
    }
    const d = dayjs(norm.slice(0, 10), 'YYYY-MM-DD', true)
    return d.isValid() ? d : undefined
  }
  const dStr = due_at?.trim()
  if (!dStr) return undefined
  const norm = dStr.replace('T', ' ')
  if (/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}/.test(norm)) {
    const d = dayjs(norm, 'YYYY-MM-DD HH:mm', true)
    if (d.isValid()) return d.startOf('hour')
  }
  const d = dayjs(norm.slice(0, 10), 'YYYY-MM-DD', true)
  return d.isValid() ? d : undefined
}

type MinorWorkOrder = {
  id: number
  code: string
  title: string
  location: string | null
  applicant: string | null
  apply_date: string
  customer_name: string | null
  due_at: string | null
  precautions: string | null
  project_amount: number | null
  cost_budget: number | null
  content: string
  status: MinorWorkStatus
  handler: string | null
  /** 施工人员登录名（多选） */
  construction_workers?: string[]
  plan_date: string | null
  finish_date: string | null
  progress: number
  ai_dispatch_json: string | null
  dispatch_note: string | null
  close_note: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  audit?: GateAudit
  closed_at?: string | null
  completed_overdue?: boolean
}

type MinorWorkWorkerPeriod = 'half_day' | 'full_day' | 'overtime'

function normalizeMinorWorkWorkerPeriodUi(p: string | undefined | null): MinorWorkWorkerPeriod {
  if (p === 'half_day' || p === 'overtime') return p
  return 'full_day'
}

const MINOR_WORK_PERIOD_LABEL: Record<MinorWorkWorkerPeriod, string> = {
  half_day: '半天',
  full_day: '整天',
  overtime: '加班',
}

/** Ant Design Tag 预设色：半天 / 整天 / 加班区分 */
const MINOR_WORK_PERIOD_TAG_COLOR: Record<MinorWorkWorkerPeriod, string> = {
  half_day: 'gold',
  full_day: 'blue',
  overtime: 'volcano',
}

function minorWorkPeriodTagEl(period: string | undefined | null) {
  const p = normalizeMinorWorkWorkerPeriodUi(period)
  return (
    <Tag bordered={false} color={MINOR_WORK_PERIOD_TAG_COLOR[p]} style={{ marginInlineEnd: 0 }}>
      {MINOR_WORK_PERIOD_LABEL[p]}
    </Tag>
  )
}

type MinorWorkWorkerDayRow = {
  /** 库表主键；仅 orders 列虚拟一行时为 0 */
  id?: number
  work_date: string
  construction_workers: string[]
  work_period?: MinorWorkWorkerPeriod
}

/** 与后端一致：任意状态可改基本信息；钉钉门禁下审批中不可编辑 */
function canEditMinorWorkBasicInfo(r: MinorWorkOrder): boolean {
  return canEditMinorWorkWithAudit(r.audit)
}

function minorWorkHasHandler(order: MinorWorkOrder | null | undefined): boolean {
  return Boolean(order?.handler?.trim())
}

function minorWorkHasConstructionWorkers(order: MinorWorkOrder | null | undefined): boolean {
  return Array.isArray(order?.construction_workers) && order.construction_workers.length > 0
}

/** 待派单阶段：须已指定部门负责人，方可填计划/说明、上传派单附件并确认派单 */
function minorWorkDispatchFormEnabled(audit: GateAudit | undefined, order: MinorWorkOrder | null): boolean {
  return Boolean(
    order && order.status === 'pending' && minorWorkOpsUnlocked(audit) && minorWorkHasHandler(order),
  )
}

type MinorWorkTrack = {
  id: number
  minor_work_id: number
  content: string
  progress_after: number | null
  /** track | assign | reassign */
  track_kind?: string
  created_at: string
  created_by: string | null
}

type MinorWorkTrackAttachmentDto = {
  id: number
  minor_work_id: number
  track_id: number
  file_name: string
  file_size: number
  mime_type: string | null
  created_at: string
  created_by: string | null
}

const TRACK_KIND_LABEL: Record<string, string> = {
  track: '跟踪',
  assign: '分配任务',
  reassign: '转派',
  close: '闭环',
}

type DispatchAttachmentDto = {
  id: number
  minor_work_id: number
  file_name: string
  file_size: number
  mime_type: string | null
  created_at: string
  created_by: string | null
}

const DISPATCH_IMAGE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,image/*'

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function validateDispatchImageFile(file: File): string | null {
  const okExt = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(file.name)
  if (!okExt && !file.type.startsWith('image/')) {
    return '仅支持 jpg、png、gif、webp、bmp、tiff 等图片'
  }
  if (file.size > 2 * 1024 * 1024) {
    return '图片大小不能超过 2MB'
  }
  return null
}

const STATUS_MAP: Record<MinorWorkStatus, { color: string; label: string }> = {
  pending: { color: 'default', label: '待派单' },
  dispatched: { color: 'blue', label: '已派单' },
  in_progress: { color: 'processing', label: '执行中' },
  closed: { color: 'success', label: '已闭环' },
}

function mwStatusCell(order: MinorWorkOrder) {
  const s = STATUS_MAP[order.status] ?? { color: 'default', label: order.status }
  return <Tag color={s.color}>{s.label}</Tag>
}

function mwCompletionTimingCell(order: MinorWorkOrder) {
  if (order.status !== 'closed') return <Text type="secondary">—</Text>
  return (
    <CompletionTimingCell
      dueAt={order.due_at}
      completedAt={order.closed_at}
      completedOverdue={Boolean(order.completed_overdue)}
    />
  )
}

/** 列表列显示（不含「操作」，操作列始终展示）；持久化 localStorage */
const MINOR_WORK_LIST_COLS_LS = 'minor_work.list.columns.v3'

type MinorWorkListColKey =
  | 'code'
  | 'title'
  | 'customer'
  | 'due_at'
  | 'project_amount'
  | 'cost_budget'
  | 'progress'
  | 'status'
  | 'completion_timing'
  | 'handler'
  | 'construction_workers'
  | 'audit'

const MINOR_WORK_LIST_COL_ORDER: MinorWorkListColKey[] = [
  'code',
  'title',
  'customer',
  'due_at',
  'project_amount',
  'cost_budget',
  'progress',
  'status',
  'completion_timing',
  'handler',
  'construction_workers',
  'audit',
]

const MINOR_WORK_LIST_COL_LABEL: Record<MinorWorkListColKey, string> = {
  code: '编号',
  title: '事项标题',
  customer: '客户名称',
  due_at: '截止时间',
  project_amount: '工程金额',
  cost_budget: '成本预算',
  progress: '进度',
  status: '状态',
  completion_timing: '完成情况',
  handler: '部门负责人',
  construction_workers: '施工人员',
  audit: '审批',
}

const MINOR_WORK_LIST_COL_WIDTH: Record<MinorWorkListColKey, number> = {
  code: 118,
  title: 200,
  customer: 120,
  due_at: 208,
  project_amount: 120,
  cost_budget: 120,
  progress: 140,
  status: 96,
  completion_timing: 168,
  handler: 112,
  construction_workers: 160,
  audit: 100,
}

function defaultMinorWorkListColVisibility(): Record<MinorWorkListColKey, boolean> {
  return Object.fromEntries(MINOR_WORK_LIST_COL_ORDER.map((k) => [k, true])) as Record<MinorWorkListColKey, boolean>
}

function loadMinorWorkListColVisibility(): Record<MinorWorkListColKey, boolean> {
  const allOn = defaultMinorWorkListColVisibility()
  try {
    const raw = localStorage.getItem(MINOR_WORK_LIST_COLS_LS)
    if (!raw?.trim()) return allOn
    const p = JSON.parse(raw) as unknown
    if (!p || typeof p !== 'object') return allOn
    const o = p as Record<string, unknown>
    const out = { ...allOn }
    for (const k of MINOR_WORK_LIST_COL_ORDER) {
      if (typeof o[k] === 'boolean') out[k] = o[k]
    }
    return out
  } catch {
    return allOn
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

/** 抽屉各阶段文案兜底：过滤 null/字面量 null，空则显示占位符 */
function drawerDisplayText(v: string | null | undefined, empty = '—'): string {
  return sanitizeNullableText(v) ?? empty
}

function drawerProgressPercent(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(Number(n))) return 0
  return Math.min(100, Math.max(0, Math.round(Number(n))))
}

/** 列表排序：状态列先后（待派单 → … → 已闭环） */
const MINOR_WORK_STATUS_SORT_ORDER: MinorWorkStatus[] = ['pending', 'dispatched', 'in_progress', 'closed']

function minorWorkListCustomerSortKey(r: MinorWorkOrder): string {
  return (sanitizeNullableText(r.customer_name) || sanitizeNullableText(r.applicant) || '').trim()
}

/** 升序比较：负值表示 a 在前 */
function compareMinorWorkListRows(a: MinorWorkOrder, b: MinorWorkOrder, field: MinorWorkListColKey): number {
  switch (field) {
    case 'code':
      return String(a.code ?? '').localeCompare(String(b.code ?? ''), 'zh-CN')
    case 'title':
      return String(a.title ?? '').localeCompare(String(b.title ?? ''), 'zh-CN')
    case 'customer':
      return minorWorkListCustomerSortKey(a).localeCompare(minorWorkListCustomerSortKey(b), 'zh-CN')
    case 'due_at': {
      const sa = String(a.due_at ?? '')
      const sb = String(b.due_at ?? '')
      if (!sa && !sb) return 0
      if (!sa) return 1
      if (!sb) return -1
      return sa.localeCompare(sb)
    }
    case 'project_amount':
      return (Number(a.project_amount) || 0) - (Number(b.project_amount) || 0)
    case 'cost_budget':
      return (Number(a.cost_budget) || 0) - (Number(b.cost_budget) || 0)
    case 'progress':
      return (Number(a.progress) || 0) - (Number(b.progress) || 0)
    case 'status':
      return MINOR_WORK_STATUS_SORT_ORDER.indexOf(a.status) - MINOR_WORK_STATUS_SORT_ORDER.indexOf(b.status)
    case 'completion_timing': {
      const la = getCompletionTimingDuration(a.due_at, a.closed_at, Boolean(a.completed_overdue)) ?? ''
      const lb = getCompletionTimingDuration(b.due_at, b.closed_at, Boolean(b.completed_overdue)) ?? ''
      return la.localeCompare(lb, 'zh-CN')
    }
    case 'handler':
      return String(a.handler ?? '').localeCompare(String(b.handler ?? ''), 'zh-CN')
    case 'construction_workers': {
      const sa = [...(a.construction_workers ?? [])].sort((x, y) => x.localeCompare(y, 'zh-CN')).join('\u0001')
      const sb = [...(b.construction_workers ?? [])].sort((x, y) => x.localeCompare(y, 'zh-CN')).join('\u0001')
      return sa.localeCompare(sb, 'zh-CN')
    }
    case 'audit': {
      const la = minorWorkAuditLabel(a.audit)?.text ?? ''
      const lb = minorWorkAuditLabel(b.audit)?.text ?? ''
      return la.localeCompare(lb, 'zh-CN')
    }
    default:
      return 0
  }
}

function stepCurrent(status: MinorWorkStatus): number {
  if (status === 'pending') return 0
  if (status === 'dispatched' || status === 'in_progress') return 1
  return 2
}

/** 新建默认截止时间：仍为未来的最近一个当日 18:00，否则次日 18:00。 */
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

/** 跟踪记录附图：缩略图 + 预览/下载 */
const MinorTrackAttachmentRow: React.FC<{
  orderId: number
  att: MinorWorkTrackAttachmentDto
  onOpenPreview: (att: MinorWorkTrackAttachmentDto) => void
  onDownload: (att: MinorWorkTrackAttachmentDto) => void
}> = ({ orderId, att, onOpenPreview, onDownload }) => {
  const urlRef = useRef<string | null>(null)
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void axios
      .get(
        `/api/minor-works/${orderId}/tracks/${att.track_id}/attachments/${att.id}/preview`,
        { responseType: 'blob' },
      )
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
  }, [orderId, att.track_id, att.id])
  return (
    <Space align="start" size={10} style={{ maxWidth: 360 }}>
      <button
        type="button"
        onClick={() => void onOpenPreview(att)}
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
        <Text ellipsis style={{ fontSize: 12, maxWidth: 240 }} title={drawerDisplayText(att.file_name, '') || undefined}>
          {drawerDisplayText(att.file_name, '（无文件名）')}
        </Text>
        <Space size={4}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => void onOpenPreview(att)}>
            预览
          </Button>
          <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => void onDownload(att)}>
            下载
          </Button>
        </Space>
      </Space>
    </Space>
  )
}

/** 零星工程办理抽屉分区（与维护排单办理抽屉视觉一致） */
const minorWorkDrawerSectionShell: React.CSSProperties = {
  marginBottom: 22,
  padding: 16,
  borderRadius: 10,
  background: 'var(--ant-color-fill-quaternary, rgba(0, 0, 0, 0.02))',
  border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
}

const minorWorkDrawerSectionHeading: React.CSSProperties = {
  marginBottom: 14,
  paddingBottom: 10,
  borderBottom: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
}

const MaintenanceMinorWorkPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { user } = useAuth()
  const [list, setList] = useState<MinorWorkOrder[]>([])
  const [listTotal, setListTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [listStatusFilter, setListStatusFilter] = useState<MwListStatusFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm] = Form.useForm()
  /** 与 Form 解耦：onChange 时表单可能已是新日期，用 ref 判断是否真的「换日」。 */
  const dueAtLastDayKeyRef = useRef<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<MinorWorkOrder | null>(null)
  const [editForm] = Form.useForm()
  const editDueAtLastDayKeyRef = useRef<string | null>(null)
  /** Modal + destroyOnClose 下子 Form 晚于父 effect 挂载，用 ref 在 afterOpenChange 再 setFieldsValue */
  const editRecordRef = useRef<MinorWorkOrder | null>(null)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const listNow = useNowEverySecond()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [order, setOrder] = useState<MinorWorkOrder | null>(null)
  const [tracks, setTracks] = useState<MinorWorkTrack[]>([])
  const [dispatchAttachments, setDispatchAttachments] = useState<DispatchAttachmentDto[]>([])
  const [trackAttachments, setTrackAttachments] = useState<MinorWorkTrackAttachmentDto[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [dispatchForm] = Form.useForm()
  const [assignDeptForm] = Form.useForm()
  const [workerDayForm] = Form.useForm()
  const [assignDeptSubmitting, setAssignDeptSubmitting] = useState(false)
  const [workerDaySubmitting, setWorkerDaySubmitting] = useState(false)
  const [workerDays, setWorkerDays] = useState<MinorWorkWorkerDayRow[]>([])
  const [confirmDispatchLoading, setConfirmDispatchLoading] = useState(false)
  const [trackForm] = Form.useForm()
  const [trackProgress, setTrackProgress] = useState(30)
  const [trackSubmitting, setTrackSubmitting] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [closeNote, setCloseNote] = useState('')
  const [closeLoading, setCloseLoading] = useState(false)
  const [dispatchAttachUploading, setDispatchAttachUploading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewBlob, setPreviewBlob] = useState<{ url: string; name: string } | null>(null)
  const [dingSubmittingId, setDingSubmittingId] = useState<number | null>(null)
  const [drawerDingSubmitting, setDrawerDingSubmitting] = useState(false)
  const [handlerUserRows, setHandlerUserRows] = useState<AssigneeUserRow[]>([])
  const [constructionWorkerRows, setConstructionWorkerRows] = useState<AssigneeUserRow[]>([])
  const [handlerInactiveRef, setHandlerInactiveRef] = useState<AssigneeInactiveRef[]>([])
  const [handlerUsersLoading, setHandlerUsersLoading] = useState(false)
  const [listColVisibility, setListColVisibility] = useState(loadMinorWorkListColVisibility)
  const [listSort, setListSort] = useState<{
    columnKey: MinorWorkListColKey
    order: 'ascend' | 'descend'
  } | null>(null)

  const handlerSelectOptions = useMemo(
    () => buildConstructionAssigneeOptions(handlerUserRows, handlerInactiveRef),
    [handlerUserRows, handlerInactiveRef],
  )
  const handlerDisplayMap = useMemo(() => assigneeLabelMap(handlerSelectOptions), [handlerSelectOptions])

  const constructionWorkerSelectOptions = useMemo(
    () =>
      constructionWorkerRows.map((u) => ({
        value: u.username,
        label: labelForAssigneeUsername(u.username, u.real_name),
      })),
    [constructionWorkerRows],
  )
  const constructionWorkerDisplayMap = useMemo(
    () => assigneeLabelMap(constructionWorkerSelectOptions),
    [constructionWorkerSelectOptions],
  )

  /** 列表施工人员列：只展示姓名（无姓名则用登录名），不含「姓名 (登录名)」格式 */
  const userRealNameOnlyMap = useMemo(() => {
    const m = new Map<string, string>()
    const put = (username: string, realName: string | null | undefined) => {
      const un = username.trim()
      if (!un) return
      const rn = (realName ?? '').trim()
      m.set(un, rn || un)
    }
    for (const u of handlerUserRows) put(u.username, u.real_name)
    for (const u of constructionWorkerRows) put(u.username, u.real_name)
    for (const ir of handlerInactiveRef) put(ir.username, ir.real_name)
    return m
  }, [handlerUserRows, constructionWorkerRows, handlerInactiveRef])

  useEffect(() => {
    let cancelled = false
    setHandlerUsersLoading(true)
    void axios
      .get<{
        list: AssigneeUserRow[]
        inactive_referenced?: AssigneeInactiveRef[]
        construction_worker_user_options?: AssigneeUserRow[]
      }>('/api/minor-works/handler-user-options')
      .then((res) => {
        if (cancelled) return
        setHandlerUserRows(res.data?.list ?? [])
        setConstructionWorkerRows(res.data?.construction_worker_user_options ?? [])
        setHandlerInactiveRef(res.data?.inactive_referenced ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setHandlerUserRows([])
        setHandlerInactiveRef([])
      })
      .finally(() => {
        if (!cancelled) setHandlerUsersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handlerDisplayLabel = useMemo(() => {
    const h = sanitizeNullableText(order?.handler)
    if (!h) return null
    return handlerDisplayMap.get(h) ?? h
  }, [order?.handler, handlerDisplayMap])

  const constructionWorkersDisplay = useMemo(() => {
    if (workerDays.length > 0) {
      return (
        <>
          {workerDays.map((d, idx) => {
            const names = (d.construction_workers ?? [])
              .map((u) => sanitizeNullableText(u))
              .filter((x): x is string => Boolean(x))
              .map((u) => constructionWorkerDisplayMap.get(u) ?? handlerDisplayMap.get(u) ?? u)
              .join('、')
            return (
              <React.Fragment
                key={`${d.id ?? 0}-${d.work_date}-${normalizeMinorWorkWorkerPeriodUi(d.work_period)}-${idx}`}
              >
                {idx > 0 ? '； ' : null}
                <span>
                  {d.work_date}（{minorWorkPeriodTagEl(d.work_period)}）：{names || '（未指定）'}
                </span>
              </React.Fragment>
            )
          })}
        </>
      )
    }
    const arr = order?.construction_workers ?? []
    if (!arr.length) return null
    const line = arr
      .map((u) => sanitizeNullableText(u))
      .filter((x): x is string => Boolean(x))
      .map((u) => constructionWorkerDisplayMap.get(u) ?? handlerDisplayMap.get(u) ?? u)
      .join('、')
    return line || null
  }, [workerDays, order?.construction_workers, constructionWorkerDisplayMap, handlerDisplayMap])

  const closePreview = useCallback(() => {
    setPreviewBlob((b) => {
      if (b?.url) URL.revokeObjectURL(b.url)
      return null
    })
    setPreviewOpen(false)
  }, [])

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (keyword) params.keyword = keyword
      if (listStatusFilter !== 'all') params.list_status = listStatusFilter
      const res = await axios.get<{ list: MinorWorkOrder[]; total: number }>('/api/minor-works', {
        params,
      })
      setList(res.data.list ?? [])
      setListTotal(Number(res.data.total) || (res.data.list ?? []).length)
      setListSort(null)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, listStatusFilter, msg])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  useEffect(() => {
    if (createOpen) {
      const def = defaultDueAtHour18()
      createForm.setFieldValue('due_at', def)
      dueAtLastDayKeyRef.current = def.format('YYYY-MM-DD')
    }
  }, [createOpen, createForm])

  const fillEditFormFromRecord = useCallback(
    (rec: MinorWorkOrder) => {
      const d = parseDueAtHourPickerValue(rec.due_at)
      editForm.setFieldsValue({
        title: rec.title,
        customer_name: sanitizeNullableText(rec.customer_name) ?? '',
        due_at: d,
        project_amount: rec.project_amount ?? undefined,
        cost_budget: rec.cost_budget ?? undefined,
      })
      editDueAtLastDayKeyRef.current = d ? d.format('YYYY-MM-DD') : null
    },
    [editForm],
  )

  const loadDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true)
      try {
        const res = await axios.get<{
          order: MinorWorkOrder
          tracks: MinorWorkTrack[]
          worker_days?: MinorWorkWorkerDayRow[]
          dispatchAttachments?: DispatchAttachmentDto[]
          trackAttachments?: MinorWorkTrackAttachmentDto[]
          audit?: GateAudit
        }>(`/api/minor-works/${id}`)
        setOrder({ ...res.data.order, audit: res.data.audit })
        setTracks(res.data.tracks ?? [])
        setWorkerDays(Array.isArray(res.data.worker_days) ? res.data.worker_days : [])
        setDispatchAttachments(res.data.dispatchAttachments ?? [])
        setTrackAttachments(res.data.trackAttachments ?? [])
        const o = res.data.order
        const planDefault = parseMinorPlanDateDefault(o.plan_date, o.due_at)
        assignDeptForm.setFieldsValue({
          handler: o.handler?.trim() ? o.handler.trim() : undefined,
        })
        workerDayForm.setFieldsValue({
          work_date: dayjs(),
          construction_workers: [],
          work_period: 'full_day',
          worker_day_id: undefined,
        })
        dispatchForm.setFieldsValue({
          plan_date: planDefault,
          dispatch_note: sanitizeNullableText(o.dispatch_note) ?? '',
        })
        const nextProg = Math.min(100, Math.max(5, o.progress + 10))
        setTrackProgress(nextProg)
        trackForm.resetFields()
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载详情失败')
      } finally {
        setDetailLoading(false)
      }
    },
    [assignDeptForm, workerDayForm, dispatchForm, msg, trackForm],
  )

  const trackAttachmentsByTrackId = useMemo(() => {
    const m: Record<number, MinorWorkTrackAttachmentDto[]> = {}
    for (const a of trackAttachments) {
      if (!m[a.track_id]) m[a.track_id] = []
      m[a.track_id].push(a)
    }
    for (const k of Object.keys(m)) {
      m[Number(k)].sort((x, y) => x.id - y.id)
    }
    return m
  }, [trackAttachments])

  useEffect(() => {
    if (drawerOpen && detailId != null) {
      void loadDetail(detailId)
    }
  }, [drawerOpen, detailId, loadDetail])

  const openDetail = useCallback((r: MinorWorkOrder) => {
    setDetailId(r.id)
    setDrawerOpen(true)
  }, [])

  const handleCreate = async () => {
    try {
      const v = await createForm.validateFields()
      const due = v.due_at ? dayjs(v.due_at).startOf('hour') : null
      const createRes = await axios.post<{ audit?: GateAudit }>('/api/minor-works', {
        title: v.title,
        customer_name: v.customer_name?.trim() || undefined,
        due_at: due ? due.format('YYYY-MM-DD HH:00') : undefined,
        content: v.content,
        precautions: v.precautions?.trim() || undefined,
        project_amount: v.project_amount ?? null,
        cost_budget: v.cost_budget ?? null,
      })
      const gate = createRes.data?.audit?.dingtalk_gate
      const st = createRes.data?.audit?.audit_status
      msg.success(
        gate && st === 'draft'
          ? '已创建。审批通过后请先指定部门负责人，即可填写派单信息；负责人可按日补全施工人员，闭环前须在至少一个施工日有人员'
          : '已创建。请先指定部门负责人，即可填写派单信息；负责人可按日补全施工人员，闭环前须在至少一个施工日有人员',
      )
      setCreateOpen(false)
      createForm.resetFields()
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '创建失败')
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
      const res = await axios.put<MinorWorkOrder & { audit?: GateAudit }>(`/api/minor-works/${editRecord.id}`, {
        title: v.title,
        customer_name: (v.customer_name ?? '').trim() || null,
        due_at: due.format('YYYY-MM-DD HH:00'),
        project_amount: v.project_amount ?? null,
        cost_budget: v.cost_budget ?? null,
        content: editRecord.content,
        precautions: editRecord.precautions ?? undefined,
      })
      msg.success('已保存')
      const savedId = editRecord.id
      setEditOpen(false)
      setEditRecord(null)
      editForm.resetFields()
      fetchList()
      if (drawerOpen && detailId === savedId && res.data) {
        setOrder({ ...res.data, audit: res.data.audit })
      }
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setEditSubmitting(false)
    }
  }

  const submitAssignDept = async () => {
    if (!detailId || !order) return
    const hadHandler = minorWorkHasHandler(order)
    try {
      const v = await assignDeptForm.validateFields(['handler'])
      setAssignDeptSubmitting(true)
      const res = await axios.post<{
        order: MinorWorkOrder
        tracks: MinorWorkTrack[]
        worker_days?: MinorWorkWorkerDayRow[]
        dispatchAttachments?: DispatchAttachmentDto[]
      }>(`/api/minor-works/${detailId}/assign-handler`, {
        handler: v.handler,
      })
      const no = res.data.order
      setOrder({ ...no, audit: no.audit })
      setTracks(res.data.tracks ?? [])
      setWorkerDays(Array.isArray(res.data.worker_days) ? res.data.worker_days : [])
      setDispatchAttachments(res.data.dispatchAttachments ?? [])
      assignDeptForm.setFieldsValue({
        handler: no.handler?.trim() || undefined,
      })
      workerDayForm.setFieldsValue({
        work_date: dayjs(),
        construction_workers: [],
        work_period: 'full_day',
        worker_day_id: undefined,
      })
      msg.success(
        order.status === 'pending'
          ? hadHandler
            ? '已调整部门负责人'
            : '已分配到部门'
          : hadHandler
            ? '已转派部门负责人'
            : '已指定部门负责人',
      )
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setAssignDeptSubmitting(false)
    }
  }

  const submitWorkerDaySave = async () => {
    if (!detailId || !order) return
    if (!minorWorkHasHandler(order)) {
      msg.warning('请先在「① 分配到部门」中指定部门负责人')
      return
    }
    try {
      const v = await workerDayForm.validateFields(['work_date', 'work_period', 'construction_workers'])
      setWorkerDaySubmitting(true)
      const workDate = dayjs(v.work_date).format('YYYY-MM-DD')
      const wid = v.worker_day_id
      const res = await axios.post<{
        order: MinorWorkOrder
        tracks: MinorWorkTrack[]
        worker_days?: MinorWorkWorkerDayRow[]
        dispatchAttachments?: DispatchAttachmentDto[]
      }>(`/api/minor-works/${detailId}/worker-days`, {
        work_date: workDate,
        work_period: normalizeMinorWorkWorkerPeriodUi(v.work_period != null ? String(v.work_period) : 'full_day'),
        construction_workers: Array.isArray(v.construction_workers) ? v.construction_workers : [],
        ...(typeof wid === 'number' && wid > 0 ? { worker_day_id: wid } : {}),
      })
      const no = res.data.order
      setOrder({ ...no, audit: no.audit })
      setTracks(res.data.tracks ?? [])
      setWorkerDays(Array.isArray(res.data.worker_days) ? res.data.worker_days : [])
      setDispatchAttachments(res.data.dispatchAttachments ?? [])
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
    async (row: MinorWorkWorkerDayRow) => {
      if (!detailId || !order) return
      if (!minorWorkHasHandler(order)) return
      setWorkerDaySubmitting(true)
      try {
        const res = await axios.post<{
          order: MinorWorkOrder
          tracks: MinorWorkTrack[]
          worker_days?: MinorWorkWorkerDayRow[]
          dispatchAttachments?: DispatchAttachmentDto[]
        }>(`/api/minor-works/${detailId}/worker-days`, {
          work_date: row.work_date,
          construction_workers: [],
          ...(row.id != null && row.id > 0 ? { worker_day_id: row.id } : {}),
        })
        const no = res.data.order
        setOrder({ ...no, audit: no.audit })
        setTracks(res.data.tracks ?? [])
        setWorkerDays(Array.isArray(res.data.worker_days) ? res.data.worker_days : [])
        setDispatchAttachments(res.data.dispatchAttachments ?? [])
        msg.success('已删除该条记录')
        fetchList()
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
      } finally {
        setWorkerDaySubmitting(false)
      }
    },
    [detailId, order, msg, fetchList],
  )

  const fillWorkerDayForm = useCallback(
    (d: MinorWorkWorkerDayRow) => {
      workerDayForm.setFieldsValue({
        work_date: dayjs(d.work_date),
        work_period: normalizeMinorWorkWorkerPeriodUi(d.work_period),
        construction_workers: Array.isArray(d.construction_workers) ? [...d.construction_workers] : [],
        worker_day_id: d.id != null && d.id > 0 ? d.id : undefined,
      })
    },
    [workerDayForm],
  )

  const workerDayListColumns = useMemo<ColumnsType<MinorWorkWorkerDayRow>>(
    () => [
      { title: '施工日期', dataIndex: 'work_date', key: 'work_date', width: 120 },
      {
        title: '工时',
        key: 'period',
        width: 100,
        render: (_, r) => minorWorkPeriodTagEl(r.work_period),
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

  const workerDayReadOnlyColumns = useMemo<ColumnsType<MinorWorkWorkerDayRow>>(
    () => [
      { title: '施工日期', dataIndex: 'work_date', key: 'work_date', width: 120 },
      {
        title: '工时',
        key: 'period',
        width: 100,
        render: (_, r) => minorWorkPeriodTagEl(r.work_period),
      },
      {
        title: '施工人员',
        key: 'w',
        render: (_, r) => {
          const names = (r.construction_workers ?? []).map((u) => userRealNameOnlyMap.get(u) ?? u).join('、')
          return names || '—'
        },
      },
    ],
    [userRealNameOnlyMap],
  )

  const confirmDispatch = async () => {
    if (!detailId || !order) return
    if (!minorWorkHasHandler(order)) {
      msg.warning('请先完成「① 分配到部门」指定部门负责人')
      return
    }
    try {
      const v = await dispatchForm.validateFields()
      setConfirmDispatchLoading(true)
      await axios.post<MinorWorkOrder>(`/api/minor-works/${detailId}/confirm-dispatch`, {
        plan_date: v.plan_date ? dayjs(v.plan_date).startOf('hour').format('YYYY-MM-DD HH:00') : null,
        dispatch_note: (v.dispatch_note ?? '').trim(),
      })
      msg.success('派单已确认，部门负责人可进行跟踪记录')
      await loadDetail(detailId)
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '派单失败')
    } finally {
      setConfirmDispatchLoading(false)
    }
  }

  const submitTrack = async () => {
    if (!detailId) return
    try {
      const v = await trackForm.validateFields()
      setTrackSubmitting(true)
      const res = await axios.post<{ order: MinorWorkOrder; tracks: MinorWorkTrack[] }>(
        `/api/minor-works/${detailId}/tracks`,
        { content: v.track_content, progress_after: trackProgress },
      )
      const no = res.data.order
      setOrder({ ...no, audit: no.audit })
      setTracks(res.data.tracks)
      trackForm.resetFields()
      try {
        const d = await axios.get<{ trackAttachments?: MinorWorkTrackAttachmentDto[] }>(`/api/minor-works/${detailId}`)
        setTrackAttachments(d.data.trackAttachments ?? [])
      } catch {
        /* 忽略附图列表刷新失败 */
      }
      msg.success('已保存跟踪记录')
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setTrackSubmitting(false)
    }
  }

  const submitClose = async () => {
    if (!detailId || !order) return
    if (!minorWorkHasConstructionWorkers(order)) {
      msg.warning('闭环前须至少在某一施工日指定人员，请先在「② 按日分派施工人员」或「转派 · 按日施工人员」中补全')
      return
    }
    setCloseLoading(true)
    try {
      const res = await axios.post<MinorWorkOrder & { audit?: GateAudit; tracks?: MinorWorkTrack[] }>(
        `/api/minor-works/${detailId}/close`,
        {
          close_note: closeNote.trim() || null,
          progress: 100,
        },
      )
      const { tracks: nextTracks, ...orderRest } = res.data
      setOrder({ ...orderRest, audit: orderRest.audit })
      if (Array.isArray(nextTracks)) setTracks(nextTracks)
      setCloseOpen(false)
      setCloseNote('')
      msg.success('已闭环')
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '闭环失败')
    } finally {
      setCloseLoading(false)
    }
  }

  const submitMinorWorkDingTalk = useCallback(
    async (id: number, fromDrawer?: boolean) => {
      if (fromDrawer) setDrawerDingSubmitting(true)
      else setDingSubmittingId(id)
      try {
        await axios.post(`/api/minor-works/${id}/dingtalk/submit`)
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
    [msg, detailId, loadDetail, fetchList],
  )

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await axios.delete(`/api/minor-works/${id}`)
        msg.success('已删除')
        if (detailId === id) {
          closePreview()
          setDrawerOpen(false)
        }
        fetchList()
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
      }
    },
    [msg, detailId, closePreview, fetchList],
  )

  const openDispatchPreview = useCallback(
    async (att: DispatchAttachmentDto) => {
      if (!detailId) return
      try {
        const res = await axios.get(`/api/minor-works/${detailId}/dispatch-attachments/${att.id}/preview`, {
          responseType: 'blob',
        })
        const url = URL.createObjectURL(res.data)
        setPreviewBlob((old) => {
          if (old?.url) URL.revokeObjectURL(old.url)
          return { url, name: att.file_name }
        })
        setPreviewOpen(true)
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '预览失败')
      }
    },
    [detailId, msg],
  )

  const openTrackAttachmentPreview = useCallback(
    async (att: MinorWorkTrackAttachmentDto) => {
      if (!detailId) return
      try {
        const res = await axios.get(
          `/api/minor-works/${detailId}/tracks/${att.track_id}/attachments/${att.id}/preview`,
          { responseType: 'blob' },
        )
        const url = URL.createObjectURL(res.data)
        setPreviewBlob((old) => {
          if (old?.url) URL.revokeObjectURL(old.url)
          return { url, name: att.file_name }
        })
        setPreviewOpen(true)
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '预览失败')
      }
    },
    [detailId, msg],
  )

  const downloadTrackAttachment = useCallback(
    async (att: MinorWorkTrackAttachmentDto) => {
      if (!detailId) return
      try {
        const res = await axios.get(
          `/api/minor-works/${detailId}/tracks/${att.track_id}/attachments/${att.id}/file`,
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

  const downloadDispatchAttachment = useCallback(
    async (att: DispatchAttachmentDto) => {
      if (!detailId) return
      try {
        const res = await axios.get(`/api/minor-works/${detailId}/dispatch-attachments/${att.id}/file`, {
          responseType: 'blob',
        })
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

  const deleteDispatchAttachment = useCallback(
    async (attId: number) => {
      if (!detailId) return
      try {
        await axios.delete(`/api/minor-works/${detailId}/dispatch-attachments/${attId}`)
        msg.success('已删除')
        await loadDetail(detailId)
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
      }
    },
    [detailId, loadDetail, msg],
  )

  const uploadDispatchImageFile = useCallback(
    async (file: File) => {
      if (!detailId) return
      if (!minorWorkDispatchFormEnabled(order?.audit, order ?? null)) {
        msg.warning(
          !minorWorkHasHandler(order)
            ? '请先完成「① 分配到部门」指定部门负责人'
            : '须先在钉钉完成审批通过后，方可上传派单图片',
        )
        return
      }
      const err = validateDispatchImageFile(file)
      if (err) {
        msg.error(err)
        return
      }
      setDispatchAttachUploading(true)
      try {
        const fd = new FormData()
        fd.append('file', file)
        await axios.post(`/api/minor-works/${detailId}/dispatch-attachments`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        msg.success('图片已上传')
        await loadDetail(detailId)
      } catch (e: unknown) {
        msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '上传失败')
      } finally {
        setDispatchAttachUploading(false)
      }
    },
    [detailId, loadDetail, msg, order],
  )

  const beforeUploadDispatchImage = useCallback(
    (file: File) => {
      if (!detailId) return Upload.LIST_IGNORE
      void uploadDispatchImageFile(file)
      return false
    },
    [detailId, uploadDispatchImageFile],
  )

  const onDispatchNotePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!detailId || !minorWorkDispatchFormEnabled(order?.audit, order ?? null)) return
      const cd = e.clipboardData
      if (!cd) return

      if (cd.files && cd.files.length > 0) {
        for (let i = 0; i < cd.files.length; i++) {
          const f = cd.files[i]
          if (f.type.startsWith('image/')) {
            e.preventDefault()
            void uploadDispatchImageFile(f)
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
              void uploadDispatchImageFile(f)
              return
            }
          }
        }
      }
    },
    [detailId, order, uploadDispatchImageFile],
  )

  const onDispatchNoteDragOver = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      if (!detailId || !minorWorkDispatchFormEnabled(order?.audit, order ?? null)) return
      if (Array.from(e.dataTransfer.types ?? []).includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    },
    [detailId, order],
  )

  const onDispatchNoteDrop = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      if (!detailId || !minorWorkDispatchFormEnabled(order?.audit, order ?? null)) return
      e.preventDefault()
      const list = e.dataTransfer.files
      if (!list?.length) return
      void (async () => {
        for (let i = 0; i < list.length; i++) {
          const f = list[i]
          if (f.type.startsWith('image/')) {
            await uploadDispatchImageFile(f)
          }
        }
      })()
    },
    [detailId, order, uploadDispatchImageFile],
  )

  const dispatchAttachmentColumns: ColumnsType<DispatchAttachmentDto> = useMemo(
    () => [
      {
        title: '文件名',
        dataIndex: 'file_name',
        ellipsis: true,
        render: (v: string) => drawerDisplayText(v, '（无文件名）'),
      },
      { title: '大小', width: 88, render: (_, r) => formatFileSize(Number(r.file_size) || 0) },
      { title: '上传时间', width: 156, render: (_, r) => formatMinorWorkCreatedAt(r.created_at) },
      {
        title: '操作',
        width: order?.status === 'pending' ? 228 : 168,
        onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        render: (_, r) => (
          <Space size="small">
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => void openDispatchPreview(r)}>
              预览
            </Button>
            <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => void downloadDispatchAttachment(r)}>
              下载
            </Button>
            {order?.status === 'pending' && minorWorkDispatchFormEnabled(order?.audit, order ?? null) ? (
              <Popconfirm title="确定删除该图片？" onConfirm={() => void deleteDispatchAttachment(r.id)}>
                <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            ) : null}
          </Space>
        ),
      },
    ],
    [order, openDispatchPreview, downloadDispatchAttachment, deleteDispatchAttachment],
  )

  const updateListColVisibility = useCallback((key: MinorWorkListColKey, checked: boolean) => {
    setListColVisibility((prev) => {
      const next = { ...prev, [key]: checked }
      try {
        localStorage.setItem(MINOR_WORK_LIST_COLS_LS, JSON.stringify(next))
      } catch {
        /* 忽略存储失败 */
      }
      return next
    })
  }, [])

  const resetListColVisibility = useCallback(() => {
    const next = defaultMinorWorkListColVisibility()
    setListColVisibility(next)
    try {
      localStorage.setItem(MINOR_WORK_LIST_COLS_LS, JSON.stringify(next))
    } catch {
      /* 忽略 */
    }
  }, [])

  const filtered = useMemo(() => {
    if (!listSort) return list
    const dir = listSort.order === 'ascend' ? 1 : -1
    return [...list].sort(
      (a, b) => dir * compareMinorWorkListRows(a, b, listSort.columnKey),
    )
  }, [list, listSort])

  const listTableScrollX = useMemo(() => {
    let w = 168
    for (const k of MINOR_WORK_LIST_COL_ORDER) {
      if (listColVisibility[k]) w += MINOR_WORK_LIST_COL_WIDTH[k]
    }
    return Math.max(w, 640)
  }, [listColVisibility])

  const columns: ColumnsType<MinorWorkOrder> = useMemo(() => {
    const withSort = (k: MinorWorkListColKey, col: ColumnType<MinorWorkOrder>): ColumnType<MinorWorkOrder> => ({
      ...col,
      key: k,
      showSorterTooltip: { title: '点击切换升序 / 降序' },
      sorter: (a: MinorWorkOrder, b: MinorWorkOrder) => compareMinorWorkListRows(a, b, k),
      sortOrder: listSort?.columnKey === k ? listSort.order : undefined,
    })

    const dataColsOrdered: { key: MinorWorkListColKey; col: ColumnType<MinorWorkOrder> }[] = [
      {
        key: 'code',
        col: { title: '编号', dataIndex: 'code', width: MINOR_WORK_LIST_COL_WIDTH.code },
      },
      {
        key: 'title',
        col: { title: '事项标题', dataIndex: 'title', ellipsis: true, width: MINOR_WORK_LIST_COL_WIDTH.title },
      },
      {
        key: 'customer',
        col: {
          title: '客户名称',
          width: MINOR_WORK_LIST_COL_WIDTH.customer,
          ellipsis: true,
          render: (_: unknown, r: MinorWorkOrder) =>
            sanitizeNullableText(r.customer_name) || sanitizeNullableText(r.applicant) || '—',
        },
      },
      {
        key: 'due_at',
        col: {
          title: '截止时间',
          dataIndex: 'due_at',
          width: MINOR_WORK_LIST_COL_WIDTH.due_at,
          render: (v: string | null, r: MinorWorkOrder) =>
            r.status === 'closed' ? formatDueAtText(v) : <DueCountdownCell dueAt={v} now={listNow} />,
        },
      },
      {
        key: 'project_amount',
        col: {
          title: '工程金额',
          width: MINOR_WORK_LIST_COL_WIDTH.project_amount,
          align: 'right',
          render: (_: unknown, r: MinorWorkOrder) => formatMoney(r.project_amount),
        },
      },
      {
        key: 'cost_budget',
        col: {
          title: '成本预算',
          width: MINOR_WORK_LIST_COL_WIDTH.cost_budget,
          align: 'right',
          render: (_: unknown, r: MinorWorkOrder) => formatMoney(r.cost_budget),
        },
      },
      {
        key: 'progress',
        col: {
          title: '进度',
          dataIndex: 'progress',
          width: MINOR_WORK_LIST_COL_WIDTH.progress,
          render: (v: number) => <Progress percent={v} size="small" />,
        },
      },
      {
        key: 'status',
        col: {
          title: '状态',
          dataIndex: 'status',
          width: MINOR_WORK_LIST_COL_WIDTH.status,
          render: (_: MinorWorkStatus, r: MinorWorkOrder) => mwStatusCell(r),
        },
      },
      {
        key: 'completion_timing',
        col: {
          title: '完成情况',
          width: MINOR_WORK_LIST_COL_WIDTH.completion_timing,
          render: (_: unknown, r: MinorWorkOrder) => mwCompletionTimingCell(r),
        },
      },
      {
        key: 'handler',
        col: {
          title: '部门负责人',
          dataIndex: 'handler',
          width: MINOR_WORK_LIST_COL_WIDTH.handler,
          ellipsis: true,
          render: (v: string | null) => {
            const username = sanitizeNullableText(v)
            if (!username) return <Text type="secondary">待分配</Text>
            return handlerDisplayMap.get(username) ?? username
          },
        },
      },
      {
        key: 'construction_workers',
        col: {
          title: '施工人员',
          width: MINOR_WORK_LIST_COL_WIDTH.construction_workers,
          ellipsis: true,
          render: (_: unknown, r: MinorWorkOrder) => {
            const arr = r.construction_workers ?? []
            if (!arr.length) return <Text type="secondary">待分配</Text>
            return arr.map((u) => userRealNameOnlyMap.get(u) ?? u).join('、')
          },
        },
      },
      {
        key: 'audit',
        col: {
          title: '审批',
          width: MINOR_WORK_LIST_COL_WIDTH.audit,
          render: (_: unknown, r: MinorWorkOrder) => {
            const lab = minorWorkAuditLabel(r.audit)
            return lab ? <Tag color={lab.color}>{lab.text}</Tag> : <Text type="secondary">—</Text>
          },
        },
      },
    ]

    const actionCol: ColumnType<MinorWorkOrder> = {
      title: '操作',
      width: 168,
      fixed: 'right',
      render: (_: unknown, r: MinorWorkOrder) => (
        <Space size={[4, 4]} wrap>
          <a onClick={() => openDetail(r)}>办理</a>
          {canEditMinorWorkBasicInfo(r) ? (
            <a
              onClick={() => {
                editRecordRef.current = r
                setEditRecord(r)
                setEditOpen(true)
              }}
            >
              编辑
            </a>
          ) : null}
          {canSubmitMinorWorkDingTalk(r.audit) ? (
            <a
              onClick={() => void submitMinorWorkDingTalk(r.id)}
              style={{
                opacity: dingSubmittingId === r.id ? 0.5 : 1,
                pointerEvents: dingSubmittingId === r.id ? 'none' : undefined,
              }}
            >
              {dingSubmittingId === r.id ? '提交中…' : '提交钉钉审批'}
            </a>
          ) : null}
          {canDeleteMinorWorkWithAudit(r.audit) ? (
            <Popconfirm title="确定删除该条？" onConfirm={() => void handleDelete(r.id)}>
              <Link type="danger">删除</Link>
            </Popconfirm>
          ) : (
            <Text type="danger" style={{ opacity: 0.45 }}>
              删除
            </Text>
          )}
        </Space>
      ),
    }

    return [
      ...dataColsOrdered
        .filter((d) => listColVisibility[d.key])
        .map((d) => withSort(d.key, d.col)),
      actionCol,
    ]
  }, [
    listColVisibility,
    listSort,
    listNow,
    handlerDisplayMap,
    userRealNameOnlyMap,
    dingSubmittingId,
    openDetail,
    submitMinorWorkDingTalk,
    handleDelete,
  ])

  const workflowSteps = (
    <Steps
      current={order ? stepCurrent(order.status) : 0}
      items={[
        { title: '分配与派单', description: '指定部门负责人后即可填计划与说明；施工人员按日补全', icon: <FormOutlined /> },
        { title: '部门负责人跟踪与说明', description: '过程记录与进度', icon: <SendOutlined /> },
        { title: '闭环', description: '完成确认', icon: <CheckCircleOutlined /> },
      ]}
      style={{ marginBottom: 0 }}
    />
  )

  const handleExportExcel = useCallback(async () => {
    const exportTotal = listTotal || list.length
    if (!exportTotal) {
      msg.warning('暂无可导出的零星工程')
      return
    }
    if (exportTotal > EXPORT_EXCEL_MAX_ROWS) {
      msg.warning(`当前 ${exportTotal} 条，超过导出上限 ${EXPORT_EXCEL_MAX_ROWS} 条，请先筛选后再导出`)
      return
    }
    setExportingExcel(true)
    try {
      const params = new URLSearchParams()
      if (keyword.trim()) params.set('keyword', keyword.trim())
      if (listStatusFilter !== 'all') params.set('list_status', listStatusFilter)
      const token = user?.token
      const res = await fetch(`/api/minor-works/export-excel?${params.toString()}`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { message?: string }).message || '导出失败')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `零星工程_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      msg.success(`已导出 ${exportTotal} 条（当前筛选下全部数据）`)
    } catch (e: unknown) {
      msg.error((e as Error)?.message || '导出失败')
    } finally {
      setExportingExcel(false)
    }
  }, [keyword, list.length, listStatusFilter, listTotal, msg, user?.token])

  return (
    <Card>
      <Space style={{ marginBottom: 16 }} wrap>
        <Title level={5} style={{ margin: 0 }}>
          <ToolOutlined style={{ marginRight: 8 }} />
          零星工程
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          ① 指定部门负责人后即可填写派单；② 按日分派施工人员，闭环前须至少一日有人员。已派单后可转派。流程：① → 派单 → 跟踪 → 闭环
        </Text>
        <Search
          placeholder="搜索编号/标题/客户/内容/截止时间"
          allowClear
          onSearch={setKeyword}
          style={{ width: 300 }}
        />
        <Segmented<MwListStatusFilter>
          value={listStatusFilter}
          onChange={(v) => setListStatusFilter(v)}
          options={[
            { label: '全部', value: 'all' },
            { label: '未闭环', value: 'open' },
            { label: '已闭环', value: 'done' },
            { label: '过期完成', value: 'overdue_done' },
          ]}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建事项
        </Button>
        <Button icon={<DownloadOutlined />} loading={exportingExcel} onClick={() => void handleExportExcel()}>
          导出 Excel
        </Button>
        <Popover
          title="列表列显示"
          trigger="click"
          placement="bottomLeft"
          content={
            <div style={{ maxWidth: 280 }}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                {MINOR_WORK_LIST_COL_ORDER.map((colKey) => (
                  <Checkbox
                    key={colKey}
                    checked={listColVisibility[colKey]}
                    onChange={(e) => updateListColVisibility(colKey, e.target.checked)}
                  >
                    {MINOR_WORK_LIST_COL_LABEL[colKey]}
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

      <Table
        rowKey="id"
        dataSource={filtered}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        size="middle"
        scroll={{ x: listTableScrollX }}
        sortDirections={['ascend', 'descend']}
        onChange={(_pagination, _filters, sorter) => {
          const s = Array.isArray(sorter) ? sorter[0] : sorter
          const ck = s?.columnKey
          const ord = s?.order
          if (
            typeof ck === 'string' &&
            MINOR_WORK_LIST_COL_ORDER.includes(ck as MinorWorkListColKey) &&
            (ord === 'ascend' || ord === 'descend')
          ) {
            setListSort({ columnKey: ck as MinorWorkListColKey, order: ord })
          } else {
            setListSort(null)
          }
        }}
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
            // 再等一帧，确保 destroyOnClose 后 Form 已挂到 Modal 内
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
          key={editRecord ? `edit-${editRecord.id}` : 'edit-closed'}
          form={editForm}
          layout="vertical"
          preserve={false}
        >
          <Form.Item name="title" label="事项标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="简要概括" />
          </Form.Item>
          <Form.Item name="customer_name" label="客户名称">
            <Input placeholder="选填" allowClear />
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
          <Form.Item
            name="project_amount"
            label="工程金额"
            extra="选填，留空按 0 处理。"
          >
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="元" addonAfter="元" />
          </Form.Item>
          <Form.Item
            name="cost_budget"
            label="成本预算"
            extra="选填，留空按 0 处理。"
          >
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="元" addonAfter="元" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新建零星工程"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        destroyOnClose
        width={600}
      >
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item name="title" label="事项标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="简要概括" />
          </Form.Item>
          <Form.Item name="customer_name" label="客户名称">
            <Input placeholder="选填" allowClear />
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
          <Form.Item name="content" label="事项内容" rules={[{ required: true, message: '请填写事项内容' }]}>
            <TextArea rows={4} placeholder="现象、范围、工作量等" />
          </Form.Item>
          <Form.Item name="precautions" label="注意事项">
            <TextArea rows={3} placeholder="安全、断电、客户在场要求等（选填）" />
          </Form.Item>
          <Form.Item
            name="project_amount"
            label="工程金额"
            extra="选填，留空按 0 处理。"
          >
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="元" addonAfter="元" />
          </Form.Item>
          <Form.Item
            name="cost_budget"
            label="成本预算"
            extra="选填，留空按 0 处理。"
          >
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="元" addonAfter="元" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={
          order
            ? `${drawerDisplayText(order.code, '—')} · ${drawerDisplayText(order.title, '—')}`
            : '办理'
        }
        open={drawerOpen}
        onClose={() => {
          closePreview()
          setDrawerOpen(false)
        }}
        width="min(92vw, 1100px)"
        styles={{ body: { paddingTop: 24, paddingBottom: 32, paddingInline: 28 } }}
        destroyOnClose
        extra={
          order ? (
            <Space>
              {canSubmitMinorWorkDingTalk(order.audit) ? (
                <Button
                  loading={drawerDingSubmitting}
                  onClick={() => void submitMinorWorkDingTalk(order.id, true)}
                >
                  提交钉钉审批
                </Button>
              ) : null}
              {order.status !== 'pending' &&
              order.status !== 'closed' &&
              minorWorkOpsUnlocked(order.audit) &&
              minorWorkHasConstructionWorkers(order) ? (
                <Button type="primary" onClick={() => setCloseOpen(true)}>
                  确认闭环
                </Button>
              ) : null}
            </Space>
          ) : null
        }
      >
        <Spin spinning={detailLoading}>
          {order && (
          <>
            <div style={{ marginBottom: 18 }}>{workflowSteps}</div>
            <div style={{ marginBottom: 18 }}>
              {order.audit?.dingtalk_gate && !minorWorkOpsUnlocked(order.audit) ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="已启用钉钉审批"
                  description="须审批通过后方可确认派单、上传派单图片、填写跟踪记录与闭环。请先完成 ① 指定部门负责人即可派单；② 按日补全施工人员。请在列表或上方提交钉钉流程。"
                />
              ) : null}
              {order.status === 'pending' && !minorWorkHasHandler(order) && canEditMinorWorkWithAudit(order.audit) ? (
                <Alert
                  type="info"
                  showIcon
                  message="请先完成 ① 分配到部门"
                  description="在下方「① 分配到部门」选择部门负责人并保存后，即可填写计划、派单说明与上传附件并确认派单。建议在派单前后于「② 按日分派施工人员」中补全；闭环结项前须在至少一个施工日有人员。"
                />
              ) : null}
              {order.status !== 'pending' &&
              order.status !== 'closed' &&
              minorWorkOpsUnlocked(order.audit) &&
              !minorWorkHasConstructionWorkers(order) ? (
                <Alert
                  type="warning"
                  showIcon
                  message="闭环前须按日补全施工人员"
                  description="请在下方「② 按日分派施工人员」或「转派 · 按日施工人员」中至少为一个施工日指定人员（须已绑定钉钉 userId 的在职用户）后，方可确认闭环。"
                />
              ) : null}
            </div>

            <div style={minorWorkDrawerSectionShell}>
              <div style={minorWorkDrawerSectionHeading}>
                <Title level={5} style={{ margin: 0 }}>
                  工程概况
                </Title>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                  状态、客户、金额、计划与事项内容等；施工人员（按日）为各施工日人员汇总展示。
                </Text>
              </div>
              <Descriptions
              bordered
              size="middle"
              column={2}
              style={{ marginBottom: 0 }}
              labelStyle={{
                minWidth: 140,
                width: 140,
                whiteSpace: 'nowrap',
                verticalAlign: 'top',
              }}
              contentStyle={{ minWidth: 0, wordBreak: 'break-word', verticalAlign: 'top' }}
            >
              <Descriptions.Item label="状态">{mwStatusCell(order)}</Descriptions.Item>
              {order.status === 'closed' ? (
                <Descriptions.Item label="完成情况">{mwCompletionTimingCell(order)}</Descriptions.Item>
              ) : null}
              {order.audit?.dingtalk_gate ? (
                <Descriptions.Item label="钉钉审批">
                  {(() => {
                    const lab = minorWorkAuditLabel(order.audit)
                    return lab ? <Tag color={lab.color}>{lab.text}</Tag> : '—'
                  })()}
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label="进度">
                <Progress percent={drawerProgressPercent(order.progress)} size="small" />
              </Descriptions.Item>
              <Descriptions.Item label="客户名称">
                {sanitizeNullableText(order.customer_name) || sanitizeNullableText(order.applicant) || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="截止时间">{formatDueAtText(order.due_at)}</Descriptions.Item>
              <Descriptions.Item label="工程金额">{formatMoney(order.project_amount)}</Descriptions.Item>
              <Descriptions.Item label="成本预算">{formatMoney(order.cost_budget)}</Descriptions.Item>
              <Descriptions.Item label="登记日期">{formatMinorWorkCreatedAt(order.created_at)}</Descriptions.Item>
              <Descriptions.Item label="部门负责人">
                {handlerDisplayLabel ?? <Text type="secondary">待分配</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="施工人员（按日）" span={2}>
                {constructionWorkersDisplay ?? <Text type="secondary">待分配</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="计划完成">{formatDueAtText(order.plan_date)}</Descriptions.Item>
              <Descriptions.Item label="实际完成">{formatDueAtText(order.finish_date)}</Descriptions.Item>
              <Descriptions.Item label="事项内容" span={2}>
                <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                  {drawerDisplayText(order.content, '—')}
                </Paragraph>
              </Descriptions.Item>
              <Descriptions.Item label="注意事项" span={2}>
                <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                  {drawerDisplayText(order.precautions, '—')}
                </Paragraph>
              </Descriptions.Item>
              {order.status !== 'pending' ? (
                <Descriptions.Item label="派单说明" span={2}>
                  <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                    {drawerDisplayText(order.dispatch_note, '—')}
                  </Paragraph>
                </Descriptions.Item>
              ) : null}
              {order.status !== 'pending' && dispatchAttachments.length > 0 ? (
                <Descriptions.Item label="派单图片附件" span={2}>
                  <Table
                    size="middle"
                    rowKey="id"
                    dataSource={dispatchAttachments}
                    columns={dispatchAttachmentColumns}
                    pagination={false}
                  />
                </Descriptions.Item>
              ) : null}
              {order.status === 'closed' ? (
                <Descriptions.Item label="闭环说明" span={2}>
                  <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                    {drawerDisplayText(order.close_note, '—')}
                  </Paragraph>
                </Descriptions.Item>
              ) : null}
            </Descriptions>
            </div>

            <div style={minorWorkDrawerSectionShell}>
              <div style={minorWorkDrawerSectionHeading}>
                <Title level={5} style={{ margin: 0 }}>
                  办理
                </Title>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                  待派单：① 部门与按日人员 → ③ 确认派单；执行中：转派、按日人员与跟踪；闭环后仅只读。
                </Text>
              </div>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {order.status === 'closed' ? (
              <Card size="small" title="施工人员（按日）" style={{ marginBottom: 0 }}>
                <Table<MinorWorkWorkerDayRow>
                  size="small"
                  rowKey={(r) =>
                    `${r.id ?? 0}-${r.work_date}-${normalizeMinorWorkWorkerPeriodUi(r.work_period)}`
                  }
                  dataSource={workerDays}
                  columns={workerDayReadOnlyColumns}
                  pagination={false}
                  locale={{ emptyText: '无按日施工记录（详见上方汇总）' }}
                />
              </Card>
            ) : null}

            {(order.status === 'dispatched' || order.status === 'in_progress') &&
            canEditMinorWorkWithAudit(order.audit) ? (
              <>
                <Card
                  size="small"
                  title="转派 · 部门负责人"
                  style={{ marginBottom: 0 }}
                  extra={<Text type="secondary" style={{ fontSize: 12 }}>写入跟踪时间线</Text>}
                >
                  <Form form={assignDeptForm} layout="vertical" style={{ maxWidth: 420 }}>
                    <Form.Item
                      name="handler"
                      label="部门负责人"
                      rules={[{ required: true, message: '请选择部门负责人' }]}
                      extra="将任务分配到部门，由该负责人在下一步按日指定施工人员。"
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="在职系统用户"
                        options={handlerSelectOptions}
                        loading={handlerUsersLoading}
                      />
                    </Form.Item>
                    <Button type="primary" loading={assignDeptSubmitting} onClick={() => void submitAssignDept()}>
                      保存部门负责人
                    </Button>
                  </Form>
                </Card>
                <Card size="small" title="转派 · 按日施工人员" style={{ marginBottom: 0 }}>
                  {!minorWorkHasHandler(order) ? (
                    <Text type="secondary">请先在「转派 · 部门负责人」中指定部门负责人。</Text>
                  ) : (
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      <Table<MinorWorkWorkerDayRow>
                        size="small"
                        rowKey={(r) =>
                          `${r.id ?? 0}-${r.work_date}-${normalizeMinorWorkWorkerPeriodUi(r.work_period)}`
                        }
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
                          extra="按自然日分派。该日在库里已有记录时，不带已选条目保存会新增一条（不同人、不同时长均可）；要改已有条目请先在表格点「填入表单」再保存。"
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
                          extra="须已绑定钉钉 userId。闭环前须在至少一个施工日指定人员（各日并集校验）。"
                        >
                          <Select
                            mode="multiple"
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            placeholder="选择施工人员"
                            options={constructionWorkerSelectOptions}
                            loading={handlerUsersLoading}
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
              </>
            ) : null}

            {order.status === 'pending' && canEditMinorWorkWithAudit(order.audit) ? (
              <>
                <Card
                  size="small"
                  title="① 分配到部门（部门负责人）"
                  style={{ marginBottom: 0 }}
                  extra={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      须先完成本步，方可填写下方派单
                    </Text>
                  }
                >
                  <Form form={assignDeptForm} layout="vertical" style={{ maxWidth: 420 }}>
                    <Form.Item
                      name="handler"
                      label="部门负责人"
                      rules={[{ required: true, message: '请选择部门负责人' }]}
                      extra="选择接收本单的部门负责人（不在此步选择具体施工人员）。"
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="在职系统用户"
                        options={handlerSelectOptions}
                        loading={handlerUsersLoading}
                      />
                    </Form.Item>
                    <Button type="primary" loading={assignDeptSubmitting} onClick={() => void submitAssignDept()}>
                      {minorWorkHasHandler(order) ? '保存部门负责人' : '确认分配到部门'}
                    </Button>
                  </Form>
                </Card>
                <Card size="small" title="② 部门负责人按日分派施工人员" style={{ marginBottom: 0 }}>
                  {!minorWorkHasHandler(order) ? (
                    <Text type="secondary">请先完成上方「① 分配到部门」并保存。</Text>
                  ) : (
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      <Table<MinorWorkWorkerDayRow>
                        size="small"
                        rowKey={(r) =>
                          `${r.id ?? 0}-${r.work_date}-${normalizeMinorWorkWorkerPeriodUi(r.work_period)}`
                        }
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
                          extra="按自然日分派。该日在库里已有记录时，不带已选条目保存会新增一条（不同人、不同时长均可）；要改已有条目请先在表格点「填入表单」再保存。"
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
                          extra="须已绑定钉钉 userId。闭环前须在至少一个施工日指定人员。"
                        >
                          <Select
                            mode="multiple"
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            placeholder="选择施工人员"
                            options={constructionWorkerSelectOptions}
                            loading={handlerUsersLoading}
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
              </>
            ) : null}

            {order.status === 'pending' && (
              <Card title="③ 确认派单" style={{ marginBottom: 0 }}>
                <Form form={dispatchForm} layout="vertical">
                  <Form.Item
                    name="plan_date"
                    label="计划完成日期"
                    rules={[{ required: true, message: '请选择计划完成时间（精确到小时）' }]}
                    extra="默认与上方「截止时间」一致（含整点时刻），可按需调整。须已指定部门负责人且审批通过后方可编辑。"
                  >
                    <DatePicker
                      style={{ width: '100%' }}
                      showTime={{
                        format: 'HH',
                        showSecond: false,
                        disabledMinutes: () => Array.from({ length: 59 }, (_, i) => i + 1),
                        disabledSeconds: () => Array.from({ length: 59 }, (_, i) => i + 1),
                      }}
                      format="YYYY-MM-DD HH:00"
                      disabled={!minorWorkDispatchFormEnabled(order.audit, order)}
                    />
                  </Form.Item>
                  <Form.Item
                    name="dispatch_note"
                    label="派单补充说明"
                    extra="可在本框内 Ctrl+V 粘贴截图，或将图片文件拖入框内上传为附件（与下方「上传图片」相同）。"
                    rules={[
                      { required: true, message: '请填写派单补充说明' },
                      {
                        validator: (_, v) =>
                          v != null && String(v).trim()
                            ? Promise.resolve()
                            : Promise.reject(new Error('派单补充说明不能为空')),
                      },
                    ]}
                  >
                    <TextArea
                      rows={4}
                      placeholder="派单备注、工具材料、到场要求等；可在此框粘贴截图或拖入图片"
                      onPaste={onDispatchNotePaste}
                      onDragOver={onDispatchNoteDragOver}
                      onDrop={onDispatchNoteDrop}
                      disabled={!minorWorkDispatchFormEnabled(order.audit, order)}
                    />
                  </Form.Item>
                  <Form.Item
                    label="派单补充说明图片"
                    extra="选填；支持 jpg、png、gif、webp、bmp、tiff；单张不超过 8MB。可在上方说明框内粘贴/拖放，或使用本按钮上传。仅待派单时可上传或删除，派单后仅可预览与下载。"
                  >
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      <Upload
                        accept={DISPATCH_IMAGE_ACCEPT}
                        showUploadList={false}
                        beforeUpload={beforeUploadDispatchImage}
                        disabled={!minorWorkDispatchFormEnabled(order.audit, order)}
                      >
                        <Button
                          icon={<UploadOutlined />}
                          loading={dispatchAttachUploading}
                          disabled={!minorWorkDispatchFormEnabled(order.audit, order)}
                        >
                          上传图片
                        </Button>
                      </Upload>
                      {dispatchAttachments.length > 0 ? (
                        <Table
                          size="middle"
                          rowKey="id"
                          dataSource={dispatchAttachments}
                          columns={dispatchAttachmentColumns}
                          pagination={false}
                        />
                      ) : null}
                    </Space>
                  </Form.Item>
                  <Button
                    type="primary"
                    loading={confirmDispatchLoading}
                    onClick={confirmDispatch}
                    disabled={!minorWorkDispatchFormEnabled(order.audit, order)}
                  >
                    确认派单
                  </Button>
                </Form>
              </Card>
            )}

            {order.status !== 'pending' && (
              <Card title="④ 部门负责人跟踪与说明" style={{ marginBottom: 0 }}>
                {tracks.length === 0 ? (
                  <Text type="secondary">暂无跟踪记录，请填写下方说明并保存。</Text>
                ) : (
                  <Timeline style={{ marginBottom: 16 }}>
                    {tracks.map((t) => {
                      const tk = t.track_kind || 'track'
                      const lineColor =
                        tk === 'close'
                          ? 'green'
                          : tk === 'assign'
                            ? 'green'
                            : tk === 'reassign'
                              ? 'cyan'
                              : 'blue'
                      const kindLabel = TRACK_KIND_LABEL[tk] ?? '跟踪'
                      const tAtts = trackAttachmentsByTrackId[t.id] ?? []
                      const by = sanitizeNullableText(t.created_by)
                      const byLabel = by ? ` · ${handlerDisplayMap.get(by) ?? by}` : ''
                      const prog =
                        t.progress_after != null && Number.isFinite(Number(t.progress_after))
                          ? ` · 进度 ${Math.round(Number(t.progress_after))}%`
                          : ''
                      return (
                        <Timeline.Item key={t.id} color={lineColor}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {formatMinorWorkCreatedAt(t.created_at)} · {kindLabel}
                            {byLabel}
                            {prog}
                          </Text>
                          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
                            {drawerDisplayText(t.content, '（无说明）')}
                          </div>
                          {tAtts.length > 0 && detailId != null ? (
                            <Space wrap size={[12, 12]} style={{ marginTop: 8 }}>
                              {tAtts.map((att) => (
                                <MinorTrackAttachmentRow
                                  key={att.id}
                                  orderId={detailId}
                                  att={att}
                                  onOpenPreview={openTrackAttachmentPreview}
                                  onDownload={downloadTrackAttachment}
                                />
                              ))}
                            </Space>
                          ) : null}
                        </Timeline.Item>
                      )
                    })}
                  </Timeline>
                )}
                {order.status !== 'closed' ? (
                  <>
                    <Form form={trackForm} layout="vertical">
                      <Form.Item
                        name="track_content"
                        label="本次跟踪说明"
                        rules={[{ required: true, message: '请填写说明' }]}
                      >
                        <TextArea
                          rows={4}
                          placeholder="现场进展、问题、协调结果等"
                          disabled={!minorWorkOpsUnlocked(order.audit)}
                        />
                      </Form.Item>
                      <Form.Item label="更新后进度（%）">
                        <Slider
                          min={0}
                          max={100}
                          value={trackProgress}
                          onChange={setTrackProgress}
                          marks={{ 0: '0', 100: '100' }}
                          disabled={!minorWorkOpsUnlocked(order.audit)}
                        />
                      </Form.Item>
                      <Button
                        type="primary"
                        loading={trackSubmitting}
                        onClick={submitTrack}
                        icon={<SendOutlined />}
                        disabled={!minorWorkOpsUnlocked(order.audit)}
                      >
                        保存跟踪记录
                      </Button>
                    </Form>
                  </>
                ) : (
                  <Tag color="success">已闭环</Tag>
                )}
              </Card>
            )}

            {order.status === 'closed' && (
              <Card title="闭环" style={{ marginBottom: 0 }}>
                <Text>本单已于 {formatDueAtText(order.finish_date)} 闭环。</Text>
              </Card>
            )}
              </Space>
            </div>
          </>
          )}
        </Spin>
      </Drawer>

      <Modal
        title="确认闭环"
        open={closeOpen}
        onCancel={() => setCloseOpen(false)}
        onOk={submitClose}
        confirmLoading={closeLoading}
        okText="确认闭环"
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          闭环后进度将记为 100%，并记录完成日期。可填写总结说明。须在至少一个施工日已指定施工人员。
        </Text>
        <TextArea rows={4} value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="闭环说明（可选）" />
      </Modal>

      <Modal
        title={previewBlob?.name ?? '图片预览'}
        open={previewOpen}
        onCancel={closePreview}
        footer={null}
        width={720}
        destroyOnClose
      >
        {previewBlob?.url ? (
          <img
            src={previewBlob.url}
            alt={previewBlob.name}
            style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto', objectFit: 'contain' }}
          />
        ) : null}
      </Modal>
    </Card>
  )
}

export default MaintenanceMinorWorkPage
