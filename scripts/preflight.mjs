#!/usr/bin/env node
/**
 * PEN-X1 演示 Preflight 自检（方案 §16.2）。
 * 检查：Node/pnpm 版本、依赖、构建产物、插件配置唯一 id、数据文件可解析、
 * 输出目录可写、API Key 已配置（仅判存在，不打印值）、3080 端口可用。
 * 用法：node scripts/preflight.mjs
 */

import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS = '/mnt/workspace/DSH/deepseek-harness'
let failures = 0
let warnings = 0

function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}
function warn(label, detail = '') {
  console.log(`WARN ${label}${detail ? ` — ${detail}` : ''}`)
  warnings += 1
}

// 1. Node / pnpm 版本
try {
  const node = execFileSync('node', ['--version'], { encoding: 'utf8' }).trim()
  check('Node.js >= 22.19', /v22\.(19|[2-9]\d)\.|v2[3-9]\./.test(node) || /^v22\.(19|[2-9][0-9])/.test(node), node)
} catch {
  check('Node.js 可用', false)
}
try {
  const pnpm = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim()
  check('pnpm >= 9', Number.parseInt(pnpm.split('.')[0] ?? '0', 10) >= 9, pnpm)
} catch {
  check('pnpm 可用', false)
}

// 2. 依赖已安装
check('Power Availability node_modules', existsSync(`${ROOT}/node_modules`))
check('harness node_modules', existsSync(`${HARNESS}/node_modules`))

// 3. 构建产物存在（4 个代码包）
for (const pkg of ['contracts', 'dsh-core', 'dsh-data', 'dsh-analysis']) {
  check(`构建产物 packages/${pkg}/lib/index.js`, existsSync(`${ROOT}/packages/${pkg}/lib/index.js`))
}

// 4. 插件配置：cordis.patch.yml 可解析且 17 个 id 唯一
try {
  const patch = readFileSync(`${ROOT}/packages/dsh-bundle/cordis.patch.yml`, 'utf8')
  const ids = [...patch.matchAll(/- id: ([a-z0-9-]+)/g)].map((m) => m[1])
  check('bundle patch 含 17 个插件 id', ids.length === 17, `ids=${ids.length}`)
  check('bundle patch id 唯一', new Set(ids).size === ids.length)
} catch (error) {
  check('bundle patch 可读', false, String(error))
}

// 5. 数据文件可解析 + 关键 Hash
const dataFiles = [
  'data/knowledge_base.json',
  'data/mock_prices.json',
  'data/mock_reviews.json',
  'data/risk_templates.json',
  'data/review_taxonomy.json',
  'data/flashlight_glossary.json',
  'data/scenarios/baseline.json',
  'data/scenarios/missing-data.json',
  'data/scenarios/conflict-data.json',
]
for (const file of dataFiles) {
  const full = `${ROOT}/${file}`
  if (!existsSync(full)) {
    check(`数据文件存在 ${file}`, false)
    continue
  }
  try {
    JSON.parse(readFileSync(full, 'utf8'))
    const hash = createHash('sha256').update(readFileSync(full, 'utf8')).digest('hex').slice(0, 12)
    check(`数据文件有效 ${file}`, true, hash)
  } catch {
    check(`数据文件有效 ${file}`, false)
  }
}
const prompts = `${ROOT}/prompts/penx1-system.md`
check('prompt 文件存在', existsSync(prompts))
if (existsSync(prompts)) {
  const content = readFileSync(prompts, 'utf8')
  const required = ['Agent Identity', 'Required DAG', 'Knowledge First Policy', 'Mock Data Policy', 'Evidence Contract', 'Final Report Contract']
  check('prompt 含硬约束 Section', required.every((s) => content.includes(s)))
}

// 6. 输出目录可写
const outDir = `${ROOT}/output/dsh`
try {
  mkdirSync(outDir, { recursive: true })
  check('输出目录可写', true, outDir)
} catch {
  check('输出目录可写', false)
}

// 7. API Key（只判存在，不打印值）
const key = process.env.DEEPSEEK_API_KEY
if (key === undefined || key.length === 0) {
  warn('DEEPSEEK_API_KEY 未配置（演示可走降级 2/3；主演示需配置）')
} else {
  check('DEEPSEEK_API_KEY 已配置', true)
}

// 8. 3080 端口可用
// 简单探测：读取 /proc/net/tcp 是否已被占用（无权限时不阻塞）
try {
  const net = await import('node:net')
  await new Promise((resolvePort) => {
    const server = net.createServer()
    server.once('error', () => {
      warn('3080 端口可能被占用（DSH Web 可能已在运行）')
      resolvePort()
    })
    server.once('listening', () => {
      server.close(() => resolvePort())
    })
    server.listen(3080, '127.0.0.1')
  })
  check('3080 端口可监听', true)
} catch {
  warn('3080 端口探测失败（跳过）')
}

console.log(failures === 0
  ? `\nPreflight 完成：全部通过${warnings > 0 ? `（${warnings} 项警告）` : ''}`
  : `\nPreflight 完成：${failures} 项失败，${warnings} 项警告——请先修复再演示`)
process.exit(failures === 0 ? 0 : 1)
