/**
 * 功能名称：登录页
 * 实现原理与逻辑：提供账号密码表单，调用 AuthContext 的 login 完成认证；成功后跳转到来源页或仪表盘，
 * 失败时展示后端返回或默认错误信息。使用 location.state 记录登录前访问路径以实现登录后回跳。
 * 若后端已配置钉钉且用户在钉钉客户端内打开，会尝试自动拉免登码；亦可点击「钉钉一键登录」，均走 /api/auth/dingtalk/login（服务端可对通讯录成员 JIT 建户）。
 */
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Divider, Form, Input, Typography } from 'antd'
import axios from 'axios'
import React, { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  DINGTALK_SSO_AUTO_SUPPRESS_KEY,
  useAuth,
  type EmailOtpReason,
  type LoginResult,
} from '../auth/AuthContext'
import type { MessageInstance } from 'antd/es/message/interface'
import type { NavigateFunction } from 'react-router-dom'
import {
  assertDingTalkContainer,
  loadDingTalkOpenJs,
  requestDingTalkAuthCode,
} from '../dingtalk/dingtalkClient'

const { Text } = Typography

/** 构建时注入，用于 status 请求失败或后端未返回 corpId 时的兜底（与后端 DINGTALK_CORP_ID / APP_KEY 一致） */
const VITE_DING_CORP = (import.meta.env.VITE_DINGTALK_CORP_ID as string | undefined)?.trim() || ''
const VITE_DING_APP_KEY = (import.meta.env.VITE_DINGTALK_APP_KEY as string | undefined)?.trim() || ''

type DingTalkSsoOutcome =
  | { kind: 'success' }
  | {
      kind: 'needs_otp'
      challengeId: string
      emailMasked: string
      emailOtpReason?: EmailOtpReason
    }

async function runDingTalkSsoFlow(params: {
  corpId: string
  appKey: string | null
  loginWithDingTalkAuthCode: (code: string) => Promise<LoginResult>
  navigate: NavigateFunction
  from: string
  message: MessageInstance
}): Promise<DingTalkSsoOutcome> {
  const { corpId, appKey, loginWithDingTalkAuthCode, navigate, from, message } = params
  await loadDingTalkOpenJs()
  const dd = window.dd
  if (!dd) {
    throw new Error('当前环境非钉钉客户端或 JSAPI 未就绪')
  }
  assertDingTalkContainer(dd)

  try {
    const code = await requestDingTalkAuthCode({ corpId, appKey })
    const r = await loginWithDingTalkAuthCode(code)
    if (r.type === 'needs_otp') {
      return {
        kind: 'needs_otp',
        challengeId: r.challengeId,
        emailMasked: r.emailMasked,
        emailOtpReason: r.emailOtpReason,
      }
    }
    message.success('登录成功')
    navigate(from, { replace: true })
    return { kind: 'success' }
  } catch (err: unknown) {
    throw err instanceof Error ? err : new Error('钉钉免登失败')
  }
}

