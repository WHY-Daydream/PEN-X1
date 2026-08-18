/**
 * PEN-X1 Evidence Guard 纯逻辑存储（方案 §8）。
 * 职责：证据登记、Claim 校验、冲突检测、置信度计算、风险门禁与最终 Gate。
 * 置信度只由本模块计算，模型输出中的 confidence 字段一律忽略（方案 §8.4）。
 */

import type {
  Claim,
  Conflict,
  EvidenceAudit,
  EvidenceItem,
  RiskItem,
  RiskValidation,
  ScoredClaim,
  ValidationResult,
} from '@penx1/contracts'
import {
  MOCK_BANNER,
  Penx1Error,
  RISK_REQUIRED_FIELDS,
  isMockLabel,
  isVerifiableGate,
} from '@penx1/contracts'

export interface EvidenceOptions {
  supportedThreshold: number
  conditionalThreshold: number
  requireEvidenceForEveryClaim: boolean
  requireAllRiskFields: boolean
  mockBaseWeight: number
  inferenceBaseWeight: number
  blockListingOnCriticalMissing: boolean
  requireMockLabels: boolean
}

const SOURCE_QUALITY: Record<string, number> = {
  ATTACHMENT: 1.0,
  INTERNAL_TEST: 0.9,
  GENERIC_KNOWLEDGE: 0.65,
  DEMO_MOCK: 0.7,
  INFERENCE: 0.4,
  MISSING: 0.0,
}

/** 冲突主体：evidence content 为对象且含 subject/value 时参与冲突检测。 */
interface ComparableEvidence {
  item: EvidenceItem
  subject: string
  value: unknown
  capturedAt?: string
  condition?: string
  kind?: string
}

export class EvidenceStore {
  private readonly evidence = new Map<string, EvidenceItem[]>()
  private readonly claims = new Map<string, Claim[]>()

  constructor(private readonly options: EvidenceOptions) {}

  register(runId: string, items: EvidenceItem[]): void {
    const list = this.evidence.get(runId) ?? []
    for (const item of items) {
      if (item.sourceType === 'DEMO_MOCK' && this.options.requireMockLabels && !isMockLabel(item.sourceLabel)) {
        throw new Penx1Error('MOCK_LABEL_MISSING', `Evidence ${item.evidenceId} 缺少 ${MOCK_BANNER} 标签`)
      }
      list.push(item)
    }
    this.evidence.set(runId, list)
  }

  registerClaims(runId: string, claims: Claim[]): void {
    this.claims.set(runId, claims)
  }

  getEvidence(runId: string, evidenceId: string): EvidenceItem {
    const item = (this.evidence.get(runId) ?? []).find((e) => e.evidenceId === evidenceId)
    if (item === undefined) throw new Penx1Error('EVIDENCE_NOT_FOUND', `Evidence 不存在：${evidenceId}`)
    return item
  }

  validateRefs(runId: string, refs: string[]): ValidationResult {
    const known = new Set((this.evidence.get(runId) ?? []).map((e) => e.evidenceId))
    const unknownRefs = refs.filter((ref) => !known.has(ref))
    return { valid: unknownRefs.length === 0, unknownRefs, totalRefs: refs.length }
  }

  detectConflicts(runId: string): Conflict[] {
    const comparable = this.comparableEvidence(runId)
    const bySubject = new Map<string, ComparableEvidence[]>()
    for (const entry of comparable) {
      const list = bySubject.get(entry.subject) ?? []
      list.push(entry)
      bySubject.set(entry.subject, list)
    }
    const conflicts: Conflict[] = []
    let seq = 0
    for (const [subject, entries] of bySubject) {
      if (entries.length < 2) continue
      const values = new Set(entries.map((e) => JSON.stringify(e.value)))
      if (values.size <= 1) continue
      const [first, second] = entries
      const firstMeta = entries[0]!
      let type: Conflict['type'] = 'HARD_CONFLICT'
      if (firstMeta.condition !== undefined && second!.condition !== firstMeta.condition) {
        type = 'CONDITION_MISMATCH'
      } else if (firstMeta.capturedAt !== undefined && second!.capturedAt !== undefined && firstMeta.capturedAt !== second!.capturedAt) {
        type = 'TEMPORAL_VARIANCE'
      } else if (firstMeta.kind !== undefined && second!.kind !== firstMeta.kind) {
        type = 'TARGET_VS_OBSERVED'
      }
      conflicts.push({
        conflictId: `CFL-${String(++seq).padStart(3, '0')}`,
        type,
        subject,
        evidenceIds: entries.map((e) => e.item.evidenceId),
        description: `${subject} 存在不一致取值：${[...values].slice(0, 3).join(' / ')}（${type}）`,
        resolved: false,
      })
    }
    return conflicts
  }

  scoreClaims(runId: string): ScoredClaim[] {
    const claims = this.claims.get(runId) ?? []
    const conflicts = this.detectConflicts(runId)
    const conflictedEvidence = new Set(conflicts.filter((c) => !c.resolved).flatMap((c) => c.evidenceIds))
    return claims.map((claim) => this.scoreClaim(runId, claim, conflictedEvidence))
  }

