/**
 * 功能名称：施工日志
 * 实现原理与逻辑：记录施工日志，包括项目名称、日期、天气、出勤人数、工作内容、施工难点、帮助协调、备注等。支持按项目名称、日期、天气、出勤人数、工作内容、施工难点、帮助协调、备注等筛选。支持按日期排序。支持导出为 Excel 文件。
 */


import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, DatePicker, Descriptions, Divider, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import axios from 'axios'
import { useAuth } from '../auth/AuthContext'

const { Title, Paragraph, Text } = Typography
const { Search } = Input

// 施工日志接口
interface LogEntry {
  id: number
  project: string
  date: string
  weather: string
  recorder: string
  workers: number
  workContent: string
  difficulties: string
  coordination: string
  remark: string
}

// 天气映射
const WEATHER_MAP: Record<string, string> = {
  sunny: '☀️ 晴',
  cloudy: '⛅ 多云',
  rainy: '🌧️ 雨',
  overcast: '☁️ 阴',
}

// 天气标签转换为天气键
const WEATHER_LABEL_TO_KEY: Record<string, keyof typeof WEATHER_MAP> = {
  晴: 'sunny',
  多云: 'cloudy',
  雨: 'rainy',
  阴: 'overcast',
}

type WeatherKey = keyof typeof WEATHER_MAP

type ParsedLog = {
  project: string
  weather: WeatherKey
  workers: number
  workContent: string
  difficulties: string
  coordination: string
  remark: string
}

// 按行解析；多行内容从「标签：」起直到下一个「标签：」行之前都归为该字段，避免工作内容等被截断
const LABEL_TO_FIELD: { labels: string[]; field: keyof ParsedLog }[] = [
  { labels: ['项目名称', '项目', '工程', '项目名'], field: 'project' },
  { labels: ['天气'], field: 'weather' },
  { labels: ['出勤人数', '出勤', '人数'], field: 'workers' },
  { labels: ['工作内容', '施工内容', '今日工作', '内容'], field: 'workContent' },
  { labels: ['施工难点', '难点', '问题', '风险'], field: 'difficulties' },
  { labels: ['帮助协调', '协调', '需协调', '支持'], field: 'coordination' },
  { labels: ['备注', '其他备注', '其他', '说明'], field: 'remark' },
]

// 所有「标签：」前缀，按长度降序，以便优先匹配更长标签（如「项目名称」先于「项目」）
const LINE_LABEL_PREFIXES: { prefix: string; len: number; field: keyof ParsedLog }[] = (() => {
  const list: { prefix: string; len: number; field: keyof ParsedLog }[] = []
  for (const { labels, field } of LABEL_TO_FIELD) {
    for (const l of labels) {
      const p = l + '：'
      list.push({ prefix: p, len: p.length, field })
      if (l + ':' !== p) list.push({ prefix: l + ':', len: l.length + 1, field })
    }
  }
  list.sort((a, b) => b.len - a.len)
  return list
})()

function lineStartsWithLabel(line: string): { field: keyof ParsedLog; valueStartLen: number } | null {
  for (const { prefix, len, field } of LINE_LABEL_PREFIXES) {
    if (line.startsWith(prefix)) return { field, valueStartLen: len }
  }
  return null
}

function parseLogFromText(text: string): Partial<ParsedLog> {
  const raw = (text || '').trim()
  if (!raw) return {}

  const result: Partial<ParsedLog> = {}
  const lines = raw.split(/\r?\n/)

  let i = 0
  while (i < lines.length) {
    const labelHit = lineStartsWithLabel(lines[i])
    if (!labelHit) {
      i += 1
      continue
    }
    const { field, valueStartLen } = labelHit
    let value = lines[i].slice(valueStartLen)
    i += 1
    while (i < lines.length && !lineStartsWithLabel(lines[i])) {
      value += '\n' + lines[i]
      i += 1
    }
    value = value.trim()

    if (field === 'weather') {
      const label = (Object.keys(WEATHER_LABEL_TO_KEY) as (keyof typeof WEATHER_LABEL_TO_KEY)[]).find((k) => value === k || value.includes(k))
      result.weather = (label ? WEATHER_LABEL_TO_KEY[label] : 'sunny') as WeatherKey
    } else if (field === 'workers') {
      const n = Number(String(value).replace(/[^\d.]/g, ''))
      if (Number.isFinite(n)) result.workers = Math.max(0, Math.round(n))
    } else {
      ;(result as Record<string, string>)[field] = value
    }
  }

  if (result.weather == null) {
    const weatherLabel = raw.includes('多云') ? '多云' : raw.includes('雨') ? '雨' : raw.includes('阴') ? '阴' : raw.includes('晴') ? '晴' : ''
    result.weather = (WEATHER_LABEL_TO_KEY[weatherLabel as keyof typeof WEATHER_LABEL_TO_KEY] ?? 'sunny') as WeatherKey
  }

  return {
    project: result.project ?? '',
    weather: result.weather ?? 'sunny',
    ...(result.workers != null ? { workers: result.workers } : {}),
    workContent: result.workContent ?? '',
    difficulties: result.difficulties ?? '',
    coordination: result.coordination ?? '',
    remark: result.remark ?? '',
  }
}

