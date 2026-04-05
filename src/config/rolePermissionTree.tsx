/**
 * 权限组勾选树：一级/二级与 App.tsx 中 appRoutes 侧栏结构一致。
 * 树节点 key 为 `m:${path}`（路径唯一）；多行菜单可对应同一 permission，勾选时合并为后端权限列表。
 */
import type { DataNode } from 'antd/es/tree'

type Opt = { value: string; label: string }

export type PermissionTreeModel = {
  treeData: DataNode[]
  keyToPermission: ReadonlyMap<string, string>
  permissionToKeys: ReadonlyMap<string, readonly string[]>
}

type SubItem = { path: string; name: string; permission: string; hideInMenu?: boolean }

type TopEntry =
  | { kind: 'divider' }
  | { kind: 'single'; path: string; name: string; permission: string; hideInMenu?: boolean }
  | { kind: 'group'; groupPath: string; name: string; hideInMenu?: boolean; children: SubItem[] }

/**
 * 与 App.tsx `appRoutes` 顺序、父子关系一致（无 icon）；divider 跳过。
 */
const SIDEBAR_ENTRIES: TopEntry[] = [
  { kind: 'single', path: '/dashboard', name: '仪表盘', permission: 'dashboard' },
  { kind: 'divider' },
  {
    kind: 'group',
    groupPath: '/project-mgr',
    name: '项目管理',
    children: [
      { path: '/projects', name: '项目列表', permission: 'projects' },
      { path: '/project-analysis', name: '项目分析', permission: 'projects' },
      { path: '/docs', name: '项目维护', permission: 'docs', hideInMenu: true },
      { path: '/docs-excel-format', name: '项目维护(智能格式化)', permission: 'docs' },
      { path: '/project-products', name: '项目详情', permission: 'projects', hideInMenu: true },
    ],
  },
  { kind: 'single', path: '/opportunities', name: '机会管理', permission: 'opportunities' },
  {
    kind: 'group',
    groupPath: '/construction-mgr',
    name: '施工管理',
    children: [
      { path: '/construction/project-info', name: '项目信息', permission: 'construction' },
      { path: '/construction/progress', name: '进度管理', permission: 'construction' },
      { path: '/construction/quality', name: '质量管理', permission: 'construction', hideInMenu: true },
      { path: '/construction/safety', name: '安全管理', permission: 'construction', hideInMenu: true },
      { path: '/construction/log', name: '施工日志', permission: 'construction' },
    ],
  },
  {
    kind: 'group',
    groupPath: '/maintenance-mgr',
    name: '维护管理',
    children: [
      { path: '/maintenance/minor-work', name: '零星工程', permission: 'maintenance' },
      { path: '/maintenance/schedule', name: '维护排单', permission: 'maintenance' },
    ],
  },
  {
    kind: 'group',
    groupPath: '/project-list',
    name: '商品列表',
    children: [
      { path: '/config-orders', name: '项目配单', permission: 'config-orders', hideInMenu: true },
      { path: '/cost-list', name: '成本清单', permission: 'cost-list' },
      { path: '/products', name: '报价清单', permission: 'products' },
    ],
  },
  {
    kind: 'group',
    groupPath: '/inventory-mgr',
    name: '库存管理',
    children: [
      { path: '/inventory', name: '库存查询', permission: 'inventory' },
      { path: '/inventory-maintain', name: '库存维护', permission: 'inventory-maintain' },
      { path: '/inventory-stock-in', name: '入库管理', permission: 'inventory' },
      { path: '/inventory-stock-out', name: '出库管理', permission: 'inventory' },
    ],
  },
  {
    kind: 'group',
    groupPath: '/ai-assistant',
    name: 'AI助手',
    hideInMenu: true,
    children: [{ path: '/auto-config', name: 'AI配单检查', permission: 'auto-config' }],
  },
  { kind: 'divider' },
  { kind: 'single', path: '/rules', name: '规则引擎', permission: 'rules' },
  {
    kind: 'single',
    path: '/rules/formulas',
    name: '计算公式引擎',
    permission: 'rules-formulas',
    hideInMenu: true,
  },
  { kind: 'single', path: '/knowledge', name: '知识库', permission: 'knowledge' },
  { kind: 'divider' },
  {
    kind: 'group',
    groupPath: '/users-mgr',
    name: '用户管理',
    children: [
      { path: '/users', name: '用户与权限', permission: 'users' },
      { path: '/users/dingtalk', name: '钉钉集成', permission: 'users' },
    ],
  },
  { kind: 'single', path: '/logs', name: '日志管理', permission: 'logs' },
]

