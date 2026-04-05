/**
 * 功能名称：规则配置
 * 实现原理与逻辑：管理规则引擎的键值配置项（config_key）；列表展示配置键、描述、启用状态，支持种子导入、查看配置值详情（JSON）、
 * 删除配置。用于存储规则/公式等依赖的全局或业务配置，与规则、公式等模块配合使用。数据来自 /api/rule-config。
 */
import { DeleteOutlined, EditOutlined, ReloadOutlined, CloudUploadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { App, Badge, Button, Card, Modal, Popconfirm, Space, Table, Typography } from 'antd'
import axios from 'axios'
import React, { useCallback, useEffect, useState } from 'react'

const { Title, Text } = Typography

type RuleConfigItem = {
  id: number
  config_key: string
  description: string | null
  enabled: number
  created_at: string
  updated_at: string
}

const RuleConfigPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const [list, setList] = useState<RuleConfigItem[]>([])
  const [loading, setLoading] = useState(false)
  const [seedLoading, setSeedLoading] = useState(false)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const [detailJson, setDetailJson] = useState<string>('')
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get<{ list: RuleConfigItem[]; total: number }>('/api/rule-config')
      setList(res.data.list || [])
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [msg])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const handleSeed = async () => {
    setSeedLoading(true)
    try {
      await axios.post('/api/rule-config/seed')
      msg.success('种子导入成功')
      fetchList()
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '导入失败')
    } finally {
      setSeedLoading(false)
    }
  }

  const openDetail = async (key: string) => {
    setDetailKey(key)
    setDetailModalOpen(true)
    setDetailJson('')
    setDetailLoading(true)
    try {
      const res = await axios.get<{ config_value: string; config_value_parsed?: unknown }>(`/api/rule-config/${encodeURIComponent(key)}`)
      const val = res.data.config_value_parsed ?? res.data.config_value
      setDetailJson(typeof val === 'string' ? val : JSON.stringify(val, null, 2))
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '获取详情失败')
      setDetailJson('')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleDelete = async (key: string) => {
    try {
      await axios.delete(`/api/rule-config/${encodeURIComponent(key)}`)
      msg.success('已删除')
      fetchList()
      if (detailKey === key) setDetailModalOpen(false)
    } catch (e: unknown) {
      msg.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败')
    }
  }

  const columns: ColumnsType<RuleConfigItem> = [
    { title: '配置键', dataIndex: 'config_key', width: 200, ellipsis: true },
    { title: '说明', dataIndex: 'description', ellipsis: true, render: (v) => v || '—' },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      render: (v: number) => (v === 1 ? <Badge status="success" text="启用" /> : <Badge status="default" text="停用" />),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 172,
      render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_, row) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openDetail(row.config_key)}>
            查看
          </Button>
          <Popconfirm
            title="确定删除该条配置？"
            onConfirm={() => handleDelete(row.config_key)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Title level={4} style={{ marginBottom: 0 }}>
        规则配置
      </Title>
      <Text type="secondary">
        按域存储的 JSON 配置（如 global_rules、video_surveillance、structured_cabling 等），供公式引擎与配单逻辑使用。首次使用可点击「导入种子」加载内置规则。
      </Text>
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<CloudUploadOutlined />} loading={seedLoading} onClick={handleSeed}>
            导入种子
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchList}>
            刷新
          </Button>
        </Space>
        <Table<RuleConfigItem>
          rowKey="config_key"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={list}
          pagination={{ total: list.length, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>

      <Modal
        title={detailKey ? `配置：${detailKey}` : '配置详情'}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={detailKey ? (
          <Popconfirm title="确定删除该条配置？" onConfirm={() => detailKey && handleDelete(detailKey)} okText="删除" cancelText="取消">
            <Button danger>删除</Button>
          </Popconfirm>
        ) : null}
        width={720}
        destroyOnHidden
      >
        {detailLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>加载中...</div>
        ) : (
          <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, maxHeight: 480, overflow: 'auto', fontSize: 12 }}>
            {detailJson || '无内容'}
          </pre>
        )}
      </Modal>
    </Space>
  )
}

export default RuleConfigPage
