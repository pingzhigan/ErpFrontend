/** 未启用钉钉门禁，或已启用且非「审批中」时允许编辑/删除等（与后端 assertGateEntityEditable 一致） */
export function auditGateAllowsEditWhenNotApproving(
  audit: { dingtalk_gate?: boolean; audit_status?: string } | undefined,
): boolean {
  if (!audit?.dingtalk_gate) return true
  return audit.audit_status !== 'approving'
}
