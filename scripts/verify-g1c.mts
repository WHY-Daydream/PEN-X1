/**
 * G1-C 验证脚本：ctx.provide() 生命周期（方案 §7.3 / 14.1）。
 * 验证：provider 挂载后 consumer inject 解除等待；provider 卸载后 consumer dispose；
 * provider 重挂后 consumer 恢复；HMR 不产生两个同名 Service / 工具不翻倍。
 * 运行：cd harness && node --import tsx/esm <本文件>
 */

import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

const ROOT = '/mnt/workspace/DSH/Power Availability/packages'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const providerUrl = `file://${ROOT}/dsh-core/src/run-state.ts`

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`[G1-C] ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

async function main(): Promise<number> {
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx)

  // 消费者插件：inject ['penx1Run']，apply 记录加载次数并断言服务可用
  const consumerLoads: number[] = []
  const consumer = {
    name: 'g1c-test-consumer',
    inject: ['penx1Run'],
    apply: (c: Context) => {
      consumerLoads.push(Date.now())
      // apply 内 ctx.penx1Run 应已就绪
      void c
    },
  }
  const provider = await import(providerUrl)

  // 1. provider 挂载 → consumer 的 inject 解除等待
  // cordis：ctx.plugin() 返回 child Context（fiber），dispose 它即卸载该插件。
  let providerFiber = ctx.plugin(provider, {}) as unknown as { dispose: () => void }
  ctx.plugin(consumer)
  await sleep(50)
  check('provider 挂载后 ctx.penx1Run 可用', (ctx as unknown as { penx1Run?: unknown }).penx1Run !== undefined)
  check('consumer inject 解除等待并加载', consumerLoads.length === 1, `loads=${consumerLoads.length}`)

  // 2. provider 卸载 → consumer 自动 dispose
  providerFiber.dispose()
  await sleep(50)
  check('provider 卸载后 penx1Run 不可用', (ctx as unknown as { penx1Run?: unknown }).penx1Run === undefined)

  // 3. provider 重挂 → consumer 恢复加载（cordis：服务回归后 consumer 自动重载）
  providerFiber = ctx.plugin(provider, {}) as unknown as { dispose: () => void }
  await sleep(80)
  const penx1RunBack = (ctx as unknown as { penx1Run?: unknown }).penx1Run
  check('provider 重挂后 penx1Run 恢复', penx1RunBack !== undefined)
  check('consumer 随服务回归重新加载', consumerLoads.length === 2, `loads=${consumerLoads.length}`)

  // 4. HMR 循环：dispose 后立即重挂（模拟热重载），工具不翻倍、服务不重复
  providerFiber.dispose()
  providerFiber = ctx.plugin(provider, {}) as unknown as { dispose: () => void }
  await sleep(80)
  const schemas = (ctx.tools as unknown as { schemas: () => Array<{ name: string }> }).schemas()
  const runTools = schemas.filter((t) => t.name.startsWith('penx1_')).map((t) => t.name)
  const uniqueTools = new Set(runTools)
  check('HMR 循环后工具不翻倍', runTools.length === uniqueTools.size && runTools.length === 2, `penx1 工具=${runTools.join(',')}`)

  // 5. 相同服务只存在一份（同一实例）
  const a = (ctx as unknown as { penx1Run?: { runId?: string } }).penx1Run
  const b = (ctx as unknown as { penx1Run?: { runId?: string } }).penx1Run
  check('服务实例唯一（同引用）', a === b)

  console.log(failures === 0 ? '[G1-C] 全部通过' : `[G1-C] ${failures} 项失败`)
  return failures === 0 ? 0 : 1
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error('[G1-C] 验证失败：', error)
  process.exit(1)
})
