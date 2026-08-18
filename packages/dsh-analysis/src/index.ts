/** @penx1/dsh-analysis — PEN-X1 业务分析插件包出口（插件经子路径单独挂载；此处仅导出纯逻辑与类型）。 */

export { completeStep } from './helpers.js'
export { analyzeMarket, type MarketAnalysisOutput, type PriceRow, type MarketComparisonRow, type SpecGap } from './market-analysis.js'
export { extractPains, PAIN_GLOSSARY, type PainCluster, type PainExtraction, type ReviewInput } from './review-mining.js'
export { validateOpportunities, isStableDirection, type OpportunityInput } from './opportunity.js'
export { validateSwot } from './swot.js'
export { validateRiskRegister, CRITICAL_ENGINEERING_RISKS, type RiskRegisterCheck } from './risk.js'
export { renderReport, writeReportAtomic, REPORT_SECTIONS, type ReportInput, type GateSection } from './report.js'
