import { describe, expect, it } from 'vitest'
import type { EvidenceAudit } from '@penx1/contracts'
import { MOCK_BANNER, Penx1Error } from '@penx1/contracts'
import { GATE_VALUES, normalizeGates, renderReport, REPORT_SECTIONS } from '../src/report.js'

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

/** Gate 结论契约测试（G5 回归教训：结论词+长文混入 / 跨 case 漂移 → 工具层结构化拒绝）。 */
describe('normalizeGates（Gate 枚举契约）', () => {
  it('1. canonical valid → 原样返回', () => {
    const gates = normalizeGates({ engineering: 'CONDITIONAL_GO', massProduction: 'NO_GO', listing: 'NO_GO' })
    expect(gates).toEqual({ engineering: 'CONDITIONAL_GO', massProduction: 'NO_GO', listing: 'NO_GO' })
  })

  it('2. 全部 9 种枚举组合均合法', () => {
    for (const a of GATE_VALUES) {
      for (const b of GATE_VALUES) {
        for (const c of GATE_VALUES) {
          expect(normalizeGates({ engineering: a, massProduction: b, listing: c }))
            .toEqual({ engineering: a, massProduction: b, listing: c })
        }
      }
    }
  })

  it('3. missing required（缺 massProduction）→ INVALID_TOOL_INPUT', () => {
    expect(() => normalizeGates({ engineering: 'GO', listing: 'NO_GO' }))
      .toThrowError(Penx1Error)
    expect(() => normalizeGates({ engineering: 'GO', listing: 'NO_GO' }))
      .toThrowError(/massProduction.*必填/)
  })

  it('4. null → INVALID_TOOL_INPUT', () => {
    expect(() => normalizeGates(null)).toThrowError(/必须是对象/)
    expect(() => normalizeGates(undefined)).toThrowError(/必须是对象/)
    expect(() => normalizeGates(['GO'])).toThrowError(/必须是对象/)
  })

  it('5. empty string → INVALID_TOOL_INPUT', () => {
    expect(() => normalizeGates({ engineering: '   ', massProduction: 'NO_GO', listing: 'NO_GO' }))
      .toThrowError(/engineering.*必填/)
  })

  it('6. wrong type（engineering 为数字）→ INVALID_TOOL_INPUT', () => {
    expect(() => normalizeGates({ engineering: 1, massProduction: 'NO_GO', listing: 'NO_GO' }))
      .toThrowError(/engineering.*必填/)
  })

  it('7. 非法枚举值（小写 go / 未知词）→ INVALID_TOOL_INPUT 且提示合法枚举', () => {
    for (const bad of ['go', 'PASS', 'MAYBE', 'CONDITIONAL_GO_NO']) {
      expect(() => normalizeGates({ engineering: bad, massProduction: 'NO_GO', listing: 'NO_GO' }))
        .toThrowError(/engineering.*必须是 GO \/ CONDITIONAL_GO \/ NO_GO 之一/)
    }
  })

  it('8. G5 实际失败形态（结论词+放行条件长文）→ INVALID_TOOL_INPUT 且指向 executiveSummary', () => {
    const longText = 'CONDITIONAL_GO —— 量产路径清晰，无结构性问题；放行条件：R-07 尺寸链分析完成且接触电阻 ≤50mΩ。'
    expect(() => normalizeGates({ engineering: 'GO', massProduction: longText, listing: 'NO_GO' }))
      .toThrowError(/massProduction.*放行条件说明请写入 executiveSummary/)
  })
})
