import React, { useState } from 'react'
import { Badge, Card, Descriptions, Modal, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'

const { Title } = Typography

interface QualityRecord {
  id: number
  project: string
  checkDate: string
  checkItem: string
  inspector: string
  result: string
  score: number
  issues: string
}

const RESULT_MAP: Record<string, { color: string; label: string }> = {
  pass: { color: 'success', label: '合格' },
  warning: { color: 'warning', label: '整改' },
  fail: { color: 'error', label: '不合格' },
}

const MOCK_DATA: QualityRecord[] = [
  {
    id: 1,
    project: '某科技园区弱电系统工程',
    checkDate: '2026-03-05',
    checkItem: '线缆敷设工艺检查',
    inspector: '质检员A',
    result: 'pass',
    score: 95,
    issues: '无',
  },
  {
    id: 2,
    project: '某科技园区弱电系统工程',
    checkDate: '2026-03-06',
    checkItem: '桥架安装质量检查',
    inspector: '质检员B',
    result: 'warning',
    score: 78,
    issues: '部分桥架连接螺栓未拧紧，需整改',
  },
  {
    id: 3,
    project: '办公楼智能化改造',
    checkDate: '2026-03-07',
    checkItem: '隐蔽工程验收',
    inspector: '质检员A',
    result: 'pass',
    score: 92,
    issues: '无',
  },
  {
    id: 4,
    project: '办公楼智能化改造',
    checkDate: '2026-03-08',
    checkItem: '接地电阻测试',
    inspector: '质检员C',
    result: 'fail',
    score: 55,
    issues: '接地电阻值超出规范要求，需重新处理接地体',
  },
]

const ConstructionQualityPage: React.FC = () => {
  const [data] = useState<QualityRecord[]>(MOCK_DATA)
  const [detailOpen, setDetailOpen] = useState(false)
  const [current, setCurrent] = useState<QualityRecord | null>(null)

  const columns: ColumnsType<QualityRecord> = [
    { title: '检查日期', dataIndex: 'checkDate', width: 120 },
    { title: '所属项目', dataIndex: 'project', width: 240 },
    { title: '检查项目', dataIndex: 'checkItem', width: 200 },
    { title: '检查人', dataIndex: 'inspector', width: 100 },
    {
      title: '得分',
      dataIndex: 'score',
      width: 80,
      sorter: (a, b) => a.score - b.score,
      render: (v: number) => (
        <span style={{ fontWeight: 600, color: v >= 90 ? 'var(--ant-colorSuccess)' : v >= 70 ? 'var(--ant-colorWarning)' : 'var(--ant-colorError)' }}>
          {v}
        </span>
      ),
    },
    {
      title: '结果',
      dataIndex: 'result',
      width: 100,
      filters: Object.entries(RESULT_MAP).map(([k, v]) => ({ text: v.label, value: k })),
      onFilter: (val, record) => record.result === val,
      render: (v: string) => {
        const s = RESULT_MAP[v] ?? { color: 'default', label: v }
        return <Tag color={s.color}>{s.label}</Tag>
      },
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, r: QualityRecord) => (
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

  const passRate = data.length
    ? Math.round((data.filter((d) => d.result === 'pass').length / data.length) * 100)
    : 0

  return (
    <Card>
      <Title level={5} style={{ marginBottom: 16 }}>
        质量管理
      </Title>

      <Space size="large" style={{ marginBottom: 20 }}>
        <Card size="small" style={{ minWidth: 120, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--ant-colorPrimary)' }}>
            {data.length}
          </div>
          <div style={{ color: 'var(--ant-colorTextSecondary)', fontSize: 12 }}>检查总数</div>
        </Card>
        <Card size="small" style={{ minWidth: 120, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--ant-colorSuccess)' }}>
            {passRate}%
          </div>
          <div style={{ color: 'var(--ant-colorTextSecondary)', fontSize: 12 }}>合格率</div>
        </Card>
        <Card size="small" style={{ minWidth: 120, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--ant-colorError)' }}>
            {data.filter((d) => d.result === 'fail').length}
          </div>
          <div style={{ color: 'var(--ant-colorTextSecondary)', fontSize: 12 }}>不合格项</div>
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
        title="质量检查详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={600}
      >
        {current && (
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="检查日期">{current.checkDate}</Descriptions.Item>
            <Descriptions.Item label="所属项目">{current.project}</Descriptions.Item>
            <Descriptions.Item label="检查项目">{current.checkItem}</Descriptions.Item>
            <Descriptions.Item label="检查人">{current.inspector}</Descriptions.Item>
            <Descriptions.Item label="得分">{current.score}</Descriptions.Item>
            <Descriptions.Item label="结果">
              <Tag color={RESULT_MAP[current.result]?.color}>
                {RESULT_MAP[current.result]?.label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="问题描述" span={2}>
              {current.issues}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </Card>
  )
}

export default ConstructionQualityPage
