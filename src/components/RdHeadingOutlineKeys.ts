/**
 * 标题大纲快捷键：Enter 同级新标题（序号由 CSS 计数器递增）；Tab 降级；Shift+Tab 升级/一级退回正文。
 */
import { Extension, type Editor } from '@tiptap/core'

const LEVELS = [1, 2, 3] as const
type Level123 = (typeof LEVELS)[number]

function currentHeadingLevel(editor: Editor): Level123 | null {
  if (!editor.isActive('heading')) return null
  const raw = editor.getAttributes('heading').level
  const n = Number(raw)
  return LEVELS.includes(n as Level123) ? (n as Level123) : null
}

function headingTextEmpty(editor: Editor): boolean {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'heading') {
      return node.textContent.trim().length === 0
    }
  }
  return false
}

export const RdHeadingOutlineKeys = Extension.create({
  name: 'rdHeadingOutlineKeys',
  /** 高于列表缩进等，仅在 heading 内消费 Tab / Shift-Tab */
  priority: 120,

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const level = currentHeadingLevel(editor)
        if (level == null) return false
        if (headingTextEmpty(editor)) {
          return editor.chain().focus().setParagraph().run()
        }
        return editor.chain().focus().splitBlock().setHeading({ level }).run()
      },
      Tab: ({ editor }) => {
        const level = currentHeadingLevel(editor)
        if (level == null) return false
        if (level >= 3) return false
        const next = (level + 1) as Level123
        return editor.chain().focus().setHeading({ level: next }).run()
      },
      'Shift-Tab': ({ editor }) => {
        const level = currentHeadingLevel(editor)
        if (level == null) return false
        if (level <= 1) {
          return editor.chain().focus().setParagraph().run()
        }
        const prev = (level - 1) as Level123
        return editor.chain().focus().setHeading({ level: prev }).run()
      },
    }
  },
})
