/** PEN-X1 工具策略表（方案 §4.7 / §22.4）。Workflow Guard 只读此表实施前置门禁。 */

export const TOOL_POLICIES = {
  penx1_plan_tasks: { requires: ['runStarted'] },
  penx1_retrieve_knowledge: { requires: ['planReady'] },
  penx1_fetch_market_mock: { requires: ['knowledgeReady'] },
  penx1_fetch_reviews_mock: { requires: ['knowledgeReady'] },
  penx1_analyze_market: { requires: ['knowledgeReady', 'marketDataReady'] },
  penx1_mine_review_pains: { requires: ['knowledgeReady', 'reviewDataReady'] },
  penx1_identify_opportunities: { requires: ['marketAnalysisReady', 'reviewMiningReady'] },
  penx1_build_swot: { requires: ['opportunitiesReady'] },
  penx1_build_risk_register: { requires: ['opportunitiesReady'] },
  penx1_validate_evidence: { requires: ['swotReady', 'riskReady'] },
  penx1_generate_report: { requires: ['validationPassed'] },
} as const

export type PolicyToolName = keyof typeof TOOL_POLICIES

export const CONTROL_TOOLS = ['penx1_start_analysis', 'penx1_get_status'] as const

export const ALL_PENX1_TOOLS: readonly string[] = [
  ...CONTROL_TOOLS,
  ...Object.keys(TOOL_POLICIES),
]

/** 返回某工具的前置 flag 列表；控制类工具无前置，未知工具返回 undefined。 */
export function policyFor(tool: string): readonly string[] | undefined {
  if ((CONTROL_TOOLS as readonly string[]).includes(tool)) return []
  const policy = TOOL_POLICIES[tool as PolicyToolName]
  return policy === undefined ? undefined : policy.requires
}

export function isPenx1Tool(tool: string): boolean {
  return ALL_PENX1_TOOLS.includes(tool)
}

/** 工具成功执行后置位的 Artifact Flag（方案 §26：Artifact 只通过成功 Tool Result 产生）。 */
export const TOOL_COMPLETED_FLAGS: Readonly<Record<string, string>> = {
  penx1_start_analysis: 'runStarted',
  penx1_plan_tasks: 'planReady',
  penx1_retrieve_knowledge: 'knowledgeReady',
  penx1_fetch_market_mock: 'marketDataReady',
  penx1_fetch_reviews_mock: 'reviewDataReady',
  penx1_analyze_market: 'marketAnalysisReady',
  penx1_mine_review_pains: 'reviewMiningReady',
  penx1_identify_opportunities: 'opportunitiesReady',
  penx1_build_swot: 'swotReady',
  penx1_build_risk_register: 'riskReady',
  penx1_validate_evidence: 'validationPassed',
  penx1_generate_report: 'reportReady',
}

/** 工具成功时对应的完成 flag；未知工具返回 undefined。 */
export function completedFlagFor(tool: string): string | undefined {
  return TOOL_COMPLETED_FLAGS[tool]
}