const TREE_KEY_PREFIX = 'm:'
const GROUP_KEY_PREFIX = 'g:'

function registerLeaf(
  path: string,
  title: string,
  permission: string,
  allowed: Set<string>,
  keyToPermission: Map<string, string>,
  permissionToKeys: Map<string, string[]>,
): DataNode | null {
  if (!allowed.has(permission)) return null
  const key = `${TREE_KEY_PREFIX}${path}`
  keyToPermission.set(key, permission)
  const list = permissionToKeys.get(permission) ?? []
  list.push(key)
  permissionToKeys.set(permission, list)
  return { title, key, isLeaf: true }
}

function formatSubTitle(name: string, hideInMenu?: boolean): string {
  return hideInMenu ? `${name}（侧栏不展示）` : name
}

/**
 * 构建树及 key↔permission 映射；后端有而侧栏未列出的权限挂在「其他权限」。
 */
export function buildPermissionTreeModel(permissionOptions: Opt[]): PermissionTreeModel {
  const allowed = new Set(permissionOptions.map((o) => o.value))
  const keyToPermission = new Map<string, string>()
  const permissionToKeys = new Map<string, string[]>()
  const placedPermissions = new Set<string>()
  const treeData: DataNode[] = []

  for (const entry of SIDEBAR_ENTRIES) {
    if (entry.kind === 'divider') continue
    if (entry.kind === 'single') {
      const title = formatSubTitle(entry.name, entry.hideInMenu)
      const node = registerLeaf(
        entry.path,
        title,
        entry.permission,
        allowed,
        keyToPermission,
        permissionToKeys,
      )
      if (node) {
        treeData.push(node)
        placedPermissions.add(entry.permission)
      }
      continue
    }

    const children: DataNode[] = []
    for (const sub of entry.children) {
      const title = formatSubTitle(sub.name, sub.hideInMenu)
      const node = registerLeaf(sub.path, title, sub.permission, allowed, keyToPermission, permissionToKeys)
      if (node) {
        children.push(node)
        placedPermissions.add(sub.permission)
      }
    }

    if (entry.groupPath === '/inventory-mgr' && allowed.has('inventory-stock')) {
      const opt = permissionOptions.find((o) => o.value === 'inventory-stock')
      const label = opt?.label ?? '入库出库管理'
      const n = registerLeaf(
        '/__perm__/inventory-stock',
        `${label}（独立权限项，路由仍用库存相关页）`,
        'inventory-stock',
        allowed,
        keyToPermission,
        permissionToKeys,
      )
      if (n) {
        children.push(n)
        placedPermissions.add('inventory-stock')
      }
    }

    if (children.length === 0) continue
    const groupTitle = entry.hideInMenu ? formatSubTitle(entry.name, true) : entry.name
    treeData.push({
      title: groupTitle,
      key: `${GROUP_KEY_PREFIX}${entry.groupPath}`,
      selectable: false,
      children,
    })
  }

  const rest = permissionOptions.filter((o) => !placedPermissions.has(o.value))
  if (rest.length > 0) {
    const otherChildren: DataNode[] = []
    for (const o of rest) {
      const node = registerLeaf(
        `/__other__/${o.value}`,
        `${o.label}（${o.value}）`,
        o.value,
        allowed,
        keyToPermission,
        permissionToKeys,
      )
      if (node) otherChildren.push(node)
    }
    if (otherChildren.length > 0) {
      treeData.push({
        title: '其他权限',
        key: `${GROUP_KEY_PREFIX}__other__`,
        selectable: false,
        children: otherChildren,
      })
    }
  }

  const frozenPermToKeys = new Map<string, readonly string[]>(
    [...permissionToKeys.entries()].map(([k, v]) => [k, Object.freeze([...v])]),
  )

  return {
    treeData,
    keyToPermission,
    permissionToKeys: frozenPermToKeys,
  }
}