const LoginPage: React.FC = () => {
  const { message } = App.useApp()
  const { login, loginWithDingTalkAuthCode, completeLoginWithEmailOtp, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname || '/dashboard'
  const [loading, setLoading] = useState(false)
  const [dingConfigured, setDingConfigured] = useState(false)
  const [dingCorpId, setDingCorpId] = useState<string | null>(null)
  /** 企业内部应用免登：与开放平台 AppKey 一致，作 requestAuthCode 的 clientId */
  const [dingAppKey, setDingAppKey] = useState<string | null>(null)
  const [dingLoading, setDingLoading] = useState(false)
  /** 说明为何不显示钉钉入口或使用了兜底配置 */
  const [dingDiag, setDingDiag] = useState<string | null>(null)
  /** 账号密码登录失败时在表单上方展示，避免仅依赖易被整页跳转吞掉的 Toast */
  const [loginError, setLoginError] = useState<string | null>(null)
  /** 管理员邮箱二次验证 */
  const [otpPending, setOtpPending] = useState<{
    challengeId: string
    emailMasked: string
    emailOtpReason?: EmailOtpReason
  } | null>(null)
  const [otpLoading, setOtpLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setDingDiag(null)
      try {
        const { data } = await axios.get<{
          apiConfigured?: boolean
          h5LoginReady?: boolean
          configured?: boolean
          corpId?: string | null
          appKey?: string | null
        }>('/api/dingtalk/status')
        if (cancelled) return

        const apiOk =
          data?.apiConfigured === true ||
          (data?.apiConfigured === undefined &&
            Boolean(data?.h5LoginReady ?? (data?.configured && data?.corpId)))
        const serverCorp = (data?.corpId ?? '').trim()
        const serverKey = (data?.appKey ?? '').trim()
        const corp = serverCorp || VITE_DING_CORP || null
        const appKeyEff = serverKey || VITE_DING_APP_KEY || null

        if (apiOk && corp) {
          setDingConfigured(true)
          setDingCorpId(corp)
          if (appKeyEff) setDingAppKey(appKeyEff)
          if (!serverCorp && VITE_DING_CORP) {
            setDingDiag(
              '当前使用构建变量 VITE_DINGTALK_CORP_ID 作为企业 CorpId。建议在后端 .env 配置 DINGTALK_CORP_ID，以便 /api/dingtalk/status 统一返回。',
            )
          }
          return
        }

        if (apiOk && !corp) {
          setDingConfigured(false)
          setDingDiag(
            '后端已配置钉钉应用，但未设置企业 CorpId，无法调用 JSAPI 免登。请在服务器环境变量中配置 DINGTALK_CORP_ID（钉钉管理后台「企业信息」中的企业 ID），或构建前端时设置 VITE_DINGTALK_CORP_ID。',
          )
          return
        }

        setDingConfigured(false)
        setDingDiag('后端未配置钉钉（缺少 DINGTALK_APP_KEY / DINGTALK_APP_SECRET），无法使用钉钉登录。')
      } catch {
        if (cancelled) return
        if (VITE_DING_CORP) {
          setDingConfigured(true)
          setDingCorpId(VITE_DING_CORP)
          if (VITE_DING_APP_KEY) setDingAppKey(VITE_DING_APP_KEY)
          setDingDiag(
            '无法访问 /api/dingtalk/status（请检查网络与反向代理）。已使用 VITE_DINGTALK_CORP_ID 尝试钉钉免登。若仍失败，请在构建环境配置 VITE_BACKEND_URL 指向后端根地址（如 https://api.example.com），并保证 Nginx 将 /api 转发到 Node 服务。',
          )
        } else {
          setDingConfigured(false)
          setDingDiag(
            '无法访问 /api/dingtalk/status。钉钉入口需要：① 反向代理将 /api 转到后端，或 ② 构建时设置 VITE_BACKEND_URL；③ 后端配置 DINGTALK_CORP_ID；也可选 ④ 构建时设置 VITE_DINGTALK_CORP_ID 作为免登兜底。',
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** 钉钉内打开登录页时自动拉码；失败写入 sessionStorage，避免同会话反复报错 */
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!dingConfigured || !dingCorpId || isAuthenticated) return
    if (window.sessionStorage.getItem(DINGTALK_SSO_AUTO_SUPPRESS_KEY) === '1') return

    let cancelled = false
    void (async () => {
      setDingLoading(true)
      try {
        const out = await runDingTalkSsoFlow({
          corpId: dingCorpId,
          appKey: dingAppKey,
          loginWithDingTalkAuthCode,
          navigate,
          from,
          message,
        })
        if (out.kind === 'needs_otp') {
          setOtpPending({
            challengeId: out.challengeId,
            emailMasked: out.emailMasked,
            emailOtpReason: out.emailOtpReason,
          })
          message.success('验证码已发送至邮箱')
        }
      } catch (err: unknown) {
        if (cancelled) return
        const raw = err instanceof Error ? err.message : String(err)
        if (raw === 'NOT_IN_DINGTALK') return
        window.sessionStorage.setItem(DINGTALK_SSO_AUTO_SUPPRESS_KEY, '1')
        const e = err as { response?: { data?: { message?: string; dingtalk_userid?: string } } }
        const msg =
          e?.response?.data?.message || (err instanceof Error ? err.message : '钉钉登录失败')
        message.error(msg)
        const uid = e?.response?.data?.dingtalk_userid
        if (uid) {
          message.info(`请让管理员在用户管理中绑定钉钉 userId：${uid}`)
        }
      } finally {
        if (!cancelled) setDingLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    dingConfigured,
    dingCorpId,
    dingAppKey,
    isAuthenticated,
    loginWithDingTalkAuthCode,
    navigate,
    from,
    message,
  ])

  const handleFinish = async (values: { username: string; password: string }) => {
    setLoginError(null)
    setLoading(true)
    try {
      const r = await login(values.username, values.password)
      if (r.type === 'needs_otp') {
        setOtpPending({
          challengeId: r.challengeId,
          emailMasked: r.emailMasked,
          emailOtpReason: r.emailOtpReason,
        })
        message.success('验证码已发送至邮箱')
        return
      }
      message.success('登录成功')
      navigate(from, { replace: true })
    } catch (error: unknown) {
      const err = error as {
        response?: { data?: { message?: string } }
        message?: string
      }
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        '登录失败，请检查账号和密码'
      setLoginError(msg)
      message.error({ content: msg, duration: 5 })
    } finally {
      setLoading(false)
    }
  }

  const handleDingTalkLogin = async () => {
    if (!dingCorpId) {
      message.warning('未获取到企业 corpId')
      return
    }
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(DINGTALK_SSO_AUTO_SUPPRESS_KEY)
    }
    setDingLoading(true)
    try {
      const out = await runDingTalkSsoFlow({
        corpId: dingCorpId,
        appKey: dingAppKey,
        loginWithDingTalkAuthCode,
        navigate,
        from,
        message,
      })
      if (out.kind === 'needs_otp') {
        setOtpPending({
          challengeId: out.challengeId,
          emailMasked: out.emailMasked,
          emailOtpReason: out.emailOtpReason,
        })
        message.success('验证码已发送至邮箱')
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err)
      if (raw === 'NOT_IN_DINGTALK') {
        message.error('请在钉钉客户端内打开本页后再试')
        return
      }
      const e = err as { response?: { data?: { message?: string; dingtalk_userid?: string } } }
      const msg =
        e?.response?.data?.message ||
        (err instanceof Error ? err.message : '钉钉登录失败')
      message.error(msg)
      const uid = e?.response?.data?.dingtalk_userid
      if (uid) {
        message.info(`请让管理员在用户管理中绑定钉钉 userId：${uid}`)
      }
    } finally {
      setDingLoading(false)
    }
  }

  const handleOtpFinish = async (values: { code: string }) => {
    if (!otpPending) return
    setOtpLoading(true)
    try {
      await completeLoginWithEmailOtp(otpPending.challengeId, values.code)
      setOtpPending(null)
      message.success('登录成功')
      navigate(from, { replace: true })
    } catch (error: unknown) {
      const err = error as {
        response?: { data?: { message?: string } }
        message?: string
      }
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        '验证码错误或服务异常'
      message.error({ content: msg, duration: 5 })
    } finally {
      setOtpLoading(false)
    }
  }

  const clearOtpStep = () => {
    setOtpPending(null)
    setLoginError(null)
  }

  return (
    <div className="login-page">
      <Card className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
          <div className="login-logo">A</div>
          <div>
            <div className="login-title">管理后台</div>
            <div className="login-subtitle">
              {otpPending
                ? otpPending.emailOtpReason === 'risk_location'
                  ? '非常用地区登录，请完成邮箱验证'
                  : '请完成邮箱验证'
                : '请输入账号密码登录系统'}
            </div>
          </div>
        </div>

        {loginError ? (
          <Alert
            type="error"
            showIcon
            message={loginError}
            closable
            onClose={() => setLoginError(null)}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        {otpPending ? (
          <>
            <Alert
              type={otpPending.emailOtpReason === 'risk_location' ? 'warning' : 'info'}
              showIcon
              style={{ marginBottom: 16 }}
              message={
                otpPending.emailOtpReason === 'risk_location'
                  ? `系统检测到非常用地区登录，验证码已发送至 ${otpPending.emailMasked}，10 分钟内有效`
                  : `验证码已发送至 ${otpPending.emailMasked}，10 分钟内有效`
              }
            />
            <Form layout="vertical" onFinish={handleOtpFinish}>
              <Form.Item
                label="邮箱验证码"
                name="code"
                rules={[
                  { required: true, message: '请输入验证码' },
                  { pattern: /^\d{6}$/, message: '请输入 6 位数字' },
                ]}
              >
                <Input.OTP length={6} inputMode="numeric" size="large" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item style={{ marginBottom: 8 }}>
                <Button type="primary" block htmlType="submit" size="large" loading={otpLoading}>
                  验证并登录
                </Button>
              </Form.Item>
              <Button block size="large" onClick={clearOtpStep}>
                返回重新登录
              </Button>
            </Form>
          </>
        ) : (
          <Form
            layout="vertical"
            onFinish={handleFinish}
            onValuesChange={() => setLoginError(null)}
          >
            <Form.Item
              label="用户名"
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="用户名"
                autoComplete="username"
              />
            </Form.Item>

            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="密码"
                autoComplete="current-password"
              />
            </Form.Item>

            <div style={{ marginTop: -8, marginBottom: 12, textAlign: 'right' }}>
              <Link to="/forgot-password">忘记密码？</Link>
            </div>

            <Form.Item style={{ marginBottom: 8 }}>
              <Button
                type="primary"
                block
                htmlType="submit"
                size="large"
                loading={loading}
              >
                登录
              </Button>
            </Form.Item>

            {dingDiag ? (
              <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={dingDiag} />
            ) : null}

            {dingConfigured ? (
              <>
                <Divider plain style={{ margin: '12px 0' }}>
                  或
                </Divider>
                <Button
                  type="primary"
                  ghost
                  block
                  size="large"
                  loading={dingLoading}
                  onClick={() => void handleDingTalkLogin()}
                >
                  钉钉一键登录
                </Button>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  在钉钉内打开本页会自动尝试登录；也可点此按钮。首次登录将校验通讯录并自动开通账号；若已在「钉钉集成」配置部门与权限组映射则按部门合并角色，否则为默认普通用户，亦可之后在用户管理中调整。
                </Text>
              </>
            ) : null}
          </Form>
        )}
      </Card>
    </div>
  )
}

export default LoginPage

declare global {
  interface Window {
    dd?: {
      env?: { platform?: string }
      ready?: (cb: () => void) => void
      runtime: {
        permission: {
          requestAuthCode: (opts: {
            corpId: string
            /** 企业内部应用为 AppKey，与 SSO / 开放平台文档一致 */
            clientId?: string
            onSuccess: (res: { code: string }) => void
            onFail: (err?: unknown) => void
          }) => void
        }
      }
    }
  }
}

