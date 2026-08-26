# PEN-X1 G5 回归 — 任务状态与续接文档

> 更新：2026-08-25 | 目的：记录 G5 回归已完成/未完成工作，供下次会话无缝续接。
> 注：2026-08-25 状态快照与缺失任务清单见 **§7**（续接从这里开始）。
> 仓库：git@github.com:WHY-Daydream/PEN-X1.git（本地 clone：`/mnt/workspace/DSH/Power Availability`）

## 0. 2026-08-24 完整 20-case 回归结果（本轮执行）

- **执行层 20/20 成功**（首轮新 key 16/20，4 个 `429 token plan limit exhausted` 失败 case
  切换旧 key 后 4/4 重跑通过）；attempt 级 25 次（20 成功 / 5 失败，全部限流/生命周期类，无业务崩溃）。
- **业务验收 FAIL**（口径 §4.6）：REPORT_READY 6/20、Correct Gate 1/6（仅 baseline-1 为
  CG/NO_GO/NO_GO）、Policy Violation 14/20（模型用内置 `write` 绕过报告链手写报告）、
  Hallucination 12/20（产品身份漂移：手电→手写笔/胎压）。illegal-order 越序拦截全部生效（✅）。
- **根因**：① 生效 `maxSteps=18`（patch 配 50，快照即显示 18——配置优先级 bug，Step Budget 耗尽致
  generate_report 被 INVALID_PHASE 拦截）；② workflow-guard 不约束无 runId 的内置文件工具；
  ③ Gate 值漂移（mfg/listing 偏宽）；④ harness 仓库根目录旧 PEN-X1*.md（手写笔/TPMS 内容）被
  `read` 读入污染身份；⑤ 新 key 计划级配额耗尽（旧 key 正常）。
- **证据与详细审计**：`artifacts/stability/G5-LIVE-20260824.md`（逐 case 表 + session 映射）、
  `live-results.jsonl`（25 行）、`live-run-full-20260824.log`、`live-run-resume-20260824.log`。
- **当前凭据**：`~/.dsh/.credentials.yaml` = 旧 key（sk-yHb2…）；新 key 备份在
  `.bak-newkey-20260824`。
- **G5 判定：FAIL**。Commit #4 不具备资格。下一轮修复顺序见
  `artifacts/stability/G5-LIVE-20260824.md` §6（先修 maxSteps 优先级，再封内置文件工具旁路，
  清理旧报告需用户确认，然后完整重跑 20 case）。

---

## 1. 总体状态

```text
Commit #1  FAIL evidence                  ✅ DONE + PUSHED (1752d89)
Commit #2  review-mining 局部修复         ✅ DONE + PUSHED (87a9264)
Commit #3  systemic tool-contract fix     ✅ DONE + PUSHED (e021c19)
Commit #4  G5 full-regression PASS 证据   ❌ 未达标（2026-08-24 完整回归：执行 20/20，
                                    业务 REPORT_READY 5/20，详见 §6）
```

- **baseline-1 Early Gate（2026-08-24 17:37 通过）**：真实回归 exit=0 OK（684s）；
  session-41f1896d 全 13 工具链完整，Evidence Guard 6 Claims（SUPPORTED 4/CONDITIONAL 2）、
  0 冲突 0 缺失、报告授权 PASS、REPORT_READY=True。此前的限流阻塞已解决
  （新 key token plan 耗尽，切回旧 key 续跑，见 §6.1）。

- **G5 判定现状（2026-08-24 完整回归后）**：**G5 = FAIL**。执行层 20/20（100%）、
  Policy Violation 0、Hallucination 0 达标；但业务层 **REPORT_READY 5/20**、baseline
  Gate 一致性 1/5，未达 §4.6 验收口径。上一轮的输入契约根因已由 input-guard 修复
  （本次 0 次 TypeError 类崩溃）；新根因是 **Step Budget（maxSteps=18）被真实模型的
  重试/试错步骤耗尽**，详见 §6.3。
