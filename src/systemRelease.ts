/**
 * 系统对外展示版本与更新说明（发布时请同步更新版本号与条目）。
 */

export type SystemReleaseEntry = {
  version: string
  /** 可选：发布日期或迭代周期，如 2026-04 */
  date?: string
  items: string[]
}

/** 当前对外版本号（与更新说明首条建议一致，便于用户对照） */
export const APP_VERSION = '1.0.0'

/** 从新到旧排列；用户弹窗内按此顺序展示 */
export const SYSTEM_RELEASE_NOTES: SystemReleaseEntry[] = [
  {
    version: '1.0.0',
    date: '2026-04',
    items: [
      '进度管理：批量创建支持按 Sheet 筛选、跨页全选；已有进度任务的项目也可再次从报价清单批量追加（同项目同工作表同施工内容自动去重跳过）。',
      '此处按版本继续追加更新说明即可。',
    ],
  },
]
