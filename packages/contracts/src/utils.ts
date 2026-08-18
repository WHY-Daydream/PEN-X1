/** PEN-X1 通用工具函数（哈希、路径边界），供 Knowledge / Report 等插件复用。 */

import { createHash } from 'node:crypto'
import { resolve, sep } from 'node:path'

export function hashContent(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  return createHash('sha256').update(serialized).digest('hex')
}

export function isoNow(): string {
  return new Date().toISOString()
}

/** 与 dsh-tools schema 推断一致的 JSON 值类型（用于工具 Canonical Output 类型转换）。 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * 目标路径解析后必须位于 root 之内（方案 §11.7 / §21.5，DATA_FILE_OUTSIDE_ROOT）。
 * root 本身返回 true；root 之外返回 false。
 */
export function assertPathWithin(root: string, target: string): boolean {
  const rootResolved = resolve(root)
  const targetResolved = resolve(target)
  if (targetResolved === rootResolved) return true
  return targetResolved.startsWith(rootResolved + sep)
}
