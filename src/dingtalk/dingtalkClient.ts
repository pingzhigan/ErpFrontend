/**
 * 钉钉 H5 JSAPI：加载脚本、判断是否钉钉容器、拉取免登 authCode（与登录页共用）
 */

export const DINGTALK_OPEN_JS =
  'https://g.alicdn.com/dingding/dingtalk-jsapi/3.0.25/dingtalk.open.js'

export function loadDingTalkOpenJs(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.dd) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = DINGTALK_OPEN_JS
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('加载钉钉 JSAPI 脚本失败'))
    document.head.appendChild(s)
  })
}

/** 未使用 dd.config 时勿包 dd.ready；notInDingTalk 下调用会报错 */
export function assertDingTalkContainer(dd: NonNullable<Window['dd']>): void {
  const p = (dd as { env?: { platform?: string } }).env?.platform
  if (p === 'notInDingTalk') {
    throw new Error('NOT_IN_DINGTALK')
  }
}

export function requestDingTalkAuthCode(params: {
  corpId: string
  appKey: string | null
}): Promise<string> {
  const { corpId, appKey } = params
  const dd = window.dd
  if (!dd) {
    return Promise.reject(new Error('钉钉 JSAPI 未就绪'))
  }
  assertDingTalkContainer(dd)
  return new Promise((resolve, reject) => {
    dd.runtime.permission.requestAuthCode({
      corpId,
      ...(appKey ? { clientId: appKey } : {}),
      onSuccess: ({ code }) => resolve(code),
      onFail: () => reject(new Error('获取钉钉免登码失败')),
    })
  })
}
