/** PEN-X1 运行阶段与 Run 投影（方案 §4.1 / §26）。 */

export type RunPhase =
  | 'INIT'
  | 'PLANNED'
  | 'KB_READY'
  | 'DATA_READY'
  | 'ANALYSIS_READY'
  | 'VALIDATED'
  | 'REPORT_READY'
  | 'BLOCKED'
  | 'FAILED'

export interface RunProjection {
  runId: string
  sessionId: string
  phase: RunPhase
  completed: Record<string, boolean>
  artifactIds: string[]
  evidenceIds: string[]
  warnings: string[]
  terminalReason?: string
}

export const PHASE_FLAGS = [
  'runStarted',
  'planReady',
  'knowledgeReady',
  'marketDataReady',
  'reviewDataReady',
  'marketAnalysisReady',
  'reviewMiningReady',
  'opportunitiesReady',
  'swotReady',
  'riskReady',
  'validationPassed',
  'reportReady',
] as const

export type PhaseFlag = typeof PHASE_FLAGS[number]

/** 细粒度 Artifact Flag → 高层 Phase 派生规则（方案 §26，按优先级从高到低）。 */
export const PHASE_DERIVATION: ReadonlyArray<{ phase: Exclude<RunPhase, 'BLOCKED' | 'FAILED' | 'REPORT_READY'>; require: PhaseFlag[] }> = [
  { phase: 'VALIDATED', require: ['validationPassed'] },
  { phase: 'ANALYSIS_READY', require: ['swotReady', 'riskReady'] },
  { phase: 'DATA_READY', require: ['marketDataReady', 'reviewDataReady'] },
  { phase: 'KB_READY', require: ['knowledgeReady'] },
  { phase: 'PLANNED', require: ['planReady'] },
  { phase: 'INIT', require: ['runStarted'] },
]

/**
 * 由 completed flags 派生 Phase。REPORT_READY 由 reportReady 单独判断；
 * BLOCKED / FAILED 是终态，由 Run State 显式写入，不在此派生。
 */
export function derivePhase(completed: Record<string, boolean>): RunPhase {
  if (completed.reportReady === true) return 'REPORT_READY'
  for (const { phase, require } of PHASE_DERIVATION) {
    if (require.every((flag) => completed[flag] === true)) return phase
  }
  return 'INIT'
}
