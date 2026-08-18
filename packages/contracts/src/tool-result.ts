/** PEN-X1 统一 Tool Envelope（方案 §4.5）。 */

import type { RunPhase } from './run.js'

export type CapabilityType =
  | 'control'
  | 'knowledge'
  | 'external_mock'
  | 'business_skill'
  | 'governance'
  | 'output'

export type ToolStatus = 'success' | 'degraded' | 'blocked' | 'failed'

export interface ToolResult<T> {
  runId: string
  toolName: string
  capabilityType: CapabilityType
  status: ToolStatus
  previousPhase: RunPhase
  currentPhase: RunPhase
  artifactIds: string[]
  evidenceIds: string[]
  warnings: string[]
  data: T
}
