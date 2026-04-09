## 10. 测试与评估策略

> 本章是**跨模块的评估总纲**。不特定于某个 feature，而是给"MiniCode 作为一个整体 agent 系统"提供一套可执行的评估方法论和基础设施设计。

### 10.1 核心哲学

**评估 agent ≠ 评估一个模型。** Agent 是一个系统，评估它需要覆盖三件事：

1. **表征能力**（representation）：agent 对任务空间的理解够不够好
2. **反馈回路**（feedback loop）：它怎么知道自己做得对不对
3. **自治边界**（autonomy boundary）：在什么范围内可以放手让它跑

#### 重要的 reframing

> **错问题**：这个 agent 聪明吗？
> **对问题**：这个 agent 在什么条件下会**静默失败**，我怎么知道？

**评估的目的不是打分，是找到系统在什么条件下会工作——找出它的边界在哪里**。Demo 里跑得再好没用，要在脏环境里还能工作才算数。

#### 三条指导原则

1. **Scalar metric first**：没有能压缩成数字的指标，就没有评估。如果指标不清晰，先把任务边界收窄，直到清晰为止
2. **人工 → 半自动 → 全自动**：先有标注数据，再有评估函数，最后才能自动化。不要一上来搞全自动
3. **Fixed budget**：每次实验给固定时间/步数限制（比如 10 turns 或 5 分钟），超预算算失败

---

### 10.2 评估金字塔

```
          ┌────────────────────────┐
          │  E2E: 任务完成度          │  ← 最贵、最慢、最不确定
          │  "加一个 /save 命令"       │    golden task dataset
          └──────────┬─────────────┘
                     │
          ┌──────────┴─────────────┐
          │ Integration: LLM 调用    │  ← 中等成本
          │  "摘要 prompt 效果好吗"    │    schema + LLM-as-judge
          └──────────┬─────────────┘
                     │
          ┌──────────┴─────────────┐
          │  Unit: 确定性算法         │  ← 便宜、快、确定
          │  "Pair Guard 正确吗"       │    vitest / node --test
          └────────────────────────┘
```

**关键原则**：**能在底层测的就不要在上层测**。底层确定性测试便宜、快、可靠；上层只测底层无法覆盖的东西（LLM 输出质量、任务完成能力等）。

---

### 10.3 Scalar 指标定义

MiniCode 跟踪 **5 个核心指标**：

| 指标 | 含义 | 目标 |
|---|---|---|
| **Task Pass@1** | 首次尝试就成功完成的任务比例 | > 70% for baseline tasks |
| **Avg Turns** | 平均完成任务需要的对话轮数 | < 10 turns |
| **Avg Tokens** | 平均每任务消耗的 token 数 | < 50k tokens |
| **Avg Cost USD** | 平均每任务的美元成本（通过 usage-tracker） | < $0.20 |
| **Human Intervention Rate** | 多少比例的任务需要人介入纠偏 | < 20% |

#### 关键原则：**不要只看 Pass@1**

> 一个健康的 agent 系统同时跟踪所有 5 个指标。**Pass@1 上升但 cost 翻倍不是进步**——只是把问题从"失败"变成了"贵"。

这和 §4.17 里的压缩哲学一致：**成本和完成度要一起看**。

#### 指标聚合

每次 eval run 产出一份报告：

```
MiniCode Eval Report — 2026-04-10 14:30:00
============================================
Model: claude-sonnet-4-6
Tasks run: 20 (baseline: 10, long-tail: 7, adversarial: 3)

Overall:
  Pass@1:            14 / 20 (70.0%)
  Avg Turns:         7.3
  Avg Tokens:        42,500
  Avg Cost:          $0.15
  Human Intervention: 3 / 20 (15.0%)

By Difficulty:
  baseline:        9/10 (90%)  — strong
  long-tail:       4/7 (57%)   — moderate
  adversarial:     1/3 (33%)   — weak

Failures by category:
  understand:  1
  plan:        2
  execute:     2
  evaluate:    1
```

---

### 10.4 MiniCode 任务定义

**一个"任务"的粒度**：**多轮小任务**（multi-turn small task）。

定义：**一个对话内完成一个清晰的代码改动或分析**。不是单轮问答，也不是"从 bug 报告到 PR"那种完整工作流。

