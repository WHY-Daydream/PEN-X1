/**
 * PEN-X1 Knowledge 纯逻辑存储（方案 §11）。
 * 检索算法：Token Match + Tag Match + Document Type Boost + Source Priority + Top-K 去重（§11.4）。
 * 四组必需查询：product / competitors / technical / constraints；任意组零命中 → degraded，
 * product 或 constraints 零命中 → blocked（§11.4）。
 */

import type { EvidenceItem } from '@penx1/contracts'
import { isoNow } from '@penx1/contracts'

export interface KnowledgeDocument {
  id: string
  type: 'product' | 'competitor' | 'technical' | 'constraint' | 'general'
  title: string
  tags?: string[]
  source: 'attachment' | 'generic' | 'internal'
  sourcePriority?: number
  content: string
}

export interface KnowledgeBase {
  version: string
  documents: KnowledgeDocument[]
}

export interface KnowledgeQueryGroup {
  name: string
  terms: string[]
  topK: number
  /** 零命中即 blocked 的临界组（product / constraints）。 */
  critical: boolean
}

export interface SearchHit {
  document: KnowledgeDocument
  score: number
  matchedTerm: string
}

export interface EvidenceContextPack {
  contextPackId: string
  queries: string[]
  documents: SearchHit[]
  evidenceIds: string[]
  missingTopics: string[]
  retrievalVersion: string
  knowledgeVersion: string
}

export type KnowledgeStatus = 'success' | 'degraded' | 'blocked'

export interface KnowledgeOptions {
  topKProduct: number
  topKCompetitor: number
  topKTechnical: number
  topKConstraint: number
}

const TYPE_BOOST: Record<KnowledgeDocument['type'], number> = {
  product: 3,
  competitor: 3,
  technical: 3,
  constraint: 3,
  general: 0,
}

const QUERY_TERMS: Record<string, string[]> = {
  product: ['PEN-X1', '规格', '产品', 'spec'],
  competitors: ['竞品', 'Amazon', '价格', 'competitor'],
  technical: ['电池', '升压', '开关', '防水', '温升', '亮度', 'battery', 'switch'],
  constraints: ['约束', '验证', '测试', '认证', '运输', 'constraint'],
}

export class KnowledgeStore {
  private base?: KnowledgeBase
  private seq = 0
  readonly retrievalVersion = 'lexical-v1'

  constructor(private readonly options: KnowledgeOptions) {}

  load(base: KnowledgeBase): void {
    if (typeof base.version !== 'string' || !Array.isArray(base.documents)) {
      throw new Error('知识库 JSON Schema 校验失败：缺少 version 或 documents')
    }
    for (const doc of base.documents) {
      if (typeof doc.id !== 'string' || typeof doc.content !== 'string') {
        throw new Error(`知识库文档 Schema 校验失败：${JSON.stringify(doc).slice(0, 80)}`)
      }
    }
    this.base = base
  }

  getVersion(): string {
    return this.base?.version ?? 'unloaded'
  }

  private requireBase(): KnowledgeBase {
    if (this.base === undefined) throw new Error('知识库尚未加载')
    return this.base
  }

  /** 对单个词项检索，返回命中列表（含评分）。 */
  searchTerm(term: string, topK: number): SearchHit[] {
    const base = this.requireBase()
    const tokens = this.tokenize(term)
    const scored: Array<SearchHit & { dedupeKey: string }> = []
    for (const doc of base.documents) {
      const haystack = `${doc.title}\n${doc.content}\n${(doc.tags ?? []).join(' ')}`.toLowerCase()
      let score = 0
      for (const token of tokens) {
        if (haystack.includes(token)) score += 1
      }
      if (score === 0) continue
      if ((doc.tags ?? []).some((tag) => tag.toLowerCase() === term.toLowerCase())) score += 2
      score += TYPE_BOOST[doc.type] ?? 0
      score += doc.sourcePriority ?? 0
      scored.push({ document: doc, score, matchedTerm: term, dedupeKey: doc.id })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK).map(({ dedupeKey: _dedupe, ...hit }) => hit)
  }

  /** 四组查询合并：组内 Top-K，跨组按文档去重（保留最高分）。 */
  buildContextPack(runId: string): { pack: EvidenceContextPack; items: EvidenceItem[] } {
    const base = this.requireBase()
    const groups = this.queryGroups()
    const queries: string[] = []
    const byDoc = new Map<string, SearchHit>()
    const missingTopics: string[] = []
    for (const group of groups) {
      queries.push(...group.terms)
      const groupHits: SearchHit[] = []
      for (const term of group.terms) {
        groupHits.push(...this.searchTerm(term, group.topK))
      }
      groupHits.sort((a, b) => b.score - a.score)
      const deduped = new Map<string, SearchHit>()
      for (const hit of groupHits) deduped.set(hit.document.id, hit)
      const hits = [...deduped.values()].slice(0, group.topK)
      if (hits.length === 0) missingTopics.push(group.name)
      for (const hit of hits) {
        const existing = byDoc.get(hit.document.id)
        if (existing === undefined || hit.score > existing.score) byDoc.set(hit.document.id, hit)
      }
    }
    const documents = [...byDoc.values()].sort((a, b) => b.score - a.score)
    const evidenceIds = documents.map((hit) => `KB-${hit.document.id}`)
    const items: EvidenceItem[] = documents.map((hit) => ({
      evidenceId: `KB-${hit.document.id}`,
      sourceType: hit.document.source === 'attachment' ? 'ATTACHMENT' : 'GENERIC_KNOWLEDGE',
      sourceLabel: hit.document.title,
      sourceRef: hit.document.id,
      sourceTimestamp: isoNow(),
      content: hit.document.content,
      contentHash: `kb-${hit.document.id}`,
    }))
    const pack: EvidenceContextPack = {
      contextPackId: `CTX-${String(++this.seq).padStart(3, '0')}`,
      queries,
      documents,
      evidenceIds,
      missingTopics,
      retrievalVersion: this.retrievalVersion,
      knowledgeVersion: base.version,
    }
    void runId
    return { pack, items }
  }

  /** 按方案 §11.4 判定工具状态。 */
  statusOf(pack: EvidenceContextPack): KnowledgeStatus {
    const names = new Set(this.queryGroups().map((g) => g.name))
    if (pack.missingTopics.includes('product') || pack.missingTopics.includes('constraints')) return 'blocked'
    if (pack.missingTopics.some((t) => names.has(t))) return 'degraded'
    return 'success'
  }

  private queryGroups(): KnowledgeQueryGroup[] {
    return [
      { name: 'product', terms: QUERY_TERMS.product ?? [], topK: this.options.topKProduct, critical: true },
      { name: 'competitors', terms: QUERY_TERMS.competitors ?? [], topK: this.options.topKCompetitor, critical: false },
      { name: 'technical', terms: QUERY_TERMS.technical ?? [], topK: this.options.topKTechnical, critical: false },
      { name: 'constraints', terms: QUERY_TERMS.constraints ?? [], topK: this.options.topKConstraint, critical: true },
    ]
  }

  /** 小写化 + 词元切分；中文词元整体保留做子串匹配。 */
  private tokenize(term: string): string[] {
    const lower = term.toLowerCase()
    const tokens = lower.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0)
    if (/[\u4e00-\u9fff]/.test(lower) && tokens.every((t) => !/\u4e00-\u9fff/.test(t))) {
      tokens.push(lower)
    }
    return tokens
  }
}
