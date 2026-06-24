import React from 'react'
import { MaintenanceEfficiencyPanel } from '../components/MaintenanceEfficiencyPanel'

const MaintenanceScheduleEfficiencyPage: React.FC = () => (
  <MaintenanceEfficiencyPanel
    apiPath="/api/maintenance-tasks/efficiency-stats"
    title="维护排单效率评估"
    description="支持按周期筛选；汇总任务完成与时效；下方按施工人员统计参与任务数与人天（可展开查看各任务参与明细）。"
    analysisTableMode="worker"
    openLabel="未完成"
    doneLabel="已完成"
    backPath="/maintenance/schedule"
    backLabel="返回维护排单"
  />
)

export default MaintenanceScheduleEfficiencyPage
