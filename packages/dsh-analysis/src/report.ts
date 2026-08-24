/**
 * PEN-X1 Report 插件（方案 §21）。
 * 插件名：penx1-report
 * 只消费 Evidence Guard 验证通过的 Artifact；12 节固定结构 Markdown；
 * 路径边界校验 + 临时文件原子替换 + SHA-256（§21.5）。
 */

import { createHash } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { EvidenceAudit } from '@penx1/contracts'
import { MOCK_BANNER, Penx1Error, assertPathWithin, isoNow } from '@penx1/contracts'

export const name = 'penx1-report'

export interface Config {
  outputDir: string
  fileNamePattern: string
  includeEvidenceLedger: boolean
  includeRunTrace: boolean
  overwrite: boolean
}

export const Config: z<Config> = z.object({
  outputDir: z.string().default('output/dsh'),
  fileNamePattern: z.string().default('PEN-X1_DSH_Report_{runId}.md'),
  includeEvidenceLedger: z.boolean().default(true),
  includeRunTrace: z.boolean().default(true),
  overwrite: z.boolean().default(false),
})

export const inject = ['tools', 'penx1Run', 'penx1Evidence']

/** Gate 结论枚举（与 data/scenarios/*.json 的 expectation 对齐）；说明文字不得混入结论值。 */
export const GATE_VALUES = ['GO', 'CONDITIONAL_GO', 'NO_GO'] as const
export type GateValue = (typeof GATE_VALUES)[number]

export interface GateSection {
  engineering: GateValue
  massProduction: GateValue
  listing: GateValue
}

export interface ReportInput {
  executiveSummary: string
  gates: GateSection
  sections?: Record<string, string>
}

export const REPORT_SECTIONS = [
  '1. 执行摘要与 Gate',
  '2. 任务拆解',
  '3. 数据范围和 Mock 声明',
  '4. 知识库检索结果',
  '5. 市场与竞品分析',
  '6. 英文评论痛点',
  '7. 产品机会',
  '8. 证据化 SWOT',
  '9. 全生命周期风险',
  '10. Evidence Audit',
  '11. 缺失数据和验证任务',
  '12. 数据来源账本',
] as const

/** 固定 12 节报告渲染（方案 §21.4）；Mock 数据声明必须出现（§21.7）。 */
export function renderReport(runId: string, input: ReportInput, audit: EvidenceAudit, mockDeclaration: string): string {
  const lines = [
    `# PEN-X1 产品分析报告（Run ${runId}）`,
    '',
    `${REPORT_SECTIONS[0]}`,
    '',
    input.executiveSummary,
    '',
    `| Gate | 结论 |`,
    `| --- | --- |`,
    `| 工程开发 | ${input.gates.engineering} |`,
    `| 量产 | ${input.gates.massProduction} |`,
    `| 北美 Listing | ${input.gates.listing} |`,
    '',
    `${REPORT_SECTIONS[1]}`,
    '',
    'market_analysis / review_pain_mining / opportunity_analysis / evidence_based_swot / lifecycle_risk_analysis',
    '',
    `${REPORT_SECTIONS[2]}`,
    '',
    mockDeclaration,
    '',
    `${REPORT_SECTIONS[3]}`,
    '',
    input.sections?.knowledge ?? '（见 Session Log）',
    '',
    `${REPORT_SECTIONS[4]}`,
    '',
    input.sections?.market ?? '（见 Session Log）',
    '',
    `${REPORT_SECTIONS[5]}`,
    '',
    input.sections?.reviews ?? '（见 Session Log）',
    '',
    `${REPORT_SECTIONS[6]}`,
    '',
    input.sections?.opportunities ?? '（见 Session Log）',
    '',
    `${REPORT_SECTIONS[7]}`,
    '',
    input.sections?.swot ?? '（见 Session Log）',
    '',
    `${REPORT_SECTIONS[8]}`,
    '',
    input.sections?.risks ?? '（见 Session Log）',
    '',
    `${REPORT_SECTIONS[9]}`,
    '',
    `- Claims：SUPPORTED ${audit.supportedClaims} / CONDITIONAL ${audit.conditionalClaims} / INSUFFICIENT ${audit.insufficientClaims} / CONFLICT ${audit.conflictedClaims}`,
    `- 未解决冲突：${audit.unresolvedConflicts}，缺失数据：${audit.missingCount}`,
    `- 报告授权：${audit.gate.reportAuthorized ? 'PASS' : 'BLOCK'}；Listing 允许：${audit.gate.listingAllowed ? 'PASS' : 'NO_GO'}`,
    '',
    `${REPORT_SECTIONS[10]}`,
    '',
    input.sections?.missing ?? '（见 Session Log）',
    '',
    `${REPORT_SECTIONS[11]}`,
    '',
    `- Evidence 总数：${audit.totalEvidence}`,
    `- 数据来源：附件事实 + ${MOCK_BANNER} + 通用行业知识；禁止真实 Amazon 搜索`,
    '',
  ]
  return lines.join('\n')
}

