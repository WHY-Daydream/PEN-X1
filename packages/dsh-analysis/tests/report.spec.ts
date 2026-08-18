import { describe, expect, it } from 'vitest'
import type { EvidenceAudit } from '@penx1/contracts'
import { MOCK_BANNER } from '@penx1/contracts'
import { renderReport, REPORT_SECTIONS } from '../src/report.js'

const audit: EvidenceAudit = {
  runId: 'RUN-001',
  totalEvidence: 20,
  totalClaims: 12,
  supportedClaims: 6,
  conditionalClaims: 4,
  insufficientClaims: 1,
  conflictedClaims: 1,
  unresolvedConflicts: 1,
  missingCount: 6,
  gate: { reportAuthorized: true, listingAllowed: false, reasons: ['6 项关键数据缺失，Listing 不允许'] },
}

describe('renderReport（方案 §21.4）', () => {
  it('包含全部 12 个固定章节', () => {
    const markdown = renderReport('RUN-001', {
      executiveSummary: '市场机会存在，工程 CONDITIONAL_GO。',
      gates: { engineering: 'CONDITIONAL_GO', massProduction: 'NO_GO', listing: 'NO_GO' },
    }, audit, `${MOCK_BANNER} 数据边界声明`)
    for (const section of REPORT_SECTIONS) {
      expect(markdown).toContain(section)
    }
  })

  it('三个 Gate 分别给出结论', () => {
    const markdown = renderReport('RUN-001', {
      executiveSummary: '摘要',
      gates: { engineering: 'CONDITIONAL_GO', massProduction: 'NO_GO', listing: 'NO_GO' },
    }, audit, `${MOCK_BANNER}`)
    expect(markdown).toContain('| 工程开发 | CONDITIONAL_GO |')
    expect(markdown).toContain('| 量产 | NO_GO |')
    expect(markdown).toContain('| 北美 Listing | NO_GO |')
  })

  it('Mock 声明与 Evidence Audit 必须出现（方案 §21.7）', () => {
    const markdown = renderReport('RUN-001', {
      executiveSummary: '摘要',
      gates: { engineering: 'CONDITIONAL_GO', massProduction: 'NO_GO', listing: 'NO_GO' },
    }, audit, `${MOCK_BANNER}`)
    expect(markdown).toContain(MOCK_BANNER)
    expect(markdown).toContain('SUPPORTED 6')
    expect(markdown).toContain('Listing 允许：NO_GO')
  })
})
