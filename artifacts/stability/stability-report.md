# PEN-X1 稳定性报告（stability-report）

> 生成时间：2026-08-21（模型侧 20 次 Live 回归完成）| 结论：**G5 = FAIL（业务正确性未达成）**
> 详细数据：artifacts/stability/stability-report.json + live-results.jsonl（执行历史）

---

## 1. G5 确定性回归（无模型，已完成）

| 指标 | 结果 | 标准 | 状态 |
| --- | --- | --- | --- |
| 运行次数 | 10（baseline 全链路） | 每次提交执行 | ✅ |
| Terminal Success Rate | 100.0% | ≥ 95% | ✅ |
| Correct Gate Rate | 100.0%（REPORT_READY） | 100% | ✅ |
| Session Replay Success | 100.0% | 100% | ✅ |
| Workflow Violation Escaped | 0 | 0 | ✅ |
| Critical Hallucination | 0 | 0 | ✅ |
| 平均耗时 | 78 ms | — | 参考 |
| p95 耗时 | 245 ms | — | 参考 |

10 次运行全部在独立 Context 中执行完整 13 工具链路，每次均达到 `REPORT_READY`，无重复工具、无越级调用、报告原子写入且 SHA-256 一致。

---

## 2. G5 模型侧 Live 回归（20 次，已完成）

### 2.1 Execution Summary（执行层）

| 指标 | 结果 | 状态 |
| --- | --- | --- |
| 计划 cases | 20（baseline 10 / missing-data 4 / conflict-data 3 / illegal-order 3） | — |
| 最终执行成功（按 case 最新状态） | 20 / 20 | ✅ |
| Terminal Success Rate（最终成功/计划） | 100.0%（≥ 95% 达标） | ✅ |

每个 case 的最终状态取 `live-results.jsonl` 中该 key 的**最新一条记录**；历史失败 attempt 不进入验收分母。

### 2.2 Infrastructure Stability（基础设施稳定性，Attempt 层）

| 指标 | 结果 |
| --- | --- |
| 累计 attempts | 37 |
| 成功 attempts | 20 |
| 失败 attempts | 17 |
| 失败分类 | LIFECYCLE: 8、SPAWN_ERROR: 7、TIMEOUT: 2 |

> 说明：历史基础设施失败（AUTH/RATE_LIMIT/SPAWN_ERROR/TIMEOUT/LIFECYCLE）**不进入 case-level 最终验收分母**；本轮运行期已通过 settings.yaml 将 baseURL 指向 sensenova 网关并配置 retryPolicy（maxRetries 12、退避 2s→45s），运行期间未再出现 AUTH/RATE_LIMIT。

### 2.3 Business Correctness（业务正确性，逐 case 核验）

| 指标 | 结果 | 状态 |
| --- | --- | --- |
| Correct Gate（REPORT_READY） | **0 / 20** | ❌ |
| Policy Violation | 0 | ✅ |
| Hallucination | 无法核验（报告未生成） | ⚠️ |

**判定：❌ FAIL**。虽然 20/20 进程退出码成功，但没有任何 session 达到 `REPORT_READY`，报告未生成，Gate 结论无法成立。

**根因（2 个业务层缺陷，非基础设施）**：

1. `penx1_mine_review_pains` 工具崩溃：`packages/dsh-analysis/src/review-mining.ts:71` 对模型传入的 reviews 直接执行 `review.originalQuote.toLowerCase()`，模型构造的 reviews 对象缺少 `originalQuote` 字段 → `Cannot read properties of undefined (reading 'toLowerCase')`。工具输入契约不健壮，未对缺失字段做防线。
2. Step Budget（18）耗尽：工具反复崩溃重试烧光预算，`penx1_generate_report` 从未成功执行，8 个 session 全部停在 `DATA_READY`。

### 2.4 Critical Scenarios（关键场景）

| 场景 | 执行层 | 业务层 |
| --- | --- | --- |
| baseline | 10 / 10 ✅ | 0 / 10 达 REPORT_READY ❌ |
| missing-data | 4 / 4 ✅ | 0 / 4 ❌ |
| conflict-data | 3 / 3 ✅ | 0 / 3 ❌ |
| illegal-order | 3 / 3 ✅ | 0 / 3 ❌ |

> 注：illegal-order 场景的 `KNOWLEDGE_RETRIEVAL_REQUIRED` 阻断确实生效（模型先调 fetch 被拦截），门禁正确；但业务链路同样被上述工具缺陷阻断，未产生报告。

---

## 3. 最终结论

```text
G5 Deterministic    : PASS（10/10，REPORT_READY 100%）
G5 Live Execution   : PASS（20/20 执行成功，Terminal Success 100%）
G5 Business Correct : FAIL（0/20 达 REPORT_READY，报告未生成）
────────────────────────────────────────────
G5 = FAIL
```

**不作为 G5 PASS 提交。** 修复建议（按优先级）：

1. `review-mining.ts:71` 增加 `originalQuote` 缺失防线：缺失时跳过该条或默认空串（DATA_CONTRACT 缺陷）。
2. 复核模型侧 reviews 传参契约：工具应容忍模型未完整携带 schema 字段。
3. 修复后重跑受影响场景（missing-data / conflict-data / illegal-order），直至业务层 20/20 达 REPORT_READY 且 Correct Gate 100%。

## 4. 失败分类预案（方案 §12.3）

```text
MODEL_PLANNING / TOOL_SCHEMA / PLUGIN_LIFECYCLE / STATE_REPLAY
DATA_CONTRACT / EVIDENCE_GUARD / REPORT_IO / EXTERNAL_API
```

不重跑至成功为止而不保留失败记录。
