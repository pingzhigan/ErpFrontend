# React + TypeScript + Vite

本仓库为弱电管理后台前端，基于 React + TypeScript + Vite 构建。以下为前端页面与入口的自述说明。

## 前端页面与入口说明

### 页面（pages/）

| 文件 | 功能名称 | 说明概要 |
|------|----------|----------|
| Login.tsx | 登录页 | 账号密码登录、AuthContext 认证、登录后回跳 |
| Dashboard.tsx | 仪表盘 | 统计与经营汇总、最近操作日志 |
| Knowledge.tsx | 知识库管理 | 知识条目与附件、类型/系统筛选、Markdown 预览 |
| InventoryStockIn.tsx | 库存入库 | 手动/自然语言入库、必填校验、SKU 冲突处理 |
| InventoryStockOut.tsx | 库存出库 | 手动/自然语言出库、与库存匹配、数量校验 |
| InventoryQuery.tsx | 库存查询 | 多条件查询、分页、单条编辑与删除 |
| InventoryMaintain.tsx | 库存维护 | 文档解析导入、冲突确认、批量写入库存 |
| Projects.tsx | 项目列表 | 项目汇总、回款抽屉、软删除 |
| Opportunities.tsx | 机会管理列表 | 机会 CRUD、阶段筛选、AI 对话创建/更新 |
| OpportunityDetail.tsx | 机会详情 | 详情展示、附件与跟进、AI 优化 |
| Products.tsx | 商品清单 | 按项目/全局商品、分组排序、CRUD |
| ConfigOrders.tsx | 配单管理 | 配单主从表、明细编辑与汇总、导出与历史 |
| AutoConfig.tsx | 智能配单 | 文件上传、规则/向量解析、表头映射、保存为配单或商品 |
| ProjectProductList.tsx | 项目商品与成本 | 项目维度的商品/成本/附件/回款聚合 |
| CostList.tsx | 成本清单 | 成本明细 CRUD、按项目筛选与删除 |
| Rules.tsx | 规则管理 | 规则 CRUD、条件与动作配置、AI 辅助 |
| RuleConfig.tsx | 规则配置 | 键值配置、种子导入、详情查看与删除 |
| Formulas.tsx | 公式管理 | 公式 CRUD、系统/启用筛选、AI 辅助 |
| EquipmentSpecs.tsx | 设备规格管理 | 设备规格 CRUD、分类与系统筛选 |
| IndustryFactors.tsx | 行业系数管理 | 行业系数 CRUD、乘数/加数配置 |
| TierFactors.tsx | 档次系数管理 | 档次系数 CRUD、乘数/加数配置 |
| UserManagement.tsx | 用户与权限管理 | 用户与权限组、角色与权限控制 |
| Logs.tsx | 操作日志 | 分页日志、按动作/用户/时间筛选 |
| DocTasks.tsx | 文档任务 | 文档上传解析、审阅入库、冲突与历史 |

### 入口与上下文

| 文件 | 功能名称 | 说明概要 |
|------|----------|----------|
| App.tsx | 应用根组件与路由 | ProLayout、权限菜单、路由与页面挂载 |
| main.tsx | 前端入口 | 挂载根节点、Electron baseURL/MAC 初始化 |
| auth/AuthContext.tsx | 认证上下文 | 登录态、token、roles/permissions、权限方法 |

---

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
