/**
 * PEN-X1 Market Capability：Service 定义（方案 §12 / §13）。
 * Provider（Mock/未来 Real）实现 Penx1MarketSource；Tool Consumer 消费该 Service。
 */

import { MOCK_BANNER } from '@penx1/contracts'

export interface SourceDescriptor {
  providerName: string
  kind: 'market' | 'review'
  scenario: string
  label: string
  dataFile: string
}

export interface MarketQuery {
  competitors?: string[]
}

export interface MarketRecordMeta {
  recordId: string
  competitor: string
  price?: number
  currency?: string
  capturedAt?: string
  inStock?: boolean
  promotion?: string
  sourceType: 'DEMO_MOCK'
  sourceLabel: string
  sourceRef: string
  /** 冲突检测载荷（Evidence Guard 按 subject/value/capturedAt/condition 分类）。 */
  content: Record<string, unknown>
}

export interface MarketSnapshot {
  snapshotId: string
  capturedAt: string
  scenario: string
  records: MarketRecordMeta[]
}

/** Capability Seam：未来 penx1-market-source-real 实现同一接口即可替换（方案 §12.6）。 */
export interface Penx1MarketSource {
  fetch(input: MarketQuery): Promise<MarketSnapshot>
  sourceDescriptor(): SourceDescriptor
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    penx1MarketSource: Penx1MarketSource
  }
}

export interface RawPriceRecord {
  competitor: string
  price?: number
  currency?: string
  capturedAt?: string
  inStock?: boolean
  promotion?: string
  spec?: Record<string, unknown>
}

/** 把数据文件原始记录包装为带 DEMO_MOCK 标签与独立 ID 的快照记录（方案 §12.4）。 */
export function buildMarketSnapshot(raw: unknown, descriptor: SourceDescriptor): MarketSnapshot {
  const parsed = raw as { capturedAt?: string; records?: RawPriceRecord[] }
  if (!Array.isArray(parsed.records)) {
    throw new Error(`市场数据文件结构无效：${descriptor.dataFile}`)
  }
  const capturedAt = parsed.capturedAt ?? new Date().toISOString()
  const records: MarketRecordMeta[] = parsed.records.map((record, index) => {
    if (typeof record.competitor !== 'string' || record.competitor.length === 0) {
      throw new Error(`市场数据记录缺少 competitor（第 ${index} 条）`)
    }
    return {
      recordId: `MOCK-PRICE-${String(index + 1).padStart(3, '0')}`,
      competitor: record.competitor,
      price: record.price,
      currency: record.currency ?? 'USD',
      capturedAt: record.capturedAt ?? capturedAt,
      inStock: record.inStock,
      promotion: record.promotion,
      sourceType: 'DEMO_MOCK',
      sourceLabel: `Amazon 竞品价格快照 ${MOCK_BANNER}`,
      sourceRef: `${descriptor.dataFile}#${record.competitor}`,
      content: {
        subject: `${record.competitor}.price`,
        value: record.price ?? null,
        capturedAt: record.capturedAt ?? capturedAt,
        condition: record.promotion ?? '正常价',
      },
    }
  })
  return {
    snapshotId: `MARKET-SNAPSHOT-${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`,
    capturedAt,
    scenario: descriptor.scenario,
    records,
  }
}

export interface MarketAnalysis {
  competitorCount: number
  temporalVarianceCount: number
  hardConflictCandidates: number
}

/** 价格时点差异与硬冲突候选统计（硬冲突最终由 Evidence Guard 判定，方案 §13.4）。 */
export function analyzeMarketSnapshot(snapshot: MarketSnapshot): MarketAnalysis {
  const competitors = new Set(snapshot.records.map((r) => r.competitor))
  const byCompetitor = new Map<string, Map<string, unknown>>()
  for (const record of snapshot.records) {
    const perCompetitor = byCompetitor.get(record.competitor) ?? new Map<string, unknown>()
    perCompetitor.set(record.capturedAt ?? '', record.price)
    byCompetitor.set(record.competitor, perCompetitor)
  }
  let temporalVarianceCount = 0
  let hardConflictCandidates = 0
  for (const perCompetitor of byCompetitor.values()) {
    const prices = new Set(perCompetitor.values())
    if (prices.size <= 1) continue
    if (perCompetitor.size > 1) temporalVarianceCount += 1
    hardConflictCandidates += 1
  }
  return { competitorCount: competitors.size, temporalVarianceCount, hardConflictCandidates }
}
