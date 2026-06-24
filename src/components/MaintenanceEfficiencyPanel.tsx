/**
 * 效率评估面板（研发 / 零星工程 / 维护排单共用）
 */
import { BarChartOutlined, ReloadOutlined } from '@ant-design/icons'
import { App, Button, Card, Col, DatePicker, Row, Segmented, Space, Statistic, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import dayjs, { type Dayjs } from 'dayjs'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

export type EfficiencyPeriodPreset = 'week' | 'month' | 'year' | 'custom'

export type EfficiencyPeriodRange = {
  preset: EfficiencyPeriodPreset
  date_from: string
  date_to: string
}

export type EfficiencySummary = {
  total_all: number
  total_open: number
  total_done: number
  completion_rate: number | null
  open_overdue: number
  on_time_done: number
  early_done: number
  overdue_done: number
  done_without_due: number
  on_time_rate: number | null
}

export type AssigneeEfficiencyRow = {
  username: string
  display_name: string
  total_all: number
  total_open: number
  total_done: number
  completion_rate: number | null
  on_time_done: number
  early_done: number
  overdue_done: number
  open_overdue: number
  on_time_rate: number | null
}

export type WorkerParticipationTaskRow = {
  task_id: number
  task_code: string
  task_title: string
  task_label: string
  participation_days: number
  half_day_count: number
  full_day_count: number
  overtime_count: number
  participation_summary: string
}

export type WorkerParticipationRow = {
  username: string
  display_name: string
  task_count: number
  participation_days: number
  half_day_count: number
  full_day_count: number
  overtime_count: number
  participation_summary: string
  tasks: WorkerParticipationTaskRow[]
}

export type EfficiencyResponse = {
  period: EfficiencyPeriodRange
  summary: EfficiencySummary
  by_assignee: AssigneeEfficiencyRow[]
  by_worker: WorkerParticipationRow[]
}

export type MaintenanceEfficiencyPanelProps = {
  apiPath: string
  title: string
  description: string
  /** assignee：按负责人；worker：按施工人员参与统计 */
  analysisTableMode?: 'assignee' | 'worker'
  assigneeColumnTitle?: string
  openLabel?: string
  doneLabel?: string
  allLabel?: string
  backPath: string
  backLabel: string
  showTestTag?: boolean
  extraActions?: React.ReactNode
}

const rateText = (v: number | null) => (v != null ? `${v}%` : '—')

const periodPresetLabel: Record<EfficiencyPeriodPreset, string> = {
  week: '本周',
  month: '当月',
  year: '当年',
  custom: '自定义',
}

export const MaintenanceEfficiencyPanel: React.FC<MaintenanceEfficiencyPanelProps> = ({
  apiPath,
  title,
  description,
  analysisTableMode = 'assignee',
  assigneeColumnTitle = '负责人',
  openLabel = '未完成',
  doneLabel = '已完成',
  allLabel = '全部任务',
  backPath,
  backLabel,
  showTestTag = true,
  extraActions,
}) => {
  const { message: msg } = App.useApp()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<EfficiencyResponse | null>(null)
  const [periodPreset, setPeriodPreset] = useState<EfficiencyPeriodPreset>('month')
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { period: periodPreset }
      if (periodPreset === 'custom' && customRange) {
        params.date_from = customRange[0].format('YYYY-MM-DD')
        params.date_to = customRange[1].format('YYYY-MM-DD')
      }
      const res = await axios.get<EfficiencyResponse>(apiPath, { params })
      setData(res.data)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [apiPath, customRange, msg, periodPreset])

  useEffect(() => {
    if (periodPreset === 'custom' && !customRange) return
    void load()
  }, [load, periodPreset, customRange])

  const summary = data?.summary
  const completionRate = summary?.completion_rate ?? null
  const onTimeRate = summary?.on_time_rate ?? null
  const period = data?.period

  const assigneeColumns: ColumnsType<AssigneeEfficiencyRow> = useMemo(
    () => [
      { title: assigneeColumnTitle, dataIndex: 'display_name', width: 120, ellipsis: true, fixed: 'left' },
      { title: allLabel, dataIndex: 'total_all', width: 88, align: 'right' },
      { title: doneLabel, dataIndex: 'total_done', width: 88, align: 'right' },
      { title: openLabel, dataIndex: 'total_open', width: 88, align: 'right' },
      { title: '完成率', dataIndex: 'completion_rate', width: 88, align: 'right', render: rateText },
      {
        title: '按时完成',
        dataIndex: 'on_time_done',
        width: 120,
        align: 'right',
        render: (v: number, row) => (row.early_done > 0 ? `${v}（含提前${row.early_done}）` : v),
      },
      { title: '提前完成', dataIndex: 'early_done', width: 88, align: 'right' },
      { title: '过期完成', dataIndex: 'overdue_done', width: 88, align: 'right' },
      { title: '当前超时', dataIndex: 'open_overdue', width: 88, align: 'right' },
      { title: '按时率', dataIndex: 'on_time_rate', width: 88, align: 'right', render: rateText },
    ],
    [allLabel, assigneeColumnTitle, doneLabel, openLabel],
  )

  const workerColumns: ColumnsType<WorkerParticipationRow> = useMemo(
    () => [
      { title: '执行人', dataIndex: 'display_name', width: 120, ellipsis: true, fixed: 'left' },
      { title: '参与任务数', dataIndex: 'task_count', width: 96, align: 'right' },
      { title: '参与人天', dataIndex: 'participation_days', width: 88, align: 'right' },
      { title: '整天', dataIndex: 'full_day_count', width: 72, align: 'right' },
      { title: '半天', dataIndex: 'half_day_count', width: 72, align: 'right' },
      { title: '加班', dataIndex: 'overtime_count', width: 72, align: 'right' },
      { title: '参与明细', dataIndex: 'participation_summary', ellipsis: true },
    ],
    [],
  )

  const workerTaskColumns: ColumnsType<WorkerParticipationTaskRow> = useMemo(
    () => [
      {
        title: '项目名称',
        key: 'project',
        ellipsis: true,
        render: (_: unknown, row) => {
          const name = (row.task_title || row.task_label || '—').trim()
          return (
            <Space direction="vertical" size={0} style={{ maxWidth: '100%' }}>
              <Text ellipsis={{ tooltip: name }}>{name}</Text>
              {row.task_code ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {row.task_code}
                </Text>
              ) : null}
            </Space>
          )
        },
      },
      { title: '参与人天', dataIndex: 'participation_days', width: 88, align: 'right' },
      { title: '整天', dataIndex: 'full_day_count', width: 72, align: 'right' },
      { title: '半天', dataIndex: 'half_day_count', width: 72, align: 'right' },
      { title: '加班', dataIndex: 'overtime_count', width: 72, align: 'right' },
      { title: '明细', dataIndex: 'participation_summary', ellipsis: true },
    ],
    [],
  )

  return (
    <div className="page-content-wrap" style={{ width: '100%' }}>
      <div className="page-header-banner">
        <div className="header-left">
          <div className="header-icon-wrap">
            <BarChartOutlined />
          </div>
          <div>
            <Title level={4} className="header-title" style={{ marginBottom: 0 }}>
              {title}
              {showTestTag && (
                <Tag color="orange" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                  测试
                </Tag>
              )}
            </Title>
            <Text type="secondary" className="header-desc" style={{ display: 'block' }}>
              {description}
            </Text>
          </div>
        </div>
      </div>

      <Space wrap style={{ marginBottom: 16 }} align="center">
        <Text type="secondary">统计周期</Text>
        <Segmented<EfficiencyPeriodPreset>
          value={periodPreset}
          onChange={(v) => {
            setPeriodPreset(v)
            if (v === 'custom' && !customRange) {
              setCustomRange([dayjs().startOf('month'), dayjs().endOf('month')])
            }
          }}
          options={[
            { label: '本周', value: 'week' },
            { label: '当月', value: 'month' },
            { label: '当年', value: 'year' },
            { label: '自定义', value: 'custom' },
          ]}
        />
        {periodPreset === 'custom' && (
          <RangePicker
            value={customRange}
            onChange={(v) => setCustomRange(v as [Dayjs, Dayjs] | null)}
            allowClear={false}
          />
        )}
        {period && (
          <Text type="secondary">
            {periodPresetLabel[period.preset]}：{period.date_from} ~ {period.date_to}
          </Text>
        )}
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          刷新
        </Button>
        {extraActions}
        <Button type="link" onClick={() => navigate(backPath)}>
          {backLabel}
        </Button>
      </Space>

      <Title level={5} style={{ marginTop: 0 }}>
        总体进度
      </Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic title={allLabel} value={summary?.total_all ?? 0} loading={loading} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic title={doneLabel} value={summary?.total_done ?? 0} valueStyle={{ color: '#389e0d' }} loading={loading} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic title={openLabel} value={summary?.total_open ?? 0} loading={loading} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic
              title="完成率"
              value={completionRate != null ? completionRate : '—'}
              suffix={completionRate != null ? '%' : undefined}
              loading={loading}
            />
            {completionRate != null && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {doneLabel} / {allLabel}
              </Text>
            )}
          </Card>
        </Col>
      </Row>

      <Title level={5} style={{ marginTop: 0 }}>
        时效分析
      </Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic title="当前超时" value={summary?.open_overdue ?? 0} valueStyle={{ color: '#cf1322' }} loading={loading} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic
              title="按时率"
              value={onTimeRate != null ? onTimeRate : '—'}
              suffix={onTimeRate != null ? '%' : undefined}
              loading={loading}
            />
            {onTimeRate != null && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                按时完成（含提前）/ {doneLabel}
              </Text>
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic title="按时完成" value={summary?.on_time_done ?? 0} valueStyle={{ color: '#0958d9' }} loading={loading} />
            {(summary?.early_done ?? 0) > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                含提前 {summary?.early_done}
              </Text>
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic title="提前完成" value={summary?.early_done ?? 0} valueStyle={{ color: '#1677ff' }} loading={loading} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic title="过期完成" value={summary?.overdue_done ?? 0} valueStyle={{ color: '#d46b08' }} loading={loading} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic title="无截止已完成" value={summary?.done_without_due ?? 0} loading={loading} />
          </Card>
        </Col>
      </Row>

      {analysisTableMode === 'worker' ? (
        <>
          <Title level={5} style={{ marginTop: 0 }}>
            按执行人（参与任务与人天）
          </Title>
          <Table<WorkerParticipationRow>
            rowKey="username"
            loading={loading}
            columns={workerColumns}
            dataSource={data?.by_worker ?? []}
            expandable={{
              expandedRowRender: (row) => (
                <Table<WorkerParticipationTaskRow>
                  rowKey="task_id"
                  size="small"
                  pagination={false}
                  columns={workerTaskColumns}
                  dataSource={row.tasks}
                  scroll={{ x: 640 }}
                />
              ),
              rowExpandable: (row) => (row.tasks?.length ?? 0) > 0,
            }}
            pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 人` }}
            scroll={{ x: 880 }}
          />
        </>
      ) : (
        <>
          <Title level={5} style={{ marginTop: 0 }}>
            按{assigneeColumnTitle}
          </Title>
          <Table<AssigneeEfficiencyRow>
            rowKey="username"
            loading={loading}
            columns={assigneeColumns}
            dataSource={data?.by_assignee ?? []}
            pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 人` }}
            scroll={{ x: 960 }}
          />
        </>
      )}
    </div>
  )
}
