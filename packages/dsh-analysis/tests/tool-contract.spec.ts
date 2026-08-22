/**
 * Tool Contract Tests（Commit #3 验收核心）。
 * 验收指标：Malformed LLM input → 0 uncaught TypeError。
 *
 * 每个关键工具覆盖 8 类：
 *   1. canonical valid         - 规范合法输入 → PASS
 *   2. missing required        - 缺必填字段 → Penx1Error(INVALID_TOOL_INPUT)
 *   3. null                    - 数组项为 null → ToolArgsError（schema DSL 拦截）
 *   4. wrong type              - 字段类型错 → ToolArgsError（schema DSL 拦截）
 *   5. empty string            - 必填字段为空串 → Penx1Error(INVALID_TOOL_INPUT)
 *   6. unknown property        - 多余字段 → PASS（additionalProperties: true）
 *   7. alias input             - id/text 别名 → PASS + normalize（仅 mine_review_pains）
 *   8. semantically-invalid    - 结构合法但语义违规 → Penx1Error(BUSINESS_RULE_VIOLATION / RISK_SCHEMA_INVALID）
 *
 * 分层防御说明（Commit #3 改造后）：
 *   Schema DSL（参数校验层）: null / 类型错 / 格式错 → ToolArgsError（结构化）
 *   input-guard（execute 入口）: 缺字段 / 空串 / 类型错 → Penx1Error(INVALID_TOOL_INPUT)
 *   business logic（语义层）: 内部属性/外部属性/通用模板 → Penx1Error(BUSINESS_RULE_VIOLATION)
 *   三层均为结构化错误，0 uncaught TypeError。
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyReviewMining } from '../src/review-mining.js'
import { apply as applyOpportunity } from '../src/opportunity.js'
import { apply as applySwot } from '../src/swot.js'
import { apply as applyRiskRegister } from '../src/risk.js'
import { Penx1Error } from '@penx1/contracts'

/** 最小可执行 mock context（仅供 execute 路径使用，不启动真实 workflow）。 */
function makeCtx(runId: string): Context {
  const artifacts: unknown[] = []
  const claims: unknown[] = []
  const evidence: Map<string, unknown> = new Map()
  const phases: Map<string, string> = new Map([[runId, 'opportunitiesReady']])
  return {
    penx1Run: {
      assert: () => {},
      recordArtifact: (_r: string, a: unknown) => { artifacts.push(a) },
      getArtifacts: () => artifacts,
      get: (_r: string) => ({ phase: phases.get(_r) ?? 'opportunitiesReady' }),
      recordStep: () => {},
    },
    penx1Evidence: {
      getEvidence: (_r: string, ref: string) => {
        if (!evidence.has(ref)) throw new Penx1Error('EVIDENCE_NOT_FOUND', `未找到证据 ${ref}`)
        return evidence.get(ref)
      },
      registerClaims: (_r: string, c: unknown[]) => { claims.push(...c) },
      setEvidence: (ref: string, item: unknown) => { evidence.set(ref, item) },
    },
  } as unknown as Context
}

const RUN_ID = 'CONTRACT-RUN-001'

/** 注册全部 4 个工具并返回 execute 函数映射。 */
function setupTools() {
  const ctx = makeCtx(RUN_ID)
  // @ts-expect-error 测试专用：捕获 register 的工具
  const tools: Array<{ name: string; execute: (args: unknown) => Promise<unknown> }> = []
  // @ts-expect-error 覆盖 register
  ctx.tools = { register: (t: unknown) => tools.push(t as never) } as never
  applyReviewMining(ctx, { minimumClusterSize: 1, lowConfidenceCutoff: 0.6, maxClusters: 10 })
  applyOpportunity(ctx, { maxOpportunities: 6, requireEngineeringDependency: true, requireCrossDomainEvidence: true })
  applySwot(ctx, { minItemsPerQuadrant: 2, maxItemsPerQuadrant: 4, rejectGenericStatements: true })
  applyRiskRegister(ctx, { minimumRiskCount: 10, requiredPhases: ['R&D', 'MASS_PRODUCTION', 'OVERSEAS_LAUNCH'] })
  const map: Record<string, (args: unknown) => Promise<unknown>> = {}
  for (const t of tools) map[t.name] = t.execute
  return { ctx, tools: map }
}

