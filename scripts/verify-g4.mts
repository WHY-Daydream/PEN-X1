/**
 * G4 验证脚本：四场景 E2E 无模型版（方案 §11）。
 * baseline / missing-data / conflict-data / illegal-order。
 * 每场景独立 ctx + 独立输出目录，产物保存到 artifacts/<scenario>/。
 * 运行：cd harness && node --import tsx/esm <本文件>
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

const ROOT = '/mnt/workspace/DSH/Power Availability/packages'
const DATA = '/mnt/workspace/DSH/Power Availability/data'
const ART = '/mnt/workspace/DSH/Power Availability/artifacts'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`[G4] ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

function pluginConfig(scenario: string, outDir: string): Array<[string, Record<string, unknown>]> {
  const reviewFile = scenario === 'missing-data' ? `${DATA}/scenarios/missing-data.json` : `${DATA}/mock_reviews.json`
  const marketFile = scenario === 'conflict-data' ? `${DATA}/scenarios/conflict-data.json` : `${DATA}/mock_prices.json`
  return [
    ['dsh-core/src/run-state.ts', { maxRunsPerSession: 5, maxArtifactsPerRun: 500, replayOnLoad: true, allowConcurrentRuns: false }],
    ['dsh-core/src/evidence-guard.ts', { supportedThreshold: 0.8, conditionalThreshold: 0.6, requireEvidenceForEveryClaim: true, requireAllRiskFields: true, mockBaseWeight: 0.7, inferenceBaseWeight: 0.4, blockListingOnCriticalMissing: true, requireMockLabels: true }],
    ['dsh-core/src/policy.ts', { promptFile: `${ROOT}/../prompts/penx1-system.md`, language: 'zh-CN', includeEnglishReviewRules: true, includeMockBanner: true }],
    ['dsh-core/src/task-planner.ts', { planVersion: 'penx1-dag-v1', allowModelToAddOptionalTasks: false }],
    ['dsh-data/src/knowledge.ts', { knowledgeFile: `${DATA}/knowledge_base.json`, dataRoot: DATA, topKProduct: 5, topKCompetitor: 8, topKTechnical: 5, topKConstraint: 5, retrievalMode: 'lexical', watchFiles: false }],
    ['dsh-data/src/market-source-mock.ts', { dataFile: marketFile, dataRoot: DATA, scenario, latencyMs: 0, failureRate: 0 }],
    ['dsh-data/src/market-tool.ts', {}],
    ['dsh-data/src/review-source-mock.ts', { dataFile: reviewFile, dataRoot: DATA, scenario, defaultLanguage: 'en-US', latencyMs: 0, failureRate: 0 }],
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
}

async function buildContext(scenario: string, outDir: string): Promise<Context> {
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx)
  for (const [rel, config] of pluginConfig(scenario, outDir)) {
    const mod = await import(`file://${ROOT}/${rel}`)
    mod.apply(ctx, config)
  }
  return ctx
}

type ToolResultView = { isError: boolean; text: string }
async function makeRunner(ctx: Context): Promise<(name: string, args: Record<string, unknown>) => Promise<ToolResultView>> {
  const tools = ctx.tools as unknown as { execute: (exec: { name: string; arguments: unknown; signal: AbortSignal }) => Promise<{ isError?: boolean; content?: Array<{ type: string; text?: string }>; error?: { message?: string } }> }
  return async (name, args) => {
    const result = await tools.execute({ name, arguments: args, signal: new AbortController().signal })
    const text = (result.content ?? []).map((c) => c.text ?? '').join('\n')
    return { isError: result.isError === true, text }
  }
}

const SAFE_RISKS = (): Array<Record<string, unknown>> =>
  (JSON.parse(readFileSync(`${DATA}/risk_templates.json`, 'utf8')).templates as Array<Record<string, unknown>>).map((t, i) => ({
    ...t,
    riskId: `R-${String(i + 1).padStart(2, '0')}`,
    severity: t.severity ?? 'high',
    difficulty: t.difficulty ?? 'medium',
    evidenceRefs: [],
  }))

async function scenarioBaseline(): Promise<void> {
  const outDir = `${ART}/baseline`
  mkdirSync(outDir, { recursive: true })
  const ctx = await buildContext('baseline', outDir)
  const run = await makeRunner(ctx)
  const sessionId = 'g4-baseline'
  const runId = 'RUN-001'
  const trace: string[] = []
  const step = async (name: string, args: Record<string, unknown>): Promise<ToolResultView> => {
    const r = await run(name, args)
    trace.push(`${name}:${r.isError ? 'ERR' : 'OK'}`)
    return r
  }

  await step('penx1_start_analysis', { sessionId, product: 'PEN-X1', market: 'North America Amazon', language: 'zh-CN' })
  await step('penx1_plan_tasks', { runId })
  await step('penx1_retrieve_knowledge', { runId })
  const [m, rv] = await Promise.all([step('penx1_fetch_market_mock', { runId }), step('penx1_fetch_reviews_mock', { runId })])
  const prices = JSON.parse(readFileSync(`${DATA}/mock_prices.json`, 'utf8')).records as Array<{ competitor: string; price?: number; currency?: string; capturedAt?: string }>
  const evidenceIds = ctx.penx1Run.get(runId).evidenceIds as unknown as string[]
  const priceEvidence = evidenceIds.filter((id) => id.startsWith('MOCK-PRICE-')).sort()
  const reviewEvidence = evidenceIds.filter((id) => id.startsWith('MR-')).sort()
  const rows = prices.map((p, i) => ({ competitor: p.competitor, price: p.price, currency: p.currency, capturedAt: p.capturedAt, evidenceId: priceEvidence[i] }))
  await step('penx1_analyze_market', { runId, rows, targetPrice: 34.95, requiredSpecs: ['亮度', '续航', '温升', '防水'], claimedSpecs: [] })
  const rawReviews = JSON.parse(readFileSync(`${DATA}/mock_reviews.json`, 'utf8')).reviews as Array<{ reviewId: string; competitor: string; rating: number; language: string; originalQuote: string }>
  await step('penx1_mine_review_pains', { runId, reviews: rawReviews })
  const opportunities = [
    { opportunityId: 'OP-1', title: '电池可获得性', userProblem: '用户担心电池兼容', productResponse: '强调五种电池', commercialValue: '扩大客群', engineeringDependency: '五种电池实测矩阵', evidenceRefs: [priceEvidence[0]!, reviewEvidence[0]!] },
    { opportunityId: 'OP-2', title: '$34.95 中间价格带', userProblem: '价格敏感', productResponse: '锚定中间价', commercialValue: '避免价格战', engineeringDependency: 'BOM 核算', evidenceRefs: [priceEvidence[1]!, reviewEvidence[3]!] },
    { opportunityId: 'OP-3', title: '开关手感与档位逻辑', userProblem: '开关过硬误触', productResponse: '优化开关力值', commercialValue: '降退货率', engineeringDependency: '开关寿命测试', evidenceRefs: [reviewEvidence[0]!, priceEvidence[1]!] },
    { opportunityId: 'OP-4', title: '五种电池差异透明化', userProblem: '性能不透明', productResponse: '披露实测矩阵', commercialValue: '减少差评', engineeringDependency: '实测数据', evidenceRefs: [reviewEvidence[7]!, priceEvidence[2]!] },
  ]
  await step('penx1_identify_opportunities', { runId, opportunities })
  const swotItems = [
    { quadrant: 'strengths', statement: 'PEN-X1 支持五种电池供电', evidenceRefs: [priceEvidence[1]!], limitations: [] },
    { quadrant: 'strengths', statement: 'PEN-X1 目标价锚定中间价格带', evidenceRefs: [priceEvidence[1]!], limitations: [] },
    { quadrant: 'weaknesses', statement: 'PEN-X1 亮度续航实测数据缺失', evidenceRefs: [priceEvidence[1]!], limitations: [] },
    { quadrant: 'weaknesses', statement: 'PEN-X1 温升与防水尚未验证', evidenceRefs: [priceEvidence[1]!], limitations: [] },
    { quadrant: 'opportunities', statement: '北美市场用户关注电池可获得性', evidenceRefs: [reviewEvidence[0]!], limitations: [] },
    { quadrant: 'opportunities', statement: 'Amazon 竞品价格带存在空间', evidenceRefs: [priceEvidence[2]!], limitations: [] },
    { quadrant: 'threats', statement: '竞品价格促销挤压利润', evidenceRefs: [priceEvidence[3]!], limitations: [] },
    { quadrant: 'threats', statement: 'Listing 关键规格缺失影响可审计性', evidenceRefs: [priceEvidence[1]!], limitations: [] },
  ]
  const [s1, s2] = await Promise.all([step('penx1_build_swot', { runId, items: swotItems }), step('penx1_build_risk_register', { runId, risks: SAFE_RISKS().map((r) => ({ ...r, evidenceRefs: [priceEvidence[0]!] })) })])
  check('baseline SWOT 成功', !s1.isError)
  check('baseline Risk 成功', !s2.isError)
  const claims = [
    { claimId: 'CL-01', claimType: 'market', text: '竞品价格带约 $29.99–$49.99', evidenceRefs: priceEvidence.slice(0, 4), limitations: ['Mock'] },
    { claimId: 'CL-02', claimType: 'review', text: '开关手感与误触是高频痛点', evidenceRefs: [reviewEvidence[0]!, reviewEvidence[4]!], limitations: [] },
  ]
  const val = await step('penx1_validate_evidence', { runId, claims, risks: SAFE_RISKS().map((r) => ({ ...r, evidenceRefs: [priceEvidence[0]!] })) })
  check('baseline validate 成功', !val.isError, val.text)
  const report = await step('penx1_generate_report', {
    runId,
    executiveSummary: '市场机会存在；工程 CONDITIONAL_GO；量产与 Listing NO_GO。',
    gates: { engineering: 'CONDITIONAL_GO', massProduction: 'NO_GO', listing: 'NO_GO' },
    sections: {},
  })
  check('baseline 报告成功', !report.isError, report.text)
  const final = ctx.penx1Run.get(runId) as unknown as { phase: string }
  check('baseline 终态 REPORT_READY', final.phase === 'REPORT_READY', final.phase)
  const reports = readdirSync(outDir).filter((f) => f.startsWith('PEN-X1_DSH_Report'))
  check('baseline 报告文件落盘', reports.length >= 1, reports.join(','))
  if (reports.length > 0) {
    const content = readFileSync(`${outDir}/${reports[0]}`, 'utf8')
    check('baseline 报告含 Mock 声明', content.includes('【演示Mock数据】'))
    check('baseline 报告 Gate 正确', content.includes('| 工程开发 | CONDITIONAL_GO |') && content.includes('| 量产 | NO_GO |') && content.includes('| 北美 Listing | NO_GO |'))
  }
  writeFileSync(`${outDir}/tool-trace.json`, JSON.stringify({ scenario: 'baseline', sessionId, trace }, null, 2))
  writeFileSync(`${outDir}/run-projection.json`, JSON.stringify(ctx.penx1Run.get(runId), null, 2))
  void m
  void rv
}

async function scenarioMissing(): Promise<void> {
  const outDir = `${ART}/missing-data`
  mkdirSync(outDir, { recursive: true })
  const ctx = await buildContext('missing-data', outDir)
  const run = await makeRunner(ctx)
  const sessionId = 'g4-missing'
  const runId = 'RUN-001'
  await run('penx1_start_analysis', { sessionId, product: 'PEN-X1' })
  await run('penx1_plan_tasks', { runId })
  await run('penx1_retrieve_knowledge', { runId })
  await Promise.all([run('penx1_fetch_market_mock', { runId }), run('penx1_fetch_reviews_mock', { runId })])
  const evidenceIds = ctx.penx1Run.get(runId).evidenceIds as unknown as string[]
  const reviewEvidence = evidenceIds.filter((id) => id.startsWith('MR-'))
  const priceEvidence = evidenceIds.filter((id) => id.startsWith('MOCK-PRICE-')).sort()
  const prices = JSON.parse(readFileSync(`${DATA}/mock_prices.json`, 'utf8')).records as Array<{ competitor: string; price?: number; currency?: string; capturedAt?: string }>
  const rows = prices.map((p, i) => ({ competitor: p.competitor, price: p.price, currency: p.currency, capturedAt: p.capturedAt, evidenceId: priceEvidence[i] }))
  await run('penx1_analyze_market', { runId, rows, targetPrice: 34.95, requiredSpecs: ['亮度', '续航', '温升', '防水'], claimedSpecs: [] })
  const rawReviews = JSON.parse(readFileSync(`${DATA}/scenarios/missing-data.json`, 'utf8')).reviews as Array<{ reviewId: string; competitor: string; rating: number; language: string; originalQuote: string }>
  const mining = await run('penx1_mine_review_pains', { runId, reviews: rawReviews })
  check('missing-data 评论减少（仅 2 条）', reviewEvidence.length === 2, `MR-* = ${reviewEvidence.length}`)
  check('missing-data 痛点仍可生成（降级不中断）', !mining.isError, mining.text)
  const opportunities = [
    { opportunityId: 'OP-1', title: '电池可获得性', userProblem: '用户担心电池兼容', productResponse: '强调五种电池', commercialValue: '扩大客群', engineeringDependency: '五种电池实测矩阵', evidenceRefs: [priceEvidence[0]!, reviewEvidence[0]!] },
  ]
  const op = await run('penx1_identify_opportunities', { runId, opportunities })
  check('missing-data 机会点可生成', !op.isError, op.text)
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
  await Promise.all([run('penx1_build_swot', { runId, items: swotItems }), run('penx1_build_risk_register', { runId, risks: SAFE_RISKS().map((r) => ({ ...r, evidenceRefs: [priceEvidence[0]!] })) })])
  const claims = [
    { claimId: 'CL-01', claimType: 'market', text: '竞品价格带存在', evidenceRefs: priceEvidence.slice(0, 4), limitations: ['Mock'] },
    { claimId: 'CL-02', claimType: 'review', text: '评论样本较少，结论置信度受限', evidenceRefs: reviewEvidence.slice(0, 2), limitations: ['样本少'] },
  ]
  const val = await run('penx1_validate_evidence', { runId, claims, risks: SAFE_RISKS().map((r) => ({ ...r, evidenceRefs: [priceEvidence[0]!] })) })
  check('missing-data validate 成功', !val.isError, val.text)
  const report = await run('penx1_generate_report', {
    runId,
    executiveSummary: '数据部分缺失，结论降级；Listing NO_GO。',
    gates: { engineering: 'CONDITIONAL_GO', massProduction: 'NO_GO', listing: 'NO_GO' },
    sections: { missing: '亮度/续航/温升/防水实测缺失；评论样本仅 2 条' },
  })
  check('missing-data 报告成功', !report.isError, report.text)
  // 防幻觉：报告不得出现虚构价格/评论
  const reports = readdirSync(outDir).filter((f) => f.startsWith('PEN-X1_DSH_Report'))
  if (reports.length > 0) {
    const content = readFileSync(`${outDir}/${reports[0]}`, 'utf8')
    check('missing-data 报告不补写缺失数据（无虚构规格数字）', !/亮度\s*\d+lm/.test(content))
  }
  writeFileSync(`${outDir}/run-projection.json`, JSON.stringify(ctx.penx1Run.get(runId), null, 2))
}

async function scenarioConflict(): Promise<void> {
  const outDir = `${ART}/conflict-data`
  mkdirSync(outDir, { recursive: true })
  const ctx = await buildContext('conflict-data', outDir)
  const run = await makeRunner(ctx)
  const sessionId = 'g4-conflict'
  const runId = 'RUN-001'
  await run('penx1_start_analysis', { sessionId, product: 'PEN-X1' })
  await run('penx1_plan_tasks', { runId })
  await run('penx1_retrieve_knowledge', { runId })
  await run('penx1_fetch_market_mock', { runId })
  await run('penx1_fetch_reviews_mock', { runId })
  const conflicts = ctx.penx1Evidence.detectConflicts(runId) as unknown as Array<{ type: string; subject: string; evidenceIds: string[] }>
  const temporal = conflicts.filter((c) => c.type === 'TEMPORAL_VARIANCE')
  const hard = conflicts.filter((c) => c.type === 'HARD_CONFLICT')
  check('conflict-data 检出 TEMPORAL_VARIANCE（BrandA 双时点）', temporal.some((c) => c.subject === 'BrandA.price'), JSON.stringify(temporal))
  check('conflict-data 检出 HARD_CONFLICT（BrandB 同条件同值冲突）', hard.some((c) => c.subject === 'BrandB.price'), JSON.stringify(hard))
  check('conflict-data 双值保留（冲突不静默覆盖）', conflicts.length >= 2, `conflicts=${conflicts.length}`)
  writeFileSync(`${outDir}/conflicts.json`, JSON.stringify(conflicts, null, 2))
  writeFileSync(`${outDir}/run-projection.json`, JSON.stringify(ctx.penx1Run.get(runId), null, 2))
}

async function scenarioIllegalOrder(): Promise<void> {
  const outDir = `${ART}/illegal-order`
  mkdirSync(outDir, { recursive: true })
  const ctx = await buildContext('illegal-order', outDir)
  const run = await makeRunner(ctx)
  const sessionId = 'g4-illegal'
  const runId = 'RUN-001'
  await run('penx1_start_analysis', { sessionId, product: 'PEN-X1' })
  await run('penx1_plan_tasks', { runId })
  // 跳过知识库，直接调用市场工具 → 应被 Workflow Guard 阻断
  const blocked = await run('penx1_fetch_market_mock', { runId })
  check('illegal-order 越级调用被阻断', blocked.isError, blocked.text.slice(0, 120))
  check('illegal-order 错误码 KNOWLEDGE_RETRIEVAL_REQUIRED', blocked.text.includes('KNOWLEDGE_RETRIEVAL_REQUIRED'), blocked.text.slice(0, 160))
  check('illegal-order requiredAction 指向知识库', blocked.text.includes('penx1_retrieve_knowledge'), blocked.text.slice(0, 160))
  // 回到正确流程后应放行
  const kb = await run('penx1_retrieve_knowledge', { runId })
  check('illegal-order 纠正后知识库放行', !kb.isError, kb.text.slice(0, 100))
  const market = await run('penx1_fetch_market_mock', { runId })
  check('illegal-order 纠正后市场工具放行', !market.isError, market.text.slice(0, 100))
  writeFileSync(`${outDir}/blocked-result.json`, JSON.stringify({ blockedText: blocked.text }, null, 2))
  writeFileSync(`${outDir}/run-projection.json`, JSON.stringify(ctx.penx1Run.get(runId), null, 2))
}

async function main(): Promise<number> {
  await scenarioBaseline()
  await scenarioMissing()
  await scenarioConflict()
  await scenarioIllegalOrder()
  console.log(failures === 0 ? '[G4] 四场景全部通过' : `[G4] ${failures} 项失败`)
  return failures === 0 ? 0 : 1
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error('[G4] 验证失败：', error)
  process.exit(1)
})
