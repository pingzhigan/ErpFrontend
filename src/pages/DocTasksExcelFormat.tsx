/**
 * 功能名称：项目维护 - 智能格式化（新）
 * 对接后端 /api/excel-format/parse、/api/excel-format/confirm，实现：上传 Excel → 自动识别表头与映射 → 用户确认/修改映射 → 输出标准结构 → 入库。
 * 复制自项目维护流程，不修改原有 DocTasks 功能。
 */
import {
  FileTextOutlined,
  UploadOutlined,
  SaveOutlined,
  DownloadOutlined,
  CheckOutlined,
  PlusOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  App,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Segmented,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import type { UploadFile } from 'antd'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../auth/AuthContext'
import { useReauthModal } from '../hooks/useReauthModal'

type SheetItem = { name: string; index: number; hasData: boolean }

/** 智能格式化：每批最多解析的 Sheet 数；多批时从第 2 批起合并到已有结果 */
const SHEETS_PER_PARSE = 5

const { Title, Text } = Typography

/** 行类型中文标签（与后端一致） */
const ROW_TYPE_LABELS: Record<string, string> = {
  EMPTY_ROW: '空行',
  SEPARATOR_ROW: '分隔行',
  META_INFO: '元信息行',
  NOTE_ROW: '说明行',
  SECTION_ROW: '章节行',
  TITLE_BLOCK: '标题块',
  FOOTER_BLOCK: '尾部块',
  UNIT_ROW: '单位行',
  SUMMARY_ROW: '汇总行',
  HEADER_CANDIDATE: '表头候选',
  DATA_ROW: '数据行',
}

/** 与后端 ColumnMappingItem 一致 */
export type ColumnMappingItem = {
  colIndex: number
  originalHeader: string
  standardKey: string | null
  source: 'rule' | 'vector' | 'fuzzy' | 'llm' | 'none'
}

/** 数据清洗：待删除行（与后端 RowToRemove 一致） */
export type RowToRemoveItem = { rowIndex: number; type: string; cells: string[] }

/** 数据清洗预览（用户确认是否删除后再继续） */
export type FilterPreview = {
  logs: string[]
  removedCount: number
  rolledBack: boolean
  summaryRowsCount: number
  rowsToRemove: RowToRemoveItem[]
}

/** 标准列 key 与中文标题（与后端 excelFormatCore STANDARD_LABELS 一致） */
const STANDARD_KEYS = [
  'sequence_no',
  'goods_name',
  'brand',
  'model',
  'params',
  'unit',
  'quantity',
  'unit_price_excl_tax',
  'unit_price_incl_tax',
  'amount_excl_tax',
  'amount_incl_tax',
  'tax_rate',
  'remark',
] as const

const COLUMN_TITLES: Record<string, string> = {
  sequence_no: '序号',
  goods_name: '货物名称',
  brand: '品牌',
  model: '型号',
  params: '参数',
  unit: '单位',
  quantity: '数量',
  unit_price_excl_tax: '不含税单价',
  unit_price_incl_tax: '单价(含税)',
  amount_excl_tax: '不含税金额',
  amount_incl_tax: '金额(含税)',
  tax_rate: '税率',
  remark: '备注',
}

/** 表头规范化（与后端 formTemplates 一致，用于规则去重判断） */
function normalizeHeaderForRule(h: string): string {
  return (h || '').trim().replace(/\s+/g, ' ')
}

/** 文件名去后缀（与项目维护一致） */
function fileNameWithoutExt(name: string): string {
  return (name || '').replace(/\.[^.]+$/, '')
}

/** 根据文件名判断是否为成本清单（含“成本”等视为成本） */
function detectListTypeFromFileName(fileName: string): 'cost' | 'quote' {
  if (!fileName || typeof fileName !== 'string') return 'quote'
  const lower = fileName.replace(/\.[^.]+$/, '').toLowerCase()
  if (/成本/.test(lower) || /成本清单/.test(lower) || /成本表/.test(lower)) return 'cost'
  return 'quote'
}

/** 数值型列，用 InputNumber 编辑（与项目维护商品列表一致） */
const NUMERIC_KEYS = new Set<string>([
  'sequence_no',
  'quantity',
  'unit_price_excl_tax',
  'unit_price_incl_tax',
  'amount_excl_tax',
  'amount_incl_tax',
  'tax_rate',
])

/** 表头必填项：货物名称、数量、单价（含税/不含税二选一）、关联项目 */
const REQUIRED_HEADER_KEYS = new Set<string>(['goods_name', 'quantity', 'unit_price_excl_tax', 'unit_price_incl_tax', 'project_name'])

/** 含税/不含税单价二选一说明（用于表头 Tooltip） */
const PRICE_EITHER_TIP = '含税与不含税单价二选一，至少填一项即可；若两项都填则以不含税为准，自动计算含税单价。'

/** 入库前 normalize：税率为空按 0%（与原有逻辑一致） */
function calcInclFromExclSave(excl: number, taxRateNumber: number): number {
  const t = taxRateNumber ?? 0
  const rate = t <= 1 ? 1 + t : 1 + t / 100
  return Math.round(excl * rate * 100) / 100
}

/** 预览表格：税率为空按 13%（与 resolveRowAmounts 默认一致）；支持 0.13 或 13 */
const PREVIEW_DEFAULT_TAX_PERCENT = 13

/** 预览税率：支持小数形式（如 0.13）或百分数（如 13）；预览列统一为百分数 0–100 */
function getPreviewTaxMultiplier(taxRaw: unknown): number {
  const t = taxRaw != null && taxRaw !== '' ? Number(taxRaw) : PREVIEW_DEFAULT_TAX_PERCENT
  if (!Number.isFinite(t)) return 1 + PREVIEW_DEFAULT_TAX_PERCENT / 100
  if (t > 1) return 1 + t / 100
  if (t === 1) return 1 + 1 / 100
  if (t > 0 && t < 1) return 1 + t
  return 1 + t
}

/** 将解析结果中的税率转为预览列可编辑的百分数（空→13；0.13→13） */
function normalizeTaxRateForPreviewCell(taxRaw: unknown): number {
  if (taxRaw == null || taxRaw === '') return PREVIEW_DEFAULT_TAX_PERCENT
  const t = Number(taxRaw)
  if (!Number.isFinite(t)) return PREVIEW_DEFAULT_TAX_PERCENT
  if (t > 0 && t < 1) return Math.round(t * 10000) / 100
  return t
}

/** 解析/加载后立即：默认税率、补齐含税单价与含税/不含税金额（与手动编辑逻辑一致） */
function enrichPreviewRow(row: ReviewRow): ReviewRow {
  const taxNorm = normalizeTaxRateForPreviewCell(row.tax_rate)
  const withTax = mergePreviewRow(row, { tax_rate: taxNorm })
  const derived = computePreviewDerivedPatch(withTax)
  return mergePreviewRow(withTax, derived)
}

function enrichPreviewRows(rows: ReviewRow[]): ReviewRow[] {
  return rows.map((r) => enrichPreviewRow(r))
}

function calcInclFromExclPreview(excl: number, taxRaw: unknown): number {
  return Math.round(excl * getPreviewTaxMultiplier(taxRaw) * 100) / 100
}

function calcExclFromInclPreview(incl: number, taxRaw: unknown): number {
  return Math.round((incl / getPreviewTaxMultiplier(taxRaw)) * 100) / 100
}

const UNIT_PRICE_CONFLICT_TOL = 0.02

function isFiniteNumberCell(v: unknown): boolean {
  if (v == null || v === '') return false
  return Number.isFinite(Number(v))
}

function mergePreviewRow(row: ReviewRow, patch: Record<string, unknown>): ReviewRow {
  return { ...row, ...patch }
}

function detectUnitPriceConflict(row: ReviewRow): {
  conflict: boolean
  excl?: number
  incl?: number
  expectedIncl?: number
} {
  if (!isFiniteNumberCell(row.unit_price_excl_tax) || !isFiniteNumberCell(row.unit_price_incl_tax)) {
    return { conflict: false }
  }
  const excl = Number(row.unit_price_excl_tax)
  const incl = Number(row.unit_price_incl_tax)
  const expectedIncl = calcInclFromExclPreview(excl, row.tax_rate)
  if (Math.abs(incl - expectedIncl) > UNIT_PRICE_CONFLICT_TOL) {
    return { conflict: true, excl, incl, expectedIncl }
  }
  return { conflict: false }
}

/** 在至少有一种单价时，补齐另一单价与两行金额（无单价时不改金额字段） */
function computePreviewDerivedPatch(row: ReviewRow): Record<string, unknown> {
  const hasExcl = isFiniteNumberCell(row.unit_price_excl_tax)
  const hasIncl = isFiniteNumberCell(row.unit_price_incl_tax)
  if (!hasExcl && !hasIncl) return {}

  let excl: number | null = hasExcl ? Number(row.unit_price_excl_tax) : null
  let incl: number | null = hasIncl ? Number(row.unit_price_incl_tax) : null

  if (hasExcl && !hasIncl) incl = calcInclFromExclPreview(excl!, row.tax_rate)
  else if (!hasExcl && hasIncl) excl = calcExclFromInclPreview(incl!, row.tax_rate)

  const qty = row.quantity != null && row.quantity !== '' ? Number(row.quantity) : null
  const qOk = qty != null && Number.isFinite(qty)

  const out: Record<string, unknown> = {
    unit_price_excl_tax: excl,
    unit_price_incl_tax: incl,
  }
  if (qOk && excl != null && incl != null) {
    out.amount_excl_tax = Math.round(qty! * excl * 100) / 100
    out.amount_incl_tax = Math.round(qty! * incl * 100) / 100
  } else {
    out.amount_excl_tax = null
    out.amount_incl_tax = null
  }
  return out
}

function findFirstUnitPriceConflict(
  rowsBySheet: Record<string, ReviewRow[]>,
): { sheetName: string; rowIndex: number; row: ReviewRow } | null {
  for (const sheetName of Object.keys(rowsBySheet)) {
    const rows = rowsBySheet[sheetName]
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (detectUnitPriceConflict(row).conflict) {
        return { sheetName, rowIndex: i, row: { ...row } }
      }
    }
  }
  return null
}

/** 表头文案：必填列追加红色星号；单价两列追加二选一说明 Tooltip（用 span 包裹避免 Table 传 ref 到 Fragment 报错） */
function tableHeaderTitle(label: string, key: string): React.ReactNode {
  const isRequired = REQUIRED_HEADER_KEYS.has(key)
  const isPriceEither = key === 'unit_price_excl_tax' || key === 'unit_price_incl_tax'
  const content = (
    <span>
      {label}
      {isRequired && <span style={{ color: '#ff4d4f', marginLeft: 2 }}>*</span>}
    </span>
  )
  if (isPriceEither) {
    return <Tooltip title={PRICE_EITHER_TIP}>{content}</Tooltip>
  }
  if (key === 'tax_rate') {
    return <Tooltip title="填写百分数，如 13 表示 13%（与常见 Excel 税率列一致）">{content}</Tooltip>
  }
  return content
}

/** 审阅行（与 DocTasks DocReviewItem 兼容，用于表格与入库） */
type ReviewRow = Record<string, unknown> & { _key?: string }

/** 存入数据库目标选择弹窗：内部维护选项状态，切换成本/报价时仅弹窗重渲染，避免整页卡顿 */
const SaveTargetModal: React.FC<{
  open: boolean
  onCancel: () => void
  rowsCount: number
  defaultChoice: 'cost' | 'quote'
  onConfirm: (choice: 'cost' | 'quote') => void
  saveLoading: boolean
}> = ({ open, onCancel, rowsCount, defaultChoice, onConfirm, saveLoading }) => {
  const [choice, setChoice] = React.useState<'cost' | 'quote'>(defaultChoice)
  React.useEffect(() => {
    if (open) setChoice(defaultChoice)
  }, [open, defaultChoice])
  return (
    <Modal title="选择保存目标" open={open} onCancel={onCancel} footer={null} destroyOnHidden>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        请选择将当前 {rowsCount} 条数据存入「成本清单」或「报价清单」。系统已根据文件名识别为{choice === 'cost' ? '成本清单' : '报价清单'}，您可修改选择。
      </Typography.Paragraph>
      <Space size="middle">
        <Tooltip title="将当前数据写入项目成本清单，用于成本核算与统计。">
          <Button type={choice === 'cost' ? 'primary' : 'default'} onClick={() => setChoice('cost')}>
            存入成本清单
          </Button>
        </Tooltip>
        <Tooltip title="将当前数据写入项目报价清单，用于报价与合同。">
          <Button type={choice === 'quote' ? 'primary' : 'default'} onClick={() => setChoice('quote')}>
            存入报价清单
          </Button>
        </Tooltip>
      </Space>
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onCancel}>取消</Button>
        <Tooltip title="按当前选择将数据写入成本或报价清单。">
          <span>
            <Button type="primary" loading={saveLoading} onClick={() => onConfirm(choice)}>
              确定存入
            </Button>
          </span>
        </Tooltip>
      </div>
    </Modal>
  )
}

/** 汇总金额展示（模块级稳定引用，避免子组件 memo 因内联函数失效） */
function formatPreviewMoneyDisplay(n: number) {
  return Number.isFinite(n) ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
}

type PreviewPatchOps = {
  setPreviewRow: (sheetName: string, rowIndex: number, field: string, value: unknown) => void
  patchPreviewRow: (sheetName: string, rowIndex: number, patch: Record<string, unknown>) => void
  removePreviewRow: (sheetName: string, rowIndex: number) => void
  handleNumericPreviewField: (
    sheetName: string,
    rowIndex: number,
    key: string,
    value: number | null,
    row: ReviewRow,
  ) => void
}

