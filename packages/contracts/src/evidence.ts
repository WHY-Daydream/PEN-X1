/** PEN-X1 证据模型（方案 §4.2 / §8）。 */

/** 所有 Mock 数据必须携带的标签（Provider、Tool、Evidence、Report 四层标注）。 */
export const MOCK_BANNER = '【演示Mock数据】'

export function isMockLabel(label: string): boolean {
  return label.includes(MOCK_BANNER)
}

export type EvidenceSourceType =
  | 'ATTACHMENT'
  | 'INTERNAL_TEST'
  | 'DEMO_MOCK'
  | 'GENERIC_KNOWLEDGE'
  | 'INFERENCE'
  | 'MISSING'

export interface EvidenceItem {
  evidenceId: string
  sourceType: EvidenceSourceType
  sourceLabel: string
  sourceRef: string
  sourceTimestamp?: string
  content: unknown
  contentHash: string
}

export interface EvidenceAudit {
  runId: string
  totalEvidence: number
  totalClaims: number
  supportedClaims: number
  conditionalClaims: number
  insufficientClaims: number
  conflictedClaims: number
  unresolvedConflicts: number
  missingCount: number
  gate: {
    reportAuthorized: boolean
    listingAllowed: boolean
    reasons: string[]
  }
}