/**
 * 校验三 Gate 结论（G5 回归教训：模型曾把"结论词+放行条件长文"混进 Gate 值并跨 case 漂移）。
 * 每个值必须精确属于 GATE_VALUES；缺失/空/非字符串/带后缀 → 结构化 INVALID_TOOL_INPUT
 * （Agent 可据此只重传 Gate 枚举值，而不是烧光 Step Budget）。
 * 放行条件/说明应写入 executiveSummary 或 sections，而不是 Gate 结论字段。
 */
export function normalizeGates(raw: unknown, path = 'gates'): GateSection {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Penx1Error('INVALID_TOOL_INPUT', `${path}: 必须是对象（含 engineering/massProduction/listing）`)
  }
  const obj = raw as Record<string, unknown>
  const result = {} as GateSection
  for (const key of ['engineering', 'massProduction', 'listing'] as const) {
    const v = obj[key]
    const trimmed = typeof v === 'string' ? v.trim() : ''
    if (trimmed.length === 0) {
      throw new Penx1Error('INVALID_TOOL_INPUT', `${path}.${key}: 为必填 Gate 结论（当前缺失/空/非字符串）`)
    }
    if (!(GATE_VALUES as readonly string[]).includes(trimmed)) {
      throw new Penx1Error('INVALID_TOOL_INPUT',
        `${path}.${key}: 必须是 ${GATE_VALUES.join(' / ')} 之一（当前 "${trimmed.slice(0, 60)}"；放行条件说明请写入 executiveSummary 或对应 section，不要混入 Gate 结论）`)
    }
    result[key] = trimmed as GateSection[typeof key]
  }
  return result
}

/** 原子写入：临时文件 + rename，返回 SHA-256（方案 §21.5）。 */
export async function writeReportAtomic(filePath: string, content: string): Promise<string> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, filePath)
  return createHash('sha256').update(content).digest('hex')
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'penx1_generate_report',
    description: '生成最终 Markdown 报告（仅消费 Evidence Guard 验证通过的数据）',
    parameters: {
      runId: { type: 'string', required: true, description: 'PEN-X1 Run ID' },
      executiveSummary: { type: 'string', required: true, description: '执行摘要' },
      gates: {
        type: 'object',
        required: true,
        additionalProperties: false,
        description: '工程/量产/Listing 三个 Gate 结论；每个值必须是 GO / CONDITIONAL_GO / NO_GO 之一（纯枚举值，禁止附带说明文字；放行条件请写入 executiveSummary 或 sections）',
        properties: {
          engineering: { type: 'string', enum: [...GATE_VALUES] },
          massProduction: { type: 'string', enum: [...GATE_VALUES] },
          listing: { type: 'string', enum: [...GATE_VALUES] },
        },
      },
      sections: { type: 'object', additionalProperties: true, description: '各章节内容（可选）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          runId: { type: 'string' },
          artifactId: { type: 'string' },
          path: { type: 'string' },
          sha256: { type: 'string' },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `✓ Markdown 报告已生成：${value.path}\nArtifact: ${value.artifactId}\nSHA-256: ${value.sha256}` },
      ],
    },
    async execute(args) {
      ctx.penx1Run.assert(args.runId, [
        'validationPassed', 'marketAnalysisReady', 'reviewMiningReady',
        'opportunitiesReady', 'swotReady', 'riskReady',
      ])
      const audit = ctx.penx1Evidence.finalize(args.runId)
      if (!audit.gate.reportAuthorized) {
        throw new Penx1Error('REPORT_NOT_AUTHORIZED', `报告未授权：${audit.gate.reasons.join('；')}`)
      }
      const fileName = config.fileNamePattern.replaceAll('{runId}', args.runId)
      const filePath = resolve(config.outputDir, fileName)
      if (!assertPathWithin(resolve(config.outputDir), filePath)) {
        throw new Penx1Error('DATA_FILE_OUTSIDE_ROOT', `输出路径越界：${filePath}`)
      }
      // Gate 结论契约校验：非枚举值/缺失 → 结构化 INVALID_TOOL_INPUT（不放宽业务 Gate）
      const gates = normalizeGates(args.gates)
      const mockDeclaration = `本报告数据边界：附件事实、${MOCK_BANNER}、通用行业知识；不包含真实 Amazon 搜索或业务爬取数据。`
      const markdown = renderReport(args.runId, {
        executiveSummary: args.executiveSummary,
        gates,
        sections: args.sections as ReportInput['sections'],
      }, audit, mockDeclaration)
      const sha256 = await writeReportAtomic(filePath, markdown)
      const artifactId = `REPORT-${args.runId}`
      ctx.penx1Run.recordArtifact(args.runId, {
        artifactId, runId: args.runId, kind: 'REPORT', createdAt: isoNow(), data: { path: filePath, sha256 },
      })
      ctx.penx1Run.recordStep(args.runId, {
        runId: args.runId,
        toolName: 'penx1_generate_report',
        capabilityType: 'output',
        status: 'success',
        previousPhase: ctx.penx1Run.get(args.runId).phase,
        currentPhase: ctx.penx1Run.get(args.runId).phase,
        artifactIds: [artifactId],
        evidenceIds: [],
        warnings: [],
        data: { path: filePath, sha256 },
      })
      return { runId: args.runId, artifactId, path: filePath, sha256 }
    },
  }))
}
