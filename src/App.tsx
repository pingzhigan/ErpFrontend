/**
 * 功能名称：应用根组件与路由
 * 实现原理与逻辑：使用 ProLayout 提供整体布局与侧边菜单；路由根据权限（hasPermission）控制菜单展示与页面访问，未登录重定向到登录页。
 * 集成 AuthProvider、ConfigProvider、主题与中文 locale；定义仪表盘、项目、机会、商品、配单、成本、库存、知识库、规则、用户、日志等路由与对应页面组件。
 */
import {
  PageContainer,
  ProLayout,
  type MenuDataItem,
} from '@ant-design/pro-components'
import type { ColumnsType } from 'antd/es/table'
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import {
  App as AntdApp,
  Badge,
  Button,
  ConfigProvider,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Menu,
  Modal,
  Popover,
  Radio,
  Result,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tooltip,
  Typography,
  theme,
} from 'antd'
import zhCN from 'antd/locale/zh_CN'
import {
  BarChartOutlined,
  BookOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  FolderOutlined,
  HistoryOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShoppingOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
  DatabaseOutlined,
  BellOutlined,
  ApiOutlined,
  CarryOutOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import axios from 'axios'
import { AuthProvider, useAuth } from './auth/AuthContext'
import {
  AutoConfigPage,
  ConfigOrdersPage,
  ConstructionLogPage,
  ConstructionProgressBulkCreatePage,
  ConstructionProgressPage,
  ConstructionProjectDetailPage,
  ConstructionProjectInfoPage,
  ConstructionQualityPage,
  ConstructionSafetyPage,
  CostListPage,
  DashboardPage,
  DingTalkAdminPage,
  DocTasksExcelFormatPage,
  DocTasksPage,
  ExcelParseRulesPage,
  FormulasPage,
  InventoryMaintainPage,
  InventoryQueryPage,
  InventoryStockInDetailPage,
  InventoryStockInPage,
  InventoryStockOutDetailPage,
  InventoryStockOutPage,
  KnowledgePage,
  LoginPage,
  ForgotPasswordPage,
  CompleteEmailPage,
  LogsPage,
  MaintenanceMinorWorkPage,
  MaintenanceSchedulePage,
  PersonnelPresencePage,
  OpportunitiesPage,
  OpportunityDetailPage,
  OpportunityTodosPage,
  ProductsPage,
  ProjectAnalysisPage,
  ProjectProductListPage,
  ProjectsPage,
  RdResearchDocsPage,
  RdResearchTodosPage,
  StaffHandoverPage,
  UserManagementPage,
  WorkbenchPushMessagesPage,
} from './lazyPages'
import './App.css'
import { APP_VERSION, SYSTEM_RELEASE_NOTES } from './systemRelease'
import { formatUserDisplayName } from './utils/userDisplay'

/** 侧栏品牌图，对应 `frontend/public/logo.png`（Vite 构建时置于站点根路径） */
const LAYOUT_LOGO_SRC = `${import.meta.env.BASE_URL}logo.png`

type AppRouteItem = Omit<MenuDataItem, 'routes'> & {
  permission?: string
  routes?: AppRouteItem[]
  roles?: string[]
  divider?: boolean
  /** 为 true 时不在侧栏展示（如项目维护入口隐藏后仅保留智能格式化） */
  hideInMenu?: boolean
}

const appRoutes: AppRouteItem[] = [
  {
    path: '/dashboard',
    name: '仪表盘',
    icon: <DashboardOutlined />,
    permission: 'dashboard',
  },
  {
    path: '/personnel-presence',
    name: '人员在岗状态',
    icon: <TeamOutlined />,
    permission: 'maintenance',
  },
  { key: 'divider-1', name: '', divider: true },
  {
    path: '/projects',
    name: '项目管理',
    key: '/project-mgr',
    icon: <FolderOutlined />,
    routes: [
      { path: '/projects', name: '项目列表', key: '/projects', permission: 'projects' },
      { path: '/project-analysis', name: '项目分析', key: '/project-analysis', permission: 'projects' },
      { path: '/docs', name: '项目维护', key: '/docs', permission: 'docs', hideInMenu: true },
      { path: '/docs-excel-format', name: '项目维护(智能格式化)', key: '/docs-excel-format', permission: 'docs' },
      // 项目详情页不在侧栏展示，但挂在「项目管理」下以便进入该页时子菜单保持展开
      { path: '/project-products', name: '项目详情', key: '/project-products', permission: 'projects', hideInMenu: true },
    ] as AppRouteItem[],
  },
  {
    path: '/opportunities',
    name: '机会管理',
    icon: <ThunderboltOutlined />,
    permission: 'opportunities',
  },
  {
    path: '/opportunity-todos',
    name: '待办事项',
    icon: <CarryOutOutlined />,
    permission: 'opportunity-todos',
    hideInMenu: true,
  },
  {
    path: '/construction',
    name: '施工管理',
    key: '/construction-mgr',
    icon: <BarChartOutlined />,
    routes: [
      { path: '/construction/project-info', name: '项目信息', key: '/construction/project-info', permission: 'construction' },
      { path: '/construction/progress', name: '进度管理', key: '/construction/progress', permission: 'construction' },
      { path: '/construction/quality', name: '质量管理', key: '/construction/quality', permission: 'construction', hideInMenu: true },
      { path: '/construction/safety', name: '安全管理', key: '/construction/safety', permission: 'construction', hideInMenu: true },
      { path: '/construction/log', name: '施工日志', key: '/construction/log', permission: 'construction' },
    ] as AppRouteItem[],
  },
  {
    path: '/maintenance',
    name: '维护管理',
    key: '/maintenance-mgr',
    icon: <ToolOutlined />,
    routes: [
      { path: '/maintenance/minor-work', name: '零星工程', key: '/maintenance/minor-work', permission: 'maintenance' },
      { path: '/maintenance/schedule', name: '维护排单', key: '/maintenance/schedule', permission: 'maintenance' },
    ] as AppRouteItem[],
  },
  {
    path: '/project-list',
    name: '商品列表',
    icon: <ShoppingOutlined />,
    routes: [
      { path: '/config-orders', name: '项目配单', permission: 'config-orders', hideInMenu: true },
      { path: '/cost-list', name: '成本清单', permission: 'cost-list' },
      { path: '/products', name: '报价清单', permission: 'products' },
    ] as AppRouteItem[],
  },
  {
    path: '/inventory-mgr',
    name: '库存管理',
    icon: <DatabaseOutlined />,
    routes: [
      { path: '/inventory', name: '库存查询', permission: 'inventory' },
      { path: '/inventory-maintain', name: '库存维护', permission: 'inventory-maintain' },
      { path: '/inventory-stock-in', name: '入库管理', permission: 'inventory' },
      { path: '/inventory-stock-out', name: '出库管理', permission: 'inventory' },
    ] as AppRouteItem[],
  },
  {
    path: '/ai-assistant',
    name: 'AI助手',
    icon: <RobotOutlined />,
    hideInMenu: true,
    routes: [
      { path: '/auto-config', name: 'AI配单检查', permission: 'auto-config' },
    ] as AppRouteItem[],
  },
  { key: 'divider-2', name: '', divider: true },
  // 规则引擎（Excel 表头映射等）；计算公式引擎单独一项
  {
    path: '/rules',
    name: '规则引擎',
    icon: <SafetyCertificateOutlined />,
    permission: 'rules',
  },
  {
    path: '/rules/formulas',
    name: '计算公式引擎',
    icon: <SafetyCertificateOutlined />,
    permission: 'rules-formulas',
    hideInMenu: true,
  },
  {
    path: '/knowledge',
    name: '知识库',
    icon: <BookOutlined />,
    permission: 'knowledge',
  },
  {
    path: '/rd-mgmt',
    name: '研发管理',
    key: '/rd-mgmt',
    icon: <ExperimentOutlined />,
    routes: [
      { path: '/rd/todos', name: '研发待办', key: '/rd/todos', permission: 'rd-mgmt' },
      { path: '/rd/docs', name: '研发文档', key: '/rd/docs', permission: 'rd-mgmt' },
    ] as AppRouteItem[],
  },
  { key: 'divider-3', name: '', divider: true },
  {
    path: '/staff-handover',
    name: '离职交接',
    icon: <SwapOutlined />,
    roles: ['admin', 'company_management'],
  },
  {
    path: '/users',
    name: '用户管理',
    key: '/users-mgr',
    icon: <UserOutlined />,
    permission: 'users',
    routes: [
      { path: '/users', name: '用户与权限', key: '/users', permission: 'users' },
      { path: '/users/dingtalk', name: '钉钉集成', key: '/users/dingtalk', permission: 'users', icon: <ApiOutlined /> },
    ] as AppRouteItem[],
  },
  {
    path: '/logs',
    name: '日志管理',
    icon: <HistoryOutlined />,
    permission: 'logs',
  },
]

const RequireAuth: React.FC<
  React.PropsWithChildren<{
    roles?: string[]
    /** 需要拥有其中任一权限方可访问（与 roles 二选一，优先 permissions） */
    permissions?: string[]
  }>
> = ({ children, roles, permissions }) => {
  const { isAuthenticated, hasRole, hasPermission } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (permissions && permissions.length > 0) {
    if (!permissions.some((p) => hasPermission(p))) {
      return (
        <Result
          status="403"
          title="无访问权限"
          subTitle="当前账号没有访问该页面的权限，请联系管理员。"
        />
      )
    }
  } else if (roles && roles.length > 0 && !hasRole(roles)) {
    return (
      <Result
        status="403"
        title="无访问权限"
        subTitle="当前账号没有访问该页面的权限，请联系管理员。"
      />
    )
  }

  return <>{children}</>
}

/** 根据权限与角色过滤菜单：子路由递归；含 roles 时需 hasRole（可与 permission 同时要求） */
function filterMenuByPermission(
  routes: AppRouteItem[],
  hasPermission: (key: string) => boolean,
  hasRole: (roleOrRoles: string | string[]) => boolean,
): AppRouteItem[] {
  return routes
    .map((r) => {
      if ((r as AppRouteItem).divider) return r
      const item = r as AppRouteItem
      if (item.hideInMenu) return null
      const subRoutes = item.routes
      if (Array.isArray(subRoutes) && subRoutes.length > 0) {
        const filteredChildren = filterMenuByPermission(subRoutes, hasPermission, hasRole)
        if (filteredChildren.length === 0) return null
        return { ...item, routes: filteredChildren }
      }
      if (item.roles && item.roles.length > 0 && !hasRole(item.roles)) return null
      if (item.permission && !hasPermission(item.permission)) return null
      if (!item.permission && (!item.roles || item.roles.length === 0)) return item
      return item
    })
    .filter(Boolean) as AppRouteItem[]
}

/** 为菜单数据统一设置 key，确保与 openKeys/selectedKeys 一致（规则库父级 key='/rules'） */
function normalizeMenuKeys(menuData: MenuDataItem[]): MenuDataItem[] {
  return menuData.map((item) => {
    const children = item.children ? normalizeMenuKeys(item.children) : undefined
    return { ...item, key: item.key ?? item.path, children }
  })
}

type WorkbenchReminders = {
  projectAnalysisGaps: { project_name: string; missing: string[] }[]
  constructionOverdue: {
    id: number
    project_name: string
    task_name: string
    content: string
    responsible: string
    planned_end: string
  }[]
  constructionOpenByProject: {
    project_name: string
    total: number
    statusStats: {
      not_started: number
      in_progress: number
      delayed: number
    }
    list: {
      id: number
      project_name: string
      task_name: string
      content: string
      responsible: string | null
      planned_end: string | null
      status: 'not_started' | 'in_progress' | 'delayed'
    }[]
  }[]
  minorWorkOpen: { id: number; code: string; title: string; status: string; due_at: string | null }[]
  maintenanceOpen: { id: number; code: string; title: string; status: string; due_at: string }[]
  totalCount: number
}

type WorkbenchPushItem = {
  id: string
  ts: number
  category: 'approval' | 'dingtalk' | 'system'
  title: string
  detail?: string
  linkPath?: string
}

type MaintenancePushItem = {
  id: string
  ts: number
  eventType:
    | 'minor_work_dispatch'
    | 'minor_work_closed'
    | 'minor_work_construction_workers_changed'
    | 'maintenance_task_dispatch'
    | 'maintenance_task_closed'
    | 'construction_log_created'
    | 'construction_log_updated'
    | 'construction_log_deleted'
  businessType: 'minor_work' | 'maintenance_task' | 'construction_log'
  businessId: number
  title: string
  detail?: string
}

type AttachmentSyncPreviewRow = {
  key: string
  label: string
  dataSubdir: string
  diskBytes: number
  diskFileCount: number
  dbBytes: number
  deltaBytes: number
}

type AttachmentSyncPreview = {
  previewId: string
  previewExpiresAt: string
  dataDir: string
  scannedSubdirs: string[]
  rows: AttachmentSyncPreviewRow[]
  diskTotalBytes: number
  dbTotalBytes: number
  deltaBytes: number
  orphanDiskCount: number
  orphanDiskSample: string[]
  missingOnDiskCount: number
  missingOnDiskSample: string[]
  warnings: string[]
}

const PUSH_CATEGORY_LABEL: Record<WorkbenchPushItem['category'], string> = {
  approval: '审批',
  dingtalk: '钉钉',
  system: '系统',
}

const PUSH_POPOVER_PREVIEW_LIMIT = 5

const MINOR_WORK_STATUS_LABEL: Record<string, string> = {
  pending: '待派单',
  dispatched: '已派单',
  in_progress: '执行中',
  closed: '已闭环',
}

const MAINT_SCHEDULE_STATUS_LABEL: Record<string, string> = {
  scheduled: '已排单',
  in_progress: '执行中',
  overdue: '已逾期',
  completed: '已完成',
  cancelled: '已取消',
}

const CONSTRUCTION_PROGRESS_STATUS_LABEL: Record<'not_started' | 'in_progress' | 'delayed', string> = {
  not_started: '未开始',
  in_progress: '实施中',
  delayed: '已延期',
}

const LayoutWithMenu: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout, hasPermission, hasRole, isAuthenticated, needsEmailBinding, needsPasswordSetup } =
    useAuth()
  /** 与后端 ADMIN_ROLE_CODE（admin）一致；roles 异常时视为非管理员 */
  const isAdmin = useMemo(() => {
    const roles = Array.isArray(user?.roles) ? user.roles : []
    return roles.some((r) => String(r) === 'admin')
  }, [user?.roles])

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (needsEmailBinding || needsPasswordSetup) {
    return <Navigate to="/complete-email" replace />
  }

  const menuRoutes = filterMenuByPermission(appRoutes, hasPermission, hasRole)
  const pathname = location.pathname
  const isUnderProjectMgr =
    pathname === '/project-products' ||
    pathname === '/projects' ||
    pathname === '/project-analysis' ||
    pathname === '/docs' ||
    pathname === '/docs-excel-format'
  const isUnderConstruction = pathname.startsWith('/construction')
  const isUnderMaintenance = pathname.startsWith('/maintenance')
  const isUnderUsersMgr = pathname === '/users' || pathname.startsWith('/users/')
  const isUnderRdMgmt = pathname.startsWith('/rd/')
  const menuOpenKeysFromPath = React.useMemo(() => {
    const keys: string[] = []
    if (isUnderProjectMgr) keys.push('/project-mgr')
    if (isUnderConstruction) keys.push('/construction-mgr')
    if (isUnderMaintenance) keys.push('/maintenance-mgr')
    if (isUnderUsersMgr) keys.push('/users-mgr')
    if (isUnderRdMgmt) keys.push('/rd-mgmt')
    return keys
  }, [isUnderProjectMgr, isUnderConstruction, isUnderMaintenance, isUnderUsersMgr, isUnderRdMgmt])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [llmProvider, setLlmProvider] = useState<string>('deepseek')
  const [llmProviderOptions, setLlmProviderOptions] = useState<{ id: string; label: string }[]>([])
  const [embeddingSaveLoading, setEmbeddingSaveLoading] = useState(false)
  const [embeddingForm] = Form.useForm<{ enabled: boolean; apiUrl: string; apiKey: string; model: string }>()
  const [attachmentQuotaForm] = Form.useForm<{ quotaGiB: number }>()
  const [attachmentQuotaSaveLoading, setAttachmentQuotaSaveLoading] = useState(false)
  const [attachmentQuotaSummary, setAttachmentQuotaSummary] = useState<{
    usedBytes: number
    remainingBytes: number
    exceeded: boolean
    warnLowRemaining: boolean
  } | null>(null)
  const { message: msg } = AntdApp.useApp()
  const fetchLlmProvider = useCallback(() => {
    axios.get<{ provider: string; options: { id: string; label: string }[] }>('/api/llm-provider', { headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {} }).then((res) => {
      setLlmProvider(res.data?.provider ?? 'deepseek')
      setLlmProviderOptions(res.data?.options ?? [])
    }).catch(() => {})
  }, [user?.token])
  const fetchAttachmentQuota = useCallback(() => {
    axios
      .get<{
        quotaBytes: number
        usedBytes: number
        remainingBytes: number
        exceeded: boolean
        warnLowRemaining: boolean
      }>('/api/settings/attachment-quota', { headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {} })
      .then((res) => {
        const d = res.data
        if (d && typeof d.quotaBytes === 'number') {
          attachmentQuotaForm.setFieldsValue({
            quotaGiB: Number((d.quotaBytes / (1024 * 1024 * 1024)).toFixed(4)),
          })
          setAttachmentQuotaSummary({
            usedBytes: d.usedBytes,
            remainingBytes: d.remainingBytes,
            exceeded: Boolean(d.exceeded),
            warnLowRemaining: Boolean(d.warnLowRemaining),
          })
        }
      })
      .catch(() => {
        attachmentQuotaForm.resetFields()
        setAttachmentQuotaSummary(null)
      })
  }, [user?.token, attachmentQuotaForm])
  const fetchEmbeddingConfig = useCallback(() => {
    axios.get<{ enabled: boolean; apiUrl: string; apiKey: string; model: string }>('/api/settings/embedding', { headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {} })
      .then((res) => {
        const data = res.data || { enabled: false, apiUrl: '', apiKey: '', model: 'text-embedding-3-small' }
        embeddingForm.setFieldsValue({ ...data, apiKey: undefined })
      })
      .catch(() => {
        embeddingForm.setFieldsValue({ enabled: false, apiUrl: '', apiKey: undefined, model: 'text-embedding-3-small' })
      })
  }, [user?.token, embeddingForm])
  useEffect(() => {
    if (settingsOpen && isAdmin) {
      fetchLlmProvider()
      fetchEmbeddingConfig()
      void fetchAttachmentQuota()
    }
  }, [settingsOpen, isAdmin, fetchLlmProvider, fetchEmbeddingConfig, fetchAttachmentQuota])
  const saveEmbeddingConfig = useCallback(async () => {
    try {
      const values = await embeddingForm.validateFields()
      setEmbeddingSaveLoading(true)
      await axios.post('/api/settings/embedding', values, { headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {} })
      msg.success('解析设置已保存')
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setEmbeddingSaveLoading(false)
    }
  }, [embeddingForm, msg, user?.token])
  const saveAttachmentQuota = useCallback(async () => {
    try {
      const values = await attachmentQuotaForm.validateFields()
      setAttachmentQuotaSaveLoading(true)
      const quotaBytes = Math.floor(Number(values.quotaGiB) * 1024 * 1024 * 1024)
      await axios.post('/api/settings/attachment-quota', { quotaBytes }, { headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {} })
      msg.success('附件总容量已保存')
      void fetchAttachmentQuota()
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
    } finally {
      setAttachmentQuotaSaveLoading(false)
    }
  }, [attachmentQuotaForm, fetchAttachmentQuota, msg, user?.token])

  const [attachmentSyncPreviewLoading, setAttachmentSyncPreviewLoading] = useState(false)
  const [attachmentSyncPreviewData, setAttachmentSyncPreviewData] = useState<AttachmentSyncPreview | null>(null)
  const [attachmentSyncPreviewModalOpen, setAttachmentSyncPreviewModalOpen] = useState(false)
  const [attachmentSyncConfirmOpen, setAttachmentSyncConfirmOpen] = useState(false)
  const [attachmentSyncMode, setAttachmentSyncMode] = useState<'disk' | 'db'>('disk')
  const [attachmentSyncApplyPassword, setAttachmentSyncApplyPassword] = useState('')
  const [attachmentSyncApplyLoading, setAttachmentSyncApplyLoading] = useState(false)

  const runAttachmentSyncPreview = useCallback(async () => {
    if (!user?.token) return
    setAttachmentSyncPreviewLoading(true)
    try {
      const res = await axios.post<AttachmentSyncPreview>(
        '/api/settings/attachment-storage/sync-preview',
        {},
        { headers: { Authorization: `Bearer ${user.token}` } },
      )
      setAttachmentSyncPreviewData(res.data)
      setAttachmentSyncPreviewModalOpen(true)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '预览失败')
    } finally {
      setAttachmentSyncPreviewLoading(false)
    }
  }, [msg, user?.token])

  const openAttachmentSyncConfirm = useCallback(() => {
    if (!attachmentSyncPreviewData?.previewId) {
      msg.warning('请先完成预览')
      return
    }
    setAttachmentSyncApplyPassword('')
    setAttachmentSyncConfirmOpen(true)
  }, [attachmentSyncPreviewData?.previewId, msg])

  const submitAttachmentSyncApply = useCallback(async (): Promise<boolean> => {
    if (!user?.token || !attachmentSyncPreviewData?.previewId) return false
    const pwd = attachmentSyncApplyPassword.trim()
    if (!pwd) {
      msg.error('请输入当前登录密码以确认同步')
      return false
    }
    setAttachmentSyncApplyLoading(true)
    try {
      await axios.post(
        '/api/settings/attachment-storage/sync-apply',
        {
          previewId: attachmentSyncPreviewData.previewId,
          mode: attachmentSyncMode,
          reauth_password: pwd,
        },
        { headers: { Authorization: `Bearer ${user.token}` } },
      )
      msg.success('同步已完成')
      setAttachmentSyncConfirmOpen(false)
      setAttachmentSyncPreviewModalOpen(false)
      setAttachmentSyncPreviewData(null)
      void fetchAttachmentQuota()
      return true
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '同步失败')
      return false
    } finally {
      setAttachmentSyncApplyLoading(false)
    }
  }, [
    attachmentSyncApplyPassword,
    attachmentSyncMode,
    attachmentSyncPreviewData?.previewId,
    fetchAttachmentQuota,
    msg,
    user?.token,
  ])

  const attachmentSyncPreviewColumns: ColumnsType<AttachmentSyncPreviewRow> = useMemo(
    () => [
      { title: '模块', dataIndex: 'label', key: 'label', width: 140 },
      { title: '扫描目录', dataIndex: 'dataSubdir', key: 'dataSubdir', ellipsis: true },
      {
        title: '磁盘(GiB)',
        key: 'diskGiB',
        width: 100,
        render: (_: unknown, r) => (r.diskBytes / (1024 * 1024 * 1024)).toFixed(2),
      },
      {
        title: '库汇总(GiB)',
        key: 'dbGiB',
        width: 110,
        render: (_: unknown, r) => (r.dbBytes / (1024 * 1024 * 1024)).toFixed(2),
      },
      {
        title: '差值(GiB)',
        key: 'deltaGiB',
        width: 100,
        render: (_: unknown, r) => (r.deltaBytes / (1024 * 1024 * 1024)).toFixed(2),
      },
      { title: '磁盘文件数', dataIndex: 'diskFileCount', key: 'diskFileCount', width: 100 },
    ],
    [],
  )

  const [menuOpenKeys, setMenuOpenKeys] = useState<string[]>(() => menuOpenKeysFromPath)

  const [systemInfoOpen, setSystemInfoOpen] = useState(false)

  const [reminderOpen, setReminderOpen] = useState(false)
  const [reminderData, setReminderData] = useState<WorkbenchReminders | null>(null)
  const [reminderLoading, setReminderLoading] = useState(false)

  const fetchReminders = useCallback(async () => {
    if (!user?.token) return
    setReminderLoading(true)
    try {
      const res = await axios.get<WorkbenchReminders>('/api/workbench/reminders', {
        headers: { Authorization: `Bearer ${user.token}` },
      })
      setReminderData(res.data)
    } catch {
      setReminderData(null)
    } finally {
      setReminderLoading(false)
    }
  }, [user?.token])

  useEffect(() => {
    if (!isAuthenticated || !user?.token) return
    void fetchReminders()
    const timer = setInterval(() => void fetchReminders(), 120000)
    return () => clearInterval(timer)
  }, [isAuthenticated, user?.token, fetchReminders])

  useEffect(() => {
    if (reminderOpen) void fetchReminders()
  }, [reminderOpen, fetchReminders])

  const [pushItems, setPushItems] = useState<WorkbenchPushItem[]>([])
  const [pushLive, setPushLive] = useState(false)
  const [pushUnread, setPushUnread] = useState(0)
  const [pushOpen, setPushOpen] = useState(false)
  const pushPanelOpenRef = useRef(false)

  useEffect(() => {
    pushPanelOpenRef.current = pushOpen
  }, [pushOpen])

  useEffect(() => {
    if (!isAuthenticated || !user?.token) return
    const ac = new AbortController()
    let buf = ''
    void (async () => {
      try {
        const res = await fetch('/api/workbench/push-stream', {
          headers: { Authorization: `Bearer ${user.token}` },
          signal: ac.signal,
        })
        if (!res.ok || !res.body) {
          setPushLive(false)
          return
        }
        setPushLive(true)
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        while (!ac.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const chunks = buf.split(/\r?\n\r?\n/)
          buf = chunks.pop() ?? ''
          for (const rawBlock of chunks) {
            let eventType = ''
            let dataStr = ''
            for (const line of rawBlock.split(/\r?\n/)) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim()
              else if (line.startsWith('data:')) dataStr = line.slice(5).trim()
            }
            if (!eventType) continue
            if (eventType === 'snapshot') {
              try {
                const arr = JSON.parse(dataStr) as WorkbenchPushItem[]
                if (Array.isArray(arr)) setPushItems(arr)
              } catch {
                /* ignore */
              }
            } else if (eventType === 'push') {
              try {
                const item = JSON.parse(dataStr) as WorkbenchPushItem
                setPushItems((prev) => {
                  const rest = prev.filter((x) => x.id !== item.id)
                  return [item, ...rest].slice(0, 80)
                })
                if (!pushPanelOpenRef.current) setPushUnread((n) => n + 1)
              } catch {
                /* ignore */
              }
            } else if (eventType === 'ready') {
              setPushLive(true)
            }
          }
        }
      } catch {
        if (!ac.signal.aborted) setPushLive(false)
      }
      if (!ac.signal.aborted) setPushLive(false)
    })()
    return () => ac.abort()
  }, [isAuthenticated, user?.token])

  useEffect(() => {
    if (!isAuthenticated || !user?.token) return
    const ac = new AbortController()
    let buf = ''
    void (async () => {
      try {
        const res = await fetch('/api/maintenance/push-stream', {
          headers: { Authorization: `Bearer ${user.token}` },
          signal: ac.signal,
        })
        if (!res.ok || !res.body) return
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        while (!ac.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const chunks = buf.split(/\r?\n\r?\n/)
          buf = chunks.pop() ?? ''
          for (const rawBlock of chunks) {
            let eventType = ''
            let dataStr = ''
            for (const line of rawBlock.split(/\r?\n/)) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim()
              else if (line.startsWith('data:')) dataStr = line.slice(5).trim()
            }
            if (eventType !== 'push') continue
            try {
              const item = JSON.parse(dataStr) as MaintenancePushItem
              msg.open({
                type: 'info',
                key: `maintenance-push-${item.id}`,
                content: item.title,
                duration: 4,
              })
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* ignore */
      }
    })()
    return () => ac.abort()
  }, [isAuthenticated, msg, user?.token])

  // 与 path 同步：进入规则/项目相关页时，openKeys 必须包含对应父级，避免子菜单收起
  React.useEffect(() => {
    setMenuOpenKeys((prev) => {
      const next = new Set(prev)
      menuOpenKeysFromPath.forEach((k) => next.add(k))
      const arr = [...next]
      return arr.length === prev.length && arr.every((k, i) => prev[i] === k) ? prev : arr
    })
  }, [menuOpenKeysFromPath])

  const handleMenuOpenChange = useCallback(
    (keys: string[]) => {
      const merged = new Set(keys)
      if (isUnderProjectMgr) merged.add('/project-mgr')
      if (isUnderConstruction) merged.add('/construction-mgr')
      if (isUnderMaintenance) merged.add('/maintenance-mgr')
      if (isUnderUsersMgr) merged.add('/users-mgr')
      setMenuOpenKeys([...merged])
    },
    [isUnderProjectMgr, isUnderConstruction, isUnderMaintenance, isUnderUsersMgr],
  )

  // 当前页在规则/项目下时，强制用 path 派生的 openKeys，保证子菜单一定展开
  const effectiveOpenKeys = menuOpenKeysFromPath.length > 0 ? menuOpenKeysFromPath : menuOpenKeys

  const reminderTotal = reminderData?.totalCount ?? 0

  const reminderPopoverContent = (
    <div style={{ width: 360, maxHeight: 420, overflow: 'auto' }}>
      <Spin spinning={reminderLoading}>
        {reminderLoading && !reminderData ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : !reminderData ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无法加载提醒" style={{ margin: '16px 0' }} />
        ) : reminderTotal === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待处理提醒" style={{ margin: '16px 0' }} />
        ) : (
          <>
            {reminderData.projectAnalysisGaps.length > 0 ? (
              <>
                <Typography.Text strong>项目管理 · 项目分析（缺漏项）</Typography.Text>
                <List
                  size="small"
                  dataSource={reminderData.projectAnalysisGaps}
                  renderItem={(item) => (
                    <List.Item style={{ padding: '6px 0' }}>
                      <a
                        onClick={() => {
                          setReminderOpen(false)
                          navigate('/project-analysis')
                        }}
                      >
                        {item.project_name}
                      </a>
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                        缺：{item.missing.join('、')}
                      </Typography.Text>
                    </List.Item>
                  )}
                />
                <Divider style={{ margin: '8px 0' }} />
              </>
            ) : null}
            {reminderData.constructionOpenByProject.length > 0 ? (
              <>
                <Typography.Text strong>施工管理 · 进度管理（未完成任务）</Typography.Text>
                <List
                  size="small"
                  dataSource={reminderData.constructionOpenByProject}
                  renderItem={(item) => (
                    <List.Item style={{ padding: '6px 0' }}>
                      <div style={{ width: '100%' }}>
                        <a
                          onClick={() => {
                            setReminderOpen(false)
                            navigate('/construction/progress')
                          }}
                        >
                          {item.project_name}
                        </a>
                        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                          共 {item.total} 条 · 未开始 {item.statusStats.not_started} · 实施中 {item.statusStats.in_progress} · 已延期 {item.statusStats.delayed}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                          {item.list
                            .slice(0, 3)
                            .map((task) => `${task.content || task.task_name || '（无标题）'}（${CONSTRUCTION_PROGRESS_STATUS_LABEL[task.status]}）`)
                            .join('；')}
                          {item.list.length > 3 ? `；等 ${item.list.length} 条` : ''}
                        </Typography.Text>
                      </div>
                    </List.Item>
                  )}
                />
                <Divider style={{ margin: '8px 0' }} />
              </>
            ) : null}
            {reminderData.minorWorkOpen.length > 0 ? (
              <>
                <Typography.Text strong>维护管理 · 零星工程（未闭环）</Typography.Text>
                <List
                  size="small"
                  dataSource={reminderData.minorWorkOpen}
                  renderItem={(item) => (
                    <List.Item style={{ padding: '6px 0' }}>
                      <a
                        onClick={() => {
                          setReminderOpen(false)
                          navigate('/maintenance/minor-work')
                        }}
                      >
                        {item.code} · {item.title}
                      </a>
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                        {MINOR_WORK_STATUS_LABEL[item.status] ?? item.status}
                        {item.due_at ? ` · 截止 ${item.due_at}` : ''}
                      </Typography.Text>
                    </List.Item>
                  )}
                />
                <Divider style={{ margin: '8px 0' }} />
              </>
            ) : null}
            {reminderData.maintenanceOpen.length > 0 ? (
              <>
                <Typography.Text strong>维护管理 · 维护排单（未完成）</Typography.Text>
                <List
                  size="small"
                  dataSource={reminderData.maintenanceOpen}
                  renderItem={(item) => (
                    <List.Item style={{ padding: '6px 0' }}>
                      <a
                        onClick={() => {
                          setReminderOpen(false)
                          navigate('/maintenance/schedule')
                        }}
                      >
                        {item.code} · {item.title}
                      </a>
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                        {MAINT_SCHEDULE_STATUS_LABEL[item.status] ?? item.status} · 截止 {item.due_at}
                      </Typography.Text>
                    </List.Item>
                  )}
                />
              </>
            ) : null}
          </>
        )}
      </Spin>
    </div>
  )

  const pushPopoverContent = (
    <div style={{ width: 360, maxHeight: 420, overflow: 'auto' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        {pushLive ? '已连接实时通道' : '实时通道未连接，请刷新页面后重试'}
      </Typography.Text>
      {pushItems.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无推送记录" style={{ margin: '16px 0' }} />
      ) : (
        <>
          <List
            size="small"
            dataSource={pushItems.slice(0, PUSH_POPOVER_PREVIEW_LIMIT)}
            renderItem={(item) => (
              <List.Item style={{ padding: '8px 0' }}>
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Typography.Text strong style={{ flex: 1, minWidth: 0 }} ellipsis>
                      {item.title}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
                      {PUSH_CATEGORY_LABEL[item.category]}
                    </Typography.Text>
                  </div>
                  {item.detail ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                      {item.detail}
                    </Typography.Text>
                  ) : null}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {new Date(item.ts).toLocaleString('zh-CN')}
                    </Typography.Text>
                    {item.linkPath ? (
                      <a
                        onClick={() => {
                          setPushOpen(false)
                          navigate(item.linkPath!)
                        }}
                      >
                        查看
                      </a>
                    ) : null}
                  </div>
                </div>
              </List.Item>
            )}
          />
          {pushItems.length > PUSH_POPOVER_PREVIEW_LIMIT ? (
            <>
              <Divider style={{ margin: '8px 0' }} />
              <Button
                type="link"
                block
                style={{ padding: '4px 0' }}
                onClick={() => {
                  setPushOpen(false)
                  navigate('/workbench/messages')
                }}
              >
                查看更多
              </Button>
            </>
          ) : null}
        </>
      )}
    </div>
  )

  const currentUserDisplay = formatUserDisplayName(user?.username, user?.real_name)

  return (
    <ProLayout
      title="管理后台"
      logo={
        <img
          src={LAYOUT_LOGO_SRC}
          alt="品牌标识"
          style={{ height: 28, width: 'auto', objectFit: 'contain', display: 'block' }}
        />
      }
      route={{
        path: '/',
        routes: menuRoutes,
      }}
      location={location}
      menuDataRender={normalizeMenuKeys}
      menu={
        {
          selectedKeys: [pathname],
          openKeys: effectiveOpenKeys,
          onOpenChange: handleMenuOpenChange,
        } as React.ComponentProps<typeof ProLayout>['menu']
      }
      menuItemRender={(item, dom) => {
        if ((item as AppRouteItem).divider) {
          return <Menu.Divider key={item.key || 'divider'} style={{ margin: '4px 0' }} />
        }
        return (
          <a
            onClick={(e) => {
              e.preventDefault()
              if (item.path) {
                navigate(item.path)
              }
            }}
          >
            {dom}
          </a>
        )
      }}
      rightContentRender={() => (
        <Tooltip title="系统版本与更新说明">
          <Button
            type="text"
            aria-label="系统版本与更新说明"
            icon={<InfoCircleOutlined style={{ fontSize: 18, color: 'var(--ant-colorTextSecondary)' }} />}
            style={{ padding: '4px 10px' }}
            onClick={() => setSystemInfoOpen(true)}
          />
        </Tooltip>
      )}
      menuFooterRender={() => (
        <div style={{ borderTop: '1px solid rgba(5, 5, 5, 0.06)' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '10px 12px 6px',
              gap: 4,
            }}
          >
            <Popover
              title="消息提醒"
              trigger="click"
              placement="topLeft"
              open={reminderOpen}
              onOpenChange={setReminderOpen}
              content={reminderPopoverContent}
            >
              <Tooltip title="消息提醒">
                <Badge count={reminderTotal} size="small" overflowCount={99} offset={[-2, 2]}>
                  <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} style={{ padding: '4px 8px' }} />
                </Badge>
              </Tooltip>
            </Popover>
            <Popover
              title="实时动态"
              trigger="click"
              placement="topLeft"
              open={pushOpen}
              onOpenChange={(open) => {
                setPushOpen(open)
                if (open) setPushUnread(0)
              }}
              content={pushPopoverContent}
            >
              <Tooltip title="实时动态（钉钉审批与推送）">
                <Badge count={pushUnread} size="small" overflowCount={99} offset={[-2, 2]}>
                  <Button
                    type="text"
                    icon={
                      <ThunderboltOutlined
                        style={{
                          fontSize: 18,
                          color: pushLive ? 'var(--ant-colorSuccess)' : 'var(--ant-colorTextSecondary)',
                        }}
                      />
                    }
                    style={{ padding: '4px 8px' }}
                  />
                </Badge>
              </Tooltip>
            </Popover>
          </div>
          <div
            style={{
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              minHeight: 48,
            }}
          >
            <Space size={6} style={{ flex: 1, minWidth: 0 }}>
              <span style={{ color: 'var(--ant-colorTextSecondary)', fontSize: 12 }}>
                <UserOutlined style={{ marginRight: 4 }} />
              </span>
              <Typography.Text ellipsis style={{ fontSize: 12 }}>
                {currentUserDisplay}
              </Typography.Text>
            </Space>
            <Space size={4}>
              {isAdmin ? (
                <Tooltip title="系统设置">
                  <Button
                    type="text"
                    size="small"
                    icon={<SettingOutlined style={{ fontSize: 14 }} />}
                    onClick={() => setSettingsOpen(true)}
                    style={{ padding: '2px 6px' }}
                  />
                </Tooltip>
              ) : null}
              <Button
                type="text"
                size="small"
                onClick={() => {
                  logout()
                  navigate('/login', { replace: true })
                }}
                style={{ padding: '2px 6px', fontSize: 12 }}
              >
                退出
              </Button>
            </Space>
          </div>
        </div>
      )}
    >
      <Modal
        title="系统信息"
        open={systemInfoOpen}
        onCancel={() => setSystemInfoOpen(false)}
        footer={
          <Button type="primary" onClick={() => setSystemInfoOpen(false)}>
            关闭
          </Button>
        }
        destroyOnClose
        width={560}
      >
        <Typography.Paragraph style={{ marginBottom: 16 }}>
          <Typography.Text strong>当前版本：</Typography.Text>{' '}
          <Typography.Text code>{APP_VERSION}</Typography.Text>
        </Typography.Paragraph>
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
          更新说明
        </Typography.Title>
        <div style={{ maxHeight: 360, overflow: 'auto', paddingRight: 4 }}>
          {SYSTEM_RELEASE_NOTES.map((rel) => (
            <div key={rel.version} style={{ marginBottom: 16 }}>
              <Typography.Text strong>
                {rel.version}
                {rel.date ? `（${rel.date}）` : ''}
              </Typography.Text>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {rel.items.map((t, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Modal>
      <Modal
        title="系统设置"
        open={settingsOpen && isAdmin}
        onCancel={() => setSettingsOpen(false)}
        footer={
          <Button type="primary" onClick={() => setSettingsOpen(false)}>
            确定
          </Button>
        }
        destroyOnClose
        width={560}
      >
        <div style={{ marginBottom: 24 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>大模型</Typography.Text>
          <Select
            value={llmProvider}
            options={llmProviderOptions.map((o) => ({ value: o.id, label: o.label }))}
            onChange={async (value) => {
              try {
                await axios.post('/api/llm-provider', { provider: value }, { headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {} })
                setLlmProvider(value)
                msg.success(`已切换为 ${llmProviderOptions.find((o) => o.id === value)?.label ?? value}`)
              } catch (e: any) {
                msg.error(e?.response?.data?.message || '切换失败')
              }
            }}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: 24 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>附件总容量</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
            统计研发文档、知识库、项目合同、商机附件等已接入模块的附件大小之和；默认 5GiB（含原研发侧单独配额语义，现为全系统统一上限）。超出或剩余不足 500MB
            时向管理员发邮件提醒，不会拦截业务上传。
          </Typography.Text>
          {attachmentQuotaSummary != null ? (
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
              当前约已用 {(attachmentQuotaSummary.usedBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB，剩余约{' '}
              {(attachmentQuotaSummary.remainingBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB
              {attachmentQuotaSummary.exceeded ? '（已达或超过配额）' : ''}
              {!attachmentQuotaSummary.exceeded && attachmentQuotaSummary.warnLowRemaining ? '（剩余不足 500MB）' : ''}
            </Typography.Text>
          ) : null}
          <Form form={attachmentQuotaForm} layout="vertical" preserve={false}>
            <Form.Item
              name="quotaGiB"
              label="总容量上限（GiB）"
              rules={[
                { required: true, message: '请输入容量' },
                () => ({
                  validator(_, value) {
                    const n = Number(value)
                    if (!Number.isFinite(n) || n < 1 / 1024 || n > 1024) {
                      return Promise.reject(new Error('须在约 0.001～1024 GiB 之间'))
                    }
                    return Promise.resolve()
                  },
                }),
              ]}
            >
              <InputNumber min={0.001} max={1024} step={0.25} style={{ width: '100%' }} placeholder="如 5" />
            </Form.Item>
          </Form>
          <Space wrap>
            <Button type="default" loading={attachmentQuotaSaveLoading} onClick={() => void saveAttachmentQuota()}>
              保存附件容量
            </Button>
            <Button type="default" loading={attachmentSyncPreviewLoading} onClick={() => void runAttachmentSyncPreview()}>
              预览磁盘对账
            </Button>
          </Space>
        </div>
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>解析设置</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
            DeepSeek 未提供向量接口。开启「表头向量匹配」并填写兼容 OpenAI 的 Embedding API 后，未命中规则的列将用语义相似度匹配（如 OpenAI text-embedding-3-small）。
          </Typography.Text>
          <Form form={embeddingForm} layout="vertical" preserve={false}>
            <Form.Item name="enabled" label="启用表头向量匹配" valuePropName="checked">
              <Switch checkedChildren="开" unCheckedChildren="关" />
            </Form.Item>
            <Form.Item name="apiUrl" label="Embedding API 地址">
              <Input placeholder="如 https://api.openai.com/v1" />
            </Form.Item>
            <Form.Item name="apiKey" label="API Key">
              <Input.Password placeholder="留空则保留已配置的 Key" autoComplete="off" />
            </Form.Item>
            <Form.Item name="model" label="模型名称">
              <Input placeholder="如 text-embedding-3-small" />
            </Form.Item>
          </Form>
          <Button type="default" loading={embeddingSaveLoading} onClick={saveEmbeddingConfig}>
            保存解析设置
          </Button>
        </div>
      </Modal>
      <Modal
        title="附件磁盘对账预览"
        open={attachmentSyncPreviewModalOpen}
        onCancel={() => setAttachmentSyncPreviewModalOpen(false)}
        width={760}
        footer={[
          <Button key="close" onClick={() => setAttachmentSyncPreviewModalOpen(false)}>
            关闭
          </Button>,
          <Button key="sync" type="primary" onClick={() => openAttachmentSyncConfirm()}>
            执行同步（二次确认）
          </Button>,
        ]}
      >
        {attachmentSyncPreviewData ? (
          <>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
              数据根目录：<Typography.Text code>{attachmentSyncPreviewData.dataDir}</Typography.Text>
              。仅递归统计下列子目录（与系统附件配额统计口径一致），不包含 data 下其它目录（如 recycle、导出缓存等）。
            </Typography.Paragraph>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              <Typography.Text strong>本次扫描的目录及汇总</Typography.Text>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 12 }}>
                {attachmentSyncPreviewData.scannedSubdirs.map((d) => (
                  <li key={d}>
                    <Typography.Text code>{d}</Typography.Text>
                  </li>
                ))}
              </ul>
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              预览令牌有效期至 {attachmentSyncPreviewData.previewExpiresAt}。合计：磁盘{' '}
              {(attachmentSyncPreviewData.diskTotalBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB；库表 file_size 之和{' '}
              {(attachmentSyncPreviewData.dbTotalBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB；差值（磁盘−库）{' '}
              {(attachmentSyncPreviewData.deltaBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB。盘上无库记录的文件约{' '}
              {attachmentSyncPreviewData.orphanDiskCount} 个；库有记录但文件不存在约 {attachmentSyncPreviewData.missingOnDiskCount} 条。
            </Typography.Paragraph>
            {attachmentSyncPreviewData.warnings?.length ? (
              <Typography.Paragraph type="warning" style={{ fontSize: 12 }}>
                {attachmentSyncPreviewData.warnings.join('；')}
              </Typography.Paragraph>
            ) : null}
            <Table
              size="small"
              pagination={false}
              rowKey="key"
              columns={attachmentSyncPreviewColumns}
              dataSource={attachmentSyncPreviewData.rows}
              style={{ marginBottom: 12 }}
            />
            {attachmentSyncPreviewData.orphanDiskSample.length ? (
              <Typography.Paragraph style={{ fontSize: 12 }}>
                <Typography.Text strong>孤儿文件样例（最多 {attachmentSyncPreviewData.orphanDiskSample.length} 条）：</Typography.Text>
                <div style={{ maxHeight: 120, overflow: 'auto', marginTop: 4 }}>
                  {attachmentSyncPreviewData.orphanDiskSample.map((p) => (
                    <div key={p}>
                      <Typography.Text code style={{ fontSize: 11 }}>
                        {p}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
              </Typography.Paragraph>
            ) : null}
            {attachmentSyncPreviewData.missingOnDiskSample.length ? (
              <Typography.Paragraph style={{ fontSize: 12 }}>
                <Typography.Text strong>库有路径但磁盘缺失样例：</Typography.Text>
                <div style={{ maxHeight: 120, overflow: 'auto', marginTop: 4 }}>
                  {attachmentSyncPreviewData.missingOnDiskSample.map((p) => (
                    <div key={p}>
                      <Typography.Text code style={{ fontSize: 11 }}>
                        {p}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
              </Typography.Paragraph>
            ) : null}
          </>
        ) : null}
      </Modal>
      <Modal
        title="二次确认：附件同步"
        open={attachmentSyncConfirmOpen}
        onCancel={() => setAttachmentSyncConfirmOpen(false)}
        width={560}
        destroyOnClose
        okText="确认执行"
        okButtonProps={{ danger: true, loading: attachmentSyncApplyLoading }}
        onOk={async () => {
          const ok = await submitAttachmentSyncApply()
          if (!ok) return Promise.reject(new Error('sync-aborted'))
        }}
      >
        {attachmentSyncPreviewData ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
              将按与上一步预览<strong>相同</strong>的目录与汇总执行；若期间有新上传或删除，服务器会拒绝执行（请重新预览）。请再次核对下列数字：
            </Typography.Paragraph>
            <Typography.Text style={{ fontSize: 12 }}>
              磁盘合计 {(attachmentSyncPreviewData.diskTotalBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB；库合计{' '}
              {(attachmentSyncPreviewData.dbTotalBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB；差值{' '}
              {(attachmentSyncPreviewData.deltaBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB。
            </Typography.Text>
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                同步方向
              </Typography.Text>
              <Radio.Group value={attachmentSyncMode} onChange={(e) => setAttachmentSyncMode(e.target.value)}>
                <Space direction="vertical">
                  <Radio value="disk">
                    以磁盘为准：仅把库中 file_size 更新为磁盘文件实际大小（文件缺失的库行不删除、不修改）
                  </Radio>
                  <Radio value="db">
                    以库为准：将上述扫描目录下、库中无任何 file_path 对应的文件移入 data/recycle（不直接删除表记录）
                  </Radio>
                </Space>
              </Radio.Group>
            </div>
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                当前登录密码
              </Typography.Text>
              <Input.Password
                value={attachmentSyncApplyPassword}
                onChange={(e) => setAttachmentSyncApplyPassword(e.target.value)}
                placeholder="用于确认敏感操作"
                autoComplete="off"
              />
            </div>
          </Space>
        ) : null}
      </Modal>
      <PageContainer>
        <Suspense
          fallback={
            <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
              <Spin size="large" />
            </div>
          }
        >
          <Routes>
          <Route
            path="/dashboard"
            element={
              <RequireAuth permissions={['dashboard']}>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/staff-handover"
            element={
              <RequireAuth roles={['admin', 'company_management']}>
                <StaffHandoverPage />
              </RequireAuth>
            }
          />
          <Route
            path="/users/dingtalk"
            element={
              <RequireAuth permissions={['users']}>
                <DingTalkAdminPage />
              </RequireAuth>
            }
          />
          <Route
            path="/users"
            element={
              <RequireAuth permissions={['users']}>
                <UserManagementPage />
              </RequireAuth>
            }
          />
          <Route
            path="/docs"
            element={
              <RequireAuth permissions={['docs']}>
                <DocTasksPage />
              </RequireAuth>
            }
          />
          <Route
            path="/docs-excel-format"
            element={
              <RequireAuth permissions={['docs']}>
                <DocTasksExcelFormatPage />
              </RequireAuth>
            }
          />
          <Route
            path="/projects"
            element={
              <RequireAuth permissions={['projects']}>
                <ProjectsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/project-analysis"
            element={
              <RequireAuth permissions={['projects']}>
                <ProjectAnalysisPage />
              </RequireAuth>
            }
          />
          <Route
            path="/opportunity-todos"
            element={
              <RequireAuth permissions={['opportunity-todos']}>
                <OpportunityTodosPage />
              </RequireAuth>
            }
          />
          <Route path="/opportunities/todos" element={<Navigate to="/opportunity-todos" replace />} />
          <Route
            path="/opportunities/detail/:id"
            element={
              <RequireAuth permissions={['opportunities']}>
                <OpportunityDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/opportunities"
            element={
              <RequireAuth permissions={['opportunities']}>
                <OpportunitiesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/construction/project-info"
            element={
              <RequireAuth permissions={['construction']}>
                <ConstructionProjectInfoPage />
              </RequireAuth>
            }
          />
          <Route
            path="/construction/project-info/detail/:id"
            element={
              <RequireAuth permissions={['construction']}>
                <ConstructionProjectDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/construction/progress"
            element={
              <RequireAuth permissions={['construction']}>
                <ConstructionProgressPage />
              </RequireAuth>
            }
          />
          <Route
            path="/construction/progress/bulk-create"
            element={
              <RequireAuth permissions={['construction']}>
                <ConstructionProgressBulkCreatePage />
              </RequireAuth>
            }
          />
          <Route
            path="/construction/quality"
            element={
              <RequireAuth permissions={['construction']}>
                <ConstructionQualityPage />
              </RequireAuth>
            }
          />
          <Route
            path="/construction/safety"
            element={
              <RequireAuth permissions={['construction']}>
                <ConstructionSafetyPage />
              </RequireAuth>
            }
          />
          <Route
            path="/construction/log"
            element={
              <RequireAuth permissions={['construction']}>
                <ConstructionLogPage />
              </RequireAuth>
            }
          />
          <Route
            path="/maintenance/minor-work"
            element={
              <RequireAuth permissions={['maintenance']}>
                <MaintenanceMinorWorkPage />
              </RequireAuth>
            }
          />
          <Route
            path="/maintenance/schedule"
            element={
              <RequireAuth permissions={['maintenance']}>
                <MaintenanceSchedulePage />
              </RequireAuth>
            }
          />
          <Route
            path="/personnel-presence"
            element={
              <RequireAuth permissions={['maintenance']}>
                <PersonnelPresencePage />
              </RequireAuth>
            }
          />
          <Route path="/maintenance/personnel-presence" element={<Navigate to="/personnel-presence" replace />} />
          <Route
            path="/project-products"
            element={
              <RequireAuth permissions={['projects']}>
                <ProjectProductListPage />
              </RequireAuth>
            }
          />
          <Route
            path="/config-orders"
            element={
              <RequireAuth permissions={['config-orders']}>
                <ConfigOrdersPage />
              </RequireAuth>
            }
          />
          <Route
            path="/inventory"
            element={
              <RequireAuth permissions={['inventory']}>
                <InventoryQueryPage />
              </RequireAuth>
            }
          />
          <Route
            path="/inventory-maintain"
            element={
              <RequireAuth permissions={['inventory-maintain']}>
                <InventoryMaintainPage />
              </RequireAuth>
            }
          />
          <Route
            path="/inventory-stock-in"
            element={
              <RequireAuth permissions={['inventory']}>
                <InventoryStockInPage />
              </RequireAuth>
            }
          />
          <Route
            path="/inventory-stock-in/detail"
            element={
              <RequireAuth permissions={['inventory']}>
                <InventoryStockInDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/inventory-stock-out"
            element={
              <RequireAuth permissions={['inventory']}>
                <InventoryStockOutPage />
              </RequireAuth>
            }
          />
          <Route
            path="/inventory-stock-out/detail"
            element={
              <RequireAuth permissions={['inventory']}>
                <InventoryStockOutDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/cost-list"
            element={
              <RequireAuth permissions={['cost-list']}>
                <CostListPage />
              </RequireAuth>
            }
          />
          <Route
            path="/project-list"
            element={<Navigate to="/products" replace />}
          />
          <Route
            path="/auto-config"
            element={
              <RequireAuth permissions={['auto-config']}>
                <AutoConfigPage />
              </RequireAuth>
            }
          />
          <Route
            path="/products"
            element={
              <RequireAuth permissions={['products']}>
                <ProductsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/logs"
            element={
              <RequireAuth permissions={['logs']}>
                <LogsPage />
              </RequireAuth>
            }
          />
          <Route path="/workbench/messages" element={<RequireAuth><WorkbenchPushMessagesPage /></RequireAuth>} />
          <Route
            path="/rules"
            element={
              <RequireAuth permissions={['rules']}>
                <ExcelParseRulesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/rules/formulas"
            element={
              <RequireAuth permissions={['rules-formulas']}>
                <FormulasPage />
              </RequireAuth>
            }
          />
          <Route
            path="/knowledge"
            element={
              <RequireAuth permissions={['knowledge']}>
                <KnowledgePage />
              </RequireAuth>
            }
          />
          <Route
            path="/rd/todos"
            element={
              <RequireAuth permissions={['rd-mgmt']}>
                <RdResearchTodosPage />
              </RequireAuth>
            }
          />
          <Route
            path="/rd/docs"
            element={
              <RequireAuth permissions={['rd-mgmt']}>
                <RdResearchDocsPage />
              </RequireAuth>
            }
          />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="*"
            element={
              <Result status="404" title="404" subTitle="未找到对应页面" />
            }
          />
          </Routes>
        </Suspense>
      </PageContainer>
    </ProLayout>
  )
}

const App: React.FC = () => {
  return (
    <ConfigProvider locale={zhCN} theme={{ algorithm: theme.defaultAlgorithm }}>
      <AntdApp>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route
                path="/login"
                element={
                  <Suspense
                    fallback={
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                        <Spin size="large" />
                      </div>
                    }
                  >
                    <LoginPage />
                  </Suspense>
                }
              />
              <Route
                path="/forgot-password"
                element={
                  <Suspense
                    fallback={
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                        <Spin size="large" />
                      </div>
                    }
                  >
                    <ForgotPasswordPage />
                  </Suspense>
                }
              />
              <Route
                path="/complete-email"
                element={
                  <Suspense
                    fallback={
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                        <Spin size="large" />
                      </div>
                    }
                  >
                    <CompleteEmailPage />
                  </Suspense>
                }
              />
              <Route path="/*" element={<LayoutWithMenu />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
