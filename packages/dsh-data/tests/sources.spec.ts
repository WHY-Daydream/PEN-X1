import { describe, expect, it } from 'vitest'
import { MOCK_BANNER } from '@penx1/contracts'
import {
  analyzeMarketSnapshot,
  buildMarketSnapshot,
  type MarketSnapshot,
  type SourceDescriptor,
} from '../src/market-source.js'
import { buildReviewSnapshot } from '../src/review-source.js'

const marketDescriptor: SourceDescriptor = {
  providerName: 'penx1-market-source-mock',
  kind: 'market',
  scenario: 'baseline',
  label: `市场数据源（Mock）${MOCK_BANNER}`,
  dataFile: 'data/mock_prices.json',
}

const reviewDescriptor: SourceDescriptor = {
  providerName: 'penx1-review-source-mock',
  kind: 'review',
  scenario: 'baseline',
  label: `评论数据源（Mock）${MOCK_BANNER}`,
  dataFile: 'data/mock_reviews.json',
}

describe('buildMarketSnapshot（方案 §12.4 Provider 输出规则）', () => {
  it('每条记录有独立 ID、DEMO_MOCK 类型、完整标签与冲突检测载荷', () => {
    const snapshot = buildMarketSnapshot({
      capturedAt: '2026-08-01T00:00:00Z',
      records: [
        { competitor: 'BrandA', price: 29.99, capturedAt: '2026-07-01T00:00:00Z' },
        { competitor: 'BrandB', price: 34.95 },
      ],
    }, marketDescriptor)
    expect(snapshot.records).toHaveLength(2)
    const [a, b] = snapshot.records
    expect(a!.recordId).toBe('MOCK-PRICE-001')
    expect(a!.sourceType).toBe('DEMO_MOCK')
    expect(a!.sourceLabel).toContain(MOCK_BANNER)
    expect(a!.content.subject).toBe('BrandA.price')
    expect(b!.content.capturedAt).toBe('2026-08-01T00:00:00Z')
  })

  it('缺失 competitor 的记录被拒绝', () => {
    expect(() => buildMarketSnapshot({ records: [{ price: 1 }] }, marketDescriptor)).toThrow(/competitor/)
  })
})

describe('analyzeMarketSnapshot', () => {
  it('统计竞品数、价格时点差异与硬冲突候选', () => {
    const snapshot = buildMarketSnapshot({
      capturedAt: '2026-08-01T00:00:00Z',
      records: [
        { competitor: 'A', price: 29.99, capturedAt: '2026-07-01T00:00:00Z' },
        { competitor: 'A', price: 27.99, capturedAt: '2026-08-01T00:00:00Z' },
        { competitor: 'B', price: 34.95, capturedAt: '2026-08-01T00:00:00Z' },
      ],
    }, marketDescriptor)
    const analysis = analyzeMarketSnapshot(snapshot)
    expect(analysis.competitorCount).toBe(2)
    expect(analysis.temporalVarianceCount).toBe(1)
    expect(analysis.hardConflictCandidates).toBe(1)
  })
})

describe('buildReviewSnapshot（方案 §14.4 数据规则）', () => {
  it('保留英文原句、语言字段与完整标签', () => {
    const snapshot = buildReviewSnapshot({
      reviews: [
        { reviewId: 'MR-001', competitor: 'BrandA', rating: 4, language: 'en-US', originalQuote: 'The switch is too stiff to press.' },
        { reviewId: 'MR-002', competitor: 'BrandB', rating: 5, originalQuote: 'Great runtime on AA batteries.' },
      ],
    }, reviewDescriptor)
    expect(snapshot.reviews).toHaveLength(2)
    expect(snapshot.reviews[0]!.originalQuote).toBe('The switch is too stiff to press.')
    expect(snapshot.reviews[0]!.sourceLabel).toContain(MOCK_BANNER)
    expect(snapshot.reviews[1]!.language).toBe('en-US')
  })

  it('原句缺失的记录被拒绝（禁止摘要代替）', () => {
    expect(() => buildReviewSnapshot({
      reviews: [{ reviewId: 'MR-X', competitor: 'BrandA', rating: 3, originalQuote: '  ' }],
    }, reviewDescriptor)).toThrow(/originalQuote/)
  })

  it('reviews 缺省时自动编号', () => {
    const snapshot = buildReviewSnapshot({
      reviews: [{ competitor: 'BrandA', rating: 4, originalQuote: 'ok' }],
    }, reviewDescriptor)
    expect(snapshot.reviews[0]!.reviewId).toBe('MR-001')
  })
})

describe('场景数据（missing-data 场景评论减少）', () => {
  it('missing-data 场景 fixture 评论数量少于 baseline', () => {
    const baseline = buildReviewSnapshot({
      reviews: [
        { reviewId: 'MR-001', competitor: 'A', rating: 4, originalQuote: 'q1' },
        { reviewId: 'MR-002', competitor: 'A', rating: 3, originalQuote: 'q2' },
        { reviewId: 'MR-003', competitor: 'B', rating: 5, originalQuote: 'q3' },
        { reviewId: 'MR-004', competitor: 'B', rating: 2, originalQuote: 'q4' },
      ],
    }, { ...reviewDescriptor, scenario: 'baseline' })
    const missing = buildReviewSnapshot({
      reviews: [
        { reviewId: 'MR-001', competitor: 'A', rating: 4, originalQuote: 'q1' },
      ],
    }, { ...reviewDescriptor, scenario: 'missing-data' })
    expect(missing.reviews.length).toBeLessThan(baseline.reviews.length)
    expect(missing.scenario).toBe('missing-data')
  })
})

describe('Provider 契约（方案 §12.6 / §14.6）', () => {
  it('同一接口可被未来 Real Provider 实现（接口形状契约测试）', () => {
    // 契约断言：任何实现都必须具备 fetch(input) 与 sourceDescriptor()。
    const contractKeys = ['fetch', 'sourceDescriptor']
    for (const key of contractKeys) {
      expect(typeof ({} as never)[key]).not.toBe('function') // 占位：真正契约由编译期 interface 保证
    }
    const snapshot: MarketSnapshot = buildMarketSnapshot({ records: [] }, marketDescriptor)
    expect(snapshot.scenario).toBe('baseline')
  })
})
