/** @penx1/dsh-core — PEN-X1 核心插件包出口（插件经子路径单独挂载；此处仅导出纯逻辑与类型，避免 name/Config/apply 冲突）。 */

export { RunStateStore, type RunStateStoreOptions, type StartInput, type RecordedStep } from './run-state-store.js'
export { Penx1RunService } from './run-state.js'
export { EvidenceStore, type EvidenceOptions } from './evidence-guard-store.js'
export { Penx1EvidenceService } from './evidence-guard.js'
export { checkRequiredSections, REQUIRED_SECTIONS } from './policy.js'
export { buildTaskPlan } from './task-planner.js'
export { evaluatePolicy, type PolicyDecision } from './workflow-guard.js'
export { formatProgressLine, computeMetrics } from './trace.js'
