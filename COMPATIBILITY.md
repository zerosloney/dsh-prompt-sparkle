# dsh-prompt-sparkle 兼容性说明

本文档说明 dsh-prompt-sparkle 对 deepseek-harness 多版本的兼容策略、
适配层实现与测试运行方法。

## 支持版本

| 版本 | 兼容家族 | 说明 |
|------|----------|------|
| deepseek-harness 0.1.0-rc.7 | `legacy-rc7` | 旧线协议：`commands.execute(agent, line, signal)` |
| deepseek-harness 0.1.0-rc.8 / 0.1.1-rc.1 / 0.1.1-rc.2（当前线） | `current` | 新线协议：`commands.execute(agent, line, images, signal)` |
| deepseek-harness 0.1.2-rc.1 | `current` | 线协议不变；**composer 输入面从 `<textarea>` 迁到 Lexical contenteditable（`[data-composer-input]`）**，浏览器半边 draftState/writeDraft 双路径适配（v0.1.3）：读草稿/选区走文本空间递归收集，写回走 focus → 全选 → 合成 `ClipboardEvent("paste")`（Lexical 自管 paste 路径，v0.1.9 起优先改用宿主官方 `setDraft`，见下文"写回路径三态"），旧 textarea 路径保留 |
| deepseek-harness 0.1.3-alpha.1+（含 0.1.5-rc.x） | `current` | 线协议位置形态不变，但 wire 描述符里附件参数从 `images` 改名 `submittedAttachments`（commit `8a0ff3aff8`，文件上传流改造）——浏览器半边的线协议判定锚从"参数名 === images"改为"**`source:json` 业务参数计数 ≥ 2**"（v0.1.4），对参数改名免疫。设置面板的模型下拉经 `remote.session.modelCatalog()`（0.1.2-rc.1+ 提供）动态填充宿主已配置的供应商模型：v0.1.4 用属性访问 `ctx.remote.session` 读命名空间服务，会被 cordis 代理以 `cannot get property "session" without inject` 拒绝，目录拉取从未生效；v0.1.5 改为 `ctx.get('remote.session')`（optional 服务访问，未提供返回 undefined），动态填充真正生效，更早宿主降级为内置 DeepSeek 默认组（V4 世代目录） |
| deepseek-harness 0.1.7（0.1.7-alpha.1 ~ rc.2） | `current` | 线协议与 composer DOM 契约（`[data-slot="conversation.input.model"]` / `[data-composer-card]` / `[data-composer-input]` / `data-phase` 取值）均不变；但**客户端会话选择的 source 被移除**：`sessions.list` 快照删掉 `current` 字段（改为 `{ ids, byId, phase, projectionsBySession }`），`sessions.selection` store 整体移除，"当前会话"改用 **retention 模型**表达（`byId` 条目带 `retainedBy`，`retainedBy.mainView > 0` 即主视图会话，宿主 `UiSession.publishMain` 与各 UI 包的 `useSessions` 选择器同款取法）。旧 `currentSessionId()` 两条路径全部落空恒返回 undefined → 输入草稿后按钮不再点亮（v0.1.6 回归）。v0.1.6 在 `currentSessionId()` 增加 retention 扫描路径（current 命中优先，兼容 <= 0.1.6）。另：新 hero 流程下模型选择器槽位在选定工作区/会话后才挂载，浏览器半边的 rAF 节流在非渲染态（后台标签等）会停摆导致按钮迟迟不挂载——v0.1.6 把 rAF 换成 `setTimeout(32ms)`（后台仅被节流，可见后全速）。已在 0.1.7-rc.2 真实 web 环境端到端验证：按钮挂载、输入点亮、`/sparkle` 命令到达 LLM（假 key 场景返回鉴权错误 toast，链路全通） |
| deepseek-harness **0.2.0-rc.1 / 0.2.0-rc.2 / 0.2.1-rc.2 / 0.2.1-rc.3**（0.2.x 列车） | `current` | **v0.1.8 起支持 0.2.x 列车，v0.1.9 起纳入 0.2.1-rc.3。** host 侧 seam 与 0.1.x 源码级一致（`commands.register` / `CommandInvocation` / `CommandResult` / `agent.options.provider.model` / `LlmRuntime.stream` 的 `GenerateOptions` / `BlockAssembler` / cordis `Service`+`inject`+`effect`+`logger` 全部兼容，已对 0.2.1-rc.2 与 0.2.1-rc.3 真实包逐项核对）；浏览器半边依赖的 DOM 契约（`[data-slot="conversation.input.model"]`、`[data-composer-card]`、`data-phase`）、`sessions.list` 快照（`byId[*].retainedBy.mainView`）、`remote.commands.execute(sid, line, [])` 三参形态、`window.__ModuleLoader__.load({id, factory})` 模块协议与模块级 `inject` 数组均未变。**唯一需要适配的是 dsh-llm 的 `MessageSourceMap` 不再提供共享的 `plugin` kind**（0.2.x 改为"每个 producer 在自己的模块里声明自己的 kind"）——见下文"两处真实不兼容"。已用 0.2.1-rc.2 真实 harness 包跑通宿主编排集成测试（11/11）；rc.2 → rc.3 的差异经逐包 `git diff` 核实后确认与本插件依赖面无关（详见下文"0.2.1-rc.3 追加核对结论"） |

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

