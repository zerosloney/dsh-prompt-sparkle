# dsh-prompt-sparkle

dsh web UI 插件：对话框提示词润色。在 composer 工具栏的模型选择器旁挂一个
sparkle 图标按钮（快捷键 `Ctrl/Cmd+Shift+E`），把当前草稿交给**当前会话选定的模型**重写为
更清晰、更直接的提示词，结果写回输入框；`Ctrl/Cmd+Z` 可撤销回原草稿。

## 工作原理

```
[sparkle 按钮 / Ctrl+Shift+E]
        │ 读 composer textarea 草稿
        ▼
浏览器半边 lib/client.js（vanilla DOM）
        │ ctx.remote.commands.execute(sessionId, '/sparkle <base64>', [])
        ▼
host 半边 lib/index.js（Cordis Service）
        │ /sparkle 命令（recordInput: false，草稿不落会话日志）
        │ invocation.agent.options → 当前会话的 provider/model
        │ ctx.llm.stream({provider, model, system: 重写指令, maxTokens: 1024})
        │ BlockAssembler 组装纯文本
        ▼
CommandResult {kind:'success', text} 原路返回浏览器
        │ 原生 value setter + input 事件 → InputBar.onChange → keyboard.setDraft
        ▼
草稿被替换；机器撤销栈自动记录本次替换
```

- **模型路由**：复用当前会话的 `agent.options.provider/model`（换模型后润色跟着换）。
- **不污染对话**：润色是一次独立辅助流，不进模型上下文；命令只留
  `command/run` + `command/done` 两条 log-only 记录（transcript 显示为命令
  卡片），且 `recordInput: false` 保证草稿 base64 不落日志；
  注意 `command/done` 会完整记录润色结果全文。
- **撤销**：写回走 composer 输入机的 `setDraft`，自动成为一个撤销事务。
- **只读保护**：会话处于 `submitting/adjudicating/inert` 相位时按钮禁用，
  请求回来后若相位已变化则拒绝写回。

## 安装

```sh
# 在 deepseek-harness 仓库内执行（dsh CLI 从源码运行）

# 从本地目录安装（开发迭代）
pnpm dsh plugin --profile web add E:/Demo/cli-tools/dsh-prompt-sparkle

# 插件集在启动时扫描，需重启 web 服务生效
pnpm dsh --profile web
```

卸载：`pnpm dsh plugin --profile web remove dsh-prompt-sparkle`。

## 结构

| 文件 | 作用 |
|------|------|
| `cordis.patch.yml` | bundle patch：向组合树插入插件行 |
| `src/index.ts` | node 半边源码：`PromptSparkleService` 注册 `/sparkle` 命令，包装 `ctx.llm.stream` |
| `lib/index.js` | node 半边构建产物（tsc） |
| `lib/client.js` | 浏览器半边：`__ModuleLoader__.load` 闭包工厂 bundle，vanilla DOM 实现按钮/快捷键/写回 |
| `tests/sparkle.test.mjs` | node --test：编解码往返、流组装、命令分支 |

## 开发

```sh
npm install
npm test        # tsc 构建 + node --test
```

浏览器半边是手写 vanilla JS（无构建步骤），改完直接重启 web 服务即可。

## 依赖

运行时依赖 npm 发布版 `@deepseek-ai/dsh-llm`（`BlockAssembler` /
`createUserMessage`）；`cordis` / `dsh-commands` / `dsh-agent` 以 peer 语义
由宿主提供。浏览器半边零依赖，只依赖 `ui-conversation` 的稳定 DOM 契约：
`[data-composer-card]`（position:relative 定位上下文）与卡内 textarea 的
`data-phase` 属性。
