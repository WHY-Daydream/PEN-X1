/**
 * PEN-X1 Market Mock Provider（方案 §12）。
 * 插件名：penx1-market-source-mock
 * 提供 ctx.penx1MarketSource Service；不向模型注册工具（模型不能绕过 Consumer 校验）。
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MOCK_BANNER, Penx1Error, assertPathWithin, provideService } from '@penx1/contracts'
import {
  buildMarketSnapshot,
  type MarketQuery,
  type MarketSnapshot,
  type Penx1MarketSource,
  type SourceDescriptor,
} from './market-source.js'

export const name = 'penx1-market-source-mock'

export interface Config {
  dataFile: string
  dataRoot: string
  scenario: string
  latencyMs: number
  failureRate: number
}

export const Config: z<Config> = z.object({
  dataFile: z.string().required(),
  dataRoot: z.string().default('data'),
  scenario: z.string().default('baseline'),
  latencyMs: z.number().default(150),
  failureRate: z.number().default(0),
})

export class MarketSourceMock implements Penx1MarketSource {
  private cached?: MarketSnapshot
  private readonly descriptor: SourceDescriptor

  constructor(private readonly config: Config) {
    this.descriptor = {
      providerName: 'penx1-market-source-mock',
      kind: 'market',
      scenario: config.scenario,
      label: `市场数据源（Mock）${MOCK_BANNER}`,
      dataFile: config.dataFile,
    }
  }

  sourceDescriptor(): SourceDescriptor {
    return this.descriptor
  }

  async fetch(input: MarketQuery): Promise<MarketSnapshot> {
    if (this.config.failureRate > 0 && Math.random() < this.config.failureRate) {
      throw new Error('市场数据源模拟故障（failureRate 触发）')
    }
    if (this.config.latencyMs > 0) await new Promise((r) => setTimeout(r, this.config.latencyMs))
    if (this.cached !== undefined) return this.cached

    const file = resolve(this.config.dataFile)
    if (!assertPathWithin(resolve(this.config.dataRoot), file)) {
      throw new Penx1Error('DATA_FILE_OUTSIDE_ROOT', `市场数据文件超出数据根目录：${file}`)
    }
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      throw new Penx1Error('CONFIG_INVALID', `市场数据读取失败：${error instanceof Error ? error.message : String(error)}`)
    }
    const snapshot = buildMarketSnapshot(raw, this.descriptor)

    // 未知竞品拒绝：不允许生成数据文件中不存在的竞品（方案 §12.4）。
    if (input.competitors !== undefined && input.competitors.length > 0) {
      const known = new Set(snapshot.records.map((r) => r.competitor))
      const unknown = input.competitors.filter((c) => !known.has(c))
      if (unknown.length > 0) throw new Error(`未知竞品：${unknown.join('、')}`)
    }
    this.cached = snapshot
    return snapshot
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    penx1MarketSource: Penx1MarketSource
  }
}

export function apply(ctx: Context, config: Config): void {
  provideService(ctx, 'penx1MarketSource', new MarketSourceMock(config))
}
