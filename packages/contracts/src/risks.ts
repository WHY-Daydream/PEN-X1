/** PEN-X1 风险模型（方案 §4.4 / §8.6 / §20）。 */

export type RiskPhase = 'R&D' | 'EVT' | 'DVT' | 'PVT' | 'MASS_PRODUCTION' | 'OVERSEAS_LAUNCH'
export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low'
export type RiskDifficulty = 'high' | 'medium' | 'low'

export const RISK_REQUIRED_FIELDS = [
  'phase',
  'severity',
  'difficulty',
  'rootCause',
  'negativeImpact',
  'mitigation',
  'validationGate',
  'owner',
  'evidenceRefs',
] as const

export type RiskRequiredField = typeof RISK_REQUIRED_FIELDS[number]

export interface RiskItem {
  riskId: string
  phase: RiskPhase
  severity: RiskSeverity
  difficulty: RiskDifficulty
  rootCause: string
  negativeImpact: string
  mitigation: string
  validationGate: string
  owner: string
  evidenceRefs: string[]
}

export interface RiskValidation {
  valid: boolean
  missingFields: Record<string, RiskRequiredField[]>
  invalidGates: string[]
}

/** 不可验证的 Gate 表述（方案 §20.6：Validation Gate 必须是可观察、可判定条件）。 */
export const UNVERIFIABLE_GATE_PATTERNS = ['进一步观察', '继续观察', '持续跟踪', '待评估', '视情况而定', 'later', 'observe', 'monitor'] as const

export function isVerifiableGate(gate: string): boolean {
  const lower = gate.toLowerCase()
  return !UNVERIFIABLE_GATE_PATTERNS.some((p) => lower.includes(p))
}
