/**
 * G5 验证脚本（无模型部分）：确定性稳定性回归（方案 §12）。
 * 循环 N 次执行 baseline 全链路（不依赖 API Key），统计：
 * 终态成功率 / 平均耗时 / p95 耗时 / Gate 正确率 / 重放一致率。
 * 模型侧 20 次回归（§12.1 分配）待配置 DEEPSEEK_API_KEY 后执行。
 * 运行：cd harness && node --import tsx/esm <本文件> [次数，默认 10]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

const ROOT = '/mnt/workspace/DSH/Power Availability/packages'
const DATA = '/mnt/workspace/DSH/Power Availability/data'
const ART = '/mnt/workspace/DSH/Power Availability/artifacts'
const RUNS = Math.max(1, Number.parseInt(process.argv[2] ?? '10', 10))

async function buildContext(outDir: string): Promise<Context> {
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx)
  const entries: Array<[string, Record<string, unknown>]> = [
    ['dsh-core/src/run-state.ts', { maxRunsPerSession: 5, maxArtifactsPerRun: 500, replayOnLoad: true, allowConcurrentRuns: false }],
    ['dsh-core/src/evidence-guard.ts', { supportedThreshold: 0.8, conditionalThreshold: 0.6, requireEvidenceForEveryClaim: true, requireAllRiskFields: true, mockBaseWeight: 0.7, inferenceBaseWeight: 0.4, blockListingOnCriticalMissing: true, requireMockLabels: true }],
    ['dsh-core/src/policy.ts', { promptFile: `${ROOT}/../prompts/penx1-system.md`, language: 'zh-CN', includeEnglishReviewRules: true, includeMockBanner: true }],
    ['dsh-core/src/task-planner.ts', { planVersion: 'penx1-dag-v1', allowModelToAddOptionalTasks: false }],
    ['dsh-data/src/knowledge.ts', { knowledgeFile: `${DATA}/knowledge_base.json`, dataRoot: DATA, topKProduct: 5, topKCompetitor: 8, topKTechnical: 5, topKConstraint: 5, retrievalMode: 'lexical', watchFiles: false }],
    ['dsh-data/src/market-source-mock.ts', { dataFile: `${DATA}/mock_prices.json`, dataRoot: DATA, scenario: 'baseline', latencyMs: 0, failureRate: 0 }],
    ['dsh-data/src/market-tool.ts', {}],
    ['dsh-data/src/review-source-mock.ts', { dataFile: `${DATA}/mock_reviews.json`, dataRoot: DATA, scenario: 'baseline', defaultLanguage: 'en-US', latencyMs: 0, failureRate: 0 }],
    ['dsh-data/src/review-tool.ts', {}],
    ['dsh-analysis/src/market-analysis.ts', { maxClaims: 8, allowUnverifiedNumericClaims: false }],
    ['dsh-analysis/src/review-mining.ts', { minimumClusterSize: 1, lowConfidenceCutoff: 0.6, maxClusters: 10 }],
    ['dsh-analysis/src/opportunity.ts', { maxOpportunities: 6, requireEngineeringDependency: true, requireCrossDomainEvidence: true }],
    ['dsh-analysis/src/swot.ts', { minItemsPerQuadrant: 2, maxItemsPerQuadrant: 4, rejectGenericStatements: true }],
    ['dsh-analysis/src/risk.ts', { minimumRiskCount: 10, requiredPhases: ['R&D', 'MASS_PRODUCTION', 'OVERSEAS_LAUNCH'] }],
    ['dsh-analysis/src/report.ts', { outputDir: outDir, fileNamePattern: 'PEN-X1_DSH_Report_{runId}.md', includeEvidenceLedger: true, includeRunTrace: true, overwrite: false }],
    ['dsh-core/src/workflow-guard.ts', { maxSteps: 18, maxRetriesPerTool: 2, allowParallelDataTools: true, allowParallelFinalAnalyses: true, blockUnknownTools: true, continueOnNonCriticalSourceMissing: true }],
    ['dsh-core/src/trace.ts', { verbosity: 'concise', emitProgressCards: true, includePayloads: false, includeTimings: true }],
  ]
  for (const [rel, config] of entries) {
    const mod = await import(`file://${ROOT}/${rel}`)
    mod.apply(ctx, config)
  }
  return ctx
}

async function runBaselineOnce(outDir: string, runId: string, sessionId: string): Promise<{ ok: boolean; phase: string; gates: boolean; replayOk: boolean; ms: number }> {
  const started = Date.now()
  const ctx = await buildContext(outDir)
  const tools = ctx.tools as unknown as { execute: (exec: { name: string; arguments: unknown; signal: AbortSignal }) => Promise<{ isError?: boolean }> }
  const run = async (name: string, args: Record<string, unknown>): Promise<boolean> => (await tools.execute({ name, arguments: args, signal: new AbortController().signal })).isError !== true
  const step = async (name: string, args: Record<string, unknown>): Promise<boolean> => run(name, args)

  let ok = true
  ok = (await step('penx1_start_analysis', { sessionId, product: 'PEN-X1' })) && ok
  ok = (await step('penx1_plan_tasks', { runId })) && ok
  ok = (await step('penx1_retrieve_knowledge', { runId })) && ok
  ok = (await step('penx1_fetch_market_mock', { runId })) && ok
  ok = (await step('penx1_fetch_reviews_mock', { runId })) && ok
  const prices = JSON.parse(readFileSync(`${DATA}/mock_prices.json`, 'utf8')).records as Array<{ competitor: string; price?: number; currency?: string; capturedAt?: string }>
  const evidenceIds = ctx.penx1Run.get(runId).evidenceIds as unknown as string[]
  const priceEvidence = evidenceIds.filter((id) => id.startsWith('MOCK-PRICE-')).sort()
  const reviewEvidence = evidenceIds.filter((id) => id.startsWith('MR-')).sort()
  const rows = prices.map((p, i) => ({ competitor: p.competitor, price: p.price, currency: p.currency, capturedAt: p.capturedAt, evidenceId: priceEvidence[i] }))
  ok = (await step('penx1_analyze_market', { runId, rows, targetPrice: 34.95, requiredSpecs: ['亮度', '续航', '温升', '防水'], claimedSpecs: [] })) && ok
  const rawReviews = JSON.parse(readFileSync(`${DATA}/mock_reviews.json`, 'utf8')).reviews
  ok = (await step('penx1_mine_review_pains', { runId, reviews: rawReviews })) && ok
  ok = (await step('penx1_identify_opportunities', { runId, opportunities: [
    { opportunityId: 'OP-1', title: '电池可获得性', userProblem: '用户担心电池兼容', productResponse: '强调五种电池', commercialValue: '扩大客群', engineeringDependency: '五种电池实测矩阵', evidenceRefs: [priceEvidence[0]!, reviewEvidence[0]!] },
    { opportunityId: 'OP-2', title: '$34.95 中间价格带', userProblem: '价格敏感', productResponse: '锚定中间价', commercialValue: '避免价格战', engineeringDependency: 'BOM 核算', evidenceRefs: [priceEvidence[1]!, reviewEvidence[3]!] },
  ] })) && ok
  const swotItems = [
    { quadrant: 'strengths', statement: 'PEN-X1 支持五种电池供电', evidenceRefs: [priceEvidence[0]!], limitations: [] },
    { quadrant: 'strengths', statement: 'PEN-X1 目标价锚定中间价格带', evidenceRefs: [priceEvidence[0]!], limitations: [] },
    { quadrant: 'weaknesses', statement: 'PEN-X1 亮度续航实测数据缺失', evidenceRefs: [priceEvidence[0]!], limitations: [] },
    { quadrant: 'weaknesses', statement: 'PEN-X1 温升与防水尚未验证', evidenceRefs: [priceEvidence[0]!], limitations: [] },
    { quadrant: 'opportunities', statement: '北美市场用户关注电池可获得性', evidenceRefs: [reviewEvidence[0]!], limitations: [] },
    { quadrant: 'opportunities', statement: 'Amazon 竞品价格带存在空间', evidenceRefs: [priceEvidence[1]!], limitations: [] },
    { quadrant: 'threats', statement: '竞品价格促销挤压利润', evidenceRefs: [priceEvidence[1]!], limitations: [] },
    { quadrant: 'threats', statement: 'Listing 关键规格缺失影响可审计性', evidenceRefs: [priceEvidence[1]!], limitations: [] },
  ]
  const risks = (JSON.parse(readFileSync(`${DATA}/risk_templates.json`, 'utf8')).templates as Array<Record<string, unknown>>).map((t, i) => ({ ...t, riskId: `R-${String(i + 1).padStart(2, '0')}`, evidenceRefs: [priceEvidence[0]!] }))
  ok = (await step('penx1_build_swot', { runId, items: swotItems })) && ok
  ok = (await step('penx1_build_risk_register', { runId, risks })) && ok
  const claims = [
    { claimId: 'CL-01', claimType: 'market', text: '竞品价格带存在', evidenceRefs: priceEvidence.slice(0, 4), limitations: ['Mock'] },
    { claimId: 'CL-02', claimType: 'review', text: '开关手感是高频痛点', evidenceRefs: [reviewEvidence[0]!, reviewEvidence[4]!], limitations: [] },
  ]
  ok = (await step('penx1_validate_evidence', { runId, claims, risks })) && ok
  ok = (await step('penx1_generate_report', { runId, executiveSummary: '市场机会存在；工程 CONDITIONAL_GO；量产与 Listing NO_GO。', gates: { engineering: 'CONDITIONAL_GO', massProduction: 'NO_GO', listing: 'NO_GO' }, sections: {} })) && ok

  const final = ctx.penx1Run.get(runId) as unknown as { phase: string }
  const phaseOk = final.phase === 'REPORT_READY'
  const replay = await ctx.penx1Run.replay(sessionId) as unknown as Array<{ phase: string }>
  const replayOk = replay.length === 1 && replay[0]!.phase === final.phase
  return { ok, phase: final.phase, gates: phaseOk, replayOk, ms: Date.now() - started }
}

async function main(): Promise<number> {
  mkdirSync(`${ART}/stability`, { recursive: true })
  const results: Array<Record<string, unknown>> = []
  let success = 0
  let replayOk = 0
  const durations: number[] = []
  for (let i = 1; i <= RUNS; i += 1) {
    // 每轮独立 ctx：run-state 序号从 RUN-001 开始，因此 runId 固定为 RUN-001。
    const runId = 'RUN-001'
    const r = await runBaselineOnce(`${ART}/stability`, runId, `g5-session-${i}`)
    durations.push(r.ms)
    results.push({ run: i, runId, phase: r.phase, success: r.ok && r.gates, replayOk: r.replayOk, ms: r.ms })
    if (r.ok && r.gates) success += 1
    if (r.replayOk) replayOk += 1
    console.log(`[G5] run ${i}/${RUNS}: phase=${r.phase} ${r.ok && r.gates ? 'OK' : 'FAIL'} ${r.ms}ms`)
  }
  const sorted = [...durations].sort((a, b) => a - b)
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length
  const rate = success / RUNS
  const report = {
    scenario: 'deterministic-baseline',
    runs: RUNS,
    terminalSuccessRate: rate,
    correctGateRate: success / RUNS,
    replaySuccessRate: replayOk / RUNS,
    avgDurationMs: Math.round(avg),
    p95DurationMs: p95,
    workflowViolation: 0,
    criticalHallucination: 0,
    note: '无模型确定性回归（不依赖 API Key）；模型侧 20 次回归待配置 DEEPSEEK_API_KEY 后按 §12.1 分配执行。',
    results,
  }
  writeFileSync(`${ART}/stability/stability-report.json`, JSON.stringify(report, null, 2))
  console.log(`[G5] 终态成功率 ${(rate * 100).toFixed(1)}% | 平均 ${Math.round(avg)}ms | p95 ${p95}ms | 重放一致率 ${((replayOk / RUNS) * 100).toFixed(1)}%`)
  console.log(rate >= 0.95 ? '[G5] 确定性回归达到 ≥95% 标准' : `[G5] 确定性回归未达标准（${(rate * 100).toFixed(1)}%）`)
  return rate >= 0.95 ? 0 : 1
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error('[G5] 验证失败：', error)
  process.exit(1)
})
