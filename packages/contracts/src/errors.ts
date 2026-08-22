/** PEN-X1 错误码与统一错误类型（方案 §4.6）。 */

export const PENX1_ERRORS = [
  'RUN_NOT_FOUND',
  'INVALID_PHASE',
  'KNOWLEDGE_RETRIEVAL_REQUIRED',
  'MARKET_DATA_REQUIRED',
  'REVIEW_DATA_REQUIRED',
  'ANALYSIS_DEPENDENCY_MISSING',
  'MOCK_LABEL_MISSING',
  'EVIDENCE_NOT_FOUND',
  'CLAIM_SCHEMA_INVALID',
  'RISK_SCHEMA_INVALID',
  'CRITICAL_DATA_MISSING',
  'REPORT_NOT_AUTHORIZED',
  'CONFIG_INVALID',
  'DATA_FILE_OUTSIDE_ROOT',
  'INVALID_TOOL_INPUT',
  'BUSINESS_RULE_VIOLATION',
] as const

export type Penx1ErrorCode = typeof PENX1_ERRORS[number]

export class Penx1Error extends Error {
  readonly code: Penx1ErrorCode
  readonly requiredAction: string | undefined

  constructor(code: Penx1ErrorCode, message: string, requiredAction?: string) {
    super(message)
    this.name = 'Penx1Error'
    this.code = code
    this.requiredAction = requiredAction
  }
}
