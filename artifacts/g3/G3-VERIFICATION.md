# G3 真实 DeepSeek 链路验证记录

> 状态：**部分达成（1 次真实链路已验证）；后续模型调用被 QUOTA 阻塞**

## 1. 已验证内容（真实 DeepSeek 会话）

- **凭据**：已通过 DSH 官方凭据机制落盘（`~/.dsh/.credentials.yaml`，0600 权限，provider route `deepseek-official`）；headless 启动确认凭据被识别（`Hi! 👋 I'm the DeepSeek Harness coding agent...`）。
- **真实会话（session-0886ba3b...）**：完整任务输入后，session 日志证实模型实际调用了全部 13 个 PEN-X1 工具，每个恰好 1 次、无重复：

```text
penx1_start_analysis → penx1_plan_tasks → penx1_retrieve_knowledge
→ penx1_fetch_market_mock + penx1_fetch_reviews_mock（并行）
→ penx1_analyze_market + penx1_mine_review_pains（并行）
→ penx1_identify_opportunities → penx1_build_swot + penx1_build_risk_register
→ penx1_validate_evidence → penx1_generate_report → penx1_get_status
```

- **事件日志**：`turn/start`、`step/start`、`step/end`、`turn/end` 齐全；**0 次** `Blocked` / 越级 / 违规。
- **报告**：`output/dsh/PEN-X1_DSH_Report_RUN-001.md` 生成，含 12 个固定章节、`【演示Mock数据】` 声明、三 Gate 结论正确（工程 `CONDITIONAL_GO` / 量产 `NO_GO` / 北美 Listing `NO_GO`）。

## 2. 阻塞项：QUOTA: Insufficient Balance

后续完整运行返回：

```text
dsh: QUOTA: Insufficient Balance
```

DeepSeek API 账号余额不足，模型调用被服务端拒绝。**需要为账号充值**后才能继续：

- G3 补充验证（多次真实运行确认稳定性）；
- G5 模型侧 20 次回归（baseline 10 / missing 4 / conflict 3 / illegal-order 3，§12.1）。

## 3. 恢复步骤

1. DeepSeek 开放平台充值（https://platform.deepseek.com/）；
2. 充值后回复"已充值"，我将立即重跑：

```bash
node scripts/run-headless-e2e.mjs --live        # G3 真实链路复核
# G5 模型侧 20 次回归脚本（按 §12.1 分配）在 Key 就绪后执行
```

## 4. 不依赖余额的部分（已完成）

- G0–G2、G4、G6 全部通过（见前序提交 b5c5b2d）；
- G5 无模型确定性回归 10/10（成功率 100%、重放一致 100%）；
- 17 插件真实挂载、13 工具注册无重复、ctx.provide() 生命周期七项全过。
