/**
 * PEN-X1 Knowledge 插件（方案 §11）。
 * 插件名：penx1-knowledge
 * 提供 ctx.penx1Knowledge Service，注册 penx1_retrieve_knowledge 工具，
 * 命中文档登记到 Evidence Guard，输出 Evidence Context Pack。
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Penx1Error, assertPathWithin, provideService } from '@penx1/contracts'
import { KnowledgeStore, type KnowledgeBase, type KnowledgeStatus, type EvidenceContextPack, type SearchHit } from './knowledge-store.js'

export const name = 'penx1-knowledge'

export interface Config {
  knowledgeFile: string
  dataRoot: string
  topKProduct: number
  topKCompetitor: number
  topKTechnical: number
  topKConstraint: number
  retrievalMode: 'lexical'
  watchFiles: boolean
}

export const Config: z<Config> = z.object({
  knowledgeFile: z.string().required(),
  dataRoot: z.string().default('data'),
  topKProduct: z.number().default(5),
  topKCompetitor: z.number().default(8),
  topKTechnical: z.number().default(5),
  topKConstraint: z.number().default(5),
  retrievalMode: z.union(['lexical'] as const).default('lexical'),
  watchFiles: z.boolean().default(false),
})

export const inject = ['tools', 'penx1Run', 'penx1Evidence']

export interface Penx1KnowledgeService {
  load(): Promise<KnowledgeBase>
  search(term: string, topK: number): SearchHit[]
  buildContextPack(runId: string): { pack: EvidenceContextPack; items: unknown[] }
  getVersion(): string
}

export class Penx1Knowledge implements Penx1KnowledgeService {
  private readonly store: KnowledgeStore

  constructor(private readonly config: Config) {
    this.store = new KnowledgeStore({
      topKProduct: config.topKProduct,
      topKCompetitor: config.topKCompetitor,
      topKTechnical: config.topKTechnical,
      topKConstraint: config.topKConstraint,
    })
  }

  async load(): Promise<KnowledgeBase> {
    if (this.store.getVersion() !== 'unloaded') return this.store['base'] as KnowledgeBase
    const file = resolve(this.config.knowledgeFile)
    if (!assertPathWithin(resolve(this.config.dataRoot), file)) {
      throw new Penx1Error('DATA_FILE_OUTSIDE_ROOT', `知识库文件超出数据根目录：${file}`)
    }
    const raw = await readFile(file, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Penx1Error('CONFIG_INVALID', `知识库 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
    this.store.load(parsed as KnowledgeBase)
    return this.store['base'] as KnowledgeBase
  }

  search(term: string, topK: number): SearchHit[] {
    return this.store.searchTerm(term, topK)
  }

  buildContextPack(runId: string): { pack: EvidenceContextPack; items: unknown[] } {
    return this.store.buildContextPack(runId)
  }

  statusOf(pack: EvidenceContextPack): KnowledgeStatus {
    return this.store.statusOf(pack)
  }

  getVersion(): string {
    return this.store.getVersion()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    penx1Knowledge: Penx1Knowledge
  }
}

export function apply(ctx: Context, config: Config): void {
  provideService(ctx, 'penx1Knowledge', new Penx1Knowledge(config))

  ctx.tools.register(defineTool({
    name: 'penx1_retrieve_knowledge',
    description: '检索 PEN-X1 知识库（product/competitors/technical/constraints 四组），登记 Evidence 并生成 Context Pack',
    parameters: {
      runId: { type: 'string', required: true, description: 'PEN-X1 Run ID' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          runId: { type: 'string' },
          contextPackId: { type: 'string' },
          documentCount: { type: 'number' },
          evidenceIds: { type: 'array', items: { type: 'string' } },
          missingTopics: { type: 'array', items: { type: 'string' } },
          knowledgeVersion: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const missing = (value.missingTopics ?? []).length > 0 ? `，零命中主题：${(value.missingTopics ?? []).join('、')}` : ''
        return [{ type: 'text', text: `✓ 知识库检索完成：${value.documentCount} 条命中，Knowledge v${value.knowledgeVersion}${missing}` }]
      },
    },
    async execute(args) {
      ctx.penx1Run.assert(args.runId, ['planReady'])
      await ctx.penx1Knowledge.load()
      const { pack, items } = ctx.penx1Knowledge.buildContextPack(args.runId)
      ctx.penx1Evidence.register(args.runId, items as never[])
      const status = ctx.penx1Knowledge.statusOf(pack)
      if (status === 'blocked') {
        const run = ctx.penx1Run.get(args.runId)
        run.warnings.push(`知识库零命中主题（critical）：${pack.missingTopics.join('、')}`)
      } else {
        ctx.penx1Run.recordStep(args.runId, {
          runId: args.runId,
          toolName: 'penx1_retrieve_knowledge',
          capabilityType: 'knowledge',
          status,
          previousPhase: ctx.penx1Run.get(args.runId).phase,
          currentPhase: ctx.penx1Run.get(args.runId).phase,
          artifactIds: [],
          evidenceIds: pack.evidenceIds,
          warnings: pack.missingTopics.map((t) => `知识主题 ${t} 零命中`),
          data: pack,
        })
      }
      return {
        runId: args.runId,
        status,
        contextPackId: pack.contextPackId,
        documentCount: pack.documents.length,
        evidenceIds: pack.evidenceIds,
        missingTopics: pack.missingTopics,
        knowledgeVersion: pack.knowledgeVersion,
      }
    },
  }))
}
