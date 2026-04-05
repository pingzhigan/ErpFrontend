/**
 * 功能名称：用户与权限管理
 * 实现原理与逻辑：用户 Tab：用户列表的增删改、分配角色与状态；权限组 Tab：权限组的增删改、配置权限项。用户与权限组通过角色关联，
 * 菜单权限由权限组配置，通过钉钉「部门→权限组」映射到人员；敏感数据（报价/成本）仅在用户编辑中按人授权。数据来自 /api/users、/api/role-groups、/api/permissions 等。
 */
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import React, { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { PermissionCheckTree } from '../components/PermissionCheckTree'
import { useAuth } from '../auth/AuthContext'
import { useReauthModal } from '../hooks/useReauthModal'

const { Title, Text, Paragraph } = Typography

type UserRecord = {
  id: number
  username: string
  real_name: string | null
  email: string | null
  dingtalk_userid: string | null
  roles: string[]
  /** 按人授权的敏感权限，与部门权限组无关 */
  sensitive_permissions?: string[]
  status: string
  created_at: string
  updated_at: string
}

type RoleGroupRecord = {
  id: number
  name: string
  code: string
  description: string | null
  permissions: string[]
  created_at: string
  updated_at: string
}

type PermissionOption = { value: string; label: string }

type MirrorDeptRow = { dingtalk_dept_id: number; name: string; parent_id: number }

type AiRoleGroupDraft = {
  name: string
  code: string
  description: string
  permissions: string[]
  dept_ids: number[]
}

/** 与后端业务约定一致：财务敏感数据权限 code */
const SENSITIVE_PERMISSION_KEYS = ['products', 'cost-list'] as const

const SENSITIVE_PERMISSION_LABEL: Record<(typeof SENSITIVE_PERMISSION_KEYS)[number], string> = {
  products: '报价清单',
  'cost-list': '成本清单',
}

const SENSITIVE_PERMISSION_HINT: Record<(typeof SENSITIVE_PERMISSION_KEYS)[number], string> = {
  products: '可访问报价菜单、项目内报价 Tab 及报价类金额汇总。',
  'cost-list': '可访问成本菜单、项目内成本 Tab 及成本类金额汇总。',
}

function diffSensitivePermissions(prev: string[] | undefined, next: string[] | undefined) {
  const a = new Set(prev ?? [])
  const b = new Set(next ?? [])
  const added = SENSITIVE_PERMISSION_KEYS.filter((k) => b.has(k) && !a.has(k))
  const removed = SENSITIVE_PERMISSION_KEYS.filter((k) => !b.has(k) && a.has(k))
  return { added, removed }
}

/** 必须由 Form.Item name="sensitive_permissions" 包裹，通过 value/onChange 与表单绑定（否则开关可能无响应） */
function UserSensitiveDataEditor({
  value,
  onChange,
}: {
  value?: string[]
  onChange?: (next: string[]) => void
}) {
  const perms = Array.isArray(value) ? value : []
  const setPerms = (next: string[]) => {
    onChange?.(next)
  }
  return (
    <Card
      size="small"
      title="敏感数据授权（按人员）"
      style={{ marginBottom: 12 }}
      extra={<Text type="secondary" style={{ fontSize: 12 }}>与部门/权限组无关</Text>}
    >
      <Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
        报价清单、成本清单仅在此按<strong>具体账号</strong>开关。保存时若相对该用户当前记录有授予或收回，将二次确认。
      </Paragraph>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {SENSITIVE_PERMISSION_KEYS.map((key) => (
          <div
            key={key}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <Text strong>{SENSITIVE_PERMISSION_LABEL[key]}</Text>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {SENSITIVE_PERMISSION_HINT[key]}
                </Text>
              </div>
            </div>
            <Switch
              checked={perms.includes(key)}
              checkedChildren="开"
              unCheckedChildren="关"
              onChange={(on) =>
                setPerms(on ? [...new Set([...perms, key])] : perms.filter((p) => p !== key))
              }
            />
          </div>
        ))}
      </Space>
    </Card>
  )
}

const UserManagementPage: React.FC = () => {
  const { message: msg, modal } = App.useApp()
  const { user: authUser } = useAuth()
  const { askReauth, reauthModal } = useReauthModal()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [roleGroups, setRoleGroups] = useState<RoleGroupRecord[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [roleGroupsLoading, setRoleGroupsLoading] = useState(false)
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [userForm] = Form.useForm()
  const [editingUserId, setEditingUserId] = useState<number | null>(null)
  /** 当前编辑的用户（用于表单 initialValues，解决弹窗打开时表单不填值的问题） */
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)
  const [roleGroupModalOpen, setRoleGroupModalOpen] = useState(false)
  const [roleGroupForm] = Form.useForm()
  const [editingRoleGroupId, setEditingRoleGroupId] = useState<number | null>(null)
  /** 当前编辑的权限组（用于表单 initialValues，解决弹窗打开时表单不填值的问题） */
  const [editingRoleGroup, setEditingRoleGroup] = useState<RoleGroupRecord | null>(null)
  const [menuPermissionOptions, setMenuPermissionOptions] = useState<PermissionOption[]>([])
  const [mirrorDepts, setMirrorDepts] = useState<MirrorDeptRow[]>([])
  const [aiDeptIds, setAiDeptIds] = useState<number[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false)
  const [aiDrafts, setAiDrafts] = useState<AiRoleGroupDraft[]>([])
  const [aiTruncated, setAiTruncated] = useState(false)

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      const res = await axios.get<{ list: UserRecord[] }>('/api/users')
      setUsers(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载用户列表失败')
    } finally {
      setUsersLoading(false)
    }
  }, [msg])

  const fetchRoleGroups = useCallback(async () => {
    setRoleGroupsLoading(true)
    try {
      const res = await axios.get<{ list: RoleGroupRecord[] }>('/api/role-groups')
      setRoleGroups(res.data.list || [])
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '加载权限组失败')
    } finally {
      setRoleGroupsLoading(false)
    }
  }, [msg])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  useEffect(() => {
    fetchRoleGroups()
  }, [fetchRoleGroups])

  const fetchMenuPermissionOptions = useCallback(async () => {
    try {
      const res = await axios.get<{ list: PermissionOption[] }>('/api/permissions/options', {
        params: { scope: 'menu' },
      })
      setMenuPermissionOptions(res.data?.list ?? [])
    } catch {
      setMenuPermissionOptions([])
    }
  }, [])

  useEffect(() => {
    if (roleGroupModalOpen) fetchMenuPermissionOptions()
  }, [roleGroupModalOpen, fetchMenuPermissionOptions])

  useEffect(() => {
    if (!roleGroupModalOpen || editingRoleGroupId) return
    void (async () => {
      try {
        const res = await axios.get<{ list: MirrorDeptRow[] }>('/api/role-groups/dingtalk-mirror-departments')
        setMirrorDepts(res.data.list ?? [])
      } catch {
        setMirrorDepts([])
      }
    })()
  }, [roleGroupModalOpen, editingRoleGroupId])

  const runAiSuggestRoleGroups = async () => {
    setAiLoading(true)
    try {
      const res = await axios.post<{
        drafts: AiRoleGroupDraft[]
        truncated?: boolean
        dept_count?: number
      }>('/api/role-groups/ai-suggest-from-dingtalk', {
        dept_ids: aiDeptIds.length ? aiDeptIds : undefined,
      })
      const drafts = res.data.drafts ?? []
      if (!drafts.length) {
        msg.warning('未生成有效草案')
        return
      }
      setAiDrafts(drafts)
      setAiTruncated(!!res.data.truncated)
      setAiDrawerOpen(true)
      msg.success(`已生成 ${drafts.length} 个权限组草案，请在抽屉中选择填入表单`)
      if (res.data.truncated) {
        msg.warning('参与分析的部门数量已截断，可在钉钉集成中精简后重试')
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || 'AI 生成失败（请检查大模型 API Key 与网络）')
    } finally {
      setAiLoading(false)
    }
  }

  const applyAiDraftToForm = (d: AiRoleGroupDraft) => {
    roleGroupForm.setFieldsValue({
      name: d.name,
      code: d.code,
      description: d.description,
      permissions: d.permissions ?? [],
    })
    setAiDrawerOpen(false)
    msg.success('已填入当前表单，请核对权限后保存')
  }

  const openAddUser = () => {
    setEditingUserId(null)
    setEditingUser(null)
    setUserModalOpen(true)
  }

  const openEditUser = (row: UserRecord) => {
    setEditingUserId(row.id)
    setEditingUser(row)
    setUserModalOpen(true)
  }

  /** 用户表单初始值：编辑时用当前行，新增时用空 */
  const userInitialValues: Partial<UserRecord> & { password?: string } = editingUser
    ? {
        username: editingUser.username,
        real_name: editingUser.real_name ?? '',
        email: editingUser.email ?? '',
        dingtalk_userid: editingUser.dingtalk_userid ?? '',
        roles: editingUser.roles ?? [],
        sensitive_permissions: editingUser.sensitive_permissions ?? [],
        status: editingUser.status ?? 'active',
      }
    : {
        username: '',
        real_name: '',
        email: '',
        dingtalk_userid: '',
        roles: [],
        sensitive_permissions: [],
        status: 'active',
      }

  const handleUserSubmit = async () => {
    const cancelToken = Symbol('cancel-user-sensitive-confirm')
    try {
      const values = await userForm.validateFields()
      const prevSens = editingUser?.sensitive_permissions ?? []
      const nextSens = (userForm.getFieldValue('sensitive_permissions') ?? []) as string[]
      const { added, removed } = diffSensitivePermissions(prevSens, nextSens)

      const persistUser = async () => {
        if (editingUserId) {
          const payload: Record<string, unknown> = {
            username: values.username,
            real_name: values.real_name || null,
            email: values.email || null,
            dingtalk_userid: (values.dingtalk_userid ?? '').toString().trim() || null,
            roles: values.roles,
            sensitive_permissions: nextSens,
            status: values.status,
          }
          if (values.password) payload.password = values.password
          if (values.reauth_password) payload.reauth_password = values.reauth_password
          if (
            authUser?.id === editingUserId &&
            values.password &&
            values.current_password
          ) {
            payload.current_password = values.current_password
          }
          await axios.put(`/api/users/${editingUserId}`, payload)
        } else {
          await axios.post('/api/users', {
            username: values.username,
            password: values.password,
            real_name: values.real_name || null,
            email: values.email || null,
            dingtalk_userid: (values.dingtalk_userid ?? '').toString().trim() || null,
            roles: values.roles || [],
            sensitive_permissions: nextSens,
            status: values.status,
          })
        }
      }

      if (added.length > 0 || removed.length > 0) {
        await new Promise<void>((resolve, reject) => {
          modal.confirm({
            title: '敏感数据授权变更确认（按人员）',
            width: 560,
            okText: '确认保存',
            cancelText: '返回修改',
            content: (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {added.length > 0 ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="即将向该用户授予以下敏感权限"
                    description={
                      <div>
                        {added.map((k) => (
                          <div key={k}>
                            · {SENSITIVE_PERMISSION_LABEL[k]}：{SENSITIVE_PERMISSION_HINT[k]}
                          </div>
                        ))}
                      </div>
                    }
                  />
                ) : null}
                {removed.length > 0 ? (
                  <Alert
                    type="info"
                    showIcon
                    message="即将收回该用户的以下敏感权限"
                    description={
                      <div>
                        {removed.map((k) => (
                          <div key={k}>· {SENSITIVE_PERMISSION_LABEL[k]}</div>
                        ))}
                      </div>
                    }
                  />
                ) : null}
              </Space>
            ),
            onOk: async () => {
              try {
                await persistUser()
                resolve()
              } catch (err) {
                reject(err)
              }
            },
            onCancel: () => reject(cancelToken),
          })
        })
      } else {
        await persistUser()
      }

      msg.success(editingUserId ? '用户已更新' : '用户已创建')
      setUserModalOpen(false)
      fetchUsers()
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      if (e === cancelToken) throw e
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || '保存失败')
    }
  }

  const handleDeleteUser = async (id: number) => {
    const pwd = await askReauth('删除用户须输入您的登录密码确认')
    if (!pwd) return
    try {
      await axios.delete(`/api/users/${id}`, { data: { reauth_password: pwd } })
      msg.success('已删除')
      fetchUsers()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }

  const openAddRoleGroup = () => {
    setEditingRoleGroupId(null)
    setEditingRoleGroup(null)
    setAiDeptIds([])
    setAiDrafts([])
    setAiTruncated(false)
    roleGroupForm.resetFields()
    setRoleGroupModalOpen(true)
  }

  const openEditRoleGroup = (row: RoleGroupRecord) => {
    setEditingRoleGroupId(row.id)
    setEditingRoleGroup(row)
    setRoleGroupModalOpen(true)
  }

  /** 权限组表单初始值：编辑时用当前行，新增时用空 */
  const roleGroupInitialValues: Partial<RoleGroupRecord> = editingRoleGroup
    ? {
        name: editingRoleGroup.name,
        code: editingRoleGroup.code,
        description: editingRoleGroup.description ?? '',
        permissions: (editingRoleGroup.permissions ?? []).filter(
          (p) => !SENSITIVE_PERMISSION_KEYS.includes(p as (typeof SENSITIVE_PERMISSION_KEYS)[number]),
        ),
      }
    : { name: '', code: '', description: '', permissions: [] }

  const handleRoleGroupSubmit = async () => {
    try {
      const values = await roleGroupForm.validateFields()
      const payload: Record<string, unknown> = {
        ...values,
        permissions: values.permissions ?? [],
      }
      const { reauth_password: _rp, ...createBody } = payload
      if (editingRoleGroupId) {
        await axios.put(`/api/role-groups/${editingRoleGroupId}`, payload)
        msg.success('权限组已更新')
      } else {
        await axios.post('/api/role-groups', createBody)
        msg.success('权限组已创建')
      }
      setRoleGroupModalOpen(false)
      fetchRoleGroups()
      fetchUsers()
    } catch (e: any) {
      if (e?.errorFields) return
      msg.error(e?.response?.data?.message || '保存失败')
    }
  }

  const handleDeleteRoleGroup = async (id: number) => {
    const pwd = await askReauth('删除权限组须输入您的登录密码确认')
    if (!pwd) return
    try {
      await axios.delete(`/api/role-groups/${id}`, { data: { reauth_password: pwd } })
      msg.success('已删除')
      fetchRoleGroups()
      fetchUsers()
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '删除失败')
    }
  }

  const userColumns: ColumnsType<UserRecord> = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '姓名', dataIndex: 'real_name', width: 100, render: (v) => v ?? '-' },
    { title: '邮箱', dataIndex: 'email', width: 160, ellipsis: true, render: (v) => v ?? '-' },
    {
      title: '钉钉 userId',
      dataIndex: 'dingtalk_userid',
      width: 140,
      ellipsis: true,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '权限组',
      dataIndex: 'roles',
      width: 180,
      render: (roles: string[]) =>
        (roles || []).map((r) => (
          <Tag key={r} color={r === 'admin' ? 'red' : 'blue'}>
            {roleGroups.find((g) => g.code === r)?.name ?? r}
          </Tag>
        )),
    },
    {
      title: '敏感数据',
      dataIndex: 'sensitive_permissions',
      width: 140,
      render: (sp: string[] | undefined, row) =>
        (sp?.length ?? 0) > 0 ? (
          <Space size={[0, 4]} wrap>
            {sp!.map((k) => (
              <Tag key={k} color="orange">
                {SENSITIVE_PERMISSION_LABEL[k as keyof typeof SENSITIVE_PERMISSION_LABEL] ?? k}
              </Tag>
            ))}
            <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => openEditUser(row)}>
              编辑授权
            </Button>
          </Space>
        ) : (
          <Space size={4}>
            <Text type="secondary">—</Text>
            <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => openEditUser(row)}>
              编辑授权
            </Button>
          </Space>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (status: string) =>
        status === 'active' ? (
          <Badge status="success" text="启用" />
        ) : (
          <Badge status="default" text="停用" />
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_, row) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditUser(row)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除该用户？"
            onConfirm={() => handleDeleteUser(row.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const roleGroupColumns: ColumnsType<RoleGroupRecord> = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    { title: '名称', dataIndex: 'name', width: 120 },
    { title: '代码', dataIndex: 'code', width: 100 },
    { title: '描述', dataIndex: 'description', ellipsis: true, render: (v) => v ?? '-' },
    {
      title: '可访问权限',
      dataIndex: 'permissions',
      width: 120,
      render: (perms: string[]) => (perms?.length ?? 0) > 0 ? `${perms.length} 项` : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_, row) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditRoleGroup(row)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除该权限组？"
            onConfirm={() => handleDeleteRoleGroup(row.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      {reauthModal}
      <Title level={4} style={{ marginBottom: 16 }}>
        用户管理
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        <strong>菜单权限</strong>由权限组决定，可通过钉钉「部门与权限组」按部门映射到账号；<strong>敏感数据</strong>（报价/成本）仅在编辑用户时按人勾选，与部门无关。
      </Text>

      <Tabs
        defaultActiveKey="users"
        items={[
          {
            key: 'users',
            label: (
              <span>
                <UserOutlined /> 用户列表
              </span>
            ),
            children: (
              <Card>
                <div style={{ marginBottom: 16 }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openAddUser}>
                    新增用户
                  </Button>
                </div>
                <Table<UserRecord>
                  rowKey="id"
                  loading={usersLoading}
                  columns={userColumns}
                  dataSource={users}
                  pagination={{ showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
                />
              </Card>
            ),
          },
          {
            key: 'role-groups',
            label: (
              <span>
                <SafetyCertificateOutlined /> 权限组配置
              </span>
            ),
            children: (
              <Card>
                <div style={{ marginBottom: 16 }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openAddRoleGroup}>
                    新增权限组
                  </Button>
                </div>
                <Table<RoleGroupRecord>
                  rowKey="id"
                  loading={roleGroupsLoading}
                  columns={roleGroupColumns}
                  dataSource={roleGroups}
                  pagination={{ showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title={editingUserId ? '编辑用户' : '新增用户'}
        open={userModalOpen}
        onOk={handleUserSubmit}
        onCancel={() => setUserModalOpen(false)}
        width={640}
        destroyOnClose
      >
        <Form
          form={userForm}
          layout="vertical"
          preserve={false}
          key={editingUserId ?? 'new'}
          initialValues={userInitialValues}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="登录用户名" disabled={!!editingUserId} />
          </Form.Item>
          {!editingUserId && (
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password placeholder="登录密码" />
            </Form.Item>
          )}
          {editingUserId && (
            <Form.Item name="password" label="新密码（不修改请留空）">
              <Input.Password placeholder="留空则不修改密码" />
            </Form.Item>
          )}
          {editingUserId && authUser?.id === editingUserId && (
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.password !== cur.password}>
              {({ getFieldValue }) =>
                getFieldValue('password') ? (
                  <Form.Item
                    name="current_password"
                    label="当前登录密码"
                    rules={[{ required: true, message: '修改自己的密码须填写当前密码' }]}
                  >
                    <Input.Password placeholder="验证身份" autoComplete="current-password" />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          )}
          {editingUserId && (
            <Form.Item
              name="reauth_password"
              label="操作确认（您的登录密码）"
              extra="修改角色、敏感数据授权、状态、钉钉绑定、替他人设密码等时，后端会校验此字段。"
            >
              <Input.Password placeholder="敏感操作时必填" autoComplete="new-password" />
            </Form.Item>
          )}
          <Form.Item name="real_name" label="姓名">
            <Input placeholder="姓名" />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[{ type: 'email', message: '请输入有效邮箱' }]}
          >
            <Input placeholder="邮箱" />
          </Form.Item>
          <Form.Item
            name="dingtalk_userid"
            label="钉钉 userId"
            extra="与钉钉免登接口返回的 userid 一致；登录失败时后端会提示待绑定的 userId。"
          >
            <Input placeholder="选填，用于钉钉内免登" allowClear />
          </Form.Item>
          <Form.Item name="sensitive_permissions" style={{ marginBottom: 0 }}>
            <UserSensitiveDataEditor />
          </Form.Item>
          <Form.Item name="roles" label="权限组（菜单/部门侧）">
            <Select
              mode="multiple"
              placeholder="选择权限组（可多选）"
              allowClear
              options={roleGroups.map((g) => ({ label: `${g.name} (${g.code})`, value: g.code }))}
            />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { label: '启用', value: 'active' },
                { label: '停用', value: 'disabled' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingRoleGroupId ? '编辑权限组' : '新增权限组'}
        open={roleGroupModalOpen}
        onOk={handleRoleGroupSubmit}
        onCancel={() => setRoleGroupModalOpen(false)}
        width={680}
        destroyOnClose
      >
        <Form
          form={roleGroupForm}
          layout="vertical"
          preserve={false}
          key={editingRoleGroupId ?? 'new'}
          initialValues={roleGroupInitialValues}
        >
          {!editingRoleGroupId ? (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="AI 根据钉钉部门生成草案"
                description={
                  <span>
                    使用已同步到本地的钉钉部门镜像调用大模型，生成权限组建议（名称、code、权限勾选）。需配置{' '}
                    <Text code>DEEPSEEK_API_KEY</Text> 或 <Text code>QWEN_API_KEY</Text>。
                    每个部门会生成<strong>独立一条</strong>权限组草案（不合并）；不选部门则对镜像中全部部门各生成一条，部门很多时可能较慢或触发截断。
                    部门下拉为空时请先到「钉钉集成」全量同步。
                  </span>
                }
              />
              <Form.Item label="限定参与分析的部门（可选）">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="不选=全部部门各一条草案；多选=仅所选部门各一条（不合并）"
                  options={mirrorDepts.map((d) => ({
                    label: `${d.name} (${d.dingtalk_dept_id})`,
                    value: d.dingtalk_dept_id,
                  }))}
                  value={aiDeptIds}
                  onChange={(v) => setAiDeptIds(Array.isArray(v) ? v : [])}
                  optionFilterProp="label"
                  showSearch
                  maxTagCount={3}
                />
              </Form.Item>
              <Form.Item>
                <Button
                  type="default"
                  icon={<ThunderboltOutlined />}
                  loading={aiLoading}
                  onClick={() => void runAiSuggestRoleGroups()}
                >
                  AI 生成权限组草案
                </Button>
              </Form.Item>
            </>
          ) : null}
          <Form.Item
            name="name"
            label="权限组名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="如：管理员" />
          </Form.Item>
          <Form.Item
            name="code"
            label="权限组代码"
            rules={[{ required: true, message: '请输入代码' }]}
          >
            <Input placeholder="如：admin（用于权限校验）" disabled={!!editingRoleGroupId} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="权限说明" />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="菜单权限（按部门映射）"
            description={
              <span>
                此处仅配置<strong>菜单与功能权限</strong>（不含报价清单、成本清单）。钉钉「部门与权限组」会把权限组 code 同步到绑定钉钉的成员账号上。<strong>敏感数据</strong>（报价/成本）请在「用户列表 → 编辑用户」中按人单独授权。
              </span>
            }
          />
          <Form.Item
            name="permissions"
            label="菜单与功能权限"
            extra="树形结构与侧栏一致（已排除敏感菜单项）。保存后由部门映射到具体人员；敏感数据在用户编辑中配置。"
          >
            <PermissionCheckTree permissionOptions={menuPermissionOptions} />
          </Form.Item>
          {editingRoleGroupId && (
            <Form.Item
              name="reauth_password"
              label="操作确认（您的登录密码）"
              extra="变更权限组代码或菜单权限项时后端会校验密码。"
            >
              <Input.Password placeholder="修改权限项时必填" autoComplete="new-password" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Drawer
        title="AI 权限组草案（点「填入表单」写入上方新增弹窗）"
        placement="right"
        width={420}
        open={aiDrawerOpen}
        onClose={() => setAiDrawerOpen(false)}
        destroyOnClose={false}
      >
        {aiTruncated ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="本次参与分析的部门已截断，结果可能不完整"
          />
        ) : null}
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {aiDrafts.map((d, idx) => (
            <Card
              key={`${d.code}-${idx}`}
              size="small"
              title={
                <span>
                  {d.name} <Text type="secondary">({d.code})</Text>
                </span>
              }
              extra={
                <Button type="link" size="small" onClick={() => applyAiDraftToForm(d)}>
                  填入表单
                </Button>
              }
            >
              <Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 13 }}>
                {d.description}
              </Paragraph>
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary">权限：</Text>
                <div style={{ marginTop: 4 }}>
                  {d.permissions?.length ? (
                    <Space wrap size={[4, 4]}>
                      {d.permissions.map((p) => (
                        <Tag key={p}>{p}</Tag>
                      ))}
                    </Space>
                  ) : (
                    <Text type="secondary">（空，请手动勾选）</Text>
                  )}
                </div>
              </div>
              {d.dept_ids?.length ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  关联钉钉部门 id：{d.dept_ids.join(', ')}
                </Text>
              ) : null}
            </Card>
          ))}
        </Space>
      </Drawer>
    </div>
  )
}

export default UserManagementPage
