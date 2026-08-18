#!/usr/bin/env node
/**
 * PEN-X1 headless E2E 启动脚本（方案 §16.1）：运行一次无模型回归与一次真实链路。
 * 无模型回归不需要 API Key；真实链路需要 DEEPSEEK_API_KEY。
 * 用法：node scripts/run-headless-e2e.mjs            # 无模型回归（verify-g2/g4）
 *       node scripts/run-headless-e2e.mjs --live     # 真实 DeepSeek 单次任务
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS = '/mnt/workspace/DSH/deepseek-harness'
const PATCH = `${ROOT}/packages/dsh-bundle/cordis.patch.dev.yml`
const TASK = '分析 PEN-X1 在北美 Amazon 市场的产品机会，并给出是否进入工程开发、量产和上市的建议。必须先检索知识库，明确标注所有 Mock 数据，并输出完整 Markdown 报告。'

const mode = process.argv.includes('--live') ? 'live' : 'offline'

if (mode === 'offline') {
  console.log('[run-headless-e2e] 无模型确定性回归（verify-g2 + verify-g4）')
  for (const script of ['verify-g2.mts', 'verify-g4.mts']) {
    const result = spawnSync('node', ['--import', 'tsx/esm', `${ROOT}/scripts/${script}`], {
      cwd: HARNESS,
      stdio: 'inherit',
    })
    if (result.status !== 0) {
      console.error(`[run-headless-e2e] ${script} 失败（code=${result.status}）`)
      process.exit(result.status ?? 1)
    }
  }
  console.log('[run-headless-e2e] 无模型回归全部通过')
} else {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('[run-headless-e2e] --live 需要 DEEPSEEK_API_KEY（DSH Credential 或环境变量）')
    process.exit(2)
  }
  console.log('[run-headless-e2e] 真实 DeepSeek 链路（headless 单次任务）')
  const result = spawnSync('pnpm', ['dsh', '--profile', 'headless', '--patch', PATCH, TASK], {
    cwd: HARNESS,
    stdio: 'inherit',
    env: { ...process.env },
  })
  process.exit(result.status ?? 0)
}
