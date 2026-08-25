# dsh-prompt-sparkle 兼容性说明

本文档说明 dsh-prompt-sparkle 对 deepseek-harness 多版本的兼容策略、
适配层实现与测试运行方法。

## 支持版本

| 版本 | 兼容家族 | 说明 |
|------|----------|------|
| deepseek-harness 0.1.0-rc.7 | `legacy-rc7` | 旧线协议：`commands.execute(agent, line, signal)` |
| deepseek-harness 0.1.0-rc.8 / 0.1.1-rc.1 / 0.1.1-rc.2（当前线） | `current` | 新线协议：`commands.execute(agent, line, images, signal)` |

> 范围外的版本（如 0.1.0-rc.6 及更早、0.2.x）不在承诺范围内；插件会以
> `family=unknown` 记录日志并按 current 线协议尝试调用（多数情况下仍可
> 工作，但不保证）。

## 兼容性结论（调研摘要）

对两个版本做了源码级对比（`git diff dsh-v0.1.0-rc.7 HEAD`），插件用到的
**host 侧 seam 完全一致**，无需行为分支：

- `@deepseek-ai/cordis`：两版本均为 **4.0.1**（`Context` / `Service` /
  `ctx.effect` / `ctx.provide` 无差异）
- `@deepseek-ai/schemastery`：两版本均为 **3.18.1**
- `@deepseek-ai/dsh-llm`：`BlockAssembler`（push/finish/blocks）、
  `createUserMessage`、`Message`、`LlmRuntime.stream` 的 `GenerateOptions`
  与 `StreamChunk`/`FinishReason` 类型**逐字一致**（0.1.1-rc.2 仅新增
  `interruptedBlocks()`、`content.ts` 等增量 API）
- `@deepseek-ai/dsh-commands`：`CommandDefinition.register`、
  `CommandResult`、`CommandInvocation`（agent/rawInput/signal）一致；
  0.1.1-rc.2 仅新增 `attachments` 字段与 `input.images` 声明（插件不使用）
- `@deepseek-ai/dsh-agent`：`Agent.options` 无差异

**两处真实不兼容（本插件改造点）**：

1. **peer 依赖范围（安装期）**：原 `^0.1.1-rc.2` 在 npm 语义下不满足
   `0.1.0-rc.7`，rc7 环境 `pnpm add` 会报 unmet peer。且原 `dsh-llm` 是
   运行时依赖，会在 rc7 环境引入与宿主不一致的独立副本（其自身的 peer
   也会产生告警）。
2. **浏览器半边 `commands.execute` 线协议（运行期）**：客户端固定调用
   `execute(sessionId, cmd, [])`。rc7 的 remote proxy 只有 `line` 一个
   业务参数，第 3 参会被当作 `AbortSignal`，在 `AbortSignal.any` 处抛
   `TypeError`，润色必然失败（表现为“润色调用失败”Toast）。

## 适配层设计

```
┌─ host 半边（node）────────────────────────────────────────────┐
│ src/harness-version.ts                                         │
│   detectHarnessVersion() → { family, packages: {commands,      │
│     agent, llm, cordis} }                                      │
│   - createRequire 从插件自身解析锚点读取宿主包版本（peer 语义）  │
│   - familyOf(): 0.1.0-rc.7 → legacy-rc7；≥0.1.0-rc.8 → current │
│   - 启动时记入日志（仅诊断，host 行为两版本一致故不分支）        │
└────────────────────────────────────────────────────────────────┘
┌─ 浏览器半边（vanilla JS）──────────────────────────────────────┐
│ lib/client.js 兼容层                                            │
│   getExecuteModeSync(ctx)                                      │
│     - 读 ctx.get('typert').remotes.list() 中 commands/execute  │
│       描述符是否含 images 参数（两版本 typert 实现一致，        │
│       零探测、零副作用）                                       │
│   probeExecuteMode(ctx, sessionId)   （typert 不可用时的回退）  │
│     - 一次幂等探测：execute(sid,'/__dsh_prompt_sparkle_probe__',│
│       [])；current → {ok:true,value:undefined}；rc7 → 代理层    │
│       报错 {ok:false}。未知命令名不产生会话副作用。             │
│   sparkleRequest(mode, execute, sessionId, cmd)                │
│     - legacy-rc7 → execute(sid, cmd)（2 参）                    │
│     - current     → execute(sid, cmd, [])（3 参）               │
└────────────────────────────────────────────────────────────────┘
```

- **自动识别，无需任何配置**：插件启动时 host 侧自动探测并记录版本；
  客户端按 wire 描述符自动选择调用形态；用户不需要手动指定或修改配置。
- **不修改 deepseek-harness 源码**：全部改动都在插件侧。

## package.json 依赖策略

