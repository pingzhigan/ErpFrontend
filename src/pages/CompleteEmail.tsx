/**
 * Onboarding：未绑邮箱须先通过邮箱验证码绑定；钉钉 JIT 等还须自设登录密码。
 */
import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { App, Alert, Button, Card, Form, Input, Typography } from 'antd'
import axios from 'axios'
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const { Paragraph, Title } = Typography

const CompleteEmailPage: React.FC = () => {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const {
    user,
    isAuthenticated,
    needsEmailBinding,
    needsPasswordSetup,
    persistProfileFromMe,
    logout,
  } = useAuth()
  const [emailForm] = Form.useForm()
  const [otpForm] = Form.useForm()
  const [pwdForm] = Form.useForm()

  const [bindPhase, setBindPhase] = useState<'email' | 'otp'>('email')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [emailMasked, setEmailMasked] = useState('')
  const [pendingEmail, setPendingEmail] = useState('')
  const [pendingRealName, setPendingRealName] = useState('')
  /** 与邮箱验证一并提交设密（未自设密码的钉钉 JIT 等） */
  const [pendingPassword, setPendingPassword] = useState<{ p1: string; p2: string } | null>(null)
  const [sendLoading, setSendLoading] = useState(false)
  const [confirmLoading, setConfirmLoading] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true })
      return
    }
    if (!needsEmailBinding && !needsPasswordSetup) {
      navigate('/dashboard', { replace: true })
      return
    }
    emailForm.setFieldsValue({
      email: user?.email ?? '',
      real_name: user?.real_name ?? '',
    })
  }, [
    isAuthenticated,
    needsEmailBinding,
    needsPasswordSetup,
    navigate,
    user?.email,
    user?.real_name,
    emailForm,
  ])

  useEffect(() => {
    if (needsEmailBinding) {
      setBindPhase('email')
      setChallengeId(null)
      setEmailMasked('')
      setPendingPassword(null)
      otpForm.resetFields()
    }
  }, [needsEmailBinding, otpForm])

  const sendVerificationCode = async () => {
    const fields: string[] = ['email']
    if (needsPasswordSetup) {
      fields.push('new_password', 'new_password_confirm')
    }
    try {
      await emailForm.validateFields(fields)
    } catch {
      return
    }
    const email = String(emailForm.getFieldValue('email') ?? '')
      .trim()
    const real_name = String(emailForm.getFieldValue('real_name') ?? '').trim()
    if (!email) {
      message.error('请填写邮箱')
      return
    }
    if (needsPasswordSetup) {
      const p1 = String(emailForm.getFieldValue('new_password') ?? '')
      const p2 = String(emailForm.getFieldValue('new_password_confirm') ?? '')
      if (p1 !== p2) {
        message.error('两次输入的密码不一致')
        return
      }
      setPendingPassword({ p1, p2 })
    } else {
      setPendingPassword(null)
    }
    setSendLoading(true)
    try {
      const { data } = await axios.post<{
        challengeId?: string
        emailMasked?: string
        message?: string
      }>('/api/me/bind-email/send', {
        email,
        ...(real_name ? { real_name } : {}),
      })
      if (!data.challengeId) {
        message.error('发送失败，请重试')
        return
      }
      setChallengeId(data.challengeId)
      setEmailMasked(data.emailMasked ?? '')
      setPendingEmail(email)
      setPendingRealName(real_name)
      setBindPhase('otp')
      otpForm.resetFields()
      message.success(data.message || '验证码已发送，请查收邮件')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      message.error(err?.response?.data?.message || '发送失败')
    } finally {
      setSendLoading(false)
    }
  }

  const resendCode = async () => {
    if (!pendingEmail) {
      message.warning('请先返回上一步填写邮箱')
      return
    }
    setSendLoading(true)
    try {
      const { data } = await axios.post<{
        challengeId?: string
        emailMasked?: string
        message?: string
      }>('/api/me/bind-email/send', {
        email: pendingEmail,
        ...(pendingRealName ? { real_name: pendingRealName } : {}),
      })
      if (data.challengeId) setChallengeId(data.challengeId)
      if (data.emailMasked) setEmailMasked(data.emailMasked)
      otpForm.resetFields()
      message.success(data.message || '验证码已重新发送')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      message.error(err?.response?.data?.message || '发送失败')
    } finally {
      setSendLoading(false)
    }
  }

  const onConfirmOtp = async (values: { code: string }) => {
    if (!challengeId) {
      message.warning('请先发送验证码')
      return
    }
    if (needsPasswordSetup) {
      if (!pendingPassword?.p1) {
        message.warning('请返回上一步填写登录密码')
        return
      }
    }
    setConfirmLoading(true)
    try {
      const payload: Record<string, string> = {
        challengeId,
        code: values.code.trim(),
      }
      if (needsPasswordSetup && pendingPassword) {
        payload.new_password = pendingPassword.p1
        payload.new_password_confirm = pendingPassword.p2
      }
      const { data } = await axios.post<Record<string, unknown>>('/api/me/bind-email/confirm', payload)
      if (data.relogin_required === true) {
        message.success(
          typeof data.message === 'string' ? data.message : '邮箱与密码已保存，请重新登录',
        )
        setBindPhase('email')
        setChallengeId(null)
        setPendingPassword(null)
        otpForm.resetFields()
        emailForm.resetFields()
        logout()
        navigate('/login', { replace: true, state: { fromOnboarding: true } })
        return
      }
      persistProfileFromMe(data)
      message.success('邮箱已验证并绑定')
      setBindPhase('email')
      setChallengeId(null)
      setPendingPassword(null)
      otpForm.resetFields()
      if ((data as { must_set_password?: boolean }).must_set_password) {
        pwdForm.resetFields()
      } else {
        navigate('/dashboard', { replace: true })
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      message.error(err?.response?.data?.message || '验证失败')
    } finally {
      setConfirmLoading(false)
    }
  }

  const onPasswordFinish = async (values: {
    new_password: string
    new_password_confirm: string
  }) => {
    try {
      const { data } = await axios.post('/api/me/set-initial-password', {
        new_password: values.new_password,
        new_password_confirm: values.new_password_confirm,
      })
      message.success((data as { message?: string }).message || '密码已保存')
      logout()
      navigate('/login', { replace: true, state: { fromOnboarding: true } })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      message.error(err?.response?.data?.message || '保存失败')
    }
  }

  if (!isAuthenticated) return null

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'linear-gradient(160deg, #f0f5ff 0%, #fff 45%)',
      }}
    >
      <Card style={{ width: '100%', maxWidth: 440 }} bordered={false}>
        {needsEmailBinding ? (
          <>
            <Title level={4} style={{ marginTop: 0 }}>
              <MailOutlined style={{ marginRight: 8 }} />
              {needsPasswordSetup ? '绑定邮箱并设置登录密码' : '请绑定邮箱'}
            </Title>
            <Paragraph type="secondary">
              将向您的邮箱发送<strong>验证码</strong>，验证通过后即可完成绑定
              {needsPasswordSetup ? '，并与您在此填写的登录密码一并生效' : ''}
              ，避免填错邮箱无法接收通知与安全邮件。
            </Paragraph>
            {user?.just_registered ? (
              <Paragraph type="success">
                欢迎使用！
                {needsPasswordSetup
                  ? '请完成邮箱验证并设置登录密码；网页登录用户名为钉钉注册手机号。'
                  : '请先完成邮箱绑定。'}
              </Paragraph>
            ) : null}
            {user?.username ? (
              <Paragraph type="secondary">
                网页登录用户名为：<strong>{user.username}</strong>
                {/^\d{11}$/.test(String(user.username).trim())
                  ? '（与钉钉注册手机号一致）'
                  : null}
              </Paragraph>
            ) : null}

            {bindPhase === 'email' ? (
              <Form form={emailForm} layout="vertical" preserve={false}>
                <Form.Item
                  name="email"
                  label="邮箱"
                  rules={[
                    { required: true, message: '请输入邮箱' },
                    { type: 'email', message: '请输入有效邮箱地址' },
                  ]}
                >
                  <Input placeholder="name@example.com" autoComplete="email" />
                </Form.Item>
                <Form.Item name="real_name" label="姓名（选填）">
                  <Input placeholder="与系统内显示名一致即可" autoComplete="name" />
                </Form.Item>
                {needsPasswordSetup ? (
                  <>
                    <Form.Item
                      name="new_password"
                      label="登录密码"
                      rules={[{ required: true, message: '请设置登录密码' }]}
                      hasFeedback
                    >
                      <Input.Password autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item
                      name="new_password_confirm"
                      label="确认密码"
                      dependencies={['new_password']}
                      hasFeedback
                      rules={[
                        { required: true, message: '请再次输入密码' },
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (!value || getFieldValue('new_password') === value) {
                              return Promise.resolve()
                            }
                            return Promise.reject(new Error('两次输入的密码不一致'))
                          },
                        }),
                      ]}
                    >
                      <Input.Password autoComplete="new-password" />
                    </Form.Item>
                  </>
                ) : null}
                <Form.Item style={{ marginBottom: 8 }}>
                  <Button
                    type="primary"
                    block
                    size="large"
                    loading={sendLoading}
                    onClick={() => void sendVerificationCode()}
                  >
                    发送验证码
                  </Button>
                </Form.Item>
                <Button type="link" danger block onClick={() => logout()}>
                  退出登录
                </Button>
              </Form>
            ) : (
              <>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={
                    emailMasked
                      ? `验证码已发送至 ${emailMasked}，10 分钟内有效`
                      : '请填写邮件中的 6 位验证码'
                  }
                />
                <Form form={otpForm} layout="vertical" onFinish={onConfirmOtp} preserve={false}>
                  <Form.Item
                    name="code"
                    label="邮箱验证码"
                    rules={[
                      { required: true, message: '请输入验证码' },
                      { pattern: /^\d{6}$/, message: '请输入 6 位数字' },
                    ]}
                  >
                    <Input.OTP length={6} inputMode="numeric" size="large" style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 8 }}>
                    <Button type="primary" htmlType="submit" block size="large" loading={confirmLoading}>
                      {needsPasswordSetup ? '验证并完成绑定与设密' : '验证并绑定'}
                    </Button>
                  </Form.Item>
                </Form>
                <Button block style={{ marginBottom: 8 }} onClick={() => void resendCode()} loading={sendLoading}>
                  重新发送验证码
                </Button>
                <Button
                  block
                  onClick={() => {
                    setBindPhase('email')
                    setChallengeId(null)
                    otpForm.resetFields()
                  }}
                >
                  上一步修改邮箱
                </Button>
                <Button type="link" danger block onClick={() => logout()}>
                  退出登录
                </Button>
              </>
            )}
          </>
        ) : (
          <>
            <Title level={4} style={{ marginTop: 0 }}>
              <LockOutlined style={{ marginRight: 8 }} />
              设置登录密码
            </Title>
            <Paragraph type="secondary">
              当前账号尚未设置<strong>登录密码</strong>（钉钉首次开通常见）。请设置后重新登录；密码将用于网页登录与敏感操作校验。
            </Paragraph>
            <Form form={pwdForm} layout="vertical" onFinish={onPasswordFinish} preserve={false}>
              <Form.Item
                name="new_password"
                label="登录密码"
                rules={[{ required: true, message: '请输入密码' }]}
                hasFeedback
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="new_password_confirm"
                label="确认密码"
                dependencies={['new_password']}
                hasFeedback
                rules={[
                  { required: true, message: '请再次输入密码' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('new_password') === value) {
                        return Promise.resolve()
                      }
                      return Promise.reject(new Error('两次输入的密码不一致'))
                    },
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 8 }}>
                <Button type="primary" htmlType="submit" block size="large">
                  保存密码并重新登录
                </Button>
              </Form.Item>
              <Button type="link" danger block onClick={() => logout()}>
                退出登录
              </Button>
            </Form>
          </>
        )}
      </Card>
    </div>
  )
}

export default CompleteEmailPage