function buildTemplate(d: Partial<ParsedLog>) {
  const lines = [`工作内容：${d.workContent ?? ''}`]
  return lines.join('\n')
}

// 进度任务状态展示（不直接显示 not_started 等原始值）
const PROGRESS_STATUS_MAP: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  delayed: '延期',
  completed: '已完成',
}

// 进度任务接口
type ProgressTask = {
  id: number
  content: string
  project: string
  sheetName: string | null
  responsible: string
  requiredQty: number
  doneQty: number
  plannedEnd: string
  status: string
}

// 施工日志页面
const ConstructionLogPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { user } = useAuth()
  const headers = useMemo(() => (user?.token ? { Authorization: `Bearer ${user.token}` } : {}), [user?.token])
  const defaultRecorder = useMemo(() => {
    if (!user) return ''
    return (user as any).real_name || user.username || ''
  }, [user])
  const [data, setData] = useState<LogEntry[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [progressTasksForPicker, setProgressTasksForPicker] = useState<ProgressTask[]>([])

  const fetchLogs = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await axios.get<{ list: any[] }>('/api/construction/logs', { headers })
      const list = (res.data?.list ?? []).map((r: any) => ({
        id: r.id,
        project: r.project ?? r.project_name ?? '',
        date: r.date ?? '',
        weather: r.weather ?? 'sunny',
        recorder: r.recorder ?? '',
        workers: Number(r.workers) || 0,
        workContent: r.workContent ?? r.work_content ?? '',
        difficulties: r.difficulties ?? '',
        coordination: r.coordination ?? '',
        remark: r.remark ?? '',
      }))
      setData(list)
    } catch (e: any) {
      msg.error(e?.response?.data?.message ?? '加载日志失败')
    } finally {
      setListLoading(false)
    }
  }, [headers, msg])

  /** 后端列表默认每页仅 10 条，须分页拉全；可选按项目过滤（与日志所选项目一致） */
  const fetchProgressTasks = useCallback(
    async (filterProjectName?: string) => {
      try {
        const pageSize = 100
        let page = 1
        let total = 0
        const acc: any[] = []
        for (;;) {
          const params: Record<string, string | number> = { page, pageSize }
          const pn = (filterProjectName ?? '').trim()
          if (pn) params.project_name = pn
          const res = await axios.get<{ list: any[]; total?: number }>('/api/construction/tasks', { params, headers })
          const chunk = res.data?.list ?? []
          total = typeof res.data?.total === 'number' ? res.data.total : total
          acc.push(...chunk)
          if (acc.length >= total || chunk.length === 0) break
          page += 1
        }
        const list = acc.map((r: any) => ({
          id: Number(r.id),
          content: String(r.content ?? r.taskName ?? ''),
          project: String(r.project ?? r.project_name ?? ''),
          sheetName: r.sheet_name != null ? String(r.sheet_name) : r.sheetName != null ? String(r.sheetName) : null,
          responsible: String(r.responsible ?? ''),
          requiredQty: Number(r.requiredQty ?? r.required_qty) || 0,
          doneQty: Number(r.doneQty ?? r.done_qty) || 0,
          plannedEnd: String(r.plannedEnd ?? r.planned_end ?? ''),
          status: String(r.status ?? ''),
        }))
        setProgressTasksForPicker(list)
      } catch {
        setProgressTasksForPicker([])
      }
    },
    [headers],
  )

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])
  const [detailOpen, setDetailOpen] = useState(false)
  const [current, setCurrent] = useState<LogEntry | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<LogEntry | null>(null)
  const [editForm] = Form.useForm<{
    date: any
    project: string
    weather: WeatherKey
    recorder: string
    workers: number
    workContent: string
    difficulties: string
    coordination: string
    remark: string
  }>()

  const [createOpen, setCreateOpen] = useState(false)
  const [createStep, setCreateStep] = useState<1 | 2>(1) // 1=先选项目 2=进度选择+AI+表单
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [form] = Form.useForm<{
    date: any
    project: string
    weather: WeatherKey
    recorder: string
    workers: number
    workContent: string
    difficulties: string
    coordination: string
    remark: string
  }>()

  const weatherOptions = useMemo(() => (Object.keys(WEATHER_MAP) as WeatherKey[]).map((k) => ({ value: k, label: WEATHER_MAP[k] })), [])
  const [projectOptions, setProjectOptions] = useState<string[]>([])
  const [projectOptionsLoading, setProjectOptionsLoading] = useState(false)

  const fetchProjects = async (keyword?: string) => {
    try {
      setProjectOptionsLoading(true)
      const params = new URLSearchParams()
      if (keyword != null && keyword.trim()) params.set('keyword', keyword.trim())
      const res = await axios.get<{ list: { project_name: string }[]; total: number }>(
        `/api/construction/projects?${params.toString()}`,
        { headers },
      )
      const list = (res.data?.list ?? []).map((r) => r.project_name).filter(Boolean)
      setProjectOptions(list)
    } catch {
      setProjectOptions([])
    } finally {
      setProjectOptionsLoading(false)
    }
  }

  const openCreate = () => {
    setCreateOpen(true)
    setCreateStep(1)
    const initialTemplate = buildTemplate({ weather: 'sunny', workers: 1, project: '' })
    setChatInput(initialTemplate)
    setChatMessages([])
    fetchProjects()
    setPickedDoneForSave({})
    form.setFieldsValue({
      date: dayjs(),
      weather: 'sunny',
      recorder: current?.recorder ?? defaultRecorder,
      workers: 1,
      project: '',
      workContent: '',
      difficulties: '',
      coordination: '',
      remark: '',
    })
  }

  const goToCreateStep2 = () => {
    const project = form.getFieldValue('project')
    if (!project || !String(project).trim()) {
      msg.warning('请先选择项目名称')
      return
    }
    setCreateStep(2)
  }

  const openEdit = (row: LogEntry) => {
    setEditingEntry(row)
    const workers = Number(row.workers)
    editForm.setFieldsValue({
      date: row.date ? dayjs(row.date) : dayjs(),
      project: row.project ?? '',
      weather: (row.weather ?? 'sunny') as WeatherKey,
      recorder: row.recorder ?? '',
      workers: Number.isFinite(workers) && workers >= 1 ? workers : 1,
      workContent: row.workContent ?? '',
      difficulties: row.difficulties ?? '',
      coordination: row.coordination ?? '',
      remark: row.remark ?? '',
    })
    setEditOpen(true)
  }

  const handleEditOk = async () => {
    const v = await editForm.validateFields()
    if (!editingEntry) return
    const date = v.date ? dayjs(v.date).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD')
    const updated: LogEntry = {
      ...editingEntry,
      project: String(v.project ?? '').trim() || '未命名项目',
      date,
      weather: (v.weather ?? 'sunny') as WeatherKey,
      recorder: String(v.recorder ?? '').trim() || '—',
      workers: Math.max(1, Number(v.workers ?? 0) || 1),
      workContent: String(v.workContent ?? '').trim() || '—',
      difficulties: String(v.difficulties ?? '').trim() || '无',
      coordination: String(v.coordination ?? '').trim() || '无',
      remark: String(v.remark ?? '').trim() || '无',
    }
    try {
      await axios.put(`/api/construction/logs/${editingEntry.id}`, {
        project_name: updated.project,
        date: updated.date,
        weather: updated.weather,
        recorder: updated.recorder,
        workers: updated.workers,
        work_content: updated.workContent,
        difficulties: updated.difficulties,
        coordination: updated.coordination,
        remark: updated.remark,
      }, { headers })
      setData((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      msg.success('已更新日志')
      setEditOpen(false)
      setEditingEntry(null)
      fetchLogs()
    } catch (e: any) {
      msg.error(e?.response?.data?.message ?? '更新失败')
    }
  }

  const handleDelete = async (row: LogEntry) => {
    try {
      await axios.delete(`/api/construction/logs/${row.id}`, { headers })
      setData((prev) => prev.filter((item) => item.id !== row.id))
      msg.success('已删除')
      fetchLogs()
    } catch (e: any) {
      msg.error(e?.response?.data?.message ?? '删除失败')
    }
  }

  const applyParsed = (parsed: Partial<ParsedLog>) => {
    const next = {
      project: parsed.project ?? form.getFieldValue('project') ?? '',
      weather: (parsed.weather ?? form.getFieldValue('weather') ?? 'sunny') as WeatherKey,
      workers: parsed.workers ?? form.getFieldValue('workers') ?? 0,
      workContent: parsed.workContent ?? form.getFieldValue('workContent') ?? '',
      difficulties: parsed.difficulties ?? form.getFieldValue('difficulties') ?? '',
      coordination: parsed.coordination ?? form.getFieldValue('coordination') ?? '',
      remark: parsed.remark ?? form.getFieldValue('remark') ?? '',
    }
    const tpl = buildTemplate(next)
    form.setFieldsValue({
      ...next,
    })
    setChatInput(tpl)
  }

  const tryLLMFallback = async (text: string) => {
    try {
      const res = await axios.post('/api/construction/logs/parse', { text }, { headers })
      return res.data as Partial<ParsedLog>
    } catch {
      return null
    }
  }

  const sendChat = async () => {
    const text = chatInput.trim()
    if (!text) return
    setChatMessages((prev) => [...prev, { role: 'user', content: text }])
    // AI 聊天仅解析工作内容，不解析项目/天气/出勤等
    let workContent = parseLogFromText(text).workContent ?? ''
    if (!workContent.trim()) {
      const llm = await tryLLMFallback(text)
      if (llm?.workContent) workContent = llm.workContent
    }
    const assistant = workContent.trim()
      ? '已从输入中提取工作内容并填入下方表单，可直接修改后保存。'
      : '未识别到工作内容，请在下表“工作内容”中直接填写或补充描述后重试。'
    setChatMessages((prev) => [...prev, { role: 'assistant', content: assistant }])
    const vals = form.getFieldsValue()
    const nextWorkContent = workContent.trim() || (vals.workContent ?? '')
    form.setFieldsValue({ workContent: nextWorkContent })
    setChatInput(buildTemplate({ ...vals, workContent: nextWorkContent }))
  }

  // 从进度任务选择今日完成项（先于 AI 聊天；默认不选；支持项目+sheet 筛选；选择后预览确认再填入 AI 输入框）
  const [taskPickOpen, setTaskPickOpen] = useState(false)
  const [taskPickStep, setTaskPickStep] = useState<1 | 2>(1) // 1=选择 2=预览确认
  const [pickedQty, setPickedQty] = useState<Record<number, number>>({})
  const [pickedKeys, setPickedKeys] = useState<React.Key[]>([])
  const [pickedDoneForSave, setPickedDoneForSave] = useState<Record<number, number>>({})
  const [taskPickProjectFilter, setTaskPickProjectFilter] = useState<string | null>(null)
  const [taskPickSheetFilter, setTaskPickSheetFilter] = useState<string | null>(null)

  useEffect(() => {
    if (!taskPickOpen) return
    const pn = String(form.getFieldValue('project') ?? '').trim()
    void fetchProgressTasks(pn || undefined)
  }, [taskPickOpen, fetchProgressTasks, form])
  const allProgressTasks = progressTasksForPicker
  const tasksForPicker = useMemo(() => {
    let list = allProgressTasks
    if (taskPickProjectFilter) list = list.filter((t) => t.project === taskPickProjectFilter)
    if (taskPickSheetFilter) list = list.filter((t) => (t.sheetName ?? '') === taskPickSheetFilter)
    return list
  }, [allProgressTasks, taskPickProjectFilter, taskPickSheetFilter])

  const projectOptionsForPicker = useMemo(() => {
    const set = new Set(allProgressTasks.map((t) => t.project).filter(Boolean))
    return [...set].sort().map((p) => ({ value: p, label: p }))
  }, [allProgressTasks])

  const sheetOptionsForPicker = useMemo(() => {
    const set = new Set(allProgressTasks.map((t) => t.sheetName).filter((s): s is string => s != null && s !== ''))
    return [...set].sort().map((s) => ({ value: s, label: s }))
  }, [allProgressTasks])

  const openTaskPicker = () => {
    setPickedKeys([])
    setPickedQty({})
    setTaskPickStep(1)
    setTaskPickProjectFilter(null)
    setTaskPickSheetFilter(null)
    setTaskPickOpen(true)
  }

  const goToPreview = () => {
    const tasks = allProgressTasks
    const selected = new Set(pickedKeys.map((x) => Number(x)))
    const picked = tasks.filter((t) => selected.has(t.id))
    if (picked.length === 0) {
      msg.warning('请至少选择一条进度任务')
      return
    }
    for (const t of picked) {
      const qty = Number(pickedQty[t.id] ?? 0)
      const remaining = Math.max(0, (t.requiredQty ?? 0) - (t.doneQty ?? 0))
      if (!Number.isFinite(qty) || qty <= 0) {
        msg.error(`选择的任务「${t.content}」今日完成数量必须为正数`)
        return
      }
      if (qty > remaining) {
        msg.error(`任务「${t.content}」完成数量超出剩余量（剩余 ${remaining}）`)
        return
      }
    }
    setTaskPickStep(2)
  }

  const previewRows = useMemo(() => {
    const tasks = allProgressTasks
    const selected = new Set(pickedKeys.map((x) => Number(x)))
    const picked = tasks.filter((t) => selected.has(t.id))
    return picked
      .filter((t) => Number(pickedQty[t.id] ?? 0) > 0)
      .map((t) => ({
        ...t,
        todayQty: Number(pickedQty[t.id] ?? 0),
        remainingAfter: Math.max(0, (t.requiredQty ?? 0) - (t.doneQty ?? 0) - Number(pickedQty[t.id] ?? 0)),
      }))
  }, [pickedKeys, pickedQty, allProgressTasks])

  const confirmPickedAndFillChat = () => {
    const tasks = allProgressTasks
    const selected = new Set(pickedKeys.map((x) => Number(x)))
    const picked = tasks.filter((t) => selected.has(t.id))
    const pickedWithQty = picked.filter((t) => Number(pickedQty[t.id] ?? 0) > 0)
    const lines = pickedWithQty.map((t, idx) => {
      const qty = Number(pickedQty[t.id] ?? 0)
      const remaining = Math.max(0, (t.requiredQty ?? 0) - (t.doneQty ?? 0))
      return `${idx + 1}. ${t.content}：完成 ${qty}（剩余 ${Math.max(0, remaining - qty)}）`
    })
    const workContent = lines.length ? lines.join('\n') : '—'
    const doneMap: Record<number, number> = {}
    pickedWithQty.forEach((t) => {
      const add = Number(pickedQty[t.id] ?? 0)
      doneMap[t.id] = (t.doneQty ?? 0) + add
    })
    setPickedDoneForSave(doneMap)
    const project = form.getFieldValue('project') ?? ''
    const weather = (form.getFieldValue('weather') ?? 'sunny') as WeatherKey
    const workers = form.getFieldValue('workers') ?? 0
    const tpl = buildTemplate({ project, weather, workers, workContent, difficulties: '', coordination: '', remark: '' })
    setChatInput(tpl)
    form.setFieldsValue({ workContent })
    setTaskPickOpen(false)
    setTaskPickStep(1)
    msg.success('已填入下方 AI 输入框，可继续编辑或点击「解析并填充」')
  }

  const filtered = keyword
    ? data.filter(
        (r) =>
          r.project.includes(keyword) ||
          r.workContent.includes(keyword) ||
          r.recorder.includes(keyword) ||
          r.date.includes(keyword)
      )
    : data

  const columns: ColumnsType<LogEntry> = [
    { title: '日期', dataIndex: 'date', width: 120, sorter: (a, b) => a.date.localeCompare(b.date), defaultSortOrder: 'descend' },
    { title: '所属项目', dataIndex: 'project', width: 240 },
    {
      title: '天气',
      dataIndex: 'weather',
      width: 100,
      render: (v: string) => WEATHER_MAP[v] ?? v,
    },
    { title: '记录人', dataIndex: 'recorder', width: 100 },
    {
      title: '出勤人数',
      dataIndex: 'workers',
      width: 100,
      render: (v: number) => <Tag color="blue">{v} 人</Tag>,
    },
    {
      title: '工作内容',
      dataIndex: 'workContent',
      ellipsis: true,
    },
    {
      title: '操作',
      width: 160,
      render: (_: unknown, r: LogEntry) => (
        <Space size="small">
          <a onClick={() => { setCurrent(r); setDetailOpen(true) }}>详情</a>
          <a onClick={() => openEdit(r)}>编辑</a>
          <Popconfirm title="确定删除该条日志？" onConfirm={() => handleDelete(r)} okText="删除" cancelText="取消">
            <Button type="link" danger size="small" style={{ padding: 0, height: 'auto' }}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // 渲染施工日志页面
  return (
    <Card>
      <Space style={{ marginBottom: 16 }} size="middle">
        <Title level={5} style={{ margin: 0 }}>
          <FileTextOutlined style={{ marginRight: 8 }} />
          施工日志
        </Title>
        <Search
          placeholder="搜索项目 / 内容 / 日期"
          allowClear
          onSearch={setKeyword}
          style={{ width: 260 }}
        />
        <Button type="primary" onClick={openCreate}>记录日志</Button>
      </Space>

      <Table
        rowKey="id"
        dataSource={filtered}
        columns={columns}
        pagination={{ pageSize: 10 }}
        size="middle"
        loading={listLoading}
      />

      <Modal
        title="施工日志详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={680}
      >
        {current && (
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="日期">{current.date}</Descriptions.Item>
            <Descriptions.Item label="天气">{WEATHER_MAP[current.weather]}</Descriptions.Item>
            <Descriptions.Item label="所属项目" span={2}>
              {current.project}
            </Descriptions.Item>
            <Descriptions.Item label="记录人">{current.recorder}</Descriptions.Item>
            <Descriptions.Item label="出勤人数">{current.workers} 人</Descriptions.Item>
            <Descriptions.Item label="施工内容" span={2}>
              <Paragraph style={{ whiteSpace: 'pre-line', margin: 0 }}>
                {current.workContent}
              </Paragraph>
            </Descriptions.Item>
            <Descriptions.Item label="施工难点" span={2}>
              {current.difficulties}
            </Descriptions.Item>
            <Descriptions.Item label="帮助协调" span={2}>
              {current.coordination}
            </Descriptions.Item>
            <Descriptions.Item label="其他备注" span={2}>
              {current.remark}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal
        title="编辑施工日志"
        open={editOpen}
        onCancel={() => { setEditOpen(false); setEditingEntry(null) }}
        onOk={() => handleEditOk()}
        okText="保存"
        cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Space style={{ width: '100%' }} size="middle" align="start" wrap>
            <Form.Item name="date" label="日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%', minWidth: 140 }} />
            </Form.Item>
            <Form.Item name="weather" label="天气" rules={[{ required: true }]}>
              <Select options={weatherOptions} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="recorder" label="记录人" rules={[{ required: true }]}>
              <Input placeholder="记录人" style={{ width: 140 }} />
            </Form.Item>
            <Form.Item
              name="workers"
              label="出勤人数"
              rules={[
                { required: true, message: '请填写出勤人数' },
                {
                  validator: (_, val) => {
                    const n = Number(val)
                    if (val === '' || val == null || !Number.isFinite(n) || n < 1)
                      return Promise.reject(new Error('出勤人数至少为 1'))
                    return Promise.resolve()
                  },
                },
              ]}
            >
              <Input type="number" min={1} style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="project" label="项目名称" rules={[{ required: true }]}>
            <Input placeholder="项目名称" />
          </Form.Item>
          <Form.Item name="workContent" label="工作内容">
            <Input.TextArea rows={4} placeholder="工作内容" />
          </Form.Item>
          <Form.Item name="difficulties" label="施工难点">
            <Input.TextArea rows={2} placeholder="施工难点" />
          </Form.Item>
          <Form.Item name="coordination" label="帮助协调">
            <Input.TextArea rows={2} placeholder="帮助协调" />
          </Form.Item>
          <Form.Item name="remark" label="其他备注">
            <Input.TextArea rows={2} placeholder="其他备注" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={createStep === 1 ? '新增施工日志 - 请先选择项目' : '新增施工日志（AI对话生成模板）'}
        open={createOpen}
        onCancel={() => { setCreateOpen(false); setCreateStep(1) }}
        onOk={createStep === 1 ? undefined : async () => {
          const v = await form.validateFields()
          const weather = (v.weather ?? 'sunny') as WeatherKey
          const date = v.date ? dayjs(v.date).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD')
          const project = String(v.project ?? '').trim() || '未命名项目'
          const workContent = String(v.workContent ?? '').trim() || '—'
          try {
            const res = await axios.post('/api/construction/logs', {
              project_name: project,
              date,
              weather,
              recorder: String(v.recorder ?? '').trim() || '—',
              workers: Math.max(1, Number(v.workers ?? 0) || 1),
              work_content: workContent,
              difficulties: String(v.difficulties ?? '').trim() || null,
              coordination: String(v.coordination ?? '').trim() || null,
              remark: String(v.remark ?? '').trim() || null,
            }, { headers })
            const entry: LogEntry = {
              id: (res.data as any)?.id ?? Date.now(),
              project,
              date,
              weather,
              recorder: String(v.recorder ?? '').trim() || '—',
              workers: Math.max(1, Number(v.workers ?? 0) || 1),
              workContent,
              difficulties: String(v.difficulties ?? '').trim() || '无',
              coordination: String(v.coordination ?? '').trim() || '无',
              remark: String(v.remark ?? '').trim() || '无',
            }
            setData((prev) => [entry, ...prev])
            if (pickedDoneForSave && Object.keys(pickedDoneForSave).length) {
              const failed: number[] = []
              for (const [taskIdStr, newDoneQty] of Object.entries(pickedDoneForSave)) {
                const taskId = Number(taskIdStr)
                if (!Number.isFinite(taskId)) continue
                try {
                  await axios.patch(`/api/construction/tasks/${taskId}/done`, { done_qty: newDoneQty }, { headers })
                } catch (_) {
                  failed.push(taskId)
                }
              }
              if (failed.length > 0) {
                msg.warning(`进度任务已完成数量已部分更新，其中 ${failed.length} 条更新失败，可在进度管理中核对。`)
              }
              setPickedDoneForSave({})
            }
            msg.success('已新增日志')
            setCreateOpen(false)
            setCreateStep(1)
            fetchLogs()
          } catch (e: any) {
            msg.error(e?.response?.data?.message ?? '新增失败')
          }
        }}
        okText={createStep === 1 ? undefined : '保存'}
        cancelText="取消"
        width={createStep === 1 ? 480 : 920}
        destroyOnClose
        footer={
          createStep === 1
            ? [
                <Button key="cancel" onClick={() => { setCreateOpen(false); setCreateStep(1) }}>取消</Button>,
                <Button key="next" type="primary" onClick={goToCreateStep2}>下一步</Button>,
              ]
            : undefined
        }
      >
        {createStep === 1 && (
          <div style={{ padding: '8px 0' }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              请先选择要记录日志的项目名称，确认后再进行进度任务选择与日志填写。
            </Text>
            <Form form={form} layout="vertical">
              <Form.Item name="project" label="项目名称" rules={[{ required: true, message: '请选择项目名称' }]}>
                <Select
                  showSearch
                  allowClear
                  placeholder="请选择项目名称"
                  loading={projectOptionsLoading}
                  options={projectOptions.map((p) => ({ value: p, label: p }))}
                  onSearch={(v) => fetchProjects(v)}
                  filterOption={false}
                  onChange={(v) => applyParsed({ project: (v ?? '') as string })}
                />
              </Form.Item>
            </Form>
          </div>
        )}
        {createStep === 2 && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Card size="small" title="第一步：从进度任务选择今日完成项">
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              先选择今日完成的进度任务及数量（可按项目、Sheet 筛选；默认不选），预览确认后内容会填入下方 AI 输入框，再一并解析。
            </Text>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
              注意：此处列表来自「进度管理」中已创建的施工任务，不是报价清单行数；未在进度里创建的任务不会出现。打开弹窗时会按当前项目名称拉取该项目下全部任务。
            </Text>
            <Button type="primary" ghost onClick={openTaskPicker}>选择进度任务</Button>
          </Card>

          <Text type="secondary">
            说明：下方 AI 输入框内可编辑「工作内容」模板或补充描述，我只会从中解析工作内容并填入表单，其余字段请在下方表单中直接填写。
          </Text>

          <Card size="small" title="AI 聊天与解析">
            <div style={{ maxHeight: 220, overflowY: 'auto', padding: 8, background: 'var(--ant-colorFillQuaternary)', borderRadius: 8 }}>
              {chatMessages.length === 0 ? (
                <Text type="secondary">在下方输入框直接修改模板，然后点击“解析并填充”。也支持你用自然语言补充描述。</Text>
              ) : (
                chatMessages.map((m, idx) => (
                  <div key={idx} style={{ marginBottom: 10 }}>
                    <Text strong>{m.role === 'user' ? '我' : 'AI'}：</Text>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  </div>
                ))
              )}
            </div>
            <Space style={{ marginTop: 12 }} align="start">
              <Input.TextArea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="直接修改模板，或粘贴你的描述…"
                rows={6}
                style={{ width: 680 }}
              />
              <Button type="primary" onClick={sendChat}>解析并填充</Button>
            </Space>
          </Card>

          <Divider style={{ margin: 0 }} />

          <Card size="small" title="日志模板（可直接修改）">
            <Form
              form={form}
              layout="vertical"
            >
              <Space style={{ width: '100%' }} size="middle" align="start">
                <Form.Item name="date" label="日期" style={{ width: 180 }} rules={[{ required: true, message: '请选择日期' }]}>
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="weather" label="天气" style={{ width: 160 }} rules={[{ required: true, message: '请选择天气' }]}>
                  <Select options={weatherOptions} />
                </Form.Item>
                <Form.Item name="recorder" label="记录人" style={{ width: 160 }} rules={[{ required: true, message: '请填写记录人' }]}>
                  <Input placeholder="例如：张三" />
                </Form.Item>
                <Form.Item
                  name="workers"
                  label="出勤人数"
                  style={{ width: 160 }}
                  rules={[
                    { required: true, message: '请填写出勤人数' },
                    {
                      validator: (_, val) => {
                        const n = Number(val)
                        if (val === '' || val == null || !Number.isFinite(n) || n < 1)
                          return Promise.reject(new Error('出勤人数至少为 1'))
                        return Promise.resolve()
                      },
                    },
                  ]}
                >
                  <Input type="number" min={1} />
                </Form.Item>
              </Space>

              <Form.Item name="project" label="项目名称" rules={[{ required: true, message: '请选择项目名称' }]}>
                <Input disabled placeholder="请在上一步选择项目名称" />
              </Form.Item>

              <Space style={{ width: '100%' }} size="middle" align="start">
                <Form.Item
                  name="workContent"
                  label={
                    <Space>
                      <span>工作内容</span>
                      <Button size="small" type="link" onClick={openTaskPicker} style={{ padding: 0 }}>
                        追加选择进度任务
                      </Button>
                    </Space>
                  }
                  style={{ flex: 1 }}
                >
                  <Input.TextArea rows={3} placeholder="可按 1. 2. 3. 列点" onChange={(e) => applyParsed({ workContent: e.target.value })} />
                </Form.Item>
                <Form.Item name="difficulties" label="施工难点" style={{ flex: 1 }}>
                  <Input.TextArea rows={3} placeholder="例如：走线空间狭小、需夜间施工等" onChange={(e) => applyParsed({ difficulties: e.target.value })} />
                </Form.Item>
              </Space>

              <Space style={{ width: '100%' }} size="middle" align="start">
                <Form.Item name="coordination" label="帮助协调" style={{ flex: 1 }}>
                  <Input.TextArea rows={2} placeholder="例如：需要物业开门禁、协调停电窗口等" onChange={(e) => applyParsed({ coordination: e.target.value })} />
                </Form.Item>
                <Form.Item name="remark" label="其他备注" style={{ flex: 1 }}>
                  <Input.TextArea rows={2} placeholder="选填" onChange={(e) => applyParsed({ remark: e.target.value })} />
                </Form.Item>
              </Space>

            </Form>
          </Card>
        </Space>
        )}
      </Modal>

      <Modal
        title={taskPickStep === 1 ? '从进度任务选择今日完成项' : '预览确认'}
        open={taskPickOpen}
        onCancel={() => { setTaskPickOpen(false); setTaskPickStep(1) }}
        footer={null}
        width={920}
        destroyOnClose
      >
        {taskPickStep === 1 && (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              <Space size={8}>
                <Text type="secondary">项目名称：</Text>
                <Select
                  allowClear
                  placeholder="全部"
                  style={{ width: 200 }}
                  value={taskPickProjectFilter ?? undefined}
                  options={projectOptionsForPicker}
                  onChange={(v) => setTaskPickProjectFilter(v ?? null)}
                />
              </Space>
              <Space size={8}>
                <Text type="secondary">Sheet：</Text>
                <Select
                  allowClear
                  placeholder="全部"
                  style={{ width: 160 }}
                  value={taskPickSheetFilter ?? undefined}
                  options={sheetOptionsForPicker}
                  onChange={(v) => setTaskPickSheetFilter(v ?? null)}
                />
              </Space>
              <Text type="secondary">已选 {pickedKeys.length} 条</Text>
              <Text type="secondary">共加载 {allProgressTasks.length} 条进度任务</Text>
            </Space>
            <Table
              size="small"
              rowKey="id"
              dataSource={tasksForPicker}
              pagination={{ pageSize: 12, showTotal: (t) => `共 ${t} 条` }}
              rowSelection={{ selectedRowKeys: pickedKeys, onChange: (keys) => setPickedKeys(keys) }}
              columns={[
                { title: '施工内容', dataIndex: 'content', ellipsis: true },
                { title: '项目', dataIndex: 'project', width: 140, ellipsis: true },
                { title: 'Sheet', dataIndex: 'sheetName', width: 100, render: (v: string | null) => (v ? <Tag>{v}</Tag> : '—') },
                { title: '负责人', dataIndex: 'responsible', width: 90 },
                { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => PROGRESS_STATUS_MAP[v] ?? v },
                { title: '总量', dataIndex: 'requiredQty', width: 72, align: 'right' },
                { title: '已完成', dataIndex: 'doneQty', width: 72, align: 'right' },
                {
                  title: '今日完成',
                  width: 160,
                  render: (_: unknown, r: ProgressTask) => {
                    const remaining = Math.max(0, (r.requiredQty ?? 0) - (r.doneQty ?? 0))
                    const minQty = remaining > 0 ? 1 : 0
                    return (
                      <Space>
                        <InputNumber
                          min={minQty}
                          max={remaining}
                          value={pickedQty[r.id] ?? 0}
                          onChange={(v) => setPickedQty((prev) => ({ ...prev, [r.id]: Number(v ?? 0) }))}
                          placeholder="必填，正数"
                        />
                        <Text type="secondary">≤{remaining}</Text>
                      </Space>
                    )
                  },
                },
              ]}
            />
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Button onClick={() => setTaskPickOpen(false)}>取消</Button>
              <Button type="primary" onClick={goToPreview} style={{ marginLeft: 8 }}>下一步：预览</Button>
            </div>
          </>
        )}
        {taskPickStep === 2 && (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              请确认以下任务名称与数量，确认后将填入下方 AI 输入框供后续解析。
            </Text>
            <Table
              size="small"
              rowKey="id"
              dataSource={previewRows}
              pagination={false}
              columns={[
                { title: '任务名称', dataIndex: 'content', ellipsis: true },
                { title: '项目', dataIndex: 'project', width: 140, ellipsis: true },
                { title: 'Sheet', dataIndex: 'sheetName', width: 100, render: (v: string | null) => (v ? <Tag>{v}</Tag> : '—') },
                { title: '今日完成数量', dataIndex: 'todayQty', width: 110, align: 'right' },
                { title: '确认后剩余', dataIndex: 'remainingAfter', width: 100, align: 'right' },
              ]}
            />
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Button onClick={() => setTaskPickStep(1)}>上一步</Button>
              <Button type="primary" onClick={confirmPickedAndFillChat} style={{ marginLeft: 8 }}>确认并填入AI输入框</Button>
            </div>
          </>
        )}
      </Modal>
    </Card>
  )
}

export default ConstructionLogPage
