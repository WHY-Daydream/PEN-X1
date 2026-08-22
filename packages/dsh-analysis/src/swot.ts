/**
 * PEN-X1 SWOT 插件（方案 §19）。
 * 插件名：penx1-swot
 * 生成证据化 SWOT；每象限 2–4 项；Strength/Weakness 描述内部属性，
 * Opportunity/Threat 描述外部环境；缺失性能不得作为 Strength。
 *
 * Commit #3 改造（tool-contract hardening）：
 * - schema 收紧：items 定义 properties + required（quadrant/statement/evidenceRefs/limitations）
 * - execute 中逐项 assertObject + requireString/requireStringArray，缺字段抛结构化 INVALID_TOOL_INPUT
 * - 语义校验（如"未描述 PEN-X1 内部属性"）用 BUSINESS_RULE_VIOLATION，不放宽内部属性规则
 * - 错误码分离：结构合法性 → INVALID_TOOL_INPUT；语义合规性 → BUSINESS_RULE_VIOLATION
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SwotItem, SwotQuadrant } from '@penx1/contracts'
import { Penx1Error, isoNow } from '@penx1/contracts'
import { completeStep } from './helpers.js'
import { assertObject, requireString, requireStringArray, optionalStringArray } from './input-guard.js'

export const name = 'penx1-swot'

export interface Config {
  minItemsPerQuadrant: number
  maxItemsPerQuadrant: number
  rejectGenericStatements: boolean
}

export const Config: z<Config> = z.object({
  minItemsPerQuadrant: z.number().default(2),
  maxItemsPerQuadrant: z.number().default(4),
  rejectGenericStatements: z.boolean().default(true),
})

export const inject = ['tools', 'penx1Run', 'penx1Evidence']

const GENERIC_TERMS = ['领先地位', '行业第一', '最佳选择', '全面领先', '优秀品质', 'best-in-class', 'top-tier']

const INTERNAL_TERMS = ['pen-x1', '产品', '结构', '开关', '电池', '升压', '档位', '长度', '防水', '亮度', '重量']
const EXTERNAL_TERMS = ['市场', '竞品', '用户', 'amazon', '评论', '北美', '价格', '渠道', 'listing', '消费者']

/**
 * 规范化并校验单条 SWOT 输入（LLM Tool Input → Runtime Validation → Normalization）。
 * 缺字段 / 类型错 / 空串 → INVALID_TOOL_INPUT（结构化，Agent 可据此修复参数）。
 */
function normalizeSwotItem(raw: unknown, index: number): SwotItem {
  assertObject(raw, `items[${index}]`)
  const obj = raw as Record<string, unknown>
  const quadrant = requireString(obj, `items[${index}].quadrant`, ['quadrant'], 'quadrant') as SwotQuadrant
  return {
    quadrant,
    statement: requireString(obj, `items[${index}].statement`, ['statement'], 'statement'),
    evidenceRefs: requireStringArray(obj, `items[${index}].evidenceRefs`, ['evidenceRefs'], 'evidenceRefs'),
    limitations: optionalStringArray(obj, `items[${index}].limitations`, ['limitations']) ?? [],
  }
}