**0.2.1-rc.3 追加核对结论**（`git diff d1b9c04067 d02ea370ee`，即
`release(dsh): 0.2.1-rc.2` → `release(dsh): 0.2.1-rc.3`，逐包核对）：

rc.3 不是纯版本号 bump——composer 契约确有增量，但**插件依赖的每一处
签名都没动**：

- **零 diff（插件直接依赖的四个包）**：
  `packages/interaction/commands/src/{index,types}.ts`、
  `packages/llm/llm/src/*`（含 `types.ts` / `assembler.ts` / `message.ts`）、
  `packages/core/agent/src/*`、`packages/typert/protocol/src/types.ts`
  与 `packages/typert/registry/src/*` 全部**无改动**（只有各自
  `package.json` 的 version 行变）。因此 `commands.register` /
  `CommandInvocation` / `CommandResult` / `agent.options` /
  `LlmRuntime.stream` 的 `GenerateOptions` / `BlockAssembler` /
  `RequestUserInput` / `InvocationDescriptor.parameters[].source`
  （客户端线协议计数锚）**全部原样有效**。
- **composer 增量（插件未用，无影响）**：
  `contract/input.ts` 的 `DraftInitializationOptions` 新增
  `whenDraftExists?: 'replace' | 'append' | 'keep'`（`clearPreviousDraft`
  降级为它的布尔快捷方式）；`input/editor/runtime.ts` 抽出
  `$appendParagraphs()` 并新增 `appendDraft(text)`；
  `input/facade.ts` 的 `requestDraftInitialization` 改为按三态分支。
  插件只调用 `SessionInput.setDraft(text)` / `notify` / `focus`，
  **这三个签名与语义均未变**（`setDraft` 内部改成
  `$getRoot().clear()` + `$appendParagraphs(clean)`，对调用方等价）。
- **新增槽位（插件无关）**：`contract/slots.ts` 增加根作用域 list 槽
  `conversation.session.header.views.actions`（View tab 行的 More 菜单）
  及 `ConversationViewActionEntry` / `ConversationViewActionsOwnerProps`；
  `ConversationSessionHeaderInjected.hooks` 扩为
  `{conversationViews, entryPins, entryActions}` 并新增 `setPinned`。
  插件锚定的 `conversation.input.model` 槽与 `[data-slot="..."]`
  包装契约（`ui-renderer/src/client/scoped-slots.tsx`）不在 diff 内。
