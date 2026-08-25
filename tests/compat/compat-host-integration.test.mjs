// dsh-prompt-sparkle 兼容性测试：宿主编排集成（真实 harness 包）。
//
// 本测试用 DSH_HARNESS_DIR 指向的隔离 harness 安装（@deepseek-ai/dsh 的
// node_modules）中的【真实】cordis / dsh-commands / dsh-llm / schemastery
// 组合出最小 Cordis 根，挂载插件后走真实 CommandRuntime.execute 执行
// /sparkle 命令——验证"插件在目标版本 harness 下可加载、核心润色功能可
// 调用"这一完成标准。同一文件由 runner 分别在 0.1.0-rc.7 与当前版环境下
// 执行（DSH_HARNESS_FAMILY 声明期望的兼容家族）。
//
// 关键机制：把插件经临时 node_modules 链接目录导入，使插件自身的
// @deepseek-ai/* import 解析到目标环境的包（而非插件 devDependencies），
// 保证测试与插件共享同一份包实例。
// 运行：DSH_HARNESS_DIR=<dir> DSH_HARNESS_FAMILY=<legacy-rc7|current> \
//        node --test tests/compat/compat-host-integration.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, "..", "..");

const harnessDir = process.env.DSH_HARNESS_DIR;
const expectedFamily = process.env.DSH_HARNESS_FAMILY ?? "unknown";
assert.ok(harnessDir && existsSync(harnessDir),
  "需要 DSH_HARNESS_DIR 指向隔离 harness 安装目录（@deepseek-ai/dsh 的安装根）");

// ---------- 组装临时链接树，让插件与测试解析到目标环境的包 ----------

const HARNESS_SCOPED_PACKAGES = [
  "cordis",
  "dsh-commands",
  "dsh-agent",
  "dsh-llm",
  "schemastery",
];

const envRequire = createRequire(join(harnessDir, "package.json"));

/** 从环境安装中解析包的真实目录。 */
function resolveEnvPackageDir(packageName) {
  const entry = envRequire.resolve(packageName);
  let dir = dirname(entry);
  while (dir !== dirname(dir)) {
    const manifestPath = join(dir, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (manifest?.name === packageName) return dir;
      } catch {
        // 继续向上
      }
    }
    dir = dirname(dir);
  }
  throw new Error(`无法在 ${harnessDir} 中解析 ${packageName}`);
}

const linkRoot = mkdtempSync(join(tmpdir(), "sparkle-host-"));
const linkModules = join(linkRoot, "node_modules");
const linkScoped = join(linkModules, "@deepseek-ai");
mkdirSync(linkScoped, { recursive: true });

const envScopedDir = join(harnessDir, "node_modules", "@deepseek-ai");
for (const name of HARNESS_SCOPED_PACKAGES) {
  const target = resolveEnvPackageDir(`@deepseek-ai/${name}`);
  // Windows junction 无需管理员权限；非 Windows 用 dir 链接
  symlinkSync(target, join(linkScoped, name), process.platform === "win32" ? "junction" : "dir");
}
symlinkSync(PLUGIN_ROOT, join(linkModules, "dsh-prompt-sparkle"), process.platform === "win32" ? "junction" : "dir");

/** 与插件同一解析锚点的 require（保证包实例唯一）。 */
const sharedRequire = createRequire(join(linkModules, "dsh-prompt-sparkle", "lib", "index.js"));

async function importShared(packageName) {
  const resolved = envRequire.resolve(packageName);
  return import(pathToFileURL(resolved).href);
}

/** 记录目标环境实际解析到的包版本（防误用 devDependencies）。 */
const resolvedVersions = {};
for (const name of HARNESS_SCOPED_PACKAGES) {
  const dir = resolveEnvPackageDir(`@deepseek-ai/${name}`);
  resolvedVersions[name] = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
}

// ---------- 测试替身 ----------

function textScript(text) {
  return [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: text.slice(0, Math.ceil(text.length / 2)) },
    { type: "text-delta", index: 0, text: text.slice(Math.ceil(text.length / 2)) },
    { type: "block-end", index: 0, block: { type: "text", text } },
    { type: "finish", reason: { kind: "stop" } },
  ];
}

