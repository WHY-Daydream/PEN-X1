import { describe, expect, it } from 'vitest'
import { analyzeMarket } from '../src/market-analysis.js'
import { extractPains } from '../src/review-mining.js'
import { validateOpportunities } from '../src/opportunity.js'
import { validateSwot } from '../src/swot.js'
import { validateRiskRegister } from '../src/risk.js'
import type { RiskItem, SwotItem } from '@penx1/contracts'

describe('Market Analysis（方案 §16）', () => {
  it('价格排序、区间与目标价定位', () => {
    const output = analyzeMarket([
      { competitor: 'A', price: 29.99, evidenceId: 'MOCK-PRICE-001' },
      { competitor: 'B', price: 34.95, evidenceId: 'MOCK-PRICE-002' },
      { competitor: 'C', price: 49.99, evidenceId: 'MOCK-PRICE-003' },
    ], 34.95, ['亮度', '续航'], ['亮度'], 8)
    expect(output.priceRange).toEqual({ min: 29.99, max: 49.99, mid: 39.99 })
    expect(output.pricePosition.band).toBe('inside')
    expect(output.specGaps).toEqual([{ spec: '续航', status: 'missing' }])
    expect(output.claims[0]!.evidenceRefs).toContain('MOCK-PRICE-001')
  })

  it('缺失字段识别：无数字幻觉（未声明的规格不写入对比表）', () => {
    const output = analyzeMarket([{ competitor: 'A', price: 20 }], 25, ['亮度'], [], 8)
    expect(output.comparison[0]!.priceUsd).toBe(20)
    expect(output.specGaps.map((g) => g.spec)).toContain('亮度')
  })
})

describe('Review Mining（方案 §17）', () => {
  const reviews = [
    { reviewId: 'MR-001', competitor: 'A', rating: 2, originalQuote: 'The switch is stiff and hard to press.' },
    { reviewId: 'MR-002', competitor: 'A', rating: 3, originalQuote: 'It turns on accidentally in my pocket.' },
    { reviewId: 'MR-003', competitor: 'B', rating: 1, originalQuote: 'Very dim on low mode, barely visible.' },
    { reviewId: 'MR-004', competitor: 'B', rating: 4, originalQuote: 'Battery life drains too fast.' },
    { reviewId: 'MR-005', competitor: 'C', rating: 5, originalQuote: 'Great light, love it!' },
  ]
  it('痛点聚类 + 跨竞品 + 频次', () => {
    const extraction = extractPains(reviews, { minimumClusterSize: 1, lowConfidenceCutoff: 0.6, maxClusters: 10 })
    const switchForce = extraction.clusters.find((c) => c.pain === 'switch_force')
    expect(switchForce?.reviewIds).toEqual(['MR-001'])
    expect(switchForce?.frequency).toBe(1)
    expect(extraction.clusters.some((c) => c.pain === 'runtime')).toBe(true)
  })

  it('reviewId 回链完整率 100%；低置信度评论排除', () => {
    const extraction = extractPains(reviews, { minimumClusterSize: 1, lowConfidenceCutoff: 0.6, maxClusters: 10 })
    for (const cluster of extraction.clusters) {
      for (const id of cluster.reviewIds) {
        expect(reviews.some((r) => r.reviewId === id)).toBe(true)
      }
    }
    expect(extraction.lowConfidenceReviewIds).toContain('MR-005')
    expect(extraction.claims.every((c) => c.evidenceRefs.length > 0)).toBe(true)
  })
})

describe('Opportunity（方案 §18）', () => {
  const domains = new Map<string, 'market' | 'review'>([
    ['MOCK-PRICE-001', 'market'],
    ['MR-001', 'review'],
  ])
  it('跨域证据 + 工程依赖通过', () => {
    const check = validateOpportunities([{
      opportunityId: 'OP-1',
      title: '电池可获得性',
      userProblem: '用户担心电池兼容',
      productResponse: '强调五种电池',
      commercialValue: '高',
      engineeringDependency: '需完成五种电池实测矩阵',
      evidenceRefs: ['MOCK-PRICE-001', 'MR-001'],
    }], { maxOpportunities: 6, requireEngineeringDependency: true, requireCrossDomainEvidence: true }, domains)
    expect(check.valid).toBe(true)
  })

  it('只有推断没有来源的机会被拒绝', () => {
    const check = validateOpportunities([{
      opportunityId: 'OP-X',
      title: '纯推断机会',
      userProblem: '未知',
      productResponse: '未知',
      commercialValue: '未知',
      engineeringDependency: '',
      evidenceRefs: [],
    }], { maxOpportunities: 6, requireEngineeringDependency: true, requireCrossDomainEvidence: true }, domains)
    expect(check.valid).toBe(false)
    expect(check.reasons.join(';')).toContain('没有证据引用')
  })
})

