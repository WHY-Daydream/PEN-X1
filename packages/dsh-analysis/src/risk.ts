/**
 * PEN-X1 Risk 插件（方案 §20）。
 * 插件名：penx1-risk
 * 全生命周期风险登记册：最少 10 项、覆盖 R&D/MASS_PRODUCTION/OVERSEAS_LAUNCH、
 * 关键工程风险必须存在、Validation Gate 必须可验证。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { RiskItem } from '@penx1/contracts'
import { Penx1Error, RISK_REQUIRED_FIELDS, isVerifiableGate, isoNow } from '@penx1/contracts'
import { completeStep } from './helpers.js'

export const name = 'penx1-risk'

export interface Config {
  minimumRiskCount: number
  requiredPhases: string[]
}

export const Config: z<Config> = z.object({
  minimumRiskCount: z.number().default(10),
  requiredPhases: z.array(z.string()).default(['R&D', 'MASS_PRODUCTION', 'OVERSEAS_LAUNCH']),
})

export const inject = ['tools', 'penx1Run', 'penx1Evidence']

export const CRITICAL_ENGINEERING_RISKS = ['多长度', '升压', '误识别', '温升']

export interface RiskRegisterCheck {
  valid: boolean
  reasons: string[]
}

/** 确定性校验（方案 §20.6）。 */
export function validateRiskRegister(risks: RiskItem[], config: Config): RiskRegisterCheck {
  const reasons: string[] = []
  if (risks.length < config.minimumRiskCount) reasons.push(`风险数量 ${risks.length} 少于 ${config.minimumRiskCount}`)
  for (const phase of config.requiredPhases) {
    if (!risks.some((r) => r.phase === phase)) reasons.push(`缺少生命周期阶段 ${phase}`)
  }
  for (const keyword of CRITICAL_ENGINEERING_RISKS) {
    if (!risks.some((r) => r.rootCause.includes(keyword) || r.negativeImpact.includes(keyword))) {
      reasons.push(`缺少关键工程风险：${keyword}`)
    }
  }
  for (const risk of risks) {
    for (const field of RISK_REQUIRED_FIELDS) {
      const value = risk[field]
      if (value === undefined || value === null || (Array.isArray(value) && (value as unknown[]).length === 0)) {
        reasons.push(`${risk.riskId} 缺少字段 ${field}`)
      }
    }
    if (!isVerifiableGate(risk.validationGate)) reasons.push(`${risk.riskId} Gate 不可验证：「${risk.validationGate}」`)
  }
  return { valid: reasons.length === 0, reasons }
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'penx1_build_risk_register',
    description: '建立全生命周期风险登记册（字段完整、Gate 可验证、三阶段全覆盖）',
    parameters: {
      runId: { type: 'string', required: true, description: 'PEN-X1 Run ID' },
      risks: { type: 'array', required: true, description: '风险列表（基于固定风险库模板）', items: { type: 'object', additionalProperties: true } },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          runId: { type: 'string' },
          count: { type: 'number' },
          phases: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `风险登记册：${value.count} 项，覆盖阶段 ${(value.phases ?? []).join('、')}` },
      ],
    },
    async execute(args) {
      ctx.penx1Run.assert(args.runId, ['opportunitiesReady'])
      const risks = (args.risks ?? []) as unknown as RiskItem[]
      const check = validateRiskRegister(risks, config)
      if (!check.valid) {
        throw new Penx1Error('RISK_SCHEMA_INVALID', `风险登记册校验失败：${check.reasons.join('；')}`)
      }
      const artifactId = `RISK-${args.runId}`
      ctx.penx1Run.recordArtifact(args.runId, { artifactId, runId: args.runId, kind: 'RISK_REGISTER', createdAt: isoNow(), data: risks })
      const phases = [...new Set(risks.map((r) => r.phase))]
      completeStep(ctx, args.runId, 'penx1_build_risk_register', 'business_skill', 'success', [artifactId], risks.flatMap((r) => r.evidenceRefs), [], risks)
      return { runId: args.runId, count: risks.length, phases }
    },
  }))
}
