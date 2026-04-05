/**
 * 功能名称：规则管理
 * 实现原理与逻辑：维护弱电业务规则（硬规则/软规则/派生规则），支持按类型、系统、启用状态筛选；可新增/编辑/删除规则，
 * 配置条件表达式、动作类型与动作配置。支持关键词、AI 辅助生成规则描述。规则用于配单、校验、推导等业务逻辑。数据来自 /api/rules。
 */
import { CloudUploadOutlined, DeleteOutlined, EditOutlined, PlusOutlined, RobotOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  App,
  Badge,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useState } from 'react'

const { Title, Text } = Typography

export type RuleKeyword = { id?: number; keyword: string; weight?: number }

export type Rule = {
  id: number
  code: string
  name: string
  rule_type: 'hard' | 'soft' | 'derived'
  system_type: string
  scene_tags: string | null
  priority: number
  condition_expr: string | null
  action_type: 'constraint' | 'validate' | 'derive'
  action_config: string
  description: string | null
  enabled: number
  created_at: string
  updated_at: string
  keywords?: RuleKeyword[]
}

const RULE_TYPES = [
  { label: '硬规则', value: 'hard' },
  { label: '软规则', value: 'soft' },
  { label: '派生规则', value: 'derived' },
]
const ACTION_TYPES = [
  { label: '约束(constraint)', value: 'constraint' },
  { label: '校验(validate)', value: 'validate' },
  { label: '推导(derive)', value: 'derive' },
]
const SYSTEM_TYPES = [
  { label: '通用', value: 'general' },
  { label: '视频监控', value: 'video' },
  { label: '门禁', value: 'access' },
  { label: '综合布线', value: 'cabling' },
  { label: '广播', value: 'broadcast' },
  { label: '会议', value: 'meeting' },
]

const RulesPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<Rule[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form] = Form.useForm()
  const [ruleTypeFilter, setRuleTypeFilter] = useState<string | undefined>(undefined)
  const [systemTypeFilter, setSystemTypeFilter] = useState<string | undefined>(undefined)
  const [enabledFilter, setEnabledFilter] = useState<string | undefined>(undefined)
  const [keywordSearch, setKeywordSearch] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const handleImportBaseConfig = async () => {
    setImportLoading(true)
    try {
      await axios.post('/api/rules/import-base-config')
      msg.success('基础规则配置已导入')
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '导入失败')
    } finally {
      setImportLoading(false)
    }
  }

  const handleAiCreate = async () => {
    const text = aiText.trim()
    if (!text) {
      msg.warning('请用自然语言描述要新增的规则')
      return
    }
    setAiLoading(true)
    try {
      await axios.post('/api/rules/from-natural-language', { text })
      msg.success('已根据描述生成并保存规则')
      setAiModalOpen(false)
      setAiText('')
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'AI 解析或保存失败')
    } finally {
      setAiLoading(false)
    }
  }

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (ruleTypeFilter) params.set('rule_type', ruleTypeFilter)
      if (systemTypeFilter) params.set('system_type', systemTypeFilter)
      if (enabledFilter !== undefined) params.set('enabled', enabledFilter)
      if (keywordSearch.trim()) params.set('keyword', keywordSearch.trim())
      const res = await axios.get<{ list: Rule[]; total: number }>(`/api/rules?${params.toString()}`)
      setList(res.data.list || [])
      setTotal(res.data.total ?? 0)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [ruleTypeFilter, systemTypeFilter, enabledFilter, keywordSearch, msg])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const openCreate = () => {
    setEditingId(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (row: Rule) => {
    setEditingId(row.id)
    setModalOpen(true)
  }

  // 编辑时等弹窗和表单挂载后再拉取详情并回填，避免 destroyOnHidden 导致 setFieldsValue 不生效
  useEffect(() => {
    if (!modalOpen || editingId == null) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await axios.get<Rule & { keywords: RuleKeyword[] }>(`/api/rules/${editingId}`)
        if (cancelled) return
        const r = res.data
        form.setFieldsValue({
          code: r.code,
          name: r.name,
          rule_type: r.rule_type,
          system_type: r.system_type,
          scene_tags: r.scene_tags ? (r.scene_tags.startsWith('[') ? r.scene_tags : JSON.stringify([])) : '',
          priority: r.priority,
          condition_expr: r.condition_expr ?? '',
          action_type: r.action_type,
          action_config: typeof r.action_config === 'string' ? r.action_config : JSON.stringify(r.action_config ?? {}, null, 2),
          description: r.description ?? '',
          enabled: r.enabled === 1,
          keywords: (r.keywords || []).map((k) => ({ keyword: k.keyword, weight: k.weight ?? 1 })),
        })
      } catch (e: unknown) {
        if (!cancelled) {
          msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '获取详情失败')
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [modalOpen, editingId, form, msg])

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      const payload = {
        ...values,
        scene_tags: values.scene_tags?.trim() ? values.scene_tags.trim() : null,
        action_config: values.action_config?.trim() || '{}',
        enabled: values.enabled === true ? 1 : 0,
        keywords: (values.keywords || []).map((k: { keyword?: string; weight?: number }) => ({
          keyword: k?.keyword?.trim() || '',
          weight: k?.weight ?? 1,
        })).filter((k: { keyword: string }) => k.keyword),
      }
      if (editingId) {
        await axios.put(`/api/rules/${editingId}`, payload)
        msg.success('更新成功')
      } else {
        await axios.post('/api/rules', payload)
        msg.success('创建成功')
      }
      setModalOpen(false)
      fetchList()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`/api/rules/${id}`)
      msg.success('已删除')
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const columns: ColumnsType<Rule> = [
    { title: '编码', dataIndex: 'code', width: 140, ellipsis: true },
    { title: '名称', dataIndex: 'name', width: 140, ellipsis: true },
    {
      title: '规则类型',
      dataIndex: 'rule_type',
      width: 90,
      render: (t: Rule['rule_type']) => (
        <Tag color={t === 'hard' ? 'red' : t === 'soft' ? 'blue' : 'green'}>{RULE_TYPES.find((r) => r.value === t)?.label ?? t}</Tag>
      ),
    },
    { title: '子系统', dataIndex: 'system_type', width: 90 },
    { title: '优先级', dataIndex: 'priority', width: 72, align: 'right' },
    {
      title: '执行类型',
      dataIndex: 'action_type',
      width: 100,
      render: (t: Rule['action_type']) => ACTION_TYPES.find((r) => r.value === t)?.label ?? t,
    },
    { title: '条件表达式', dataIndex: 'condition_expr', width: 140, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 72,
      render: (v: number) => (v === 1 ? <Badge status="success" text="启用" /> : <Badge status="default" text="停用" />),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 92,
      render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : ''),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      fixed: 'right',
      render: (_, row) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm title="确定删除该规则？" onConfirm={() => handleDelete(row.id)} okText="删除" cancelText="取消">
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Title level={4} style={{ marginBottom: 0 }}>
        规则库
      </Title>
      <Text type="secondary">
        用于自动配单的规则：硬规则/软规则/派生规则，可配置条件表达式与执行类型（约束/校验/推导），并关联关键词便于匹配。
      </Text>
      <Card>
        <Space wrap style={{ marginBottom: 16 }} align="center">
          <Select
            placeholder="规则类型"
            allowClear
            style={{ width: 120 }}
            value={ruleTypeFilter}
            onChange={setRuleTypeFilter}
            options={RULE_TYPES}
          />
          <Select
            placeholder="子系统"
            allowClear
            style={{ width: 120 }}
            value={systemTypeFilter}
            onChange={setSystemTypeFilter}
            options={SYSTEM_TYPES}
          />
          <Select
            placeholder="状态"
            allowClear
            style={{ width: 100 }}
            value={enabledFilter}
            onChange={setEnabledFilter}
            options={[
              { label: '启用', value: '1' },
              { label: '停用', value: '0' },
            ]}
          />
          <Input.Search
            placeholder="编码/名称/说明"
            allowClear
            style={{ width: 200 }}
            value={keywordSearch}
            onChange={(e) => setKeywordSearch(e.target.value)}
            onSearch={() => fetchList()}
            enterButton="查询"
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增规则
          </Button>
          <Button icon={<RobotOutlined />} onClick={() => setAiModalOpen(true)}>
            AI 新增规则
          </Button>
          <Button icon={<CloudUploadOutlined />} loading={importLoading} onClick={handleImportBaseConfig}>
            导入基础规则配置
          </Button>
          <Button onClick={fetchList}>刷新</Button>
        </Space>
        <Table<Rule>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 1100 }}
          pagination={{ total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>

      <Modal
        title={editingId ? '编辑规则' : '新增规则'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="code" label="编码" rules={[{ required: true, message: '请输入编码' }]}>
            <Input placeholder="如 CAM_SWITCH_PORT" disabled={!!editingId} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="规则名称" />
          </Form.Item>
          <Form.Item name="rule_type" label="规则类型" rules={[{ required: true }]}>
            <Select options={RULE_TYPES} placeholder="硬规则/软规则/派生规则" />
          </Form.Item>
          <Form.Item name="system_type" label="子系统类型">
            <Select options={SYSTEM_TYPES} placeholder="general/video/access/cabling 等" />
          </Form.Item>
          <Form.Item name="scene_tags" label="适用场景(JSON 数组)">
            <Input.TextArea rows={1} placeholder='如 ["office","parking"]，留空表示通用' />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="数值越大越先匹配" />
          </Form.Item>
          <Form.Item name="condition_expr" label="条件表达式">
            <Input placeholder='如 camera_count > 32 或 system_type == "video"' />
          </Form.Item>
          <Form.Item name="action_type" label="执行类型" rules={[{ required: true }]}>
            <Select options={ACTION_TYPES} />
          </Form.Item>
          <Form.Item name="action_config" label="执行配置(JSON)">
            <Input.TextArea rows={4} placeholder='如 {"prompt_text":"约束说明"} 或 {"check":"...","fix_suggestion":"..."}' />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} placeholder="规则说明，可给 AI 或用户看" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" initialValue={true}>
            <Select
              options={[
                { label: '启用', value: true },
                { label: '停用', value: false },
              ]}
            />
          </Form.Item>
          <Form.Item name="keywords" label="关键词">
            <Form.List name="keywords">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...rest }) => (
                    <Space key={key} style={{ marginBottom: 8 }} align="baseline">
                      <Form.Item {...rest} name={[name, 'keyword']} rules={[{ required: false }]} noStyle>
                        <Input placeholder="关键词" style={{ width: 140 }} />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'weight']} noStyle>
                        <InputNumber min={0} step={0.1} placeholder="权重" style={{ width: 72 }} />
                      </Form.Item>
                      <Button type="text" danger onClick={() => remove(name)}>
                        删除
                      </Button>
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add({ keyword: '', weight: 1 })} block>
                    + 添加关键词
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="AI 新增规则"
        open={aiModalOpen}
        onOk={handleAiCreate}
        onCancel={() => { setAiModalOpen(false); setAiText('') }}
        confirmLoading={aiLoading}
        okText="生成并保存"
        width={520}
        destroyOnHidden
      >
        <Input.TextArea
          value={aiText}
          onChange={(e) => setAiText(e.target.value)}
          placeholder={'用自然语言描述要新增的规则，例如：\n当摄像机数量大于32时，需要提示选用高端口交换机，并预留20%端口；规则类型为软规则，适用于视频监控子系统。'}
          rows={6}
          autoSize={{ minRows: 5, maxRows: 12 }}
        />
      </Modal>
    </Space>
  )
}

export default RulesPage