describe('SWOT（方案 §19）', () => {
  const items: SwotItem[] = [
    { quadrant: 'strengths', statement: 'PEN-X1 支持五种电池供电', evidenceRefs: ['EV-1'], limitations: [] },
    { quadrant: 'strengths', statement: 'PEN-X1 开关档位逻辑清晰', evidenceRefs: ['EV-2'], limitations: [] },
    { quadrant: 'weaknesses', statement: 'PEN-X1 亮度实测数据缺失', evidenceRefs: ['EV-3'], limitations: [] },
    { quadrant: 'weaknesses', statement: 'PEN-X1 尺寸长度偏大', evidenceRefs: ['EV-4'], limitations: [] },
    { quadrant: 'opportunities', statement: '北美市场用户关注电池可获得性', evidenceRefs: ['EV-5'], limitations: [] },
    { quadrant: 'opportunities', statement: 'Amazon 竞品价格带存在空间', evidenceRefs: ['EV-6'], limitations: [] },
    { quadrant: 'threats', statement: '竞品价格促销可能挤压利润', evidenceRefs: ['EV-7'], limitations: [] },
    { quadrant: 'threats', statement: 'Listing 关键规格缺失影响可审计性', evidenceRefs: ['EV-8'], limitations: [] },
  ]
  it('合法 SWOT 通过', () => {
    const check = validateSwot(items, { minItemsPerQuadrant: 2, maxItemsPerQuadrant: 4, rejectGenericStatements: true })
    expect(check.valid).toBe(true)
  })

  it('通用模板语言与内外部分类错误被拒绝', () => {
    const bad: SwotItem[] = [
      ...items.slice(0, 4),
      { quadrant: 'strengths', statement: '我们是行业第一的领先者', evidenceRefs: ['E1'], limitations: [] },
      { quadrant: 'strengths', statement: '市场机会很大', evidenceRefs: ['E2'], limitations: [] },
      { quadrant: 'opportunities', statement: 'PEN-X1 手感很好', evidenceRefs: ['E3'], limitations: [] },
    ]
    const check = validateSwot(bad, { minItemsPerQuadrant: 2, maxItemsPerQuadrant: 4, rejectGenericStatements: true })
    expect(check.valid).toBe(false)
    expect(check.reasons.join(';')).toContain('通用模板语言')
    expect(check.reasons.join(';')).toContain('未描述 PEN-X1 内部属性')
  })
})

describe('Risk Register（方案 §20）', () => {
  function risk(id: string, phase: RiskItem['phase'], rootCause: string, gate: string): RiskItem {
    return {
      riskId: id, phase, severity: 'high', difficulty: 'medium',
      rootCause, negativeImpact: rootCause, mitigation: '验证', validationGate: gate,
      owner: '工程师', evidenceRefs: ['EV-1'],
    }
  }
  it('合法登记册通过（覆盖三阶段与关键工程风险）', () => {
    const risks = [
      risk('R-1', 'R&D', '44.5–100mm 多长度结构', '尺寸链公差分析完成'),
      risk('R-2', 'R&D', 'AAA 低压升压效率', '0.9V 输入效率 ≥85%'),
      risk('R-3', 'R&D', '电池类型误识别', '识别校准通过率 100%'),
      risk('R-4', 'R&D', '14500 高档温升', '温升 ≤ 20K'),
      risk('R-5', 'R&D', '双电池混用', '混用保护测试通过'),
      risk('R-6', 'R&D', '开关手感', '手感评估 ≥ 4/5'),
      risk('R-7', 'MASS_PRODUCTION', '尺寸链与接触电阻', '接触电阻 ≤ 50mΩ'),
      risk('R-8', 'MASS_PRODUCTION', '弹簧疲劳', '疲劳测试 10 万次'),
      risk('R-9', 'MASS_PRODUCTION', 'BOM 与装配工时', '工时 < 3 分钟'),
      risk('R-10', 'MASS_PRODUCTION', '识别校准 EOL', 'EOL 通过率 ≥ 99.5%'),
      risk('R-11', 'OVERSEAS_LAUNCH', '运输资料', 'UN38.3 报告齐备'),
      risk('R-12', 'OVERSEAS_LAUNCH', '兼容性表达', 'Listing 文案审计通过'),
      risk('R-13', 'OVERSEAS_LAUNCH', '价格促销利润', '促销毛利 ≥ 30%'),
      risk('R-14', 'OVERSEAS_LAUNCH', '规格缺失', '关键规格 100% 披露'),
    ]
    const check = validateRiskRegister(risks, { minimumRiskCount: 10, requiredPhases: ['R&D', 'MASS_PRODUCTION', 'OVERSEAS_LAUNCH'] })
    expect(check.valid).toBe(true)
  })

  it('数量不足、阶段缺失、Gate 不可验证被拒绝', () => {
    const risks = [risk('R-1', 'R&D', 'AAA 低压升压效率', '进一步观察')]
    const check = validateRiskRegister(risks, { minimumRiskCount: 10, requiredPhases: ['R&D', 'MASS_PRODUCTION', 'OVERSEAS_LAUNCH'] })
    expect(check.valid).toBe(false)
    const joined = check.reasons.join(';')
    expect(joined).toContain('少于 10')
    expect(joined).toContain('MASS_PRODUCTION')
    expect(joined).toContain('不可验证')
  })
})