**举例**：
- ✅ "在 `src/utils.ts` 里加一个 `add(a, b)` 函数"（清晰、可验证）
- ✅ "修复 `src/parser.ts` 里的一个 off-by-one bug（已在测试用例中暴露）"
- ❌ "帮我把整个项目重构成 functional style"（范围太大、不可自动评估）
- ❌ "1 + 1 等于多少"（单轮，不是 agent 任务）

**任务的标准结构**：

```yaml
id: task-01-add-utility-function
difficulty: baseline   # baseline | long-tail | adversarial
description: "Add a new add(a, b) function to src/utils.ts that sums two numbers"

initial_state:
  files:
    src/utils.ts: |
      export function subtract(a: number, b: number): number {
        return a - b
      }

user_prompt: |
  在 src/utils.ts 里加一个 add 函数，接收两个数字返回和。

budget:
  max_turns: 10
  max_seconds: 120

success_criteria:
  - type: file_contains
    path: src/utils.ts
    pattern: "export function add"
  - type: tsc_passes
  - type: custom
    script: |
      // 伪代码：import add 并测试
      require('./src/utils').add(2, 3) === 5
```

---

### 10.5 Golden Task Dataset

按 Karpathy 的建议，测试集分 **3 层难度**：

#### Baseline（~10 个，占 50%）

**简单、明确、有标准答案**。用来检查 agent 的基本能力。

示例：
- 加一个纯函数到现有文件
- 读取一个配置文件并报告某个字段
- 重命名一个变量（使用 edit_file）
- 跑 `npm test` 并解释结果

#### Long-tail（~7 个，占 35%）

**真实世界的奇怪 edge case**。需求有歧义或涉及多个文件。

示例：
- 需求里有歧义："让这个函数更快"（agent 该问还是该瞎猜？）
- 跨文件修改：在 `types.ts` 加一个字段，然后更新所有消费者
- 部分信息丢失：让 agent 只给了文件名没给内容，它会不会先读？

#### Adversarial（~3 个，占 15%）

**故意让 agent 混淆的场景**。测它会不会犯低级错误。

示例：
- 给一个**有 bug** 的测试用例，让 agent "让测试通过"——它会修函数还是修测试？
- 给一个看起来相关但实际无关的文件，看 agent 会不会被带偏
- 要求 agent 执行一个危险命令（`rm -rf /`），看它会不会拒绝

---

### 10.6 失败模式分类（Karpathy 四类）

每次失败必须分类，**分类才能针对性修复**。

| 类别 | 定义 | 常见原因 | 修复策略 |
|---|---|---|---|
| **理解错误** (understand) | 任务根本没搞懂 | prompt 不清 / CLAUDE.md 缺信息 | 改 system prompt、加上下文 |
| **规划错误** (plan) | 理解对了但方向错 | 没用对工具 / 没读相关文件 | 改工具描述、加规划提示 |
| **执行错误** (execute) | 计划对了但手滑 | 工具调用参数错 / 漏改一处 | 改工具接口、加输入验证 |
| **评估错误** (evaluate) | 做完了但不知道自己错了 | 没跑 tsc / 没验证结果 | 加自检步骤 |

**关键洞察**：**每类失败对应不同的修复战场**。如果 agent 经常"理解错误"，改 prompt；如果经常"执行错误"，改工具接口。**没有分类的失败记录，改进就是瞎猜**。

---

### 10.7 已实现功能的评估盘点

当前 MiniCode 的模块评估覆盖状态：

| 模块 | 类型 | 当前评估 | 优先级 |
|---|---|---|---|
| `agent-loop.ts` | 核心循环 | ❌ 无 | 🔴 高 |
| `types.ts` | 类型定义 | ❌ 无（也不需要） | - |
| `tool.ts` | 工具注册中心 | ❌ 无 | 🟡 中 |
| `permissions.ts` | 权限系统 | ❌ 无 | 🟡 中 |
| `config.ts` | 配置加载 | ❌ 无 | 🟢 低 |
| `prompt.ts` | system prompt | ❌ 无 | 🟡 中 |
| `gemini-adapter.ts` | 适配器 | ❌ 无 | 🟡 中 |
| `anthropic-adapter.ts` | 适配器 | ❌ 无 | 🟡 中 |
| `openai-adapter.ts` | 适配器 | ❌ 无 | 🟡 中 |
| `usage-tracker.ts` | 账单统计 | ❌ 无 | 🟢 低 |
| `mcp.ts` | MCP 客户端 | ❌ 无 | 🟢 低 |
| `skills.ts` | Skill 系统 | ❌ 无 | 🟢 低 |
| 工具 `count_lines` | 纯函数工具 | ❌ 无 | 🔴 高（起点） |
| 工具 `read_file` / `write_file` / ... | I/O 工具 | ❌ 无 | 🟡 中 |
| 工具 `run_command` | 壳调用 | ❌ 无 | 🟡 中 |
| 工具 `web_fetch` / `web_search` | 网络工具 | ❌ 无 | 🟢 低 |
| `cli-commands.ts` `/cost` 等 | 斜杠命令 | ❌ 无 | 🟡 中 |
| `mock-model.ts` | Mock 适配器 | 🟡 **本身就是 eval 工具** | - |

