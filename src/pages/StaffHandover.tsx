/**
 * 离职交接：管理员/公司管理按业务域批量替换负责人（施工、零星工程、维护排单）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Modal, Select, Space, Tabs, Typography } from 'antd'
import axios from 'axios'
import { useAuth } from '../auth/AuthContext'
import {
  buildConstructionAssigneeOptions,
  type AssigneeInactiveRef,
  type AssigneeUserRow,
} from '../utils/constructionAssigneeOptions'

const { Title, Paragraph } = Typography

type Scope = 'construction' | 'minor_work' | 'maintenance'

const TAB_COPY: Record<Scope, { label: string; title: string; desc: string }> = {
  construction: {
    label: '施工管理',
    title: '现场负责人 + 进度任务负责人',
    desc: '批量替换施工项目「现场负责人」与进度任务「负责人」。匹配为与所填原值完全一致（一般为系统登录名）。',
  },
  minor_work: {
    label: '维护管理 · 零星工程',
    title: '执行人',
    desc: '批量替换零星工程「执行人」字段。若历史填写的是姓名或班组名而非登录名，请按数据库中实际存储的文本填写原值。',
  },
  maintenance: {
    label: '维护管理 · 维护排单',
    title: '负责人',
    desc: '批量替换维护排单「负责人」字段；匹配方式为全文一致。',
  },
}

const emptyScopeMap = (): Record<Scope, string | undefined> => ({
  construction: undefined,
  minor_work: undefined,
  maintenance: undefined,
})

const StaffHandoverPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { hasRole } = useAuth()
  const allowed = hasRole('admin') || hasRole('company_management')

  const [activeTab, setActiveTab] = useState<Scope>('construction')
  const [fromByScope, setFromByScope] = useState<Record<Scope, string | undefined>>(emptyScopeMap)
  const [toByScope, setToByScope] = useState<Record<Scope, string | undefined>>(emptyScopeMap)
  const [loadingScope, setLoadingScope] = useState<Scope | null>(null)

  const [managerUsers, setManagerUsers] = useState<AssigneeUserRow[]>([])
  const [inactiveRefs, setInactiveRefs] = useState<AssigneeInactiveRef[]>([])

  const loadOptions = useCallback(async () => {
    try {
      const res = await axios.get<{
        list: AssigneeUserRow[]
        inactive_referenced?: AssigneeInactiveRef[]
      }>('/api/staff-handover/assignee-options')
      setManagerUsers(res.data?.list ?? [])
      setInactiveRefs(res.data?.inactive_referenced ?? [])
    } catch (e: unknown) {
      const m = e && typeof e === 'object' && 'response' in e ? (e as { response?: { data?: { message?: string } } }).response?.data?.message : undefined
      msg.error(m ?? '加载用户列表失败')
    }
  }, [msg])

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  const allOptions = useMemo(
    () => buildConstructionAssigneeOptions(managerUsers, inactiveRefs),
    [managerUsers, inactiveRefs],
  )
  const activeOnly = useMemo(() => buildConstructionAssigneeOptions(managerUsers, []), [managerUsers])

  const submit = (scope: Scope) => {
    const fromU = (fromByScope[scope] ?? '').trim()
    const toU = (toByScope[scope] ?? '').trim()
    if (!fromU || !toU) {
      msg.warning('请选择或填写原值与新负责人')
      return
    }
    if (fromU === toU) {
      msg.warning('原值与新账号不能相同')
      return
    }
    const copy = TAB_COPY[scope]
    Modal.confirm({
      title: `确认交接：${copy.label}`,
      content: `将 ${copy.title} 中与原值「${fromU}」一致的记录全部替换为「${toU}」？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        setLoadingScope(scope)
        try {
          const res = await axios.post<{
            projects_updated?: number
            tasks_updated?: number
            minor_work_orders_updated?: number
            maintenance_tasks_updated?: number
          }>('/api/staff-handover/reassign', {
            scope,
            from_username: fromU,
            to_username: toU,
          })
          const d = res.data
          if (scope === 'construction') {
            msg.success(`已更新施工项目 ${d?.projects_updated ?? 0} 条、进度任务 ${d?.tasks_updated ?? 0} 条`)
          } else if (scope === 'minor_work') {
            msg.success(`已更新零星工程 ${d?.minor_work_orders_updated ?? 0} 条`)
          } else {
            msg.success(`已更新维护排单 ${d?.maintenance_tasks_updated ?? 0} 条`)
          }
          setFromByScope((s) => ({ ...s, [scope]: undefined }))
          setToByScope((s) => ({ ...s, [scope]: undefined }))
          await loadOptions()
        } catch (e: unknown) {
          const m = e && typeof e === 'object' && 'response' in e ? (e as { response?: { data?: { message?: string } } }).response?.data?.message : undefined
          msg.error(m ?? '交接失败')
          throw e
        } finally {
          setLoadingScope(null)
        }
      },
    })
  }

  const renderPanel = (scope: Scope) => {
    const from = fromByScope[scope]
    const to = toByScope[scope]
    return (
      <Card size="small" style={{ marginTop: 16 }}>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {TAB_COPY[scope].desc}
        </Paragraph>
        <Space wrap align="center" style={{ marginTop: 16 }}>
          <Select
            showSearch
            allowClear
            placeholder="原负责人 / 原执行人（与系统存储一致）"
            style={{ width: 280 }}
            value={from}
            onChange={(v) => setFromByScope((s) => ({ ...s, [scope]: v }))}
            options={allOptions}
            optionFilterProp="label"
            filterOption={(input, opt) =>
              (opt?.label ?? '').toString().toLowerCase().includes((input || '').toLowerCase())
            }
          />
          <span style={{ color: 'var(--ant-colorTextSecondary)' }}>→</span>
          <Select
            showSearch
            allowClear
            placeholder="新负责人（须为在职登录名）"
            style={{ width: 280 }}
            value={to}
            onChange={(v) => setToByScope((s) => ({ ...s, [scope]: v }))}
            options={activeOnly}
            optionFilterProp="label"
            filterOption={(input, opt) =>
              (opt?.label ?? '').toString().toLowerCase().includes((input || '').toLowerCase())
            }
          />
          <Button type="primary" loading={loadingScope === scope} disabled={!allowed} onClick={() => submit(scope)}>
            执行交接
          </Button>
        </Space>
      </Card>
    )
  }

  if (!allowed) {
    return (
      <Card>
        <Title level={5}>离职交接</Title>
        <Paragraph type="secondary">仅管理员或公司管理角色可使用此功能。</Paragraph>
      </Card>
    )
  }

  return (
    <Card>
      <Title level={5} style={{ marginBottom: 8 }}>
        离职交接
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        钉钉侧离职并停用账号后，可在此按业务把其负责记录批量改给接手人。以下三个页签分别对应施工管理、维护管理·零星工程、维护管理·维护排单；新负责人须为在职系统用户。
      </Paragraph>
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as Scope)}
        style={{ marginTop: 16 }}
        items={[
          { key: 'construction', label: TAB_COPY.construction.label, children: renderPanel('construction') },
          { key: 'minor_work', label: TAB_COPY.minor_work.label, children: renderPanel('minor_work') },
          { key: 'maintenance', label: TAB_COPY.maintenance.label, children: renderPanel('maintenance') },
        ]}
      />
    </Card>
  )
}

export default StaffHandoverPage
