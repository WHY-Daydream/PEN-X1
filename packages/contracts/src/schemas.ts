/** PEN-X1 Schemastery Schema：供插件对 Canonical Output 做结构校验。
 *  注意：schemastery 的 Schema 是可调用实例（schema(data) 返回归一化结果），
 *  对象属性默认可选，需用 .required() 标记必填。 */

import z from '@deepseek-ai/schemastery'
import type { Claim, RiskItem } from './index.js'

export const ClaimSchema = z.object({
  claimId: z.string().required(),
  claimType: z.string().required(),
  text: z.string().required(),
  evidenceRefs: z.array(z.string()).required(),
  confidence: z.number(),
  status: z.union(['SUPPORTED', 'CONDITIONAL', 'INSUFFICIENT', 'CONFLICT'] as const),
  limitations: z.array(z.string()).default([]),
})

export const RiskItemSchema = z.object({
  riskId: z.string().required(),
  phase: z.union(['R&D', 'EVT', 'DVT', 'PVT', 'MASS_PRODUCTION', 'OVERSEAS_LAUNCH'] as const).required(),
  severity: z.union(['critical', 'high', 'medium', 'low'] as const).required(),
  difficulty: z.union(['high', 'medium', 'low'] as const).required(),
  rootCause: z.string().required(),
  negativeImpact: z.string().required(),
  mitigation: z.string().required(),
  validationGate: z.string().required(),
  owner: z.string().required(),
  evidenceRefs: z.array(z.string()).required(),
})

export const OpportunitySchema = z.object({
  opportunityId: z.string().required(),
  title: z.string().required(),
  userProblem: z.string().required(),
  productResponse: z.string().required(),
  commercialValue: z.string().required(),
  engineeringDependency: z.string().required(),
  evidenceRefs: z.array(z.string()).required(),
})

export const SwotItemSchema = z.object({
  quadrant: z.union(['strengths', 'weaknesses', 'opportunities', 'threats'] as const).required(),
  statement: z.string().required(),
  evidenceRefs: z.array(z.string()).required(),
  limitations: z.array(z.string()).default([]),
})

export const ToolResultEnvelopeSchema = z.object({
  runId: z.string().required(),
  toolName: z.string().required(),
  capabilityType: z.union(['control', 'knowledge', 'external_mock', 'business_skill', 'governance', 'output'] as const).required(),
  status: z.union(['success', 'degraded', 'blocked', 'failed'] as const).required(),
  previousPhase: z.string().required(),
  currentPhase: z.string().required(),
  artifactIds: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
})

export type TryValidateResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function tryValidate<T>(schema: unknown, value: unknown): TryValidateResult<T> {
  try {
    const result = (schema as (data: unknown) => unknown)(value) as T
    return { ok: true, value: result }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function validateClaims(claims: unknown): TryValidateResult<Claim[]> {
  if (!Array.isArray(claims)) return { ok: false, error: 'claims 必须是数组' }
  const results: Claim[] = []
  for (const item of claims) {
    const r = tryValidate<Claim>(ClaimSchema, item)
    if (!r.ok) return r
    results.push(r.value)
  }
  return { ok: true, value: results }
}

export function validateRisks(risks: unknown): TryValidateResult<RiskItem[]> {
  if (!Array.isArray(risks)) return { ok: false, error: 'risks 必须是数组' }
  const results: RiskItem[] = []
  for (const item of risks) {
    const r = tryValidate<RiskItem>(RiskItemSchema, item)
    if (!r.ok) return r
    results.push(r.value)
  }
  return { ok: true, value: results }
}