/** 录制请求并回放固定 chunk 脚本的最小 llm seam（与现有单元测试同构）。 */
function fakeLlm(script) {
  const requests = [];
  let currentScript = script;
  return {
    requests,
    setScript(next) { currentScript = next },
    stream: async function* (options) {
      requests.push(options);
      for (const chunk of currentScript) yield chunk;
    },
  };
}

/** 录制生命周期事件的会话替身。 */
function fakeSession() {
  const events = [];
  return {
    events,
    append(type, data) {
      events.push([type, data]);
      return { type, data };
    },
  };
}

// ---------- 组装真实 Cordis 根 ----------

let ctx;
let runtime;
let llm;
let pluginModule;
let executeArity;
let disposeLlm;

test.before(async () => {
  const [{ Context }, { default: CommandRuntime }] = await Promise.all([
    importShared("@deepseek-ai/cordis"),
    importShared("@deepseek-ai/dsh-commands"),
  ]);
  // 经临时链接树导入插件（其内部 @deepseek-ai/* 解析到目标环境）
  pluginModule = await import(pathToFileURL(join(linkModules, "dsh-prompt-sparkle", "lib", "index.js")).href);

  ctx = new Context();
  runtime = new CommandRuntime(ctx);
  llm = fakeLlm(textScript("润色后的提示词"));
  disposeLlm = ctx.provide("llm", llm);

  const fiber = ctx.plugin(pluginModule.default, {});
  await fiber;

  // 从真实方法签名判断 execute 的线协议（rc7: 3 参；current: 4 参）
  executeArity = CommandRuntime.prototype.execute.length;
});

test.after(async () => {
  try {
    await ctx?.stop?.();
  } catch {
    // 清理失败不影响断言
  }
  rmSync(linkRoot, { recursive: true, force: true });
});

// ---------- 环境核实 ----------

test("环境版本核实：插件解析到 DSH_HARNESS_DIR 的包版本", () => {
  assert.equal(resolvedVersions["dsh-commands"].startsWith("0.1."), true);
  assert.equal(resolvedVersions["dsh-llm"].startsWith("0.1."), true);
  assert.equal(resolvedVersions.cordis, "4.0.1");
  // 防止误用插件 devDependencies（0.1.1-rc.2）
  if (expectedFamily === "legacy-rc7") {
    assert.equal(resolvedVersions["dsh-commands"], "0.1.0-rc.7");
    assert.equal(resolvedVersions["dsh-llm"], "0.1.0-rc.7");
  } else if (expectedFamily === "current") {
    assert.equal(resolvedVersions["dsh-commands"], "0.1.1-rc.2");
  }
});

test("自动识别：detectHarnessVersion 报告目标环境的兼容家族", () => {
  const info = pluginModule.detectHarnessVersion(join(harnessDir, "package.json"));
  assert.equal(info.packages.commands, resolvedVersions["dsh-commands"]);
  assert.equal(info.packages.llm, resolvedVersions["dsh-llm"]);
  assert.equal(info.packages.cordis, resolvedVersions.cordis);
  assert.equal(info.family, expectedFamily);
});

test("线协议核实：execute 参数个数与家族一致", () => {
  if (expectedFamily === "legacy-rc7") assert.equal(executeArity, 3);
  else assert.equal(executeArity, 4);
});

// ---------- 核心功能 ----------

test("插件加载：/sparkle 命令注册成功（list 可见）", async () => {
  const agent = { options: { provider: "p", model: "m" }, session: fakeSession() };
  const descriptors = await runtime.list(agent);
  const sparkle = descriptors.find((d) => d.name === "sparkle");
  assert.ok(sparkle, "list() 应包含 sparkle 命令");
  assert.equal(sparkle.description.includes("润色"), true);
});

