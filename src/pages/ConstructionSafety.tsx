import React, { useState } from 'react'
import { Alert, Card, Descriptions, Modal, Space, Table, Tag, Typography } from 'antd'
import { ExclamationCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

const { Title } = Typography

interface SafetyRecord {
  id: number
  project: string
  date: string
  type: string
  level: string
  description: string
  handler: string
  status: string
  corrective: string
}

const LEVEL_MAP: Record<string, { color: string; label: string }> = {
  low: { color: 'blue', label: '一般' },
  medium: { color: 'warning', label: '较大' },
  high: { color: 'error', label: '重大' },
}

const TYPE_MAP: Record<string, string> = {
  inspection: '安全巡检',
  incident: '安全事件',
  training: '安全培训',
  drill: '应急演练',
}

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  open: { color: 'error', label: '待处理' },
  processing: { color: 'processing', label: '处理中' },
  closed: { color: 'success', label: '已关闭' },
}

const MOCK_DATA: SafetyRecord[] = [
  {
    id: 1,
    project: '某科技园区弱电系统工程',
    date: '2026-03-05',
    type: 'inspection',
    level: 'low',
    description: '3层施工区域灭火器过期，需更换',
    handler: '安全员A',
    status: 'closed',
    corrective: '已更换全部过期灭火器并建立检查台账',
  },
  {
    id: 2,
    project: '某科技园区弱电系统工程',
    date: '2026-03-07',
    type: 'incident',
    level: 'medium',
    description: '工人高空作业未系安全带，被巡查发现制止',
    handler: '安全员B',
    status: 'processing',
    corrective: '对相关人员进行安全教育培训，加强现场监督',
  },
  {
    id: 3,
    project: '办公楼智能化改造',
    date: '2026-03-06',
    type: 'training',
    level: 'low',
    description: '新入场人员安全三级教育培训',
    handler: '安全员A',
    status: 'closed',
    corrective: '12人参训，全部通过考核',
  },
  {
    id: 4,
    project: '办公楼智能化改造',
    date: '2026-03-08',
    type: 'drill',
    level: 'low',
    description: '消防疏散应急演练',
    handler: '安全员C',
    status: 'closed',
    corrective: '演练顺利完成，疏散时间3分15秒',
  },
]

const ConstructionSafetyPage: React.FC = () => {
  const [data] = useState<SafetyRecord[]>(MOCK_DATA)
  const [detailOpen, setDetailOpen] = useState(false)
  const [current, setCurrent] = useState<SafetyRecord | null>(null)

  const openCount = data.filter((d) => d.status === 'open' || d.status === 'processing').length

  const columns: ColumnsType<SafetyRecord> = [
    { title: '日期', dataIndex: 'date', width: 120 },
    { title: '所属项目', dataIndex: 'project', width: 240 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      filters: Object.entries(TYPE_MAP).map(([k, v]) => ({ text: v, value: k })),
      onFilter: (val, record) => record.type === val,
      render: (v: string) => TYPE_MAP[v] ?? v,
    },
    {
      title: '等级',
      dataIndex: 'level',
      width: 80,
      render: (v: string) => {
        const s = LEVEL_MAP[v] ?? { color: 'default', label: v }
        return <Tag color={s.color}>{s.label}</Tag>
      },
    },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
    },
    { title: '责任人', dataIndex: 'handler', width: 100 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      filters: Object.entries(STATUS_MAP).map(([k, v]) => ({ text: v.label, value: k })),
      onFilter: (val, record) => record.status === val,
      render: (v: string) => {
        const s = STATUS_MAP[v] ?? { color: 'default', label: v }
        return <Tag color={s.color}>{s.label}</Tag>
      },
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, r: SafetyRecord) => (
        <a
          onClick={() => {
            setCurrent(r)
            setDetailOpen(true)
          }}
        >
          详情
        </a>
      ),
    },
  ]

  return (
    <Card>
      <Title level={5} style={{ marginBottom: 16 }}>
        <SafetyCertificateOutlined style={{ marginRight: 8 }} />
        安全管理
      </Title>

      {openCount > 0 && (
        <Alert
          message={`当前有 ${openCount} 条待处理/处理中的安全事项`}
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          style={{ marginBottom: 16 }}
        />
      )}

      <Space size="large" style={{ marginBottom: 20 }}>
        <Card size="small" style={{ minWidth: 120, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--ant-colorPrimary)' }}>
            {data.length}
          </div>
          <div style={{ color: 'var(--ant-colorTextSecondary)', fontSize: 12 }}>记录总数</div>
        </Card>
        <Card size="small" style={{ minWidth: 120, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--ant-colorError)' }}>
            {data.filter((d) => d.type === 'incident').length}
          </div>
          <div style={{ color: 'var(--ant-colorTextSecondary)', fontSize: 12 }}>安全事件</div>
        </Card>
        <Card size="small" style={{ minWidth: 120, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--ant-colorSuccess)' }}>
            {data.filter((d) => d.status === 'closed').length}
          </div>
          <div style={{ color: 'var(--ant-colorTextSecondary)', fontSize: 12 }}>已关闭</div>
        </Card>
      </Space>

      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        pagination={{ pageSize: 10 }}
        size="middle"
      />

      <Modal
        title="安全记录详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={600}
      >
        {current && (
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="日期">{current.date}</Descriptions.Item>
            <Descriptions.Item label="所属项目">{current.project}</Descriptions.Item>
            <Descriptions.Item label="类型">{TYPE_MAP[current.type]}</Descriptions.Item>
            <Descriptions.Item label="等级">
              <Tag color={LEVEL_MAP[current.level]?.color}>
                {LEVEL_MAP[current.level]?.label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="责任人">{current.handler}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={STATUS_MAP[current.status]?.color}>
                {STATUS_MAP[current.status]?.label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="描述" span={2}>
              {current.description}
            </Descriptions.Item>
            <Descriptions.Item label="整改措施" span={2}>
              {current.corrective}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </Card>
  )
}

export default ConstructionSafetyPage
