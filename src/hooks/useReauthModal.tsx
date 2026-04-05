import React, { useCallback, useRef, useState } from 'react'
import { Form, Input, Modal } from 'antd'

/** 高危操作前收集当前登录密码，写入请求体字段 reauth_password */
export function useReauthModal() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [form] = Form.useForm()
  const resolverRef = useRef<((v: string | null) => void) | null>(null)

  const askReauth = useCallback(
    (t: string) => {
      setTitle(t)
      form.resetFields()
      setOpen(true)
      return new Promise<string | null>((resolve) => {
        resolverRef.current = resolve
      })
    },
    [form],
  )

  const finish = (v: string | null) => {
    setOpen(false)
    resolverRef.current?.(v)
    resolverRef.current = null
  }

  const handleOk = async () => {
    try {
      const v = await form.validateFields()
      const p = (v.reauth_password as string)?.trim() || null
      if (!p) return
      finish(p)
    } catch {
      /* 校验未通过 */
    }
  }

  const handleCancel = () => finish(null)

  const reauthModal = (
    <Modal
      title={title}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      destroyOnClose
      okText="确认"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="reauth_password"
          label="登录密码"
          rules={[{ required: true, message: '请输入当前登录密码' }]}
        >
          <Input.Password autoComplete="current-password" placeholder="用于确认本次操作" />
        </Form.Item>
      </Form>
    </Modal>
  )

  return { askReauth, reauthModal }
}
