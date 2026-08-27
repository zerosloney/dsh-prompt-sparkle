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

- **模型路由与极速通道 (Fast Route)**：默认复用当前会话选定的模型；也可在设置中指定独立极速模型（如 `deepseek-chat`），秒级返回，彻底避免思考模型的等待延迟。
- **集成 UI 偏好设置面板 (Settings Modal)**：
  - 右键菜单一键呼出 `⚙️ 偏好设置...`，提供原生深色毛玻璃交互面板。
  - 支持即时调节默认风格、启用极速路由、微调采样温度（0.0~1.0 滑块）、Token 上限、开关 Diff 预览与自动复制、定制系统提示词。
- **差异对比预览 (Diff Preview)**：
  - 可选开启 Diff 对照视窗，并排呈现【原草稿内容】与【✨ 润色后提示词】。
  - 支持 `[ 仅复制 ]`、`[ 放弃 ]` 与 `[ ✔ 采纳写回 (Enter) ]`。
- **多风格预设与快捷切换**：
  - **左键点击**：执行当前选定风格的润色。
  - **右键点击**：弹出精致的预设菜单，支持自由切换 `⚡ 默认精炼`、`🧱 结构化模版`、`🌐 英文优化`、`🧠 思维链引导` 并在 `localStorage` 中记忆用户选择。
  - **动态 Tooltip**：悬浮提示当前选中的风格与快捷键（如 `润色提示词 [⚡ 默认精炼] (右键设置与风格 · Ctrl/Cmd+Shift+E)`）。
- **选区局部润色**：当用户在输入框中高亮选中部分文字时，仅将该选区内容发送润色并替换原选区，未选中文本时默认润色全部草稿。
- **视觉反馈与交互撤销**：润色过程中按钮呈现加载旋转动效，Tooltip 自适应切换；润色成功后弹出交互式 Toast，附带 `[ 撤销 ]` 快捷按钮，点击一键还原，同时原生 `Ctrl/Cmd+Z` 也完全支持。
- **不污染对话**：润色是一次独立辅助流，不进模型上下文；命令只留
  `command/run` + `command/done` 两条 log-only 记录（transcript 显示为命令
  卡片），且 `recordInput: false` 保证草稿 base64 不落日志；
  注意 `command/done` 会完整记录润色结果全文。
- **提示词工程防退化**：严格保护占位符变量（如 `{{var}}`）、代码块与语言一致性，锁定低温度（默认 0.3）以避免幻觉发散与冗余思维链。
- **插件配置 Schema**：通过 `@deepseek-ai/schemastery` 提供结构化配置项（`temperature`、`maxTokens`、`timeoutMs`、`defaultStyle`、`customPrompt`、`fastModel`），支持在 host 设置面板中全局自定义。
- **只读保护与焦点守卫**：会话处于 `submitting/adjudicating/inert` 相位时按钮禁用；快捷键具备活动焦点校验（`document.activeElement`）与拼音输入法（IME）保护，避免全局夺焦。

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

## 发布（本机）

GitHub Actions 只保留 CI 工作流（`.github/workflows/ci.yml`：push /
PR 触发，npm ci + 构建 + 测试）；原发布工作流（推送 `v*` tag 后由 CI 构建
并发布 npm）已移除，发布改为本机脚本一键执行：

```sh
npm run publish:local                # patch 递增：0.1.2 → 0.1.3
npm run publish:local -- --minor     # minor 递增
npm run publish:local -- --major     # major 递增
npm run publish:local -- 0.2.0       # 显式指定版本
npm run publish:local -- --no-git    # 跳过 git tag/commit
npm run publish:local -- --dry-run   # 只测试 + 预览版本，不落盘不发布
```

执行流程：`npm test`（构建 + 测试）→ 版本号写入 `package.json` →
`npm publish --access public`（需先 `npm login`）→ 提交版本号变更并打
`v<version>` tag（以保留原 tag 触发语义；`git push && git push --tags`
同步远端）。

## 依赖

运行时依赖 npm 发布版 `@deepseek-ai/dsh-llm`（`BlockAssembler` /
`createUserMessage`）；`cordis` / `dsh-commands` / `dsh-agent` 以 peer 语义
由宿主提供。浏览器半边零依赖，只依赖 `ui-conversation` 的稳定 DOM 契约：
`[data-composer-card]`（position:relative 定位上下文）与卡内 textarea 的
`data-phase` 属性。
