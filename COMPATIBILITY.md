# dsh-prompt-sparkle 兼容性说明

本文档说明 dsh-prompt-sparkle 对 deepseek-harness 多版本的兼容策略、
适配层实现与测试运行方法。

## 支持版本

| 版本 | 兼容家族 | 说明 |
|------|----------|------|
| deepseek-harness 0.1.0-rc.7 | `legacy-rc7` | 旧线协议：`commands.execute(agent, line, signal)` |
| deepseek-harness 0.1.0-rc.8 / 0.1.1-rc.1 / 0.1.1-rc.2（当前线） | `current` | 新线协议：`commands.execute(agent, line, images, signal)` |
| deepseek-harness 0.1.2-rc.1 | `current` | 线协议不变；**composer 输入面从 `<textarea>` 迁到 Lexical contenteditable（`[data-composer-input]`）**，浏览器半边 draftState/writeDraft 双路径适配（v0.1.3）：读草稿/选区走文本空间递归收集，写回走 focus → 全选 → `execCommand("insertText")`（Lexical 会把变更纳入 EditorState 并通知输入机），旧 textarea 路径保留 |
| deepseek-harness 0.1.3-alpha.1+（含 0.1.5-rc.x） | `current` | 线协议位置形态不变，但 wire 描述符里附件参数从 `images` 改名 `submittedAttachments`（commit `8a0ff3aff8`，文件上传流改造）——浏览器半边的线协议判定锚从"参数名 === images"改为"**`source:json` 业务参数计数 ≥ 2**"（v0.1.4），对参数改名免疫。设置面板的模型下拉经 `remote.session.modelCatalog()`（0.1.2-rc.1+ 提供）动态填充宿主已配置的供应商模型：v0.1.4 用属性访问 `ctx.remote.session` 读命名空间服务，会被 cordis 代理以 `cannot get property "session" without inject` 拒绝，目录拉取从未生效；v0.1.5 改为 `ctx.get('remote.session')`（optional 服务访问，未提供返回 undefined），动态填充真正生效，更早宿主降级为内置 DeepSeek 默认组（V4 世代目录） |
| deepseek-harness 0.1.7（0.1.7-alpha.1 ~ rc.2） | `current` | 线协议与 composer DOM 契约（`[data-slot="conversation.input.model"]` / `[data-composer-card]` / `[data-composer-input]` / `data-phase` 取值）均不变；但**客户端会话选择的 source 被移除**：`sessions.list` 快照删掉 `current` 字段（改为 `{ ids, byId, phase, projectionsBySession }`），`sessions.selection` store 整体移除，"当前会话"改用 **retention 模型**表达（`byId` 条目带 `retainedBy`，`retainedBy.mainView > 0` 即主视图会话，宿主 `UiSession.publishMain` 与各 UI 包的 `useSessions` 选择器同款取法）。旧 `currentSessionId()` 两条路径全部落空恒返回 undefined → 输入草稿后按钮不再点亮（v0.1.6 回归）。v0.1.6 在 `currentSessionId()` 增加 retention 扫描路径（current 命中优先，兼容 <= 0.1.6）。另：新 hero 流程下模型选择器槽位在选定工作区/会话后才挂载，浏览器半边的 rAF 节流在非渲染态（后台标签等）会停摆导致按钮迟迟不挂载——v0.1.6 把 rAF 换成 `setTimeout(32ms)`（后台仅被节流，可见后全速）。已在 0.1.7-rc.2 真实 web 环境端到端验证：按钮挂载、输入点亮、`/sparkle` 命令到达 LLM（假 key 场景返回鉴权错误 toast，链路全通） |
| deepseek-harness **0.2.0-rc.1 / 0.2.0-rc.2 / 0.2.1-rc.2**（0.2.x 列车） | `current` | **v0.1.8 起支持。** host 侧 seam 与 0.1.x 源码级一致（`commands.register` / `CommandInvocation` / `CommandResult` / `agent.options.provider.model` / `LlmRuntime.stream` 的 `GenerateOptions` / `BlockAssembler` / cordis `Service`+`inject`+`effect`+`logger` 全部兼容，已对 0.2.1-rc.2 真实包逐项核对）；浏览器半边依赖的 DOM 契约（`[data-slot="conversation.input.model"]`、`[data-composer-card]`、`data-phase`）、`sessions.list` 快照（`byId[*].retainedBy.mainView`）、`remote.commands.execute(sid, line, [])` 三参形态、`window.__ModuleLoader__.load({id, factory})` 模块协议与模块级 `inject` 数组均未变。**唯一需要适配的是 dsh-llm 的 `MessageSourceMap` 不再提供共享的 `plugin` kind**（0.2.x 改为"每个 producer 在自己的模块里声明自己的 kind"）——见下文"两处真实不兼容"。已用 0.2.1-rc.2 真实 harness 包跑通宿主编排集成测试（11/11） |

