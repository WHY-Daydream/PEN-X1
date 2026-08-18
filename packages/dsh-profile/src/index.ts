/**
 * @penx1/dsh-profile — PEN-X1 Profile 组合说明。
 * Web 演示：dsh-base + dsh-web-app + penx1-dsh-bundle
 * Headless 测试：dsh-base + dsh-headless + penx1-dsh-bundle
 * 具体组合以冻结 DSH 版本的 Profile 机制为准（方案 §5.1 / §32.3）。
 */

export const profiles = {
  web: ['dsh-base', 'dsh-web-app', '@penx1/dsh-bundle'],
  headless: ['dsh-base', 'dsh-headless', '@penx1/dsh-bundle'],
} as const
