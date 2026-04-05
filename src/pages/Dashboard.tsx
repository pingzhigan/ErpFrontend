/**
 * 功能名称：仪表盘
 * 实现原理与逻辑：首页概览，通过接口聚合项目数、机会数、配单数、商品数、成本清单数、库存数、日志数及经营汇总；
 * 展示项目汇总卡片（报价/成本/回款/回款进度）和最近操作日志。数据由 /api/dashboard 等接口拉取并渲染。
 */
import {
  BookOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  FolderOutlined,
  HistoryOutlined,
  SafetyCertificateOutlined,
  ShoppingOutlined,
  ThunderboltOutlined,
  DollarOutlined,
} from '@ant-design/icons'
import { Card, Col, Row, Statistic, Typography } from 'antd'
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../auth/AuthContext'
import type { OperationLog } from './Logs'
import styles from './Dashboard.module.css'

const { Title, Text } = Typography

type ProjectSummaryItem = {
  project_name: string
  quotation_total?: number | null
  cost_total?: number | null
  total_received?: number | null
  payment_progress?: number | null
}

type DashboardStats = {
  projectCount: number
  opportunityCount: number
  configOrderCount: number
  productCount: number
  costListCount: number
  inventoryCount: number
  logCount: number
  /** 经营汇总（来自 projects 列表） */
  totalQuotation: number
  totalCost: number
  totalReceived: number
  /** 进行中机会数（非赢单/输单） */
  opportunityActiveCount: number
  recentLogs: OperationLog[]
}

const ACTION_LABELS: Record<string, string> = {
  login: '登录成功',
  login_fail: '登录失败',
  doc_upload: '文档上传',
  doc_parse: '文档解析',
  doc_parse_fail: '文档解析失败',
  products_bulk: '商品批量入库',
  products_overwrite: '商品覆盖入库',
  project_soft_delete: '项目软删除',
  product_create: '商品创建',
  product_update: '商品编辑',
  product_delete: '商品删除',
  products_by_project_delete: '按项目删除商品',
  receivable_update: '回款记录编辑',
  receivable_delete: '回款记录删除',
  attachment_delete: '项目附件删除',
  rule_update: '规则编辑',
  rule_delete: '规则删除',
  knowledge_update: '知识编辑',
  knowledge_delete: '知识删除',
  industry_factor_update: '行业系数编辑',
  industry_factor_delete: '行业系数删除',
  tier_factor_update: '档次系数编辑',
  tier_factor_delete: '档次系数删除',
  equipment_spec_update: '设备规格编辑',
  equipment_spec_delete: '设备规格删除',
  formula_update: '公式编辑',
  formula_delete: '公式删除',
  rule_config_update: '规则配置编辑',
  rule_config_delete: '规则配置删除',
  config_order_update: '配单编辑',
  config_order_delete: '配单删除',
  user_update: '用户编辑',
  user_delete: '用户删除',
  role_group_update: '权限组编辑',
  role_group_delete: '权限组删除',
  cost_item_update: '成本项编辑',
  cost_item_delete: '成本项删除',
  cost_list_by_project_delete: '按项目删除成本清单',
  cost_project_soft_delete: '成本项目软删除',
}

const ACTIVE_STAGES = ['线索', '初步沟通', '需求确认', '方案报价', '商务谈判']