> 范围外的版本（如 0.1.0-rc.6 及更早、0.3.0 及以后）不在承诺范围内；插件会以
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

**0.2.x 列车（0.2.1-rc.2）追加核对结论**（对真实安装的包逐一读代码验证，
非推断）：

- `cordis` 4.0.5（0.2.x 解析结果）：`Service` / `ctx.effect` /
  `ctx.logger` / `ctx.provide` / 静态 `inject` 与 4.0.1 一致
- `dsh-commands` 0.2.1-rc.2：`register()` 仍接受
  `{name, description, recordInput, handler}`；`normalizeDefinition` 对
  `recordInput` 的处理不变；`CommandInvocation` 为
  `{commandId, agent, rawInput, attachments, signal}`（`attachments` 是
  0.1.1 起就有的增量，插件不使用）；`CommandResult` 仍是
  `success{text?} | error{text}`（0.2.x 给 success 增加了可选的
  `sourceEventSeq`，插件不设置）。`commands.execute` 的第三参数由
  `images: readonly EncodedImageAttachment[]` 改名为
  `submittedAttachments: readonly CommandSubmitAttachment[]`——**参数个数
  与位置不变**，客户端传 `[]` 在两条列车上都正确
- `dsh-llm` 0.2.1-rc.2：`BlockAssembler`（push/finish/blocks）、
  `finish.kind` 取值（`stop` / `max-tokens` / `aborted` / `error`）与
  `failure.message` 全部不变；`GenerateOptions` 仍含
  `provider/model/messages/system/temperature/maxTokens/signal`；
  `messages` 的类型从 `Message[]` 放宽为
  `RequestMessage = Message | RequestUserInput`（后者显式用于
  "hand-built one-shot"输入，`id?: never; source?: never`）
- `dsh-agent` 0.2.1-rc.2：`AgentOptions` 仍含可选
  `provider` / `model` / `maxTokens`（新增 `reasoningEffort`），
  `agent.options.provider` / `agent.options.model` 取法不变
- `LlmRuntime.forAdapter` 在 0.1.x 与 0.2.x **都**以
  `if (message.role !== "assistant") return message;` 提前返回，因此
  user 消息不带 `source` 在两条列车上都安全（这是改用
  `RequestUserInput` 形状的关键依据）

**三处需要关注的点（本插件改造点）**：

