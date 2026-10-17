# dsh-prompt-sparkle

deepseek-harness（dsh）web UI 插件：**对话框提示词润色**。在输入框工具栏的模型选择器旁
挂一个 ✨ 图标按钮，一键把当前草稿重写为更清晰、更直接的提示词，结果写回输入框；
`Ctrl/Cmd+Z`（或 Toast 上的撤销按钮）可随时还原。

润色默认使用**当前会话选定的模型**（也可在设置中改用独立的极速模型），整个过程是一次
独立的辅助调用——不进入对话上下文，不污染会话记录。

## 功能一览

- **一键润色**：左键点击 ✨ 按钮或按 `Ctrl/Cmd+Shift+E`，润色期间按钮呈现加载动效。
- **选区局部润色**：高亮选中部分文字时只润色选中内容，其余保持不变。
- **四种风格预设**（右键按钮即可切换，选择会被记住）：

  | 风格 | 说明 |
  |------|------|
  | ⚡ 默认精炼 | 去芜存菁，清晰直接 |
  | 🧱 结构化模版 | 角色 / 任务 / 背景 / 约束 / 输出格式 |
  | 🌐 英文优化 | 地道专业的英文提示词 |
  | 🧠 思维链引导 | 引导模型逐步推理与验证 |

- **Diff 对照预览**（可选）：润色后先在浮层并排展示原稿与结果，支持
  `[ 仅复制 ]` / `[ 放弃 ]` / `[ ✔ 采纳写回 (Enter) ]`，`Esc` 关闭。
- **偏好设置面板**（右键按钮 → `⚙️ 偏好设置...`）：
  - 界面主题：浅色 / 深色 / 自动跟随宿主；
  - 默认润色风格；
  - 极速模型路由：从宿主已配置的模型中下拉选择（或手动填写 provider / model），
    润色不再跟随会话的思考模型，秒级返回；
  - 采样温度（0–1 滑块）与 Token 上限；
  - Diff 预览、自动复制到剪贴板开关；
  - 自定义系统提示词（填写后优先于风格预设）。
- **可撤销**：润色成功后 Toast 附带 `[ 撤销 ]` 快捷按钮，原生 `Ctrl/Cmd+Z` 同样有效
  （写回会被输入框自身的撤销栈记录）。
- **不打扰对话**：润色结果只写回输入框，不发给对话模型；会话日志只留命令起止两条
  记录，草稿原文不落日志（`command/done` 会记录润色结果全文）。
- **细节体验**：会话忙碌（生成中）时按钮自动禁用；快捷键带焦点校验与输入法（IME）
  保护，不会全局夺焦。

## 安装

要求 Node.js ≥ 22.19，宿主为 deepseek-harness web（**0.1.0-rc.7 ~ 0.2.x**，插件自动
适配，详见 [COMPATIBILITY.md](COMPATIBILITY.md)）。

```sh
# 在 deepseek-harness 仓库内执行（dsh CLI 从源码运行）

# 从本地目录安装（开发迭代）
pnpm dsh plugin --profile web add /path/to/dsh-prompt-sparkle

# 插件集在启动时扫描，需重启 web 服务生效
pnpm dsh --profile web
```

卸载：`pnpm dsh plugin --profile web remove dsh-prompt-sparkle`。

> **版本不匹配提示怎么办？**
> DSH 启动时会校验插件 `peerDependencies` 里的 `@deepseek-ai/dsh*` 范围是否覆盖当前
> 运行时版本（`semver.satisfies(runtime, range, { includePrerelease: true })`）。
> 若提示 `dsh-prompt-sparkle@x.y.z 与 DSH <版本> 不兼容`，说明装到的旧版 peer 范围
> 不含当前运行时——升级到 ≥ 0.1.8（peer 范围 `>=0.1.0-rc.7 <0.3.0-0`，覆盖 0.2.x）即可：
>
> ```sh
> pnpm dsh plugin --profile web remove dsh-prompt-sparkle
> pnpm dsh plugin --profile web add dsh-prompt-sparkle@latest
> ```

## 使用

1. 重启 dsh web 服务后，输入框工具栏模型选择器旁会出现 ✨ 按钮。
2. 在输入框写好草稿（也可以只选中其中一段）。
3. 左键 ✨ 或按 `Ctrl/Cmd+Shift+E` 润色；右键 ✨ 切换风格、打开偏好设置。
4. 开启 Diff 预览时先在浮层对照确认，`Enter` 采纳；未开启则直接写回输入框。
5. 不满意？点 Toast 上的 `[ 撤销 ]` 或按 `Ctrl/Cmd+Z` 一键还原原稿。

## 发布

- **GitHub Actions**：更新 `package.json` 版本并提交，然后 `git tag v0.1.x && git push --tags`，
  工作流自动完成 `npm ci → npm test → npm publish`（需在仓库 Secrets 中配置 `NPM_TOKEN`；
  该版本已发布过时自动跳过，与本地发布不冲突）。
- **本机脚本**：`npm run publish:local [-- --minor|--major|<version>] [--dry-run]`，
  一步完成测试 → 版本递增 → 发布 → git tag/commit，用法见 `scripts/publish.mjs` 头部注释。

## 技术实现（简）

插件分两半：node 半边以 Cordis Service 形态注册 `/sparkle` 命令，复用宿主的 LLM
流式接口跑一次独立润色，草稿以 base64 走命令参数、结果原路返回浏览器，不落会话
日志；浏览器半边是手写的 vanilla JS（零依赖、无构建步骤），负责按钮、菜单、设置
面板与草稿写回，同时适配 textarea 与 Lexical 富文本两种输入框，并按宿主版本自动
选择调用形态。插件自身通过 Schemastery 暴露结构化配置（`temperature` /
`maxTokens` / `timeoutMs` / `defaultStyle` / `customPrompt` / `fastModel`），可在
宿主设置面板全局定制。多版本兼容的适配细节见
[COMPATIBILITY.md](COMPATIBILITY.md)。

## 目录结构

| 文件 | 作用 |
|------|------|
| `cordis.patch.yml` | bundle patch：向组合树插入插件行 |
| `src/index.ts` | node 半边：`/sparkle` 命令注册与润色逻辑（tsc 构建到 `lib/`） |
| `lib/client.js` | 浏览器半边：按钮 / 菜单 / 设置面板 / 草稿写回（手写 vanilla JS） |
| `tests/` | 单元测试 + 多版本兼容测试 |
| `scripts/` | 本机发布脚本与兼容测试编排 |

## License

MIT