function buildPreviewTableColumns(sheetName: string, ops: PreviewPatchOps): ColumnsType<ReviewRow> {
  const { setPreviewRow, removePreviewRow, handleNumericPreviewField } = ops
  return [
    ...STANDARD_KEYS.map((key) => {
      const label = COLUMN_TITLES[key] ?? key
      const title = tableHeaderTitle(label, key)
      const width = key === 'goods_name' || key === 'params' ? 160 : key === 'remark' ? 100 : key === 'sequence_no' || key === 'unit' ? 72 : 96
      if (NUMERIC_KEYS.has(key)) {
        return {
          title,
          dataIndex: key,
          key,
          width,
          render: (val: unknown, row: ReviewRow, index: number) => (
            <InputNumber
              size="small"
              style={{ width: '100%' }}
              min={key === 'tax_rate' ? 0 : undefined}
              max={key === 'tax_rate' ? 100 : undefined}
              step={key === 'tax_rate' ? 0.01 : undefined}
              value={val != null && val !== '' ? Number(val) : undefined}
              onChange={(v) => handleNumericPreviewField(sheetName, index, key, v ?? null, row)}
            />
          ),
        }
      }
      return {
        title,
        dataIndex: key,
        key,
        width,
        render: (val: unknown, _: ReviewRow, index: number) => (
          <Input
            size="small"
            value={val != null ? String(val) : ''}
            onChange={(e) => setPreviewRow(sheetName, index, key, e.target.value || null)}
            placeholder={key === 'goods_name' ? '必填' : undefined}
          />
        ),
      }
    }),
    {
      title: tableHeaderTitle('关联项目', 'project_name'),
      dataIndex: 'project_name',
      key: 'project_name',
      width: 120,
      render: (val: unknown, _: ReviewRow, index: number) => (
        <Input
          size="small"
          value={val != null ? String(val) : ''}
          onChange={(e) => setPreviewRow(sheetName, index, 'project_name', e.target.value || null)}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, __: ReviewRow, index: number) => (
        <Tooltip title="删除该行数据，仅影响预览与入库，不修改原 Excel。">
          <span>
            <Popconfirm title="确定删除该行？" onConfirm={() => removePreviewRow(sheetName, index)} okText="删除" cancelText="取消">
              <Button type="link" danger size="small" icon={<DeleteOutlined />} />
            </Popconfirm>
          </span>
        </Tooltip>
      ),
    },
  ]
}

const PREVIEW_AMOUNT_EXCL_IDX = STANDARD_KEYS.indexOf('amount_excl_tax')
const PREVIEW_AMOUNT_INCL_IDX = STANDARD_KEYS.indexOf('amount_incl_tax')
const PREVIEW_SUMMARY_COLS = STANDARD_KEYS.length + 2

type PreviewSheetTableProps = {
  sheetName: string
  rawRows: ReviewRow[]
  columns: ColumnsType<ReviewRow>
  totals: { sumExcl: number; sumIncl: number }
  /** 稳定引用（useCallback），由子组件内调用 addPreviewRow(sheetName)，避免父级传入内联 onAddRow 破坏 memo */
  addPreviewRow: (sheetName: string) => void
}

/** 单 Sheet 预览表：memo + 虚拟滚动，避免其它 Tab / 父级状态更新时整表重绘 */
const PreviewSheetTable = React.memo(function PreviewSheetTable({
  sheetName,
  rawRows,
  columns,
  totals,
  addPreviewRow,
}: PreviewSheetTableProps) {
  const dataSource = useMemo(
    () =>
      rawRows.map((r, i) =>
        r._key != null && String(r._key) !== '' ? r : { ...r, _key: `${sheetName}-${i}` },
      ),
    [rawRows, sheetName],
  )

  const summaryRow = useMemo(
    () => (
      <Table.Summary fixed>
        <Table.Summary.Row>
          {Array.from({ length: PREVIEW_SUMMARY_COLS }, (_, i) => (
            <Table.Summary.Cell key={i} index={i}>
              {i === 0
                ? '合计'
                : i === PREVIEW_AMOUNT_EXCL_IDX
                  ? formatPreviewMoneyDisplay(totals.sumExcl)
                  : i === PREVIEW_AMOUNT_INCL_IDX
                    ? formatPreviewMoneyDisplay(totals.sumIncl)
                    : ''}
            </Table.Summary.Cell>
          ))}
        </Table.Summary.Row>
      </Table.Summary>
    ),
    [totals.sumExcl, totals.sumIncl],
  )

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Tooltip title="在当前 Sheet 的预览表格末尾添加一行空数据，可手动填写。">
          <Button type="primary" ghost size="small" icon={<PlusOutlined />} onClick={() => addPreviewRow(sheetName)}>
            新增一行
          </Button>
        </Tooltip>
        {rawRows.length > 0 && (
          <Tooltip title="根据当前表格数据（数量×单价或已有金额）前端计算汇总，供您核对是否与预期一致。">
            <Text type="secondary">
              本表汇总：不含税 <Text strong>{formatPreviewMoneyDisplay(totals.sumExcl)}</Text> 元，含税{' '}
              <Text strong>{formatPreviewMoneyDisplay(totals.sumIncl)}</Text> 元
            </Text>
          </Tooltip>
        )}
      </div>
      <div style={{ minHeight: 420 }}>
        <Table<ReviewRow>
          virtual
          size="small"
          dataSource={dataSource}
          rowKey="_key"
          columns={columns}
          scroll={{ x: 1400, y: 420 }}
          pagination={false}
          summary={() => summaryRow}
        />
      </div>
    </div>
  )
})

