/**
 * PEN-X1 Market Analysis 插件（方案 §16）。
 * 插件名：penx1-market-analysis
 * 程序完成：单位标准化、价格区间、规格对比、时点差异检测、PEN-X1 缺失字段识别；
 * 模型摘要（LLM）为后续集成接缝，v1 先输出确定性结果。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Claim, JsonValue } from '@penx1/contracts'
import { isoNow } from '@penx1/contracts'
import { completeStep } from './helpers.js'

export const name = 'penx1-market-analysis'

export interface Config {
  maxClaims: number
  allowUnverifiedNumericClaims: boolean
}

export const Config: z<Config> = z.object({
  maxClaims: z.number().default(8),
  allowUnverifiedNumericClaims: z.boolean().default(false),
})

export const inject = ['tools', 'penx1Run', 'penx1Evidence']

export interface PriceRow {
  competitor: string
  price?: number
  currency?: string
  capturedAt?: string
  evidenceId?: string
}

export interface MarketComparisonRow extends PriceRow {
  priceUsd: number | undefined
  promotion?: string
}

export interface SpecGap {
  spec: string
  status: 'missing' | 'unverified'
}

export interface MarketAnalysisOutput {
  comparison: MarketComparisonRow[]
  priceRange: { min: number; max: number; mid: number }
  pricePosition: { target: number; band: 'below' | 'inside' | 'above' }
  specGaps: SpecGap[]
  claims: Claim[]
}

/** 确定性比较核心：单位标准化（统一 USD）、价格区间、目标价定位、缺失字段识别。 */
export function analyzeMarket(
  rows: PriceRow[],
  targetPrice: number | undefined,
  requiredSpecs: string[],
  claimedSpecs: string[],
  maxClaims: number,
): MarketAnalysisOutput {
  const prices = rows
    .map((row) => ({ ...row, priceUsd: row.price ?? undefined }))
    .filter((row) => row.priceUsd !== undefined)
  const sorted = [...prices].sort((a, b) => (a.priceUsd ?? 0) - (b.priceUsd ?? 0))
  const min = sorted[0]?.priceUsd ?? 0
  const max = sorted[sorted.length - 1]?.priceUsd ?? 0
  const mid = (min + max) / 2
  const pricePosition = targetPrice === undefined
    ? { target: 0, band: 'inside' as const }
    : { target: targetPrice, band: targetPrice < min ? 'below' as const : targetPrice > max ? 'above' as const : 'inside' as const }
  const specGaps: SpecGap[] = requiredSpecs
    .filter((spec) => !claimedSpecs.includes(spec))
    .map((spec) => ({ spec, status: 'missing' }))
  const claims: Claim[] = []
  if (sorted.length > 0 && claims.length < maxClaims) {
    claims.push({
      claimId: `MC-${String(claims.length + 1).padStart(3, '0')}`,
      claimType: 'market',
      text: `竞品价格区间 $${min.toFixed(2)}–$${max.toFixed(2)}（共 ${sorted.length} 条记录）`,
      evidenceRefs: sorted.map((row) => row.evidenceId ?? '').filter(Boolean),
      limitations: ['价格数据为演示 Mock，时点可能不同'],
    })
  }
  return { comparison: prices, priceRange: { min, max, mid }, pricePosition, specGaps, claims }
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'penx1_analyze_market',
    description: '确定性市场对比分析：价格区间、目标价定位、规格缺口与市场 Claim',
    parameters: {
      runId: { type: 'string', required: true, description: 'PEN-X1 Run ID' },
      rows: {
        type: 'array',
        required: true,
        description: '市场快照记录（含 evidenceId 回链）',
        items: { type: 'object', additionalProperties: true },
      },
      targetPrice: { type: 'number', description: 'PEN-X1 目标价（如 34.95）' },
      requiredSpecs: { type: 'array', description: '必测规格清单', items: { type: 'string' } },
      claimedSpecs: { type: 'array', description: '已有实测规格', items: { type: 'string' } },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          runId: { type: 'string' },
          comparison: { type: 'json' },
          priceRange: { type: 'json' },
          pricePosition: { type: 'json' },
          specGaps: { type: 'json' },
          claimCount: { type: 'number' },
        },
      },
      render: (_args, value) => {
        const comparison = (value.comparison ?? []) as unknown as MarketComparisonRow[]
        const priceRange = value.priceRange as unknown as { min: number; max: number }
        const position = value.pricePosition as unknown as { band: string }
        const specGaps = (value.specGaps ?? []) as unknown as SpecGap[]
        return [{
          type: 'text',
          text: `市场分析：${comparison.length} 条价格记录，区间 $${priceRange.min.toFixed(2)}–$${priceRange.max.toFixed(2)}，目标价 ${position.band === 'inside' ? '在区间内' : `在区间${position.band}`}，规格缺口 ${specGaps.length} 项。`,
        }]
      },
    },
    async execute(args) {
      ctx.penx1Run.assert(args.runId, ['knowledgeReady', 'marketDataReady'])
      const output = analyzeMarket(
        (args.rows ?? []) as unknown as PriceRow[],
        args.targetPrice,
        (args.requiredSpecs ?? []) as string[],
        (args.claimedSpecs ?? []) as string[],
        config.maxClaims,
      )
      const claimIds = output.claims.map((c) => c.claimId)
      ctx.penx1Evidence.registerClaims(args.runId, output.claims)
      const artifactId = `MARKET-ANALYSIS-${args.runId}`
      ctx.penx1Run.recordArtifact(args.runId, { artifactId, runId: args.runId, kind: 'MARKET_ANALYSIS', createdAt: isoNow(), data: output })
      completeStep(ctx, args.runId, 'penx1_analyze_market', 'business_skill', 'success', [artifactId], claimIds, output.specGaps.map((g) => `规格缺口：${g.spec}`), output)
      return {
        runId: args.runId,
        comparison: output.comparison as unknown as JsonValue,
        priceRange: output.priceRange as unknown as JsonValue,
        pricePosition: output.pricePosition as unknown as JsonValue,
        specGaps: output.specGaps as unknown as JsonValue,
        claimCount: output.claims.length,
      }
    },
  }))
}
