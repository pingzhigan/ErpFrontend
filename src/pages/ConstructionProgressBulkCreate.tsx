/**
 * 功能名称：进度管理批量创建
 * 实现原理与逻辑：从报价清单批量创建进度任务；加载候选前弹窗确认计划周期，默认取项目信息中的计划起止日期；提交批量创建时使用该周期。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, DatePicker, Form, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import dayjs, { type Dayjs } from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { buildConstructionAssigneeOptions, type AssigneeUserRow } from '../utils/constructionAssigneeOptions'

const { Title, Text, Paragraph } = Typography

type ProductRow = {
  id?: unknown
  goods_name?: unknown
  quantity?: unknown
  sheet_name?: unknown
  project_name?: unknown
}

type ConstructionProjectListRow = {
  project_name: string
  startDate?: string
  endDate?: string
}

/** 解析项目信息中的计划日期（兼容 YYYY-MM-DD、ISO、带时间戳等） */
function parseProjectDate(s: string | undefined | null): Dayjs | null {
  const t = (s ?? '').trim()
  if (!t) return null
  const ymd = dayjs(t.slice(0, 10), 'YYYY-MM-DD', true)
  if (ymd.isValid()) return ymd
  const loose = dayjs(t)
  return loose.isValid() ? loose.startOf('day') : null
}