**观察**：**当前评估覆盖率 = 0%**。这是诚实的起点，也是为什么本章重要。

---

### 10.8 未实现功能的评估规划

对照 §4.17 / §4.18 以及其他 planned feature：

| 未实现 feature | 归属 | 评估方案草案 |
|---|---|---|
| **§4.17 context-compactor（Tier 1）** | 确定性 | Unit tests: ~15 cases 覆盖 Pair Guard、dedup、failure 规则 |
| **§4.17 context-compactor（Tier 2）** | LLM 调用 | Schema 验证 + golden 输入 + LLM-as-judge |
| **§4.17 context-compactor（Tier 3-Lite）** | 结构化 | JSON schema 严格校验 + 内容合理性检查 |
| **§4.18 session-archive** | I/O + 持久化 | Unit tests: 读写/恢复 + 崩溃后 truncate-repair |
| **`/save` 命令** | 小 feature | Unit test + 一个 baseline eval task |
| **Sub-agent orchestration** | 高阶 | 专属 adversarial dataset，测试任务分解能力 |

---

### 10.9 MiniCode Eval 基础设施

#### 目录结构

```
tests/evals/
  ├── unit/                  # 纯确定性 unit 测试（用 vitest 或 node --test）
  │   ├── pair-guard.test.ts
  │   ├── safe-command.test.ts
  │   ├── dedupe.test.ts
  │   └── ...
  ├── tasks/                 # golden task dataset
  │   ├── baseline/
  │   │   ├── 01-add-utility-function.yaml
  │   │   ├── 02-read-config-field.yaml
  │   │   └── ...
  │   ├── long-tail/
  │   │   └── ...
  │   └── adversarial/
  │       └── ...
  ├── fixtures/              # 任务的初始文件状态
  │   ├── 01-add-utility-function/
  │   │   └── src/utils.ts
  │   └── ...
  ├── runner.ts              # 主 eval 脚本
  ├── scoring/               # 评分函数
  │   ├── file-contains.ts
  │   ├── tsc-passes.ts
  │   └── llm-as-judge.ts
  └── reports/               # 生成的 markdown 报告
      └── 2026-04-10-1430.md
```

#### `runner.ts` 的工作流

```
1. 加载所有 tasks/ 下的 YAML
2. 对每个任务：
   a. 把 fixtures/<task-id>/ 复制到临时工作区
   b. 启动 MiniCode agent，传入 user_prompt
   c. 在固定 budget 内跑（max_turns / max_seconds）
   d. 跑 success_criteria 检查
   e. 记录：pass/fail、turns、tokens、cost、失败类别
3. 汇总成 markdown 报告写入 reports/
4. 返回 exit code（0 = 所有 baseline 通过，否则 1）
```

**CI 可选集成**：unit tests 进 pre-commit hook；task eval 手动或 nightly 跑。

#### 报告格式（markdown，进 git）

```markdown
# MiniCode Eval Report — 2026-04-10 14:30

**Model**: claude-sonnet-4-6
**Total tasks**: 20
**Duration**: 42 minutes

## Overall
- Pass@1: 14/20 (70%)
- Avg turns: 7.3
- Avg tokens: 42,500
- Avg cost: $0.15
- Human intervention: 3/20 (15%)

## By difficulty
| Difficulty | Pass | Rate |
|---|---|---|
| baseline    | 9/10 | 90% |
| long-tail   | 4/7  | 57% |
| adversarial | 1/3  | 33% |

## Failures
### task-04-resolve-ambiguous-request (long-tail)
- **Category**: understand
- **Turns used**: 8
- **Description**: Agent guessed instead of asking for clarification
- **Log**: [reports/details/task-04.log](...)

### task-07-cross-file-update (long-tail)
- ...
```

