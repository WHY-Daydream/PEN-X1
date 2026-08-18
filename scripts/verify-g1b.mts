/**
 * G1-B 验证脚本：在真实 DSH 依赖（cordis + dsh-tools link）下按挂载顺序
 * 加载 17 个 PEN-X1 插件，检查 ctx.tools 注册表：13 个工具、无重复、Schema 可查。
 * 运行：cd harness && node --import tsx/esm <本文件>
 */

import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

const ROOT = '/mnt/workspace/DSH/Power Availability/packages'
const DATA = '/mnt/workspace/DSH/Power Availability/data'
const PROMPTS = '/mnt/workspace/DSH/Power Availability/prompts'
const OUT = '/mnt/workspace/DSH/Power Availability/output/dsh'

const EXPECTED_TOOLS = [
  'penx1_start_analysis',
  'penx1_get_status',
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
]

const ENTRIES: Array<[string, Record<string, unknown>]> = [
  ['dsh-core/src/run-state.ts', {}],
  ['dsh-core/src/evidence-guard.ts', {}],
  ['dsh-core/src/policy.ts', { promptFile: `${PROMPTS}/penx1-system.md` }],
  ['dsh-core/src/task-planner.ts', {}],
  ['dsh-data/src/knowledge.ts', { knowledgeFile: `${DATA}/knowledge_base.json`, dataRoot: DATA }],
  ['dsh-data/src/market-source-mock.ts', { dataFile: `${DATA}/mock_prices.json`, dataRoot: DATA, latencyMs: 0 }],
  ['dsh-data/src/market-tool.ts', {}],
  ['dsh-data/src/review-source-mock.ts', { dataFile: `${DATA}/mock_reviews.json`, dataRoot: DATA, latencyMs: 0 }],
  ['dsh-data/src/review-tool.ts', {}],
  ['dsh-analysis/src/market-analysis.ts', {}],
  ['dsh-analysis/src/review-mining.ts', {}],
  ['dsh-analysis/src/opportunity.ts', {}],
  ['dsh-analysis/src/swot.ts', {}],
  ['dsh-analysis/src/risk.ts', {}],
  ['dsh-analysis/src/report.ts', { outputDir: OUT }],
  ['dsh-core/src/workflow-guard.ts', {}],
  ['dsh-core/src/trace.ts', {}],
]

async function main(): Promise<number> {
  const ctx = new Context()
  // 先提供 DSH 依赖服务：SystemPrompt（ToolRuntime 构造依赖）→ tools
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx)

  const loaded: string[] = []
  for (const [rel, config] of ENTRIES) {
    const mod = await import(`file://${ROOT}/${rel}`)
    mod.apply(ctx, config)
    loaded.push(rel)
  }
  console.log(`[G1-B] 已加载插件：${loaded.length}/17`)
  console.log(`[G1-B] 插件列表：\n  ${loaded.join('\n  ')}`)

  // 枚举 ctx.tools 注册表（schemas() 返回 ToolSchema 数组，元素含 name）
  const tools = ctx.tools as unknown as { schemas?: () => unknown; get?: (name: string) => unknown }
  let registered: string[] = []
  if (typeof tools.schemas === 'function') {
    const schemas = tools.schemas() as Array<{ name?: string }>
    registered = schemas.map((entry) => entry.name ?? '').filter(Boolean)
  } else if (typeof tools.get === 'function') {
    registered = EXPECTED_TOOLS.filter((name) => {
      try {
        return tools.get!(name) !== undefined
      } catch {
        return false
      }
    })
  }
  console.log(`[G1-B] 注册表工具数：${registered.length}`)
  console.log(`[G1-B] 注册工具：${registered.sort().join(', ')}`)

  const unique = new Set(registered)
  const missing = EXPECTED_TOOLS.filter((name) => !unique.has(name))
  const duplicates = registered.length - unique.size
  const schemaCheck = typeof tools.schemas === 'function'
    ? EXPECTED_TOOLS.every((name) => registered.includes(name))
    : missing.length === 0

  console.log(`[G1-B] 缺失工具：${missing.length > 0 ? missing.join(', ') : '无'}`)
  console.log(`[G1-B] 重复注册：${duplicates}`)
  console.log(`[G1-B] 13 工具齐备且无重复：${schemaCheck && duplicates === 0 && missing.length === 0 ? 'PASS' : 'FAIL'}`)

  // 重复注册防护验证：对同一工具名再次 register 应被拒绝或覆盖，不产生第二条
  if (typeof tools.schemas === 'function') {
    const before = (tools.schemas() as Array<{ name?: string }>).length
    const toolsAny = ctx.tools as unknown as { register: (tool: { name: string }) => void }
    try {
      toolsAny.register({ name: 'penx1_start_analysis' })
    } catch {
      // 期望：拒绝重复注册（或静默覆盖）——记录但不失败
      console.log('[G1-B] 重复注册被拒绝（register 抛错）')
    }
    const after = (tools.schemas() as Array<{ name?: string }>).length
    console.log(`[G1-B] 重复注册后工具数：${before} -> ${after}（无新增 = 防重复有效）`)
  }

  return schemaCheck && duplicates === 0 && missing.length === 0 ? 0 : 1
}

main().then((code) => {
  process.exit(code)
}).catch((error) => {
  console.error('[G1-B] 验证失败：', error)
  process.exit(1)
})
