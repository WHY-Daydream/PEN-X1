/**
 * PEN-X1 Workflow Guard 插件（方案 §22）。
 * 插件名：penx1-workflow-guard
 * 在 tools/execute 中间件中按 TOOL_POLICIES + Run Projection 实施前置门禁：
 * 未知工具阻断、前置 Artifact 缺失返回明确 requiredAction、Step Budget 上限。
 */

import { Context } from '@deepseek-ai/cordis'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { isPenx1Tool, onEvent, policyFor } from '@penx1/contracts'

export const name = 'penx1-workflow-guard'

export interface Config {
  maxSteps: number
  maxRetriesPerTool: number
  allowParallelDataTools: boolean
  allowParallelFinalAnalyses: boolean
  blockUnknownTools: boolean
  continueOnNonCriticalSourceMissing: boolean
}

export const Config: z<Config> = z.object({
  maxSteps: z.number().default(18),
  maxRetriesPerTool: z.number().default(2),
  allowParallelDataTools: z.boolean().default(true),
  allowParallelFinalAnalyses: z.boolean().default(true),
  blockUnknownTools: z.boolean().default(true),
  continueOnNonCriticalSourceMissing: z.boolean().default(true),
})

export const inject = ['tools', 'penx1Run']

export interface PolicyDecision {
  allowed: boolean
  errorCode?: string
  message?: string
  requiredAction?: string
}

/** 纯逻辑门禁（方案 §4.7 / §22.4）：根据已完成 flag 判定工具是否允许调用。 */
export function evaluatePolicy(
  toolName: string,
  completed: Record<string, boolean>,
  options: { blockUnknownTools: boolean },
): PolicyDecision {
  if (!isPenx1Tool(toolName)) {
    if (options.blockUnknownTools) {
      return {
        allowed: false,
        errorCode: 'INVALID_PHASE',
        message: `工具 ${toolName} 不在 PEN-X1 工具集内，已阻断`,
      }
    }
    return { allowed: true }
  }
  const requires = policyFor(toolName)
  if (requires === undefined) return { allowed: true }
  const missing = requires.filter((flag) => completed[flag] !== true)
  if (missing.length > 0) {
    return {
      allowed: false,
      errorCode: missing.includes('knowledgeReady') ? 'KNOWLEDGE_RETRIEVAL_REQUIRED' : 'ANALYSIS_DEPENDENCY_MISSING',
      message: `Blocked: ${missing.includes('knowledgeReady') ? 'KNOWLEDGE_RETRIEVAL_REQUIRED' : 'ANALYSIS_DEPENDENCY_MISSING'}`,
      requiredAction: missing.includes('knowledgeReady') ? 'penx1_retrieve_knowledge' : `先完成：${missing.join('、')}`,
    }
  }
  return { allowed: true }
}

function blockedResult(toolName: string, decision: PolicyDecision): ToolExecutionResult {
  const text = `${decision.message}\nRequired action: ${decision.requiredAction ?? '—'}`
  return {
    isError: true,
    content: [{ type: 'text', text }],
    error: { message: decision.message ?? 'blocked', info: { name: 'WorkflowGuard', code: decision.errorCode ?? 'INVALID_PHASE' } },
  }
}

export function apply(ctx: Context, config: Config): void {
  const stepCounts = new Map<string, number>()

  onEvent<[ToolExecution, () => Promise<ToolExecutionResult>]>(ctx, 'tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const runId = typeof exec.arguments === 'object' && exec.arguments !== null
      ? (exec.arguments as { runId?: unknown }).runId
      : undefined
    if (typeof runId !== 'string' || !ctx.penx1Run.has(runId)) {
      if (isPenx1Tool(exec.name) && runId !== undefined && typeof runId !== 'string') {
        return blockedResult(exec.name, { allowed: false, message: 'runId 参数无效' })
      }
      return next()
    }
    const steps = (stepCounts.get(runId) ?? 0) + 1
    stepCounts.set(runId, steps)
    if (steps > config.maxSteps) {
      return blockedResult(exec.name, {
        allowed: false,
        errorCode: 'INVALID_PHASE',
        message: `Step Budget 耗尽（${config.maxSteps}）`,
        requiredAction: 'penx1_generate_report 或终止',
      })
    }
    const decision = evaluatePolicy(exec.name, ctx.penx1Run.get(runId).completed, { blockUnknownTools: config.blockUnknownTools })
    if (!decision.allowed) return blockedResult(exec.name, decision)
    return next()
  })
}