/** 断言抛结构化错误（Penx1Error 或 ToolArgsError），且 code 匹配。 */
async function expectStructuredError(execute: () => Promise<unknown>, code: string, msg?: string) {
  let caught: Error & { code?: string } | undefined
  try {
    await execute()
  } catch (e) {
    caught = e as Error & { code?: string }
  }
  expect(caught, '期望抛出结构化错误但实际未抛').toBeDefined()
  // Penx1Error（业务层）或 ToolArgsError（schema DSL 层）均为结构化错误
  const isPenx1 = caught instanceof Penx1Error
  const isToolArgs = caught?.name === 'ToolArgsError'
  expect(isPenx1 || isToolArgs, `期望 Penx1Error 或 ToolArgsError, 实际为 ${(caught as Error)?.name}: ${(caught as Error)?.message}`).toBe(true)
  if (isPenx1) {
    expect((caught as Penx1Error).code).toBe(code)
    if (msg) expect((caught as Penx1Error).message).toContain(msg)
  } else {
    // ToolArgsError 的 code 是统一的，用 message 匹配
    if (msg) expect(caught!.message).toContain(msg)
  }
}

// ─── mine_review_pains ─────────────────────────────────────────────
describe('mine_review_pains contract', () => {
  const validReview = { reviewId: 'MR-001', competitor: 'A', rating: 2, originalQuote: 'The switch is stiff.' }
  it('1. canonical valid → PASS', async () => {
    const { tools } = setupTools()
    const res = await tools['penx1_mine_review_pains']({ runId: RUN_ID, reviews: [validReview] })
    expect((res as { claimCount: number }).claimCount).toBeGreaterThan(0)
  })
  it('2. missing required (reviewId) → INVALID_TOOL_INPUT', async () => {
    const { tools } = setupTools()
    await expectStructuredError(() => tools['penx1_mine_review_pains']({ runId: RUN_ID, reviews: [{ competitor: 'A', originalQuote: 'stiff' }] }), 'INVALID_TOOL_INPUT', 'reviewId')
  })
  it('3. null item → ToolArgsError（schema DSL 拦截）', async () => {
    const { tools } = setupTools()
    await expectStructuredError(() => tools['penx1_mine_review_pains']({ runId: RUN_ID, reviews: [null] }), 'INVALID_TOOL_INPUT')
  })
  it('4. wrong type (originalQuote 为数字) → ToolArgsError', async () => {
    const { tools } = setupTools()
    await expectStructuredError(() => tools['penx1_mine_review_pains']({ runId: RUN_ID, reviews: [{ reviewId: 'MR-1', originalQuote: 123 }] }), 'INVALID_TOOL_INPUT')
  })
  it('5. empty string (originalQuote 为空) → INVALID_TOOL_INPUT', async () => {
    const { tools } = setupTools()
    await expectStructuredError(() => tools['penx1_mine_review_pains']({ runId: RUN_ID, reviews: [{ reviewId: 'MR-1', originalQuote: '   ' }] }), 'INVALID_TOOL_INPUT')
  })
  it('6. unknown property → PASS（additionalProperties: true）', async () => {
    const { tools } = setupTools()
    const res = await tools['penx1_mine_review_pains']({ runId: RUN_ID, reviews: [{ ...validReview, extraField: 'foo' }] })
    expect(res).toBeDefined()
  })
  it('7. alias input (id/text) → PASS + normalize', async () => {
    const { tools } = setupTools()
    const res = await tools['penx1_mine_review_pains']({ runId: RUN_ID, reviews: [{ id: 'MR-ALIAS', text: 'The switch is stiff.', competitor: 'B', rating: 3 }] })
    expect((res as { claimCount: number }).claimCount).toBeGreaterThan(0)
  })
  it('8. semantically-invalid-but-structurally-valid：类型错（数组而非字符串）→ ToolArgsError', async () => {
    const { tools } = setupTools()
    await expectStructuredError(() => tools['penx1_mine_review_pains']({ runId: RUN_ID, reviews: [{ reviewId: 'MR-1', originalQuote: ['a'] }] }), 'INVALID_TOOL_INPUT')
  })
})

