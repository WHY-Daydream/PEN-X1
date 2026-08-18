import { describe, expect, it } from 'vitest'
import type { Claim, EvidenceItem, RiskItem } from '@penx1/contracts'
import { MOCK_BANNER, Penx1Error } from '@penx1/contracts'
import { EvidenceStore, type EvidenceOptions } from '../src/evidence-guard-store.js'

const options: EvidenceOptions = {
  supportedThreshold: 0.8,
  conditionalThreshold: 0.6,
  requireEvidenceForEveryClaim: true,
  requireAllRiskFields: true,
  mockBaseWeight: 0.7,
  inferenceBaseWeight: 0.4,
  blockListingOnCriticalMissing: true,
  requireMockLabels: true,
}

function mockEvidence(id: string, subject: string, value: unknown, extra?: Partial<EvidenceItem> & Record<string, unknown>): EvidenceItem {
  return {
    evidenceId: id,
    sourceType: 'DEMO_MOCK',
    sourceLabel: `Amazon 竞品快照 ${MOCK_BANNER}`,
    sourceRef: `mock_prices.json#${id}`,
    content: { subject, value, ...extra },
    contentHash: `h-${id}`,
  }
}

function attachmentEvidence(id: string, subject: string, value: unknown): EvidenceItem {
  return {
    evidenceId: id,
    sourceType: 'ATTACHMENT',
    sourceLabel: 'PEN-X1 附件事实',
    sourceRef: 'attachment.xlsx#sheet1',
    content: { subject, value },
    contentHash: `h-${id}`,
  }
}

function missingEvidence(id: string, label: string): EvidenceItem {
  return {
    evidenceId: id,
    sourceType: 'MISSING',
    sourceLabel: label,
    sourceRef: 'spec-gap',
    content: { subject: label, value: null },
    contentHash: `h-${id}`,
  }
}

function claim(id: string, refs: string[], type = 'market'): Claim {
  return { claimId: id, claimType: type, text: id, evidenceRefs: refs, limitations: [] }
}

function fullRisk(id: string, phase: RiskItem['phase'] = 'R&D', overrides?: Partial<RiskItem>): RiskItem {
  return {
    riskId: id,
    phase,
    severity: 'high',
    difficulty: 'medium',
    rootCause: 'AAA 低压升压效率不足',
    negativeImpact: '低电压档位亮度不达标',
    mitigation: '选用高效率升压拓扑并做低压实测',
    validationGate: '0.9V 输入下恒流输出效率 ≥ 85%',
    owner: '电子工程师',
    evidenceRefs: ['EV-1'],
    ...overrides,
  }
}

function newStore(overrides?: Partial<EvidenceOptions>) {
  return new EvidenceStore({ ...options, ...overrides })
}

