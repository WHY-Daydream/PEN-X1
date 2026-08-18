import { describe, expect, it } from 'vitest'
import { evaluatePolicy } from '../src/workflow-guard.js'

const COMPLETED = {
  runStarted: true,
  planReady: true,
  knowledgeReady: true,
  marketDataReady: true,
  reviewDataReady: true,
}

describe('evaluatePolicy（方案 §22.4）', () => {
  it('知识库未就绪时外部数据工具被阻断，并给出 requiredAction（§33.3 门禁演示）', () => {
    const decision = evaluatePolicy('penx1_fetch_market_mock', { runStarted: true, planReady: true }, { blockUnknownTools: true })
    expect(decision.allowed).toBe(false)
    expect(decision.errorCode).toBe('KNOWLEDGE_RETRIEVAL_REQUIRED')
    expect(decision.requiredAction).toBe('penx1_retrieve_knowledge')
  })

  it('计划未就绪时知识库工具被阻断', () => {
    const decision = evaluatePolicy('penx1_retrieve_knowledge', { runStarted: true }, { blockUnknownTools: true })
    expect(decision.allowed).toBe(false)
    expect(decision.requiredAction).toContain('planReady')
  })

  it('opportunity 需市场分析 + 评论挖掘同时就绪', () => {
    const decision = evaluatePolicy('penx1_identify_opportunities', COMPLETED, { blockUnknownTools: true })
    expect(decision.allowed).toBe(false)
    expect(decision.requiredAction).toContain('marketAnalysisReady')
  })

  it('报告必须 validationPassed 在前（方案 §22.4 不变量）', () => {
    const decision = evaluatePolicy('penx1_generate_report', COMPLETED, { blockUnknownTools: true })
    expect(decision.allowed).toBe(false)
    expect(decision.requiredAction).toContain('validationPassed')
  })

  it('前置满足时放行；控制工具无条件放行', () => {
    expect(evaluatePolicy('penx1_fetch_market_mock', { ...COMPLETED, knowledgeReady: true }, { blockUnknownTools: true }).allowed).toBe(true)
    expect(evaluatePolicy('penx1_start_analysis', {}, { blockUnknownTools: true }).allowed).toBe(true)
  })

  it('未知工具被阻断；blockUnknownTools=false 时放行', () => {
    const blocked = evaluatePolicy('bash', COMPLETED, { blockUnknownTools: true })
    expect(blocked.allowed).toBe(false)
    expect(blocked.errorCode).toBe('INVALID_PHASE')
    expect(evaluatePolicy('bash', COMPLETED, { blockUnknownTools: false }).allowed).toBe(true)
  })
})