test("核心润色：真实 CommandRuntime 执行 /sparkle 返回润色文本", async () => {
  const session = fakeSession();
  const agent = { options: { provider: "route-a", model: "model-a" }, session };
  const line = "/sparkle " + Buffer.from("帮我修复登录 bug", "utf8").toString("base64");
  const execution = executeArity === 3
    ? await runtime.execute(agent, line, new AbortController().signal)
    : await runtime.execute(agent, line, [], new AbortController().signal);

  assert.ok(execution, "未知命令才返回 undefined，sparkle 应命中");
  assert.equal(execution.result.kind, "success");
  assert.equal(execution.result.text, "润色后的提示词");

  // llm seam 收到正确请求
  assert.equal(llm.requests.length, 1);
  const options = llm.requests[0];
  assert.equal(options.provider, "route-a");
  assert.equal(options.model, "model-a");
  assert.equal(options.messages.length, 1);
  assert.equal(options.messages[0].role, "user");
  assert.equal(options.messages[0].content[0].text, "帮我修复登录 bug");

  // 生命周期：command/run（recordInput:false → 无 args 字段）+ command/done
  const runEvent = session.events.find(([type]) => type === "command/run");
  const doneEvent = session.events.find(([type]) => type === "command/done");
  assert.ok(runEvent, "应有 command/run 记录");
  assert.equal("args" in runEvent[1], false, "recordInput:false 时草稿不落日志");
  assert.ok(doneEvent, "应有 command/done 记录");
  assert.equal(doneEvent[1].kind, "success");
});

test("多风格预设：structured 风格传入对应系统提示词", async () => {
  const session = fakeSession();
  const agent = { options: { provider: "p", model: "m" }, session };
  const line = "/sparkle " + Buffer.from("写一个网页", "utf8").toString("base64") + " structured";
  const execution = executeArity === 3
    ? await runtime.execute(agent, line, new AbortController().signal)
    : await runtime.execute(agent, line, [], new AbortController().signal);
  assert.equal(execution.result.kind, "success");
  assert.match(llm.requests.at(-1).system, /structured prompt/i);
});

test("异常输入：空草稿返回 error 结果且不触发 llm", async () => {
  const before = llm.requests.length;
  const session = fakeSession();
  const agent = { options: { provider: "p", model: "m" }, session };
  const execution = executeArity === 3
    ? await runtime.execute(agent, "/sparkle  ", new AbortController().signal)
    : await runtime.execute(agent, "/sparkle  ", [], new AbortController().signal);
  assert.equal(execution.result.kind, "error");
  assert.match(execution.result.text, /草稿为空/);
  assert.equal(llm.requests.length, before);
});

test("异常输入：会话未选模型路由返回 error 结果", async () => {
  const before = llm.requests.length;
  const session = fakeSession();
  const agent = { options: {}, session };
  const line = "/sparkle " + Buffer.from("draft", "utf8").toString("base64");
  const execution = executeArity === 3
    ? await runtime.execute(agent, line, new AbortController().signal)
    : await runtime.execute(agent, line, [], new AbortController().signal);
  assert.equal(execution.result.kind, "error");
  assert.match(execution.result.text, /没有选定的模型路由/);
  assert.equal(llm.requests.length, before);
});

test("异常输入：流失败翻译为 error 结果", async () => {
  llm.setScript([{ type: "finish", reason: { kind: "error", failure: { message: "route down" } } }]);
  try {
    const session = fakeSession();
    const agent = { options: { provider: "p", model: "m" }, session };
    const line = "/sparkle " + Buffer.from("draft", "utf8").toString("base64");
    const execution = executeArity === 3
      ? await runtime.execute(agent, line, new AbortController().signal)
      : await runtime.execute(agent, line, [], new AbortController().signal);
    assert.equal(execution.result.kind, "error");
    assert.match(execution.result.text, /route down/);
  } finally {
    llm.setScript(textScript("润色后的提示词"));
  }
});

test("未注册命令：execute 返回 undefined（matched=false）", async () => {
  const session = fakeSession();
  const agent = { options: { provider: "p", model: "m" }, session };
  const execution = executeArity === 3
    ? await runtime.execute(agent, "/nope 123", new AbortController().signal)
    : await runtime.execute(agent, "/nope 123", [], new AbortController().signal);
  assert.equal(execution, undefined);
});

test("取消信号：已中止的信号使 execute 拒绝而非返回 error 结果", async () => {
  const controller = new AbortController();
  controller.abort();
  const session = fakeSession();
  const agent = { options: { provider: "p", model: "m" }, session };
  const line = "/sparkle " + Buffer.from("draft", "utf8").toString("base64");
  await assert.rejects(
    executeArity === 3
      ? runtime.execute(agent, line, controller.signal)
      : runtime.execute(agent, line, [], controller.signal),
  );
});
