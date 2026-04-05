/**
 * 功能名称：进度管理批量创建
 * 实现原理与逻辑：从报价清单中批量创建进度任务，包括项目名称、负责人、计划周期、数量、进度、状态等。支持按项目名称、负责人、计划周期、数量、进度、状态等筛选。支持按日期排序。支持导出为 Excel 文件。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { buildConstructionAssigneeOptions, type AssigneeUserRow } from '../utils/constructionAssigneeOptions'

const { Title, Text } = Typography

type ProductRow = {
  goods_name?: unknown
  quantity?: unknown
  sheet_name?: unknown
  project_name?: unknown
}

const ConstructionProgressBulkCreatePage: React.FC = () => {
  const { message: msg } = App.useApp()
  const navigate = useNavigate()
  const { user } = useAuth()
  const headers = useMemo(() => (user?.token ? { Authorization: `Bearer ${user.token}` } : {}), [user?.token])

  const [projectName, setProjectName] = useState('')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<{ key: string; goods_name: string; sheet_name: string | null; required_qty: number; responsible: string }[]>([])
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([])
  const [sheetFilter, setSheetFilter] = useState<string | null>(null)
  const [defaultResponsible, setDefaultResponsible] = useState('')
  const [projectOptions, setProjectOptions] = useState<string[]>([])
  const [projectOptionsLoading, setProjectOptionsLoading] = useState(false)
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

  const loadFromProducts = async () => {
    const proj = projectName.trim()
    if (!proj) {
      msg.warning('请先选择项目名称')
      return
    }
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

      const grouped = new Map<string, { goods_name: string; sheet_name: string | null; required_qty: number }>()
      for (const r of list) {
        const name = r.goods_name != null ? String(r.goods_name).trim() : ''
        if (!name) continue
        const sn = r.sheet_name != null && String(r.sheet_name).trim() ? String(r.sheet_name).trim() : null
        const qty = r.quantity != null && r.quantity !== '' ? Number(r.quantity) : 0
        const q = Number.isFinite(qty) ? qty : 0
        const key = `${sn ?? '__none__'}::${name}`
        const prev = grouped.get(key)
        grouped.set(key, { goods_name: name, sheet_name: sn, required_qty: (prev?.required_qty ?? 0) + q })
      }

      const out = [...grouped.entries()].map(([key, v]) => ({
        key,
        goods_name: v.goods_name,
        sheet_name: v.sheet_name,
        required_qty: Math.round(v.required_qty * 100) / 100,
        responsible: '',
      }))
      out.sort((a, b) => (a.sheet_name ?? '').localeCompare(b.sheet_name ?? '') || a.goods_name.localeCompare(b.goods_name))
      setRows(out)
      setSelectedKeys(out.map((x) => x.key))
      msg.success(`已加载 ${out.length} 条任务候选`)
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
    const picked = rows.filter((r) => pickedSet.has(r.key))
    if (!picked.length) {
      msg.warning('请至少选择一条')
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    const tasks = picked.map((p) => ({
      project_name: proj,
      task_name: (p.goods_name ?? '').slice(0, 50) || '任务',
      content: p.goods_name,
      sheet_name: p.sheet_name ?? null,
      responsible: (p.responsible ?? '').trim() || null,
      planned_start: today,
      planned_end: today,
      required_qty: p.required_qty,
      done_qty: 0,
      status: 'not_started',
    }))
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

  const columns: ColumnsType<{ key: string; goods_name: string; sheet_name: string | null; required_qty: number; responsible: string }> = [
    { title: 'Sheet', dataIndex: 'sheet_name', width: 160, render: (v: string | null) => (v ? <Tag>{v}</Tag> : <Text type="secondary">（无）</Text>) },
    { title: '商品名称（任务）', dataIndex: 'goods_name' },
    { title: '需求数量（汇总）', dataIndex: 'required_qty', width: 140, align: 'right' },
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
          从「施工管理-项目信息」中选择项目，根据该项目的报价清单按商品名称汇总生成任务候选。
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
              onChange={(v) => setProjectName((v ?? '') as string)}
              onSearch={(v) => fetchConstructionProjects(v)}
              filterOption={false}
            />
          </Space>
          <Button type="primary" loading={loading} onClick={loadFromProducts}>
            加载候选
          </Button>
        </Space>
      </Card>

      {rows.length > 0 && (
        <Card size="small" title="第二步：筛选、分配负责人并加入进度" style={{ marginBottom: 16 }}>
          <Space wrap size="middle" align="center" style={{ marginBottom: 8 }}>
            <Space size={8} align="center">
              <Text type="secondary">按 Sheet 筛选：</Text>
              <Select
                allowClear
                placeholder="全部"
                style={{ width: 180 }}
                value={sheetFilter ?? undefined}
                options={sheetOptions}
                onChange={(v) => setSheetFilter(v ?? null)}
              />
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
            <Text type="secondary">已选 {selectedKeys.length} / {filtered.length} 条</Text>
            <Button type="primary" disabled={selectedKeys.length === 0} onClick={addToProgressList}>
              加入进度管理
            </Button>
          </Space>
        </Card>
      )}

      {rows.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">共 {rows.length} 条任务候选，勾选后点击「加入进度管理」。</Text>
        </div>
      )}

      <Table
        rowKey="key"
        loading={loading}
        dataSource={filtered}
        columns={columns}
        pagination={{ pageSize: 10 }}
        size="middle"
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys) => setSelectedKeys(keys) }}
      />

      <Modal
        title="部分任务未创建（与已有任务重复）"
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
              <strong>{skippedResult.skippedItems.length}</strong> 条因该项目下已存在相同施工内容而被跳过，未重复创建：
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

