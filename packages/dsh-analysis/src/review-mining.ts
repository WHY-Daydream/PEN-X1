/**
 * PEN-X1 Review Mining 插件（方案 §17）。
 * 插件名：penx1-review-mining
 * 从英文原句抽取痛点（固定字典 + 术语匹配），跨竞品聚类，频次/严重度评分；
 * 中文痛点必须回链 reviewId；低置信度评论不参与高优先级排序（§17.5）。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Claim, JsonValue } from '@penx1/contracts'
import { isoNow } from '@penx1/contracts'
import { completeStep } from './helpers.js'

export const name = 'penx1-review-mining'

export interface Config {
  minimumClusterSize: number
  lowConfidenceCutoff: number
  maxClusters: number
}

export const Config: z<Config> = z.object({
  minimumClusterSize: z.number().default(1),
  lowConfidenceCutoff: z.number().default(0.6),
  maxClusters: z.number().default(10),
})

export const inject = ['tools', 'penx1Run', 'penx1Evidence']

export interface ReviewInput {
  reviewId: string
  competitor: string
  rating: number
  originalQuote: string
  language?: string
}

export interface PainCluster {
  pain: string
  reviewIds: string[]
  competitors: string[]
  frequency: number
  severity: number
  sampleQuotes: string[]
}

export interface PainExtraction {
  clusters: PainCluster[]
  lowConfidenceReviewIds: string[]
  claims: Claim[]
}

export const PAIN_GLOSSARY: ReadonlyArray<{ pain: string; keywords: string[] }> = [
  { pain: 'switch_force', keywords: ['stiff', 'hard to press', 'tight switch', 'difficult to press'] },
  { pain: 'accidental_activation', keywords: ['accidental', 'turns on by itself', 'pocket', 'accidentally'] },
  { pain: 'mode_switching', keywords: ['mode', 'cycle through', 'switch modes', 'settings'] },
  { pain: 'mode_memory', keywords: ['memory', 'remember', 'starts in', 'default mode'] },
  { pain: 'low_voltage_brightness', keywords: ['dim', 'low brightness', 'dimmer', 'not bright'] },
  { pain: 'runtime', keywords: ['runtime', 'battery life', 'drain', 'dies fast', 'lasts'] },
  { pain: 'heat', keywords: ['hot', 'heat', 'warm', 'overheat'] },
  { pain: 'size_length', keywords: ['long', 'bulky', 'too big', 'length', 'heavy'] },
  { pain: 'battery_compatibility_wording', keywords: ['compatible', 'compatibility', 'aa', 'aaa', '14500', '18650'] },
  { pain: 'switch_wear', keywords: ['worn', 'wearing out', 'loose switch', 'fails'] },
]

export function extractPains(reviews: ReviewInput[], options: { minimumClusterSize: number; lowConfidenceCutoff: number; maxClusters: number }): PainExtraction {
  const clusters = new Map<string, PainCluster>()
  const lowConfidenceReviewIds: string[] = []
  for (const review of reviews) {
    const quote = review.originalQuote.toLowerCase()
    const matched = PAIN_GLOSSARY.filter(({ keywords }) => keywords.some((k) => quote.includes(k)))
    if (matched.length === 0) {
      lowConfidenceReviewIds.push(review.reviewId)
      continue
    }
    const rating = review.rating ?? 3
    for (const { pain } of matched) {
      const cluster = clusters.get(pain) ?? { pain, reviewIds: [], competitors: [], frequency: 0, severity: 0, sampleQuotes: [] }
      if (!cluster.reviewIds.includes(review.reviewId)) cluster.reviewIds.push(review.reviewId)
      if (!cluster.competitors.includes(review.competitor)) cluster.competitors.push(review.competitor)
      if (cluster.sampleQuotes.length < 3) cluster.sampleQuotes.push(review.originalQuote)
      clusters.set(pain, cluster)
    }
  }
  const sorted = [...clusters.values()]
    .map((cluster) => ({
      ...cluster,
      frequency: cluster.reviewIds.length,
      severity: cluster.reviewIds.length >= 3 ? 3 : cluster.reviewIds.length === 2 ? 2 : 1,
    }))
    .filter((c) => c.frequency >= options.minimumClusterSize)
    .sort((a, b) => b.severity - a.severity || b.frequency - a.frequency)
    .slice(0, options.maxClusters)
  const claims: Claim[] = sorted.map((cluster, index) => ({
    claimId: `RC-${String(index + 1).padStart(3, '0')}`,
    claimType: 'review',
    text: `痛点「${cluster.pain}」在 ${cluster.competitors.length} 个竞品、${cluster.frequency} 条评论中出现（严重度 ${cluster.severity}）`,
    evidenceRefs: cluster.reviewIds,
    limitations: ['英文原句由关键词匹配分类，模型未参与归纳'],
  }))
  return { clusters: sorted, lowConfidenceReviewIds, claims }
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'penx1_mine_review_pains',
    description: '从英文评论原句中抽取痛点并聚类（固定字典，reviewId 100% 回链）',
    parameters: {
      runId: { type: 'string', required: true, description: 'PEN-X1 Run ID' },
      reviews: { type: 'array', required: true, description: '评论列表（含原句）', items: { type: 'object', additionalProperties: true } },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          runId: { type: 'string' },
          clusters: { type: 'array' },
          claimCount: { type: 'number' },
          lowConfidenceCount: { type: 'number' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `评论痛点：${(value.clusters ?? []).length} 个聚类，${value.claimCount} 条 Claim，${value.lowConfidenceCount} 条低置信度评论已排除高优先级。`,
        },
      ],
    },
    async execute(args) {
      ctx.penx1Run.assert(args.runId, ['knowledgeReady', 'reviewDataReady'])
      const extraction = extractPains((args.reviews ?? []) as unknown as ReviewInput[], {
        minimumClusterSize: config.minimumClusterSize,
        lowConfidenceCutoff: config.lowConfidenceCutoff,
        maxClusters: config.maxClusters,
      })
      const claimIds = extraction.claims.map((c) => c.claimId)
      ctx.penx1Evidence.registerClaims(args.runId, extraction.claims)
      const artifactId = `REVIEW-MINING-${args.runId}`
      ctx.penx1Run.recordArtifact(args.runId, { artifactId, runId: args.runId, kind: 'REVIEW_MINING', createdAt: isoNow(), data: extraction })
      completeStep(ctx, args.runId, 'penx1_mine_review_pains', 'business_skill', 'success', [artifactId], claimIds, extraction.lowConfidenceReviewIds.length > 0 ? [`${extraction.lowConfidenceReviewIds.length} 条评论低置信度`] : [], extraction)
      return {
        runId: args.runId,
        clusters: extraction.clusters as unknown as JsonValue[],
        claimCount: extraction.claims.length,
        lowConfidenceCount: extraction.lowConfidenceReviewIds.length,
      }
    },
  }))
}
