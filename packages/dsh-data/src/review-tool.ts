/**
 * PEN-X1 Review Tool Consumer（方案 §15）。
 * 插件名：penx1-review-tool
 * 注册 penx1_fetch_reviews_mock；校验英文原句完整性与语言字段，工具不做痛点分类。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MOCK_BANNER, Penx1Error, isMockLabel, isoNow } from '@penx1/contracts'

export const name = 'penx1-review-tool'

export interface Config {
  labelSuffix: string
}

export const Config: z<Config> = z.object({
  labelSuffix: z.string().default(MOCK_BANNER),
})

export const inject = ['tools', 'penx1Run', 'penx1Evidence', 'penx1ReviewSource']

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'penx1_fetch_reviews_mock',
    description: '获取北美市场英文评论快照（演示 Mock 数据，仅本地 JSON，保留英文原句）',
    parameters: {
      runId: { type: 'string', required: true, description: 'PEN-X1 Run ID' },
      competitors: {
        type: 'array',
        description: '可选：限定竞品名',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          runId: { type: 'string' },
          snapshotId: { type: 'string' },
          reviewCount: { type: 'number' },
          competitorCount: { type: 'number' },
          evidenceIds: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `${MOCK_BANNER}评论工具完成：${value.reviewCount} 条英文评论，${value.competitorCount} 个竞品。\nArtifact: ${value.snapshotId}\nEvidence: ${(value.evidenceIds ?? []).join('..')}`,
        },
      ],
    },
    async execute(args) {
      ctx.penx1Run.assert(args.runId, ['knowledgeReady'])
      const snapshot = await ctx.penx1ReviewSource.fetch({ competitors: args.competitors })
      const descriptor = ctx.penx1ReviewSource.sourceDescriptor()
      if (!isMockLabel(descriptor.label) && !isMockLabel(config.labelSuffix)) {
        throw new Penx1Error('MOCK_LABEL_MISSING', '评论数据源缺少【演示Mock数据】标签')
      }
      // 原句缺失/语言非声明语言 → 记录无效（方案 §15.5）。
      for (const review of snapshot.reviews) {
        if (typeof review.originalQuote !== 'string' || review.originalQuote.trim().length === 0) {
          throw new Penx1Error('CRITICAL_DATA_MISSING', `评论 ${review.reviewId} 缺少英文原句，禁止用摘要代替`)
        }
        if (review.language !== 'en-US' && review.language !== 'en') {
          throw new Penx1Error('CRITICAL_DATA_MISSING', `评论 ${review.reviewId} 语言字段异常：${review.language}`)
        }
      }
      ctx.penx1Evidence.register(args.runId, snapshot.reviews.map((review) => ({
        evidenceId: review.reviewId,
        sourceType: review.sourceType,
        sourceLabel: review.sourceLabel,
        sourceRef: review.sourceRef,
        content: review.content,
        contentHash: `mock-${review.reviewId}`,
      })))
      const artifactId = snapshot.snapshotId
      ctx.penx1Run.recordArtifact(args.runId, {
        artifactId,
        runId: args.runId,
        kind: 'REVIEW_SNAPSHOT',
        createdAt: isoNow(),
        data: snapshot,
      })
      ctx.penx1Run.recordStep(args.runId, {
        runId: args.runId,
        toolName: 'penx1_fetch_reviews_mock',
        capabilityType: 'external_mock',
        status: 'success',
        previousPhase: ctx.penx1Run.get(args.runId).phase,
        currentPhase: ctx.penx1Run.get(args.runId).phase,
        artifactIds: [artifactId],
        evidenceIds: snapshot.reviews.map((r) => r.reviewId),
        warnings: [],
        data: snapshot,
      })
      return {
        runId: args.runId,
        snapshotId: artifactId,
        reviewCount: snapshot.reviews.length,
        competitorCount: new Set(snapshot.reviews.map((r) => r.competitor)).size,
        evidenceIds: snapshot.reviews.map((r) => r.reviewId),
      }
    },
  }))
}
