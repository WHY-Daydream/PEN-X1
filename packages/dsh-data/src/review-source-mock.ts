/**
 * PEN-X1 Review Mock Provider（方案 §14）。
 * 插件名：penx1-review-source-mock
 * 提供 ctx.penx1ReviewSource Service；不直接暴露模型工具。
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MOCK_BANNER, Penx1Error, assertPathWithin, provideService } from '@penx1/contracts'
import {
  buildReviewSnapshot,
  type Penx1ReviewSource,
  type ReviewQuery,
  type ReviewSnapshot,
} from './review-source.js'
import type { SourceDescriptor } from './market-source.js'

export const name = 'penx1-review-source-mock'

export interface Config {
  dataFile: string
  dataRoot: string
  scenario: string
  defaultLanguage: string
  latencyMs: number
  failureRate: number
}

export const Config: z<Config> = z.object({
  dataFile: z.string().required(),
  dataRoot: z.string().default('data'),
  scenario: z.string().default('baseline'),
  defaultLanguage: z.string().default('en-US'),
  latencyMs: z.number().default(150),
  failureRate: z.number().default(0),
})

export class ReviewSourceMock implements Penx1ReviewSource {
  private cached?: ReviewSnapshot
  private readonly descriptor: SourceDescriptor

  constructor(private readonly config: Config) {
    this.descriptor = {
      providerName: 'penx1-review-source-mock',
      kind: 'review',
      scenario: config.scenario,
      label: `评论数据源（Mock）${MOCK_BANNER}`,
      dataFile: config.dataFile,
    }
  }

  sourceDescriptor(): SourceDescriptor {
    return this.descriptor
  }

  async fetch(input: ReviewQuery): Promise<ReviewSnapshot> {
    if (this.config.failureRate > 0 && Math.random() < this.config.failureRate) {
      throw new Error('评论数据源模拟故障（failureRate 触发）')
    }
    if (this.config.latencyMs > 0) await new Promise((r) => setTimeout(r, this.config.latencyMs))
    if (this.cached !== undefined) return this.cached

    const file = resolve(this.config.dataFile)
    if (!assertPathWithin(resolve(this.config.dataRoot), file)) {
      throw new Penx1Error('DATA_FILE_OUTSIDE_ROOT', `评论数据文件超出数据根目录：${file}`)
    }
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      throw new Penx1Error('CONFIG_INVALID', `评论数据读取失败：${error instanceof Error ? error.message : String(error)}`)
    }
    const snapshot = buildReviewSnapshot(raw, this.descriptor)
    if (input.competitors !== undefined && input.competitors.length > 0) {
      const known = new Set(snapshot.reviews.map((r) => r.competitor))
      const unknown = input.competitors.filter((c) => !known.has(c))
      if (unknown.length > 0) throw new Error(`未知竞品：${unknown.join('、')}`)
    }
    this.cached = snapshot
    return snapshot
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    penx1ReviewSource: Penx1ReviewSource
  }
}

export function apply(ctx: Context, config: Config): void {
  provideService(ctx, 'penx1ReviewSource', new ReviewSourceMock(config))
}
