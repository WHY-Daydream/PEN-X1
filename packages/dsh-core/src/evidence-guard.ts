/**
 * PEN-X1 Evidence Guard 插件（方案 §8）。
 * 插件名：penx1-evidence-guard
 * 提供 ctx.penx1Evidence Service，注册 penx1_validate_evidence 治理工具，
 * 监听 tools/post-execute 检查输出 Evidence ID 是否已登记（方案 §8.2）。
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { Claim, Conflict, EvidenceAudit, EvidenceItem, JsonValue, Penx1Evidence, RiskItem, RiskValidation, ScoredClaim, ValidationResult } from '@penx1/contracts'
import { Penx1Error, onEvent, provideService, validateClaims, validateRisks as validateRiskSchema } from '@penx1/contracts'
import { EvidenceStore } from './evidence-guard-store.js'

export const name = 'penx1-evidence-guard'

export interface Config {
  supportedThreshold: number
  conditionalThreshold: number
  requireEvidenceForEveryClaim: boolean
  requireAllRiskFields: boolean
  mockBaseWeight: number
  inferenceBaseWeight: number
  blockListingOnCriticalMissing: boolean
  requireMockLabels: boolean
}

export const Config: z<Config> = z.object({
  supportedThreshold: z.number().default(0.8),
  conditionalThreshold: z.number().default(0.6),
  requireEvidenceForEveryClaim: z.boolean().default(true),
  requireAllRiskFields: z.boolean().default(true),
  mockBaseWeight: z.number().default(0.7),
  inferenceBaseWeight: z.number().default(0.4),
  blockListingOnCriticalMissing: z.boolean().default(true),
  requireMockLabels: z.boolean().default(true),
})

export const inject = ['tools', 'penx1Run']

export class Penx1EvidenceService implements Penx1Evidence {
  constructor(private readonly store: EvidenceStore) {}

  register(runId: string, items: EvidenceItem[]): void {
    this.store.register(runId, items)
  }

  registerClaims(runId: string, claims: Claim[]): void {
    this.store.registerClaims(runId, claims)
  }

  getEvidence(runId: string, evidenceId: string): EvidenceItem {
    return this.store.getEvidence(runId, evidenceId)
  }

  validateRefs(runId: string, refs: string[]): ValidationResult {
    return this.store.validateRefs(runId, refs)
  }

  detectConflicts(runId: string): Conflict[] {
    return this.store.detectConflicts(runId)
  }

  scoreClaims(runId: string): ScoredClaim[] {
    return this.store.scoreClaims(runId)
  }

  validateRisks(runId: string, risks: RiskItem[]): RiskValidation {
    return this.store.validateRisks(runId, risks)
  }

  finalize(runId: string): EvidenceAudit {
    return this.store.finalize(runId)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    penx1Evidence: Penx1Evidence
  }
}

function runIdFromArguments(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const runId = (args as { runId?: unknown }).runId
  return typeof runId === 'string' ? runId : undefined
}

export function apply(ctx: Context, config: Config): void {
  const store = new EvidenceStore({
    supportedThreshold: config.supportedThreshold,
    conditionalThreshold: config.conditionalThreshold,
    requireEvidenceForEveryClaim: config.requireEvidenceForEveryClaim,
    requireAllRiskFields: config.requireAllRiskFields,
    mockBaseWeight: config.mockBaseWeight,
    inferenceBaseWeight: config.inferenceBaseWeight,
    blockListingOnCriticalMissing: config.blockListingOnCriticalMissing,
    requireMockLabels: config.requireMockLabels,
  })
  provideService(ctx, 'penx1Evidence', new Penx1EvidenceService(store))

  ctx.tools.register(defineTool({
    name: 'penx1_validate_evidence',
    description: '校验 Claim 与风险登记册、检测冲突、计算置信度并生成报告 Gate（未通过则报告插件不可运行）',
    parameters: {
      runId: { type: 'string', required: true, description: 'PEN-X1 Run ID' },
      claims: {
        type: 'array',
        required: true,
        description: '待校验的 Claim 列表（evidenceRefs 必须指向已登记 Evidence）',
        items: { type: 'object', additionalProperties: true },
      },
      risks: {
        type: 'array',
        required: true,
        description: '全生命周期风险登记册（必须字段齐全且 Gate 可验证）',
        items: { type: 'object', additionalProperties: true },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          runId: { type: 'string' },
          audit: { type: 'json' },
          scoredClaims: { type: 'json' },
          conflicts: { type: 'json' },
          riskValidation: { type: 'json' },
        },
      },
      render: (_args, value) => {
        const audit = value.audit as unknown as EvidenceAudit
        const lines = [
          `Evidence Guard：${audit.totalClaims} 条 Claim（SUPPORTED ${audit.supportedClaims} / CONDITIONAL ${audit.conditionalClaims} / INSUFFICIENT ${audit.insufficientClaims} / CONFLICT ${audit.conflictedClaims}），${audit.unresolvedConflicts} 项未解决冲突，${audit.missingCount} 项缺失`,
          `报告授权：${audit.gate.reportAuthorized ? 'PASS' : 'BLOCK'} | Listing 允许：${audit.gate.listingAllowed ? 'PASS' : 'NO_GO'}`,
        ]
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      ctx.penx1Run.assert(args.runId, ['swotReady', 'riskReady'])
      const claimsCheck = validateClaims(args.claims)
      if (!claimsCheck.ok) {
        throw new Penx1Error('CLAIM_SCHEMA_INVALID', `Claim Schema 校验失败：${claimsCheck.error}`)
      }
      const risksCheck = validateRiskSchema(args.risks)
      if (!risksCheck.ok) {
        throw new Penx1Error('RISK_SCHEMA_INVALID', `风险 Schema 校验失败：${risksCheck.error}`)
      }
      const claims = claimsCheck.value
      const risks = risksCheck.value

      for (const claim of claims) {
        const refCheck = store.validateRefs(args.runId, claim.evidenceRefs)
        if (!refCheck.valid) {
          throw new Penx1Error('EVIDENCE_NOT_FOUND', `Claim ${claim.claimId} 引用未登记 Evidence：${refCheck.unknownRefs.join(', ')}`)
        }
      }
      const riskValidation = store.validateRisks(args.runId, risks)
      if (!riskValidation.valid) {
        throw new Penx1Error('RISK_SCHEMA_INVALID', `风险登记册不完整：${JSON.stringify(riskValidation.missingFields)}；Gate 不可验证：${riskValidation.invalidGates.join(', ')}`)
      }
      store.registerClaims(args.runId, claims)
      const scoredClaims = store.scoreClaims(args.runId)
      const conflicts = store.detectConflicts(args.runId)
      const audit = store.finalize(args.runId)
      ctx.penx1Run.recordStep(args.runId, {
        runId: args.runId,
        toolName: 'penx1_validate_evidence',
        capabilityType: 'governance',
        status: 'success',
        previousPhase: ctx.penx1Run.get(args.runId).phase,
        currentPhase: ctx.penx1Run.get(args.runId).phase,
        artifactIds: [],
        evidenceIds: [],
        warnings: audit.gate.reasons,
        data: { audit },
      })
      return {
        runId: args.runId,
        audit: audit as unknown as JsonValue,
        scoredClaims: scoredClaims as unknown as JsonValue,
        conflicts: conflicts as unknown as JsonValue,
        riskValidation: riskValidation as unknown as JsonValue,
      }
    },
  }))

  // 检查工具输出中的 Evidence ID 是否已登记（方案 §8.2）；只记录 Warning，不改结果。
  onEvent<[ToolExecution, Readonly<ToolExecutionResult>, () => Promise<unknown>]>(ctx, 'tools/post-execute', async (exec, _result, next) => {
    if (typeof exec.arguments !== 'object' || exec.arguments === null) return next()
    const args = exec.arguments as Record<string, unknown>
    if (!Array.isArray(args.evidenceIds)) return next()
    const runId = runIdFromArguments(args)
    if (runId === undefined) return next()
    const unknown = (args.evidenceIds as unknown[]).filter((id) => {
      if (typeof id !== 'string') return true
      try {
        store.getEvidence(runId, id)
        return false
      } catch (error) {
        return error instanceof Penx1Error && error.code === 'EVIDENCE_NOT_FOUND'
      }
    })
    if (unknown.length > 0) {
      const run = ctx.penx1Run.get(runId)
      run.warnings.push(`未登记 Evidence 被引用：${unknown.join(', ')}`)
    }
    return next()
  })
}
