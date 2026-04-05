/**
 * 未登录：通过已绑定邮箱验证码重置登录密码
 */
import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { App, Alert, Button, Card, Form, Input, Steps, Typography } from 'antd'
import axios from 'axios'
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

const { Paragraph, Title } = Typography

const ForgotPasswordPage: React.FC = () => {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [emailMasked, setEmailMasked] = useState<string>('')
  const [loading1, setLoading1] = useState(false)
  const [loading2, setLoading2] = useState(false)
  const [form1] = Form.useForm()
  const [form2] = Form.useForm()

  const onSendEmail = async (values: { email: string }) => {
    setLoading1(true)
    try {
      const { data } = await axios.post<{
        message?: string
        challengeId?: string
        emailMasked?: string
      }>('/api/auth/forgot-password', { email: values.email.trim() })
      message.success(data.message || '请求已处理')
      if (data.challengeId) {
        setChallengeId(data.challengeId)
        setEmailMasked(data.emailMasked ?? '')
        setStep(1)
        form2.resetFields()
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      message.error(err?.response?.data?.message || '发送失败')
    } finally {
      setLoading1(false)
    }
  }

  const onReset = async (values: { code: string; new_password: string; new_password_confirm: string }) => {
    if (!challengeId) {
      message.warning('请先完成上一步')
      return
    }
    setLoading2(true)
    try {
      await axios.post('/api/auth/reset-password', {
        challengeId,
        code: values.code.trim(),
        new_password: values.new_password,
        new_password_confirm: values.new_password_confirm,
      })
      message.success('密码已重置，请使用新密码登录')
      navigate('/login', { replace: true })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } }
      message.error(err?.response?.data?.message || '重置失败')
    } finally {
      setLoading2(false)
    }
  }

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
        <Title level={4} style={{ marginTop: 0 }}>
          <LockOutlined style={{ marginRight: 8 }} />
          找回密码
        </Title>
        <Steps
          size="small"
          current={step}
          items={[{ title: '填写邮箱' }, { title: '验证码与新密码' }]}
          style={{ marginBottom: 24 }}
        />
        {step === 0 ? (
          <>
            <Paragraph type="secondary">
              将向账号已绑定的邮箱发送 6 位验证码。若邮箱未注册，不会收到邮件，界面提示相同以保护隐私。
            </Paragraph>
            <Form form={form1} layout="vertical" onFinish={onSendEmail} preserve={false}>
              <Form.Item
                name="email"
                label="邮箱"
                rules={[
                  { required: true, message: '请输入邮箱' },
                  { type: 'email', message: '请输入有效邮箱地址' },
                ]}
              >
                <Input prefix={<MailOutlined />} placeholder="name@example.com" autoComplete="email" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 8 }}>
                <Button type="primary" htmlType="submit" block size="large" loading={loading1}>
                  发送验证码
                </Button>
              </Form.Item>
            </Form>
          </>
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={
                emailMasked
                  ? `验证码已发送至 ${emailMasked}，10 分钟内有效`
                  : '请填写邮件中的验证码并设置新密码'
              }
            />
            <Form form={form2} layout="vertical" onFinish={onReset} preserve={false}>
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
              <Form.Item
                name="new_password"
                label="新密码"
                rules={[{ required: true, message: '请输入新密码' }]}
                hasFeedback
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="new_password_confirm"
                label="确认新密码"
                dependencies={['new_password']}
                hasFeedback
                rules={[
                  { required: true, message: '请再次输入新密码' },
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
                <Button type="primary" htmlType="submit" block size="large" loading={loading2}>
                  重置密码
                </Button>
              </Form.Item>
              <Button block onClick={() => setStep(0)}>
                返回上一步
              </Button>
            </Form>
          </>
        )}
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link to="/login">返回登录</Link>
        </div>
      </Card>
    </div>
  )
}

export default ForgotPasswordPage
