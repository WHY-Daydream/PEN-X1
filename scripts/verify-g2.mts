/**
 * G2 验证脚本：无模型确定性 Composition 全链路（方案 §8）。
 * 在真实 DSH 依赖下加载 17 插件，按 baseline 顺序驱动 13 个工具，
 * 校验：统一 Envelope、Artifact Flag、Evidence 登记、Mock 四层标记、
 * 报告 12 节 + 原子写入 + SHA-256、Session 重放一致。
 * 运行：cd harness && node --import tsx/esm <本文件>
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

const ROOT = '/mnt/workspace/DSH/Power Availability/packages'
const DATA = '/mnt/workspace/DSH/Power Availability/data'
const OUT = '/mnt/workspace/DSH/Power Availability/output/dsh'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`[G2] ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

const ENTRIES: Array<[string, Record<string, unknown>]> = [
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
  ['dsh-analysis/src/report.ts', { outputDir: OUT, fileNamePattern: 'PEN-X1_DSH_Report_{runId}.md', includeEvidenceLedger: true, includeRunTrace: true, overwrite: false }],
  ['dsh-core/src/workflow-guard.ts', { maxSteps: 18, maxRetriesPerTool: 2, allowParallelDataTools: true, allowParallelFinalAnalyses: true, blockUnknownTools: true, continueOnNonCriticalSourceMissing: true }],
  ['dsh-core/src/trace.ts', { verbosity: 'concise', emitProgressCards: true, includePayloads: false, includeTimings: true }],
]

async function main(): Promise<number> {
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx)
  for (const [rel, config] of ENTRIES) {
    const mod = await import(`file://${ROOT}/${rel}`)
    mod.apply(ctx, config)
  }

  const tools = ctx.tools as unknown as { execute: (exec: { name: string; arguments: unknown; signal: AbortSignal }) => Promise<{ isError?: boolean; content?: Array<{ type: string; text?: string }>; error?: { message?: string } }> }
  const run = async (name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> => {
    const result = await tools.execute({ name, arguments: args, signal: new AbortController().signal })
    const text = (result.content ?? []).map((c) => c.text ?? '').join('\n')
    if (result.isError) check(`${name} 执行成功`, false, result.error?.message ?? text.slice(0, 120))
    return { isError: result.isError === true, text }
  }

  const sessionId = 'g2-baseline-session'
  const runId = 'RUN-001'

  // 1. 启动 Run
  const start = await run('penx1_start_analysis', { sessionId, product: 'PEN-X1', market: 'North America Amazon', language: 'zh-CN' })
  check('1 penx1_start_analysis 成功', !start.isError, start.text)

  // 2. 任务拆解（固定 DAG）
  const plan = await run('penx1_plan_tasks', { runId })
  check('2 penx1_plan_tasks 成功', !plan.isError, plan.text)

  // 3. 知识库检索（必须先于外部工具）
  const kb = await run('penx1_retrieve_knowledge', { runId })
  check('3 penx1_retrieve_knowledge 成功', !kb.isError, kb.text)

  // 4/5. 两个外部 Mock 工具（并行）
  const [market, reviews] = await Promise.all([
    run('penx1_fetch_market_mock', { runId }),
    run('penx1_fetch_reviews_mock', { runId }),
  ])
  check('4 penx1_fetch_market_mock 成功', !market.isError, market.text)
  check('5 penx1_fetch_reviews_mock 成功', !reviews.isError, reviews.text)

  const projection = ctx.penx1Run.get(runId) as unknown as {
    completed: Record<string, boolean>
    evidenceIds: string[]
    artifactIds: string[]
    phase: string
    warnings: string[]
  }
  check('知识库先于外部工具（knowledgeReady 已置位）', projection.completed.knowledgeReady === true)
  check('外部数据就绪 flag', projection.completed.marketDataReady === true && projection.completed.reviewDataReady === true)
  const kbEvidence = projection.evidenceIds.filter((id) => id.startsWith('KB-'))
  const priceEvidence = projection.evidenceIds.filter((id) => id.startsWith('MOCK-PRICE-'))
  const reviewEvidence = projection.evidenceIds.filter((id) => id.startsWith('MR-'))
  check('知识库证据登记', kbEvidence.length >= 4, `KB-* = ${kbEvidence.length}`)
  check('价格证据登记', priceEvidence.length === 4, `MOCK-PRICE-* = ${priceEvidence.length}`)
  check('评论证据登记', reviewEvidence.length === 12, `MR-* = ${reviewEvidence.length}`)

  // 6. 市场分析（确定性：价格排序、区间、缺口）
  const prices = JSON.parse(readFileSync(`${DATA}/mock_prices.json`, 'utf8')).records as Array<{ competitor: string; price?: number; currency?: string; capturedAt?: string; promotion?: string }>
  const rows = prices.map((p, i) => ({ competitor: p.competitor, price: p.price, currency: p.currency, capturedAt: p.capturedAt, evidenceId: priceEvidence[i] }))
  const ma = await run('penx1_analyze_market', { runId, rows, targetPrice: 34.95, requiredSpecs: ['亮度', '续航', '温升', '防水'], claimedSpecs: ['长度', '重量'] })
  check('6 penx1_analyze_market 成功', !ma.isError, ma.text)

  // 7. 评论痛点（英文原句回链）
  const rawReviews = JSON.parse(readFileSync(`${DATA}/mock_reviews.json`, 'utf8')).reviews as Array<{ reviewId: string; competitor: string; rating: number; language: string; originalQuote: string }>
  const rm = await run('penx1_mine_review_pains', { runId, reviews: rawReviews })
  check('7 penx1_mine_review_pains 成功', !rm.isError, rm.text)

  // 8. 机会点（跨域证据：市场 + 评论）
  const opportunities = [
    { opportunityId: 'OP-1', title: '电池可获得性', userProblem: '用户担心电池兼容与采购', productResponse: '强调五种电池且单节可用', commercialValue: '扩大入门客群', engineeringDependency: '完成五种电池实测矩阵', evidenceRefs: [priceEvidence[0]!, reviewEvidence[0]!] },
    { opportunityId: 'OP-2', title: '$34.95 中间价格带', userProblem: '用户价格敏感', productResponse: '锚定中间价格带', commercialValue: '避免价格战', engineeringDependency: 'BOM 成本核算', evidenceRefs: [priceEvidence[1]!, reviewEvidence[3]!] },
    { opportunityId: 'OP-3', title: '开关手感与档位逻辑', userProblem: '开关过硬/误触抱怨集中', productResponse: '优化开关力值与防误触', commercialValue: '降低退货率', engineeringDependency: '开关力值规格与寿命测试', evidenceRefs: [reviewEvidence[0]!, priceEvidence[1]!] },
    { opportunityId: 'OP-4', title: '五种电池性能差异透明化', userProblem: '不同电池档位性能不透明', productResponse: 'Listing 披露实测矩阵', commercialValue: '减少差评', engineeringDependency: '五种电池实测数据', evidenceRefs: [reviewEvidence[7]!, priceEvidence[2]!] },
  ]
  const op = await run('penx1_identify_opportunities', { runId, opportunities })
  check('8 penx1_identify_opportunities 成功', !op.isError, op.text)

  // 9/10. SWOT 与风险（并行）
  const swotItems = [
    { quadrant: 'strengths', statement: 'PEN-X1 支持五种电池供电', evidenceRefs: [kbEvidence[0]!], limitations: [] },
    { quadrant: 'strengths', statement: 'PEN-X1 目标价锚定中间价格带', evidenceRefs: [priceEvidence[1]!], limitations: [] },
    { quadrant: 'weaknesses', statement: 'PEN-X1 亮度续航实测数据缺失', evidenceRefs: [kbEvidence[0]!], limitations: [] },
    { quadrant: 'weaknesses', statement: 'PEN-X1 温升与防水尚未验证', evidenceRefs: [kbEvidence[0]!], limitations: [] },
    { quadrant: 'opportunities', statement: '北美市场用户关注电池可获得性', evidenceRefs: [reviewEvidence[7]!], limitations: [] },
    { quadrant: 'opportunities', statement: 'Amazon 竞品价格带存在空间', evidenceRefs: [priceEvidence[2]!], limitations: [] },
    { quadrant: 'threats', statement: '竞品价格促销挤压利润', evidenceRefs: [priceEvidence[3]!], limitations: [] },
    { quadrant: 'threats', statement: 'Listing 关键规格缺失影响可审计性', evidenceRefs: [kbEvidence[0]!], limitations: [] },
  ]
  const riskTemplates = (JSON.parse(readFileSync(`${DATA}/risk_templates.json`, 'utf8')).templates as Array<Record<string, unknown>>)
  const risks = riskTemplates.map((t, i) => ({ ...t, riskId: `R-${String(i + 1).padStart(2, '0')}`, evidenceRefs: [kbEvidence[0]!, priceEvidence[i % 4]!] }))
  const [swot, risk] = await Promise.all([
    run('penx1_build_swot', { runId, items: swotItems }),
    run('penx1_build_risk_register', { runId, risks }),
  ])
  check('9 penx1_build_swot 成功', !swot.isError, swot.text)
  check('10 penx1_build_risk_register 成功', !risk.isError, risk.text)

  // 11. Evidence Guard 校验（Claim 覆盖 + 风险门禁）
  const claims = [
    { claimId: 'CL-01', claimType: 'market', text: '竞品价格带约 $29.99–$49.99', evidenceRefs: priceEvidence.slice(0, 4), limitations: ['Mock 时点数据'] },
    { claimId: 'CL-02', claimType: 'review', text: '开关手感与误触是高频痛点', evidenceRefs: [reviewEvidence[0]!, reviewEvidence[4]!], limitations: ['关键词匹配'] },
    { claimId: 'CL-03', claimType: 'market', text: 'PEN-X1 目标价 $34.95 位于区间内', evidenceRefs: [priceEvidence[1]!], limitations: ['需实测支撑'] },
    { claimId: 'CL-04', claimType: 'review', text: '电池兼容性表述被用户质疑', evidenceRefs: [reviewEvidence[7]!], limitations: ['单条评论'] },
  ]
  const validate = await run('penx1_validate_evidence', { runId, claims, risks })
  check('11 penx1_validate_evidence 成功', !validate.isError, validate.text)

  // 12. 报告生成（12 节 + Gate + SHA-256）
  const report = await run('penx1_generate_report', {
    runId,
    executiveSummary: '市场机会存在；工程 CONDITIONAL_GO；量产与 Listing NO_GO。',
    gates: { engineering: 'CONDITIONAL_GO', massProduction: 'NO_GO', listing: 'NO_GO' },
    sections: {
      knowledge: '知识库 9 条命中',
      market: '竞品价格带 $29.99–$49.99',
      reviews: '12 条英文评论',
      opportunities: '4 项机会点',
      swot: '8 项证据化 SWOT',
      risks: '14 项风险',
      missing: '亮度/续航/温升/防水实测缺失',
    },
  })
  check('12 penx1_generate_report 成功', !report.isError, report.text)

  // 13. 状态查询
  const status = await run('penx1_get_status', { runId })
  check('13 penx1_get_status 成功', !status.isError, status.text)

  // ==== 终态校验 ====
  const final = ctx.penx1Run.get(runId) as unknown as {
    phase: string
    completed: Record<string, boolean>
    artifactIds: string[]
    evidenceIds: string[]
    warnings: string[]
  }
  check('终态 phase = REPORT_READY', final.phase === 'REPORT_READY', final.phase)
  const flags = ['runStarted', 'planReady', 'knowledgeReady', 'marketDataReady', 'reviewDataReady', 'marketAnalysisReady', 'reviewMiningReady', 'opportunitiesReady', 'swotReady', 'riskReady', 'validationPassed', 'reportReady']
  const missingFlags = flags.filter((f) => final.completed[f] !== true)
  check('12 个 Artifact Flag 全部置位', missingFlags.length === 0, missingFlags.length > 0 ? missingFlags.join(',') : '')

  // Mock 四层标记：数据源标签
  const evidenceAny = ctx.penx1Evidence.getEvidence(runId, priceEvidence[0]!) as unknown as { sourceLabel?: string; sourceType?: string }
  check('价格证据 DEMO_MOCK + 【演示Mock数据】', evidenceAny.sourceType === 'DEMO_MOCK' && (evidenceAny.sourceLabel ?? '').includes('【演示Mock数据】'))
  const reviewAny = ctx.penx1Evidence.getEvidence(runId, reviewEvidence[0]!) as unknown as { sourceLabel?: string; sourceType?: string }
  check('评论证据 DEMO_MOCK + 【演示Mock数据】', reviewAny.sourceType === 'DEMO_MOCK' && (reviewAny.sourceLabel ?? '').includes('【演示Mock数据】'))

  // 报告文件：12 节 + SHA-256 + 原子写入
  const reportFiles = readdirSync(OUT).filter((f) => f.startsWith('PEN-X1_DSH_Report_RUN-001'))
  check('报告文件已生成', reportFiles.length >= 1, reportFiles.join(','))
  if (reportFiles.length > 0) {
    const reportPath = `${OUT}/${reportFiles[0]}`
    const content = readFileSync(reportPath, 'utf8')
    const hash = createHash('sha256').update(content).digest('hex')
    const sections = ['1. 执行摘要与 Gate', '2. 任务拆解', '3. 数据范围和 Mock 声明', '4. 知识库检索结果', '5. 市场与竞品分析', '6. 英文评论痛点', '7. 产品机会', '8. 证据化 SWOT', '9. 全生命周期风险', '10. Evidence Audit', '11. 缺失数据和验证任务', '12. 数据来源账本']
    const missingSections = sections.filter((s) => !content.includes(s))
    check('报告包含 12 个固定章节', missingSections.length === 0, missingSections.length > 0 ? missingSections.join(';') : '')
    check('报告含【演示Mock数据】声明', content.includes('【演示Mock数据】'))
    check('报告含三 Gate 结论', content.includes('| 工程开发 | CONDITIONAL_GO |') && content.includes('| 量产 | NO_GO |') && content.includes('| 北美 Listing | NO_GO |'))
    const shaMatch = /SHA-256: ([0-9a-f]{64})/.exec(report.text)
    check('报告 SHA-256 与文件一致', shaMatch !== null && shaMatch[1] === hash, shaMatch ? `文件=${hash.slice(0, 12)} 返回=${shaMatch[1].slice(0, 12)}` : '')
    check('无半份报告残留（原子写入）', !existsSync(`${reportPath}.tmp`))
  }

  // Session 重放一致
  const replay = await ctx.penx1Run.replay(sessionId) as unknown as Array<{ runId: string; phase: string; completed: Record<string, boolean>; evidenceIds: string[]; artifactIds: string[] }>
  check('重放得到 1 个 Run', replay.length === 1)
  const replayed = replay[0]
  check('重放 phase 一致', replayed !== undefined && replayed.phase === final.phase)
  check('重放 flags 一致', replayed !== undefined && flags.every((f) => replayed.completed[f] === true))
  check('重放 evidence 数量一致', replayed !== undefined && replayed.evidenceIds.length === final.evidenceIds.length, `replay=${replayed?.evidenceIds.length} live=${final.evidenceIds.length}`)
  check('重放 artifact 数量一致', replayed !== undefined && replayed.artifactIds.length === final.artifactIds.length, `replay=${replayed?.artifactIds.length} live=${final.artifactIds.length}`)

  console.log(failures === 0 ? '[G2] 全部通过' : `[G2] ${failures} 项失败`)
  return failures === 0 ? 0 : 1
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error('[G2] 验证失败：', error)
  process.exit(1)
})
