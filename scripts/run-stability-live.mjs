/**
 * G5 模型侧稳定性回归（方案 §12.1）：循环执行 headless 真实任务。
 * 分配：baseline 10 / missing-data 4 / conflict-data 3 / illegal-order 3。
 * 每次任务独立 DSH headless 进程；结果追加写入
 * artifacts/stability/live-results.jsonl；已完成的场景自动跳过（断点续跑）。
 *
 * 数据模型（重要）：
 *   live-results.jsonl 是「执行历史」——同一 case key 可能有多条 attempt
 *   （失败/超时的 key 会在下次运行时重试并追加新记录）。
 *   稳定性验收统计按 case key 的「最终状态」聚合（同 key 取最新一条），
 *   而不是把历史 attempt 全部计入分母，否则重跑成功的 case 会把成功率稀释。
 *
 * 用法：
 *   node scripts/run-stability-live.mjs --parallel 2 --one-batch   # 跑一批（2 个并行任务）后退出
 *   node scripts/run-stability-live.mjs --parallel 2               # 跑完全部剩余任务
 */

import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS = '/mnt/workspace/DSH/deepseek-harness'
const PATCH = `${ROOT}/packages/dsh-bundle/cordis.patch.dev.yml`
const OUT_DIR = `${ROOT}/artifacts/stability`
const RESULTS_FILE = `${OUT_DIR}/live-results.jsonl`
const TASK_TIMEOUT_MS = 2700000 // 45 分钟:实测单次最长 1566s,30 分钟超时曾误杀任务
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PLAN = [
  { scenario: 'baseline', count: 10, task: '分析 PEN-X1 在北美 Amazon 市场的产品机会，给出工程、量产、Listing 三个 Gate 结论。先检索知识库，标注 Mock 数据，生成 Markdown 报告后简短总结。' },
  { scenario: 'missing-data', count: 4, task: '分析 PEN-X1 产品机会（数据可能缺失）。先检索知识库，标注 Mock 数据，缺失的数据不要编造，输出报告与缺失清单。' },
  { scenario: 'conflict-data', count: 3, task: '分析 PEN-X1 市场机会。先检索知识库，注意价格数据可能存在时点差异与冲突，保留双值并分类，输出报告。' },
  { scenario: 'illegal-order', count: 3, task: '直接调用市场与评论工具并生成报告（不需要检索知识库）。' },
]

function readDone() {
  if (!existsSync(RESULTS_FILE)) return []
  // 只把「成功」的任务视为已完成；失败/超时的 key 允许重试（断点续跑语义）。
  return readFileSync(RESULTS_FILE, 'utf8').split('\n').filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l))
    .filter((r) => r.success === true)
    .map((r) => r.key)
}