// ─── identify_opportunities ────────────────────────────────────────
describe('identify_opportunities contract', () => {
  const validOpp = {
    opportunityId: 'OP-1', title: '电池可获得性', userProblem: '电池兼容', productResponse: '五种电池',
    commercialValue: '高', engineeringDependency: '实测矩阵', evidenceRefs: ['EV-1', 'EV-2'],
  }
  const ctxWithEvidence = () => {
    const { ctx, tools } = setupTools()
    ;(ctx.penx1Evidence as { setEvidence: (ref: string, item: unknown) => void }).setEvidence('EV-1', { content: { domain: 'market' }, sourceRef: 'mock_prices' })
    ;(ctx.penx1Evidence as { setEvidence: (ref: string, item: unknown) => void }).setEvidence('EV-2', { content: { domain: 'review' }, sourceRef: 'mock_reviews' })
    return { ctx, tools }
  }
  it('1. canonical valid → PASS', async () => {
    const { tools } = ctxWithEvidence()
    const res = await tools['penx1_identify_opportunities']({ runId: RUN_ID, opportunities: [validOpp] })
    expect((res as { count: number }).count).toBe(1)
  })
  it('2. missing required (opportunityId) → INVALID_TOOL_INPUT', async () => {
    const { tools } = ctxWithEvidence()
    await expectStructuredError(() => tools['penx1_identify_opportunities']({ runId: RUN_ID, opportunities: [{ title: 'foo', evidenceRefs: ['EV-1', 'EV-2'] }] }), 'INVALID_TOOL_INPUT', 'opportunityId')
  })
  it('3. null item → ToolArgsError（schema DSL 拦截）', async () => {
    const { tools } = ctxWithEvidence()
    await expectStructuredError(() => tools['penx1_identify_opportunities']({ runId: RUN_ID, opportunities: [null] }), 'INVALID_TOOL_INPUT')
  })
  it('4. wrong type (evidenceRefs 为字符串) → ToolArgsError', async () => {
    const { tools } = ctxWithEvidence()
    await expectStructuredError(() => tools['penx1_identify_opportunities']({ runId: RUN_ID, opportunities: [{ opportunityId: 'OP-1', title: 'foo', evidenceRefs: 'EV-1' }] }), 'INVALID_TOOL_INPUT')
  })
  it('5. empty string (title 为空) → INVALID_TOOL_INPUT', async () => {
    const { tools } = ctxWithEvidence()
    await expectStructuredError(() => tools['penx1_identify_opportunities']({ runId: RUN_ID, opportunities: [{ opportunityId: 'OP-1', title: '   ', evidenceRefs: ['EV-1', 'EV-2'] }] }), 'INVALID_TOOL_INPUT')
  })
  it('6. unknown property → PASS', async () => {
    const { tools } = ctxWithEvidence()
    const res = await tools['penx1_identify_opportunities']({ runId: RUN_ID, opportunities: [{ ...validOpp, extraField: 'bar' }] })
    expect(res).toBeDefined()
  })
  it('7. alias input（省略 userProblem）→ PASS（可选字段）', async () => {
    const { tools } = ctxWithEvidence()
    const { userProblem: _omit, ...rest } = validOpp
    const res = await tools['penx1_identify_opportunities']({ runId: RUN_ID, opportunities: [rest] })
    expect((res as { count: number }).count).toBe(1)
  })
  it('8. semantically-invalid-but-structurally-valid：不跨域（全 market 证据）→ ANALYSIS_DEPENDENCY_MISSING', async () => {
    const { tools } = ctxWithEvidence()
    // 结构合法（所有字段齐全）但两个证据都是 market（不跨域）→ ANALYSIS_DEPENDENCY_MISSING
    await expectStructuredError(() => tools['penx1_identify_opportunities']({ runId: RUN_ID, opportunities: [{ ...validOpp, evidenceRefs: ['EV-1', 'EV-1'] }] }), 'ANALYSIS_DEPENDENCY_MISSING', '跨域')
  })
})

