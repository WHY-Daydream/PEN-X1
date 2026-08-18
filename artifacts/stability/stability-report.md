# PEN-X1 稳定性报告（stability-report）

> 生成时间：2026-08-19 | 阶段：G5（部分完成）
> 详细数据：artifacts/stability/stability-report.json

## 1. 无模型确定性回归（已完成）

| 指标 | 结果 | 标准 | 状态 |
| --- | --- | --- | --- |
| 运行次数 | 10（baseline 全链路） | 每次提交执行 | ✅ |
| Terminal Success Rate | 100.0% | ≥ 95% | ✅ |
| Correct Gate Rate | 100.0%（REPORT_READY） | 100% | ✅ |
| Session Replay Success | 100.0% | 100% | ✅ |
| Workflow Violation Escaped | 0 | 0 | ✅ |
| Critical Hallucination | 0 | 0 | ✅ |
| 平均耗时 | 91 ms | — | 参考 |
| p95 耗时 | 309 ms | — | 参考 |

10 次运行全部在独立 Context 中执行完整 13 工具链路（start → plan → knowledge → market/review → analyze/mine → opportunity → swot/risk → validate → report），每次均达到 `REPORT_READY`，无重复工具、无越级调用、报告原子写入且 SHA-256 一致。

## 2. 模型侧 20 次回归（待 API Key）

方案 §12.1 建议使用目标模型（deepseek-v4-pro）执行：

| 场景 | 次数 |
| --- | ---: |
| baseline | 10 |
| missing-data | 4 |
| conflict-data | 3 |
| illegal-order | 3 |
| 合计 | 20 |

**阻塞项**：环境未配置 `DEEPSEEK_API_KEY`（headless 启动返回 `MISSING_CREDENTIAL: llm-deepseek`）。配置方式：

1. DSH Web Models 页面写入 Credential；或
2. 启动环境导出 `DEEPSEEK_API_KEY`。

配置完成后执行：

```bash
node scripts/run-headless-e2e.mjs --live     # G3 真实链路
# G5 模型侧 20 次回归脚本待 Key 就绪后运行
```

## 3. 失败分类预案（方案 §12.3）

如 20 次中出现失败，按以下分类并修复后重跑受影响场景：

```text
MODEL_PLANNING / TOOL_SCHEMA / PLUGIN_LIFECYCLE / STATE_REPLAY
DATA_CONTRACT / EVIDENCE_GUARD / REPORT_IO / EXTERNAL_API
```

不重跑至成功为止而不保留失败记录。
