/**
 * 功能名称：认证上下文
 * 实现原理与逻辑：提供全局登录态（user）、login/logout、hasRole/hasPermission；登录成功后后端返回 token 与 roles/permissions，
 * 存入 localStorage 并设置 axios 的 Authorization。子组件通过 useAuth 获取上述方法与状态，用于路由守卫与按钮级权限控制。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import axios from 'axios'
import {
  assertDingTalkContainer,
  loadDingTalkOpenJs,
  requestDingTalkAuthCode,
} from '../dingtalk/dingtalkClient'

const VITE_DING_CORP = (import.meta.env.VITE_DINGTALK_CORP_ID as string | undefined)?.trim() || ''
const VITE_DING_APP_KEY = (import.meta.env.VITE_DINGTALK_APP_KEY as string | undefined)?.trim() || ''

export type User = {
  /** 数据库用户 id，用于判断是否编辑本人等 */
  id?: number
  username: string
  /** 姓名（后端 users.real_name），用于显示与默认“记录人” */
  real_name?: string | null
  /** 绑定邮箱；空则须先完成「补充邮箱」页 */
  email?: string | null
  /** 后端登录/拉取资料时下发；false 表示已绑定 */
  must_complete_email?: boolean
  /** 钉钉 JIT 等：需本人设置登录密码 */
  must_set_password?: boolean
  /** 钉钉 JIT 等首次注册，用于前端提示 */
  just_registered?: boolean
  roles: string[]
  permissions?: string[]
  token: string
  /** 登录响应：密码长期未换时的提示文案 */
  password_rotation_hint?: string | null
  /** 与 JWT dt_uid / 库内 dingtalk_userid 一致；非空时在钉钉内需周期性校验身份 */
  dingtalk_userid?: string | null
}

export type EmailOtpReason = 'admin' | 'risk_location'

/** 账号密码或钉钉第一步登录的返回：成功写入 token，或需邮箱验证码 */
export type LoginResult =
  | { type: 'success' }
  | {
      type: 'needs_otp'
      challengeId: string
      emailMasked: string
      /** 后端区分管理员必验 / 异常登录地 */
      emailOtpReason?: EmailOtpReason
    }

