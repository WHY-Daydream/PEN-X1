/**
 * PEN-X1 Opportunity 插件（方案 §18）。
 * 插件名：penx1-opportunity
 * 联合市场分析与评论痛点生成机会点；必须具有工程依赖，且证据跨域（市场 + 评论）。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Opportunity } from '@penx1/contracts'
import { Penx1Error, isoNow } from '@penx1/contracts'
import { completeStep } from './helpers.js'

export const name = 'penx1-opportunity'

export interface Config {
  maxOpportunities: number
  requireEngineeringDependency: boolean
  requireCrossDomainEvidence: boolean
}

export const Config: z<Config> = z.object({
  maxOpportunities: z.number().default(6),
  requireEngineeringDependency: z.boolean().default(true),
  requireCrossDomainEvidence: z.boolean().default(true),
})

export const inject = ['tools', 'penx1Run', 'penx1Evidence']

export interface OpportunityInput {
  opportunityId: string
  title: string
  userProblem: string
  productResponse: string
  commercialValue: string
  engineeringDependency: string
  evidenceRefs: string[]
}

/** 首版稳定机会方向（方案 §18.5）的确定性检查。 */
export function isStableDirection(title: string): boolean {
  return ['电池可获得性', '价格带', '开关', '五种电池'].some((k) => title.includes(k))
}

export function validateOpportunities(
  opportunities: OpportunityInput[],
  options: { maxOpportunities: number; requireEngineeringDependency: boolean; requireCrossDomainEvidence: boolean },
  domains: Map<string, 'market' | 'review'>,
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (opportunities.length === 0) reasons.push('没有机会点')
  if (opportunities.length > options.maxOpportunities) reasons.push(`机会点超过上限 ${options.maxOpportunities}`)
  for (const opportunity of opportunities) {
    if (options.requireEngineeringDependency && opportunity.engineeringDependency.trim().length === 0) {
      reasons.push(`${opportunity.opportunityId} 缺少工程依赖`)
    }
    const refs = opportunity.evidenceRefs
    if (refs.length === 0) {
      reasons.push(`${opportunity.opportunityId} 没有证据引用（只有推断不得进入下一阶段，方案 §18.6）`)
      continue
    }
    if (options.requireCrossDomainEvidence) {
      const hasMarket = refs.some((ref) => domains.get(ref) === 'market')
      const hasReview = refs.some((ref) => domains.get(ref) === 'review')
      if (!hasMarket || !hasReview) {
        reasons.push(`${opportunity.opportunityId} 证据未跨域（需同时包含市场与评论证据）`)
      }
    }
  }
  return { valid: reasons.length === 0, reasons }
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'penx1_identify_opportunities',
    description: '联合市场分析与评论痛点生成产品机会点（需工程依赖与跨域证据）',
    parameters: {
      runId: { type: 'string', required: true, description: 'PEN-X1 Run ID' },
      opportunities: { type: 'array', required: true, description: '机会点列表', items: { type: 'object', additionalProperties: true } },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          runId: { type: 'string' },
          count: { type: 'number' },
          opportunityIds: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `机会点：${value.count} 项（${(value.opportunityIds ?? []).join('、')}）${(value.warnings ?? []).length > 0 ? `，警告：${(value.warnings ?? []).join('；')}` : ''}` },
      ],
    },
    async execute(args) {
      ctx.penx1Run.assert(args.runId, ['marketAnalysisReady', 'reviewMiningReady'])
      const input = (args.opportunities ?? []) as unknown as OpportunityInput[]
      const domains = new Map<string, 'market' | 'review'>()
      for (const opportunity of input) {
        for (const ref of opportunity.evidenceRefs) {
          try {
            const item = ctx.penx1Evidence.getEvidence(args.runId, ref)
            const domain = (item.content as { domain?: string } | null)?.domain
            if (domain === 'market' || item.sourceRef.includes('mock_prices')) domains.set(ref, 'market')
            if (domain === 'review' || item.sourceRef.includes('mock_reviews')) domains.set(ref, 'review')
          } catch (error) {
            if (error instanceof Penx1Error && error.code === 'EVIDENCE_NOT_FOUND') {
              throw new Penx1Error('EVIDENCE_NOT_FOUND', `机会点 ${opportunity.opportunityId} 引用未登记 Evidence：${ref}`)
            }
            throw error
          }
        }
      }
      const check = validateOpportunities(input, {
        maxOpportunities: config.maxOpportunities,
        requireEngineeringDependency: config.requireEngineeringDependency,
        requireCrossDomainEvidence: config.requireCrossDomainEvidence,
      }, domains)
      if (!check.valid) {
        throw new Penx1Error('ANALYSIS_DEPENDENCY_MISSING', `机会点校验失败：${check.reasons.join('；')}`)
      }
      const artifacts: Opportunity[] = input.map((o) => ({ ...o }))
      const artifactId = `OPPORTUNITY-${args.runId}`
      ctx.penx1Run.recordArtifact(args.runId, { artifactId, runId: args.runId, kind: 'OPPORTUNITY', createdAt: isoNow(), data: artifacts })
      completeStep(ctx, args.runId, 'penx1_identify_opportunities', 'business_skill', 'success', [artifactId], input.flatMap((o) => o.evidenceRefs), check.reasons, artifacts)
      return {
        runId: args.runId,
        count: artifacts.length,
        opportunityIds: artifacts.map((o) => o.opportunityId),
        warnings: check.reasons,
      }
    },
  }))
}
