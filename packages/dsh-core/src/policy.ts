/**
 * PEN-X1 Policy 插件（方案 §9）。
 * 插件名：penx1-policy
 * 同步读取系统 Prompt 文件并校验硬约束 Section 完整（文件缺失或 Section 缺失 → 启动失败，§9.6）；
 * Prompt 接入 DSH systemPrompt 组装为冻结版本 API 集成接缝。
 */

import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Penx1Error } from '@penx1/contracts'

export const name = 'penx1-policy'

export interface Config {
  promptFile: string
  language: string
  includeEnglishReviewRules: boolean
  includeMockBanner: boolean
}

export const Config: z<Config> = z.object({
  promptFile: z.string().default('prompts/penx1-system.md'),
  language: z.string().default('zh-CN'),
  includeEnglishReviewRules: z.boolean().default(true),
  includeMockBanner: z.boolean().default(true),
})

/** 硬约束 Prompt Section（方案 §9.3）。 */
export const REQUIRED_SECTIONS = [
  'Agent Identity',
  'Business Objective',
  'Required DAG',
  'Knowledge First Policy',
  'Mock Data Policy',
  'Evidence Contract',
  'Missing Data Policy',
  'Risk Contract',
  'English Review Policy',
  'Final Report Contract',
] as const

/** 校验 Prompt 是否包含全部硬约束 Section（方案 §9.6）。 */
export function checkRequiredSections(prompt: string): { valid: boolean; missing: string[] } {
  const missing = REQUIRED_SECTIONS.filter((section) => !prompt.includes(section))
  return { valid: missing.length === 0, missing }
}

export function apply(ctx: Context, config: Config): void {
  let prompt: string
  try {
    prompt = readFileSync(config.promptFile, 'utf8')
  } catch (error) {
    throw new Penx1Error('CONFIG_INVALID', `Prompt 文件不存在：${config.promptFile}（${error instanceof Error ? error.message : String(error)}）`)
  }
  const check = checkRequiredSections(prompt)
  if (!check.valid) {
    throw new Penx1Error('CONFIG_INVALID', `Prompt 缺少硬约束 Section：${check.missing.join('、')}`)
  }
  void ctx
}