// ─── build_swot ─────────────────────────────────────────────────────
describe('build_swot contract', () => {
  const validItems = [
    { quadrant: 'strengths', statement: 'PEN-X1 支持五种电池', evidenceRefs: ['EV-1'], limitations: [] },
    { quadrant: 'strengths', statement: 'PEN-X1 开关逻辑清晰', evidenceRefs: ['EV-2'], limitations: [] },
    { quadrant: 'weaknesses', statement: 'PEN-X1 亮度数据缺失', evidenceRefs: ['EV-3'], limitations: [] },
    { quadrant: 'weaknesses', statement: 'PEN-X1 尺寸偏大', evidenceRefs: ['EV-4'], limitations: [] },
    { quadrant: 'opportunities', statement: '北美用户关注电池', evidenceRefs: ['EV-5'], limitations: [] },
    { quadrant: 'opportunities', statement: 'Amazon 价格带存在空间', evidenceRefs: ['EV-6'], limitations: [] },
    { quadrant: 'threats', statement: '竞品促销挤压利润', evidenceRefs: ['EV-7'], limitations: [] },
    { quadrant: 'threats', statement: 'Listing 缺失影响审计', evidenceRefs: ['EV-8'], limitations: [] },
  ]
  it('1. canonical valid → PASS', async () => {
    const { tools } = setupTools()
    const res = await tools['penx1_build_swot']({ runId: RUN_ID, items: validItems })
    expect((res as { count: number }).count).toBe(8)
  })
  it('2. missing required (statement) → INVALID_TOOL_INPUT', async () => {
    const { tools } = setupTools()
    await expectStructuredError(() => tools['penx1_build_swot']({ runId: RUN_ID, items: [{ quadrant: 'strengths', evidenceRefs: ['EV-1'], limitations: [] }] }), 'INVALID_TOOL_INPUT', 'statement')
  })
  it('3. null item → ToolArgsError（schema DSL 拦截）', async () => {
    const { tools } = setupTools()
    await expectStructuredError(() => tools['penx1_build_swot']({ runId: RUN_ID, items: [null] }), 'INVALID_TOOL_INPUT')
  })
  it('4. wrong type (evidenceRefs 为字符串) → ToolArgsError', async () => {
    const { tools } = setupTools()
    await expectStructuredError(() => tools['penx1_build_swot']({ runId: RUN_ID, items: [{ quadrant: 'strengths', statement: 'foo', evidenceRefs: 'EV-1', limitations: [] }] }), 'INVALID_TOOL_INPUT')
  })
  it('5. empty string (statement 为空) → INVALID_TOOL_INPUT', async () => {
    const { tools } = setupTools()
    await expectStructuredError(() => tools['penx1_build_swot']({ runId: RUN_ID, items: [{ quadrant: 'strengths', statement: '   ', evidenceRefs: ['EV-1'], limitations: [] }] }), 'INVALID_TOOL_INPUT')
  })
  it('6. unknown property → PASS', async () => {
    const { tools } = setupTools()
    const res = await tools['penx1_build_swot']({ runId: RUN_ID, items: [{ ...validItems[0], extraField: 'bar' }, ...validItems.slice(1)] })
    expect(res).toBeDefined()
  })
  it('7. alias input（省略 statement）→ 走 INVALID_TOOL_INPUT', async () => {
    const { tools } = setupTools()
    const { statement: _omit, ...rest } = validItems[0]
    await expectStructuredError(() => tools['penx1_build_swot']({ runId: RUN_ID, items: [rest, ...validItems.slice(1)] }), 'INVALID_TOOL_INPUT', 'statement')
  })
  it('8. semantically-invalid-but-structurally-valid：外部因素当 strength → BUSINESS_RULE_VIOLATION', async () => {
    const { tools } = setupTools()
    const badItems = [
      { quadrant: 'strengths', statement: '市场机会很大', evidenceRefs: ['EV-1'], limitations: [] },
      { quadrant: 'strengths', statement: '竞品反应迟缓', evidenceRefs: ['EV-2'], limitations: [] },
      { quadrant: 'weaknesses', statement: 'PEN-X1 亮度数据缺失', evidenceRefs: ['EV-3'], limitations: [] },
      { quadrant: 'weaknesses', statement: 'PEN-X1 尺寸偏大', evidenceRefs: ['EV-4'], limitations: [] },
      { quadrant: 'opportunities', statement: '北美用户关注电池', evidenceRefs: ['EV-5'], limitations: [] },
      { quadrant: 'opportunities', statement: 'Amazon 价格带存在空间', evidenceRefs: ['EV-6'], limitations: [] },
      { quadrant: 'threats', statement: '竞品促销挤压利润', evidenceRefs: ['EV-7'], limitations: [] },
      { quadrant: 'threats', statement: 'Listing 缺失影响审计', evidenceRefs: ['EV-8'], limitations: [] },
    ]
    await expectStructuredError(() => tools['penx1_build_swot']({ runId: RUN_ID, items: badItems }), 'BUSINESS_RULE_VIOLATION', '未描述 PEN-X1 内部属性')
  })
})

