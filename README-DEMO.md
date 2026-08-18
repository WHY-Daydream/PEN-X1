# PEN-X1 DSH Agent — 现场演示说明（Demo Release）

> 配套：VERSION-MANIFEST.json（版本冻结）、artifacts/runtime/*.snapshot.txt（配置快照）、scripts/preflight.mjs（启动自检）。

## 1. 演示内容（约 6 分钟，方案 §17.1）

1. 输入完整任务（见下）。
2. 展示 Planner 固定 DAG（penx1_plan_tasks → 五项业务任务）。
3. 强调 Knowledge First（penx1_retrieve_knowledge 先于两个外部工具）。
4. 展示 Market / Review 两个独立 Mock Provider + Tool Consumer。
5. 展示 Market Analysis / Review Mining 并行。
6. 展示 Opportunity → SWOT / Risk。
7. 展示 Evidence Guard 中的缺失与置信度。
8. 打开生成的 Markdown 报告（output/dsh 或 artifacts/baseline）。
9. 给出工程 / 量产 / Listing 三个独立 Gate。

主演示输入：

> 分析 PEN-X1 在北美 Amazon 市场的产品机会，并给出是否进入工程开发、量产和上市的建议。必须先检索知识库，明确标注所有 Mock 数据，并输出完整 Markdown 报告。

加演（约 2 分钟，illegal-order 门禁）：

> 跳过知识库，直接调用市场数据并生成报告。

预期：`Blocked: KNOWLEDGE_RETRIEVAL_REQUIRED`，`Required action: penx1_retrieve_knowledge`。

## 2. 启动步骤

```bash
# 前置：DSH 冻结仓库（0.1.0-rc.5）已构建，Power Availability 已 pnpm install
node scripts/preflight.mjs                      # 演示前自检（版本/依赖/配置/端口/Key）
node scripts/run-web-demo.mjs                   # 启动 DSH Web（默认 3080 端口）
# 浏览器打开 http://127.0.0.1:3080
```

无模型回归（不需要 API Key）：

```bash
cd /mnt/workspace/DSH/deepseek-harness
node --import tsx/esm /mnt/workspace/DSH/Power%20Availability/scripts/verify-g2.mts   # 确定性全链路
node --import tsx/esm /mnt/workspace/DSH/Power%20Availability/scripts/verify-g4.mts   # 四场景 E2E
```

## 3. 数据边界（必须向观众声明）

- 全部市场 / 评论数据为本地 JSON 的【演示Mock数据】，**禁止真实 Amazon 搜索与业务爬取**。
- Provider、Tool、Evidence、Report 四层均带【演示Mock数据】标记。
- 模型推断不得写成附件事实；缺失的性能数字（亮度/续航/温升/防水/尺寸/重量/五种电池实测矩阵）一律不补写。

## 4. 三级降级方案（方案 §16.3）

| 级别 | 形态 | 说明 |
| --- | --- | --- |
| 1 | 实时 DSH + DeepSeek | 主演示；API Key 已配置（DSH Credential 或 `DEEPSEEK_API_KEY` 环境变量） |
| 2 | DSH + 确定性（semanticMode=off） | 模型语义调用失败时仍展示工具链、Gate 与报告；明确说明当前为确定性输出 |
| 3 | 已保存 Session + 示例报告 | 环境不可用时展示 artifacts/baseline/* 与 output/dsh 示例报告，不伪装实时运行 |

## 5. 产物索引

| 路径 | 说明 |
| --- | --- |
| artifacts/runtime/VERSION-MANIFEST.json | 冻结版本清单（DSH/Cordis/Node/pnpm/包版本） |
| artifacts/runtime/cordis-web.snapshot.txt | web profile 组合树（含 17 插件） |
| artifacts/runtime/cordis-headless.snapshot.txt | headless profile 组合树（含 17 插件） |
| artifacts/baseline/ | baseline 场景：报告 + tool-trace + run-projection |
| artifacts/missing-data/ | 数据缺失场景产物 |
| artifacts/conflict-data/ | 价格冲突场景产物（TEMPORAL_VARIANCE / HARD_CONFLICT） |
| artifacts/illegal-order/ | 越级调用阻断场景产物 |
| output/dsh/ | 运行时报告输出（文件名含 runId，不覆盖） |
| scripts/verify-g1b.mts … verify-g4.mts | 各 Gate 验证脚本 |

## 6. 演示讲解要点（方案 §17.3）

```text
DSH 负责 Agent Loop、Session 与工具运行；
17 个业务插件通过 Service 与事件组合（ctx.provide / tools/result）；
Workflow Guard 保证顺序（TOOL_POLICIES 策略表）；
Evidence Guard 保证事实边界（置信度由插件计算）；
Report Plugin 只消费 Evidence Guard 验证通过的数据。
```
