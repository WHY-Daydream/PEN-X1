/** PEN-X1 Artifact 模型（方案 §10.4 / §18.4 / §19.3）。 */

export interface Artifact {
  artifactId: string
  runId: string
  kind: string
  createdAt: string
  data: unknown
}

export interface TaskPlanArtifact {
  tasks: string[]
  dependencies: string[]
  requiredTools: string[]
  planVersion: string
}

export const BUSINESS_TASKS = [
  'market_analysis',
  'review_pain_mining',
  'opportunity_analysis',
  'evidence_based_swot',
  'lifecycle_risk_analysis',
] as const

export interface Opportunity {
  opportunityId: string
  title: string
  userProblem: string
  productResponse: string
  commercialValue: string
  engineeringDependency: string
  evidenceRefs: string[]
}

export type SwotQuadrant = 'strengths' | 'weaknesses' | 'opportunities' | 'threats'

export interface SwotItem {
  quadrant: SwotQuadrant
  statement: string
  evidenceRefs: string[]
  limitations: string[]
}

export interface SwotArtifact {
  strengths: SwotItem[]
  weaknesses: SwotItem[]
  opportunities: SwotItem[]
  threats: SwotItem[]
}

export interface MarketRecord {
  competitor: string
  price?: number
  currency?: string
  capturedAt?: string
  inStock?: boolean
  promotion?: string
  spec?: Record<string, unknown>
}

export interface MarketSnapshotData {
  snapshotId: string
  capturedAt: string
  scenario: string
  records: MarketRecord[]
}

export interface ReviewRecord {
  reviewId: string
  competitor: string
  rating: number
  language: string
  originalQuote: string
}

export interface ReviewSnapshotData {
  snapshotId: string
  capturedAt: string
  scenario: string
  reviews: ReviewRecord[]
}