1. **peer 依赖范围（安装期 / 启动期门禁）**：DSH 启动时由
   `dsh-app-boot` 的 `evaluatePluginCompatibility()` 用
   `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`
   校验插件 manifest 里每个 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`
   peer；不满足即拒绝加载并提示"运行它可能导致崩溃或数据丢失"。
   原范围 `>=0.1.0-rc.7 <0.2.0 || >=0.1.1-rc.1 <0.2.0` 覆盖不到
   `0.2.1-rc.2`（这正是用户遇到的报错），v0.1.8 改为
   `>=0.1.0-rc.7 <0.3.0-0`。上界用 `-0` 是为了把 0.3.0 的 prerelease
   排除在外（`<0.3.0` 在 `includePrerelease: true` 下会放过
   `0.3.0-rc.1`）。
2. **浏览器半边 `commands.execute` 线协议（运行期）**：客户端固定调用
   `execute(sessionId, cmd, [])`。rc7 的 remote proxy 只有 `line` 一个
   业务参数，第 3 参会被当作 `AbortSignal`，在 `AbortSignal.any` 处抛
   `TypeError`，润色必然失败（表现为"润色调用失败"Toast）。
3. **dsh-llm 的 `MessageSourceMap` 不再有共享 `plugin` kind（0.2.x）**：
   0.1.x 的 `MessageSourceMap` 有 `plugin: { kind:'plugin'; plugin:string }`，
   插件据此给润色请求的 user 消息打 `source: {kind:"plugin",
   plugin:"dsh-prompt-sparkle"}`。0.2.x 删掉了这个共享 kind（改为"每个
   producer 在自己的模块里声明自己的 kind"），继续传会通不过
   TypeScript 类型检查。由于这条消息**只是一次性请求的输入、从不落会话
   日志**，v0.1.8 直接改用 0.2.x 为此设计的 `RequestUserInput` 形状
   （`{ role: "user", content: [...] }`，不带 `id` 也不带 `source`）；
   两个版本的 `LlmRuntime.forAdapter` 都只对 assistant 消息读 `source`，
   故同一形状在 0.1.x 与 0.2.x 运行时均安全。

## 适配层设计

```
┌─ host 半边（node）────────────────────────────────────────────┐
│ src/harness-version.ts                                         │
│   detectHarnessVersion() → { family, packages: {commands,      │
│     agent, llm, cordis} }                                      │
│   - createRequire 从插件自身解析锚点读取宿主包版本（peer 语义）  │
│   - familyOf(): 0.1.0-rc.7 → legacy-rc7；≥0.1.0-rc.8（含 0.2.x）→ current │
│   - 启动时记入日志（仅诊断，host 行为两版本一致故不分支）        │
└────────────────────────────────────────────────────────────────┘
┌─ 浏览器半边（vanilla JS）──────────────────────────────────────┐
│ lib/client.js 兼容层                                            │
│   getExecuteModeSync(ctx)                                      │
│     - 读 ctx.get('typert').remotes.list() 中 commands/execute  │
│       描述符的 source:json 业务参数计数（≥2=current，1=rc7；   │
│       各版本 typert 实现一致，零探测、零副作用，且对 0.1.3 的   │
│       附件参数改名 submittedAttachments 免疫）                  │
│   probeExecuteMode(ctx, sessionId)   （typert 不可用时的回退）  │
│     - 一次幂等探测：execute(sid,'/__dsh_prompt_sparkle_probe__',│
│       [])；current → {ok:true,value:undefined}；rc7 → 代理层    │
│       报错 {ok:false}。未知命令名不产生会话副作用。             │
│   sparkleRequest(mode, execute, sessionId, cmd)                │
│     - legacy-rc7 → execute(sid, cmd)（2 参）                    │
│     - current     → execute(sid, cmd, [])（3 参；0.1.3 起第三参名  │
│       submittedAttachments，0.2.x 沿用，均传空数组）              │
└────────────────────────────────────────────────────────────────┘
```

- **自动识别，无需任何配置**：插件启动时 host 侧自动探测并记录版本；
  客户端按 wire 描述符自动选择调用形态；用户不需要手动指定或修改配置。
- **不修改 deepseek-harness 源码**：全部改动都在插件侧。

## package.json 依赖策略

```jsonc
// peerDependencies（由宿主 harness 提供，插件绝不安装独立副本）
"@deepseek-ai/cordis": "^4.0.1",
"@deepseek-ai/dsh-agent": ">=0.1.0-rc.7 <0.3.0-0",
"@deepseek-ai/dsh-commands": ">=0.1.0-rc.7 <0.3.0-0",
"@deepseek-ai/dsh-llm": ">=0.1.0-rc.7 <0.3.0-0",
// dependencies
"@deepseek-ai/schemastery": "^3.18.1"
```

为什么是这种范围：DSH 启动时的兼容门禁（`dsh-app-boot` 的
`evaluatePluginCompatibility`）用
`semver.satisfies(runtimeVersion, range, { includePrerelease: true })`
判定，其中 `runtimeVersion` 是 `dsh-app-boot` 自身的版本（与运行时锁步，
当前为 `0.2.1-rc.2`）。`includePrerelease: true` 让 prerelease 版本参与
普通范围匹配，因此：

- `<0.2.0` 这种上界会把 `0.2.1-rc.2` 挡在门外（用户遇到的报错）；
- 上界必须写成 `<0.3.0-0` 而不是 `<0.3.0`——后者在
  `includePrerelease: true` 下会连带放过 `0.3.0-rc.1` 这类尚未验证的
  prerelease；
- 下界 `>=0.1.0-rc.7` 同时覆盖 0.1.0-rc.7 ~ 0.2.x 全线的 prerelease 与
  稳定版，无需 OR 组合。

已用 `semver.satisfies` 实测：该范围对 `0.1.0-rc.7` / `0.1.0-rc.8` /
`0.1.1-rc.1` / `0.1.1-rc.2` / `0.2.0-rc.1` / `0.2.0-rc.2` /
`0.2.1-rc.2` 均为真，对 `0.1.0-rc.6` / `0.3.0-rc.1` / `0.3.0` /
`1.0.0` 均为假。

## 测试运行方法

### 前置条件

- Node.js ≥ 22.19、pnpm ≥ 10（`dsh plugin add` 使用）、npm
- 网络可用（首次运行会安装三个隔离的 `@deepseek-ai/dsh` CLI 环境）

### 一键运行（全矩阵）

```sh
cd E:\Demo\cli-tools\dsh-prompt-sparkle
npm install          # 安装开发依赖（含 semver）
npm test             # 原有功能测试（回归基线）
npm run test:compat  # 兼容性矩阵（三环境 × 全部兼容用例）
```

`npm run test:compat` 等价于：

```sh
node scripts/run-compat-tests.mjs --env all
```

### 只跑某个环境 / 跳过安装

```sh
node scripts/run-compat-tests.mjs --env rc7      # 只测 0.1.0-rc.7
node scripts/run-compat-tests.mjs --env current  # 只测 0.1.1-rc.2
node scripts/run-compat-tests.mjs --env v02      # 只测 0.2.1-rc.2
node scripts/run-compat-tests.mjs --skip-install # 复用已装环境
```

### 隔离环境布局

```
E:\Demo\cli-tools\compat-env\
├─ harness-0.1.0-rc.7\    # npm 安装的 @deepseek-ai/dsh@0.1.0-rc.7
├─ harness-0.1.1-rc.2\    # npm 安装的 @deepseek-ai/dsh@0.1.1-rc.2
├─ harness-0.2.1-rc.2\    # npm 安装的 @deepseek-ai/dsh@0.2.1-rc.2
├─ home-0.1.0-rc.7\       # rc7 的隔离 DSH_HOME（profile/node_modules 回退）
└─ home-0.1.1-rc.2\       # current 的隔离 DSH_HOME
```

### 测试清单

| 文件 | 验证内容 | 依赖 |
|------|----------|------|
| `tests/compat/compat-version.test.mjs` | 语义化版本比较、兼容家族归类（含 0.2.x）、运行时探测 | 无 |
| `tests/compat/compat-peer-ranges.test.mjs` | peer 范围对 0.1.x / 0.2.x 全线严格满足、排除 0.3.x、dsh-llm 不重复安装 | 无 |
| `tests/compat/compat-host-integration.test.mjs` | 用目标环境**真实** cordis/dsh-commands/dsh-llm 组合最小根，真实 `CommandRuntime.execute` 跑 `/sparkle`（成功/异常/取消/生命周期） | `DSH_HARNESS_DIR`、`DSH_HARNESS_FAMILY` |
| `tests/compat/compat-client.test.mjs` | 加载真实 `lib/client.js`，验证 typert 描述符识别、探测回退、rc7/current 调用形态 | 无 |
| `tests/compat/compat-install-load.test.mjs` | 真实 `dsh plugin add` 安装、`--dump-config` 组合、headless 启动加载（探针插件注入 promptSparkle 服务） | 隔离 DSH_HOME + dsh CLI |

### 结果产出

每次运行在 `tests/compat/reports/` 生成：

- `ledger-<时间戳>.jsonl`：结构化台账（每个用例的 env/文件/用例名/结果/耗时/失败详情）
- `report-<时间戳>.md`：Markdown 汇总报告（通过率、失败明细、用例台账）

## 人工抽查建议

在三个版本下分别启动 web profile 后，在对话框输入草稿并按
`Ctrl/Cmd+Shift+E`：

- 润色结果写回输入框、`Ctrl/Cmd+Z` 可撤销（各版本行为一致）
- 启动日志出现 `[prompt-sparkle] deepseek-harness family=...` 记录

## v0.1.8 变更文件清单（0.2.x 兼容）

| 文件 | 变更 |
|------|------|
| `package.json` | 版本 0.1.7 → 0.1.8；三个 `dsh-*` peer 范围由 `>=0.1.0-rc.7 <0.2.0 \|\| >=0.1.1-rc.1 <0.2.0` 放宽为 `>=0.1.0-rc.7 <0.3.0-0`（覆盖 0.2.x，排除 0.3.x prerelease）；devDependencies 的 `dsh-agent`/`dsh-commands`/`dsh-llm` 精确锁到 `0.2.1-rc.2`（与运行时同版本，作为类型检查基线），cordis 升到 `^4.0.4` |
| `src/index.ts` | 润色请求的 user 消息由 `createUserMessage({content, source:{kind:"plugin",plugin:"dsh-prompt-sparkle"}})` 改为 0.2.x 的 `RequestUserInput` 形状 `{role:"user", content:[{type:"text",text:draft}]}`（0.2.x 删除了共享 `plugin` source kind；两个版本的 `LlmRuntime.forAdapter` 都只对 assistant 消息读 source，故跨版本安全）；同步更新文件头跨版本说明 |
| `src/harness-version.ts` | `familyOf()` 的 current 家族上界由 `0.2.0` 放宽到 `0.3.0-0`（0.2.x 归为 current 而非 unknown）；文件头注释同步 |
| `lib/client.js` | 仅更新注释：线协议兼容层的附件参数改名说明补上 0.2.x 沿用 `submittedAttachments`；DOM/会话契约注释补 0.2.x 实测结论。**无行为变更**（0.2.1-rc.2 的 `[data-slot="conversation.input.model"]`、`byId[*].retainedBy.mainView`、`execute(sid,line,[])` 三参形态、`__ModuleLoader__.load` 模块协议、模块级 `inject` 数组均未变） |
| `tests/sparkle.test.mjs` | 新增用例：锁定润色请求消息为一次性 user 输入形状（无 `id`/`source`，仅 `role`+`content`） |
| `tests/compat/compat-version.test.mjs` | `familyOf` 新增 0.2.x 断言；`detectHarnessVersion` 期望值改为 0.2.1-rc.2 / cordis 4.0.5 |
| `tests/compat/compat-peer-ranges.test.mjs` | 支持版本清单加入 0.2.0-rc.1/0.2.0-rc.2/0.2.1-rc.2；排除清单加入 0.3.0-rc.1；peer 校验统一带 `includePrerelease:true`（与 DSH 门禁同语义）；cordis/schemastery 覆盖 4.0.x / 3.18.x 两端 |
| `tests/compat/compat-host-integration.test.mjs` | 环境版本核实由硬编码 0.1.x 放宽为 `^0.(1|2)\.` + cordis `^4\.`，使同一文件可服务 0.1.x 与 0.2.x 两个环境 |
| `scripts/run-compat-tests.mjs` | 新增 `v02` 环境（`@deepseek-ai/dsh@0.2.1-rc.2`，钉 cordis 4.0.5） |
| `README.md` / `COMPATIBILITY.md` | 支持版本写入 0.2.x；补"版本不匹配提示怎么办"的重装指引；兼容性结论补 0.2.x 逐项核对记录与三处改造点说明 |