  /** 每项风险必须字段齐全且 Gate 可验证（方案 §8.6 / §20.6）。 */
  validateRisks(runId: string, risks: RiskItem[]): RiskValidation {
    const missingFields: Record<string, RiskRequiredField[]> = {}
    const invalidGates: string[] = []
    for (const risk of risks) {
      const missing = RISK_REQUIRED_FIELDS.filter((field) => {
        const value = risk[field]
        return value === undefined || value === null || (Array.isArray(value) && (value as unknown[]).length === 0) || (typeof value === 'string' && value.trim().length === 0)
      }) as RiskRequiredField[]
      if (missing.length > 0) missingFields[risk.riskId] = missing
      if (!isVerifiableGate(risk.validationGate)) invalidGates.push(risk.riskId)
      if (this.options.requireAllRiskFields) {
        const refCheck = this.validateRefs(runId, risk.evidenceRefs)
        if (!refCheck.valid) missingFields[risk.riskId] = [...(missingFields[risk.riskId] ?? []), 'evidenceRefs']
      }
    }
    const invalid = Object.keys(missingFields).length > 0 || invalidGates.length > 0
    return { valid: !invalid, missingFields, invalidGates }
  }

  finalize(runId: string): EvidenceAudit {
    const allEvidence = this.evidence.get(runId) ?? []
    const claims = this.claims.get(runId) ?? []
    const conflicts = this.detectConflicts(runId)
    const scored = this.scoreClaims(runId)
    const unresolvedConflicts = conflicts.filter((c) => !c.resolved).length
    const missingCount = allEvidence.filter((e) => e.sourceType === 'MISSING').length
    const counted = {
      supported: scored.filter((c) => c.status === 'SUPPORTED').length,
      conditional: scored.filter((c) => c.status === 'CONDITIONAL').length,
      insufficient: scored.filter((c) => c.status === 'INSUFFICIENT').length,
      conflicted: scored.filter((c) => c.status === 'CONFLICT').length,
    }
    const reportAuthorized = claims.length > 0 && scored.every((c) => c.status !== 'CONFLICT' && c.status !== 'INSUFFICIENT')
    const listingBlocked = this.options.blockListingOnCriticalMissing && missingCount > 0
    const reasons: string[] = []
    if (claims.length === 0) reasons.push('没有登记任何 Claim')
    if (unresolvedConflicts > 0) reasons.push(`${unresolvedConflicts} 项冲突未解决`)
    if (missingCount > 0 && this.options.blockListingOnCriticalMissing) reasons.push(`${missingCount} 项关键数据缺失，Listing 不允许`)
    return {
      runId,
      totalEvidence: allEvidence.length,
      totalClaims: claims.length,
      supportedClaims: counted.supported,
      conditionalClaims: counted.conditional,
      insufficientClaims: counted.insufficient,
      conflictedClaims: counted.conflicted,
      unresolvedConflicts,
      missingCount,
      gate: {
        reportAuthorized,
        listingAllowed: !listingBlocked,
        reasons,
      },
    }
  }

  private comparableEvidence(runId: string): ComparableEvidence[] {
    const result: ComparableEvidence[] = []
    for (const item of this.evidence.get(runId) ?? []) {
      if (typeof item.content !== 'object' || item.content === null) continue
      const content = item.content as Record<string, unknown>
      const subject = content.subject
      if (typeof subject !== 'string' || !('value' in content)) continue
      result.push({
        item,
        subject,
        value: content.value,
        capturedAt: typeof content.capturedAt === 'string' ? content.capturedAt : undefined,
        condition: typeof content.condition === 'string' ? content.condition : undefined,
        kind: typeof content.kind === 'string' ? content.kind : undefined,
      })
    }
    return result
  }

  private scoreClaim(runId: string, claim: Claim, conflictedEvidence: Set<string>): ScoredClaim {
    const refCheck = this.validateRefs(runId, claim.evidenceRefs)
    const refs = claim.evidenceRefs
    const touchedByConflict = refs.some((ref) => conflictedEvidence.has(ref))
    if (touchedByConflict) {
      return { ...claim, confidence: 0, status: 'CONFLICT' }
    }
    const sourceQuality = refCheck.valid && refs.length > 0
      ? Math.max(...refs.map((ref) => this.sourceQuality(runId, ref)))
      : 0
    const distinctSources = new Set(refs.map((ref) => {
      const item = (this.evidence.get(runId) ?? []).find((e) => e.evidenceId === ref)
      return item?.sourceRef ?? item?.sourceType ?? ref
    })).size
    const crossSourceConsistency = distinctSources >= 3 ? 1.0 : distinctSources === 2 ? 0.8 : distinctSources === 1 ? 0.5 : 0
    const completeness = refs.length > 0 ? (refs.length - refCheck.unknownRefs.length) / refs.length : 0
    const confidence = 0.5 * sourceQuality + 0.3 * crossSourceConsistency + 0.2 * completeness
    let status: ScoredClaim['status']
    if (this.options.requireEvidenceForEveryClaim && refs.length === 0) {
      status = 'INSUFFICIENT'
    } else if (confidence >= this.options.supportedThreshold) {
      status = 'SUPPORTED'
    } else if (confidence >= this.options.conditionalThreshold) {
      status = 'CONDITIONAL'
    } else {
      status = 'INSUFFICIENT'
    }
    return { ...claim, confidence, status }
  }

  private sourceQuality(runId: string, ref: string): number {
    const item = (this.evidence.get(runId) ?? []).find((e) => e.evidenceId === ref)
    if (item === undefined) return 0
    if (item.sourceType === 'DEMO_MOCK') return this.options.mockBaseWeight
    if (item.sourceType === 'INFERENCE') return this.options.inferenceBaseWeight
    return SOURCE_QUALITY[item.sourceType] ?? 0
  }
}

type RiskRequiredField = (typeof RISK_REQUIRED_FIELDS)[number]
