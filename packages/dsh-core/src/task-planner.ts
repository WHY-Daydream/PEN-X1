/**
 * PEN-X1 Task Planner 插件（方案 §10）。
 * 插件名：penx1-task-planner
 * 把用户任务转换为固定业务 DAG（penx1-dag-v1），不允许模型删除、重排硬依赖或绕过 Gate。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TaskPlanArtifact } from '@penx1/contracts'
import { BUSINESS_TASKS, ALL_PENX1_TOOLS, isoNow } from '@penx1/contracts'

export const name = 'penx1-task-planner'

export interface Config {
  planVersion: string
  allowModelToAddOptionalTasks: boolean
}

export const Config: z<Config> = z.object({
  planVersion: z.string().default('penx1-dag-v1'),
  allowModelToAddOptionalTasks: z.boolean().default(false),
})

export const inject = ['tools', 'penx1Run']

/** 固定 DAG 计划（方案 §10.4）。 */
export function buildTaskPlan(planVersion: string): TaskPlanArtifact {
  return {
    tasks: [...BUSINESS_TASKS],
    dependencies: [],
    requiredTools: [...ALL_PENX1_TOOLS],
    planVersion,
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'penx1_plan_tasks',
    description: '生成 PEN-X1 固定业务 DAG 任务计划（五项业务任务，不可重排）',
    parameters: {
      runId: { type: 'string', required: true, description: 'PEN-X1 Run ID' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          runId: { type: 'string' },
          tasks: { type: 'array', items: { type: 'string' } },
          planVersion: { type: 'string' },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `✓ 任务拆解：${(value.tasks ?? []).length} 项（${value.planVersion}）：${(value.tasks ?? []).join('、')}` },
      ],
    },
    async execute(args) {
      ctx.penx1Run.assert(args.runId, ['runStarted'])
      const plan = buildTaskPlan(config.planVersion)
      const artifactId = `TASK-PLAN-${args.runId}`
      ctx.penx1Run.recordArtifact(args.runId, {
        artifactId,
        runId: args.runId,
        kind: 'TASK_PLAN',
        createdAt: isoNow(),
        data: plan,
      })
      ctx.penx1Run.recordStep(args.runId, {
        runId: args.runId,
        toolName: 'penx1_plan_tasks',
        capabilityType: 'control',
        status: 'success',
        previousPhase: ctx.penx1Run.get(args.runId).phase,
        currentPhase: ctx.penx1Run.get(args.runId).phase,
        artifactIds: [artifactId],
        evidenceIds: [],
        warnings: [],
        data: plan,
      })
      return { runId: args.runId, tasks: plan.tasks, planVersion: plan.planVersion }
    },
  }))
}