const quickLinkConfig = [
  { path: '/projects', label: '项目列表', desc: '项目与回款、附件', icon: <FolderOutlined />, permission: 'projects', styleKey: 'project' as const },
  { path: '/opportunities', label: '机会管理', desc: '商机阶段与跟进', icon: <ThunderboltOutlined />, permission: 'opportunities', styleKey: 'opportunity' as const },
  { path: '/config-orders', label: '项目配单', desc: '配单与明细', icon: <ShoppingOutlined />, permission: 'config-orders', styleKey: 'config' as const },
  { path: '/cost-list', label: '成本清单', desc: '成本项维护', icon: <DollarOutlined />, permission: 'cost-list', styleKey: 'cost' as const },
  { path: '/products', label: '报价清单', desc: '报价商品维护', icon: <ShoppingOutlined />, permission: 'products', styleKey: 'product' as const },
  { path: '/inventory', label: '库存查询', desc: '库存与出入库', icon: <DatabaseOutlined />, permission: 'inventory', styleKey: 'inventory' as const },
  { path: '/inventory-maintain', label: '库存维护', desc: 'SKU 维护', icon: <DatabaseOutlined />, permission: 'inventory-maintain', styleKey: 'inventory' as const },
  { path: '/docs', label: '项目维护', desc: '文档解析与项目', icon: <FileTextOutlined />, permission: 'docs', styleKey: 'doc' as const },
  { path: '/rules', label: '规则引擎', desc: '规则与公式', icon: <SafetyCertificateOutlined />, permission: 'rules', styleKey: 'rule' as const },
  { path: '/knowledge', label: '知识库', desc: '知识条目', icon: <BookOutlined />, permission: 'knowledge', styleKey: 'knowledge' as const },
  { path: '/logs', label: '日志管理', desc: '操作与访问日志', icon: <HistoryOutlined />, permission: 'logs', styleKey: 'log' as const },
]

const formatMoney = (v: number) =>
  v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toLocaleString('zh-CN', { maximumFractionDigits: 0 })