- **analytics 增量（插件无关）**：`MessageSubmissionState` 新增
  `newSession` / `agentPreset`，`send_button_click` 事件增加
  `is_new_session` / `agent_preset` 字段。
- **升级指南**：`docs/upgrade-guide/v0.2.1-rc.3/` 只有
  `independent-session-forks`（普通 fork 不再写
  `SessionHeader.parentSession`，判断 subagent 改用
  `origin === 'subagent'`），插件不读 fork/parent/subagent 字段，无关。
- **门禁**：`packages/boot/app-boot/src/plugin-compatibility.ts` 的
  `evaluatePluginCompatibility` 不在 diff 内；插件 peer 范围
  `>=0.1.0-rc.7 <0.3.0-0` 在 `includePrerelease: true` 下对
  `0.2.1-rc.3` 仍为真。

结论：**rc.3 不需要改任何插件代码**，只需把版本基线（devDependencies、
测试硬断言、兼容矩阵环境、文档）同步到 rc.3。

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
│   writeDraft(el, text, selRange)  —— 写回三态降级                │
│     1. tryOfficialSetDraft(ctx, sid, text)                     │
│          conversation.input.for(sessions.scope(sid)).setDraft() │
│          （0.1.2-alpha.1+ 官方正路；同步、清内联引用 chip、分段、  │
│           光标落末尾、并入 history；任一环节缺失返回 false）      │
│     2. 合成 ClipboardEvent('paste')（focus → 全选 → 等 120ms）   │
│          （current 家族保底，Lexical 自管 paste 路径）           │
│     3. 原生 value setter + input 事件（旧 <textarea>，<=0.1.1-rc.2）│
└────────────────────────────────────────────────────────────────┘
```

- **写回路径三态**（v0.1.9）：宿主自 `0.1.2-alpha.1`（commit `c7d8e32aec`）
  起提供 `conversation.input.for(actx).setDraft(text)` —— 这是宿主自己用于
  「程序化写入草稿」的正路，整份替换、清内联引用 chip、按行分段、光标落到
  末尾、并入 history 全部由宿主完成，**没有异步渲染窗口**。插件原先一律走
  「focus → `execCommand('selectAll')` → 等 120ms → 合成 paste」，依赖
  Lexical 的异步重渲染时序；v0.1.9 改为**优先走官方 `setDraft`**，只在
  `legacy-rc7`（既无 `conversation` 服务也无 `sessions.scope`，`git log -S`
  确认两者均自 `0.1.2-alpha.1` 起才有）或作用域不可用时降级回合成 paste。
  探测本身全程 `try/catch`：`conversation.input.for` 对非 retained 作用域会
  抛 `conversation.input.for requires a retained Session scope`，捕获后返回
  `false` 交由 paste 路径，绝不向上冒泡。读服务一律用 `ctx.get(...)` 而非
  属性访问 —— 后者要求把 `conversation` 写进模块级 `inject`，而 legacy-rc7
  没有该服务会让 fiber 永久等待。

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
当前为 `0.2.1-rc.3`）。`includePrerelease: true` 让 prerelease 版本参与
普通范围匹配，因此：

- `<0.2.0` 这种上界会把 `0.2.1-rc.2` 挡在门外（用户遇到的报错）；
- 上界必须写成 `<0.3.0-0` 而不是 `<0.3.0`——后者在
  `includePrerelease: true` 下会连带放过 `0.3.0-rc.1` 这类尚未验证的
  prerelease；
- 下界 `>=0.1.0-rc.7` 同时覆盖 0.1.0-rc.7 ~ 0.2.x 全线的 prerelease 与
  稳定版，无需 OR 组合。

已用 `semver.satisfies` 实测：该范围对 `0.1.0-rc.7` / `0.1.0-rc.8` /
`0.1.1-rc.1` / `0.1.1-rc.2` / `0.2.0-rc.1` / `0.2.0-rc.2` /
`0.2.1-rc.2` / `0.2.1-rc.3` 均为真，对 `0.1.0-rc.6` / `0.3.0-rc.1` /
`0.3.0` / `1.0.0` 均为假。

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
node scripts/run-compat-tests.mjs --env v02      # 只测 0.2.1-rc.3
node scripts/run-compat-tests.mjs --skip-install # 复用已装环境
```

