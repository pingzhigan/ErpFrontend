/**
 * 权限组表单：树状勾选，与 App.tsx 侧栏 appRoutes 层级一致。
 */
import { Tree } from 'antd'
import type { DataNode } from 'antd/es/tree'
import React, { useMemo } from 'react'
import { buildPermissionTreeModel } from '../config/rolePermissionTree'

type Opt = { value: string; label: string }

export const PermissionCheckTree: React.FC<{
  value?: string[]
  onChange?: (v: string[]) => void
  permissionOptions: Opt[]
}> = ({ value, onChange, permissionOptions }) => {
  const { treeData, keyToPermission, permissionToKeys } = useMemo(
    () => buildPermissionTreeModel(permissionOptions),
    [permissionOptions],
  )

  const checkedKeys = useMemo(() => {
    const perms = value ?? []
    const keys: string[] = []
    for (const p of perms) {
      const ks = permissionToKeys.get(p)
      if (ks) keys.push(...ks)
    }
    return keys
  }, [value, permissionToKeys])

  const onCheck: React.ComponentProps<typeof Tree>['onCheck'] = (keys) => {
    const list = Array.isArray(keys) ? keys : keys.checked
    const next = new Set<string>()
    for (const k of list.map(String)) {
      const perm = keyToPermission.get(k)
      if (perm) next.add(perm)
    }
    onChange?.([...next])
  }

  return (
    <Tree
      checkable
      showLine
      defaultExpandAll
      blockNode
      treeData={treeData as DataNode[]}
      checkedKeys={checkedKeys}
      onCheck={onCheck}
      style={{
        maxHeight: 400,
        overflow: 'auto',
        border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
        borderRadius: 8,
        padding: '8px 4px',
      }}
    />
  )
}