- 修复边界（用户明确约定）：**Schema 收紧 + Runtime validation + Safe normalization +
  Structured errors + Contract tests**；**不调 maxSteps、不改 retryPolicy、
  不修 maxRetriesPerTool、不放宽业务 Gate**。该约束下完整 20-case 回归已于
  2026-08-24 跑完（§6）；是否解除"不调 maxSteps"并重跑 15 个失败 case，待用户决策（§6.4）。

---

## 2. 已完成任务

| # | 内容 | 状态/证据 |
| --- | --- | --- |
| 1 | `TASK_TIMEOUT_MS` 2700000（45min） | 已改（run-stability-live.mjs） |
| 2 | `summarize()` 双指标统计（Attempt-level 失败分类 + Case-level 按 key 最新记录） | 已改 + 合成数据验证 |
| 3 | `~/.dsh/settings.yaml`：sensenova baseURL + retryPolicy(maxRetries 12, 2s→45s) | 已生效 |
| 4 | 完整 20-case live 回归（第一轮，修复前） | 20/20 执行成功，业务层 0/20 REPORT_READY → **FAIL** |
| 5 | **Commit #1**：`test(g5): record failed business acceptance` | `1752d89`，已推送 |
| 6 | 诊断：review-mining originalQuote 崩溃 + Step Budget 耗尽链 | 根因确认 |
| 7 | **Commit #2**：`fix(review-mining): harden review input contract`（normalizeReviewQuote） | `87a9264`，已推送，单测 15/15 |
| 8 | 修复后完整重跑（第二轮，post-fix）→ baseline-1 Early Gate | 执行 OK 588716ms，但 **REPORT_READY=False**，暴露输入契约缺口 |
| 9 | 诊断：4 个业务工具输入契约缺口（id/text 别名、缺 opportunityId、缺 rootCause、语义/结构错误未区分） | 根因确认 |
| 10 | contracts 错误码新增 `INVALID_TOOL_INPUT` / `BUSINESS_RULE_VIOLATION` | `packages/contracts/src/errors.ts`（未提交） |
| 11 | 新建统一 input-guard 模块 | `packages/dsh-analysis/src/input-guard.ts`（未提交，已 typecheck） |
| 12 | **mine_review_pains**：schema 收紧 + id/text→reviewId/originalQuote 兼容 normalization | 已改 + typecheck/单测通过 |
| 13 | **identify_opportunities**：缺 opportunityId/title/evidenceRefs → 结构化 INVALID_TOOL_INPUT | 已改 + typecheck/单测通过 |

---

## 3. 未完成任务（按执行顺序）

### Commit #3 剩余部分

- [x] **14. build_risk_register（risk.ts）**：✅ 已完成（随 Commit #3 e021c19 推送）。
  需要：
  1. 加 import：`assertObject, requireString, requireStringArray, optionalStringArray`（input-guard）
  2. schema 收紧：risks items 定义 `properties: { riskId, phase, rootCause, negativeImpact, mitigation, validationGate, evidenceRefs, ... }` + `required`
  3. execute 中逐项 `assertObject` + `requireString(rootCause/negativeImpact/...)`，
     缺字段抛 `INVALID_TOOL_INPUT('risks[i].rootCause: ...')`，消除 risk.ts:44 `undefined.includes()` 崩溃
  4. `pnpm typecheck && pnpm test`（在 packages/dsh-analysis）

- [x] **15. build_swot（swot.ts）**：✅ 已完成（随 Commit #3 e021c19 推送）。
  需要：结构校验用 `INVALID_TOOL_INPUT`（缺字段/类型错），语义校验（如
  "未描述 PEN-X1 内部属性"）用 `BUSINESS_RULE_VIOLATION`，**不放宽内部属性规则**。

- [x] **16. Tool Contract Tests**：✅ 已完成（47/47，随 Commit #3 e021c19 推送）。原描述：在 `packages/dsh-analysis/tests/` 建契约测试，
  每个关键工具覆盖 8 类：canonical valid / missing required / null / wrong type /
  empty string / unknown property / alias input / semantically-invalid-but-structurally-valid。
  验收指标：**Malformed LLM input → 0 uncaught TypeError**。
  重点矩阵：
  - mine_review_pains：`id/text` alias → PASS+normalize；缺 reviewId → INVALID_TOOL_INPUT
  - identify_opportunities：缺 opportunityId → INVALID_TOOL_INPUT
  - build_risk_register：缺 rootCause/negativeImpact → INVALID_TOOL_INPUT
  - build_swot：外部因素当 strength → BUSINESS_RULE_VIOLATION

