import { describe, expect, it } from 'vitest'
import { BUSINESS_TASKS } from '@penx1/contracts'
import { buildTaskPlan } from '../src/task-planner.js'

describe('buildTaskPlan（方案 §10）', () => {
  it('五项业务任务齐全', () => {
    const plan = buildTaskPlan('penx1-dag-v1')
    expect(plan.tasks).toEqual([...BUSINESS_TASKS])
    expect(plan.tasks).toHaveLength(5)
  })

  it('planVersion 可配置且固定', () => {
    const plan = buildTaskPlan('penx1-dag-v1')
    expect(plan.planVersion).toBe('penx1-dag-v1')
  })

  it('requiredTools 覆盖全部 PEN-X1 工具', () => {
    const plan = buildTaskPlan('penx1-dag-v1')
    expect(plan.requiredTools).toContain('penx1_retrieve_knowledge')
    expect(plan.requiredTools).toContain('penx1_fetch_market_mock')
    expect(plan.requiredTools).toContain('penx1_generate_report')
  })
})
