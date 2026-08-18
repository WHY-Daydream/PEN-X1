#!/usr/bin/env node
/**
 * PEN-X1 演示启动脚本：DSH Web + 17 插件（方案 §16.1 / §17.1）。
 * 用法：node scripts/run-web-demo.mjs [--port 3080]
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS = '/mnt/workspace/DSH/deepseek-harness'
const PATCH = `${ROOT}/packages/dsh-bundle/cordis.patch.dev.yml`

const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const port = portIndex >= 0 && args[portIndex + 1] ? args[portIndex + 1] : '3080'

console.log(`[run-web-demo] DSH Web（端口 ${port}）`)
console.log(`[run-web-demo] patch: ${PATCH}`)
console.log(`[run-web-demo] 浏览器打开 http://127.0.0.1:${port}`)

const child = spawn('pnpm', ['dsh', 'web', '--patch', PATCH, '--port', port], {
  cwd: HARNESS,
  stdio: 'inherit',
  env: { ...process.env },
})

child.on('exit', (code) => {
  console.log(`[run-web-demo] 进程退出 code=${code}`)
  process.exit(code ?? 0)
})
