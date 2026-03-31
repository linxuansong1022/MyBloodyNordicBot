import type { ToolRegistry } from './tool.js'
import type { ChatMessage, ModelAdapter } from './types.js'
import type { PermissionManager } from './permissions.js'

function looksLikeClarifyingQuestion(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  const lower = trimmed.toLowerCase()
  const asksDirectQuestion =
    trimmed.endsWith('?') ||
    trimmed.endsWith('？') ||
    lower.includes('would you like') ||
    lower.includes('what would you like') ||
    trimmed.includes('请告诉我') ||
    trimmed.includes('请选择')

  if (!asksDirectQuestion) {
    return false
  }

  const userAddressingHints = [
    '你',
    '您',
    'would you',
    'do you',
    'which',
    'what',
    'prefer',
    'want',
    'choose',
    'confirm',
  ]

  const decisionHints = [
    '希望',
    '想要',
    '选择',
    '确认',
    '决定',
    '偏好',
    'prefer',
    'want',
    'choose',
    'confirm',
    'decide',
    'preference',
  ]

  return (
    userAddressingHints.some(hint => lower.includes(hint) || trimmed.includes(hint)) &&
    decisionHints.some(hint => lower.includes(hint) || trimmed.includes(hint))
  )
}

export async function runAgentTurn(args: {
  model: ModelAdapter
  tools: ToolRegistry
  messages: ChatMessage[]
  cwd: string
  permissions?: PermissionManager
  maxSteps?: number
  onToolStart?: (toolName: string, input: unknown) => void
  onToolResult?: (toolName: string, output: string, isError: boolean) => void
  onAssistantMessage?: (content: string) => void
}): Promise<ChatMessage[]> {
  const maxSteps = args.maxSteps ?? 6
  let messages = args.messages

  for (let step = 0; step < maxSteps; step++) {
    const next = await args.model.next(messages)

    if (next.type === 'assistant') {
      args.onAssistantMessage?.(next.content)
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: next.content,
      }
      const withAssistant: ChatMessage[] = [
        ...messages,
        assistantMessage,
      ]

      return withAssistant
    }

    if (next.content && looksLikeClarifyingQuestion(next.content)) {
      args.onAssistantMessage?.(next.content)
      return [
        ...messages,
        { role: 'assistant', content: next.content },
      ]
    }

    if (next.content) {
      args.onAssistantMessage?.(next.content)
      messages = [
        ...messages,
        { role: 'assistant', content: next.content },
      ]
    }

    for (const call of next.calls) {
      args.onToolStart?.(call.toolName, call.input)
      const result = await args.tools.execute(
        call.toolName,
        call.input,
        { cwd: args.cwd, permissions: args.permissions },
      )
      args.onToolResult?.(call.toolName, result.output, !result.ok)

      messages = [
        ...messages,
        {
          role: 'assistant_tool_call',
          toolUseId: call.id,
          toolName: call.toolName,
          input: call.input,
        },
        {
          role: 'tool_result',
          toolUseId: call.id,
          toolName: call.toolName,
          content: result.ok ? result.output : result.output,
          isError: !result.ok,
        },
      ]
    }
  }

  return [
    ...messages,
    {
      role: 'assistant',
      content: `达到最大工具步数限制，已停止当前回合。`,
    },
  ]
}