### 隔离环境布局

```
E:\Demo\cli-tools\compat-env\
├─ harness-0.1.0-rc.7\    # npm 安装的 @deepseek-ai/dsh@0.1.0-rc.7
├─ harness-0.1.1-rc.2\    # npm 安装的 @deepseek-ai/dsh@0.1.1-rc.2
├─ harness-0.2.1-rc.3\    # npm 安装的 @deepseek-ai/dsh@0.2.1-rc.3
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

## v0.1.9 变更文件清单（同步 0.2.1-rc.3 基线 + 改用宿主官方 setDraft 写回）

两部分：

**（一）版本基线同步。** rc.3 与 rc.2 的差异经逐包 `git diff` 核实后确认
**不涉及插件依赖面**（详见上文"0.2.1-rc.3 追加核对结论"），因此这部分
没有代码行为变更，只是把 devDependencies 与各测试断言对齐到 rc.3。

**（二）写回路径改进。** 把浏览器半边的草稿写回从「合成 paste 的时序 hack」
换成宿主官方 API（rc.3 本身不要求此改动，是主动改进）。

| 文件 | 变更 |
|------|------|
| `lib/client.js` | 新增模块级 `tryOfficialSetDraft(ctx, sessionId, text)`：经 `ctx.get('conversation')` → `conversation.input.for(sessions.scope(sessionId))` → `setDraft(text)` 整份写回，写回后调 `sessionInput.focus()` 把焦点交回输入面；全程 `try/catch`，任一环节缺失或抛错即返回 `false`。`writeDraft` 的 contenteditable 分支改为**先试官方路径、失败再降级合成 paste**；`<textarea>` 旧路径不变。文档注释改写为三态降级说明；`window.__sparkleTest` 增暴露 `tryOfficialSetDraft` 供测试 |
| `tests/compat/compat-client.test.mjs` | 新增 10 个用例（`compat-client` 由 20 → 30）：官方路径整份替换返回 `true` 且在写回后把焦点交回输入面；legacy-rc7 无 `conversation` 服务返回 `false`；无 `sessions.scope` 返回 `false`；非 retained 会话（`scope` 返回 `undefined`）不写回；`input.for` 抛 `requires a retained Session scope` 被吞成 `false`；`sessionId` 缺失/空串直接返回 `false` 不触碰服务；`setDraft` 自身抛错返回 `false`；`focus` 抛错不影响写回成功；宿主缺 `setDraft` 方法返回 `false`；非 cordis ctx（无 `ctx.get`）返回 `false` 不抛错 |
| `package.json` | 版本 0.1.8 → 0.1.9；devDependencies 的 `dsh-agent`/`dsh-commands`/`dsh-llm` 由 `0.2.1-rc.2` 精确锁到 `0.2.1-rc.3`（与宿主同版本，作为类型检查基线），cordis 由 `^4.0.4` 升到 `^4.0.5`（rc.3 的 peer 声明为 `~4.0.5`）。**peer 范围不变**（`>=0.1.0-rc.7 <0.3.0-0` 已覆盖 rc.3） |
| `tests/compat/compat-version.test.mjs` | `familyOf` 增加 `0.2.1-rc.3` → `current` 断言；`detectHarnessVersion` 期望值改为 `0.2.1-rc.3`（commands/llm/agent 三处）；`describeHarness` 正则改为 `commands@0\.2\.1-rc\.3` |
| `tests/compat/compat-peer-ranges.test.mjs` | `SUPPORTED_HARNESS_VERSIONS` 加入 `0.2.1-rc.3`；devDependencies 精确锁定断言改为 `0.2.1-rc.3` |
| `scripts/run-compat-tests.mjs` | `v02` 环境版本由 `0.2.1-rc.2` 改为 `0.2.1-rc.3`（`harnessDir` 相应变为 `harness-0.2.1-rc.3`，cordis 仍钉 4.0.5）；文件头注释同步 |
| `COMPATIBILITY.md` | 支持版本表纳入 `0.2.1-rc.3`；0.1.2-rc.1 行改写写回路径描述；"适配层设计"补 `writeDraft` 三态与"写回路径三态"说明；`runtimeVersion`、版本清单、`--env v02` 说明、隔离环境布局同步到 rc.3；新增本节 |
| `README.md` | 技术简述补一句写回优先走官方 `setDraft`；支持范围说明无需改动（写作 `0.1.0-rc.7 ~ 0.2.x`，已覆盖 rc.3） |

**为何必须保留降级路径**：`git log -S` 定位到 `setDraft(text: string): void` 与
`sessions.scope(id: SessionId)` 均由 commit `c7d8e32aec` / `956730a5fb` 引入，
最早 tag 为 `dsh-v0.1.2-alpha.1`。`legacy-rc7`（0.1.0-rc.7）两者皆无，若只留
`setDraft` 会直接让该家族的写回失效。

**验证**：`npm test` 78 tests / 62 pass / 16 skipped / 0 fail；
`node scripts/run-compat-tests.mjs --env all --skip-install` → **110/110 通过**
（rc7 `0.1.0-rc.7` / current `0.1.1-rc.2` / v02 `0.2.1-rc.3` 三环境各
`compat-host-integration` 11/11 + `compat-install-load` 5/5）。

rc.3 与 rc.2 的差异经逐包 `git diff` 核实后确认**不涉及插件依赖面**
（详见上文"0.2.1-rc.3 追加核对结论"），因此本版**没有代码行为变更**，
只做版本基线同步：

| 文件 | 变更 |
|------|------|
| `package.json` | 版本 0.1.8 → 0.1.9；devDependencies 的 `dsh-agent`/`dsh-commands`/`dsh-llm` 由 `0.2.1-rc.2` 精确锁到 `0.2.1-rc.3`（与宿主同版本，作为类型检查基线），cordis 由 `^4.0.4` 升到 `^4.0.5`（rc.3 的 peer 声明为 `~4.0.5`）。**peer 范围不变**（`>=0.1.0-rc.7 <0.3.0-0` 已覆盖 rc.3） |
| `tests/compat/compat-version.test.mjs` | `familyOf` 增加 `0.2.1-rc.3` → `current` 断言；`detectHarnessVersion` 期望值改为 `0.2.1-rc.3`（commands/llm/agent 三处）；`describeHarness` 正则改为 `commands@0\.2\.1-rc\.3` |
| `tests/compat/compat-peer-ranges.test.mjs` | `SUPPORTED_HARNESS_VERSIONS` 加入 `0.2.1-rc.3`；devDependencies 精确锁定断言改为 `0.2.1-rc.3` |
| `scripts/run-compat-tests.mjs` | `v02` 环境版本由 `0.2.1-rc.2` 改为 `0.2.1-rc.3`（`harnessDir` 相应变为 `harness-0.2.1-rc.3`，cordis 仍钉 4.0.5）；文件头注释同步 |
| `COMPATIBILITY.md` | 支持版本表纳入 `0.2.1-rc.3`；新增"0.2.1-rc.3 追加核对结论"；`runtimeVersion`、版本清单、`--env v02` 说明、隔离环境布局同步到 rc.3 |
| `README.md` | 支持范围说明无需改动（写作 `0.1.0-rc.7 ~ 0.2.x`，已覆盖 rc.3）；仅补发布说明 |
| `lib/`、`src/` | **无改动**（rc.3 未触碰插件依赖的任何签名） |
