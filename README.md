# PEN-X1 产品分析师 AI Agent（DSH 全插件架构）

> 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`0.1.0-rc.5`，Cordis `4.0.1`）构建的原生 Cordis 插件体系，对 PEN-X1（EDC 手电）执行证据驱动的市场、评论、机会、SWOT 与全生命周期风险分析，并生成可审计的 Markdown 报告。
>
> 数据边界：附件事实 + 明确标注的【演示Mock数据】+ 通用行业知识；**禁止真实 Amazon 搜索与业务爬取**。

## 架构总览

```text
DSH Web UI → DeepSeek Agent Loop → Policy / Workflow 插件 → Knowledge 插件
→ Market / Review 数据源插件 → 五个业务分析插件 → Evidence Guard 插件
→ Report 插件 → DSH Session Log + Markdown 文件
```

- **单 Agent + 确定性业务 DAG**（`penx1-dag-v1`），不采用多 Agent。
- **17 个可独立挂载插件**，分布在 3 个运行时代码包 + 1 个契约包 + 2 个分发包。
- 插件间通过 Cordis Service 与类型化数据契约通信；Workflow Guard 按 `TOOL_POLICIES` 策略表实施前置门禁；Evidence Guard 计算置信度、检测冲突并控制报告 Gate；模型只做语义归纳，来源登记、状态转换与门禁全部由代码控制。

## 包结构

| 包 | 说明 |
| --- | --- |
| `@penx1/contracts` | 公共契约：类型、Schema、错误码、`TOOL_POLICIES`、`TOOL_COMPLETED_FLAGS`、Context 类型接缝（非插件） |
| `@penx1/dsh-core` | run-state / evidence-guard / policy / task-planner / workflow-guard / trace |
| `@penx1/dsh-data` | knowledge（词法检索）/ market-source-mock / market-tool / review-source-mock / review-tool |
| `@penx1/dsh-analysis` | market-analysis / review-mining / opportunity / swot / risk / report |
| `@penx1/dsh-bundle` | `cordis.patch.yml`（17 插件按 §5.2 顺序挂载）+ `cordis.patch.dev.yml`（绝对路径开发版） |
| `@penx1/dsh-profile` | Web（dsh-base + dsh-web-app + bundle）与 Headless（dsh-base + dsh-headless + bundle）组合 |

模型可见工具共 13 个：`penx1_start_analysis`、`penx1_get_status`、`penx1_plan_tasks`、`penx1_retrieve_knowledge`、`penx1_fetch_market_mock`、`penx1_fetch_reviews_mock`、`penx1_analyze_market`、`penx1_mine_review_pains`、`penx1_identify_opportunities`、`penx1_build_swot`、`penx1_build_risk_register`、`penx1_validate_evidence`、`penx1_generate_report`。

## 快速开始

### 环境要求

```text
Node.js 22.19+
pnpm 11.7.0（corepack prepare pnpm@11.7.0 --activate）
DSH 冻结仓库 deepseek-ai/deepseek-harness（0.1.0-rc.5，本地克隆）
```

### 安装与验证

```bash
# 在本仓库根目录
pnpm install
pnpm -r build       # 4 个代码包 tsc -b
pnpm -r test        # 67 个 vitest 测试

# 无模型回归（不需要 API Key，需在 DSH 仓库目录执行）
cd /mnt/workspace/DSH/deepseek-harness
node --import tsx/esm <本仓库>/scripts/verify-g1b.mts   # 17 插件 + 13 工具注册
node --import tsx/esm <本仓库>/scripts/verify-g1c.mts   # ctx.provide() 生命周期
node --import tsx/esm <本仓库>/scripts/verify-g2.mts    # 确定性全链路
node --import tsx/esm <本仓库>/scripts/verify-g4.mts    # 四场景 E2E
node --import tsx/esm <本仓库>/scripts/verify-g5.mts 10 # 确定性稳定性回归
```

### 启动演示

