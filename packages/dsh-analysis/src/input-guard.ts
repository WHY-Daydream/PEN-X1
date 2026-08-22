/**
 * 统一工具输入边界（LLM Tool Input → Runtime Validation → Normalization → Business Logic）。
 *
 * 背景（Commit #3,方案 §22.4 hardening）：真实模型 Tool Calling 不保证字段存在或命名
 * 符合 canonical contract（如传 `id`/`text` 而非 `reviewId`/`originalQuote`）。任何 unknown
 * JSON 都不得把业务 Tool 打崩：缺字段 / 类型错 / 空串必须走结构化 INVALID_TOOL_INPUT
 * 错误（Agent 可据此修复参数），而不是 JS runtime TypeError（Agent 只会盲目重试并烧光
 * Step Budget）。
 *
 * 错误契约：
 *   Penx1Error('INVALID_TOOL_INPUT', `${path}: ${message}`)
 *   Penx1Error('BUSINESS_RULE_VIOLATION', `${path}: ${message}`)   // 语义规则,结构合法
 */

import { Penx1Error } from '@penx1/contracts'

/** 断言值为非空对象,否则抛 INVALID_TOOL_INPUT。 */
export function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Penx1Error('INVALID_TOOL_INPUT', `${path}: 必须是对象`)
  }
}

/** 从一组候选字段名中取第一个字符串值（兼容 alias 归一化）。 */
function pickString(obj: Record<string, unknown>, aliases: readonly string[]): string | undefined {
  for (const key of aliases) {
    const v = obj[key]
    if (typeof v === 'string') return v
  }
  return undefined
}

/**
 * 必填字符串字段：从 aliases 中取第一个非空字符串;全缺 / 空串 / 类型错 → INVALID_TOOL_INPUT。
 * @param obj - 已断言为对象的输入项
 * @param path - 诊断路径（如 opportunities[1].opportunityId）
 * @param aliases - canonical 字段名优先,兼容别名在后（如 ['reviewId', 'id']）
 * @param label - 错误信息里的可读字段名
 */
export function requireString(
  obj: Record<string, unknown>,
  path: string,
  aliases: readonly string[],
  label: string,
): string {
  const value = pickString(obj, aliases)
  if (value === undefined || value.trim().length === 0) {
    throw new Penx1Error('INVALID_TOOL_INPUT', `${path}: ${label} 为必填字符串（当前缺失/空/非字符串）`)
  }
  return value.trim()
}

/** 可选字符串字段：缺失/非字符串返回 undefined,空串返回空串。 */
export function optionalString(obj: Record<string, unknown>, path: string, aliases: readonly string[]): string | undefined {
  return pickString(obj, aliases)
}

/** 必填数组字段（元素为字符串）;缺失/非数组 → INVALID_TOOL_INPUT。 */
export function requireStringArray(
  obj: Record<string, unknown>,
  path: string,
  aliases: readonly string[],
  label: string,
): string[] {
  let raw: unknown
  for (const key of aliases) {
    if (key in obj) { raw = obj[key]; break }
  }
  if (!Array.isArray(raw)) {
    throw new Penx1Error('INVALID_TOOL_INPUT', `${path}: ${label} 为必填数组（当前缺失/非数组）`)
  }
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new Penx1Error('INVALID_TOOL_INPUT', `${path}: ${label} 必须为字符串数组`)
    }
  }
  return raw as string[]
}

/** 可选数组字段：缺失返回 undefined,非数组 → INVALID_TOOL_INPUT。 */
export function optionalStringArray(obj: Record<string, unknown>, path: string, aliases: readonly string[]): string[] | undefined {
  let raw: unknown
  for (const key of aliases) {
    if (key in obj) { raw = obj[key]; break }
  }
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    throw new Penx1Error('INVALID_TOOL_INPUT', `${path}: 必须为数组`)
  }
  return raw as string[]
}

/** 可选数值字段：缺失返回 undefined,非 number → INVALID_TOOL_INPUT。 */
export function optionalNumber(obj: Record<string, unknown>, path: string, aliases: readonly string[]): number | undefined {
  for (const key of aliases) {
    const v = obj[key]
    if (v === undefined) continue
    if (typeof v !== 'number' || Number.isNaN(v)) {
      throw new Penx1Error('INVALID_TOOL_INPUT', `${path}: 必须为数值`)
    }
    return v
  }
  return undefined
}