type AuthContextValue = {
  user: User | null
  login: (username: string, password: string) => Promise<LoginResult>
  /** 钉钉 H5 免登：前端传入 JSAPI 返回的 authCode */
  loginWithDingTalkAuthCode: (authCode: string) => Promise<LoginResult>
  /** 管理员邮箱验证码通过后完成登录 */
  completeLoginWithEmailOtp: (challengeId: string, code: string) => Promise<void>
  logout: () => void
  hasRole: (roleOrRoles: string | string[]) => boolean
  /** 是否拥有某页面/功能权限（由权限组配置决定，登录时下发） */
  hasPermission: (permissionKey: string) => boolean
  isAuthenticated: boolean
  /** 未绑定邮箱时为 true，须先访问 /complete-email */
  needsEmailBinding: boolean
  /** 未自设登录密码时为 true；可与 needsEmailBinding 同时为 true（完善资料页合并绑邮箱+设密） */
  needsPasswordSetup: boolean
  /** PATCH /api/me 或 GET /api/me 后合并到本地用户态 */
  persistProfileFromMe: (data: Record<string, unknown>) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const STORAGE_KEY = 'admin_user'

/** 登录页钉钉自动拉码失败后写入，避免同一会话内反复弹错；登出或手动点「钉钉内免登」时清除 */
export const DINGTALK_SSO_AUTO_SUPPRESS_KEY = 'weak_current_dt_sso_auto_suppress'

/** 获取客户端 MAC（可由 Electron/本地脚本写入 localStorage['client_mac']，浏览器环境通常无法直接获取 MAC） */
function getClientMac(): string | null {
  if (typeof window === 'undefined') return null
  const mac = window.localStorage.getItem('client_mac')
  return mac && mac.trim() ? mac.trim() : null
}

function mergeUserFromMe(prev: User, data: Record<string, unknown>): User {
  const email =
    data.email === null || data.email === undefined
      ? prev.email ?? null
      : String(data.email).trim() || null
  let mustComplete: boolean | undefined
  if (typeof data.must_complete_email === 'boolean') {
    mustComplete = data.must_complete_email
  } else if (data.email !== undefined && data.email !== null) {
    mustComplete = !String(data.email).trim()
  } else {
    mustComplete = prev.must_complete_email
  }
  let justReg = prev.just_registered
  if (typeof data.just_registered === 'boolean') {
    justReg = data.just_registered
  }
  if (mustComplete === false) {
    justReg = undefined
  }
  let mustSetPassword: boolean | undefined
  if (typeof data.must_set_password === 'boolean') {
    mustSetPassword = data.must_set_password
  } else {
    mustSetPassword = prev.must_set_password
  }
  const nextDt =
    data.dingtalk_userid !== undefined && data.dingtalk_userid !== null
      ? String(data.dingtalk_userid).trim() || null
      : data.dingtalk_userid === null
        ? null
        : prev.dingtalk_userid
  return {
    ...prev,
    id: typeof data.id === 'number' ? data.id : prev.id,
    username: typeof data.username === 'string' ? data.username : prev.username,
    ...(data.dingtalk_userid !== undefined ? { dingtalk_userid: nextDt } : {}),
    real_name:
      data.real_name !== undefined ? (data.real_name as string | null | undefined) ?? null : prev.real_name,
    email: email != null ? email : null,
    must_complete_email: mustComplete,
    must_set_password: mustSetPassword,
    just_registered: justReg,
    roles: Array.isArray(data.roles) ? (data.roles as string[]) : prev.roles,
    permissions: Array.isArray(data.permissions) ? (data.permissions as string[]) : prev.permissions,
  }
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    try {
      const u = JSON.parse(raw) as User
      if (u?.token) {
        axios.defaults.headers.common.Authorization = `Bearer ${u.token}`
      }
      return u
    } catch {
      return null
    }
  })

  const persistUser = useCallback((u: User) => {
    setUser(u)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    }
    axios.defaults.headers.common.Authorization = `Bearer ${u.token}`
  }, [])

  const persistProfileFromMe = useCallback((data: Record<string, unknown>) => {
    setUser((prev) => {
      if (!prev?.token) return prev
      const next = mergeUserFromMe(prev, { ...data, just_registered: undefined })
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      }
      return next
    })
  }, [])

  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      const clientMac = getClientMac()
      const resp = await axios.post<Record<string, unknown>>('/api/login', {
        username,
        password,
        ...(clientMac ? { client_mac: clientMac } : {}),
      })
      const data = resp.data
      if (
        data &&
        typeof data === 'object' &&
        data.requiresEmailOtp === true &&
        typeof data.challengeId === 'string'
      ) {
        const reasonRaw = data.emailOtpReason
        const emailOtpReason: EmailOtpReason | undefined =
          reasonRaw === 'risk_location' || reasonRaw === 'admin' ? reasonRaw : undefined
        return {
          type: 'needs_otp',
          challengeId: data.challengeId,
          emailMasked: typeof data.emailMasked === 'string' ? data.emailMasked : '',
          emailOtpReason,
        }
      }
      const u = data as User
      if (!u?.token) {
        throw new Error('登录响应异常')
      }
      persistUser(u)
      return { type: 'success' }
    },
    [persistUser],
  )

  const loginWithDingTalkAuthCode = useCallback(
    async (authCode: string): Promise<LoginResult> => {
      const resp = await axios.post<Record<string, unknown>>('/api/auth/dingtalk/login', {
        authCode: authCode.trim(),
      })
      const data = resp.data
      if (
        data &&
        typeof data === 'object' &&
        data.requiresEmailOtp === true &&
        typeof data.challengeId === 'string'
      ) {
        const reasonRaw = data.emailOtpReason
        const emailOtpReason: EmailOtpReason | undefined =
          reasonRaw === 'risk_location' || reasonRaw === 'admin' ? reasonRaw : undefined
        return {
          type: 'needs_otp',
          challengeId: data.challengeId,
          emailMasked: typeof data.emailMasked === 'string' ? data.emailMasked : '',
          emailOtpReason,
        }
      }
      const u = data as User
      if (!u?.token) {
        throw new Error('登录响应异常')
      }
      persistUser(u)
      return { type: 'success' }
    },
    [persistUser],
  )

  const completeLoginWithEmailOtp = useCallback(
    async (challengeId: string, code: string) => {
      const clientMac = getClientMac()
      const resp = await axios.post<User>('/api/login/email-otp', {
        challengeId,
        code: code.trim(),
        ...(clientMac ? { client_mac: clientMac } : {}),
      })
      const u = resp.data
      if (!u?.token) {
        throw new Error('验证响应异常')
      }
      persistUser(u)
    },
    [persistUser],
  )

  /** 先同步清空本地与请求头，再后台通知服务端作废会话，避免 await /api/logout 挂起或很慢时界面仍像已登录 */
  const logout = useCallback(() => {
    const authHeader = axios.defaults.headers.common.Authorization
    setUser(null)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY)
      window.sessionStorage.removeItem(DINGTALK_SSO_AUTO_SUPPRESS_KEY)
    }
    delete axios.defaults.headers.common.Authorization
    const authStr =
      typeof authHeader === 'string'
        ? authHeader
        : Array.isArray(authHeader)
          ? authHeader[0]
          : authHeader != null
            ? String(authHeader)
            : ''
    void axios
      .post('/api/logout', undefined, authStr ? { headers: { Authorization: authStr } } : {})
      .catch(() => {
        /* 网络或鉴权失败不影响本地已登出 */
      })
  }, [])

  const logoutRef = useRef(logout)
  logoutRef.current = logout
  useEffect(() => {
    const id = axios.interceptors.response.use(
      (r) => r,
      (err) => {
        const status = err.response?.status
        const path = String(err.config?.url ?? '').split('?')[0]
        const code = (err.response?.data as { code?: string } | undefined)?.code
        if (
          status === 403 &&
          code === 'EMAIL_REQUIRED' &&
          typeof window !== 'undefined' &&
          !path.endsWith('/api/me') &&
          !path.endsWith('/api/me/set-initial-password') &&
          !path.includes('/api/me/bind-email') &&
          !window.location.pathname.includes('complete-email')
        ) {
          window.location.assign('/complete-email')
          return Promise.reject(err)
        }
        if (
          status === 403 &&
          code === 'PASSWORD_SETUP_REQUIRED' &&
          typeof window !== 'undefined' &&
          !path.endsWith('/api/me') &&
          !path.endsWith('/api/me/set-initial-password') &&
          !path.includes('/api/me/bind-email') &&
          !window.location.pathname.includes('complete-email')
        ) {
          window.location.assign('/complete-email')
          return Promise.reject(err)
        }
        /** 账号密码/钉钉登录失败也返回 401，不应当作「会话失效」整页跳登录（会吞掉错误提示） */
        const isCredentialLogin =
          path.endsWith('/api/login') ||
          path.endsWith('/api/auth/dingtalk/login') ||
          path.endsWith('/api/login/email-otp') ||
          path.endsWith('/api/me/bind-email/send') ||
          path.endsWith('/api/me/bind-email/confirm')
        if (status === 401 && !isCredentialLogin) {
          logoutRef.current()
          if (typeof window !== 'undefined') {
            window.location.href = '/login'
          }
        }
        return Promise.reject(err)
      },
    )
    return () => {
      axios.interceptors.response.eject(id)
    }
  }, [])

  const hasRole = useCallback(
    (roleOrRoles: string | string[]) => {
      if (!user) return false
      const required = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles]
      return required.some((r) => user.roles.includes(r))
    },
    [user],
  )

  const hasPermission = useCallback(
    (permissionKey: string) => {
      if (!user) return false
      const perms = user.permissions ?? []
      if (perms.length === 0) return false
      return perms.includes(permissionKey)
    },
    [user],
  )

  useEffect(() => {
    if (user?.token) {
      axios.defaults.headers.common.Authorization = `Bearer ${user.token}`
    }
  }, [user?.token])

  useEffect(() => {
    if (!user?.token) return
    let cancelled = false
    void axios.get('/api/me').then(({ data }) => {
      if (cancelled) return
      setUser((prev) => {
        if (!prev?.token) return prev
        const next = mergeUserFromMe(prev, data as Record<string, unknown>)
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        }
        return next
      })
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user?.token])

  /** 钉钉内已绑定钉钉 userId 的会话：拉免登码与后端比对，切换钉钉账号后使旧 TOKEN 失效 */
  useEffect(() => {
    if (!user?.token) return
    const dt = String(user.dingtalk_userid ?? '').trim()
    if (!dt) return
    if (typeof window === 'undefined') return

    let cancelled = false
    const run = async () => {
      try {
        await loadDingTalkOpenJs()
        if (cancelled) return
        if (!window.dd) return
        try {
          assertDingTalkContainer(window.dd)
        } catch (e) {
          if (e instanceof Error && e.message === 'NOT_IN_DINGTALK') return
          throw e
        }
        const st = await axios.get<{ corpId?: string | null; appKey?: string | null }>(
          '/api/dingtalk/status',
        )
        if (cancelled) return
        const corpId = String(st.data.corpId ?? VITE_DING_CORP).trim()
        if (!corpId) return
        const appKeyRaw = st.data.appKey
        const appKey =
          typeof appKeyRaw === 'string' && appKeyRaw.trim()
            ? appKeyRaw.trim()
            : VITE_DING_APP_KEY || null
        const code = await requestDingTalkAuthCode({ corpId, appKey })
        if (cancelled) return
        await axios.post('/api/auth/dingtalk/assert-session', { authCode: code.trim() })
      } catch (e: unknown) {
        if (cancelled) return
        const err = e as {
          response?: { status?: number; data?: { code?: string; message?: string } }
        }
        if (
          err.response?.status === 401 &&
          err.response?.data?.code === 'DINGTALK_ACCOUNT_MISMATCH'
        ) {
          logoutRef.current()
          window.location.assign('/login')
          return
        }
        /* 网络/钉钉接口失败不强制登出，避免误伤 */
      }
    }

    void run()
    const onVis = () => {
      if (document.visibilityState === 'visible') void run()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [user?.token, user?.dingtalk_userid])

  const needsEmailBinding = useMemo(() => {
    if (!user?.token) return false
    if (user.must_complete_email === false) return false
    if (user.must_complete_email === true) return true
    return !String(user.email ?? '').trim()
  }, [user])

  const needsPasswordSetup = useMemo(() => {
    if (!user?.token) return false
    return user.must_set_password === true
  }, [user])

  const value: AuthContextValue = {
    user,
    login,
    loginWithDingTalkAuthCode,
    completeLoginWithEmailOtp,
    logout,
    hasRole,
    hasPermission,
    isAuthenticated: !!user,
    needsEmailBinding,
    needsPasswordSetup,
    persistProfileFromMe,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth 必须在 AuthProvider 中使用')
  }
  return ctx
}