const DashboardPage: React.FC = () => {
  const { user, hasPermission } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<DashboardStats>({
    projectCount: 0,
    opportunityCount: 0,
    configOrderCount: 0,
    productCount: 0,
    costListCount: 0,
    inventoryCount: 0,
    logCount: 0,
    totalQuotation: 0,
    totalCost: 0,
    totalReceived: 0,
    opportunityActiveCount: 0,
    recentLogs: [],
  })

  const fetchStats = useCallback(async () => {
    setLoading(true)
    const next: DashboardStats = {
      projectCount: 0,
      opportunityCount: 0,
      configOrderCount: 0,
      productCount: 0,
      costListCount: 0,
      inventoryCount: 0,
      logCount: 0,
      totalQuotation: 0,
      totalCost: 0,
      totalReceived: 0,
      opportunityActiveCount: 0,
      recentLogs: [],
    }
    const promises: Promise<void>[] = []

    if (hasPermission('projects')) {
      promises.push(
        axios.get<{ list: ProjectSummaryItem[]; total: number }>('/api/projects').then((res) => {
          const list = res.data.list ?? []
          next.projectCount = res.data.total ?? list.length
          list.forEach((p) => {
            next.totalQuotation += Number(p.quotation_total ?? 0)
            next.totalCost += Number(p.cost_total ?? 0)
            next.totalReceived += Number(p.total_received ?? 0)
          })
        }).catch(() => {})
      )
    }
    if (hasPermission('opportunities')) {
      promises.push(
        axios.get<{ list: { stage: string | null }[]; total: number }>('/api/opportunities').then((res) => {
          const list = res.data.list ?? []
          next.opportunityCount = res.data.total ?? list.length
          next.opportunityActiveCount = list.filter((o) => o.stage && ACTIVE_STAGES.includes(o.stage)).length
        }).catch(() => {})
      )
    }
    if (hasPermission('config-orders')) {
      promises.push(
        axios.get<{ list: unknown[]; total: number }>('/api/config-orders').then((res) => {
          next.configOrderCount = res.data.total ?? res.data.list?.length ?? 0
        }).catch(() => {})
      )
    }
    if (hasPermission('products')) {
      promises.push(
        axios.get<{ list: unknown[]; total: number }>('/api/products', { params: { page_size: 1 } }).then((res) => {
          next.productCount = res.data.total ?? 0
        }).catch(() => {})
      )
    }
    if (hasPermission('cost-list')) {
      promises.push(
        axios.get<{ list: unknown[]; total: number }>('/api/cost-list').then((res) => {
          next.costListCount = res.data.total ?? res.data.list?.length ?? 0
        }).catch(() => {})
      )
    }
    if (hasPermission('inventory')) {
      promises.push(
        axios.get<{ list: unknown[]; total: number }>('/api/inventory').then((res) => {
          next.inventoryCount = res.data.total ?? res.data.list?.length ?? 0
        }).catch(() => {})
      )
    }
    if (hasPermission('logs')) {
      promises.push(
        axios.get<{ list: OperationLog[]; total: number }>('/api/logs', { params: { page: 1, page_size: 5 } }).then((res) => {
          next.logCount = res.data.total ?? 0
          next.recentLogs = res.data.list ?? []
        }).catch(() => {})
      )
    }

    await Promise.all(promises)
    setStats(next)
    setLoading(false)
  }, [hasPermission])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const quickLinks = quickLinkConfig.filter((item) => hasPermission(item.permission))

  return (
    <div className={styles.wrap}>
      <div className={styles.welcomeBanner}>
        <Title level={3} className={styles.welcomeTitle}>
          欢迎{user?.username ? `，${user.username}` : ''}
        </Title>
        <Text className={styles.welcomeDesc}>
          弱电项目管理：商机与项目、配单与报价成本、库存与 AI 助手、规则与日志一览。
        </Text>
      </div>

      {/* 核心统计 */}
      <Title level={5} className={styles.sectionTitle}>
        核心统计
      </Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {hasPermission('projects') && (
          <Col xs={24} sm={12} md={8} lg={6}>
            <Card loading={loading} className={`${styles.statCard} ${styles.statCardProjects}`}>
              <Statistic
                title="项目总数"
                value={stats.projectCount}
                suffix="个"
                valueStyle={{ color: 'var(--stat-project)', fontWeight: 600 }}
              />
            </Card>
          </Col>
        )}
        {hasPermission('opportunities') && (
          <Col xs={24} sm={12} md={8} lg={6}>
            <Card loading={loading} className={`${styles.statCard} ${styles.statCardOpportunities}`}>
              <Statistic
                title="机会总数"
                value={stats.opportunityCount}
                suffix="个"
                valueStyle={{ color: 'var(--stat-opportunity)', fontWeight: 600 }}
              />
              {stats.opportunityActiveCount > 0 && (
                <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                  进行中 {stats.opportunityActiveCount} 个
                </Text>
              )}
            </Card>
          </Col>
        )}
        {hasPermission('config-orders') && (
          <Col xs={24} sm={12} md={8} lg={6}>
            <Card loading={loading} className={`${styles.statCard} ${styles.statCardConfig}`}>
              <Statistic
                title="配单数"
                value={stats.configOrderCount}
                suffix="个"
                valueStyle={{ color: 'var(--stat-config)', fontWeight: 600 }}
              />
            </Card>
          </Col>
        )}
        {hasPermission('products') && (
          <Col xs={24} sm={12} md={8} lg={6}>
            <Card loading={loading} className={`${styles.statCard} ${styles.statCardProducts}`}>
              <Statistic
                title="报价商品数"
                value={stats.productCount}
                suffix="条"
                valueStyle={{ color: 'var(--stat-product)', fontWeight: 600 }}
              />
            </Card>
          </Col>
        )}
        {hasPermission('cost-list') && (
          <Col xs={24} sm={12} md={8} lg={6}>
            <Card loading={loading} className={`${styles.statCard} ${styles.statCardCost}`}>
              <Statistic
                title="成本清单"
                value={stats.costListCount}
                suffix="条"
                valueStyle={{ color: 'var(--stat-cost)', fontWeight: 600 }}
              />
            </Card>
          </Col>
        )}
        {hasPermission('inventory') && (
          <Col xs={24} sm={12} md={8} lg={6}>
            <Card loading={loading} className={`${styles.statCard} ${styles.statCardInventory}`}>
              <Statistic
                title="库存 SKU"
                value={stats.inventoryCount}
                suffix="个"
                valueStyle={{ color: 'var(--stat-inventory)', fontWeight: 600 }}
              />
            </Card>
          </Col>
        )}
        {hasPermission('logs') && (
          <Col xs={24} sm={12} md={8} lg={6}>
            <Card loading={loading} className={`${styles.statCard} ${styles.statCardLogs}`}>
              <Statistic
                title="操作日志"
                value={stats.logCount}
                suffix="条"
                valueStyle={{ color: 'var(--stat-log)', fontWeight: 600 }}
              />
            </Card>
          </Col>
        )}
      </Row>

      {/* 经营概览（有项目权限时展示） */}
      {hasPermission('projects') && (stats.totalQuotation > 0 || stats.totalCost > 0 || stats.totalReceived > 0) && (
        <>
          <Title level={5} className={styles.sectionTitle}>
            经营概览
          </Title>
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={8}>
              <Card loading={loading} size="small" className={styles.overviewCard}>
                <Statistic
                  title="总报价额（含税）"
                  value={stats.totalQuotation}
                  formatter={(v) => formatMoney(Number(v))}
                  valueStyle={{ color: '#1677ff', fontSize: 20 }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card loading={loading} size="small" className={styles.overviewCard}>
                <Statistic
                  title="总成本"
                  value={stats.totalCost}
                  formatter={(v) => formatMoney(Number(v))}
                  valueStyle={{ color: '#fa8c16', fontSize: 20 }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card loading={loading} size="small" className={styles.overviewCard}>
                <Statistic
                  title="已回款"
                  value={stats.totalReceived}
                  formatter={(v) => formatMoney(Number(v))}
                  valueStyle={{ color: '#00b96b', fontSize: 20 }}
                />
                {stats.totalQuotation > 0 && (
                  <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                    回款进度 {Math.min(100, Math.round((stats.totalReceived / stats.totalQuotation) * 1000) / 10)}%
                  </Text>
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* 快捷入口 */}
      <Title level={5} className={styles.sectionTitle}>
        快捷入口
      </Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {quickLinks.map((item) => (
          <Col xs={24} sm={12} md={8} lg={6} key={item.path}>
            <Card
              hoverable
              onClick={() => navigate(item.path)}
              className={`${styles.quickLinkCard} ${styles[`quickLinkCard_${item.styleKey}`]}`}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <span className={`${styles.iconWrap} ${styles[`iconWrap_${item.styleKey}`]}`}>
                  {item.icon}
                </span>
                <div>
                  <div className={styles.quickLinkLabel}>{item.label}</div>
                  <div className={styles.quickLinkDesc}>{item.desc}</div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 最近操作 */}
      {hasPermission('logs') && (
        <>
          <Title level={5} className={styles.sectionTitle}>
            最近操作
          </Title>
          <Card loading={loading} size="small" className={styles.recentCard}>
            {stats.recentLogs.length === 0 ? (
              <Text type="secondary">暂无最近操作记录</Text>
            ) : (
              <ul className={styles.recentList}>
                {stats.recentLogs.map((log) => (
                  <li key={log.id} className={styles.recentItem}>
                    <span className={styles.recentTime}>
                      {log.created_at ? log.created_at.slice(0, 19).replace('T', ' ') : '—'}
                    </span>
                    {' · '}
                    <span className={styles.recentUser}>{log.username ?? '—'}</span>
                    {' · '}
                    <span className={styles.recentAction}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                    {log.detail ? `（${log.detail}）` : ''}
                  </li>
                ))}
              </ul>
            )}
            {stats.logCount > 0 && (
              <Typography.Link className={styles.viewAllLink} onClick={() => navigate('/logs')}>
                查看全部日志 →
              </Typography.Link>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

export default DashboardPage
