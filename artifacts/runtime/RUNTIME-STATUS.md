# PEN-X1 DSH Agent — 运行集成阶段状态文档（Runtime Integration Status）

> 更新：2026-08-19
> 目的：如实记录「Runtime Integration & Demo Release」阶段的已完成项、未完成项、阻塞原因与恢复步骤。
> 依据：本阶段方案（G0–G6）与实测结果；不夸大完成度。

---

## 1. 总体结论

```text
DSH Runtime Proven  = YES（17 插件真实挂载、13 工具注册、生命周期验证通过）
Baseline E2E        = PASS（无模型确定性链路 + 一次真实 DeepSeek 链路）
Missing E2E         = PASS（无模型）
Conflict E2E        = PASS（无模型，TEMPORAL_VARIANCE + HARD_CONFLICT）
Illegal-order E2E   = PASS（无模型，KNOWLEDGE_RETRIEVAL_REQUIRED 阻断）
20-run Stability    = 部分（无模型 10/10 达标；模型侧 4/20 采样，2 成功 2 超时）
Critical Hallucination = 0
Demo Ready          = 部分（产物齐备；模型侧稳定性未达标，演示可走三级降级）
```

## 2. 已完成并验证（全部有实测证据）

| Gate | 结果 | 证据 |
| --- | --- | --- |
| G0 基线复核 | ✅ | build 4 包通过、67 测试全绿；VERSION-MANIFEST.json（DSH 0.1.0-rc.5 / cordis 4.0.1 / Node 22.22.0 / pnpm 11.7.0） |
| G1-A 配置核对 | ✅ | 修正 patch 方言（唯一 id + `- insert:`）；web/headless 组合树快照含 17 插件行、无报错 |
| G1-B 真实挂载 | ✅ | web 进程监听 3080；verify-g1b：17 插件加载、13 工具注册无重复、重复注册被拒 |
| G1-C 生命周期 | ✅ | verify-g1c：provider 挂载/卸载/恢复、consumer 随服务回归重载、HMR 工具不翻倍、实例唯一（7/7 PASS） |
| G2 确定性链路 | ✅ | verify-g2：13 工具顺序执行、12 Artifact Flag、报告 12 节 + SHA-256 + 原子写入、Session 重放一致（36 项 PASS） |
| G4 四场景 | ✅ | verify-g4：baseline/missing-data/conflict-data/illegal-order 全部通过；产物落盘 artifacts/<scenario>/ |
| G5 无模型部分 | ✅ | verify-g5：10/10 确定性回归（成功率 100%、重放一致 100%）；stability-report.md/json 已生成 |
| G6 演示产物 | ✅ | README-DEMO.md、preflight.mjs（自检全过）、run-web-demo.mjs、run-headless-e2e.mjs、VERSION-MANIFEST、配置快照、sample-report |

## 3. G3 真实 DeepSeek 链路（部分达成）

- ✅ **凭据已配置**：Key 经 DSH 官方凭据机制落盘（`~/.dsh/.credentials.yaml`，0600），headless 启动确认凭据被识别。
- ✅ **一次真实会话已验证**（session-0886ba3b）：模型实际调用全部 13 个 PEN-X1 工具、每个恰 1 次、0 次 Blocked/越级；`turn/start|end`、`step/start|end` 齐全；报告生成（12 节 + Mock 声明 + 三 Gate：工程 CONDITIONAL_GO / 量产 NO_GO / Listing NO_GO）。证据见 `artifacts/g3/G3-VERIFICATION.md`。
- ⚠️ **多次运行未完成**：真实任务单次耗时接近/超过 250s（headless 下模型多轮工具调用 + 长回复），进程常被超时终止；G5-live 并行 2 个任务时 2 个样本因此 `FAIL`（exit 非 0）。这不代表业务链路失败——session 日志显示工具链已完成，而是进程级超时设置问题。

## 4. G5 模型侧 20 次稳定性（未完成）

- 已执行采样：`artifacts/stability/live-results.jsonl` 共 4 条：
  - baseline-1 OK（250s）✅
  - baseline-2 OK（250s）✅
  - baseline-3 FAIL（250s 超时被杀）❌
  - baseline-4 FAIL（250s 超时被杀）❌
- 未执行：baseline 6 次、missing-data 4 次、conflict-data 3 次、illegal-order 3 次，共 16 次。
- **原因**：单次真实任务 >250s 被脚本超时杀掉；并行 2 个任务时 DeepSeek 响应变慢进一步放大超时；此前还出现过一次 `QUOTA: Insufficient Balance`（已恢复）。另：`QUOTA` 曾因账号余额不足拒绝调用（已由用户充值恢复）。

## 5. 未完成项与恢复步骤

### 5.1 G3 补充复核
```bash
node scripts/run-headless-e2e.mjs --live   # 或直接 headless 单次完整任务
```
建议：把真实任务超时放宽到 400–500s（脚本 `TASK_TIMEOUT_MS`），或改用 Web UI 交互（无进程超时）。

### 5.2 G5 模型侧 20 次回归
```bash
node scripts/run-stability-live.mjs --parallel 1   # 串行、断点续跑（已完成 key 自动跳过）
```
建议：
- 串行执行（`--parallel 1`），避免并行放大超时；
- 调大 `TASK_TIMEOUT_MS` 至 450000；
- 每轮跑一批后核对 `artifacts/stability/live-results.jsonl`；
- 达标标准：Terminal Success ≥ 95%、Correct Gate 100%、Workflow Violation 0、Critical Hallucination 0（§12.3）。

### 5.3 后续可选项
- Python 旧实现迁移对照（§13）：需要旧 `agent/*.py` 源码（本地未提供）。
- 重新开启 `exactOptionalPropertyTypes`（§14.3，技术债，非阻断）。

## 6. 数据与产物索引

| 路径 | 说明 |
| --- | --- |
| artifacts/runtime/VERSION-MANIFEST.json | 版本冻结清单 |
| artifacts/runtime/cordis-web.snapshot.txt / cordis-headless.snapshot.txt | profile 组合树快照 |
| artifacts/baseline / missing-data / conflict-data / illegal-order | 四场景产物（报告/trace/projection） |
| artifacts/stability/stability-report.md + .json | 无模型 10/10 稳定性报告 |
| artifacts/stability/live-results.jsonl | 模型侧回归采样结果（断点续跑依据） |
| artifacts/g3/G3-VERIFICATION.md + sample-report-from-live-session.md | 真实链路验证记录 |
| scripts/verify-g1b|g1c|g2|g4|g5.mts | 各 Gate 验证脚本 |
| scripts/run-stability-live.mjs | 模型侧 20 次回归脚本（断点续跑） |
| scripts/preflight.mjs / run-web-demo.mjs / run-headless-e2e.mjs | 演示自检与启动脚本 |
| output/sample-report.md | 示例报告 |

## 7. 诚实声明

- 本阶段**未宣称完成**：G5 模型侧 20 次稳定性未达标；G3 仅有 1 次完整真实会话证据。
- 所有「未完成」均有明确原因（超时设置 / 单次任务耗时 / 外部 QUOTA）与恢复命令，无假装完成的条目。
- 演示环境可使用三级降级（实时 / 确定性 / 已存产物）正常演示（README-DEMO.md §4）。
