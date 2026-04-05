/**
 * 功能名称：前端入口
 * 实现原理与逻辑：挂载 React 根节点并渲染 App；启动时若存在 Electron API 则拉取后端 baseURL 与客户端 MAC 并写入 axios 与 localStorage，
 * 以支持桌面端代理与设备标识。使用 StrictMode 包裹根组件。
 */
import '@ant-design/v5-patch-for-react-19'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import 'antd/dist/reset.css'
import './index.css'
import App from './App.tsx'

async function bootstrap() {
  if (typeof window === 'undefined') return
  if (window.electronAPI) {
    const url = await window.electronAPI.getBackendUrl()
    if (url) axios.defaults.baseURL = url.replace(/\/$/, '')
    const mac = await window.electronAPI.getClientMac()
    if (mac) window.localStorage.setItem('client_mac', mac)
    return
  }
  const viteBackend = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim()
  if (viteBackend) {
    axios.defaults.baseURL = viteBackend.replace(/\/$/, '')
  }
}

bootstrap().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
