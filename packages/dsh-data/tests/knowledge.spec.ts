import { describe, expect, it } from 'vitest'
import { KnowledgeStore, type KnowledgeBase } from '../src/knowledge-store.js'

const base: KnowledgeBase = {
  version: '1.0',
  documents: [
    {
      id: 'DOC-P1',
      type: 'product',
      title: 'PEN-X1 产品定义',
      tags: ['PEN-X1', '规格'],
      source: 'attachment',
      sourcePriority: 2,
      content: 'PEN-X1 支持 AAA/AA/14500/18650 五种电池；目标亮度 500lm；44.5–100mm 多长度。',
    },
    {
      id: 'DOC-P2',
      type: 'product',
      title: 'PEN-X1 目标价',
      tags: ['PEN-X1', '价格'],
      source: 'internal',
      sourcePriority: 1,
      content: '目标价 $34.95 中间价格带。',
    },
    {
      id: 'DOC-C1',
      type: 'competitor',
      title: 'Amazon 竞品价格',
      tags: ['竞品', 'Amazon', '价格'],
      source: 'generic',
      sourcePriority: 0,
      content: '竞品 A 定价 $29.99，竞品 B 定价 $34.95，竞品 C 定价 $49.99。',
    },
    {
      id: 'DOC-T1',
      type: 'technical',
      title: '升压拓扑约束',
      tags: ['电池', '升压'],
      source: 'internal',
      sourcePriority: 1,
      content: 'AAA 低压升压效率是 R&D 关键风险；0.9V 输入下效率目标 ≥85%。',
    },
    {
      id: 'DOC-X1',
      type: 'constraint',
      title: '运输认证约束',
      tags: ['运输', '认证'],
      source: 'generic',
      sourcePriority: 0,
      content: '含锂电池 SKU 需要运输资料；北美上市需 UL 相关认证。',
    },
    {
      id: 'DOC-G1',
      type: 'general',
      title: 'EDC 手电趋势',
      tags: ['EDC', '手电'],
      source: 'generic',
      content: 'EDC 手电用户关注便携性与电池可获得性。',
    },
  ],
}

function newStore() {
  const store = new KnowledgeStore({ topKProduct: 5, topKCompetitor: 8, topKTechnical: 5, topKConstraint: 5 })
  store.load(base)
  return store
}

describe('KnowledgeStore', () => {
  it('加载并返回版本', () => {
    const store = newStore()
    expect(store.getVersion()).toBe('1.0')
  })

  it('词元检索：命中并评分排序', () => {
    const store = newStore()
    const hits = store.searchTerm('价格', 5)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    // 评分排序：DOC-P2（tag 命中 + 类型 boost + 优先级）应高于 DOC-C1。
    expect(hits[0]!.document.id).toBe('DOC-P2')
    expect(hits[0]!.score).toBeGreaterThanOrEqual(6)
    expect(hits.map((h) => h.document.id)).toContain('DOC-C1')
  })

  it('Tag Match 加分：PEN-X1 词元命中产品文档', () => {
    const store = newStore()
    const hits = store.searchTerm('PEN-X1', 5)
    const product = hits.find((h) => h.document.id === 'DOC-P1')
    expect(product).toBeDefined()
    expect(product!.score).toBeGreaterThanOrEqual(4) // token(1) + type boost(3) + priority(2) - 取子项
  })

  it('Top-K 限制生效', () => {
    const store = new KnowledgeStore({ topKProduct: 1, topKCompetitor: 1, topKTechnical: 1, topKConstraint: 1 })
    store.load(base)
    const { pack } = store.buildContextPack('RUN-1')
    expect(pack.documents.length).toBeLessThanOrEqual(4)
  })

  it('buildContextPack：跨组去重、Evidence ID 生成、版本字段', () => {
    const store = newStore()
    const { pack, items } = store.buildContextPack('RUN-1')
    expect(pack.contextPackId).toMatch(/^CTX-/)
    expect(pack.retrievalVersion).toBe('lexical-v1')
    expect(pack.knowledgeVersion).toBe('1.0')
    const ids = pack.documents.map((h) => h.document.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(pack.evidenceIds).toEqual(items.map((i) => i.evidenceId))
    expect(pack.evidenceIds).toContain('KB-DOC-P1')
  })

  it('technical 组零命中 → degraded（非临界组）', () => {
    const store = new KnowledgeStore({ topKProduct: 5, topKCompetitor: 8, topKTechnical: 5, topKConstraint: 5 })
    store.load({
      version: '1.0',
      documents: [
        { id: 'D1', type: 'product', title: 'PEN-X1', source: 'attachment', content: 'PEN-X1 规格' },
        { id: 'D2', type: 'competitor', title: '竞品', source: 'generic', content: '竞品价格' },
        { id: 'D4', type: 'constraint', title: '运输认证', source: 'generic', content: '运输认证约束' },
        // 无 technical 文档
      ],
    })
    const { pack } = store.buildContextPack('RUN-1')
    expect(pack.missingTopics).toContain('technical')
    expect(store.statusOf(pack)).toBe('degraded')
  })

  it('constraints 组零命中（临界组）→ blocked', () => {
    const store = new KnowledgeStore({ topKProduct: 5, topKCompetitor: 8, topKTechnical: 5, topKConstraint: 5 })
    store.load({
      version: '1.0',
      documents: [
        { id: 'D1', type: 'product', title: 'PEN-X1', source: 'attachment', content: 'PEN-X1 规格' },
        { id: 'D2', type: 'competitor', title: '竞品', source: 'generic', content: '竞品价格' },
        { id: 'D3', type: 'technical', title: '电池', source: 'generic', content: '电池升压' },
        // 无 constraint 文档
      ],
    })
    const { pack } = store.buildContextPack('RUN-1')
    expect(pack.missingTopics).toContain('constraints')
    expect(store.statusOf(pack)).toBe('blocked')
  })

  it('product 与 constraints 组同时零命中 → blocked', () => {
    const store = new KnowledgeStore({ topKProduct: 5, topKCompetitor: 8, topKTechnical: 5, topKConstraint: 5 })
    store.load({
      version: '1.0',
      documents: [
        { id: 'D1', type: 'competitor', title: '竞品', source: 'generic', content: '竞品价格信息' },
      ],
    })
    const { pack } = store.buildContextPack('RUN-1')
    expect(pack.missingTopics).toContain('product')
    expect(pack.missingTopics).toContain('constraints')
    expect(store.statusOf(pack)).toBe('blocked')
  })
})