describe('EvidenceStore', () => {
  it('未知 Evidence ID 抛 EVIDENCE_NOT_FOUND', () => {
    const store = newStore()
    expect(() => store.getEvidence('RUN-1', 'NOPE')).toThrowError(Penx1Error)
  })

  it('DEMO_MOCK 缺少【演示Mock数据】标签抛 MOCK_LABEL_MISSING', () => {
    const store = newStore()
    let caught: unknown
    try {
      store.register('RUN-1', [{
        evidenceId: 'BAD',
        sourceType: 'DEMO_MOCK',
        sourceLabel: '没有标签',
        sourceRef: 'x',
        content: {},
        contentHash: 'h',
      }])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Penx1Error)
    expect((caught as Penx1Error).code).toBe('MOCK_LABEL_MISSING')
  })

  it('validateRefs 返回未知引用', () => {
    const store = newStore()
    store.register('RUN-1', [mockEvidence('EV-1', 'a.price', 10)])
    const result = store.validateRefs('RUN-1', ['EV-1', 'EV-2'])
    expect(result.valid).toBe(false)
    expect(result.unknownRefs).toEqual(['EV-2'])
  })

  it('价格时点差异 = TEMPORAL_VARIANCE，同条件不同值 = HARD_CONFLICT', () => {
    const store = newStore()
    store.register('RUN-1', [
      mockEvidence('EV-1', 'brandA.price', 29.99, { capturedAt: '2026-01-01' }),
      mockEvidence('EV-2', 'brandA.price', 27.99, { capturedAt: '2026-02-01' }),
      mockEvidence('EV-3', 'brandB.price', 34.95, { condition: '正常价' }),
      mockEvidence('EV-4', 'brandB.price', 29.95, { condition: '促销价' }),
    ])
    const conflicts = store.detectConflicts('RUN-1')
    const temporal = conflicts.find((c) => c.subject === 'brandA.price')
    const condition = conflicts.find((c) => c.subject === 'brandB.price')
    expect(temporal?.type).toBe('TEMPORAL_VARIANCE')
    expect(condition?.type).toBe('CONDITION_MISMATCH')
  })

  it('单来源 vs 多来源置信度：多来源更高', () => {
    const store = newStore()
    store.register('RUN-1', [
      attachmentEvidence('EV-1', 'penx1.spec', 'x'),
      attachmentEvidence('EV-2', 'penx1.spec2', 'y'),
      mockEvidence('EV-3', 'penx1.spec3', 'z'),
    ])
    store.registerClaims('RUN-1', [
      claim('CL-1', ['EV-1']),
      claim('CL-2', ['EV-1', 'EV-2', 'EV-3']),
    ])
    const scored = store.scoreClaims('RUN-1')
    const single = scored.find((c) => c.claimId === 'CL-1')!
    const multi = scored.find((c) => c.claimId === 'CL-2')!
    expect(multi.confidence).toBeGreaterThan(single.confidence)
    // 单来源：0.5×1.0 + 0.3×0.5 + 0.2×1.0 = 0.85；多来源（EV-1/EV-2 同 sourceRef 计 2 源）：
    // 0.5×1.0 + 0.3×0.8 + 0.2×1.0 = 0.94。
    expect(single.confidence).toBeCloseTo(0.85, 2)
    expect(multi.confidence).toBeCloseTo(0.94, 2)
    expect(single.status).toBe('SUPPORTED')
    expect(multi.status).toBe('SUPPORTED')
  })

  it('模型输出的 confidence 被忽略：由插件重算', () => {
    const store = newStore()
    store.register('RUN-1', [attachmentEvidence('EV-1', 'a', 'b')])
    store.registerClaims('RUN-1', [{ ...claim('CL-1', ['EV-1']), confidence: 0.99 }])
    const scored = store.scoreClaims('RUN-1')
    expect(scored[0]!.confidence).not.toBe(0.99)
  })

  it('关键缺失阻断 Listing 但报告仍可授权', () => {
    const store = newStore()
    store.register('RUN-1', [attachmentEvidence('EV-1', 'penx1.spec', 'x'), missingEvidence('MG-1', '亮度')])
    store.registerClaims('RUN-1', [claim('CL-1', ['EV-1'])])
    const audit = store.finalize('RUN-1')
    expect(audit.missingCount).toBe(1)
    expect(audit.gate.listingAllowed).toBe(false)
    expect(audit.gate.reportAuthorized).toBe(true)
  })

  it('风险字段不完整：missingFields 记录且 valid=false', () => {
    const store = newStore()
    store.register('RUN-1', [attachmentEvidence('EV-1', 'a', 'b')])
    const incomplete = fullRisk('R-1', 'R&D', { owner: '' })
    const result = store.validateRisks('RUN-1', [incomplete])
    expect(result.valid).toBe(false)
    expect(result.missingFields['R-1']).toContain('owner')
  })

  it('不可验证 Gate 被拒绝（方案 §20.6）', () => {
    const store = newStore()
    store.register('RUN-1', [attachmentEvidence('EV-1', 'a', 'b')])
    const bad = fullRisk('R-1', 'R&D', { validationGate: '进一步观察' })
    const result = store.validateRisks('RUN-1', [bad])
    expect(result.valid).toBe(false)
    expect(result.invalidGates).toContain('R-1')
  })

  it('完全合规风险登记册通过', () => {
    const store = newStore()
    store.register('RUN-1', [attachmentEvidence('EV-1', 'a', 'b')])
    const result = store.validateRisks('RUN-1', [fullRisk('R-1', 'R&D'), fullRisk('R-2', 'MASS_PRODUCTION'), fullRisk('R-3', 'OVERSEAS_LAUNCH')])
    expect(result.valid).toBe(true)
  })
})