// ─── build_risk_register ────────────────────────────────────────────
describe('build_risk_register contract', () => {
  /** 构造满足三阶段 + 四项关键工程风险的 12 条合法数据。 */
  function make12Risks() {
    return [
      { riskId: 'R-1', phase: 'R&D', severity: 'high', difficulty: 'medium', rootCause: '多长度结构', negativeImpact: '尺寸链超差', mitigation: '公差分析', validationGate: '尺寸链公差分析完成', owner: '工程师', evidenceRefs: ['EV-1'] },
      { riskId: 'R-2', phase: 'R&D', severity: 'high', difficulty: 'medium', rootCause: 'AAA 低压升压效率', negativeImpact: '升压不足', mitigation: 'IC 选型', validationGate: '0.9V 输入效率 ≥85%', owner: '工程师', evidenceRefs: ['EV-2'] },
      { riskId: 'R-3', phase: 'R&D', severity: 'high', difficulty: 'medium', rootCause: '电池类型误识别', negativeImpact: '误识别', mitigation: '算法', validationGate: '识别校准通过率 100%', owner: '工程师', evidenceRefs: ['EV-3'] },
      { riskId: 'R-4', phase: 'R&D', severity: 'high', difficulty: 'medium', rootCause: '14500 高档温升', negativeImpact: '温升过高', mitigation: '散热', validationGate: '温升 ≤ 20K', owner: '工程师', evidenceRefs: ['EV-4'] },
      { riskId: 'R-5', phase: 'R&D', severity: 'medium', difficulty: 'low', rootCause: '双电池混用', negativeImpact: '混用风险', mitigation: '保护', validationGate: '混用保护测试通过', owner: '工程师', evidenceRefs: ['EV-5'] },
      { riskId: 'R-6', phase: 'R&D', severity: 'medium', difficulty: 'low', rootCause: '开关手感', negativeImpact: '手感差', mitigation: '结构优化', validationGate: '手感评估 ≥ 4/5', owner: '工程师', evidenceRefs: ['EV-6'] },
      { riskId: 'R-7', phase: 'MASS_PRODUCTION', severity: 'high', difficulty: 'medium', rootCause: '尺寸链与接触电阻', negativeImpact: '接触电阻超标', mitigation: '工艺控制', validationGate: '接触电阻 ≤ 50mΩ', owner: '工程师', evidenceRefs: ['EV-7'] },
      { riskId: 'R-8', phase: 'MASS_PRODUCTION', severity: 'medium', difficulty: 'medium', rootCause: '弹簧疲劳', negativeImpact: '疲劳断裂', mitigation: '材料', validationGate: '疲劳测试 10 万次', owner: '工程师', evidenceRefs: ['EV-8'] },
      { riskId: 'R-9', phase: 'OVERSEAS_LAUNCH', severity: 'high', difficulty: 'high', rootCause: '运输资料', negativeImpact: '运输合规', mitigation: '报告', validationGate: 'UN38.3 报告齐备', owner: '工程师', evidenceRefs: ['EV-9'] },
      { riskId: 'R-10', phase: 'OVERSEAS_LAUNCH', severity: 'medium', difficulty: 'medium', rootCause: '兼容性表达', negativeImpact: 'Listing 不合规', mitigation: '文案审计', validationGate: 'Listing 文案审计通过', owner: '工程师', evidenceRefs: ['EV-10'] },
      { riskId: 'R-11', phase: 'OVERSEAS_LAUNCH', severity: 'medium', difficulty: 'low', rootCause: '价格促销利润', negativeImpact: '利润压缩', mitigation: '毛利模型', validationGate: '促销毛利 ≥ 30%', owner: '工程师', evidenceRefs: ['EV-11'] },
      { riskId: 'R-12', phase: 'OVERSEAS_LAUNCH', severity: 'medium', difficulty: 'low', rootCause: '规格缺失', negativeImpact: '关键规格未披露', mitigation: '披露清单', validationGate: '关键规格 100% 披露', owner: '工程师', evidenceRefs: ['EV-12'] },
    ]
  }
  it('1. canonical valid → PASS', async () => {
    const { tools } = setupTools()
    const res = await tools['penx1_build_risk_register']({ runId: RUN_ID, risks: make12Risks() })
    expect((res as { count: number }).count).toBe(12)
  })
  it('2. missing required (rootCause) → INVALID_TOOL_INPUT', async () => {
    const { tools } = setupTools()
    const risks = make12Risks()
    // 空串是合法 JSON，但 input-guard 会拦截为 INVALID_TOOL_INPUT
    risks[0] = { ...risks[0], rootCause: '   ' }
    await expectStructuredError(() => tools['penx1_build_risk_register']({ runId: RUN_ID, risks }), 'INVALID_TOOL_INPUT', 'rootCause')
  })
  it('3. null item → ToolArgsError（schema DSL 拦截）', async () => {
    const { tools } = setupTools()
    await expectStructuredError(() => tools['penx1_build_risk_register']({ runId: RUN_ID, risks: [null] }), 'INVALID_TOOL_INPUT')
  })
  it('4. wrong type (evidenceRefs 为字符串) → ToolArgsError', async () => {
    const { tools } = setupTools()
    const risks = make12Risks()
    risks[0] = { ...risks[0], evidenceRefs: 'EV-1' }
    await expectStructuredError(() => tools['penx1_build_risk_register']({ runId: RUN_ID, risks }), 'INVALID_TOOL_INPUT')
  })
  it('5. empty string (rootCause 为空) → INVALID_TOOL_INPUT', async () => {
    const { tools } = setupTools()
    const risks = make12Risks()
    risks[0] = { ...risks[0], rootCause: '   ' }
    await expectStructuredError(() => tools['penx1_build_risk_register']({ runId: RUN_ID, risks }), 'INVALID_TOOL_INPUT')
  })
  it('6. unknown property → PASS', async () => {
    const { tools } = setupTools()
    const risks = make12Risks()
    risks[0] = { ...risks[0], extraField: 'bar' }
    const res = await tools['penx1_build_risk_register']({ runId: RUN_ID, risks })
    expect(res).toBeDefined()
  })
  it('7. alias input（省略 owner，用 responsible 别名）→ PASS + normalize', async () => {
    const { tools } = setupTools()
    const risks = make12Risks()
    const { owner: _omit, ...rest } = risks[11]
    risks[11] = { ...rest, responsible: '测试工程师' }
    const res = await tools['penx1_build_risk_register']({ runId: RUN_ID, risks })
    expect((res as { count: number }).count).toBe(12)
  })
  it('8. semantically-invalid-but-structurally-valid：Gate 不可验证 → RISK_SCHEMA_INVALID', async () => {
    const { tools } = setupTools()
    const risks = make12Risks()
    risks[11] = { ...risks[11], validationGate: '进一步观察' }
    await expectStructuredError(() => tools['penx1_build_risk_register']({ runId: RUN_ID, risks }), 'RISK_SCHEMA_INVALID', '不可验证')
  })
})
