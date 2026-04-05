import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 钉钉内置浏览器打开「vite 开发服」时，index.html 里严格的 CSP（无 unsafe-eval）会导致脚本/HMR 异常；
 * 开发命令下替换为宽松策略；生产 `vite build` 产物仍使用 index.html 原文（不含 unsafe-eval）。
 */
function devRelaxedCspForDingTalkWebView(): Plugin {
  return {
    name: 'dev-relaxed-csp',
    transformIndexHtml(html, ctx) {
      if (!ctx.server) return html
      return html.replace(
        /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*"\s*\/?>\s*/i,
        `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://g.alicdn.com blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; connect-src * ws: wss: http: https:; frame-src 'self' blob:; base-uri 'self'; form-action 'self'" />
`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devRelaxedCspForDingTalkWebView()],
  server: {
    port: 5123,
    host: true, // 允许局域网访问，默认仅 localhost
    proxy: {
      // SSE（/api/workbench/push-stream）为长连接；默认代理超时或客户端 abort 时易出现 ECONNRESET 日志
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.url?.includes('push-stream')) proxyReq.setTimeout(0)
          })
          proxy.on('proxyRes', (proxyRes, req) => {
            if (req.url?.includes('push-stream')) proxyRes.setTimeout(0)
          })
        },
      },
    },
  },
  /** 预构建依赖目标略降，减轻钉钉等旧 WebView 解析失败概率（开发服仍建议钉钉走生产静态资源） */
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2020',
    },
  },
  build: {
    target: 'es2020',
  },
})
