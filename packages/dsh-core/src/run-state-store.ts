/**
 * PEN-X1 Run State 纯逻辑存储（不依赖 Cordis，可独立单测）。
 * 职责：维护 RunProjection，由工具结果驱动 Artifact Flag 与 Phase 派生，
 * 并支持从步骤日志重放重建投影（方案 §7.4 / §26）。
 */

import type { Artifact, RunProjection, ToolResult } from '@penx1/contracts'
import { Penx1Error, completedFlagFor, derivePhase, isoNow } from '@penx1/contracts'

export interface StartInput {
  product: string
  market?: string
  language?: string
}

export interface RunStateStoreOptions {
  maxRunsPerSession: number
  maxArtifactsPerRun: number
  allowConcurrentRuns: boolean
}

export interface RecordedStep {
  toolName: string
  status: string
  artifactIds: string[]
  evidenceIds: string[]
  warnings: string[]
  at: string
}

const TERMINAL_PHASES = new Set(['BLOCKED', 'FAILED', 'REPORT_READY'])

export class RunStateStore {
  private readonly runs = new Map<string, RunProjection>()
  private readonly sessionRuns = new Map<string, string[]>()
  private readonly stepLog = new Map<string, RecordedStep[]>()
  private seq = 0

  constructor(private readonly options: RunStateStoreOptions) {}

  /** 新建 Run；Session 已有活动 Run 且禁止并发时返回现有 Run（幂等，方案 §7.6）。 */
  start(sessionId: string, input: StartInput): RunProjection {
    const existing = this.activeRun(sessionId)
    if (existing !== undefined && !this.options.allowConcurrentRuns) {
      return existing
    }
    const count = this.sessionRuns.get(sessionId)?.length ?? 0
    if (count >= this.options.maxRunsPerSession) {
      throw new Penx1Error('INVALID_PHASE', `会话 ${sessionId} 运行数量已达上限（${this.options.maxRunsPerSession}）`)
    }
    const runId = `RUN-${String(++this.seq).padStart(3, '0')}`
    const projection: RunProjection = {
      runId,
      sessionId,
      phase: 'INIT',
      completed: { runStarted: true },
      artifactIds: [],
      evidenceIds: [],
      warnings: [],
    }
    this.runs.set(runId, projection)
    const list = this.sessionRuns.get(sessionId) ?? []
    list.push(runId)
    this.sessionRuns.set(sessionId, list)
    this.pushStep(runId, {
      toolName: 'penx1_start_analysis',
      status: 'success',
      artifactIds: [],
      evidenceIds: [],
      warnings: [],
      at: isoNow(),
    })
    return projection
  }

  has(runId: string): boolean {
    return this.runs.has(runId)
  }

  get(runId: string): RunProjection {
    const run = this.runs.get(runId)
    if (run === undefined) throw new Penx1Error('RUN_NOT_FOUND', `Run 不存在：${runId}`)
    return run
  }

  /** 校验前置 Artifact Flag；任一缺失即抛错并给出 requiredAction（方案 §7.3）。 */
  assert(runId: string, requirements: string[]): void {
    const run = this.get(runId)
    const missing = requirements.filter((flag) => run.completed[flag] !== true)
    if (missing.length > 0) {
      throw new Penx1Error(
        'ANALYSIS_DEPENDENCY_MISSING',
        `Run ${runId} 缺少前置条件：${missing.join(', ')}`,
        `先完成：${missing.join(', ')}`,
      )
    }
  }

  recordArtifact(runId: string, artifact: Artifact): void {
    const run = this.get(runId)
    if (run.artifactIds.length >= this.options.maxArtifactsPerRun) {
      run.warnings.push(`Artifact 数量超过上限（${this.options.maxArtifactsPerRun}），丢弃 ${artifact.artifactId}`)
      return
    }
    run.artifactIds.push(artifact.artifactId)
  }

  /** 工具结果驱动状态更新：成功置位完成 flag，合并 artifact/evidence/warning（方案 §7.4）。 */
  recordStep(runId: string, result: ToolResult<unknown>): void {
    const run = this.get(runId)
    this.pushStep(runId, {
      toolName: result.toolName,
      status: result.status,
      artifactIds: result.artifactIds,
      evidenceIds: result.evidenceIds,
      warnings: result.warnings,
      at: isoNow(),
    })
    this.mergeResult(run, result)
  }

  /** DSH tools/result 事件安全网：只按工具名置位完成 flag（权威历史驱动，方案 §7.4）。 */
  recordToolResultEvent(toolName: string, runId: string | undefined, isError: boolean): void {
    if (runId === undefined || !this.runs.has(runId)) return
    const run = this.runs.get(runId)!
    if (!isError) {
      const flag = completedFlagFor(toolName)
      if (flag !== undefined) run.completed[flag] = true
      run.phase = derivePhase(run.completed)
    }
  }

  /** 从步骤日志重放，重建每个 Run 的投影（方案 §7.6：Projection 可重放）。 */
  replay(sessionId: string): RunProjection[] {
    const runIds = this.sessionRuns.get(sessionId) ?? []
    return runIds.map((runId) => this.rebuild(runId))
  }

  fail(runId: string, reason: string): void {
    const run = this.get(runId)
    run.phase = 'FAILED'
    run.terminalReason = reason
  }

  private activeRun(sessionId: string): RunProjection | undefined {
    for (const runId of this.sessionRuns.get(sessionId) ?? []) {
      const run = this.runs.get(runId)
      if (run !== undefined && !TERMINAL_PHASES.has(run.phase)) return run
    }
    return undefined
  }

  private pushStep(runId: string, step: RecordedStep): void {
    const log = this.stepLog.get(runId) ?? []
    log.push(step)
    this.stepLog.set(runId, log)
  }

  private mergeResult(run: RunProjection, result: ToolResult<unknown>): void {
    for (const id of result.evidenceIds) {
      if (!run.evidenceIds.includes(id)) run.evidenceIds.push(id)
    }
    for (const artifactId of result.artifactIds) {
      if (!run.artifactIds.includes(artifactId)) run.artifactIds.push(artifactId)
    }
    for (const warning of result.warnings) run.warnings.push(warning)
    if (result.status === 'success') {
      const flag = completedFlagFor(result.toolName)
      if (flag !== undefined) run.completed[flag] = true
    }
    run.phase = derivePhase(run.completed)
  }

  /** 按步骤日志顺序重建投影；日志缺失时 Run 进入 FAILED（方案 §7.6）。 */
  private rebuild(runId: string): RunProjection {
    const steps = this.stepLog.get(runId)
    if (steps === undefined || steps.length === 0) {
      throw new Penx1Error('INVALID_PHASE', `Run ${runId} 无步骤日志，投影无法恢复`)
    }
    const head = steps[0]!
    const projection: RunProjection = {
      runId,
      sessionId: this.get(runId).sessionId,
      phase: 'INIT',
      completed: {},
      artifactIds: [],
      evidenceIds: [],
      warnings: [],
    }
    for (const step of steps) {
      projection.completed.runStarted ??= true
      if (step.status === 'success') {
        const flag = completedFlagFor(step.toolName)
        if (flag !== undefined) projection.completed[flag] = true
      }
      for (const id of step.evidenceIds) {
        if (!projection.evidenceIds.includes(id)) projection.evidenceIds.push(id)
      }
      for (const id of step.artifactIds) {
        if (!projection.artifactIds.includes(id)) projection.artifactIds.push(id)
      }
      projection.warnings.push(...step.warnings)
    }
    projection.phase = derivePhase(projection.completed)
    this.runs.set(runId, projection)
    return projection
  }
}
