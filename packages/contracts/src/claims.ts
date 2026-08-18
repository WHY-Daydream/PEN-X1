/** PEN-X1 Claim 模型（方案 §4.3 / §8.4）。 */

export type ClaimStatus = 'SUPPORTED' | 'CONDITIONAL' | 'INSUFFICIENT' | 'CONFLICT'

export interface Claim {
  claimId: string
  claimType: string
  text: string
  evidenceRefs: string[]
  confidence?: number
  status?: ClaimStatus
  limitations: string[]
}

export interface ScoredClaim extends Claim {
  confidence: number
  status: ClaimStatus
}

export interface ValidationResult {
  valid: boolean
  unknownRefs: string[]
  totalRefs: number
}

export type ConflictType =
  | 'HARD_CONFLICT'
  | 'TEMPORAL_VARIANCE'
  | 'CONDITION_MISMATCH'
  | 'TARGET_VS_OBSERVED'

export interface Conflict {
  conflictId: string
  type: ConflictType
  subject: string
  evidenceIds: string[]
  description: string
  resolved: boolean
}
