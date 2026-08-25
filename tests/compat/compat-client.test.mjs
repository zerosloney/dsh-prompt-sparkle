// dsh-prompt-sparkle 兼容性测试：浏览器半边线协议自适应。
//
// 加载真实的 lib/client.js（经 window.__ModuleLoader__.load 捕获工厂），
// 用忠实复刻 dsh 客户端代理（packages/api/gateway/src/client/index.ts 的
// invoke 逻辑）的 rc7 / current 两种 proxy 验证：
//  - typert 描述符识别（images 参数有无）
//  - 探测回退（typert 缺失时）
//  - sparkleRequest 的调用形态选择
// 运行：node --test tests/compat/compat-client.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(HERE, "..", "..", "lib", "client.js");

// ---------- 加载真实 client.js 工厂 ----------

/** 捕获 __ModuleLoader__.load 的定义，不触发加载器。 */
const factoryHolder = { factory: null };

global.window = {
  __ModuleLoader__: { load: (definition) => { factoryHolder.factory = definition.factory; } },
  __SPARKLE_TEST__: true,
};
global.document = {
  body: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: () => ({}),
  querySelector: () => null,
};


// 执行 bundle 源码（注册 factory 到 __ModuleLoader__.load 捕获器）
const source = readFileSync(CLIENT_PATH, "utf8");
(0, eval)(source);
const factory = factoryHolder.factory;
assert.ok(typeof factory === "function", "client.js 应注册 factory");
const bundleExports = factory(function stubRequire(id) {
  throw new Error(`client.js 不应 require 外部模块：${id}`);
});
assert.ok(bundleExports && typeof bundleExports.apply === "function", "工厂应导出 apply");
assert.ok(Array.isArray(bundleExports.inject), "工厂应导出 inject");

const wire = global.window.__sparkleTest;
assert.ok(wire, "测试钩子应暴露 __sparkleTest");
const { getExecuteModeSync, probeExecuteMode, sparkleRequest, resetExecuteModeCache } = wire;

// ---------- 忠实复刻 dsh 客户端代理的 execute ----------
// 参照 dsh-0.1.0-rc.7 / 0.1.1-rc.2 packages/api/gateway/src/client/index.ts#invoke：
//   expected = 业务参数个数（投影 agent 参数不计）
//   hasCallerSignal = 有 cancellation 且 values.length === expected + 1
//   多出的第 expected 个值被当作 callerSignal → AbortSignal.any 组装
//   参数按 descriptor.parameters 顺序映射到 wire 字段

/** rc7 描述符：execute(agent, line, signal) —— 只有 line 一个业务参数。 */
const RC7_EXECUTE_DESCRIPTOR = {
  namespace: "commands",
  method: "execute",
  parameters: [
    { name: "agent", wire: "agentId", source: "lookup" },
    { name: "line", wire: "line", source: "json" },
  ],
  cancellation: { parameter: "signal" },
};

/** current 描述符：execute(agent, line, images, signal)。 */
const CURRENT_EXECUTE_DESCRIPTOR = {
  namespace: "commands",
  method: "execute",
  parameters: [
    { name: "agent", wire: "agentId", source: "lookup" },
    { name: "line", wire: "line", source: "json" },
    { name: "images", wire: "images", source: "json" },
  ],
  cancellation: { parameter: "signal" },
};

function makeExecuteProxy(descriptor) {
  const calls = [];
  const proxy = function execute(...values) {
    calls.push([...values]);
    return Promise.resolve().then(() => {
      const expected = descriptor.parameters.length;
      const hasCallerSignal = descriptor.cancellation !== undefined && values.length === expected + 1;
      if (values.length !== expected && !hasCallerSignal) {
        throw new Error(
          `client api: commands/execute expected ${expected} business argument(s) plus an optional AbortSignal, got ${values.length}`,
        );
      }
      if (hasCallerSignal) {
        // 与真实实现一致：rc7 收到第 3 个非 AbortSignal 值会在此抛 TypeError
        try {
          AbortSignal.any([new AbortController().signal, values[expected]]);
        } catch (error) {
          return { ok: false, error: { message: error.message } };
        }
      }
      const args = {};
      descriptor.parameters.forEach((parameter, index) => {
        if (values[index] !== undefined) args[parameter.wire] = values[index];
      });
      // 命中 /sparkle 返回成功执行，否则视为未注册命令
      const line = typeof args.line === "string" ? args.line : "";
      if (line.startsWith("/sparkle ")) {
        return { ok: true, value: { commandId: "cid-test", result: { kind: "success", text: "润色结果" } } };
      }
      return { ok: true, value: undefined };
    });
  };
  proxy.calls = calls;
  return proxy;
}

function makeTypert(descriptor) {
  return { remotes: { list: () => [descriptor] } };
}

function makeCtx(remote, typert) {
  return {
    remote: remote ?? {},
    get: (name) => (name === "typert" ? typert : undefined),
  };
}

const SESSION = "session-test-1";