const DocTasksExcelFormatPage: React.FC = () => {
  const { message: msg } = App.useApp()
  const { user } = useAuth()
  const { askReauth, reauthModal } = useReauthModal()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  /** 多 sheet：当前文件的 sheet 列表（选择文件后请求 /api/docs/excel-sheets 得到） */
  const [sheetList, setSheetList] = useState<SheetItem[]>([])
  /** 多 sheet：选中的 sheet 索引列表，解析时逐个传给后端 */
  const [selectedSheetIndices, setSelectedSheetIndices] = useState<number[]>([])
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [parseLoading, setParseLoading] = useState(false)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [downloadLoading] = useState(false)

  /** 单条解析结果（一个 sheet 对应一条） */
  type ParseResultItem = {
    sheetName: string
    sheetIndex: number
    headerRowIndex: number
    numHeaderRows: number
    flatHeaders: string[]
    mapping: ColumnMappingItem[]
    dataRows: string[][]
    standardRows: Record<string, unknown>[]
    fileName?: string
  }

  /** 解析结果列表，多 sheet 时每项对应一个 sheet */
  const [parseResults, setParseResults] = useState<ParseResultItem[]>([])

  /** 每个 sheet 确认后的标准行，key 为 sheetName */
  const [finalRowsBySheet, setFinalRowsBySheet] = useState<Record<string, ReviewRow[]>>({})
  /** 预览区当前选中的 sheet（Tab 的 key） */
  const [activePreviewTab, setActivePreviewTab] = useState<string>('')
  /** 映射区当前选中的 sheet */
  const [activeMappingTab, setActiveMappingTab] = useState<string>('')
  /** 是否至少有一个 sheet 已确认映射并生成预览（有 finalRows 才可入库） */
  const hasConfirmed = useMemo(
    () => Object.values(finalRowsBySheet).some((rows) => (rows?.length ?? 0) > 0),
    [finalRowsBySheet],
  )
  /** 关联项目名（批量填充与入库用） */
  const [projectName, setProjectName] = useState('')
  /** 入库/下载范围：选中的 Sheet（多选），各行保留 sheet_name；默认随解析结果同步为全部已解析 Sheet */
  const [saveSheetNames, setSaveSheetNames] = useState<string[]>([])
  /** 覆盖确认弹窗 */
  const [overwriteModalOpen, setOverwriteModalOpen] = useState(false)
  const [overwriteProjectName, setOverwriteProjectName] = useState('')
  /** 关联项目名称确认弹窗：文件选中后立即弹出，默认文件名去后缀，并加载已有项目列表 */
  const [projectNameModalOpen, setProjectNameModalOpen] = useState(false)
  const [projectNameModalValue, setProjectNameModalValue] = useState('')
  const [existingProjectNames, setExistingProjectNames] = useState<string[]>([])
  const [existingProjectNamesLoading, setExistingProjectNamesLoading] = useState(false)
  /** 存入数据库二次确认弹窗 */
  const [saveTargetModalOpen, setSaveTargetModalOpen] = useState(false)
  /** 预览展示：表格 / 数据结构预览（与项目维护一致） */
  const [displayMode, setDisplayMode] = useState<'table' | 'json'>('table')
  /** 已保存文件弹窗 */
  const [filesModalOpen, setFilesModalOpen] = useState(false)
  const [exportedFilesList, setExportedFilesList] = useState<{ filename: string; project_name: string; list_type: 'cost' | 'quote'; saved_at: string; item_count: number; size: number }[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [viewFileContent, setViewFileContent] = useState<string | null>(null)
  const [viewFileName, setViewFileName] = useState('')
  /** 另存为文件弹窗 */
  const [saveAsModalOpen, setSaveAsModalOpen] = useState(false)
  const [saveAsFilename, setSaveAsFilename] = useState('')
  /** 覆盖更新目标文件 */
  const [updateTargetFilename, setUpdateTargetFilename] = useState<string | null>(null)
  const [updateTargetListType, setUpdateTargetListType] = useState<'cost' | 'quote'>('quote')
  /** 本会话已加入规则的表头（规范化），用于禁止重复加入 */
  const [addedRuleHeaders, setAddedRuleHeaders] = useState<Set<string>>(new Set())
  /** 后端已有规则的表头（规范化），解析后有映射时拉取一次 */
  const [existingRuleHeaders, setExistingRuleHeaders] = useState<Set<string>>(new Set())
  /** 在「已选 Sheet」升序下的解析游标：0 表示下一批从第 1 个开始，每批最多 5 个 */
  const [sheetParseOffset, setSheetParseOffset] = useState(0)

  /** 数据清洗预览：上传后先返回待删行，用户按 Sheet / 按行确认后再继续 */
  const [filterPreviewState, setFilterPreviewState] = useState<{
    file: File
    sheetIndices: number[]
    /** 本批清洗确认完成后写入的 sheetParseOffset（= 本批起始 offset + 本批 sheet 数） */
    sheetParseOffsetAfterBatch: number
    /** 是否与此前已解析的 Sheet 结果合并（非首批） */
    mergeFilterResultsIntoExisting: boolean
    bySheet: {
      sheetIndex: number
      sheetName: string
      filterPreview: FilterPreview
      /** 本 Sheet 用户选择：删除勾选行 / 保留全部；null 表示未选 */
      confirmChoice: 'delete' | 'keep' | null
      /** 用户勾选要删除的行号（仅当 confirmChoice==='delete' 时有效），默认全选 rowsToRemove */
      selectedRowIndices: number[]
    }[]
  } | null>(null)
  /** 二次过滤：货物名称为空的行，弹窗用户确认后删除 */
  const [emptyGoodsNameConfirm, setEmptyGoodsNameConfirm] = useState<{
    bySheet: { sheetName: string; fullRows: ReviewRow[]; indicesToRemove: number[] }[]
  } | null>(null)
  /** 预览表：含税/不含税单价与税率不一致时，待用户选择以哪侧为准 */
  const [unitPriceConflict, setUnitPriceConflict] = useState<{
    sheetName: string
    rowIndex: number
    row: ReviewRow
  } | null>(null)
  const conflictResolveNextRef = useRef(false)

  const token = user?.token
  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token])

  /** 已选 Sheet 排序后的稳定键：变更时下一批从第 1 个 Sheet 重新计数 */
  const selectedSheetIndicesKey = useMemo(
    () =>
      [...selectedSheetIndices]
        .sort((a, b) => a - b)
        .join(','),
    [selectedSheetIndices],
  )
  useEffect(() => {
    setSheetParseOffset(0)
  }, [selectedSheetIndicesKey])


  /** 返回货物名称为空的行索引（用于二次过滤确认） */
  const getEmptyGoodsNameIndices = useCallback((rows: ReviewRow[]): number[] => {
    return rows
      .map((r, i) => (r.goods_name == null || String(r.goods_name).trim() === '' ? i : -1))
      .filter((i) => i >= 0)
  }, [])

  /** 数据清洗：设置某 Sheet 的确认方式（本 Sheet 确认删除 / 本 Sheet 保留全部） */
  const setSheetFilterChoice = useCallback((sheetName: string, choice: 'delete' | 'keep') => {
    setFilterPreviewState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        bySheet: prev.bySheet.map((s) =>
          s.sheetName === sheetName
            ? {
                ...s,
                confirmChoice: choice,
                selectedRowIndices: choice === 'delete' ? s.filterPreview.rowsToRemove.map((r) => r.rowIndex) : [],
              }
            : s,
        ),
      }
    })
  }, [])

  /** 数据清洗：切换某 Sheet 下某行的勾选（勾选=删除该行） */
  const toggleSheetRowSelected = useCallback((sheetName: string, rowIndex: number) => {
    setFilterPreviewState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        bySheet: prev.bySheet.map((s) => {
          if (s.sheetName !== sheetName) return s
          const set = new Set(s.selectedRowIndices)
          if (set.has(rowIndex)) set.delete(rowIndex)
          else set.add(rowIndex)
          return { ...s, selectedRowIndices: [...set].sort((a, b) => a - b) }
        }),
      }
    })
  }, [])

  /** 数据清洗：某 Sheet 全选/取消全选待删行 */
  const setSheetSelectAllRows = useCallback((sheetName: string, selected: boolean) => {
    setFilterPreviewState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        bySheet: prev.bySheet.map((s) => {
          if (s.sheetName !== sheetName) return s
          return {
            ...s,
            selectedRowIndices: selected ? s.filterPreview.rowsToRemove.map((r) => r.rowIndex) : [],
          }
        }),
      }
    })
  }, [])

  /** 组件已卸载则不再 setState，避免解析完成后更新导致内存泄漏与持续渲染 */
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /** 是否为 Excel 文件（按扩展名） */
  const isExcelFile = useCallback((f: File) => /\.(xlsx|xls)$/i.test(f.name), [])

  /** 上次已拉取 sheet 的文件标识，避免同一文件重复请求导致卡顿 */
  const lastSheetFetchRef = useRef<string>('')

  /** 点击选择文件时 beforeUpload 拿到的 File；onChange 与 setState 可能同轮执行导致 prev 里还没有 originFileObj，用 ref 补上 */
  const lastSelectedFileRef = useRef<File | null>(null)
  /** 自定义文件输入：点击上传区时打开此 input，与 Ctrl+V 一样拿到真实 File，避免 Ant Design 点击选择拿不到 originFileObj */
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** 上次已弹出项目名称确认的文件标识，避免同一文件重复弹窗 */
  const lastProjectModalFileRef = useRef<string>('')

  /** 完整解析结果（含 dataRows）放 ref，避免 3MB+ 进 state 导致 setState 时卡死；state 中 parseResults 不存 dataRows */
  const fullParseResultsRef = useRef<ParseResultItem[]>([])
  const parseLogEndRef = useRef<HTMLDivElement>(null)

  /** 文件选中后立即弹出关联项目名称确认框，默认以文件名（去后缀）为项目名，并加载数据库已有项目列表 */
  useEffect(() => {
    const name = fileList[0]?.name
    if (!fileList.length || !name) {
      return
    }
    if (lastProjectModalFileRef.current === name) return
    lastProjectModalFileRef.current = name
    setProjectNameModalValue(fileNameWithoutExt(name))
    setProjectNameModalOpen(true)
    setExistingProjectNames([])
    setExistingProjectNamesLoading(true)
    axios
      .get<{ list: string[] }>('/api/products/projects', { headers })
      .then((res) => setExistingProjectNames(res.data?.list ?? []))
      .catch(() => {})
      .finally(() => setExistingProjectNamesLoading(false))
  }, [fileList, headers])

  /** 选择文件后拉取 sheet 列表（仅 Excel；同一文件不重复请求；卸载后不再 setState）。点击选择时用 ref 补全 originFileObj */
  useEffect(() => {
    let file = fileList[0]?.originFileObj as File | undefined
    if (!file && fileList[0] && lastSelectedFileRef.current && isExcelFile(lastSelectedFileRef.current)) {
      file = lastSelectedFileRef.current
      setFileList((prev) => (prev.length && !prev[0].originFileObj ? [{ ...prev[0], originFileObj: file } as UploadFile] : prev))
    }
    if (!file || !isExcelFile(file)) {
      setSheetList([])
      setSelectedSheetIndices([])
      lastSheetFetchRef.current = ''
      return
    }
    const fileId = `${file.name}-${file.size}`
    setSheetsLoading(true)
    const formData = new FormData()
    formData.append('file', file)
    let cancelled = false
    axios
      .post<{ sheets: SheetItem[]; sheetsWithData?: string[] }>('/api/docs/excel-sheets', formData, { headers })
      .then((res) => {
        if (cancelled || !mountedRef.current) return
        lastSheetFetchRef.current = fileId
        const sheets = res.data?.sheets ?? []
        setSheetList(sheets)
        /** 默认勾选全部工作表（保留各 Sheet 名称参与解析与入库），用户仍可取消部分 */
        const allIndices = sheets.map((_, i) => i)
        setSelectedSheetIndices(allIndices.length > 0 ? allIndices : [])
      })
      .catch((err: unknown) => {
        if (cancelled || !mountedRef.current) return
        setSheetList([])
        setSelectedSheetIndices([])
        lastSheetFetchRef.current = ''
        const ax = err as { response?: { data?: { message?: string } } }
        msg.error(ax?.response?.data?.message || '读取 Excel Sheet 列表失败，请检查文件、网络或是否具备「项目维护」权限')
      })
      .finally(() => {
        if (mountedRef.current) setSheetsLoading(false)
      })
    return () => {
      cancelled = true
      lastSheetFetchRef.current = ''
      if (mountedRef.current) setSheetsLoading(false)
    }
  }, [fileList, isExcelFile, headers])

  /** 清空文件时重置 sheet 与解析结果 */
  const handleRemoveFile = useCallback(() => {
    lastSelectedFileRef.current = null
    lastProjectModalFileRef.current = ''
    setFileList([])
    setSheetList([])
    setSelectedSheetIndices([])
    setParseResults([])
    setFinalRowsBySheet({})
    fullParseResultsRef.current = []
    setActivePreviewTab('')
    setActiveMappingTab('')
    setSheetParseOffset(0)
    setSaveSheetNames([])
  }, [])

  /** 下一批从已选 Sheet 的第 1 个重新计数，并清空已解析结果（同重新上传后的解析起点） */
  const resetSheetParseBatch = useCallback(() => {
    setSheetParseOffset(0)
    setParseResults([])
    setFinalRowsBySheet({})
    setSaveSheetNames([])
    fullParseResultsRef.current = []
    setFilterPreviewState(null)
    setParseLogLines([])
    setParseProgress(null)
    setActivePreviewTab('')
    setActiveMappingTab('')
    msg.info('已重置解析批次：下次点击解析将从勾选列表中第 1 个 Sheet 开始（每批最多 5 个）')
  }, [msg])

  /** 将 File 转为 Antd UploadFile 并设置到 fileList（用于拖拽、粘贴、点击选择） */
  const setFileFromFile = useCallback((file: File) => {
    if (!isExcelFile(file)) {
      msg.warning('仅支持 Excel 文件（.xlsx / .xls）')
      return
    }
    lastSelectedFileRef.current = file
    setFileList([{ uid: file.name + '-' + Date.now(), name: file.name, originFileObj: file } as UploadFile])
    msg.success(`已添加文件：${file.name}`)
  }, [isExcelFile, msg])

  /** 全局粘贴：在页面内 Ctrl+V / Cmd+V 粘贴剪贴板中的文件时，若为 Excel 则加入上传列表 */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files
      if (!files?.length) return
      const file = Array.from(files).find((f) => isExcelFile(f))
      if (file) {
        e.preventDefault()
        setFileFromFile(file)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [setFileFromFile, isExcelFile])

  /** 有映射结果时拉取已有规则库，用于「加入规则」时禁止重复 */
  useEffect(() => {
    if (parseResults.length === 0) return
    axios.get<{ list: { header_normalized: string }[] }>('/api/form-templates/header-rules', { headers }).then(
      (res) => {
        const list = res.data?.list ?? []
        setExistingRuleHeaders(new Set(list.map((r) => r.header_normalized).filter(Boolean)))
      },
      () => setExistingRuleHeaders(new Set()),
    )
  }, [parseResults.length, headers])

  /** 解析进度（当前第几个 / 共几个 + 当前步骤文案，由后端 SSE 同步） */
  const [parseProgress, setParseProgress] = useState<{ current: number; total: number; stepMessage?: string } | null>(null)
  /** 解析进度日志（流式追加，用于在下方滚动区域展示） */
  const [parseLogLines, setParseLogLines] = useState<string[]>([])
  /** 当前 LLM 流式输出（实时追加，收到下一句 progress 时 flush 到 parseLogLines） */
  const [parseStreamingLine, setParseStreamingLine] = useState('')
  const parseStreamingRef = useRef('')

  const appendParseLog = useCallback((line: string) => {
    setParseLogLines((prev) => [...prev, line])
  }, [])
  const flushStreamingToLog = useCallback(() => {
    if (!parseStreamingRef.current) return
    const time = `${new Date().getHours().toString().padStart(2, '0')}:${new Date().getMinutes().toString().padStart(2, '0')}:${new Date().getSeconds().toString().padStart(2, '0')}`
    appendParseLog(`[${time}] LLM 返回：${parseStreamingRef.current}`)
    parseStreamingRef.current = ''
    setParseStreamingLine('')
  }, [appendParseLog])
  const formatLogTime = () => {
    const d = new Date()
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
  }

  useEffect(() => {
    parseLogEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [parseLogLines.length, parseStreamingLine])

  /** 解析单 Sheet 可能返回完整结果或仅数据清洗预览（需用户确认后再继续） */
  type ParseStreamResult =
    | {
        sheetName: string
        headerRowIndex: number
        numHeaderRows: number
        flatHeaders: string[]
        mapping: ColumnMappingItem[]
        dataRows: string[][]
        standardRows: Record<string, unknown>[]
        fileName?: string
      }
    | { stoppedAt: 'filter'; sheetName: string; filterPreview: FilterPreview }

  /** 调用 parse-stream 流式解析单个 Sheet，通过 onProgress / onLLMChunk / onVectorDetail / onVectorResult / onFilterResult 同步后台步骤与过滤结果到前端 */
  const parseOneSheetWithStream = async (
    formData: FormData,
    callbacks: {
      onProgress: (message: string) => void
      onLLMChunk?: (delta: string) => void
      onVectorDetail?: (details: { header: string; bestLabel: string; similarity: number; hit: boolean }[]) => void
      onVectorResult?: (summary: { total: number; matched: number; rate: string; pairs: { header: string; standardKey: string }[] }) => void
      onFilterResult?: (result: { removedCount: number; rolledBack: boolean; summaryRowsCount: number; logs: string[] }) => void
    },
  ): Promise<ParseStreamResult> => {
    const reqHeaders: Record<string, string> = {}
    if (token) reqHeaders.Authorization = `Bearer ${token}`
    const res = await fetch('/api/excel-format/parse-stream', { method: 'POST', body: formData, headers: reqHeaders })
    if (!res.ok) throw new Error(res.statusText || '请求失败')
    const reader = res.body?.getReader()
    const decoder = new TextDecoder()
    if (!reader) throw new Error('无响应流')
    let buffer = ''
    let resultData: string | null = null
    let filterPreviewData: { stoppedAt: 'filter'; sheetName: string; filterPreview: FilterPreview } | null = null
    let errorMessage: string | null = null
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        const eventMatch = part.match(/event:\s*(\w+)/)
        const dataMatch = part.match(/data:\s*([\s\S]*)/)
        const event = eventMatch?.[1] ?? ''
        const data = dataMatch?.[1]?.trim() ?? ''
        if (event === 'progress' && data) {
          try {
            const { message } = JSON.parse(data) as { step?: string; message?: string }
            if (message) callbacks.onProgress(message)
          } catch {
            callbacks.onProgress(data)
          }
        } else if (event === 'llm_chunk' && data) {
          try {
            const { delta } = JSON.parse(data) as { delta?: string }
            if (delta != null) callbacks.onLLMChunk?.(delta)
          } catch {
            // ignore
          }
        } else if (event === 'vector_detail' && data) {
          try {
            const { details } = JSON.parse(data) as { details?: { header: string; bestLabel: string; similarity: number; hit: boolean }[] }
            if (Array.isArray(details)) callbacks.onVectorDetail?.(details)
          } catch {
            // ignore
          }
        } else if (event === 'vector_result' && data) {
          try {
            const raw = JSON.parse(data) as { total?: number; matched?: number; rate?: string; pairs?: { header: string; standardKey: string }[] }
            if (raw != null && typeof raw.total === 'number' && typeof raw.matched === 'number') {
              callbacks.onVectorResult?.({
                total: raw.total,
                matched: raw.matched,
                rate: typeof raw.rate === 'string' ? raw.rate : '0',
                pairs: Array.isArray(raw.pairs) ? raw.pairs : [],
              })
            }
          } catch {
            // ignore
          }
        } else if (event === 'filter_result' && data) {
          try {
            const raw = JSON.parse(data) as { removedCount?: number; rolledBack?: boolean; summaryRowsCount?: number; logs?: string[] }
            if (raw != null) {
              callbacks.onFilterResult?.({
                removedCount: typeof raw.removedCount === 'number' ? raw.removedCount : 0,
                rolledBack: Boolean(raw.rolledBack),
                summaryRowsCount: typeof raw.summaryRowsCount === 'number' ? raw.summaryRowsCount : 0,
                logs: Array.isArray(raw.logs) ? raw.logs : [],
              })
            }
          } catch {
            // ignore
          }
        } else if (event === 'filter_preview' && data) {
          try {
            const raw = JSON.parse(data) as { sheetName?: string; logs?: string[]; removedCount?: number; rolledBack?: boolean; summaryRowsCount?: number; rowsToRemove?: RowToRemoveItem[] }
            if (raw?.sheetName != null) {
              filterPreviewData = {
                stoppedAt: 'filter',
                sheetName: raw.sheetName,
                filterPreview: {
                  logs: Array.isArray(raw.logs) ? raw.logs : [],
                  removedCount: typeof raw.removedCount === 'number' ? raw.removedCount : 0,
                  rolledBack: Boolean(raw.rolledBack),
                  summaryRowsCount: typeof raw.summaryRowsCount === 'number' ? raw.summaryRowsCount : 0,
                  rowsToRemove: Array.isArray(raw.rowsToRemove) ? raw.rowsToRemove : [],
                },
              }
            }
          } catch {
            // ignore
          }
        } else if (event === 'result' && data) {
          resultData = data
        } else if (event === 'error' && data) {
          try {
            const obj = JSON.parse(data) as { message?: string }
            errorMessage = obj?.message ?? data
          } catch {
            errorMessage = data
          }
        }
      }
    }
    if (buffer.trim()) {
      if (buffer.includes('event: result')) {
        const dataMatch = buffer.match(/data:\s*([\s\S]*)/)
        if (dataMatch) resultData = dataMatch[1].trim()
      }
      if (buffer.includes('event: filter_preview') && !filterPreviewData) {
        const dataMatch = buffer.match(/data:\s*([\s\S]*)/)
        if (dataMatch) {
          try {
            const raw = JSON.parse(dataMatch[1].trim()) as { sheetName?: string; logs?: string[]; removedCount?: number; rolledBack?: boolean; summaryRowsCount?: number; rowsToRemove?: RowToRemoveItem[] }
            if (raw?.sheetName != null) {
              filterPreviewData = {
                stoppedAt: 'filter',
                sheetName: raw.sheetName,
                filterPreview: {
                  logs: Array.isArray(raw.logs) ? raw.logs : [],
                  removedCount: typeof raw.removedCount === 'number' ? raw.removedCount : 0,
                  rolledBack: Boolean(raw.rolledBack),
                  summaryRowsCount: typeof raw.summaryRowsCount === 'number' ? raw.summaryRowsCount : 0,
                  rowsToRemove: Array.isArray(raw.rowsToRemove) ? raw.rowsToRemove : [],
                },
              }
            }
          } catch {
            // ignore
          }
        }
      }
    }
    if (errorMessage) throw new Error(errorMessage)
    if (filterPreviewData) return filterPreviewData
    if (!resultData) throw new Error('未收到解析结果')
    return JSON.parse(resultData)
  }

  /** 上传并调用 parse-stream（多 sheet 时按批解析，每批最多 5 个，后台进度通过 SSE 同步到前端） */
  const handleParse = () => {
    let file = fileList[0]?.originFileObj as File | undefined
    if (!file && fileList[0]?.name && lastSelectedFileRef.current?.name === fileList[0].name)
      file = lastSelectedFileRef.current
    if (!file || !isExcelFile(file)) {
      msg.warning('请先选择 Excel 文件')
      return
    }
    const orderedIndices = (() => {
      const uniq = [...new Set(selectedSheetIndices)].sort((a, b) => a - b)
      return uniq.length > 0 ? uniq : [0]
    })()
    const start = sheetParseOffset
    const indices = orderedIndices.slice(start, start + SHEETS_PER_PARSE)
    if (indices.length === 0) {
      msg.info(
        `当前勾选范围内已全部解析完毕（共 ${orderedIndices.length} 个 Sheet）。若要重新从第 1 个 Sheet 起按批解析，请先点击「重置解析批次」。`,
      )
      return
    }
    const isFirstBatch = start === 0
    const mergeIntoExisting = !isFirstBatch
    const nextOffsetAfterBatch = start + indices.length
    const remainingAfterBatch = Math.max(0, orderedIndices.length - nextOffsetAfterBatch)

    setParseLoading(true)
    if (isFirstBatch) {
      setParseResults([])
      setFinalRowsBySheet({})
      setParseProgress(null)
      setParseLogLines([])
      setParseStreamingLine('')
      parseStreamingRef.current = ''
      fullParseResultsRef.current = []
    } else {
      setParseProgress(null)
      setParseStreamingLine('')
      parseStreamingRef.current = ''
    }
    setFilterPreviewState(null)

    const run = async () => {
      const results: ParseResultItem[] = []
      const filterPreviews: { sheetIndex: number; sheetName: string; filterPreview: FilterPreview }[] = []
      try {
        appendParseLog(
          `[${formatLogTime()}] 本批解析工作簿索引：${indices.join(', ')}（已选共 ${orderedIndices.length} 个，顺位第 ${start + 1}–${start + indices.length} 个）${remainingAfterBatch > 0 ? `；尚有 ${remainingAfterBatch} 个未解析，可再次点击「解析」` : '；已无待解析 Sheet'}`,
        )
        for (let i = 0; i < indices.length; i++) {
          if (!mountedRef.current) return
          setParseStreamingLine('')
          parseStreamingRef.current = ''
          setParseProgress({ current: i + 1, total: indices.length, stepMessage: '准备中…' })
          appendParseLog(`[${formatLogTime()}] 正在解析第 ${i + 1}/${indices.length} 个 Sheet…`)
          const sheetIndex = indices[i]
          const formData = new FormData()
          formData.append('file', file)
          formData.append('sheetIndex', String(sheetIndex))
          formData.append('useLLM', 'true')
          formData.append('stopAfterFilter', 'true')
          const reqAt = Date.now()
          const res = await parseOneSheetWithStream(formData, {
            onProgress: (message) => {
              if (!mountedRef.current) return
              flushStreamingToLog()
              setParseProgress((prev) => (prev ? { ...prev, stepMessage: message } : null))
              appendParseLog(`[${formatLogTime()}] ${message}`)
            },
            onLLMChunk: (delta) => {
              if (!mountedRef.current) return
              parseStreamingRef.current += delta
              setParseStreamingLine(parseStreamingRef.current)
            },
            onVectorDetail: (details) => {
              if (!mountedRef.current) return
              flushStreamingToLog()
              appendParseLog(`[${formatLogTime()}] 向量匹配详情：`)
              details.forEach((d) => {
                const tag = d.hit ? '✓命中' : '未命中'
                appendParseLog(`  表头 "${d.header}" 最高相似度 "${d.bestLabel}" ${(d.similarity * 100).toFixed(2)}% ${tag}`)
              })
            },
            onVectorResult: (summary) => {
              if (!mountedRef.current) return
              appendParseLog(`[${formatLogTime()}] 向量匹配结果: 参与=${summary.total} 命中=${summary.matched} 匹配率=${summary.rate}%`)
              if (summary.pairs?.length) {
                summary.pairs.forEach((p) => appendParseLog(`  "${p.header}" -> ${p.standardKey}`))
              }
            },
            onFilterResult: (result) => {
              if (!mountedRef.current) return
              flushStreamingToLog()
              if (result.rolledBack) {
                appendParseLog(`[${formatLogTime()}] 冗余行过滤: 回退保护，未删除任何行`)
              } else if (result.removedCount > 0) {
                appendParseLog(`[${formatLogTime()}] 冗余行过滤完成: 已删除 ${result.removedCount} 行${result.summaryRowsCount > 0 ? `，汇总行 ${result.summaryRowsCount} 条已单独存储` : ''}`)
              } else {
                appendParseLog(`[${formatLogTime()}] 冗余行过滤: 无需删除，保留原表`)
              }
            },
          })
          const resAt = Date.now()
          flushStreamingToLog()
          if (!mountedRef.current) return
          if ('stoppedAt' in res && res.stoppedAt === 'filter') {
            filterPreviews.push({ sheetIndex, sheetName: res.sheetName, filterPreview: res.filterPreview })
            appendParseLog(`[${formatLogTime()}] Sheet「${res.sheetName}」数据清洗预览完成 (${resAt - reqAt}ms)，待确认是否删除 ${res.filterPreview.removedCount} 行`)
            continue
          }
          const item = res as ParseResultItem
          appendParseLog(`[${formatLogTime()}] Sheet「${item.sheetName}」解析完成 (${resAt - reqAt}ms)`)
          results.push(item)
        }
        if (!mountedRef.current) return
        if (filterPreviews.length > 0) {
          setFilterPreviewState({
            file,
            sheetIndices: indices,
            sheetParseOffsetAfterBatch: nextOffsetAfterBatch,
            mergeFilterResultsIntoExisting: mergeIntoExisting,
            bySheet: filterPreviews.map((p) => ({
              ...p,
              confirmChoice: 'delete' as const,
              selectedRowIndices: p.filterPreview.rowsToRemove.map((r) => r.rowIndex),
            })),
          })
          setParseProgress(null)
          appendParseLog(`[${formatLogTime()}] 数据清洗完成，请确认是否删除上述行后继续`)
          msg.info('请确认数据清洗结果：确认删除并继续，或保留全部行再继续')
          return
        }
        const resultsForState = results.map((r) => ({ ...r, dataRows: [] as string[][] }))
        if (mergeIntoExisting) {
          fullParseResultsRef.current = [...fullParseResultsRef.current, ...results]
          setParseResults((prev) => [...prev, ...resultsForState])
        } else {
          fullParseResultsRef.current = results
          setParseResults(resultsForState)
        }
        setSheetParseOffset(nextOffsetAfterBatch)
        setParseProgress(null)
        appendParseLog(`[${formatLogTime()}] 本批完成，共 ${results.length} 个 Sheet`)
        if (results.length > 0) {
          setActivePreviewTab(results[0].sheetName)
          setActiveMappingTab(results[0].sheetName)
        }
        msg.success(
          remainingAfterBatch > 0
            ? `本批已解析 ${results.length} 个 Sheet，请在步骤 2 确认各 Sheet 映射后生成预览。尚有 ${remainingAfterBatch} 个 Sheet 未解析，可再次点击「解析」。`
            : `本批已解析 ${results.length} 个 Sheet，已全部解析完毕；请在步骤 2 确认映射后在步骤 3 查看预览。`,
        )
      } catch (e: unknown) {
        if (!mountedRef.current) return
        const err = e as Error
        appendParseLog(`[${formatLogTime()}] 解析失败：${err?.message ?? '未知错误'}`)
        msg.error(err?.message || '解析失败')
        setParseProgress(null)
      } finally {
        if (mountedRef.current) setParseLoading(false)
      }
    }

    setTimeout(run, 0)
  }

  /** 用户确认数据清洗：按各 Sheet 已选方式继续（每 Sheet 独立为「确认删除」或「保留全部」，删除时使用该 Sheet 勾选的行） */
  const handleConfirmFilter = useCallback(
    async () => {
      const state = filterPreviewState
      if (!state) return
      const { file, bySheet, mergeFilterResultsIntoExisting, sheetParseOffsetAfterBatch } = state
      const hasUnset = bySheet.some((s) => s.confirmChoice === null)
      if (hasUnset) {
        msg.warning('请为每个 Sheet 选择「本 Sheet 确认删除」或「本 Sheet 保留全部」后再继续')
        return
      }
      setFilterPreviewState(null)
      setParseLoading(true)
      if (!mergeFilterResultsIntoExisting) {
        setParseResults([])
        setFinalRowsBySheet({})
      }
      setParseLogLines((prev) => [...prev, `[${formatLogTime()}] 按各 Sheet 确认结果继续解析…`])
      const results: ParseResultItem[] = []
      try {
        for (let i = 0; i < bySheet.length; i++) {
          if (!mountedRef.current) return
          const s = bySheet[i]
          const applyFilter = s.confirmChoice === 'delete'
          const customIndices = applyFilter && s.selectedRowIndices.length > 0 ? s.selectedRowIndices : undefined
          setParseProgress({
            current: i + 1,
            total: bySheet.length,
            stepMessage: applyFilter ? `应用过滤并识别表头（${s.sheetName}）…` : `保留全部行（${s.sheetName}）…`,
          })
          const formData = new FormData()
          formData.append('file', file)
          formData.append('sheetIndex', String(s.sheetIndex))
          formData.append('useLLM', 'true')
          formData.append('applyFilter', applyFilter ? 'true' : 'false')
          if (customIndices?.length) formData.append('customRowIndicesToRemove', JSON.stringify(customIndices))
          const res = await parseOneSheetWithStream(formData, {
            onProgress: (message) => {
              if (!mountedRef.current) return
              flushStreamingToLog()
              setParseProgress((prev) => (prev ? { ...prev, stepMessage: message } : null))
              appendParseLog(`[${formatLogTime()}] ${message}`)
            },
            onLLMChunk: (delta) => {
              if (!mountedRef.current) return
              parseStreamingRef.current += delta
              setParseStreamingLine(parseStreamingRef.current)
            },
            onVectorDetail: (details) => {
              if (!mountedRef.current) return
              flushStreamingToLog()
              details.forEach((d) => appendParseLog(`  表头 "${d.header}" ${d.hit ? '✓' : '未命中'} "${d.bestLabel}" ${(d.similarity * 100).toFixed(2)}%`))
            },
            onVectorResult: (summary) => {
              if (!mountedRef.current) return
              appendParseLog(`[${formatLogTime()}] 向量匹配: ${summary.matched}/${summary.total} 匹配率=${summary.rate}%`)
            },
            onFilterResult: (result) => {
              if (!mountedRef.current) return
              flushStreamingToLog()
              if (result.removedCount > 0) {
                appendParseLog(`[${formatLogTime()}] 冗余行过滤: 已删除 ${result.removedCount} 行`)
              }
            },
          })
          if (!mountedRef.current) return
          if ('stoppedAt' in res && res.stoppedAt === 'filter') {
            appendParseLog(`[${formatLogTime()}] 意外收到 filter_preview，跳过`)
            continue
          }
          const item = res as ParseResultItem
          results.push(item)
        }
        if (!mountedRef.current) return
        const mappedForState = results.map((r) => ({ ...r, dataRows: [] as string[][] }))
        if (mergeFilterResultsIntoExisting) {
          fullParseResultsRef.current = [...fullParseResultsRef.current, ...results]
          setParseResults((prev) => [...prev, ...mappedForState])
        } else {
          fullParseResultsRef.current = results
          setParseResults(mappedForState)
        }
        setSheetParseOffset(sheetParseOffsetAfterBatch)
        setParseProgress(null)
        appendParseLog(`[${formatLogTime()}] 本批清洗确认后解析完成，共 ${results.length} 个 Sheet`)
        if (results.length > 0) {
          setActivePreviewTab(results[0].sheetName)
          setActiveMappingTab(results[0].sheetName)
        }
        msg.success(`已解析 ${results.length} 个 Sheet，请在步骤 2 确认映射后在步骤 3 查看预览`)
      } catch (e: unknown) {
        if (!mountedRef.current) return
        const err = e as Error
        appendParseLog(`[${formatLogTime()}] 解析失败：${err?.message ?? '未知错误'}`)
        msg.error(err?.message || '解析失败')
        setParseProgress(null)
      } finally {
        if (mountedRef.current) setParseLoading(false)
      }
    },
    [filterPreviewState, msg, token]
  )

  /** 用户修改某 sheet 某列的 standardKey */
  const updateMapping = (sheetName: string, colIndex: number, standardKey: string | null) => {
    setParseResults((prev) =>
      prev.map((r) =>
        r.sheetName !== sheetName
          ? r
          : { ...r, mapping: r.mapping.map((m) => (m.colIndex === colIndex ? { ...m, standardKey } : m)) },
      ),
    )
  }

  /** 确认映射：对指定 sheet 调用 confirm，更新该 sheet 的标准行（dataRows 从 ref 取，因 state 中已剥离） */
  const handleConfirmMapping = async (sheetName: string) => {
    const one = parseResults.find((r) => r.sheetName === sheetName)
    const full = fullParseResultsRef.current.find((r) => r.sheetName === sheetName)
    const dataRows = full?.dataRows ?? one?.dataRows ?? []
    if (!one?.mapping?.length || !dataRows.length || !one.flatHeaders?.length) {
      msg.warning('该 Sheet 无解析结果或数据为空')
      return
    }
    setConfirmLoading(true)
    try {
      const res = await axios.post<{ standardRows: Record<string, unknown>[] }>('/api/excel-format/confirm', {
        mapping: one.mapping,
        dataRows,
        flatHeaders: one.flatHeaders,
      }, { headers })
      const rows = enrichPreviewRows(
        (res.data?.standardRows ?? []).map((r, i) => ({
          ...r,
          _key: `final-${sheetName}-${Date.now()}-${i}`,
          sheet_name: sheetName,
        })),
      )
      setFinalRowsBySheet((prev) => {
        const next = { ...prev, [sheetName]: rows }
        setTimeout(() => {
          const first = findFirstUnitPriceConflict(next)
          if (first) setUnitPriceConflict(first)
        }, 0)
        return next
      })
      msg.success(`「${sheetName}」已生成 ${rows.length} 条标准数据`)
      const emptyIndices = getEmptyGoodsNameIndices(rows)
      if (emptyIndices.length > 0) {
        setEmptyGoodsNameConfirm({ bySheet: [{ sheetName, fullRows: rows, indicesToRemove: emptyIndices }] })
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || '确认映射失败')
    } finally {
      setConfirmLoading(false)
    }
  }

  /** 转为成本清单格式（与 DocTasks mapToCostListItems 一致） */
  const mapToCostListItems = (items: ReviewRow[]): Record<string, unknown>[] => {
    const defaultTax = 13
    return items.map((row) => {
      const qty = row.quantity != null ? Number(row.quantity) : null
      const taxRate = row.tax_rate != null ? Number(row.tax_rate) : defaultTax
      const r = getPreviewTaxMultiplier(row.tax_rate)
      const unitIncl = row.unit_price_incl_tax != null ? Number(row.unit_price_incl_tax) : row.cost_price != null ? Number(row.cost_price) : null
      const unitExcl = row.unit_price_excl_tax != null ? Number(row.unit_price_excl_tax) : unitIncl != null ? Math.round((unitIncl / r) * 100) / 100 : null
      const amountIncl = row.amount_incl_tax != null ? Number(row.amount_incl_tax) : row.cost_amount != null ? Number(row.cost_amount) : unitIncl != null && qty != null ? Math.round(unitIncl * qty * 100) / 100 : unitExcl != null && qty != null ? Math.round(unitExcl * qty * r * 100) / 100 : null
      const amountExcl = row.amount_excl_tax != null ? Number(row.amount_excl_tax) : amountIncl != null ? Math.round((amountIncl / r) * 100) / 100 : null
      return {
        sequence_no: row.sequence_no,
        goods_name: row.goods_name,
        brand: row.brand,
        model: row.model,
        params: row.params,
        unit: row.unit,
        quantity: qty,
        tax_rate: taxRate,
        unit_price_excl_tax: unitExcl,
        unit_price_incl_tax: unitIncl,
        amount_excl_tax: amountExcl,
        amount_incl_tax: amountIncl,
        cost_price: unitIncl,
        cost_amount: amountIncl,
        remark: row.remark,
        project_name: row.project_name ?? projectName,
        sheet_name: row.sheet_name ?? null,
      }
    })
  }

  /** 下拉选项顺序：与解析 Tab 一致，其余按名称排序 */
  const saveSheetSelectOptions = useMemo(() => {
    const keysWithRows = Object.keys(finalRowsBySheet).filter((k) => (finalRowsBySheet[k]?.length ?? 0) > 0)
    const fromParse = parseResults.map((r) => r.sheetName).filter((n) => keysWithRows.includes(n))
    const rest = keysWithRows.filter((k) => !fromParse.includes(k)).sort()
    return [...fromParse, ...rest]
  }, [parseResults, finalRowsBySheet])

  useEffect(() => {
    const finalKeys = Object.keys(finalRowsBySheet).filter((k) => (finalRowsBySheet[k]?.length ?? 0) > 0)
    if (finalKeys.length === 0) {
      setSaveSheetNames([])
      return
    }
    const nameOrder = parseResults.map((r) => r.sheetName).filter((n) => finalRowsBySheet[n]?.length)
    const orderedKeys =
      nameOrder.length > 0 ? [...nameOrder, ...finalKeys.filter((k) => !nameOrder.includes(k)).sort()] : [...finalKeys].sort()
    setSaveSheetNames((prev) => {
      const keySet = new Set(finalKeys)
      const kept = prev.filter((n) => keySet.has(n))
      const prevSet = new Set(prev)
      const added = orderedKeys.filter((k) => !prevSet.has(k))
      const next = kept.length === 0 ? orderedKeys : [...kept, ...added]
      if (next.length === prev.length && next.every((n, i) => prev[i] === n)) return prev
      return next
    })
  }, [finalRowsBySheet, parseResults])

  /** 当前用于入库/下载的行（按 saveSheetNames 多选合并），每行注入 sheet_name */
  const rowsForSave = useMemo(() => {
    if (saveSheetNames.length === 0) return []
    const nameSet = new Set(saveSheetNames)
    const ordered = saveSheetSelectOptions.filter((n) => nameSet.has(n))
    return ordered.flatMap((sheetName) => {
      const rows = finalRowsBySheet[sheetName] ?? []
      return rows.map((r) => ({ ...r, sheet_name: sheetName }))
    })
  }, [saveSheetNames, saveSheetSelectOptions, finalRowsBySheet])

  /** 只要提供了不含税单价（含 0），即按税率重算含税单价；若含税也有填则以不含税为准（与后端一致） */
  const normalizePriceInclFromExcl = useCallback((row: Record<string, unknown>): Record<string, unknown> => {
    const rawExcl = row.unit_price_excl_tax
    if (rawExcl == null || rawExcl === '') return row
    const excl = Number(rawExcl)
    if (!Number.isFinite(excl)) return row
    const tax = row.tax_rate != null ? Number(row.tax_rate) : 0
    return { ...row, unit_price_incl_tax: calcInclFromExclSave(excl, tax) }
  }, [])

  /** 入库：成本或报价 */
  const doSaveToDb = async (target: 'cost' | 'quote', overwrite: boolean) => {
    if (!rowsForSave.length) return
    const rawItems = rowsForSave.map(({ _key, ...rest }) => rest)
    const items = rawItems.map((r) => normalizePriceInclFromExcl(r as Record<string, unknown>))
    const projName = (projectName || (rowsForSave[0] as Record<string, unknown>)?.project_name)?.toString?.()?.trim() ?? ''
    let reauth_password: string | undefined
    if (target === 'quote' && overwrite && projName) {
      const pwd = await askReauth('覆盖报价将替换该项目下已有数据，请输入登录密码确认')
      if (!pwd) return
      reauth_password = pwd
    }
    setSaveLoading(true)
    try {
      if (target === 'cost') {
        const costItems = mapToCostListItems(rowsForSave)
        await axios.post('/api/cost-list/bulk', { items: costItems }, { headers })
        msg.success('已存入成本清单')
        await axios.post('/api/structured-exports', { items: costItems, project_name: projName || '未命名项目', list_type: 'cost' }, { headers }).catch(() => {})
      } else {
        const payload = items.map((it) => ({ ...it, project_name: (it.project_name as string) || projName || undefined }))
        if (overwrite && projName) {
          await axios.post(
            '/api/products/overwrite',
            { project_name: projName, items: payload, reauth_password },
            { headers },
          )
          msg.success('已覆盖并存入报价清单')
        } else {
          await axios.post('/api/products/bulk', { items: payload }, { headers })
          msg.success('已存入报价清单')
        }
        await axios.post('/api/structured-exports', { items: payload, project_name: projName || '未命名项目', list_type: 'quote' }, { headers }).catch(() => {})
      }
      setOverwriteModalOpen(false)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || '入库失败')
    } finally {
      setSaveLoading(false)
    }
  }

  /** 下载标准行为 Excel（表单 POST 触发，由服务端 Content-Disposition filename* 提供中文名，避免乱码） */
  const handleDownloadExcel = () => {
    if (!rowsForSave.length) return
    const items = rowsForSave.map(({ _key, ...rest }) => rest)
    const baseName = parseResults[0]?.fileName?.replace(/\.[^.]+$/, '') ?? '清单'
    const filename = `智能格式化_${baseName}.xlsx`
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = `/api/docs/export-list-excel${token ? `?access_token=${encodeURIComponent(token)}` : ''}`
    form.target = '_blank'
    form.style.display = 'none'
    const input = document.createElement('input')
    input.name = 'payload'
    input.value = JSON.stringify({ items, filename })
    form.appendChild(input)
    document.body.appendChild(form)
    form.submit()
    form.remove()
    msg.success('已发起下载，请查看浏览器下载项')
  }

  /** 拉取已保存的结构化文件列表（与项目维护一致） */
  const fetchExportedFiles = useCallback(async () => {
    setFilesLoading(true)
    try {
      const res = await axios.get<{ list: { filename: string; project_name: string; list_type: 'cost' | 'quote'; saved_at: string; item_count: number; size: number }[] }>('/api/structured-exports', { headers })
      setExportedFilesList(res.data?.list ?? [])
    } catch {
      setExportedFilesList([])
    } finally {
      setFilesLoading(false)
    }
  }, [headers])

  const openFilesModal = useCallback(() => {
    setFilesModalOpen(true)
    fetchExportedFiles()
  }, [fetchExportedFiles])

  const handleViewFile = useCallback(async (filename: string) => {
    try {
      const res = await axios.get<Record<string, unknown>>(`/api/structured-exports/${encodeURIComponent(filename)}`, { headers })
      setViewFileName(filename)
      setViewFileContent(JSON.stringify(res.data, null, 2))
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || '读取失败')
    }
  }, [headers, msg])

  const handleDeleteFile = useCallback(async (filename: string) => {
    try {
      await axios.delete(`/api/structured-exports/${encodeURIComponent(filename)}`, { headers })
      msg.success('已删除')
      fetchExportedFiles()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || '删除失败')
    }
  }, [headers, msg, fetchExportedFiles])

  const handleExportFileAsExcel = useCallback(async (filename: string) => {
    try {
      const res = await axios.get<{ items?: Record<string, unknown>[] }>(`/api/structured-exports/${encodeURIComponent(filename)}`, { headers })
      const items = res.data?.items ?? []
      if (!items.length) {
        msg.warning('该文件无数据，无法导出')
        return
      }
      const excelName = filename.replace(/\.json$/i, '') + '.xlsx'
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = `/api/docs/export-list-excel${token ? `?access_token=${encodeURIComponent(token)}` : ''}`
      form.target = '_blank'
      form.style.display = 'none'
      const input = document.createElement('input')
      input.name = 'payload'
      input.value = JSON.stringify({ items, filename: excelName })
      form.appendChild(input)
      document.body.appendChild(form)
      form.submit()
      form.remove()
      msg.success('已发起下载，请查看浏览器下载项')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || '导出失败')
    }
  }, [headers, token, msg])

  const handleReloadFile = useCallback(async (filename: string, fileProjectName: string, _listType: 'cost' | 'quote') => {
    try {
      const res = await axios.get<{ items?: Record<string, unknown>[]; project_name?: string }>(`/api/structured-exports/${encodeURIComponent(filename)}`, { headers })
      const items = res.data?.items ?? []
      if (!items.length) {
        msg.warning('该文件无数据')
        return
      }
      const proj = res.data?.project_name || fileProjectName || ''
      const grouped: Record<string, ReviewRow[]> = {}
      for (let i = 0; i < items.length; i++) {
        const row = items[i]
        const sn = (row.sheet_name != null ? String(row.sheet_name) : '') || '默认'
        if (!grouped[sn]) grouped[sn] = []
        grouped[sn].push({ ...row, _key: `reload-${sn}-${Date.now()}-${i}`, sheet_name: sn } as ReviewRow)
      }
      for (const sn of Object.keys(grouped)) {
        grouped[sn] = enrichPreviewRows(grouped[sn])
      }
      const sheetNames = Object.keys(grouped)
      const virtualResults = sheetNames.map((sn, idx) => ({
        sheetName: sn,
        sheetIndex: idx,
        headerRowIndex: 0,
        numHeaderRows: 1,
        flatHeaders: [] as string[],
        mapping: [] as ColumnMappingItem[],
        dataRows: [] as string[][],
        standardRows: [] as Record<string, unknown>[],
        fileName: filename,
      }))
      setParseResults(virtualResults)
      fullParseResultsRef.current = virtualResults
      setSheetParseOffset(0)
      setFinalRowsBySheet(grouped)
      setTimeout(() => {
        const first = findFirstUnitPriceConflict(grouped)
        if (first) setUnitPriceConflict(first)
      }, 0)
      setActivePreviewTab(sheetNames[0])
      setActiveMappingTab(sheetNames[0])
      setProjectName(proj)
      setFilesModalOpen(false)
      msg.success(`已加载「${filename}」共 ${items.length} 条数据到预览区，可编辑后重新入库`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || '加载失败')
    }
  }, [headers, msg])

  const handleOverwriteFile = useCallback((filename: string, listType: 'cost' | 'quote') => {
    setUpdateTargetFilename(filename)
    setUpdateTargetListType(listType)
  }, [])

  const confirmOverwriteFile = useCallback(async () => {
    if (!updateTargetFilename || !rowsForSave.length) return
    const items = rowsForSave.map(({ _key, ...rest }) => rest)
    const projName = (projectName || (rowsForSave[0] as Record<string, unknown>)?.project_name)?.toString?.()?.trim() ?? ''
    const body =
      updateTargetListType === 'cost'
        ? { items: mapToCostListItems(rowsForSave), project_name: projName || '未命名项目', list_type: 'cost' as const }
        : { items, project_name: projName || '未命名项目', list_type: 'quote' as const }
    try {
      await axios.put(`/api/structured-exports/${encodeURIComponent(updateTargetFilename)}`, body, { headers })
      msg.success('已覆盖更新')
      setUpdateTargetFilename(null)
      fetchExportedFiles()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || '更新失败')
    }
  }, [updateTargetFilename, updateTargetListType, rowsForSave, projectName, headers, msg, fetchExportedFiles, mapToCostListItems])

  /** 确认关联项目名称（弹窗内确认后写入 projectName） */
  const confirmProjectNameModal = useCallback(() => {
    const value = projectNameModalValue.trim()
    setProjectName(value || fileNameWithoutExt(fileList[0]?.name ?? ''))
    setProjectNameModalOpen(false)
    if (value) msg.success(`关联项目已设为「${value}」`)
  }, [projectNameModalValue, fileList, msg])

  /** 点击「存入数据库」时打开二次确认弹窗（默认选项由 SaveTargetModal 根据 defaultChoice 渲染时传入） */
  const openSaveTargetModal = useCallback(() => setSaveTargetModalOpen(true), [])

  /** 在存入数据库弹窗中确认存入：若选报价且项目已有数据则先走覆盖确认，否则直接入库 */
  const handleConfirmSaveToDb = useCallback(
    async (choice: 'cost' | 'quote') => {
      setSaveTargetModalOpen(false)
      const proj = (projectName || (rowsForSave[0] as Record<string, unknown>)?.project_name)?.toString?.()?.trim()
      if (choice === 'cost') {
        doSaveToDb('cost', false)
        return
      }
      if (!proj) {
        doSaveToDb('quote', false)
        return
      }
      try {
        const res = await axios.get<{ total: number }>('/api/products', { params: { project_name: proj }, headers })
        if ((res.data?.total ?? 0) > 0) {
          setOverwriteProjectName(proj)
          setOverwriteModalOpen(true)
        } else {
          doSaveToDb('quote', false)
        }
      } catch {
        doSaveToDb('quote', false)
      }
    },
    [projectName, rowsForSave, headers, doSaveToDb]
  )

  const handleSaveAsFile = useCallback(async () => {
    const name = saveAsFilename.trim()
    if (!name) {
      msg.warning('请输入文件名')
      return
    }
    if (!rowsForSave.length) {
      msg.warning('当前无数据可保存')
      return
    }
    const items = rowsForSave.map(({ _key, ...rest }) => rest)
    const projName = (projectName || (rowsForSave[0] as Record<string, unknown>)?.project_name)?.toString?.()?.trim() ?? ''
    const filename = name.endsWith('.json') ? name : `${name}.json`
    try {
      await axios.post('/api/structured-exports', {
        items,
        project_name: projName || '未命名项目',
        list_type: 'quote' as const,
        filename,
      }, { headers })
      msg.success('已另存为文件')
      setSaveAsModalOpen(false)
      setSaveAsFilename('')
      if (filesModalOpen) fetchExportedFiles()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      msg.error(err?.response?.data?.message || '保存失败')
    }
  }, [saveAsFilename, rowsForSave, projectName, filesModalOpen, headers, msg, fetchExportedFiles])

  const sourceTag = (source: ColumnMappingItem['source']) => {
    const map = { rule: '规则', vector: '向量', fuzzy: '模糊', llm: 'LLM', none: '未匹配' }
    const color =
      source === 'rule'
        ? 'green'
        : source === 'vector'
          ? 'cyan'
          : source === 'fuzzy'
            ? 'blue'
            : source === 'llm'
              ? 'orange'
              : 'default'
    return <Tag color={color}>{map[source]}</Tag>
  }

  /** 将当前「原始表头 → 标准列」加入规则库（仅 LLM 来源可加入，且禁止重复） */
  const handleAddToRules = useCallback(
    async (originalHeader: string, standardKey: string) => {
      const norm = normalizeHeaderForRule(originalHeader)
      if (!standardKey || !norm) return
      if (addedRuleHeaders.has(norm) || existingRuleHeaders.has(norm)) {
        msg.warning('该表头已在规则库中，无需重复加入')
        return
      }
      try {
        await axios.post(
          '/api/form-templates/header-rules',
          { header: originalHeader.trim(), columnKey: standardKey },
          { headers },
        )
        setAddedRuleHeaders((prev) => new Set(prev).add(norm))
        msg.success(`已加入规则：「${originalHeader}」→ ${COLUMN_TITLES[standardKey] ?? standardKey}`)
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string } } }
        msg.error(err?.response?.data?.message || '加入规则失败')
      }
    },
    [headers, msg, addedRuleHeaders, existingRuleHeaders],
  )

  /** 预览表内编辑：与项目维护商品列表一致，按 sheet 更新 finalRowsBySheet */
  const setPreviewRow = useCallback((sheetName: string, rowIndex: number, field: string, value: unknown) => {
    setFinalRowsBySheet((prev) => {
      const rows = prev[sheetName] ?? []
      const next = rows.map((row, i) => (i === rowIndex ? { ...row, [field]: value } : row))
      return { ...prev, [sheetName]: next }
    })
  }, [])
  /** 一次合并多列，减少含税/不含税联动时的重复 setState 与整表重算 */
  const patchPreviewRow = useCallback((sheetName: string, rowIndex: number, patch: Record<string, unknown>) => {
    setFinalRowsBySheet((prev) => {
      const rows = prev[sheetName] ?? []
      const next = rows.map((row, i) => (i === rowIndex ? { ...row, ...patch } : row))
      return { ...prev, [sheetName]: next }
    })
  }, [])
  const removePreviewRow = useCallback((sheetName: string, rowIndex: number) => {
    setFinalRowsBySheet((prev) => {
      const rows = (prev[sheetName] ?? []).filter((_, i) => i !== rowIndex)
      return { ...prev, [sheetName]: rows }
    })
  }, [])

  const resolveUnitPriceConflict = useCallback(
    (basis: 'excl' | 'incl') => {
      if (!unitPriceConflict) return
      const { sheetName, rowIndex, row } = unitPriceConflict
      const patch: Record<string, unknown> =
        basis === 'excl'
          ? {
              unit_price_excl_tax: row.unit_price_excl_tax,
              unit_price_incl_tax: calcInclFromExclPreview(Number(row.unit_price_excl_tax), row.tax_rate),
            }
          : {
              unit_price_incl_tax: row.unit_price_incl_tax,
              unit_price_excl_tax: calcExclFromInclPreview(Number(row.unit_price_incl_tax), row.tax_rate),
            }
      const merged = mergePreviewRow(row, patch)
      const derived = computePreviewDerivedPatch(merged)
      conflictResolveNextRef.current = true
      patchPreviewRow(sheetName, rowIndex, { ...patch, ...derived })
      setUnitPriceConflict(null)
    },
    [unitPriceConflict, patchPreviewRow],
  )

  const handleNumericPreviewField = useCallback(
    (sheetName: string, rowIndex: number, key: string, value: number | null, row: ReviewRow) => {
      if (key === 'amount_excl_tax' || key === 'amount_incl_tax') {
        setPreviewRow(sheetName, rowIndex, key, value)
        return
      }
      if (key === 'sequence_no') {
        setPreviewRow(sheetName, rowIndex, key, value)
        return
      }

      if (key === 'tax_rate') {
        const patch: Record<string, unknown> = { tax_rate: value }
        if (isFiniteNumberCell(row.unit_price_excl_tax)) {
          patch.unit_price_incl_tax = calcInclFromExclPreview(Number(row.unit_price_excl_tax), value)
        }
        const next = mergePreviewRow(row, patch)
        const derived = computePreviewDerivedPatch(next)
        patchPreviewRow(sheetName, rowIndex, { ...patch, ...derived })
        return
      }

      if (key === 'unit_price_excl_tax') {
        if (value == null) {
          const next = mergePreviewRow(row, { unit_price_excl_tax: null })
          const derived = computePreviewDerivedPatch(next)
          patchPreviewRow(sheetName, rowIndex, { unit_price_excl_tax: null, ...derived })
          return
        }
        const patch = {
          unit_price_excl_tax: value,
          unit_price_incl_tax: calcInclFromExclPreview(value, row.tax_rate),
        }
        const next = mergePreviewRow(row, patch)
        const derived = computePreviewDerivedPatch(next)
        patchPreviewRow(sheetName, rowIndex, { ...patch, ...derived })
        return
      }

      if (key === 'unit_price_incl_tax') {
        if (value == null) {
          const next = mergePreviewRow(row, { unit_price_incl_tax: null })
          const derived = computePreviewDerivedPatch(next)
          patchPreviewRow(sheetName, rowIndex, { unit_price_incl_tax: null, ...derived })
          return
        }
        const merged = mergePreviewRow(row, { unit_price_incl_tax: value })
        if (isFiniteNumberCell(merged.unit_price_excl_tax) && detectUnitPriceConflict(merged).conflict) {
          setUnitPriceConflict({ sheetName, rowIndex, row: merged })
          return
        }
        const patch: Record<string, unknown> = { unit_price_incl_tax: value }
        if (!isFiniteNumberCell(row.unit_price_excl_tax)) {
          patch.unit_price_excl_tax = calcExclFromInclPreview(value, row.tax_rate)
        }
        const derived = computePreviewDerivedPatch(mergePreviewRow(row, patch))
        patchPreviewRow(sheetName, rowIndex, { ...patch, ...derived })
        return
      }

      if (key === 'quantity') {
        const merged = mergePreviewRow(row, { quantity: value })
        if (detectUnitPriceConflict(merged).conflict) {
          setUnitPriceConflict({ sheetName, rowIndex, row: merged })
          return
        }
        const derived = computePreviewDerivedPatch(merged)
        patchPreviewRow(sheetName, rowIndex, { quantity: value, ...derived })
        return
      }

      setPreviewRow(sheetName, rowIndex, key, value)
    },
    [patchPreviewRow, setPreviewRow],
  )

  useEffect(() => {
    if (!conflictResolveNextRef.current) return
    conflictResolveNextRef.current = false
    const first = findFirstUnitPriceConflict(finalRowsBySheet)
    if (first) setUnitPriceConflict(first)
  }, [finalRowsBySheet])

  const addPreviewRow = useCallback((sheetName: string) => {
    const defaultRow: ReviewRow = {
      _key: `new-${sheetName}-${Date.now()}`,
      sequence_no: null,
      goods_name: '',
      brand: null,
      model: null,
      params: null,
      unit: null,
      quantity: null,
      unit_price_excl_tax: null,
      unit_price_incl_tax: null,
      amount_excl_tax: null,
      amount_incl_tax: null,
      tax_rate: PREVIEW_DEFAULT_TAX_PERCENT,
      remark: null,
      project_name: projectName || null,
      sheet_name: sheetName,
    }
    setFinalRowsBySheet((prev) => ({
      ...prev,
      [sheetName]: [...(prev[sheetName] ?? []), defaultRow],
    }))
  }, [projectName])

  /** 列定义按 Sheet 名缓存：仅在解析结果变化时重建，编辑单元格不重建 columns */
  const previewColumnsBySheet = useMemo(() => {
    const ops: PreviewPatchOps = { setPreviewRow, patchPreviewRow, removePreviewRow, handleNumericPreviewField }
    const m: Record<string, ColumnsType<ReviewRow>> = {}
    for (const one of parseResults) {
      m[one.sheetName] = buildPreviewTableColumns(one.sheetName, ops)
    }
    return m
  }, [parseResults, setPreviewRow, patchPreviewRow, removePreviewRow, handleNumericPreviewField])

  /** 单行金额解析（与 mapToCostListItems 一致：优先用已有金额，否则按数量×单价×税率计算） */
  const resolveRowAmounts = useCallback((row: ReviewRow): { amountExcl: number; amountIncl: number } => {
    const m = getPreviewTaxMultiplier(row.tax_rate)
    const qty = row.quantity != null ? Number(row.quantity) : null
    const unitIncl = row.unit_price_incl_tax != null ? Number(row.unit_price_incl_tax) : row.cost_price != null ? Number(row.cost_price) : null
    const unitExcl = row.unit_price_excl_tax != null ? Number(row.unit_price_excl_tax) : unitIncl != null ? Math.round((unitIncl / m) * 100) / 100 : null
    const amountIncl = row.amount_incl_tax != null ? Number(row.amount_incl_tax) : row.cost_amount != null ? Number(row.cost_amount) : unitIncl != null && qty != null ? Math.round(unitIncl * qty * 100) / 100 : unitExcl != null && qty != null ? Math.round(unitExcl * qty * m * 100) / 100 : 0
    const amountExcl =
      row.amount_excl_tax != null
        ? Number(row.amount_excl_tax)
        : row.amount_incl_tax != null
          ? Math.round((Number(row.amount_incl_tax) / m) * 100) / 100
          : Math.round((amountIncl / m) * 100) / 100
    return { amountExcl, amountIncl }
  }, [])

  /** 按 sheet 汇总金额（直接扫 finalRowsBySheet，避免先克隆整表数据源） */
  const previewTotalsBySheet = useMemo(() => {
    const out: Record<string, { sumExcl: number; sumIncl: number }> = {}
    for (const one of parseResults) {
      const rows = finalRowsBySheet[one.sheetName] ?? []
      let sumExcl = 0
      let sumIncl = 0
      for (const row of rows) {
        const { amountExcl, amountIncl } = resolveRowAmounts(row)
        sumExcl += amountExcl
        sumIncl += amountIncl
      }
      out[one.sheetName] = { sumExcl, sumIncl }
    }
    return out
  }, [parseResults, finalRowsBySheet, resolveRowAmounts])

  return (
    <div style={{ padding: 24 }}>
      {reauthModal}
      <Modal
        title="含税单价与不含税单价不一致"
        open={unitPriceConflict != null}
        onCancel={() => setUnitPriceConflict(null)}
        footer={null}
        destroyOnHidden
      >
        {unitPriceConflict && (
          <>
            <Typography.Paragraph>
              当前税率下，含税单价应约为：不含税单价 × (1+税率)。二者与「按税率推算含税单价」差异超过 {UNIT_PRICE_CONFLICT_TOL}{' '}
              元。请选择以哪一侧为准，系统将据此重算另一单价与两行金额。
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
              不含税单价：{formatPreviewMoneyDisplay(Number(unitPriceConflict.row.unit_price_excl_tax))}；含税单价：
              {formatPreviewMoneyDisplay(Number(unitPriceConflict.row.unit_price_incl_tax))}；按税率推算含税单价：
              {formatPreviewMoneyDisplay(
                calcInclFromExclPreview(Number(unitPriceConflict.row.unit_price_excl_tax), unitPriceConflict.row.tax_rate),
              )}
            </Typography.Paragraph>
            <Space wrap>
              <Button type="primary" onClick={() => resolveUnitPriceConflict('excl')}>
                以不含税单价为准
              </Button>
              <Button onClick={() => resolveUnitPriceConflict('incl')}>以含税单价为准</Button>
            </Space>
          </>
        )}
      </Modal>
      <Title level={4}>项目维护 - 智能格式化</Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        <strong>功能介绍：</strong>支持成本清单、报价清单的 Excel 上传，系统将自动识别表头与列映射、进行数据清洗，确认后可存入成本清单或报价清单。也可将不标准的表格格式化为标准结构后下载或入库。
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
        <strong>多 Sheet 说明：</strong>每次最多处理 5 个工作表；若 Excel 包含超过 5 个 Sheet，请分批选择要解析的 Sheet 或拆分文件后分别处理。
      </Typography.Paragraph>

      <Card title="1. 上传并解析" style={{ marginTop: 16 }}>
        <Space align="start" wrap size="middle">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f && isExcelFile(f)) setFileFromFile(f)
              e.target.value = ''
            }}
          />
          <Upload.Dragger
            accept=".xlsx,.xls"
            fileList={fileList}
            maxCount={1}
            openFileDialogOnClick={false}
            beforeUpload={(file) => {
              setFileFromFile(file)
              return false
            }}
            onRemove={handleRemoveFile}
            onChange={({ file, fileList: next }) => {
              const rawFile =
                (file && 'originFileObj' in file && file.originFileObj instanceof File && file.originFileObj) ||
                (file instanceof File ? file : null)
              if (rawFile) lastSelectedFileRef.current = rawFile
              setFileList((prev) => {
                if (!next.length) {
                  lastSelectedFileRef.current = null
                  return next
                }
                const cur = next[0]
                if (prev[0]?.originFileObj && prev[0].name === cur.name && !(cur.originFileObj instanceof File))
                  return prev
                if (cur.originFileObj instanceof File) return next
                const fileToUse = rawFile || lastSelectedFileRef.current
                if (fileToUse && (cur.name === fileToUse.name || !cur.name))
                  return [{ ...cur, originFileObj: fileToUse } as UploadFile]
                const prevItem = prev[0]
                if (prevItem?.originFileObj && (prevItem.name === cur.name || prevItem.uid === cur.uid))
                  return [{ ...cur, originFileObj: prevItem.originFileObj } as UploadFile]
                return next
              })
            }}
            showUploadList={{ showPreviewIcon: false }}
            style={{ width: 280 }}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                fileInputRef.current?.click()
              }}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              style={{ outline: 'none', padding: 0 }}
            >
              <p className="ant-upload-drag-icon">
                <UploadOutlined style={{ fontSize: 40, color: 'var(--ant-colorPrimary)' }} />
              </p>
              <Tooltip title="上传不标准的 Excel 价格表，系统将识别表头并匹配为标准字段，便于后续入库或下载标准格式。">
                <p className="ant-upload-text">点击或拖拽文件到此处</p>
              </Tooltip>
              <p className="ant-upload-hint">支持 .xlsx / .xls，也可 Ctrl+V 粘贴已复制的文件</p>
            </div>
          </Upload.Dragger>
          {sheetList.length > 0 && (
            <Space align="center">
              <Tooltip title="上传后默认已全选所有工作表；可取消部分。解析与入库时均保留各 Sheet 名称。">
                <span>
                  <Text type="secondary">选择要解析的 Sheet（默认全选，可多选）：</Text>
                  <Select
                mode="multiple"
                value={selectedSheetIndices}
                onChange={setSelectedSheetIndices}
                loading={sheetsLoading}
                style={{ minWidth: 220 }}
                placeholder="至少选一个"
                options={sheetList.map((s) => ({
                  value: s.index,
                  label: s.hasData ? `${s.name} (有数据)` : s.name,
                }))}
              />
              </span>
              </Tooltip>
              {sheetList.length > 1 && (
                <Text type="secondary">共 {sheetList.length} 个 Sheet</Text>
              )}
            </Space>
          )}
          <Tooltip
            title={
              sheetsLoading
                ? '正在读取工作表列表，请稍候…'
                : '按「已选 Sheet」升序每次最多解析 5 个；解析完一批后可再次点击继续后续 Sheet。更换勾选会从头计数。'
            }
          >
            <span>
              <Button type="primary" loading={parseLoading} onClick={handleParse} icon={<FileTextOutlined />} disabled={sheetsLoading}>
                解析并识别映射
              </Button>
            </span>
          </Tooltip>
          {sheetList.length > 0 && (
            <Tooltip title="清空已合并的解析结果，游标回到第 1 个已选 Sheet；下次仍每批最多 5 个。">
              <Button onClick={resetSheetParseBatch} disabled={parseLoading}>
                重置解析批次
              </Button>
            </Tooltip>
          )}
          {parseProgress && (
            <Text type="secondary">
              正在解析第 {parseProgress.current}/{parseProgress.total} 个 Sheet
              {parseProgress.stepMessage ? `：${parseProgress.stepMessage}` : '…'}
            </Text>
          )}
        </Space>

        <Modal
          title="数据清洗：按 Sheet 确认是否删除以下行"
          open={!!filterPreviewState}
          onCancel={() => setFilterPreviewState(null)}
          width={760}
          footer={null}
          destroyOnClose
          maskClosable={false}
        >
          {filterPreviewState && (
            <>
              <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                每个 Sheet 可独立选择「本 Sheet 确认删除」或「本 Sheet 保留全部」。可勾选/取消单行以决定该行是否删除。全部 Sheet 均选择后，点击底部「全部确认完毕，继续解析」。
              </Text>
              <Tabs
                size="small"
                items={filterPreviewState.bySheet.map((s) => {
                  const { sheetName, filterPreview, confirmChoice, selectedRowIndices } = s
                  const selectedSet = new Set(selectedRowIndices)
                  const allCount = filterPreview.rowsToRemove.length
                  const selectedCount = selectedRowIndices.length
                  return {
                    key: sheetName,
                    label: (
                      <span>
                        {sheetName}
                        （待删 {allCount} 行）
                        {confirmChoice === 'delete' && (
                          <Tag color="blue" style={{ marginLeft: 4 }}>
                            删除 {selectedCount} 行
                          </Tag>
                        )}
                        {confirmChoice === 'keep' && (
                          <Tag color="default" style={{ marginLeft: 4 }}>
                            保留全部
                          </Tag>
                        )}
                      </span>
                    ),
                    children: (
                      <div style={{ maxHeight: 400, overflow: 'auto' }}>
                        {filterPreview.rolledBack && (
                          <Text type="warning" style={{ display: 'block', marginBottom: 8 }}>
                            因数据完整性校验已回退，未实际删除。选择「本 Sheet 保留全部」将不删除任何行。
                          </Text>
                        )}
                        <Space style={{ marginBottom: 8 }}>
                          <Button size="small" type="primary" onClick={() => setSheetFilterChoice(sheetName, 'delete')}>
                            本 Sheet 确认删除
                          </Button>
                          <Button size="small" onClick={() => setSheetFilterChoice(sheetName, 'keep')}>
                            本 Sheet 保留全部
                          </Button>
                          {allCount > 0 && (
                            <>
                              <Checkbox
                                checked={selectedCount === allCount}
                                indeterminate={selectedCount > 0 && selectedCount < allCount}
                                onChange={(e) => setSheetSelectAllRows(sheetName, e.target.checked)}
                              >
                                全选待删行
                              </Checkbox>
                              <Text type="secondary">已勾选 {selectedCount} / {allCount} 行（选择「本 Sheet 确认删除」后将删除勾选行）</Text>
                            </>
                          )}
                        </Space>
                        <Table
                          size="small"
                          rowKey={(r) => `${r.rowIndex}-${r.type}`}
                          dataSource={filterPreview.rowsToRemove}
                          pagination={{ pageSize: 20 }}
                          columns={[
                            ...(allCount > 0
                              ? [
                                  {
                                    title: '删除',
                                    width: 56,
                                    render: (_: unknown, row: RowToRemoveItem) => (
                                      <Checkbox
                                        checked={selectedSet.has(row.rowIndex)}
                                        onChange={() => toggleSheetRowSelected(sheetName, row.rowIndex)}
                                      />
                                    ),
                                  },
                                ]
                              : []),
                            { title: '原行号', dataIndex: 'rowIndex', width: 72, render: (v: number) => v + 1 },
                            {
                              title: '类型',
                              dataIndex: 'type',
                              width: 90,
                              render: (t: string) => ROW_TYPE_LABELS[t] ?? t,
                            },
                            {
                              title: '内容',
                              dataIndex: 'cells',
                              render: (cells: string[]) => (
                                <Text ellipsis style={{ maxWidth: 380 }}>
                                  {(cells || []).map((c) => String(c ?? '').trim()).filter(Boolean).join(' | ') || '—'}
                                </Text>
                              ),
                            },
                          ]}
                        />
                      </div>
                    ),
                  }
                })}
              />
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <Text type="secondary">
                  {filterPreviewState.bySheet.every((s) => s.confirmChoice !== null)
                    ? '已为每个 Sheet 选择完毕，可点击右侧按钮继续解析'
                    : `已选择 ${filterPreviewState.bySheet.filter((s) => s.confirmChoice !== null).length} / ${filterPreviewState.bySheet.length} 个 Sheet`}
                </Text>
                <Space>
                  <Button onClick={() => setFilterPreviewState(null)}>取消</Button>
                  <Button
                    type="primary"
                    onClick={() => handleConfirmFilter()}
                    loading={parseLoading}
                    disabled={filterPreviewState.bySheet.some((s) => s.confirmChoice === null)}
                  >
                    全部确认完毕，继续解析
                  </Button>
                </Space>
              </div>
            </>
          )}
        </Modal>

        <Modal
          title="二次过滤：货物名称为空的行"
          open={!!emptyGoodsNameConfirm}
          onCancel={() => setEmptyGoodsNameConfirm(null)}
          footer={null}
          width={640}
          destroyOnClose
        >
          {emptyGoodsNameConfirm && (
            <>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                以下行映射到「货物名称」列为空，删除后将不参与入库与下载。是否确认删除？
              </Typography.Paragraph>
              {emptyGoodsNameConfirm.bySheet.map(({ sheetName, fullRows, indicesToRemove }) => (
                <div key={sheetName} style={{ marginBottom: 16 }}>
                  <Text strong>{sheetName}</Text>
                  <span style={{ marginLeft: 8, color: '#666' }}>共 {indicesToRemove.length} 行</span>
                  <Table
                    size="small"
                    dataSource={indicesToRemove.map((i) => ({ ...fullRows[i], _rowIndex: i + 1 }))}
                    rowKey="_rowIndex"
                    pagination={indicesToRemove.length > 10 ? { pageSize: 10 } : false}
                    scroll={{ y: 200 }}
                    columns={[
                      { title: '行号', dataIndex: '_rowIndex', width: 64 },
                      { title: '货物名称', dataIndex: 'goods_name', render: () => <Text type="secondary">（空）</Text> },
                      { title: '型号', dataIndex: 'model', ellipsis: true, render: (v: unknown) => (v != null ? String(v) : '—') },
                      { title: '数量', dataIndex: 'quantity', width: 80, render: (v: unknown) => (v != null ? String(v) : '—') },
                    ]}
                  />
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <Button onClick={() => setEmptyGoodsNameConfirm(null)}>取消</Button>
                <Button
                  type="primary"
                  onClick={() => {
                    if (!emptyGoodsNameConfirm) return
                    setFinalRowsBySheet((prev) => {
                      const next = { ...prev }
                      for (const { sheetName, fullRows, indicesToRemove } of emptyGoodsNameConfirm.bySheet) {
                        const set = new Set(indicesToRemove)
                        next[sheetName] = fullRows.filter((_, i) => !set.has(i))
                      }
                      return next
                    })
                    const totalRemoved = emptyGoodsNameConfirm.bySheet.reduce((s, x) => s + x.indicesToRemove.length, 0)
                    msg.success(`已删除 ${totalRemoved} 行货物名称为空的数据`)
                    setEmptyGoodsNameConfirm(null)
                  }}
                >
                  确认删除
                </Button>
              </div>
            </>
          )}
        </Modal>

        {parseLogLines.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>解析进度日志</Text>
            <div
              style={{
                padding: '12px 14px',
                background: '#1e1e1e',
                color: '#d4d4d4',
                borderRadius: 8,
                maxHeight: 220,
                overflowY: 'auto',
                fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Monaco, Consolas, monospace',
                fontSize: 12,
                lineHeight: 1.65,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
              }}
            >
              {parseLogLines.map((line, idx) => (
                <div key={idx} style={{ color: '#d4d4d4' }}>{line}</div>
              ))}
              {parseStreamingLine && <div style={{ color: '#4ec9b0' }}>LLM 返回：{parseStreamingLine}</div>}
              <div ref={parseLogEndRef} />
            </div>
          </div>
        )}
        {parseResults.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Text type="secondary">
              已解析 {parseResults.length} 个 Sheet；请在步骤 2 确认各 Sheet 映射后，步骤 3 才会生成标准数据预览。
            </Text>
          </div>
        )}
      </Card>

      <Card title="2. 映射确认与修改（按 Sheet 分 Tab）" style={{ marginTop: 16 }}>
        {parseResults.length > 0 ? (
          <Tabs
            activeKey={activeMappingTab || parseResults[0]?.sheetName}
            onChange={setActiveMappingTab}
            type="card"
            items={parseResults.map((one) => ({
              key: one.sheetName,
              label: one.sheetName,
              children: (
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    表头行：第 {one.headerRowIndex + 1} 行，数据行：{one.dataRows?.length ?? 0} 条
                  </Text>
                  <Table
                    size="small"
                    dataSource={one.mapping}
                    rowKey="colIndex"
                    pagination={false}
                    columns={[
                      { title: '列序号', dataIndex: 'colIndex', width: 80, render: (i: number) => i + 1 },
                      { title: '原始表头', dataIndex: 'originalHeader', ellipsis: true },
                      {
                        title: '映射到标准列',
                        dataIndex: 'standardKey',
                        render: (val: string | null, row: ColumnMappingItem) => (
                          <Select
                            value={val ?? undefined}
                            placeholder="不映射"
                            allowClear
                            style={{ width: 160 }}
                            options={[
                              { value: '', label: '（不映射）' },
                              ...STANDARD_KEYS.map((k) => ({ value: k, label: COLUMN_TITLES[k] ?? k })),
                            ]}
                            onChange={(v) => updateMapping(one.sheetName, row.colIndex, v || null)}
                          />
                        ),
                      },
                      { title: '来源', dataIndex: 'source', width: 90, render: (s: ColumnMappingItem['source']) => sourceTag(s) },
                      {
                        title: '操作',
                        key: 'addRule',
                        width: 100,
                        render: (_: unknown, row: ColumnMappingItem) => {
                          const norm = normalizeHeaderForRule(row.originalHeader ?? '')
                          const alreadyInRules = norm ? addedRuleHeaders.has(norm) || existingRuleHeaders.has(norm) : true
                          if (row.source !== 'llm') return <Typography.Text type="secondary">—</Typography.Text>
                          if (alreadyInRules)
                            return (
                              <Tooltip title="该表头已在规则库中，无需重复加入。">
                                <Typography.Text type="secondary">已加入</Typography.Text>
                              </Tooltip>
                            )
                          return (
                            <Tooltip title="将 LLM 识别的此映射加入规则库，后续解析同表头将优先命中。">
                              <Button
                                type="link"
                                size="small"
                                onClick={() => handleAddToRules(row.originalHeader, row.standardKey!)}
                              >
                                加入规则
                              </Button>
                            </Tooltip>
                          )
                        },
                      },
                    ]}
                  />
                  <Tooltip title="确认当前 Sheet 的列映射后，将原始数据转为标准格式并生成下方预览表格，可再编辑或入库。">
                    <span>
                      <Button
                        type="primary"
                        loading={confirmLoading}
                        onClick={() => handleConfirmMapping(one.sheetName)}
                        icon={<CheckOutlined />}
                        style={{ marginTop: 12 }}
                      >
                        确认本 Sheet 映射并生成标准数据
                      </Button>
                    </span>
                  </Tooltip>
                </div>
              ),
            }))}
          />
        ) : (
          <Typography.Text type="secondary">
            请先在上方上传并解析 Excel，解析后将在此处按 Sheet 展示映射表供确认与修改。
          </Typography.Text>
        )}
      </Card>

      <Card
        title="3. 标准数据预览与入库（按 Sheet 分 Tab，还原 Excel 多表结构）"
        style={{ marginTop: 16 }}
      >
        <Space style={{ marginBottom: 12 }} wrap align="center">
          <Tooltip title="入库时写入每条数据的 project_name，可从已有项目中选择或输入新项目名。">
            <span>
              <Typography.Text>关联项目：</Typography.Text>
              <Input
                placeholder="项目名称（入库时写入 project_name）"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                style={{ width: 220 }}
              />
            </span>
          </Tooltip>
          <Tooltip title="勾选要参与入库、下载 Excel、另存为的 Sheet；未勾选的表仍可在 Tab 中预览编辑。新解析出的表默认会加入勾选。">
            <span>
              <Typography.Text type="secondary">存入范围：</Typography.Text>
              <Select
                mode="multiple"
                allowClear
                placeholder="选择 Sheet"
                maxTagCount="responsive"
                value={saveSheetNames}
                onChange={(v) => setSaveSheetNames(v)}
                style={{ minWidth: 280, maxWidth: 480 }}
                options={saveSheetSelectOptions.map((name) => ({
                  value: name,
                  label: `${name}（${finalRowsBySheet[name]?.length ?? 0} 行）`,
                }))}
              />
            </span>
          </Tooltip>
        </Space>
        <Space style={{ marginTop: 12 }} wrap>
          <Tooltip title="将当前预览的标准数据存入系统的成本清单或报价清单，点击后需在弹窗中选择存入成本或报价。">
            <span>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={saveLoading}
                disabled={!hasConfirmed || !rowsForSave.length}
                onClick={() => {
                  if (!rowsForSave.length) return
                  openSaveTargetModal()
                }}
              >
                存入数据库
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="把不标准的 Excel 价格表格式化为标准的价格格式后下载，以便填写。">
            <span>
              <Button icon={<DownloadOutlined />} loading={downloadLoading} disabled={!rowsForSave.length} onClick={handleDownloadExcel}>
                下载 Excel
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="查看、覆盖或删除已保存的结构化 JSON 文件。">
            <Button type="default" icon={<FolderOpenOutlined />} onClick={openFilesModal}>
              已保存文件
            </Button>
          </Tooltip>
          <Tooltip title="将当前预览数据另存为 JSON 文件，便于备份或后续导入。">
            <span>
              <Button type="default" disabled={!rowsForSave.length} onClick={() => { setSaveAsModalOpen(true); setSaveAsFilename(''); }}>
                另存为文件
              </Button>
            </span>
          </Tooltip>
        </Space>

        {/* 表格 / 数据结构预览：持久显示，无数据时为空状态 */}
        {parseResults.length > 0 ? (
          <>
            <div style={{ marginTop: 16, marginBottom: 12 }}>
              <Tooltip title="表格：可编辑的列表视图；数据结构预览：查看完整 JSON 结构。">
                <span>
                  <Segmented
                    options={[
                      { label: '表格', value: 'table' },
                      { label: '数据结构预览', value: 'json' },
                    ]}
                    value={displayMode}
                    onChange={(v) => setDisplayMode(v as 'table' | 'json')}
                  />
                </span>
              </Tooltip>
            </div>
            {displayMode === 'table' && (
              <div style={{ marginTop: 0 }}>
                <Tabs
                  activeKey={activePreviewTab || parseResults[0]?.sheetName}
                  onChange={setActivePreviewTab}
                  type="card"
                  tabPosition="bottom"
                  style={{ marginTop: 8 }}
                  destroyOnHidden
                  items={parseResults.map((one) => {
                    const rawRows = finalRowsBySheet[one.sheetName] ?? []
                    const totals = previewTotalsBySheet[one.sheetName] ?? { sumExcl: 0, sumIncl: 0 }
                    const cols = previewColumnsBySheet[one.sheetName]
                    const confirmed = rawRows.length > 0
                    return {
                      key: one.sheetName,
                      label: confirmed ? `${one.sheetName}（${rawRows.length} 行）` : `${one.sheetName}（未确认映射）`,
                      children: cols ? (
                        confirmed ? (
                          <PreviewSheetTable
                            sheetName={one.sheetName}
                            rawRows={rawRows}
                            columns={cols}
                            totals={totals}
                            addPreviewRow={addPreviewRow}
                          />
                        ) : (
                          <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
                            请先在步骤 2 中对该 Sheet 点击「确认本 Sheet 映射并生成标准数据」，生成后此处显示可编辑预览表。
                          </Typography.Paragraph>
                        )
                      ) : null,
                    }
                  })}
                />
              </div>
            )}
            {displayMode === 'json' && (
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  background: 'var(--ant-colorFillQuaternary)',
                  borderRadius: 6,
                  fontSize: 12,
                  maxHeight: 480,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {rowsForSave.length > 0
                  ? JSON.stringify(rowsForSave.map(({ _key, ...rest }) => rest), null, 2)
                  : '当前无可预览数据（请先在上方确认本 Sheet 映射并生成标准数据）。'}
              </pre>
            )}
          </>
        ) : (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
            请先完成上传、解析并确认映射后，此处将显示标准数据预览（表格 / JSON）与入库操作。
          </Typography.Text>
        )}
      </Card>

      <Modal
        title="覆盖确认"
        open={overwriteModalOpen}
        onCancel={() => setOverwriteModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setOverwriteModalOpen(false)}>取消</Button>,
          <Tooltip key="overwrite-tt" title="用当前数据替换该项目下已有报价数据，原有报价将被覆盖。">
            <span>
              <Button key="overwrite" type="primary" danger loading={saveLoading} onClick={() => doSaveToDb('quote', true)}>覆盖并存入报价清单</Button>
            </span>
          </Tooltip>,
        ]}
      >
        <Typography.Text>项目「{overwriteProjectName}」已有报价数据，是否覆盖？</Typography.Text>
      </Modal>

      <Modal
        title="确认关联项目名称"
        open={projectNameModalOpen}
        onCancel={() => setProjectNameModalOpen(false)}
        onOk={confirmProjectNameModal}
        okText="确定"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ padding: '8px 0' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            请确认本清单关联的项目名称，解析与入库时将使用该项目名。可从已有项目中选择或直接输入，默认为当前文件名（已去后缀）。
          </Typography.Paragraph>
          <AutoComplete
            style={{ width: '100%' }}
            placeholder="项目名称（默认：当前文件名）"
            value={projectNameModalValue}
            onChange={setProjectNameModalValue}
            options={existingProjectNames.map((name) => ({ value: name }))}
            notFoundContent={existingProjectNamesLoading ? '加载中…' : '可输入新项目名称'}
          />
        </div>
      </Modal>
      <SaveTargetModal
        open={saveTargetModalOpen}
        onCancel={() => setSaveTargetModalOpen(false)}
        rowsCount={rowsForSave.length}
        defaultChoice={detectListTypeFromFileName(fileList[0]?.name ?? parseResults[0]?.fileName ?? '')}
        onConfirm={handleConfirmSaveToDb}
        saveLoading={saveLoading}
      />

      <Modal
        title="已保存的结构化文件"
        open={filesModalOpen}
        onCancel={() => setFilesModalOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <Table
          size="small"
          loading={filesLoading}
          dataSource={exportedFilesList}
          rowKey="filename"
          pagination={{ pageSize: 10 }}
          scroll={{ y: '50vh' }}
          columns={[
            { title: '文件名', dataIndex: 'filename', ellipsis: true, width: 200 },
            { title: '项目', dataIndex: 'project_name', ellipsis: true, width: 120 },
            { title: '类型', dataIndex: 'list_type', width: 72, render: (v: string) => (v === 'cost' ? '成本清单' : '报价清单') },
            { title: '条数', dataIndex: 'item_count', width: 64, align: 'right' },
            { title: '保存时间', dataIndex: 'saved_at', width: 160, render: (v: string) => (v ? v.replace('T', ' ').slice(0, 19) : '') },
            {
              title: '操作',
              key: 'action',
              width: 320,
              render: (_, record: { filename: string; project_name: string; list_type: 'cost' | 'quote' }) => (
                <Space size="small" wrap>
                  <Tooltip title="将该文件的数据加载到下方预览区，可编辑后重新入库。">
                    <Button type="link" size="small" onClick={() => handleReloadFile(record.filename, record.project_name, record.list_type)}>
                      加载
                    </Button>
                  </Tooltip>
                  <Tooltip title="在弹窗中查看该文件的 JSON 内容。">
                    <Button type="link" size="small" onClick={() => handleViewFile(record.filename)}>
                      查看
                    </Button>
                  </Tooltip>
                  <Tooltip title="将该文件的数据导出为标准 Excel 格式下载。">
                    <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => handleExportFileAsExcel(record.filename)}>
                      导出Excel
                    </Button>
                  </Tooltip>
                  <Tooltip title="用当前表格中的数据覆盖该文件内容。">
                    <span>
                      <Button type="link" size="small" disabled={!rowsForSave.length} onClick={() => handleOverwriteFile(record.filename, record.list_type)}>
                        覆盖更新
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip title="从已保存列表中删除该文件，不可恢复。">
                    <span>
                      <Popconfirm title="确定删除该文件？" onConfirm={() => handleDeleteFile(record.filename)} okText="删除" cancelText="取消">
                        <Button type="link" danger size="small">
                          删除
                        </Button>
                      </Popconfirm>
                    </span>
                  </Tooltip>
                </Space>
              ),
            },
          ]}
        />
      </Modal>
      <Modal
        title={`查看：${viewFileName}`}
        open={!!viewFileContent}
        onCancel={() => { setViewFileContent(null); setViewFileName(''); }}
        footer={null}
        width={640}
        destroyOnClose
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <pre style={{ maxHeight: '60vh', overflow: 'auto', fontSize: 12, background: '#f5f5f5', padding: 12, borderRadius: 4, margin: 0 }}>{viewFileContent}</pre>
      </Modal>
      <Modal
        title="另存为文件"
        open={saveAsModalOpen}
        onCancel={() => { setSaveAsModalOpen(false); setSaveAsFilename(''); }}
        onOk={handleSaveAsFile}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ padding: '8px 0' }}>
          <div style={{ marginBottom: 8 }}>文件名（.json 可省略）：</div>
          <Input
            placeholder="例如：项目A_报价.json"
            value={saveAsFilename}
            onChange={(e) => setSaveAsFilename(e.target.value)}
            onPressEnter={() => handleSaveAsFile()}
          />
        </div>
      </Modal>
      <Modal
        title="覆盖更新文件"
        open={!!updateTargetFilename}
        onCancel={() => setUpdateTargetFilename(null)}
        onOk={confirmOverwriteFile}
        okText="覆盖"
        cancelText="取消"
      >
        <Typography.Paragraph>
          将用当前表格中的 {rowsForSave.length} 条数据覆盖文件「{updateTargetFilename}」，是否继续？
        </Typography.Paragraph>
      </Modal>
    </div>
  )
}

export default DocTasksExcelFormatPage
