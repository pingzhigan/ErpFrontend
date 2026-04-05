# 前端打包为 Windows exe 客户端

前端通过 Electron 打包为独立 exe，后端保持不变，需单独启动。

## 开发（Electron + Vite 热更新）

1. 启动后端：在项目根目录运行 `npm run dev`（或单独启动 backend）。
2. 启动前端开发服务器 + Electron 窗口：

```bash
cd frontend
npm run electron:dev
```

会先启动 Vite 开发服务器，再打开 Electron 窗口并加载 `http://localhost:5173`，API 请求通过 Vite 代理到后端（默认 `http://localhost:4000`）。

## 打包为 exe

1. 确保后端地址：客户端默认连接 `http://localhost:4000`，如需修改见下方「修改后端地址」。
2. 在 frontend 目录执行：

```bash
cd frontend
npm run electron:build
```

3. 打包完成后，安装包在 `frontend/release/` 下：
   - `管理后台 Setup x.x.x.exe`：NSIS 安装包（推荐分发）
   - 或 `win-unpacked/` 目录下的免安装可执行文件

## 使用已打包的 exe

1. 在本机或服务器先启动后端（如 `node backend` 或 `npm run dev` 在项目根目录）。
2. 运行「管理后台」exe，登录后即可使用。
3. 若后端不在本机，需修改客户端使用的后端地址（见下）。

## 修改后端地址

- **打包前**：可设置环境变量 `VITE_BACKEND_URL`，例如：
  ```bash
  set VITE_BACKEND_URL=http://192.168.1.100:4000
  npm run electron:build
  ```
- **打包后**：在用户数据目录下的 `config.json` 中设置 `backendUrl`：
  - Windows：`%APPDATA%\管理后台\config.json`
  - 内容示例：`{"backendUrl":"http://你的服务器:4000"}`

## 故障排除：Electron 未正确安装

若运行 `npm run electron:dev` 报错：

```text
Error: Electron failed to install correctly, please delete node_modules/electron and try installing again
```

或 `npm install` 报错 `EBUSY: resource busy or locked`，说明 Electron 目录被占用或未正确安装。

**先试一键修复（在 frontend 目录）：**
```bash
npm run electron:fix
```
脚本会尝试重装 electron 并下载二进制；若当前目录被占用会提示你关掉 IDE 后手动执行命令。

**若仍失败，请按下面步骤重装：**

1. **完全退出 Cursor / VS Code**（避免占用 `node_modules`）。
2. 用 **系统自带的 CMD**（开始菜单 → 输入 cmd → 回车）执行：
   ```cmd
   cd /d E:\JS\weak_current\frontend
   scripts\reinstall-electron.cmd
   ```
3. 若 `rmdir` 仍提示被占用，请**重启电脑**后先开 CMD 再运行一次 `scripts\reinstall-electron.cmd`。
4. **若出现 ECONNRESET / RequestError: read ECONNRESET**（下载 Electron 二进制时连接被重置），请用国内镜像安装：
   ```bash
   # 在 frontend 目录执行（推荐，一步到位）
   npm run install:mirror
   ```
   或手动设镜像后再安装：
   ```cmd
   set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
   rmdir /s /q node_modules\electron
   npm install
   ```

## 其他说明

- 客户端会自动获取本机 MAC 并随登录请求发送，用于日志中的「主机 MAC」。
- 未设置 `backendUrl` 时，默认连接 `http://localhost:4000`。
