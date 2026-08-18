/**
 * PEN-X1 Review Capability：Service 定义（方案 §14 / §15）。
 * Provider 实现 Penx1ReviewSource；每条评论必须保留英文原句（方案 §14.4）。
 */

import { MOCK_BANNER } from '@penx1/contracts'
import type { SourceDescriptor } from './market-source.js'

export interface ReviewQuery {
  competitors?: string[]
  language?: string
}

export interface ReviewRecordMeta {
  reviewId: string
  competitor: string
  rating: number
  language: string
  originalQuote: string
  sourceType: 'DEMO_MOCK'
  sourceLabel: string
  sourceRef: string
  content: Record<string, unknown>
}

export interface ReviewSnapshot {
  snapshotId: string
  capturedAt: string
  scenario: string
  reviews: ReviewRecordMeta[]
}

/** Capability Seam：未来真实 Review Provider 必须实现同一接口（方案 §14.6）。 */
export interface Penx1ReviewSource {
  fetch(input: ReviewQuery): Promise<ReviewSnapshot>
  sourceDescriptor(): SourceDescriptor
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    penx1ReviewSource: Penx1ReviewSource
  }
}

export interface RawReview {
  reviewId: string
  competitor: string
  rating: number
  language?: string
  originalQuote: string
}

/** 包装原始评论为带 DEMO_MOCK 标签、保留英文原句的快照记录（方案 §14.4）。 */
export function buildReviewSnapshot(raw: unknown, descriptor: SourceDescriptor): ReviewSnapshot {
  const parsed = raw as { capturedAt?: string; reviews?: RawReview[] }
  if (!Array.isArray(parsed.reviews)) {
    throw new Error(`评论数据文件结构无效：${descriptor.dataFile}`)
  }
  const capturedAt = parsed.capturedAt ?? new Date().toISOString()
  const reviews: ReviewRecordMeta[] = parsed.reviews.map((review, index) => {
    if (typeof review.originalQuote !== 'string' || review.originalQuote.trim().length === 0) {
      throw new Error(`评论 ${index} 缺少英文原句 originalQuote`)
    }
    if (typeof review.competitor !== 'string') {
      throw new Error(`评论 ${index} 缺少 competitor`)
    }
    return {
      reviewId: review.reviewId ?? `MR-${String(index + 1).padStart(3, '0')}`,
      competitor: review.competitor,
      rating: review.rating,
      language: review.language ?? 'en-US',
      originalQuote: review.originalQuote,
      sourceType: 'DEMO_MOCK',
      sourceLabel: `Amazon 英文评论快照 ${MOCK_BANNER}`,
      sourceRef: `${descriptor.dataFile}#${review.reviewId ?? index}`,
      content: {
        domain: 'review',
        subject: `review.${review.reviewId ?? index}`,
        value: review.originalQuote,
        kind: 'review',
      },
    }
  })
  return {
    snapshotId: `REVIEW-SNAPSHOT-${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`,
    capturedAt,
    scenario: descriptor.scenario,
    reviews,
  }
}
