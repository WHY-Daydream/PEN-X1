/**
 * PEN-X1 Market Tool Consumer（方案 §13）。
 * 插件名：penx1-market-tool
 * 注册 penx1_fetch_market_mock；输入校验 → 工作流前置校验 → 调用 Provider →
 * 校验 Source Descriptor → 登记 Evidence → 保存 Artifact → 返回 Canonical Result。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MOCK_BANNER, Penx1Error, isMockLabel, isoNow } from '@penx1/contracts'
import { analyzeMarketSnapshot } from './market-source.js'

export const name = 'penx1-market-tool'

export interface Config {
  labelSuffix: string
}

export const Config: z<Config> = z.object({
  labelSuffix: z.string().default(MOCK_BANNER),
})

export const inject = ['tools', 'penx1Run', 'penx1Evidence', 'penx1MarketSource']

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'penx1_fetch_market_mock',
    description: '获取北美市场竞品价格快照（演示 Mock 数据，仅本地 JSON）',
    parameters: {
      runId: { type: 'string', required: true, description: 'PEN-X1 Run ID' },
      competitors: {
        type: 'array',
        description: '可选：限定竞品名；未知竞品会被拒绝',
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
          competitorCount: { type: 'number' },
          temporalVarianceCount: { type: 'number' },
          hardConflictCandidates: { type: 'number' },
          evidenceIds: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `${MOCK_BANNER}市场工具完成：${value.competitorCount} 个竞品，${value.temporalVarianceCount} 个价格时点差异，${value.hardConflictCandidates} 个硬冲突候选。\nArtifact: ${value.snapshotId}\nEvidence: ${(value.evidenceIds ?? []).join('..')}`,
        },
      ],
    },
    async execute(args) {
      // 1. 校验 runId；2. 知识库必须先于外部工具（方案 §11.6 门禁）。
      ctx.penx1Run.assert(args.runId, ['knowledgeReady'])
      // 3. 调用 Provider（Capability Seam）。
      const snapshot = await ctx.penx1MarketSource.fetch({ competitors: args.competitors })
      // 4. 校验 Provider Source Descriptor 的 Mock 标签（方案 §13.5）。
      const descriptor = ctx.penx1MarketSource.sourceDescriptor()
      if (!isMockLabel(descriptor.label) && !isMockLabel(config.labelSuffix)) {
        throw new Penx1Error('MOCK_LABEL_MISSING', '市场数据源缺少【演示Mock数据】标签')
      }
      // 5. 每条记录登记为 Evidence。
      ctx.penx1Evidence.register(args.runId, snapshot.records.map((record) => ({
        evidenceId: record.recordId,
        sourceType: record.sourceType,
        sourceLabel: record.sourceLabel,
        sourceRef: record.sourceRef,
        sourceTimestamp: record.capturedAt,
        content: record.content,
        contentHash: `mock-${record.recordId}`,
      })))
      // 6. 保存 Market Snapshot Artifact。
      const artifactId = snapshot.snapshotId
      ctx.penx1Run.recordArtifact(args.runId, {
        artifactId,
        runId: args.runId,
        kind: 'MARKET_SNAPSHOT',
        createdAt: isoNow(),
        data: snapshot,
      })
      const analysis = analyzeMarketSnapshot(snapshot)
      // 7. 返回 Canonical Tool Result。
      ctx.penx1Run.recordStep(args.runId, {
        runId: args.runId,
        toolName: 'penx1_fetch_market_mock',
        capabilityType: 'external_mock',
        status: 'success',
        previousPhase: ctx.penx1Run.get(args.runId).phase,
        currentPhase: ctx.penx1Run.get(args.runId).phase,
        artifactIds: [artifactId],
        evidenceIds: snapshot.records.map((r) => r.recordId),
        warnings: [],
        data: snapshot,
      })
      return {
        runId: args.runId,
        snapshotId: artifactId,
        competitorCount: analysis.competitorCount,
        temporalVarianceCount: analysis.temporalVarianceCount,
        hardConflictCandidates: analysis.hardConflictCandidates,
        evidenceIds: snapshot.records.map((r) => r.recordId),
      }
    },
  }))
}
