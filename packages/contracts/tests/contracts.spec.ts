import { describe, expect, it } from 'vitest'
import {
  derivePhase,
  isMockLabel,
  isPenx1Tool,
  isVerifiableGate,
  MOCK_BANNER,
  PENX1_ERRORS,
  policyFor,
  TOOL_POLICIES,
} from '../src/index.js'

describe('TOOL_POLICIES / policyFor', () => {
  it('严格符合方案 §4.7 的策略表', () => {
    expect(Object.keys(TOOL_POLICIES)).toEqual([
      'penx1_plan_tasks',
      'penx1_retrieve_knowledge',
      'penx1_fetch_market_mock',
      'penx1_fetch_reviews_mock',
      'penx1_analyze_market',
      'penx1_mine_review_pains',
      'penx1_identify_opportunities',
      'penx1_build_swot',
      'penx1_build_risk_register',
      'penx1_validate_evidence',
      'penx1_generate_report',
    ])
  })

  it('控制类工具无前置条件，未知工具返回 undefined', () => {
    expect(policyFor('penx1_start_analysis')).toEqual([])
    expect(policyFor('penx1_get_status')).toEqual([])
    expect(policyFor('not_a_penx1_tool')).toBeUndefined()
  })

  it('外部数据工具要求 knowledgeReady 在前', () => {
    expect(TOOL_POLICIES.penx1_fetch_market_mock.requires).toEqual(['knowledgeReady'])
    expect(TOOL_POLICIES.penx1_generate_report.requires).toEqual(['validationPassed'])
  })

  it('isPenx1Tool 覆盖全部 13 个工具', () => {
    for (const tool of [
      'penx1_start_analysis',
      'penx1_get_status',
      ...Object.keys(TOOL_POLICIES),
    ]) {
      expect(isPenx1Tool(tool)).toBe(true)
    }
    expect(isPenx1Tool('bash')).toBe(false)
  })
})

describe('derivePhase（方案 §26）', () => {
  it('按优先级派生高层 Phase', () => {
    expect(derivePhase({})).toBe('INIT')
    expect(derivePhase({ runStarted: true })).toBe('INIT')
    expect(derivePhase({ runStarted: true, planReady: true })).toBe('PLANNED')
    expect(derivePhase({ runStarted: true, planReady: true, knowledgeReady: true })).toBe('KB_READY')
    expect(derivePhase({
      runStarted: true, planReady: true, knowledgeReady: true,
      marketDataReady: true, reviewDataReady: true,
    })).toBe('DATA_READY')
    expect(derivePhase({
      runStarted: true, planReady: true, knowledgeReady: true,
      marketDataReady: true, reviewDataReady: true,
      swotReady: true, riskReady: true,
    })).toBe('ANALYSIS_READY')
    expect(derivePhase({
      runStarted: true, planReady: true, knowledgeReady: true,
      marketDataReady: true, reviewDataReady: true,
      swotReady: true, riskReady: true, validationPassed: true,
    })).toBe('VALIDATED')
    expect(derivePhase({
      runStarted: true, planReady: true, knowledgeReady: true,
      marketDataReady: true, reviewDataReady: true,
      swotReady: true, riskReady: true, validationPassed: true, reportReady: true,
    })).toBe('REPORT_READY')
  })
})

describe('Mock 标签', () => {
  it('【演示Mock数据】标签必须存在', () => {
    expect(isMockLabel('Amazon 竞品价格 ${MOCK_BANNER}')).toBe(false)
    expect(isMockLabel(`Amazon 竞品价格 ${MOCK_BANNER}`)).toBe(true)
    expect(isMockLabel(MOCK_BANNER)).toBe(true)
  })
})

describe('风险门禁辅助', () => {
  it('不可验证 Gate 与可验证 Gate', () => {
    expect(isVerifiableGate('进一步观察')).toBe(false)
    expect(isVerifiableGate('持续跟踪该问题')).toBe(false)
    expect(isVerifiableGate('EOL 测试通过率 ≥ 99.5%')).toBe(true)
    expect(isVerifiableGate('尺寸链公差分析完成且接触电阻 ≤ 50mΩ')).toBe(true)
  })
})

describe('错误码', () => {
  it('错误码清单与方案 §4.6 一致', () => {
    expect(PENX1_ERRORS).toContain('KNOWLEDGE_RETRIEVAL_REQUIRED')
    expect(PENX1_ERRORS).toContain('REPORT_NOT_AUTHORIZED')
    expect(PENX1_ERRORS).toContain('MOCK_LABEL_MISSING')
    expect(PENX1_ERRORS).toContain('DATA_FILE_OUTSIDE_ROOT')
  })
})
