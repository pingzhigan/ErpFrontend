/**
 * 研发管理 — 效率评估
 */
import { ExperimentOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { MaintenanceEfficiencyPanel } from '../components/MaintenanceEfficiencyPanel'

const RdEfficiencyEvaluationPage: React.FC = () => {
  const navigate = useNavigate()

  return (
    <MaintenanceEfficiencyPanel
      apiPath="/api/rd/todos/efficiency-stats"
      title="效率评估"
      description="支持按周期筛选（默认当月）；汇总任务完成与时效；下方按负责人统计。"
      assigneeColumnTitle="负责人"
      openLabel="进行中"
      doneLabel="已完成"
      showTestTag={false}
      backPath="/rd/todos"
      backLabel="研发待办"
      extraActions={
        <Button type="link" icon={<ExperimentOutlined />} onClick={() => navigate('/rd/task-timeout')}>
          任务超时管理
        </Button>
      }
    />
  )
}

export default RdEfficiencyEvaluationPage
