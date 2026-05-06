/**
 * 施工负责人/进度任务负责人：下拉选项合并（在职用户 + 仍被业务引用但已停用/删除的账号）
 */
export type AssigneeUserRow = { id: number; username: string; real_name: string | null }

export type AssigneeInactiveRef = {
  username: string
  real_name: string | null
  status: 'disabled' | 'deleted' | 'missing'
}

export function labelForAssigneeUsername(username: string, realName: string | null | undefined): string {
  const rn = (realName ?? '').trim()
  return rn ? `${rn} (${username})` : username
}

/** 列表/详情等仅展示姓名；无维护姓名时用登录名（不附带括号用户名） */
export function assigneeDisplayNameOnly(username: string, realName: string | null | undefined): string {
  const un = String(username ?? '').trim()
  const rn = (realName ?? '').trim()
  return rn || un
}

function inactiveTag(s: AssigneeInactiveRef['status']): string {
  if (s === 'missing') return '（非系统用户）'
  if (s === 'deleted') return '（已删除）'
  return '（已停用）'
}

export function buildConstructionAssigneeOptions(
  list: AssigneeUserRow[],
  inactiveReferenced: AssigneeInactiveRef[] | undefined,
): { value: string; label: string }[] {
  const active = list.map((u) => ({
    value: u.username,
    label: labelForAssigneeUsername(u.username, u.real_name),
  }))
  const seen = new Set(active.map((o) => o.value))
  const extra = (inactiveReferenced ?? []).filter((u) => u.username && !seen.has(u.username))
  const inactive = extra.map((u) => ({
    value: u.username,
    label: `${labelForAssigneeUsername(u.username, u.real_name)}${inactiveTag(u.status)}`,
  }))
  return [...active, ...inactive]
}

export function assigneeLabelMap(options: { value: string; label: string }[]): Map<string, string> {
  return new Map(options.map((o) => [o.value, o.label]))
}