const ConstructionProgressBulkCreatePage: React.FC = () => {
  const { message: msg } = App.useApp()
  const navigate = useNavigate()
  const { user } = useAuth()
  const headers = useMemo(() => (user?.token ? { Authorization: `Bearer ${user.token}` } : {}), [user?.token])

  const [projectName, setProjectName] = useState('')
  /** 弹窗确认后、批量创建任务时使用的计划起止（YYYY-MM-DD） */
  const [bulkPlannedStart, setBulkPlannedStart] = useState('')
  const [bulkPlannedEnd, setBulkPlannedEnd] = useState('')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<
    { key: string; goods_name: string; sheet_name: string | null; required_qty: number; responsible: string; source_product_id?: number }[]
  >([])
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([])
  const [sheetFilter, setSheetFilter] = useState<string | null>(null)
  const [defaultResponsible, setDefaultResponsible] = useState('')
  const [projectOptions, setProjectOptions] = useState<string[]>([])
  const [projectSummaries, setProjectSummaries] = useState<ConstructionProjectListRow[]>([])
  const [projectOptionsLoading, setProjectOptionsLoading] = useState(false)
  const [loadConfirmOpen, setLoadConfirmOpen] = useState(false)
  const [loadConfirmForm] = Form.useForm<{ planned_start: Dayjs; planned_end: Dayjs }>()
  /** 最近一次从报价拉取：原始行数 vs 候选条数（与报价清单一一对应，不含空名称行） */
  const [quoteLoadStats, setQuoteLoadStats] = useState<{ rows: number; candidates: number; skippedEmptyName: number } | null>(
    null,
  )
  const [skippedModalOpen, setSkippedModalOpen] = useState(false)
  const [skippedResult, setSkippedResult] = useState<{ created: number; skippedItems: { content: string; sheet_name: string | null }[] } | null>(null)
  const [managerUsers, setManagerUsers] = useState<AssigneeUserRow[]>([])

  const loadManagerUsers = useCallback(async () => {
    try {
      const res = await axios.get<{ list: AssigneeUserRow[] }>('/api/construction/projects/manager-user-options', { headers })
      setManagerUsers(res.data?.list ?? [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message ?? '加载用户列表失败')
      setManagerUsers([])
    }
  }, [headers, msg])

  useEffect(() => {
    void loadManagerUsers()
  }, [loadManagerUsers])

  const managerSelectOptions = useMemo(() => buildConstructionAssigneeOptions(managerUsers, []), [managerUsers])

  const fetchConstructionProjects = async (keyword?: string) => {
    try {
      setProjectOptionsLoading(true)
      const params = new URLSearchParams()
      if (keyword != null && keyword.trim()) params.set('keyword', keyword.trim())
      const res = await axios.get<{ list: ConstructionProjectListRow[]; total: number }>(
        `/api/construction/projects?${params.toString()}`,
        { headers },
      )
      const raw = res.data?.list ?? []
      const summaries: ConstructionProjectListRow[] = raw
        .map((r) => {
          const rec = r as ConstructionProjectListRow & { start_date?: string; end_date?: string }
          return {
            project_name: (rec.project_name ?? '').trim(),
            startDate: rec.startDate ?? rec.start_date ?? '',
            endDate: rec.endDate ?? rec.end_date ?? '',
          }
        })
        .filter((r) => r.project_name)
      const names = summaries.map((r) => r.project_name)
      const nameSet = new Set(names)
      setProjectSummaries(summaries)
      setProjectOptions(names)
      let clearedProject = false
      setProjectName((prev) => {
        const t = prev.trim()
        if (t && !nameSet.has(t)) {
          clearedProject = true
          return ''
        }
        return prev
      })
      if (clearedProject) {
        setRows([])
        setSelectedKeys([])
        setSheetFilter(null)
        setBulkPlannedStart('')
        setBulkPlannedEnd('')
        setQuoteLoadStats(null)
      }
    } catch {
      setProjectOptions([])
      setProjectSummaries([])
    } finally {
      setProjectOptionsLoading(false)
    }
  }

  useEffect(() => {
    fetchConstructionProjects()
  }, [])

  const sheetOptions = useMemo(() => {
    const set = new Set<string>()
    rows.forEach((r) => r.sheet_name && set.add(r.sheet_name))
    return [...set].sort().map((s) => ({ value: s, label: s }))
  }, [rows])

  const filtered = useMemo(() => {
    if (!sheetFilter) return rows
    return rows.filter((r) => r.sheet_name === sheetFilter)
  }, [rows, sheetFilter])

  /** 当前表格可见行（filtered）中仍被勾选的条数；提交时只提交这部分，避免筛选后仍带上其它 Sheet 的 key */
  const selectedInFilteredCount = useMemo(() => {
    const set = new Set(selectedKeys.map(String))
    return filtered.filter((r) => set.has(r.key)).length
  }, [filtered, selectedKeys])

  useEffect(() => {
    const inView = new Set(filtered.map((r) => String(r.key)))
    setSelectedKeys((prev) => {
      const next = prev.filter((k) => inView.has(String(k)))
      if (next.length === prev.length && next.every((k, i) => k === prev[i])) return prev
      return next
    })
  }, [filtered])

  const applyResponsible = (scope: 'all' | 'filtered' | 'selected') => {
    const value = defaultResponsible.trim()
    if (!value) {
      msg.warning('请先选择负责人')
      return
    }
    const selectedSet = new Set(selectedKeys.map(String))
    const filteredSet = new Set(filtered.map((r) => r.key))
    setRows((prev) =>
      prev.map((r) => {
        if (scope === 'all') return { ...r, responsible: value }
        if (scope === 'filtered') return filteredSet.has(r.key) ? { ...r, responsible: value } : r
        return selectedSet.has(r.key) ? { ...r, responsible: value } : r
      }),
    )
    msg.success(
      scope === 'all'
        ? '已一键设置全部负责人'
        : scope === 'filtered'
          ? '已一键设置当前筛选范围负责人'
          : '已一键设置已选范围负责人',
    )
  }

  /** 将当前选中项目在「项目信息」中的计划起止写入表单（须在弹窗内容挂载后调用，见 Modal afterOpenChange） */
  const applyProjectPlannedRangeToLoadForm = useCallback(() => {
    const proj = projectName.trim()
    if (!proj) return
    const row = projectSummaries.find((p) => p.project_name === proj)
    const startD = parseProjectDate(row?.startDate) ?? dayjs()
    let endD = parseProjectDate(row?.endDate) ?? startD
    if (endD.isBefore(startD, 'day')) {
      endD = startD
    }
    loadConfirmForm.resetFields()
    loadConfirmForm.setFieldsValue({
      planned_start: startD,
      planned_end: endD,
    })
  }, [projectName, projectSummaries, loadConfirmForm])

  const openLoadConfirmModal = () => {
    const proj = projectName.trim()
    if (!proj) {
      msg.warning('请先选择项目名称')
      return
    }
    setLoadConfirmOpen(true)
  }

  const executeLoadFromProducts = async (): Promise<void> => {
    const proj = projectName.trim()
    if (!proj) {
      msg.warning('请先选择项目名称')
      return Promise.reject(new Error('no project'))
    }
    let v: { planned_start: Dayjs; planned_end: Dayjs }
    try {
      v = await loadConfirmForm.validateFields()
    } catch {
      return Promise.reject(new Error('validate'))
    }
    const ps = v.planned_start.format('YYYY-MM-DD')
    const pe = v.planned_end.format('YYYY-MM-DD')
    if (pe < ps) {
      msg.warning('计划结束日期不能早于开始日期')
      return Promise.reject(new Error('range'))
    }
    setBulkPlannedStart(ps)
    setBulkPlannedEnd(pe)
    setLoadConfirmOpen(false)
    setLoading(true)
    setRows([])
    setSelectedKeys([])
    setSheetFilter(null)
    try {
      const pageSize = 500
      let page = 1
      let total = 0
      const list: ProductRow[] = []
      for (;;) {
        const res = await axios.get<{ list: any[]; total: number }>(
          '/api/products',
          { params: { project_name: proj, page, pageSize }, headers },
        )
        const chunk = Array.isArray(res.data?.list) ? res.data.list : []
        total = typeof res.data?.total === 'number' ? res.data.total : total
        list.push(...(chunk as ProductRow[]))
        if (list.length >= total || chunk.length === 0) break
        page += 1
      }

      const out: {
        key: string
        goods_name: string
        sheet_name: string | null
        required_qty: number
        responsible: string
        source_product_id?: number
      }[] = []
      let skippedEmptyName = 0
      for (let i = 0; i < list.length; i++) {
        const r = list[i]
        const name = r.goods_name != null ? String(r.goods_name).trim() : ''
        if (!name) {
          skippedEmptyName += 1
          continue
        }
        const rawId = r.id
        const numId =
          typeof rawId === 'number' && Number.isFinite(rawId)
            ? rawId
            : rawId != null && rawId !== ''
              ? Number(rawId)
              : NaN
        const hasProductId = Number.isFinite(numId)
        const key = hasProductId ? `quote-${numId}` : `quote-row-${i}`
        const sn = r.sheet_name != null && String(r.sheet_name).trim() ? String(r.sheet_name).trim() : null
        const qty = r.quantity != null && r.quantity !== '' ? Number(r.quantity) : 0
        const q = Number.isFinite(qty) ? qty : 0
        const row: (typeof out)[number] = {
          key,
          goods_name: name,
          sheet_name: sn,
          required_qty: Math.round(q * 100) / 100,
          responsible: '',
        }
        if (hasProductId) row.source_product_id = numId
        out.push(row)
      }

      setQuoteLoadStats({ rows: list.length, candidates: out.length, skippedEmptyName })
      setRows(out)
      setSelectedKeys(out.map((x) => x.key))
      msg.success(`已加载 ${out.length} 条任务候选（计划周期 ${ps} ~ ${pe}）`)
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const addToProgressList = async () => {
    const proj = projectName.trim()
    if (!proj) {
      msg.warning('请先选择项目名称')
      return
    }
    const pickedSet = new Set(selectedKeys.map(String))
    const picked = filtered.filter((r) => pickedSet.has(r.key))
    if (!picked.length) {
      msg.warning(sheetFilter ? '请在当前筛选结果中至少勾选一条' : '请至少选择一条')
      return
    }
    if (!bulkPlannedStart.trim() || !bulkPlannedEnd.trim()) {
      msg.warning('请先点击「加载候选」，在弹出窗口中确认计划周期')
      return
    }
    const ps = bulkPlannedStart.trim()
    const pe = bulkPlannedEnd.trim()
    if (pe < ps) {
      msg.warning('计划结束日期不能早于开始日期，请重新加载候选并在弹窗中确认周期')
      return
    }
    const missingResp = picked.filter((p) => !(p.responsible ?? '').trim())
    if (missingResp.length > 0) {
      msg.warning(
        `有 ${missingResp.length} 条已选任务未选择负责人，请逐条选择或使用「负责人一键设置」后再加入进度管理`,
      )
      return
    }
    const tasks = picked.map((p) => {
      const t: Record<string, unknown> = {
        project_name: proj,
        task_name: (p.goods_name ?? '').slice(0, 50) || '任务',
        content: p.goods_name,
        sheet_name: p.sheet_name ?? null,
        responsible: (p.responsible ?? '').trim(),
        planned_start: ps,
        planned_end: pe,
        required_qty: p.required_qty,
        done_qty: 0,
        status: 'not_started',
      }
      if (p.source_product_id != null && Number.isFinite(p.source_product_id)) {
        t.source_product_id = p.source_product_id
      }
      return t
    })
    try {
      const res = await axios.post<{
        created?: number
        skipped?: number
        skippedItems?: { content: string; sheet_name: string | null }[]
      }>('/api/construction/tasks/bulk', { tasks }, { headers })
      const created = res.data?.created ?? 0
      const skippedItems = res.data?.skippedItems ?? []
      if (skippedItems.length > 0) {
        setSkippedResult({ created, skippedItems })
        setSkippedModalOpen(true)
      } else {
        msg.success(`已批量加入 ${created} 条，返回进度管理可查看/再编辑`)
        navigate('/construction/progress')
      }
    } catch (e: any) {
      msg.error(e?.response?.data?.message ?? '批量创建失败')
    }
  }

  const handleSkippedModalOk = () => {
    setSkippedModalOpen(false)
    setSkippedResult(null)
    navigate('/construction/progress')
  }

  const columns: ColumnsType<{
    key: string
    goods_name: string
    sheet_name: string | null
    required_qty: number
    responsible: string
    source_product_id?: number
  }> = [
    { title: 'Sheet', dataIndex: 'sheet_name', width: 160, render: (v: string | null) => (v ? <Tag>{v}</Tag> : <Text type="secondary">（无）</Text>) },
    { title: '商品名称（任务）', dataIndex: 'goods_name' },
    { title: '需求数量', dataIndex: 'required_qty', width: 140, align: 'right' },
    {
      title: '负责人',
      dataIndex: 'responsible',
      width: 220,
      render: (v: string, r) => (
        <Select
          showSearch
          allowClear
          placeholder="从用户中选择"
          value={v || undefined}
          options={managerSelectOptions}
          optionFilterProp="label"
          style={{ width: '100%' }}
          onChange={(next) => {
            setRows((prev) =>
              prev.map((x) => (x.key === r.key ? { ...x, responsible: (next ?? '') as string } : x)),
            )
          }}
          filterOption={(input, opt) =>
            (opt?.label ?? '').toString().toLowerCase().includes((input || '').toLowerCase())
          }
        />
      ),
    },
  ]

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} align="center">
        <Title level={5} style={{ margin: 0 }}>批量创建进度任务</Title>
        <Button onClick={() => navigate(-1)}>返回</Button>
      </Space>

      <Card size="small" title="第一步：选择项目并加载候选" style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          下拉为「施工管理-项目信息」中的施工项目，可多次从报价清单批量追加进度任务；与已有任务在同一项目、同一工作表且施工内容完全相同的条目提交时会自动跳过、不重复创建（按报价清单行关联时以报价行为准）。选择项目后按报价清单逐条生成任务候选；点击「加载候选」时在弹窗中确认计划周期（默认与项目信息一致），批量创建将使用该周期。
        </Text>
        <Space wrap size="middle" align="center">
          <Space size={8} align="center">
            <Text type="secondary">项目名称：</Text>
            <Select
              showSearch
              allowClear
              placeholder="请选择施工项目"
              value={projectName || undefined}
              loading={projectOptionsLoading}
              options={projectOptions.map((p) => ({ value: p, label: p }))}
              style={{ width: 280 }}
              onChange={(v) => {
                setProjectName((v ?? '') as string)
                setRows([])
                setSelectedKeys([])
                setSheetFilter(null)
                setBulkPlannedStart('')
                setBulkPlannedEnd('')
                setQuoteLoadStats(null)
              }}
              onSearch={(v) => fetchConstructionProjects(v)}
              filterOption={false}
            />
          </Space>
          <Button type="primary" loading={loading} onClick={openLoadConfirmModal}>
            加载候选
          </Button>
        </Space>
      </Card>

      {rows.length > 0 && (
        <Card size="small" title="第二步：筛选、分配负责人并加入进度（每条任务必须选择负责人）" style={{ marginBottom: 16 }}>
          <Space wrap size="middle" align="center" style={{ marginBottom: 8 }}>
            <Space size={8} align="center" wrap>
              <Text type="secondary">按 Sheet 筛选：</Text>
              <Select
                allowClear
                placeholder="全部"
                style={{ width: 180 }}
                value={sheetFilter ?? undefined}
                options={sheetOptions}
                onChange={(v) => setSheetFilter(v ?? null)}
              />
              <Button
                size="small"
                disabled={filtered.length === 0 || selectedInFilteredCount === filtered.length}
                onClick={() => setSelectedKeys(filtered.map((r) => r.key))}
              >
                全选当前范围（全部页）
              </Button>
              <Button
                size="small"
                disabled={selectedInFilteredCount === 0}
                onClick={() => setSelectedKeys([])}
              >
                取消全选
              </Button>
            </Space>
            <Space size={8} align="center">
              <Text type="secondary">负责人一键设置：</Text>
              <Select
                showSearch
                allowClear
                placeholder="从用户中选择"
                value={defaultResponsible || undefined}
                onChange={(v) => setDefaultResponsible((v ?? '') as string)}
                options={managerSelectOptions}
                optionFilterProp="label"
                style={{ width: 240 }}
                filterOption={(input, opt) =>
                  (opt?.label ?? '').toString().toLowerCase().includes((input || '').toLowerCase())
                }
              />
              <Button size="small" onClick={() => applyResponsible('selected')}>
                应用到已选
              </Button>
              <Button size="small" onClick={() => applyResponsible('filtered')}>
                应用到筛选
              </Button>
              <Button size="small" onClick={() => applyResponsible('all')}>
                应用到全部
              </Button>
            </Space>
            <Text type="secondary">
              已选 {selectedInFilteredCount} / {filtered.length} 条
              {sheetFilter ? '（仅提交当前 Sheet 筛选范围内已勾选的行）' : ''}
            </Text>
            {bulkPlannedStart && bulkPlannedEnd ? (
              <Text type="secondary">
                批量计划周期：{bulkPlannedStart} ~ {bulkPlannedEnd}
              </Text>
            ) : null}
            <Button type="primary" disabled={selectedInFilteredCount === 0} onClick={addToProgressList}>
              加入进度管理
            </Button>
          </Space>
        </Card>
      )}

      {rows.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">共 {rows.length} 条任务候选，勾选后点击「加入进度管理」。</Text>
          {quoteLoadStats ? (
            <Paragraph type="secondary" style={{ margin: '8px 0 0', fontSize: 13 }}>
              说明：报价清单本次共读取 <Text strong>{quoteLoadStats.rows}</Text> 行；生成{' '}
              <Text strong>{quoteLoadStats.candidates}</Text> 条任务候选（与报价清单一一对应，同名多行不合并）。
              {quoteLoadStats.skippedEmptyName > 0 ? (
                <>
                  {' '}
                  另有 <Text strong>{quoteLoadStats.skippedEmptyName}</Text> 行因商品名称为空已跳过。
                </>
              ) : null}
            </Paragraph>
          ) : null}
        </div>
      )}

      <Table
        rowKey="key"
        loading={loading}
        dataSource={filtered}
        columns={columns}
        pagination={{ pageSize: 10 }}
        size="middle"
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys),
          preserveSelectedRowKeys: true,
        }}
      />

      <Modal
        title="确认计划周期后加载候选"
        open={loadConfirmOpen}
        okText="确认并加载"
        cancelText="取消"
        onCancel={() => setLoadConfirmOpen(false)}
        onOk={() => executeLoadFromProducts()}
        destroyOnClose
        afterOpenChange={(open) => {
          if (open) applyProjectPlannedRangeToLoadForm()
        }}
        width={440}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          以下日期将应用于本次加载后批量创建的进度任务。默认已填入当前项目在「项目信息」中的计划周期，可按需修改。
        </Text>
        <Form form={loadConfirmForm} layout="vertical" preserve={false}>
          <Form.Item
            name="planned_start"
            label="计划开始日期"
            rules={[{ required: true, message: '请选择开始日期' }]}
          >
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item
            name="planned_end"
            label="计划结束日期"
            rules={[{ required: true, message: '请选择结束日期' }]}
          >
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="部分任务未创建（同项目同工作表下内容重复）"
        open={skippedModalOpen}
        onOk={handleSkippedModalOk}
        onCancel={handleSkippedModalOk}
        cancelButtonProps={{ style: { display: 'none' } }}
        okText="知道了，返回进度管理"
        width={520}
      >
        {skippedResult && (
          <>
            <p style={{ marginBottom: 12 }}>
              已成功加入 <strong>{skippedResult.created}</strong> 条进度任务；以下{' '}
              <strong>{skippedResult.skippedItems.length}</strong> 条因该项目<strong>同一工作表</strong>下已存在相同施工内容而被跳过，未重复创建：
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, maxHeight: 280, overflowY: 'auto' }}>
              {skippedResult.skippedItems.map((item, idx) => (
                <li key={idx} style={{ marginBottom: 4 }}>
                  {item.sheet_name ? <Tag style={{ marginRight: 6 }}>{item.sheet_name}</Tag> : null}
                  {item.content}
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>
    </Card>
  )
}

export default ConstructionProgressBulkCreatePage

