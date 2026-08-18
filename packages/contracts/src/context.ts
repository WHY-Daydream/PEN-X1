/**
 * PEN-X1 Context 接缝类型（contracts 内声明，供三个插件包共享，
 * 避免 dsh-core 的 Service 类类型只在其自身编译单元可见）。
 */

import type {} from '@deepseek-ai/cordis'
import type { Artifact, Claim, Conflict, EvidenceAudit, EvidenceItem, RiskItem, RiskValidation, RunProjection, ScoredClaim, ToolResult, ValidationResult } from './index.js'

export interface StartInput {
  product: string
  market?: string
  language?: string
}

/** ctx.penx1Run 的结构化接缝（由 penx1-run-state 插件提供实现）。 */
export interface Penx1Run {
  start(sessionId: string, input: StartInput): Promise<RunProjection>
  get(runId: string): RunProjection
  has(runId: string): boolean
  assert(runId: string, requirements: string[]): void
  recordArtifact(runId: string, artifact: Artifact): void
  recordStep(runId: string, result: ToolResult<unknown>): void
  replay(sessionId: string): Promise<RunProjection[]>
  fail(runId: string, reason: string): void
}

/** ctx.penx1Evidence 的结构化接缝（由 penx1-evidence-guard 插件提供实现）。 */
export interface Penx1Evidence {
  register(runId: string, items: EvidenceItem[]): void
  registerClaims(runId: string, claims: Claim[]): void
  getEvidence(runId: string, evidenceId: string): EvidenceItem
  validateRefs(runId: string, refs: string[]): ValidationResult
  detectConflicts(runId: string): Conflict[]
  scoreClaims(runId: string): ScoredClaim[]
  validateRisks(runId: string, risks: RiskItem[]): RiskValidation
  finalize(runId: string): EvidenceAudit
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    penx1Run: Penx1Run
    penx1Evidence: Penx1Evidence
  }
}

/**
 * cordis ctx.provide 的类型接缝：d.ts 对 name 做了 `keyof this` 约束，
 * 对插件自定义 Service 名过严；运行时 cordis 按名称提供服务，此处显式收窄。
 */
export function provideService(ctx: unknown, name: string, impl: unknown): void {
  ;(ctx as { provide(name: string, value: unknown): unknown }).provide(name, impl)
}

/** cordis ctx.on 的类型接缝：监听器参数由调用方显式给出，避免依赖 Events 增强的模块解析差异。 */
export function onEvent<Args extends unknown[]>(ctx: unknown, event: string, listener: (...args: Args) => unknown): void {
  ;(ctx as { on(event: string, listener: (...args: Args) => unknown): unknown }).on(event, listener)
}
