# 弱电管理后台 · 前端

React 19 + TypeScript + **Vite 7** + **Ant Design 5** + **ProComponents**。通过 `axios` 调用后端 REST，菜单与接口权限键与后端 `permissions` 对齐。

## 快速开始

```bash
cd frontend && npm install
npm run dev        # http://localhost:5123 ，/api 代理到 localhost:4000
```

- 浏览器直连后端时：在 `.env` 中配置 `VITE_BACKEND_URL`（如 `http://localhost:4000`），见 `main.tsx`。
- **Electron 桌面**：`npm run electron:dev`（先起 Vite，再等 `5123` 起 Electron）；`electron:build` 产出 Windows 安装包。桌面环境由 `electronAPI` 注入后端地址与可选 `client_mac`。

## 功能结构（与路由一致）

| 区域 | 路径前缀 | 说明 |
|------|----------|------|
| 认证 | `/login`、`/forgot-password`、`/complete-email` | `AuthContext`：账号/钉钉登录、邮箱 OTP、JWT、`hasPermission` / `hasRole` |
| 仪表盘 | `/dashboard` | 汇总与日志摘要 |
| 项目管理 | `/projects`、`/project-analysis`、`/docs`、`/docs-excel-format`、`/project-products` | 列表/分析/文档解析/项目维度商品与回款等 |
| 机会 | `/opportunities`、`/opportunities/detail/:id` | 列表与详情；`/opportunity-todos` 待办（侧栏可按权限隐藏） |
| 施工 | `/construction/*` | 项目信息、进度（含批量创建）、质量/安全、施工日志、详情页 |
| 维护 | `/maintenance/*` | 零星工程、维保排单 |
| 商品与成本 | `/products`、`/cost-list`、`/config-orders` | 报价清单、成本、配单 |
| 库存 | `/inventory`、`/inventory-maintain`、入出库及明细 | `inventory` / `inventory-maintain` 分权 |
| AI / 规则 | `/auto-config`、`/rules`、`/rules/formulas`、`/knowledge` | 智能配单检查、**Excel 表头映射规则**、公式引擎、知识库 |
| 系统 | `/users`、`/users/dingtalk`、`/logs`、`/staff-handover` | 用户与钉钉集成、日志；交接需 `admin` 或 `company_management` |
| 工作台 | 顶栏提醒、`/api/workbench/push-stream`（SSE）、`/workbench/messages` | 推送与历史 |

布局与权限：`src/App.tsx` 中 `appRoutes` + `filterMenuByPermission`；受保护路由用 `RequireAuth`（`permissions` 或 `roles`）。管理员可在设置里改 LLM 提供商与 Embedding（对接后端 `/api/llm-provider`、`/api/settings/embedding`）。

版本与更新说明：`src/systemRelease.ts`（`APP_VERSION`、`SYSTEM_RELEASE_NOTES`）。

## 工程说明

- **按需加载**：业务页在 `src/lazyPages.ts` 中 `lazy()`，减轻首包。
- **权限树编辑**：`src/config/rolePermissionTree.tsx`；高危写操作二次确认：`src/hooks/useReauthModal.tsx`（`reauth_password`）。
- **钉钉**：`src/dingtalk/dingtalkClient.ts`；开发环境内置浏览器 CSP 在 `vite.config.ts` 中放宽，便于 HMR。
- **后端 API 索引**：[../backend/api-reference.md](../backend/api-reference.md)。
- **未挂路由的页面**：`pages/Rules.tsx`（业务规则）、`RuleConfig.tsx`、`IndustryFactors.tsx`、`TierFactors.tsx`、`EquipmentSpecs.tsx` 等当前未在 `App.tsx` 注册；侧栏「规则引擎」对应的是 `ExcelParseRules.tsx`（表头映射）。若要用上述页面，需在 `lazyPages.ts` 与 `App.tsx` 中补路由。

## npm 脚本

| 命令 | 用途 |
|------|------|
| `npm run dev` | Vite 开发服（端口 5123） |
| `npm run build` | `tsc -b` + 静态资源构建 |
| `npm run preview` | 预览构建结果 |
| `npm run lint` | ESLint |
| `npm run electron:dev` / `electron:build` | 桌面端开发与打包 |

ESLint、React Compiler 等可按需在 `eslint.config.js` 与 [Vite](https://vite.dev/) 文档中扩展。