```jsonc
// peerDependencies（由宿主 harness 提供，插件绝不安装独立副本）
"@deepseek-ai/cordis": "^4.0.1",
"@deepseek-ai/dsh-agent": ">=0.1.0-rc.7 <0.2.0 || >=0.1.1-rc.1 <0.2.0",
"@deepseek-ai/dsh-commands": ">=0.1.0-rc.7 <0.2.0 || >=0.1.1-rc.1 <0.2.0",
"@deepseek-ai/dsh-llm": ">=0.1.0-rc.7 <0.2.0 || >=0.1.1-rc.1 <0.2.0",
// dependencies
"@deepseek-ai/schemastery": "^3.18.1"
```

为什么是 OR 范围：npm 的 prerelease 匹配规则要求版本与比较器的
`major.minor.patch` 元组一致且比较器带 prerelease，因此单一 caret 范围
无法同时覆盖 `0.1.0-rc.7` 与 `0.1.1-rc.2` 两个 prerelease 版本（已用
`semver.satisfies` 实测验证）。OR 范围在严格语义下对两个版本都为真，
pnpm 安装无 unmet peer 告警。

## 测试运行方法

### 前置条件

- Node.js ≥ 22.19、pnpm ≥ 10（`dsh plugin add` 使用）、npm
- 网络可用（首次运行会安装两个隔离的 `@deepseek-ai/dsh` CLI 环境）

### 一键运行（全矩阵）

```sh
cd E:\Demo\cli-tools\dsh-prompt-sparkle
npm install          # 安装开发依赖（含 semver）
npm test             # 原有功能测试（回归基线）
npm run test:compat  # 兼容性矩阵（两环境 × 全部兼容用例）
```

`npm run test:compat` 等价于：

```sh
node scripts/run-compat-tests.mjs --env all
```

### 只跑某个环境 / 跳过安装

```sh
node scripts/run-compat-tests.mjs --env rc7      # 只测 0.1.0-rc.7
node scripts/run-compat-tests.mjs --env current  # 只测当前版
node scripts/run-compat-tests.mjs --skip-install # 复用已装环境
```

### 隔离环境布局

```
E:\Demo\cli-tools\compat-env\
├─ harness-0.1.0-rc.7\    # npm 安装的 @deepseek-ai/dsh@0.1.0-rc.7
├─ harness-0.1.1-rc.2\    # npm 安装的 @deepseek-ai/dsh@0.1.1-rc.2
├─ home-0.1.0-rc.7\       # rc7 的隔离 DSH_HOME（profile/node_modules 回退）
└─ home-0.1.1-rc.2\       # current 的隔离 DSH_HOME
```

### 测试清单

| 文件 | 验证内容 | 依赖 |
|------|----------|------|
| `tests/compat/compat-version.test.mjs` | 语义化版本比较、兼容家族归类、运行时探测 | 无 |
| `tests/compat/compat-peer-ranges.test.mjs` | peer 范围对两版本严格满足、dsh-llm 不重复安装 | 无 |
| `tests/compat/compat-host-integration.test.mjs` | 用目标环境**真实** cordis/dsh-commands/dsh-llm 组合最小根，真实 `CommandRuntime.execute` 跑 `/sparkle`（成功/异常/取消/生命周期） | `DSH_HARNESS_DIR`、`DSH_HARNESS_FAMILY` |
| `tests/compat/compat-client.test.mjs` | 加载真实 `lib/client.js`，验证 typert 描述符识别、探测回退、rc7/current 调用形态 | 无 |
| `tests/compat/compat-install-load.test.mjs` | 真实 `dsh plugin add` 安装、`--dump-config` 组合、headless 启动加载（探针插件注入 promptSparkle 服务） | 隔离 DSH_HOME + dsh CLI |

### 结果产出

每次运行在 `tests/compat/reports/` 生成：

- `ledger-<时间戳>.jsonl`：结构化台账（每个用例的 env/文件/用例名/结果/耗时/失败详情）
- `report-<时间戳>.md`：Markdown 汇总报告（通过率、失败明细、用例台账）

## 人工抽查建议

在两个版本下分别启动 web profile 后，在对话框输入草稿并按
`Ctrl/Cmd+Shift+E`：

- 润色结果写回输入框、`Ctrl/Cmd+Z` 可撤销（两版本行为一致）
- 启动日志出现 `[prompt-sparkle] deepseek-harness family=...` 记录

## 变更文件清单

| 文件 | 变更 |
|------|------|
| `package.json` | peer 范围放宽为 OR 范围；`dsh-llm` 移入 peerDependencies；新增 `test:compat` 脚本；新增 devDep `semver` |
| `src/harness-version.ts` | 新增：版本探测与兼容家族归类（无第三方依赖） |
| `src/index.ts` | 导入并 re-export 版本探测；启动日志记录探测结果 |
| `lib/client.js` | 新增线协议兼容层（typert 描述符识别 + 探测回退）；`runSparkle` 调用形态自适应；测试钩子 `__SPARKLE_TEST__` |
| `tests/compat/` | 新增兼容性测试套件与探针 fixture |
| `scripts/run-compat-tests.mjs` | 新增兼容性矩阵编排器（台账 + 报告） |