/** 每项必须声明证据引用；缺失性能不得作为 Strength（方案 §19.4）。 */
export function validateSwot(
  items: SwotItem[],
  options: { minItemsPerQuadrant: number; maxItemsPerQuadrant: number; rejectGenericStatements: boolean },
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = []
  const counts: Record<string, number> = { strengths: 0, weaknesses: 0, opportunities: 0, threats: 0 }
  for (const item of items) {
    counts[item.quadrant] = (counts[item.quadrant] ?? 0) + 1
    if (item.evidenceRefs.length === 0) reasons.push(`${item.quadrant}:「${item.statement}」没有证据引用`)
    if (options.rejectGenericStatements && GENERIC_TERMS.some((t) => item.statement.toLowerCase().includes(t))) {
      reasons.push(`${item.quadrant}:「${item.statement}」是通用模板语言`)
    }
    const lower = item.statement.toLowerCase()
    if (item.quadrant === 'strengths' || item.quadrant === 'weaknesses') {
      if (!INTERNAL_TERMS.some((t) => lower.includes(t))) {
        reasons.push(`${item.quadrant}:「${item.statement}」未描述 PEN-X1 内部属性`)
      }
    } else {
      if (!EXTERNAL_TERMS.some((t) => lower.includes(t))) {
        reasons.push(`${item.quadrant}:「${item.statement}」未描述外部市场/用户环境`)
      }
    }
  }
  for (const [quadrant, count] of Object.entries(counts)) {
    if (count < options.minItemsPerQuadrant) reasons.push(`${quadrant} 少于 ${options.minItemsPerQuadrant} 项`)
    if (count > options.maxItemsPerQuadrant) reasons.push(`${quadrant} 超过 ${options.maxItemsPerQuadrant} 项`)
  }
  return { valid: reasons.length === 0, reasons }
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'penx1_build_swot',
    description: '生成证据化 SWOT（每象限 2–4 项，内部/外部属性分类校验）',
    parameters: {
      runId: { type: 'string', required: true, description: 'PEN-X1 Run ID' },
      items: {
        type: 'array',
        required: true,
        description: 'SWOT 条目（含 quadrant/statement/evidenceRefs/limitations）',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            quadrant: { type: 'string', enum: ['strengths', 'weaknesses', 'opportunities', 'threats'] },
            statement: { type: 'string',  },
            evidenceRefs: { type: 'array', items: { type: 'string',  } },
            limitations: { type: 'array', items: { type: 'string' } },
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
          byQuadrant: { type: 'object', additionalProperties: true },
        },
      },
      render: (_args, value) => {
        const byQuadrant = (value.byQuadrant ?? {}) as unknown as Record<string, number>
        return [
          { type: 'text', text: `SWOT：S ${byQuadrant.strengths ?? 0} / W ${byQuadrant.weaknesses ?? 0} / O ${byQuadrant.opportunities ?? 0} / T ${byQuadrant.threats ?? 0}` },
        ]
      },
    },
    async execute(args) {
      ctx.penx1Run.assert(args.runId, ['opportunitiesReady'])
      const rawInput = Array.isArray(args.items) ? (args.items as unknown[]) : []
      // 输入契约校验：逐项 assertObject + requireString/requireStringArray
      // 缺字段走结构化 INVALID_TOOL_INPUT；语义违规走 BUSINESS_RULE_VIOLATION
      const items: SwotItem[] = rawInput.map((raw, index) => normalizeSwotItem(raw, index))
      const check = validateSwot(items, {
        minItemsPerQuadrant: config.minItemsPerQuadrant,
        maxItemsPerQuadrant: config.maxItemsPerQuadrant,
        rejectGenericStatements: config.rejectGenericStatements,
      })
      if (!check.valid) {
        // 错误码分离：语义规则（内部属性、外部属性、通用模板、数量范围）→ BUSINESS_RULE_VIOLATION
        // 结构问题（缺字段/类型错）已在 normalizeSwotItem 中以 INVALID_TOOL_INPUT 抛出
        throw new Penx1Error('BUSINESS_RULE_VIOLATION', `SWOT 校验失败：${check.reasons.join('；')}`)
      }
      const artifactId = `SWOT-${args.runId}`
      ctx.penx1Run.recordArtifact(args.runId, { artifactId, runId: args.runId, kind: 'SWOT', createdAt: isoNow(), data: items })
      const byQuadrant: Record<string, number> = { strengths: 0, weaknesses: 0, opportunities: 0, threats: 0 }
      for (const item of items) byQuadrant[item.quadrant] = (byQuadrant[item.quadrant] ?? 0) + 1
      completeStep(ctx, args.runId, 'penx1_build_swot', 'business_skill', 'success', [artifactId], items.flatMap((i) => i.evidenceRefs), [], items)
      return { runId: args.runId, count: items.length, byQuadrant }
    },
  }))
}
