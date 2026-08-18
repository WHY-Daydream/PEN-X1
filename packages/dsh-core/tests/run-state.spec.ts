import { describe, expect, it } from 'vitest'
import type { ToolResult } from '@penx1/contracts'
import { Penx1Error } from '@penx1/contracts'
import { RunStateStore } from '../src/run-state-store.js'

function envelope(toolName: string, status: ToolResult<unknown>['status'], extra?: Partial<ToolResult<unknown>>): ToolResult<unknown> {
  return {
    runId: 'RUN-001',
    toolName,
    capabilityType: 'business_skill',
    status,
    previousPhase: 'INIT',
    currentPhase: 'INIT',
    artifactIds: [],
    evidenceIds: [],
    warnings: [],
    data: {},
    ...extra,
  }
}

function newStore() {
  return new RunStateStore({ maxRunsPerSession: 5, maxArtifactsPerRun: 500, allowConcurrentRuns: false })
}

describe('RunStateStore', () => {
  it('新建 Run：phase=INIT，runStarted=true', () => {
    const store = newStore()
    const run = store.start('s1', { product: 'PEN-X1' })
    expect(run.runId).toBe('RUN-001')
    expect(run.phase).toBe('INIT')
    expect(run.completed.runStarted).toBe(true)
    expect(run.sessionId).toBe('s1')
  })

  it('重复开始幂等：返回现有活动 Run，不新建（方案 §7.6）', () => {
    const store = newStore()
    const first = store.start('s1', { product: 'PEN-X1' })
    const second = store.start('s1', { product: 'PEN-X1' })
    expect(second.runId).toBe(first.runId)
  })

  it('完成 Run 后可再次开始', () => {
    const store = newStore()
    const first = store.start('s1', { product: 'PEN-X1' })
    store.recordStep(first.runId, envelope('penx1_generate_report', 'success'))
    expect(first.phase).toBe('REPORT_READY')
    const second = store.start('s1', { product: 'PEN-X1' })
    expect(second.runId).not.toBe(first.runId)
  })

  it('达到 maxRunsPerSession 后拒绝', () => {
    const store = new RunStateStore({ maxRunsPerSession: 1, maxArtifactsPerRun: 500, allowConcurrentRuns: false })
    const first = store.start('s1', { product: 'PEN-X1' })
    // 完成第一个 Run 后再尝试新建，超出上限应拒绝。
    first.phase = 'REPORT_READY'
    expect(() => store.start('s1', { product: 'PEN-X1' })).toThrowError(Penx1Error)
  })

  it('工具结果驱动 Phase 派生（方案 §26 全链路）', () => {
    const store = newStore()
    const run = store.start('s1', { product: 'PEN-X1' })
    store.recordStep(run.runId, envelope('penx1_plan_tasks', 'success'))
    expect(run.phase).toBe('PLANNED')
    store.recordStep(run.runId, envelope('penx1_retrieve_knowledge', 'success'))
    expect(run.phase).toBe('KB_READY')
    store.recordStep(run.runId, envelope('penx1_fetch_market_mock', 'success'))
    store.recordStep(run.runId, envelope('penx1_fetch_reviews_mock', 'success'))
    expect(run.phase).toBe('DATA_READY')
    store.recordStep(run.runId, envelope('penx1_build_swot', 'success'))
    store.recordStep(run.runId, envelope('penx1_build_risk_register', 'success'))
    expect(run.phase).toBe('ANALYSIS_READY')
    store.recordStep(run.runId, envelope('penx1_validate_evidence', 'success'))
    expect(run.phase).toBe('VALIDATED')
    store.recordStep(run.runId, envelope('penx1_generate_report', 'success'))
    expect(run.phase).toBe('REPORT_READY')
  })

  it('assert 校验前置 flag，缺失抛 ANALYSIS_DEPENDENCY_MISSING 并带 requiredAction', () => {
    const store = newStore()
    const run = store.start('s1', { product: 'PEN-X1' })
    expect(() => store.assert(run.runId, ['knowledgeReady'])).toThrowError(/knowledgeReady/)
    store.recordStep(run.runId, envelope('penx1_retrieve_knowledge', 'success'))
    expect(() => store.assert(run.runId, ['knowledgeReady'])).not.toThrow()
  })

  it('recordArtifact 与 evidence 去重合并', () => {
    const store = newStore()
    const run = store.start('s1', { product: 'PEN-X1' })
    store.recordStep(run.runId, envelope('penx1_fetch_market_mock', 'success', {
      artifactIds: ['MARKET-SNAPSHOT-001'],
      evidenceIds: ['MOCK-PRICE-001'],
    }))
    store.recordStep(run.runId, envelope('penx1_fetch_market_mock', 'success', {
      artifactIds: ['MARKET-SNAPSHOT-001'],
      evidenceIds: ['MOCK-PRICE-001'],
    }))
    expect(run.artifactIds).toEqual(['MARKET-SNAPSHOT-001'])
    expect(run.evidenceIds).toEqual(['MOCK-PRICE-001'])
  })

  it('tools/result 安全网按工具名置位 flag（模型文字声明不改变状态）', () => {
    const store = newStore()
    const run = store.start('s1', { product: 'PEN-X1' })
    store.recordToolResultEvent('penx1_retrieve_knowledge', 'RUN-001', false)
    expect(run.completed.knowledgeReady).toBe(true)
    expect(run.phase).toBe('KB_READY')
    store.recordToolResultEvent('penx1_fetch_market_mock', 'RUN-001', true)
    expect(run.completed.marketDataReady).toBeUndefined()
  })

  it('多 Session 隔离', () => {
    const store = newStore()
    const runA = store.start('sA', { product: 'PEN-X1' })
    const runB = store.start('sB', { product: 'PEN-X1' })
    expect(runA.runId).toBe('RUN-001')
    expect(runB.runId).toBe('RUN-002')
    store.recordStep(runA.runId, envelope('penx1_plan_tasks', 'success'))
    expect(runA.phase).toBe('PLANNED')
    expect(runB.phase).toBe('INIT')
  })

  it('fail 进入 FAILED 终态', () => {
    const store = newStore()
    const run = store.start('s1', { product: 'PEN-X1' })
    store.fail(run.runId, '投影无法恢复')
    expect(run.phase).toBe('FAILED')
    expect(run.terminalReason).toBe('投影无法恢复')
  })

  it('重放恢复投影：与当前投影一致', () => {
    const store = newStore()
    const run = store.start('s1', { product: 'PEN-X1' })
    store.recordStep(run.runId, envelope('penx1_plan_tasks', 'success'))
    store.recordStep(run.runId, envelope('penx1_retrieve_knowledge', 'success'))
    const rebuilt = store.replay('s1')
    expect(rebuilt).toHaveLength(1)
    expect(rebuilt[0]!.phase).toBe('KB_READY')
    expect(rebuilt[0]!.completed.planReady).toBe(true)
    expect(rebuilt[0]!.completed.knowledgeReady).toBe(true)
  })
})
