/**
 * PEN-X1 Run State 插件（方案 §7）。
 * 插件名：penx1-run-state
 * 提供 ctx.penx1Run Service，注册 penx1_start_analysis / penx1_get_status 两个控制工具，
 * 监听 DSH tools/result 事件作为权威历史的安全网。
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { Artifact, Penx1Run, RunProjection, ToolResult } from '@penx1/contracts'
import { isPenx1Tool, onEvent, provideService } from '@penx1/contracts'
import { RunStateStore, type StartInput } from './run-state-store.js'

export const name = 'penx1-run-state'

export interface Config {
  maxRunsPerSession: number
  maxArtifactsPerRun: number
  replayOnLoad: boolean
  allowConcurrentRuns: boolean
}

export const Config: z<Config> = z.object({
  maxRunsPerSession: z.number().default(5),
  maxArtifactsPerRun: z.number().default(500),
  replayOnLoad: z.boolean().default(true),
  allowConcurrentRuns: z.boolean().default(false),
})

export const inject = ['tools']

/** Run State Service：全部委托给纯逻辑 RunStateStore，实现 contracts 的 ctx.penx1Run 接缝（方案 §7.3）。 */
export class Penx1RunService implements Penx1Run {
  constructor(private readonly store: RunStateStore) {}

  async start(sessionId: string, input: StartInput): Promise<RunProjection> {
    return this.store.start(sessionId, input)
  }

  get(runId: string): RunProjection {
    return this.store.get(runId)
  }

  has(runId: string): boolean {
    return this.store.has(runId)
  }

  assert(runId: string, requirements: string[]): void {
    this.store.assert(runId, requirements)
  }

  recordArtifact(runId: string, artifact: Artifact): void {
    this.store.recordArtifact(runId, artifact)
  }

  recordStep(runId: string, result: ToolResult<unknown>): void {
    this.store.recordStep(runId, result)
  }

  replay(sessionId: string): Promise<RunProjection[]> {
    return Promise.resolve(this.store.replay(sessionId))
  }

  fail(runId: string, reason: string): void {
    this.store.fail(runId, reason)
  }
}

function runIdFromArguments(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const runId = (args as { runId?: unknown }).runId
  return typeof runId === 'string' ? runId : undefined
}

export function apply(ctx: Context, config: Config): void {
  const store = new RunStateStore({
    maxRunsPerSession: config.maxRunsPerSession,
    maxArtifactsPerRun: config.maxArtifactsPerRun,
    allowConcurrentRuns: config.allowConcurrentRuns,
  })
  // Service 经 ctx.provide 注册（运行时语义与 Service 基类一致，规避模块类型分歧）。
  provideService(ctx, 'penx1Run', new Penx1RunService(store))

  ctx.tools.register(defineTool({
    name: 'penx1_start_analysis',
    description: '创建 PEN-X1 产品分析 Run（幂等：会话已有活动 Run 时返回现有 Run）',
    parameters: {
      sessionId: { type: 'string', required: true, description: 'DSH 会话 ID' },
      product: { type: 'string', required: true, description: '产品名，如 PEN-X1' },
      market: { type: 'string', description: '目标市场，如 North America Amazon' },
      language: { type: 'string', description: '报告语言，默认 zh-CN' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          runId: { type: 'string' },
          sessionId: { type: 'string' },
          phase: { type: 'string' },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `✓ Run 创建：${value.runId}（Phase: ${value.phase}）` },
      ],
    },
    async execute(args) {
      const projection = await store.start(args.sessionId, {
        product: args.product,
        market: args.market,
        language: args.language,
      })
      return {
        runId: projection.runId,
        sessionId: projection.sessionId,
        phase: projection.phase,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'penx1_get_status',
    description: '查询 PEN-X1 Run 的当前 Phase、已完成 Artifact 与警告',
    parameters: {
      runId: { type: 'string', required: true, description: 'PEN-X1 Run ID' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          runId: { type: 'string' },
          sessionId: { type: 'string' },
          phase: { type: 'string' },
          artifactCount: { type: 'number' },
          evidenceCount: { type: 'number' },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `Phase: ${value.phase} | Artifacts: ${value.artifactCount} | Evidence: ${value.evidenceCount}${(value.warnings ?? []).length > 0 ? ` | Warnings: ${(value.warnings ?? []).length}` : ''}`,
        },
      ],
    },
    async execute(args) {
      const projection = store.get(args.runId)
      return {
        runId: projection.runId,
        sessionId: projection.sessionId,
        phase: projection.phase,
        artifactCount: projection.artifactIds.length,
        evidenceCount: projection.evidenceIds.length,
        warnings: projection.warnings,
      }
    },
  }))

  // 权威历史安全网：tools/result 事件按工具名置位完成 flag（方案 §7.4）。
  onEvent<[ToolExecution, Readonly<ToolExecutionResult>]>(ctx, 'tools/result', (exec, result) => {
    if (!isPenx1Tool(exec.name)) return
    store.recordToolResultEvent(exec.name, runIdFromArguments(exec.arguments), result.isError === true)
  })
}