```bash
node scripts/preflight.mjs          # 演示前自检
node scripts/run-web-demo.mjs       # DSH Web（http://127.0.0.1:3080）
node scripts/run-headless-e2e.mjs   # 无模型回归；--live 走真实 DeepSeek（需 API Key）
```

真实链路需要 DeepSeek API Key：写入 DSH 凭据（`~/.dsh/.credentials.yaml`，权限 0600，ref 名 `DEEPSEEK_API_KEY`）或由 DSH Web Models 页面配置。

## 验证状态（Gate）

| Gate | 结果 | 证据 |
| --- | --- | --- |
| G0 基线复核 | ✅ | `artifacts/runtime/VERSION-MANIFEST.json` |
| G1 配置核对 + 真实挂载 | ✅ | `artifacts/runtime/cordis-web.snapshot.txt`、`cordis-headless.snapshot.txt` |
| G1-B/G1-C 插件与服务 | ✅ | `scripts/verify-g1b.mts`、`verify-g1c.mts` |
| G2 无模型确定性链路 | ✅ | `scripts/verify-g2.mts`（36 项 PASS） |
| G4 四场景 E2E | ✅ | `artifacts/baseline|missing-data|conflict-data|illegal-order/` |
| G5 无模型稳定性 | ✅ | `artifacts/stability/stability-report.md`（10/10，成功率 100%） |
| G3 真实 DeepSeek 链路 | ✅ | `artifacts/g3/G3-VERIFICATION.md`（1 次完整会话：13 工具全调用、0 违规、三 Gate 正确） |
| G5 模型侧 20 次 | ❌ FAIL（未达标；业务层已修复，当前被外部配额阻塞） | 2026-08-24 完整回归（执行层 20/20；REPORT_READY 6/20、Correct Gate 1/6、内置 write 旁路 14/20、身份漂移 12/20；根因 maxSteps=18 配置优先级 bug，详见 `artifacts/stability/G5-LIVE-20260824.md` §3-4）；2026-08-25 修复后重跑（maxSteps=50 + Gate 枚举校验）：baseline-1~4 成功、三 Gate 正确（CONDITIONAL_GO）、0 旁路，整体 4/20（20%）；2026-08-26 强行试跑：20/20 执行、成功 5/20（25%，新增 illegal-order-3：Guard 正确拦截越序）、15 例全部 LIFECYCLE 基础设施层失败（sensenova 分钟级配额耗尽，外部依赖；详见 `G5-REGRESSION-STATUS.md` §7.5-7.6） |

> 完整、如实的状态记录（含未完成项与恢复步骤）：**`artifacts/runtime/RUNTIME-STATUS.md`**。

## 目录结构

```text
.
├─ packages/          # contracts / dsh-core / dsh-data / dsh-analysis / dsh-bundle / dsh-profile
├─ data/              # knowledge_base / mock_prices / mock_reviews / scenarios / risk_templates / taxonomy / glossary
├─ prompts/           # penx1-system.md（10 个硬约束 Section）
├─ scripts/           # preflight / run-web-demo / run-headless-e2e / run-stability-live / verify-g1b..g5
├─ artifacts/         # runtime（版本清单、配置快照、状态文档）/ 四场景 / stability / g3
├─ output/            # 报告输出（output/dsh、sample-report.md）
└─ docs/              # （预留）
```

## 文档索引

| 文档 | 说明 |
| --- | --- |
| `README-DEMO.md` | 现场演示脚本、数据边界与三级降级方案 |
| `artifacts/runtime/RUNTIME-STATUS.md` | 运行集成阶段状态（已完成/未完成/恢复步骤） |
| `artifacts/runtime/VERSION-MANIFEST.json` | 冻结版本清单 |
| `artifacts/g3/G3-VERIFICATION.md` | G3 真实链路验证记录 |
| `artifacts/stability/stability-report.md` | G5 无模型稳定性报告 |

## 许可与归属

MIT；业务数据为演示 Mock，仅供本产品分析演示使用。