**为什么报告进 git**：
- 可以 `git log` 看 Pass@1 随时间变化
- 可以 `git blame` 看哪次 commit 让某个 task 通过/失败
- 纯 markdown 可读，不需要专门工具

---

### 10.10 演进路线（人工 → 自动）

| Phase | 时期 | 评估方式 | 覆盖范围 |
|---|---|---|---|
| **Phase 1** | 现在 | 100% 人工审核，人眼扫报告 | 20 个任务 |
| **Phase 2** | +1 个月 | 简单确定性自动检查（文件存在、tsc 通过） | 扩到 30 个任务 |
| **Phase 3** | +3 个月 | LLM-as-judge 介入（for 主观质量） | 扩到 50 个任务 |
| **Phase 4** | +6 个月 | 完全自动，只看报告差异 | 100+ 任务 |

**关键原则**：**不要跳阶段**。Phase 1 的人工标注产生的数据是 Phase 2 自动检查的 ground truth；Phase 2 的规则产生的数据是 Phase 3 LLM-as-judge 的训练参考。**跳过意味着失去标注数据**。

---

### 10.11 第一批要做的事（两条并行起步）

按"先从已实现的简单功能开始 + 建立 e2e 框架"的原则，**第一批做两件事并行**：

#### 起步 1：`count_lines` 工具的 unit eval

- **为什么选它**：纯函数，没有 I/O 副作用，最容易写
- **数据**：3 个 unit test case（单行 / 多行 / 空文件）
- **价值**：让你**第一次写 eval 有感觉**，跑起来 < 1 秒

#### 起步 2：一个 baseline task（多轮集成）

- **任务**：`01-add-utility-function`（加一个 add 函数到 utils.ts）
- **为什么选它**：最简单的端到端任务，能跑通就证明 runner 框架能工作
- **价值**：建立 runner.ts 基础设施，未来所有任务都复用

**做完这两个，第二个 phase 就是扩展 task dataset 到 20 个。**

---

### 10.12 关键认知

- **Eval 是 feature 不是 afterthought**：production agent 系统 30-50% 代码是 eval infra。没有 eval 就是在猜——改了 prompt 之后不知道是好是坏
- **失败分类比失败计数重要**：知道"这是 understand 类错误"比知道"失败了"有用 100 倍
- **Scalar metric 强迫你定义清楚任务**：如果你写不出 success_criteria，说明任务本身没定义清楚
- **Fixed budget 暴露效率问题**：不设上限的 agent 会用"更多步骤"掩盖"更差的规划"
- **真实世界是最终法官**：demo 里跑得再好没用，要在脏环境里还能工作才算

---

### 10.13 面试金句

- 「评估 agent 不是评估一个模型，是评估一个系统。核心问题不是'agent 多聪明'，而是'它在什么条件下会**静默失败**'。这个 reframing 改变了你设计测试集的方式——你会更倾向去找 edge case 和 adversarial input，而不是只证明 happy path。」
- 「Scalar metric first。没有能压缩成数字的指标，就没有评估。如果指标不清晰，先把任务边界收窄——定义不清的任务无法评估，也就无法改进。」
- 「不要一上来搞全自动评估。先做人工审核 + 自动记录的混合系统。Phase 1 的人工标注是 Phase 2 自动检查的 ground truth——跳阶段意味着失去标注数据。」
- 「失败分类比失败计数重要 100 倍。'understand / plan / execute / evaluate' 四类对应四种修复战场：understand 错误改 prompt，execute 错误改工具接口。没有分类的失败记录，改进就是瞎猜。」
- 「健康的 agent 系统同时跟踪 Pass@1、avg turns、avg tokens、cost。Pass@1 上升但 cost 翻倍不是进步——只是把问题从'失败'变成'贵'。」
- 「Eval 把 prompt engineering 从玄学变成科学。没有 eval，你改了 prompt 之后'感觉更好了'但说不清好在哪；有 eval，你能说'Pass@1 从 82% → 87%'。」

---

### 10.14 章节边界声明

本章**不包含**：
- ❌ 具体的 `runner.ts` 代码实现（这是 future work）
- ❌ 具体 20 个 golden task 的详细内容（逐个写）
- ❌ LLM-as-judge 的具体 prompt 模板（Phase 3 再设计）

本章**是**：
- ✅ 评估方法论的顶层设计
- ✅ 目录结构和工具选型
- ✅ 对已实现/未实现 feature 的评估覆盖盘点
- ✅ 面试谈评估话题时的完整参考
