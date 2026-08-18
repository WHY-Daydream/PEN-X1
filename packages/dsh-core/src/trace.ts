/**
 * PEN-X1 Trace 插件（方案 §23）。
 * 插件名：penx1-trace
 * 监听工具调用，生成用户可读进度与运行指标；不参与业务判断、不改变 Run 状态。
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { RunProjection } from '@penx1/contracts'
import { isPenx1Tool, onEvent } from '@penx1/contracts'

export const name = 'penx1-trace'

export interface Config {
  verbosity: 'concise' | 'verbose'
  emitProgressCards: boolean
  includePayloads: boolean
  includeTimings: boolean
}

export const Config: z<Config> = z.object({
  verbosity: z.union(['concise', 'verbose'] as const).default('concise'),
  emitProgressCards: z.boolean().default(true),
  includePayloads: z.boolean().default(false),
  includeTimings: z.boolean().default(true),
})

export const inject = ['penx1Run']

/** 进度行格式化（方案 §23.3）。 */
export function formatProgressLine(toolName: string, status: string): string {
  const label = TOOL_LABELS[toolName] ?? toolName
  const mark = status === 'success' ? '✓' : status === 'blocked' ? '!' : '…'
  return `${mark} ${label}`
}

const TOOL_LABELS: Record<string, string> = {
  penx1_start_analysis: 'Run 创建',
  penx1_plan_tasks: '任务拆解：5项',
  penx1_retrieve_knowledge: '知识库',
  penx1_fetch_market_mock: `市场工具${'【演示Mock数据】'}`,
  penx1_fetch_reviews_mock: `评论工具${'【演示Mock数据】'}`,
  penx1_analyze_market: '市场分析',
  penx1_mine_review_pains: '评论痛点',
  penx1_identify_opportunities: '机会点',
  penx1_build_swot: 'SWOT',
  penx1_build_risk_register: '风险登记册',
  penx1_validate_evidence: 'Evidence Guard',
  penx1_generate_report: 'Markdown 报告',
}

/** 运行指标（方案 §23.4）。 */
export function computeMetrics(projection: RunProjection): Record<string, number | string> {
  return {
    evidence_count: projection.evidenceIds.length,
    artifact_count: projection.artifactIds.length,
    warning_count: projection.warnings.length,
    terminal_phase: projection.phase,
  }
}

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('penx1-trace')
  onEvent<[ToolExecution, Readonly<ToolExecutionResult>]>(ctx, 'tools/result', (exec, result) => {
    if (!isPenx1Tool(exec.name)) return
    if (config.emitProgressCards) {
      const status = result.isError ? 'blocked' : 'success'
      logger.info(formatProgressLine(exec.name, status))
    }
  })
  // 指标输出（仅记录，不改变 Run 状态，方案 §23.6）。
  void computeMetrics
  void config
}
