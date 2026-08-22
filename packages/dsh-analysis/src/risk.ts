/**
 * PEN-X1 Risk 插件（方案 §20）。
 * 插件名：penx1-risk
 * 全生命周期风险登记册：最少 10 项、覆盖 R&D/MASS_PRODUCTION/OVERSEAS_LAUNCH、
 * 关键工程风险必须存在、Validation Gate 必须可验证。
 *
 * Commit #3 改造（tool-contract hardening）：
 * - schema 收紧：risks items 定义 properties + required（canonical 字段）
 * - execute 中逐项 assertObject + requireString/requireStringArray，缺字段抛结构化
 *   INVALID_TOOL_INPUT（模型可据此修复参数），消除 risk.ts:44 `undefined.includes()` 崩溃
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { RiskItem } from '@penx1/contracts'
import { Penx1Error, RISK_REQUIRED_FIELDS, isVerifiableGate, isoNow } from '@penx1/contracts'
import { completeStep } from './helpers.js'
import { assertObject, requireString, requireStringArray } from './input-guard.js'

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

/**
 * 规范化并校验单条风险输入（LLM Tool Input → Runtime Validation → Normalization）。
 * 缺字段 / 类型错 / 空串 → INVALID_TOOL_INPUT（结构化，Agent 可据此修复参数），
 * 而非 `undefined.includes()` 崩溃（Agent 只会盲目重试并烧光 Step Budget）。
 */
function normalizeRiskItem(raw: unknown, index: number): RiskItem {
  assertObject(raw, `risks[${index}]`)
  const obj = raw as Record<string, unknown>
  return {
    riskId: requireString(obj, `risks[${index}].riskId`, ['riskId'], 'riskId'),
    phase: requireString(obj, `risks[${index}].phase`, ['phase'], 'phase') as RiskItem['phase'],
    severity: requireString(obj, `risks[${index}].severity`, ['severity'], 'severity') as RiskItem['severity'],
    difficulty: requireString(obj, `risks[${index}].difficulty`, ['difficulty'], 'difficulty') as RiskItem['difficulty'],
    rootCause: requireString(obj, `risks[${index}].rootCause`, ['rootCause'], 'rootCause'),
    negativeImpact: requireString(obj, `risks[${index}].negativeImpact`, ['negativeImpact'], 'negativeImpact'),
    mitigation: requireString(obj, `risks[${index}].mitigation`, ['mitigation'], 'mitigation'),
    validationGate: requireString(obj, `risks[${index}].validationGate`, ['validationGate'], 'validationGate'),
    owner: requireString(obj, `risks[${index}].owner`, ['owner', 'responsible'], 'owner'),
    evidenceRefs: requireStringArray(obj, `risks[${index}].evidenceRefs`, ['evidenceRefs'], 'evidenceRefs'),
  }
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
      risks: {
        type: 'array',
        required: true,
        description: '风险列表（基于固定风险库模板）',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            riskId: { type: 'string',  },
            phase: { type: 'string', enum: ['R&D', 'EVT', 'DVT', 'PVT', 'MASS_PRODUCTION', 'OVERSEAS_LAUNCH'] },
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            difficulty: { type: 'string', enum: ['high', 'medium', 'low'] },
            rootCause: { type: 'string',  },
            negativeImpact: { type: 'string',  },
            mitigation: { type: 'string',  },
            validationGate: { type: 'string',  },
            owner: { type: 'string',  },
            evidenceRefs: { type: 'array', items: { type: 'string',  } },
          },
        },
      },
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
      const rawInput = Array.isArray(args.risks) ? (args.risks as unknown[]) : []
      // 输入契约校验：逐项 assertObject + requireString，缺字段走结构化 INVALID_TOOL_INPUT
      const risks: RiskItem[] = rawInput.map((raw, index) => normalizeRiskItem(raw, index))
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
