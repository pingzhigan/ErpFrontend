/**
 * 维护管理 - 零星工程
 * 业务流：① 分配/转派执行人 → ② 派单确认（计划与说明）→ ③ 跟踪 → ④ 闭环。分配与转派写入跟踪时间线（track_kind）。
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
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
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
  type AssigneeInactiveRef,
  type AssigneeUserRow,
} from '../utils/constructionAssigneeOptions'
import { parseDueAtHourPickerValue } from '../utils/dueAtHourPickerParse'

const { Title, Text, Paragraph } = Typography
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
  if (!s?.trim()) return '—'
  const v = s.trim().replace('T', ' ')
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
}

/** 与后端一致：任意状态可改基本信息；钉钉门禁下审批中不可编辑 */
function canEditMinorWorkBasicInfo(r: MinorWorkOrder): boolean {
  return canEditMinorWorkWithAudit(r.audit)
}

function minorWorkHasHandler(order: MinorWorkOrder | null | undefined): boolean {
  return Boolean(order?.handler?.trim())
}

/** 待派单阶段：审批通过且已分配执行人时，可填计划/说明、上传派单附件 */
function minorWorkDispatchFormEnabled(audit: GateAudit | undefined, order: MinorWorkOrder | null): boolean {
  return Boolean(order && order.status === 'pending' && minorWorkOpsUnlocked(audit) && minorWorkHasHandler(order))
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
  if (file.size > 8 * 1024 * 1024) {
    return '图片大小不能超过 8MB'
  }
  return null
}

const STATUS_MAP: Record<MinorWorkStatus, { color: string; label: string }> = {
  pending: { color: 'default', label: '待派单' },
  dispatched: { color: 'blue', label: '已派单' },
  in_progress: { color: 'processing', label: '执行中' },
  closed: { color: 'success', label: '已闭环' },
}