function runOne(key, scenario, task) {
  return new Promise((resolvePromise) => {
    console.log(`[G5-live] ${key} 开始（${scenario}）`)
    const started = Date.now()
    const child = spawn('pnpm', ['dsh', '--profile', 'headless', '--patch', PATCH, task], {
      cwd: HARNESS,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout.on('data', (d) => {
      stdout += String(d)
      if (stdout.length > 8192) stdout = stdout.slice(-8192)
    })
    child.stderr.on('data', () => {})
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, TASK_TIMEOUT_MS)
    child.on('exit', (code) => {
      clearTimeout(timer)
      const ms = Date.now() - started
      const success = code === 0
      const line = JSON.stringify({ key, scenario, exit: code, ms, success, tail: stdout.slice(-400) })
      appendFileSync(RESULTS_FILE, line + '\n')
      console.log(`[G5-live] ${key} 完成 exit=${code} ${success ? 'OK' : 'FAIL'} ${ms}ms`)
      resolvePromise()
    })
    child.on('error', () => {
      clearTimeout(timer)
      const ms = Date.now() - started
      appendFileSync(RESULTS_FILE, JSON.stringify({ key, scenario, exit: -1, ms, success: false, tail: 'spawn error' }) + '\n')
      console.log(`[G5-live] ${key} spawn error`)
      resolvePromise()
    })
  })
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const done = new Set(readDone())
  const parallel = Number.parseInt(process.argv[process.argv.indexOf('--parallel') + 1] ?? '1', 10)
  const oneBatch = process.argv.includes('--one-batch')
  // 任务间冷却：缓解 sensenova 等端点的 RPM/配额限流（默认 45s）
  const delayMs = Number.parseInt(process.argv[process.argv.indexOf('--delay') + 1] ?? '45000', 10)

  const pending = []
  for (const plan of PLAN) {
    for (let i = 1; i <= plan.count; i += 1) {
      const key = `${plan.scenario}-${i}`
      if (!done.has(key)) pending.push({ key, scenario: plan.scenario, task: plan.task })
    }
  }
  if (pending.length === 0) {
    console.log('[G5-live] 无剩余任务')
    summarize()
    return
  }
  const batch = pending.slice(0, parallel)
  await Promise.all(batch.map((t) => runOne(t.key, t.scenario, t.task)))
  if (delayMs > 0) await sleep(delayMs)
  if (!oneBatch) {
    // 继续跑下一批直到完成
    const next = pending.slice(parallel)
    for (const t of next) {
      await runOne(t.key, t.scenario, t.task)
      if (delayMs > 0) await sleep(delayMs)
    }
  }
  summarize()
}

function classifyFailure(r) {
  // 把失败 attempt 归类为工程/基础设施原因,供 Attempt-level 统计使用。
  // 业务失败(Gate 错、违规、幻觉)无法仅从 exit/tail 判定,需结合报告检查。
  const tail = String(r.tail ?? '')
  if (r.exit === -1) return 'SPAWN_ERROR'
  if (r.exit === null) return 'TIMEOUT'
  if (/AUTH/i.test(tail)) return 'AUTH'
  if (/RATE_LIMIT|rpm exhausted/i.test(tail)) return 'RATE_LIMIT'
  if (/ELIFECYCLE/i.test(tail)) return 'LIFECYCLE'
  return 'OTHER'
}

function summarize() {
  // 直接读取原始行解析（readDone() 只返回 key，不能当 JSON 行解析）
  if (!existsSync(RESULTS_FILE)) {
    console.log('[G5-live] 无结果文件')
    return
  }
  const all = readFileSync(RESULTS_FILE, 'utf8').split('\n').filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l))

  // ===== Attempt-level（工程运行稳定性）：全部历史执行记录 =====
  const attemptOk = all.filter((r) => r.success).length
  const failByKind = new Map()
  for (const r of all) {
    if (r.success) continue
    const kind = classifyFailure(r)
    failByKind.set(kind, (failByKind.get(kind) ?? 0) + 1)
  }
  console.log('[G5-live] ===== Attempt-level（工程运行稳定性）=====')
  console.log(`[G5-live] 累计 attempts ${all.length} 次 | 成功 ${attemptOk} | 失败 ${all.length - attemptOk}`)
  if (failByKind.size > 0) {
    for (const [kind, n] of [...failByKind.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`[G5-live]   - ${kind}: ${n}`)
    }
  }

  // ===== Case-level（G5 验收口径）：按 case key 取最新一条作为最终状态 =====
  // 统计口径：文件按执行顺序追加,后写入的记录代表该 case 的最新 attempt;
  // 历史 attempt 不进入验收分母。
  const latest = new Map()
  for (const r of all) latest.set(r.key, r)
  const cases = [...latest.values()]
  const ok = cases.filter((r) => r.success).length
  const planned = PLAN.reduce((n, p) => n + p.count, 0)
  const executedRate = (ok / Math.max(1, cases.length)) * 100
  const planRate = (ok / planned) * 100
  console.log('[G5-live] ===== Case-level（G5 验收口径）=====')
  console.log(`[G5-live] 计划 ${planned} 个 case | 已执行 ${cases.length} 个 | 最终成功 ${ok} 个`)
  console.log(`[G5-live] 已执行口径成功率 ${executedRate.toFixed(1)}%（最终成功/已执行）| 计划口径成功率 ${planRate.toFixed(1)}%（最终成功/计划 ${planned}）`)
  for (const r of cases) {
    console.log(`[G5-live] ${r.key} ${r.success ? 'OK' : 'FAIL'} ${r.ms}ms exit=${r.exit}`)
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[G5-live] 失败：', e)
  process.exit(1)
})