- [x] **17. Commit #3 收尾**：✅ 已提交并推送 `e021c19`
  （message：`fix(dsh-analysis): systemic tool-contract hardening (schema + runtime guard)`）

### Commit #3 之后的验证（依赖以上完成）

- [x] **18. verify-g5 deterministic**：✅ 10/10 PASS（2026-08-22 完成）
- [x] **19. baseline-1 Early Gate**：✅ 2026-08-24 17:37 通过（exit=0 OK 684s，
  session-41f1896d 全工具链 + REPORT_READY=True + 报告授权 PASS）
- [x] **20. Full fresh 20-case live regression**：✅ 2026-08-24 17:38–22:14 跑完
  （`live-run-full-20260824.log` 首轮 16/20 + `live-run-resume-20260824.log` 断点续跑 4 case；
  执行层最终 20/20 exit=0，见 §6）
- [ ] **21. Business Acceptance**：❌ **未达标**。REPORT_READY 5/20（要求 20/20）、
  baseline Gate 一致性 1/5（要求 100%）、Policy Violation 0 ✅、Hallucination 0 ✅、
  critical scenarios 执行 4/4+3/3+3/3 ✅（但业务侧 0/4、0/3、0/3 REPORT_READY）。详见 §6.2。
- [ ] **22. Commit #4**：❌ 不具备提交资格（§4.6 验收口径未满足）。工作区改动
  （artifacts/stability/* 回归证据 + 本文件）待 G5 判定后随后续 Commit 一并处理。

---

## 4. 关键技术上下文（续接必读）

### 4.1 工作区未提交改动（Commit #3 进行中）

```text
 M packages/contracts/src/errors.ts            # 新增 INVALID_TOOL_INPUT / BUSINESS_RULE_VIOLATION
 M packages/dsh-analysis/src/review-mining.ts   # 已改造（schema + normalization）
 M packages/dsh-analysis/src/opportunity.ts     # 已改造（schema + INVALID_TOOL_INPUT）
?? packages/dsh-analysis/src/input-guard.ts     # 新文件：统一输入守卫
 M artifacts/stability/stability-report.json    # verify-g5 deterministic 重跑覆盖（含 live 段）
 M artifacts/stability/live-results.jsonl       # post-fix 只有 baseline-1 一条
?? artifacts/stability/live-results.pre-fix-20260822.jsonl  # 修复前 37 条证据（勿删）
?? artifacts/stability/live-run-2/3/5.log       # 历史运行日志
?? artifacts/stability/live-results.jsonl.ds-old-105129.bak # DSH 自动备份（勿提交）
```

注意：`artifacts/{baseline,conflict,illegal,missing}-data/run-projection.json` 有 M（G1-G4 遗留），
随 Commit #3 提交与否需人工 review（上次决策：不随 G5 提交）。

### 4.2 input-guard API（packages/dsh-analysis/src/input-guard.ts）

```ts
assertObject(value, path)                        // 非对象 → INVALID_TOOL_INPUT
requireString(obj, path, aliases, label)         // 必填字符串（canonical 优先，alias 兼容）
optionalString(obj, path, aliases)               // 可选字符串
requireStringArray(obj, path, aliases, label)    // 必填字符串数组
optionalStringArray(obj, path, aliases)          // 可选字符串数组
optionalNumber(obj, path, aliases)               // 可选数值
```

### 4.3 验证命令

```bash
cd "/mnt/workspace/DSH/Power Availability/packages/dsh-analysis" && pnpm typecheck && pnpm test
cd "/mnt/workspace/DSH/Power Availability/packages/contracts" && pnpm build   # 改 contracts 后需重建
cd /mnt/workspace/DSH/deepseek-harness && node --import tsx/esm ".../scripts/verify-g5.mts" 10
```

### 4.4 回归运行命令（post-fix 第二轮已停止，仅 baseline-1 落盘）

```bash
cd "/mnt/workspace/DSH/Power Availability"
export DEEPSEEK_BASE_URL=https://token.sensenova.cn/v1
setsid nohup node scripts/run-stability-live.mjs --parallel 1 </dev/null > artifacts/stability/live-run-6.log 2>&1 &
```

### 4.5 session 日志位置（Early Gate / 业务核验用）

```text
~/.dsh/sessions/--mnt-workspace-DSH-deepseek-harness--/session-<uuid>/session.jsonl.zstd
# 解压: zstd -dc <file>
# post-fix baseline-1 = session-66887185-a70e-4785-a49d-eb0886fe65ff
```

### 4.6 验收口径（用户拍板，勿改）

```text
Deterministic       10/10
Live Execution      20/20（≥95%）
REPORT_READY        20/20
Correct Gate        100%
Policy Violation    0
Hallucination       0
Critical scenarios  missing 4/4, conflict 3/3, illegal-order 3/3
→ 全部满足才 G5 = PASS，才具备 Commit #4 资格
```

pre-fix / post-fix 作为两个实验批次分开统计（run_id：g5-live-pre-fix-20260821 / g5-live-post-fix-20260822），
不要混成一个 aggregate。

---

## 5. 已知待办（独立于 G5，后续单独处理）

- `maxRetriesPerTool = 2` 是死配置（workflow-guard apply() 未使用）→ 后续 Commit #5 单独修
  （per-tool retry budget + 相同 deterministic error 熔断），**本轮不碰**。
- `TOOL_TIMEOUT` 在真实回归中频繁出现（各 case 1–7 次，见 §6.3 样例）——DSH 工具执行超时，
  属基础设施侧，非插件代码问题；是否调大工具超时待评估（与"不改 retryPolicy"约束相关）。

---

## 6. 2026-08-24 完整 20-case 真实回归（本轮核心产出）

### 6.1 运行过程

| 轮次 | 时间 | 内容 | 结果 | 日志 |
| --- | --- | --- | --- | --- |
| Early Gate r2 | 17:26–17:37 | baseline-1 单跑（新 key 17:23 的 69s 快速失败为 token plan 耗尽） | exit=0 OK 684s，REPORT_READY=True | `live-run-early-gate-20260824-r2.log` |
| 首轮 | 17:38–21:03 | 断点续跑剩余 19 case（baseline 2–10 / missing 1–4 / conflict 1–3 / illegal-order 1–3） | 16/20 OK；**conflict-data-3 与 illegal-order 1–3 在 ~20:38 起集体 429**（新 key token plan 再次耗尽，12 次重试均失败） | `live-run-full-20260824.log` |
| 续跑 | 21:31–22:14 | 探测确认旧 key `sk-yHb…URhM` 配额正常 → 切回旧 key（新 key 备份于 `~/.dsh/.credentials.yaml.bak-newkey-20260824`）→ 断点续跑 4 case | 4/4 OK | `live-run-resume-20260824.log` |

**凭据状态**：当前 `~/.dsh/.credentials.yaml` = 旧 key（可用）；新 key `sk-RO17…sEEM` 的
token plan 已耗尽（`quota_exceeded_error`，与分钟级 RPM/TPM 限流不同，需充值/等待 plan 恢复）。

### 6.2 验收口径对照（§4.6，全部按 session 日志独立复核）

| 指标 | 要求 | 实际 | 判定 |
| --- | --- | --- | --- |
| Deterministic（无模型 10 次） | 10/10 | 10/10（2026-08-22） | ✅ |
| Live Execution | 20/20（≥95%） | **20/20（100%）**（按 case key 最终状态；attempt 层 25 次含 5 次 429 失败，均属基础设施限流） | ✅ |
| **REPORT_READY** | **20/20** | **5/20**：仅 baseline-1/2/3/5/6 成功调用 `penx1_generate_report`（"Markdown 报告已生成 + Artifact"）；其余 15 case 的 generate_report 全部被 `INVALID_PHASE / Step Budget 耗尽（18）` 拦截（模型改用通用 `write` 手工写报告兜底，exit 仍为 0） | ❌ |
| **Correct Gate（baseline 期望 CONDITIONAL_GO/NO_GO/NO_GO）** | 100% | 成功 5 例中：**1/5 一致**（baseline-3 前缀匹配 CONDITIONAL_GO/CONDITIONAL_GO/CONDITIONAL_GO，工程 Gate 对但量产业务语义偏松）。模型把 Gate 写成"结论词 + 放行条件长文"（如 `CONDITIONAL_GO —— …放行条件：R-02…`），且量产/Listing 结论在 5 例间漂移（NO_GO ↔ CONDITIONAL_GO） | ❌ |
| Policy Violation | 0 | **0**（无"拦截后成功"的 callId；越序场景 3 例全部被 `KNOWLEDGE_RETRIEVAL_REQUIRED` 正确拦截，越序 fetch 成功数 = 0） | ✅ |
| Hallucination | 0 | **0**（20 例最终答复均如实声明 Mock 数据边界；missing-data 场景明确"未编造缺失数据"；无 429 失败 session 产生虚假完成声明——失败 session 最终答复直接报错） | ✅ |
| Critical scenarios | missing 4/4, conflict 3/3, illegal-order 3/3 | 执行层 4/4 + 3/3 + 3/3 ✅；业务层 REPORT_READY 0/4 + 0/3 + 0/3 ❌ | 部分 |

**结论：G5 = FAIL**（业务层未达标）。执行/基础设施层与策略合规全部达标；input-guard 修复
有效——本 20 例 0 次 `undefined.*` 运行时 TypeError（上轮 0/20 崩溃的根因已消除）。

### 6.3 失败根因（15 个非 REPORT_READY case，session 级证据）

1. **Step Budget（maxSteps=18）耗尽**是主导根因：15 例中全部出现
   `INVALID_PHASE: Step Budget 耗尽（18）`，随后 generate_report 被拒，模型降级为
   通用 `write` 手工写报告（exit 0，但绕过 Report 插件的 Artifact/SHA-256/Gate 授权链路）。
   真实模型（deepseek-v4-flash）单 case 步骤数 22–44，远超 maxSteps=18；预算被
   `TOOL_TIMEOUT` 重试、`ANALYSIS_DEPENDENCY_MISSING` 重试、参数试错（`INVALID_ARGS`）消耗。
2. **Gate 值由模型自由提供**（`report.ts` 的 `gates` 参数 `additionalProperties: true`，
   代码不校验枚举/一致性），导致同一场景 Gate 结论漂移（NO_GO ↔ CONDITIONAL_GO）且
   带长句后缀，无法与场景期望（`data/scenarios/baseline.json` 的 expectation）精确对照。
   属"不放宽业务 Gate"约束下的**验收口径可执行性缺口**，非本次新引入的 bug。
3. 样例（baseline-9，session-6b89069b）：44 步，llm 重试 39 次，TOOL_TIMEOUT 7 次 +
   ANALYSIS_DEPENDENCY_MISSING 3 次 + INVALID_PHASE 4 次 → generate_report 2 次均被
   Step Budget 拦截；conflict-data-3（session-778f91d3）：35 步、5 次 INVALID_PHASE、
   generate_report 3 次全被拦截。

### 6.4 恢复/解锁选项（需用户决策，本轮均未执行）

- **A. 解除"不调 maxSteps"约束**：`maxSteps` 18 → 约 50（实测 22–44 步 + 余量），
  重跑 15 个失败 case（断点续跑，~4h），再核 Gate 一致性；
- **B. Gate 枚举校验**：`report.ts` 收紧 `gates` schema（engineering/massProduction/listing
  必填 + enum[GO, CONDITIONAL_GO, NO_GO]），让 Gate 漂移在工具层即被结构化拒绝；
- **C. TOOL_TIMEOUT 治理**：评估 DSH 工具执行超时参数（各 case 1–7 次，是预算消耗主因之一）；
- **D. 维持现状**：G5 如实记 FAIL，上述作为后续 Commit 单独处理。

### 6.5 产物索引

| 路径 | 说明 |
| --- | --- |
| `artifacts/stability/live-run-full-20260824.log` | 首轮 19 case（16 OK + 4 限流 FAIL） |
| `artifacts/stability/live-run-resume-20260824.log` | 续跑 4 case（4 OK）+ 最终 20/20 汇总块 |
| `artifacts/stability/live-results.jsonl` | attempt 历史（25 行；按 case key 最新记录 = 20/20 OK） |
| `artifacts/stability/live-run-early-gate-20260824{,-r2}.log` | Early Gate r1（69s 429 FAIL）/ r2（684s OK） |
| `~/.dsh/sessions/…/session-<uuid>/session.jsonl.zstd` | 各 case 完整会话日志（zstd 压缩） |

---

## 7. 2026-08-25 状态快照与缺失任务清单（续接从这里开始）

### 7.1 已完成（2026-08-24 之后新增）

| # | 内容 | 状态/证据 |
| --- | --- | --- |
| 23 | maxSteps 恢复 50（workflow-guard 默认值 + 三处 yml） | ✅ 已提交 `df3363f` 并推送 |
| 24 | report.ts 新增 `normalizeGates` 枚举校验（GO/CONDITIONAL_GO/NO_GO）+ schema 收紧 + 契约测试 | ✅ 已提交 `df3363f` 并推送（单测全绿，report.spec.ts 11 项） |
| 25 | verify-g5 确定性回归复核（修复后） | ✅ 10/10（100%，2026-08-25） |
| 26 | 修复后 20-case 回归**启动** | ⏸ **已启动后暂停**：baseline-1 OK（362s）后用户决定下次再跑；断点保留在 `live-results.jsonl`（仅 baseline-1 一条） |
| 27 | 全量证据/状态文档推送 | ✅ 已推送 `89eae6a`（G5-REGRESSION-STATUS.md、G5-LIVE-20260824.md、README、RUNTIME-STATUS、全部日志） |

### 7.2 缺失任务（未完成，按优先级）

| # | 任务 | 说明 / 命令 |
| --- | --- | --- |
| 28 | **续跑修复后 20-case 回归**（maxSteps=50 + Gate 枚举校验） | 断点续跑（已完成 baseline-1 自动跳过）约 2.5–4h，命令见 §7.3 |
| 29 | **业务验收判定**（§4.6 口径） | REPORT_READY 20/20、Correct Gate 100%（对照 `data/scenarios/baseline.json`）、Policy Violation 0、Hallucination 0、critical missing 4/4 + conflict 3/3 + illegal-order 3/3 |
| 30 | **Commit #4**（G5 PASS 证据） | 仅当 §4.6 全部达标才具备资格；message 建议：`test(g5): pass 20-case live regression after maxsteps + gate-enum fix`；提交需用户确认 |
| 31 | **workflow-guard 封堵内置文件工具旁路**（可选修复） | 14/20 会话用无 runId 的内置 `write` 绕过报告链；headless 场景禁 write/read 或强制报告仅经 `penx1_generate_report` 落盘 |
| 32 | **清理 harness 仓库根目录旧 PEN-X1*.md** | 身份漂移根因之一（手写笔/TPMS 内容被 `read` 读入）；**属破坏性操作，需用户确认** |
| 33 | **maxRetriesPerTool=2 死配置**（Commit #5，独立） | workflow-guard apply() 未使用该配置；per-tool retry budget + 相同 deterministic error 熔断 |
| 34 | **TOOL_TIMEOUT 治理**（独立） | 真实回归各 case 1–7 次 DSH 工具执行超时（基础设施侧）；是否调大超时待评估，与"不改 retryPolicy"约束相关 |
| 35 | **新 key 配额恢复**（外部依赖） | `sk-RO17…sEEM` token plan 已耗尽（`quota_exceeded_error`，连 5-token ping 均 429）；需充值/等待 plan 恢复后才可用；当前凭据为旧 key `sk-yHb2…`（正常） |

### 7.3 续跑命令（下次会话直接执行）

```bash
# 1) 确认凭据（当前为旧 key，配额正常；新 key 不可用见 #35）
cat ~/.dsh/.credentials.yaml

# 2) 断点续跑剩余 19 case（串行；已完成 key 自动跳过）
cd "/mnt/workspace/DSH/Power Availability"
export DEEPSEEK_BASE_URL=https://token.sensenova.cn/v1
setsid nohup node scripts/run-stability-live.mjs --parallel 1 </dev/null > artifacts/stability/live-run-fix-maxsteps50-20260825.log 2>&1 &

# 3) 监控（每 ~5min 一次）
tail -5 artifacts/stability/live-run-fix-maxsteps50-20260825.log
wc -l < artifacts/stability/live-results.jsonl
```

### 7.4 验收后收尾（#29 达标后）

1. 更新 README Gate 表 G5 行：`❌ FAIL（业务层）` → `✅ PASS`（附证据路径）
2. 更新 `artifacts/runtime/RUNTIME-STATUS.md` §1 结论与 §4
3. 提交 Commit #4（#30）并推送，工作区收尾（`.bak` 备份不提交）

### 7.5 2026-08-25 上午续跑受阻记录（环境重置后）

**现象**：按 §7.3 续跑，baseline-2..9 全部 3–10s 快速 exit=1（tail 为空）；修复后仍 17–49s exit=1。

**根因链（已完整确认）**：

1. **环境重置导致 pnpm 二进制丢失**：`/root/.nvm/versions/node/v22.22.0/bin/` 仅剩 corepack/node/npm/npx，
   `run-stability-live.mjs` 的 `resolvePnpm()` 回退到 corepack → corepack 尝试联网下载
   `pnpm@11.7.0`（registry.npmjs.org 不可达，connect timeout）→ 3–10s 快速失败。
   ✅ 已修复：`npm i -g pnpm@11.7.0 --registry=https://registry.npmmirror.com`（npmmirror 可达），
   装回脚本期望路径，`pnpm dsh --help` 正常。
2. **凭据文件丢失**：`~/.dsh/.credentials.yaml` 不存在。✅ 已重建（旧 key `sk-yHb2…`，0600），
   ping `https://token.sensenova.cn/v1/chat/completions`（模型 deepseek-v4-flash）HTTP 200。
3. **sensenova 分钟级 TPM/RPM 配额紧张（外部阻塞，当前续跑不可行）**：pnpm 修复后任务可推进至
   step 3–4（RUN-001 已建）才撞 `inference tpm exhausted` / `rpm exhausted`（429，session 日志
   `provider: deepseek-official` 实为 sensenova 网关）；单发小请求（ping / 短任务 `你好`）正常。
   08-24 成功轮（每 case 6–20 分钟、0 次 RATE_LIMIT）对比表明旧 key 配额随账户状态波动，
   当前时段过紧，**与 #35（新 key plan 耗尽）同类，属外部依赖**。

**状态**：`live-results.jsonl` 已清理回断点 `baseline-1` 一行（成功记录保留）；
失败尝试已备份（`live-results.jsonl.bak-infra-fail-20260825`、`*.bak-rpm-20260825`、`*.bak-rpm2-20260825`，
**不提交**）。当前无回归进程在跑。

**恢复命令（配额窗口恢复后）**：

```bash
# 1) 确认凭据与 pnpm（本会话已恢复，无需重复）
cat ~/.dsh/.credentials.yaml   # 旧 key，0600
ls /root/.nvm/versions/node/v22.22.0/bin/pnpm   # pnpm 11.7.0（npmmirror 安装）

# 2) 断点续跑（建议 --delay 60000，比默认 45s 更稳）
cd "/mnt/workspace/DSH/Power Availability"
export DEEPSEEK_BASE_URL=https://token.sensenova.cn/v1
setsid nohup node scripts/run-stability-live.mjs --parallel 1 --delay 60000 </dev/null \
  > artifacts/stability/live-run-fix-maxsteps50-20260825.log 2>&1 &

# 3) 监控（每 ~5min）：tail -5 …log && wc -l < artifacts/stability/live-results.jsonl
```

**判定**：#28 续跑当前被 sensenova 分钟级配额阻塞（外部依赖，同 #35 性质），
非代码/脚本缺陷；等待配额恢复（或新 key 充值）后按上述命令续跑即可无缝接上断点。