function formatMoney(n: number | null | undefined) {
  return n != null && Number.isFinite(n)
    ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'
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
        <Text ellipsis style={{ fontSize: 12, maxWidth: 240 }} title={att.file_name}>
          {att.file_name}
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

const MaintenanceMinorWorkPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<MinorWorkOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
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
  const [assignHandlerForm] = Form.useForm()
  const [assignHandlerSubmitting, setAssignHandlerSubmitting] = useState(false)
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
  const [handlerInactiveRef, setHandlerInactiveRef] = useState<AssigneeInactiveRef[]>([])
  const [handlerUsersLoading, setHandlerUsersLoading] = useState(false)

  const handlerSelectOptions = useMemo(
    () => buildConstructionAssigneeOptions(handlerUserRows, handlerInactiveRef),
    [handlerUserRows, handlerInactiveRef],
  )

  useEffect(() => {
    if (!drawerOpen) return
    let cancelled = false
    setHandlerUsersLoading(true)
    void axios
      .get<{ list: AssigneeUserRow[]; inactive_referenced?: AssigneeInactiveRef[] }>('/api/minor-works/handler-user-options')
      .then((res) => {
        if (cancelled) return
        setHandlerUserRows(res.data?.list ?? [])
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
  }, [drawerOpen])

  const handlerDisplayLabel = useMemo(() => {
    const h = order?.handler?.trim()
    if (!h) return null
    return assigneeLabelMap(handlerSelectOptions).get(h) ?? h
  }, [order?.handler, handlerSelectOptions])

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
      const res = await axios.get<{ list: MinorWorkOrder[] }>('/api/minor-works', {
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
        customer_name: rec.customer_name ?? '',
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
          dispatchAttachments?: DispatchAttachmentDto[]
          trackAttachments?: MinorWorkTrackAttachmentDto[]
          audit?: GateAudit
        }>(`/api/minor-works/${id}`)
        setOrder({ ...res.data.order, audit: res.data.audit })
        setTracks(res.data.tracks ?? [])
        setDispatchAttachments(res.data.dispatchAttachments ?? [])
        setTrackAttachments(res.data.trackAttachments ?? [])
        const o = res.data.order
        const planDefault = parseMinorPlanDateDefault(o.plan_date, o.due_at)
        assignHandlerForm.setFieldsValue({
          handler: o.handler?.trim() ? o.handler.trim() : undefined,
        })
        dispatchForm.setFieldsValue({
          plan_date: planDefault,
          dispatch_note: o.dispatch_note ?? '',
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
    [assignHandlerForm, dispatchForm, msg, trackForm],
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

  const openDetail = (r: MinorWorkOrder) => {
    setDetailId(r.id)
    setDrawerOpen(true)
  }

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
          ? '已创建。审批通过后请先在详情「分配任务」指定执行人，再确认派单与跟踪'
          : '已创建。请先在详情「分配任务」指定执行人，再确认派单',
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

  const submitAssignHandler = async () => {
    if (!detailId || !order) return
    const wasHandler = Boolean(order.handler?.trim())
    try {
      const v = await assignHandlerForm.validateFields()
      setAssignHandlerSubmitting(true)
      const res = await axios.post<{
        order: MinorWorkOrder
        tracks: MinorWorkTrack[]
        dispatchAttachments?: DispatchAttachmentDto[]
      }>(`/api/minor-works/${detailId}/assign-handler`, { handler: v.handler })
      const no = res.data.order
      setOrder({ ...no, audit: no.audit })
      setTracks(res.data.tracks ?? [])
      setDispatchAttachments(res.data.dispatchAttachments ?? [])
      assignHandlerForm.setFieldsValue({ handler: no.handler?.trim() || undefined })
      msg.success(wasHandler ? '已转派' : '已分配')
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setAssignHandlerSubmitting(false)
    }
  }

  const confirmDispatch = async () => {
    if (!detailId || !order) return
    if (!minorWorkHasHandler(order)) {
      msg.warning('请先分配执行人')
      return
    }
    try {
      const v = await dispatchForm.validateFields()
      setConfirmDispatchLoading(true)
      await axios.post<MinorWorkOrder>(`/api/minor-works/${detailId}/confirm-dispatch`, {
        plan_date: v.plan_date ? dayjs(v.plan_date).startOf('hour').format('YYYY-MM-DD HH:00') : null,
        dispatch_note: (v.dispatch_note ?? '').trim(),
      })
      msg.success('派单已确认，执行人可进行跟踪记录')
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
    if (!detailId) return
    setCloseLoading(true)
    try {
      const res = await axios.post<MinorWorkOrder & { audit?: GateAudit }>(`/api/minor-works/${detailId}/close`, {
        close_note: closeNote.trim() || null,
        progress: 100,
      })
      const no = res.data
      setOrder({ ...no, audit: no.audit })
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

  const submitMinorWorkDingTalk = async (id: number, fromDrawer?: boolean) => {
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
  }

  const handleDelete = async (id: number) => {
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
  }

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
            ? '请先分配执行人'
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
      { title: '文件名', dataIndex: 'file_name', ellipsis: true },
      { title: '大小', width: 88, render: (_, r) => formatFileSize(Number(r.file_size) || 0) },
      { title: '上传时间', width: 156, dataIndex: 'created_at' },
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

  const filtered = useMemo(() => list, [list])

  const columns: ColumnsType<MinorWorkOrder> = [
    { title: '编号', dataIndex: 'code', width: 118 },
    { title: '事项标题', dataIndex: 'title', ellipsis: true, width: 200 },
    {
      title: '客户名称',
      width: 120,
      ellipsis: true,
      render: (_, r) => r.customer_name || r.applicant || '—',
    },
    {
      title: '截止时间',
      dataIndex: 'due_at',
      width: 208,
      render: (v: string | null) => <DueCountdownCell dueAt={v} now={listNow} />,
    },
    {
      title: '工程金额',
      width: 120,
      align: 'right',
      render: (_: unknown, r: MinorWorkOrder) => formatMoney(r.project_amount),
    },
    {
      title: '成本预算',
      width: 120,
      align: 'right',
      render: (_: unknown, r: MinorWorkOrder) => formatMoney(r.cost_budget),
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
      width: 88,
      render: (v: MinorWorkStatus) => {
        const s = STATUS_MAP[v] ?? { color: 'default', label: v }
        return <Tag color={s.color}>{s.label}</Tag>
      },
    },
    {
      title: '执行人',
      dataIndex: 'handler',
      width: 112,
      ellipsis: true,
      render: (v: string | null) => (v?.trim() ? v : <Text type="secondary">待分配</Text>),
    },
    {
      title: '审批',
      key: 'audit',
      width: 100,
      render: (_: unknown, r: MinorWorkOrder) => {
        const lab = minorWorkAuditLabel(r.audit)
        return lab ? <Tag color={lab.color}>{lab.text}</Tag> : <Text type="secondary">—</Text>
      },
    },
    {
      title: '操作',
      width: 168,
      fixed: 'right',
      render: (_, r) => (
        <Space size={[4, 4]} wrap>
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
          <a onClick={() => openDetail(r)}>办理</a>
          {canSubmitMinorWorkDingTalk(r.audit) ? (
            <a
              onClick={() => void submitMinorWorkDingTalk(r.id)}
              style={{ opacity: dingSubmittingId === r.id ? 0.5 : 1, pointerEvents: dingSubmittingId === r.id ? 'none' : undefined }}
            >
              {dingSubmittingId === r.id ? '提交中…' : '提交钉钉审批'}
            </a>
          ) : null}
          {canDeleteMinorWorkWithAudit(r.audit) ? (
            <Popconfirm title="确定删除该条？" onConfirm={() => handleDelete(r.id)}>
              <a style={{ color: 'var(--ant-colorError)' }}>删除</a>
            </Popconfirm>
          ) : (
            <Text type="secondary">删除</Text>
          )}
        </Space>
      ),
    },
  ]

  const workflowSteps = (
    <Steps
      current={order ? stepCurrent(order.status) : 0}
      items={[
        { title: '分配与派单', description: '执行人、计划与说明', icon: <FormOutlined /> },
        { title: '执行人跟踪与说明', description: '过程记录与进度', icon: <SendOutlined /> },
        { title: '闭环', description: '完成确认', icon: <CheckCircleOutlined /> },
      ]}
      style={{ marginBottom: 28 }}
    />
  )

  return (
    <Card>
      <Space style={{ marginBottom: 16 }} wrap>
        <Title level={5} style={{ margin: 0 }}>
          <ToolOutlined style={{ marginRight: 8 }} />
          零星工程
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          须先「分配任务」指定执行人，再确认派单（计划与说明）；已派单后可「转派」。流程：分配 → 派单确认 → 跟踪 → 闭环
        </Text>
        <Search
          placeholder="搜索编号/标题/客户/内容/截止时间"
          allowClear
          onSearch={setKeyword}
          style={{ width: 300 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建事项
        </Button>
      </Space>

      <Table
        rowKey="id"
        dataSource={filtered}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        size="middle"
        scroll={{ x: 1360 }}
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
            rules={[{ required: true, message: '请填写工程金额' }]}
          >
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="元" addonAfter="元" />
          </Form.Item>
          <Form.Item
            name="cost_budget"
            label="成本预算"
            rules={[{ required: true, message: '请填写成本预算' }]}
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
            rules={[{ required: true, message: '请填写工程金额' }]}
          >
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="元" addonAfter="元" />
          </Form.Item>
          <Form.Item
            name="cost_budget"
            label="成本预算"
            rules={[{ required: true, message: '请填写成本预算' }]}
          >
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="元" addonAfter="元" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={order ? `${order.code} · ${order.title}` : '办理'}
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
              {order.status !== 'pending' && order.status !== 'closed' && minorWorkOpsUnlocked(order.audit) ? (
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
            {workflowSteps}
            {order.audit?.dingtalk_gate && !minorWorkOpsUnlocked(order.audit) ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="已启用钉钉审批"
                description="须审批通过后方可确认派单、上传派单图片、填写跟踪记录与闭环。请先完成「分配任务」指定执行人。请在列表或上方提交钉钉流程。"
              />
            ) : null}
            {order.status === 'pending' && !minorWorkHasHandler(order) && canEditMinorWorkWithAudit(order.audit) ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="请先分配任务"
                description="在下方选择执行人并点击「确认分配」后，方可填写计划、派单说明与上传附件，并确认派单。"
              />
            ) : null}
            <Descriptions
              bordered
              size="middle"
              column={2}
              style={{ marginBottom: 24 }}
              labelStyle={{
                minWidth: 140,
                width: 140,
                whiteSpace: 'nowrap',
                verticalAlign: 'top',
              }}
              contentStyle={{ minWidth: 0, wordBreak: 'break-word', verticalAlign: 'top' }}
            >
              <Descriptions.Item label="状态">
                <Tag color={STATUS_MAP[order.status]?.color}>{STATUS_MAP[order.status]?.label}</Tag>
              </Descriptions.Item>
              {order.audit?.dingtalk_gate ? (
                <Descriptions.Item label="钉钉审批">
                  {(() => {
                    const lab = minorWorkAuditLabel(order.audit)
                    return lab ? <Tag color={lab.color}>{lab.text}</Tag> : '—'
                  })()}
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label="进度">
                <Progress percent={order.progress} size="small" />
              </Descriptions.Item>
              <Descriptions.Item label="客户名称">
                {order.customer_name || order.applicant || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="截止时间">{order.due_at ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="工程金额">{formatMoney(order.project_amount)}</Descriptions.Item>
              <Descriptions.Item label="成本预算">{formatMoney(order.cost_budget)}</Descriptions.Item>
              <Descriptions.Item label="登记日期">{formatMinorWorkCreatedAt(order.created_at)}</Descriptions.Item>
              <Descriptions.Item label="执行人">
                {handlerDisplayLabel ?? <Text type="secondary">待分配</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="计划完成">{order.plan_date ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="实际完成">{order.finish_date ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="事项内容" span={2}>
                <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{order.content}</Paragraph>
              </Descriptions.Item>
              {order.precautions ? (
                <Descriptions.Item label="注意事项" span={2}>
                  <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{order.precautions}</Paragraph>
                </Descriptions.Item>
              ) : null}
              {order.dispatch_note && (
                <Descriptions.Item label="派单说明" span={2}>
                  {order.dispatch_note}
                </Descriptions.Item>
              )}
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
              {order.close_note && (
                <Descriptions.Item label="闭环说明" span={2}>
                  {order.close_note}
                </Descriptions.Item>
              )}
            </Descriptions>

            {(order.status === 'dispatched' || order.status === 'in_progress') &&
            canEditMinorWorkWithAudit(order.audit) ? (
              <Card
                size="small"
                title="转派任务"
                style={{ marginBottom: 24 }}
                extra={<Text type="secondary" style={{ fontSize: 12 }}>改派后写入跟踪时间线</Text>}
              >
                <Form form={assignHandlerForm} layout="vertical" style={{ maxWidth: 420 }}>
                  <Form.Item name="handler" label="执行人" rules={[{ required: true, message: '请选择执行人' }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="在职系统用户"
                      options={handlerSelectOptions}
                      loading={handlerUsersLoading}
                    />
                  </Form.Item>
                  <Button type="primary" loading={assignHandlerSubmitting} onClick={() => void submitAssignHandler()}>
                    确认转派
                  </Button>
                </Form>
              </Card>
            ) : null}

            {order.status === 'pending' && canEditMinorWorkWithAudit(order.audit) ? (
              <Card
                size="small"
                title={minorWorkHasHandler(order) ? '分配任务（可调整执行人）' : '分配任务'}
                style={{ marginBottom: 24 }}
                extra={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    须先完成本步，再填写下方计划与派单说明
                  </Text>
                }
              >
                <Form form={assignHandlerForm} layout="vertical" style={{ maxWidth: 420 }}>
                  <Form.Item name="handler" label="执行人" rules={[{ required: true, message: '请选择执行人' }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="在职系统用户"
                      options={handlerSelectOptions}
                      loading={handlerUsersLoading}
                    />
                  </Form.Item>
                  <Button type="primary" loading={assignHandlerSubmitting} onClick={() => void submitAssignHandler()}>
                    {minorWorkHasHandler(order) ? '确认调整' : '确认分配'}
                  </Button>
                </Form>
              </Card>
            ) : null}

            {order.status === 'pending' && (
              <Card title="② 确认派单" style={{ marginBottom: 24 }}>
                <Form form={dispatchForm} layout="vertical">
                  <Form.Item
                    name="plan_date"
                    label="计划完成日期"
                    rules={[{ required: true, message: '请选择计划完成时间（精确到小时）' }]}
                    extra="默认与上方「截止时间」一致（含整点时刻），可按需调整。须已分配执行人且审批通过后方可编辑。"
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
              <Card title="③ 执行人跟踪与说明" style={{ marginBottom: 24 }}>
                {tracks.length === 0 ? (
                  <Text type="secondary">暂无跟踪记录，请填写下方说明并保存。</Text>
                ) : (
                  <Timeline style={{ marginBottom: 20 }}>
                    {tracks.map((t) => {
                      const tk = t.track_kind || 'track'
                      const lineColor =
                        tk === 'assign' ? 'green' : tk === 'reassign' ? 'cyan' : 'blue'
                      const kindLabel = TRACK_KIND_LABEL[tk] ?? '跟踪'
                      const tAtts = trackAttachmentsByTrackId[t.id] ?? []
                      return (
                        <Timeline.Item key={t.id} color={lineColor}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {t.created_at} · {kindLabel}
                            {t.created_by ? ` · ${t.created_by}` : ''}
                            {t.progress_after != null ? ` · 进度 ${t.progress_after}%` : ''}
                          </Text>
                          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{t.content}</div>
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
              <Card title="③ 闭环">
                <Text>本单已于 {order.finish_date ?? '—'} 闭环。</Text>
              </Card>
            )}
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
          闭环后进度将记为 100%，并记录完成日期。可填写总结说明。
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
