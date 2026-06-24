import React from 'react'
import { MaintenanceEfficiencyPanel } from '../components/MaintenanceEfficiencyPanel'

const MaintenanceMinorWorkEfficiencyPage: React.FC = () => (
  <MaintenanceEfficiencyPanel
    apiPath="/api/minor-works/efficiency-stats"
    title="零星工程效率评估"
    description="支持按周期筛选；汇总任务完成与时效；下方按施工人员统计参与任务数与人天（可展开查看各任务参与明细）。"
    analysisTableMode="worker"
    openLabel="未闭环"
    doneLabel="已闭环"
    backPath="/maintenance/minor-work"
    backLabel="返回零星工程"
  />
)

export default MaintenanceMinorWorkEfficiencyPage
