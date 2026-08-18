/** @penx1/dsh-data — PEN-X1 数据插件包出口（插件经子路径单独挂载；此处仅导出纯逻辑与类型）。 */

export { KnowledgeStore, type KnowledgeBase, type KnowledgeDocument, type EvidenceContextPack, type SearchHit, type KnowledgeStatus, type KnowledgeOptions } from './knowledge-store.js'
export {
  buildMarketSnapshot,
  analyzeMarketSnapshot,
  type MarketSnapshot,
  type MarketRecordMeta,
  type MarketQuery,
  type Penx1MarketSource,
  type SourceDescriptor,
} from './market-source.js'
export { buildReviewSnapshot, type ReviewSnapshot, type ReviewRecordMeta, type ReviewQuery, type Penx1ReviewSource } from './review-source.js'