// ---------- typert 描述符识别 ----------

test("rc7：typert 描述符无 images 参数 → legacy 模式（2 参调用）", () => {
  resetExecuteModeCache();
  const ctx = makeCtx(null, makeTypert(RC7_EXECUTE_DESCRIPTOR));
  const mode = getExecuteModeSync(ctx);
  assert.deepEqual(mode, { images: false, source: "typert-descriptor" });

  const proxy = makeExecuteProxy(RC7_EXECUTE_DESCRIPTOR);
  const outcome = sparkleRequest(mode, proxy, SESSION, "/sparkle abc");
  assert.equal(proxy.calls[0].length, 2, "legacy 模式只传 (sessionId, cmd) 两个参数");
  assert.equal(proxy.calls[0][0], SESSION);
  assert.equal(proxy.calls[0][1], "/sparkle abc");
});

test("current：typert 描述符带 images 参数 → current 模式（3 参调用）", () => {
  resetExecuteModeCache();
  const ctx = makeCtx(null, makeTypert(CURRENT_EXECUTE_DESCRIPTOR));
  const mode = getExecuteModeSync(ctx);
  assert.deepEqual(mode, { images: true, source: "typert-descriptor" });

  const proxy = makeExecuteProxy(CURRENT_EXECUTE_DESCRIPTOR);
  const outcome = sparkleRequest(mode, proxy, SESSION, "/sparkle abc");
  assert.equal(proxy.calls[0].length, 3, "current 模式传 (sessionId, cmd, []) 三个参数");
  assert.deepEqual(proxy.calls[0][2], []);
});

test("模式缓存：重复调用不重复探测", () => {
  resetExecuteModeCache();
  let listCount = 0;
  const ctx = {
    remote: {},
    get: (name) => (name === "typert" ? { remotes: { list: () => { listCount += 1; return [CURRENT_EXECUTE_DESCRIPTOR]; } } } : undefined),
  };
  getExecuteModeSync(ctx);
  getExecuteModeSync(ctx);
  assert.equal(listCount, 1, "缓存命中后不再读描述符");
});

// ---------- 探测回退（typert 缺失） ----------

test("typert 缺失且 remote 不可用时回退默认 current 模式", async () => {
  resetExecuteModeCache();
  assert.equal(getExecuteModeSync(makeCtx({}, undefined)), null, "无 typert 时同步判定返回 null");
  const mode = await probeExecuteMode(makeCtx({}, undefined), SESSION);
  assert.deepEqual(mode, { images: true, source: "default" });
});

test("探测回退：rc7 proxy 下探测返回 legacy 模式", async () => {
  resetExecuteModeCache();
  const proxy = makeExecuteProxy(RC7_EXECUTE_DESCRIPTOR);
  const mode = await probeExecuteMode(makeCtx({ commands: { execute: proxy } }, undefined), SESSION);
  assert.deepEqual(mode, { images: false, source: "probe" });
  assert.equal(proxy.calls[0][1], "/__dsh_prompt_sparkle_probe__", "探测用未注册命令名，无副作用");
});

test("探测回退：current proxy 下探测返回 current 模式", async () => {
  resetExecuteModeCache();
  const proxy = makeExecuteProxy(CURRENT_EXECUTE_DESCRIPTOR);
  const mode = await probeExecuteMode(makeCtx({ commands: { execute: proxy } }, undefined), SESSION);
  assert.deepEqual(mode, { images: true, source: "probe" });
});

test("探测回退：proxy 抛错时按 legacy 形态兜底（避免 rc7 的 AbortSignal 错误）", async () => {
  resetExecuteModeCache();
  const throwing = async function execute() { throw new Error("transport down"); };
  const mode = await probeExecuteMode(makeCtx({ commands: { execute: throwing } }, undefined), SESSION);
  assert.deepEqual(mode, { images: false, source: "probe-rejected" });
});

// ---------- 端到端：rc7 环境下的完整调用流 ----------

test("端到端：rc7 proxy 下 3 参调用必然失败，2 参调用成功（回归复现）", async () => {
  // 复现改造前的问题：旧 client.js 固定传 3 参
  const proxy = makeExecuteProxy(RC7_EXECUTE_DESCRIPTOR);
  const broken = await proxy(SESSION, "/sparkle abc", []);
  assert.equal(broken.ok, false, "rc7 proxy 对 3 参调用返回错误（AbortSignal.any TypeError）");
  assert.match(broken.error.message, /AbortSignal/);

  // 修复后：legacy 模式 2 参调用成功
  const ok = await proxy(SESSION, "/sparkle abc");
  assert.equal(ok.ok, true);
  assert.equal(ok.value.result.kind, "success");
});

test("端到端：current proxy 下 3 参调用成功（现状保持）", async () => {
  const proxy = makeExecuteProxy(CURRENT_EXECUTE_DESCRIPTOR);
  const ok = await proxy(SESSION, "/sparkle abc", []);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.result.kind, "success");
});
