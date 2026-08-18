/**
 * PEN-X1 分析插件共享助手：统一 recordStep 样板（方案 §26：Artifact 只通过成功 Tool Result 产生）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CapabilityType, ToolStatus } from '@penx1/contracts'

export function completeStep(
  ctx: Context,
  runId: string,
  toolName: string,
  capabilityType: CapabilityType,
  status: ToolStatus,
  artifactIds: string[],
  evidenceIds: string[],
  warnings: string[],
  data: unknown,
): void {
  const run = ctx.penx1Run.get(runId)
  ctx.penx1Run.recordStep(runId, {
    runId,
    toolName,
    capabilityType,
    status,
    previousPhase: run.phase,
    currentPhase: run.phase,
    artifactIds,
    evidenceIds,
    warnings,
    data,
  })
}
