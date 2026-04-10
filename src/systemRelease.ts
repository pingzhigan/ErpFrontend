/**
 * 系统对外展示版本与更新说明
 *
 * 用途：`App.tsx` 顶栏「系统信息」弹窗展示 `APP_VERSION` 与 `SYSTEM_RELEASE_NOTES`（从新到旧）。
 * 维护约定：
 * - 发版时同步提高 `APP_VERSION`，并在 `SYSTEM_RELEASE_NOTES` **数组首部**新增一条 `{ version, date?, items }`。
 * - `items` 面向最终用户或实施人员：说明「能感知到的变化」；技术细节可写进条目内子句，无需在此文件写长文架构说明（见 README）。
 * - 版本号建议 semver；同次迭代多项改动可合并进同一 `version` 的多条 `items`。
 */

export type SystemReleaseEntry = {
  version: string
  /** 可选：发布日期或迭代周期，如 2026-04 */
  date?: string
  items: string[]
}

/** 当前对外版本号（与更新说明首条 version 建议保持一致） */
export const APP_VERSION = '2.0.2'

/** 从新到旧排列；弹窗内按此顺序展示 */
export const SYSTEM_RELEASE_NOTES: SystemReleaseEntry[] = [
  {
    version: '2.0.2',
    date: '2026-04-11',
    items: [
      '优化了excel表格智能格式化的入库逻辑',
      '优化了创建进度任务的匹配逻辑',
      '增加了零星工程可编辑的逻辑',
      '修改了业务排单的分类',
      '修复了一些BUG',
      '优化了小程序的页面风格',
    ],
  },
  {
    version: '2.0.1',
    date: '2026-04-5',
    items: [
      '进度管理：批量创建支持按 Sheet 筛选、跨页全选；已有进度任务的项目也可再次从报价清单批量追加（同项目同工作表同施工内容自动去重跳过）。',
    ],
  },
]
