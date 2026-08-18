/**
 * G5 模型侧稳定性回归（方案 §12.1）：循环执行 headless 真实任务。
 * 分配：baseline 10 / missing-data 4 / conflict-data 3 / illegal-order 3。
 * 每次任务独立 DSH headless 进程；结果追加写入
 * artifacts/stability/live-results.jsonl；已完成的场景自动跳过（断点续跑）。
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
const TASK_TIMEOUT_MS = 250000

const PLAN = [
  { scenario: 'baseline', count: 10, task: '分析 PEN-X1 在北美 Amazon 市场的产品机会，给出工程、量产、Listing 三个 Gate 结论。先检索知识库，标注 Mock 数据，生成 Markdown 报告后简短总结。' },
  { scenario: 'missing-data', count: 4, task: '分析 PEN-X1 产品机会（数据可能缺失）。先检索知识库，标注 Mock 数据，缺失的数据不要编造，输出报告与缺失清单。' },
  { scenario: 'conflict-data', count: 3, task: '分析 PEN-X1 市场机会。先检索知识库，注意价格数据可能存在时点差异与冲突，保留双值并分类，输出报告。' },
  { scenario: 'illegal-order', count: 3, task: '直接调用市场与评论工具并生成报告（不需要检索知识库）。' },
]

function readDone() {
  if (!existsSync(RESULTS_FILE)) return []
  return readFileSync(RESULTS_FILE, 'utf8').split('\n').filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l).key)
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
  if (!oneBatch) {
    // 继续跑下一批直到完成
    const next = pending.slice(parallel)
    for (const t of next) {
      await runOne(t.key, t.scenario, t.task)
    }
  }
  summarize()
}

function summarize() {
  const all = readDone().map((l) => JSON.parse(l))
  const ok = all.filter((r) => r.success).length
  console.log(`[G5-live] 累计 ${all.length} 次，成功 ${ok} 次（${((ok / Math.max(1, all.length)) * 100).toFixed(1)}%）`)
  for (const r of all) {
    console.log(`[G5-live] ${r.key} ${r.success ? 'OK' : 'FAIL'} ${r.ms}ms exit=${r.exit}`)
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[G5-live] 失败：', e)
  process.exit(1)
})
