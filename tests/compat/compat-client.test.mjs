// dsh-prompt-sparkle 兼容性测试：浏览器半边线协议自适应。
//
// 加载真实的 lib/client.js（经 window.__ModuleLoader__.load 捕获工厂），
// 用忠实复刻 dsh 客户端代理（packages/api/gateway/src/client/index.ts 的
// invoke 逻辑）的 rc7 / current 两种 proxy 验证：
//  - typert 描述符识别（source:json 业务参数计数，附件参数名免疫）
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
const { getExecuteModeSync, probeExecuteMode, sparkleRequest, fetchModelCatalog, currentSessionId, resetExecuteModeCache, tryOfficialSetDraft } = wire;

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

/** current 描述符：execute(agent, line, images, signal) —— 0.1.0-rc.8 ~ 0.1.2-rc.1。 */
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

/** dsh 0.1.3-alpha.1+ 描述符：附件参数改名 submittedAttachments。
 *  真实签名见 deepseek-harness packages/interaction/commands/src/index.ts
 *  的 @Remote execute（wire 描述符由 generator 从源码参数生成；lib/ 下的
 *  生成物不入库且可能陈旧，勿以其为准）。改名曾使按参数名 `images` 判定
 *  的旧兼容层误判为 legacy 并少传一个参数（"润色调用失败"回归），此处
 *  锁定新锚。 */
const ATTACHMENTS_RENAMED_EXECUTE_DESCRIPTOR = {
  namespace: "commands",
  method: "execute",
  parameters: [
    { name: "agent", wire: "agentId", source: "lookup" },
    { name: "line", wire: "line", source: "json" },
    { name: "submittedAttachments", wire: "submittedAttachments", source: "json" },
  ],
  cancellation: { parameter: "signal" },
};

/** dsh 0.2.x 描述符（0.2.0-rc.x / 0.2.1-rc.2 / 0.2.1-rc.3 实测）：
 *  execute(agentId, line, submittedAttachments, signal) —— 与 0.1.3+ 的
 *  业务参数完全一致（第三参仍叫 submittedAttachments），唯一差别是 agent
 *  lookup 多了 resource: "session" 标注（0.2.0-rc.2 起 AgentRegistry 的
 *  typert.lookups.register / contexts.registerHost 都加了该字段）。
 *  该字段只影响 host 侧 lookup 解析，不改变 json 业务参数计数，
 *  因此兼容层的计数判定锚天然免疫。 */
const V02_EXECUTE_DESCRIPTOR = {
  namespace: "commands",
  method: "execute",
  parameters: [
    { name: "agent", wire: "agentId", source: "lookup", resource: "session" },
    { name: "line", wire: "line", source: "json" },
    { name: "submittedAttachments", wire: "submittedAttachments", source: "json" },
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

test("rc7：typert 描述符只有 1 个 json 业务参数 → legacy 模式（2 参调用）", () => {
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

test("current：typert 描述符带 images 附件参数 → current 模式（3 参调用）", () => {
  resetExecuteModeCache();
  const ctx = makeCtx(null, makeTypert(CURRENT_EXECUTE_DESCRIPTOR));
  const mode = getExecuteModeSync(ctx);
  assert.deepEqual(mode, { images: true, source: "typert-descriptor" });

  const proxy = makeExecuteProxy(CURRENT_EXECUTE_DESCRIPTOR);
  const outcome = sparkleRequest(mode, proxy, SESSION, "/sparkle abc");
  assert.equal(proxy.calls[0].length, 3, "current 模式传 (sessionId, cmd, []) 三个参数");
  assert.deepEqual(proxy.calls[0][2], []);
});

test("dsh 0.1.3+：附件参数改名 submittedAttachments 仍判 current（回归锁定）", async () => {
  // 修复前：判定锚是参数名 === 'images'，改名后被误判为 legacy → 2 参调用 →
  // 客户端代理抛 "expected 3 business argument(s)... got 2" → 润色必败。
  resetExecuteModeCache();
  const ctx = makeCtx(null, makeTypert(ATTACHMENTS_RENAMED_EXECUTE_DESCRIPTOR));
  const mode = getExecuteModeSync(ctx);
  assert.deepEqual(mode, { images: true, source: "typert-descriptor" });

  const proxy = makeExecuteProxy(ATTACHMENTS_RENAMED_EXECUTE_DESCRIPTOR);
  const outcome = await sparkleRequest(mode, proxy, SESSION, "/sparkle abc");
  assert.equal(proxy.calls[0].length, 3, "改名后的 current 线协议仍传 (sessionId, cmd, []) 三个参数");
  assert.deepEqual(proxy.calls[0][2], []);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.value.result.kind, "success");

  // 旧判定的失败形态：2 参调用被代理拒绝（真实 gateway 的参数校验在
  // carrier try 之外直接 throw，调用方以 rejection 收到 → "润色调用失败"）
  await assert.rejects(
    () => makeExecuteProxy(ATTACHMENTS_RENAMED_EXECUTE_DESCRIPTOR)(SESSION, "/sparkle abc"),
    /got 2/,
  );
});

test("dsh 0.2.x：execute 描述符与 0.1.3+ 同形（submittedAttachments + lookup 带 resource）", async () => {
  // 0.2.1-rc.2 / rc.3 实测：业务参数仍是 line + submittedAttachments（2 个 json），
  // agent lookup 多了 resource: "session"。计数锚对此免疫 → current 模式。
  resetExecuteModeCache();
  const ctx = makeCtx(null, makeTypert(V02_EXECUTE_DESCRIPTOR));
  const mode = getExecuteModeSync(ctx);
  assert.deepEqual(mode, { images: true, source: "typert-descriptor" });

  const proxy = makeExecuteProxy(V02_EXECUTE_DESCRIPTOR);
  const outcome = await sparkleRequest(mode, proxy, SESSION, "/sparkle abc");
  assert.equal(proxy.calls[0].length, 3, "0.2.x 线协议仍是 (sessionId, cmd, []) 三个参数");
  assert.deepEqual(proxy.calls[0][2], [], "附件参数传空数组（润色不带附件）");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.value.result.kind, "success");
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

// ---------- 当前会话 id（currentSessionId，跨代际） ----------
// 0.1.7 回归背景：会话列表快照从 { current, ... } 改为 retention 模型
// （current 与 selection 一并被移除），旧取法恒返回 undefined → 按钮
// 永远灰着不点亮。

/** 复刻 dsh <= 0.1.6 的 list 快照形状（含 current 字段）。 */
function legacyListSnapshot(current) {
  return { ids: [], byId: {}, current, phase: "pending", subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined };
}

/** 复刻 dsh 0.1.7+ 的 list 快照形状（projectList：retainedBy 随条目下发）。 */
function retentionListSnapshot(byId) {
  return { ids: Object.keys(byId), byId, phase: "pending", projectionsBySession: {} };
}

test("会话 id：<= 0.1.6 list 快照 current 字符串直接命中", () => {
  const ctx = { sessions: { list: { getSnapshot: () => legacyListSnapshot("session-cur") } } };
  assert.equal(currentSessionId(ctx), "session-cur");
});

test("会话 id：0.1.7+ current/selection 被移除，按 retainedBy.mainView 取主视图会话", () => {
  // 取法与宿主自身一致：UiSession.publishMain 与各 UI 包的
  // useSessions((state) => Object.values(state.byId).find((s) => (s.retainedBy.mainView ?? 0) > 0)?.id)
  const ctx = { sessions: { list: { getSnapshot: () => retentionListSnapshot({
    "s-idle": { id: "s-idle", retainedBy: {} },
    "s-main": { id: "s-main", retainedBy: { mainView: 1 } },
  }) } } };
  assert.equal(currentSessionId(ctx), "s-main");
});

test("会话 id：0.1.7+ 无主视图 retention（hero 空态）返回 undefined", () => {
  const ctx = { sessions: { list: { getSnapshot: () => retentionListSnapshot({
    "s-1": { id: "s-1", retainedBy: {} },
  }) } } };
  assert.equal(currentSessionId(ctx), undefined);
});

test("会话 id：current 命中时不做 retention 扫描（优先级锁定）", () => {
  const ctx = { sessions: { list: { getSnapshot: () => ({
    ids: ["a"], byId: { a: { id: "a", retainedBy: { mainView: 2 } } }, current: "session-cur",
  }) } } };
  assert.equal(currentSessionId(ctx), "session-cur");
});

test("会话 id：selection 快照兜底（更早宿主）", () => {
  const ctx = { sessions: { selection: { getSnapshot: () => ({ sessionId: "session-sel" }) } } };
  assert.equal(currentSessionId(ctx), "session-sel");
});

test("会话 id：sessions 缺失 / 快照抛错 / 非法形状都不抛错返回 undefined", () => {
  assert.equal(currentSessionId({}), undefined);
  assert.equal(currentSessionId({ sessions: null }), undefined);
  const throwing = { sessions: { list: { getSnapshot: () => { throw new Error("store down"); } } } };
  assert.equal(currentSessionId(throwing), undefined);
  const malformed = { sessions: { list: { getSnapshot: () => ({ byId: { a: null }, current: null }) } } };
  assert.equal(currentSessionId(malformed), undefined);
});

// ---------- 宿主模型目录拉取（fetchModelCatalog） ----------

/** 复刻 vendor/cordis/src/reflect.ts 的 get trap：ctx 上未声明的服务属性
 *  访问即抛 cannot get property "<name>" without inject；ctx.get(name)
 *  是唯一的 optional 服务读取途径（未提供返回 undefined 不抛错）。宿主
 *  gateway 把 remote.<ns> 注册为独立服务，ctx.remote 对象上没有嵌套属性。 */
function makeCordisLikeCtx(services) {
  const own = {
    get: (name) => (name in services ? services[name] : undefined),
  };
  return new Proxy(own, {
    get(target, prop) {
      if (prop in target) return target[prop];
      throw new Error(`cannot get property "${String(prop)}" without inject`);
    },
  });
}

/** 宿主 ModelCatalog 形状（deepseek-harness packages/api/session-controller/src/types.ts）。 */
const HOST_CATALOG_GROUPS = [
  { id: "deepseek", name: "DeepSeek", models: [{ id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" }] },
];

test("模型目录：经 ctx.get('remote.session') 拉取宿主 modelCatalog（v0.1.5 修复锁定）", async () => {
  // 修复前：直接属性访问 ctx.remote.session 被 cordis 代理拒绝（抛
  // cannot get property "session" without inject 被吞掉），目录永远拉不到，
  // 下拉只显示内置默认组。
  const ctx = makeCordisLikeCtx({
    "remote.session": {
      modelCatalog: () => Promise.resolve({ ok: true, value: { groups: HOST_CATALOG_GROUPS } }),
    },
  });
  const groups = await fetchModelCatalog(ctx);
  assert.deepEqual(groups, HOST_CATALOG_GROUPS, "应原样回传宿主 groups（renderGroups 按 id/name/models 解析）");
});

test("模型目录：老宿主（无 remote.session 服务）返回 null 保持默认组", async () => {
  assert.equal(await fetchModelCatalog(makeCordisLikeCtx({})), null);
  assert.equal(await fetchModelCatalog({}), null, "宿主无 ctx.get API 时也不抛错");
});

test("模型目录：modelCatalog 返回 ok:false / 空目录 / reject 都降级为 null", async () => {
  const failing = makeCordisLikeCtx({
    "remote.session": { modelCatalog: () => Promise.resolve({ ok: false, error: { code: "x", message: "y" } }) },
  });
  assert.equal(await fetchModelCatalog(failing), null);

  const empty = makeCordisLikeCtx({
    "remote.session": { modelCatalog: () => Promise.resolve({ ok: true, value: { groups: [] } }) },
  });
  assert.equal(await fetchModelCatalog(empty), null);

  const rejecting = makeCordisLikeCtx({
    "remote.session": { modelCatalog: () => Promise.reject(new Error("transport down")) },
  });
  assert.equal(await fetchModelCatalog(rejecting), null);
});

// ---------- 官方 setDraft 写回（tryOfficialSetDraft） ----------
//
// 0.1.2-alpha.1 起宿主提供 conversation.input.for(actx).setDraft(text)，用于
// 程序化整份替换草稿（清内联引用 chip、按行分段、光标落末尾、并入 history）。
// legacy-rc7 既无 conversation 服务也无 sessions.scope，必须降级到合成 paste。

/** 复刻宿主正路：sessions.scope(id) → conversation.input.for(actx).setDraft(text)。 */
function makeSetDraftHost(recorded, focused = []) {
  const actx = { id: "actx-test" };
  return makeCordisLikeCtx({
    sessions: { scope: (id) => (id === SESSION ? actx : undefined) },
    conversation: {
      input: {
        for: (scope) => {
          assert.equal(scope, actx, "应传入 sessions.scope(sessionId) 返回的作用域");
          return {
            setDraft: (text) => { recorded.push(text); },
            focus: () => { focused.push(true); },
          };
        },
      },
    },
  });
}

test("写回：current 宿主走官方 setDraft，整份替换并返回 true", () => {
  const recorded = [];
  const focused = [];
  const ctx = makeSetDraftHost(recorded, focused);
  assert.equal(tryOfficialSetDraft(ctx, SESSION, "润色后的提示词"), true);
  assert.deepEqual(recorded, ["润色后的提示词"]);
  assert.deepEqual(focused, [true], "写回后把焦点交回输入面（与 paste 路径行为一致）");
});

test("写回：legacy-rc7 无 conversation 服务时返回 false（降级 paste）", () => {
  const ctx = makeCordisLikeCtx({ sessions: { scope: () => ({}) } });
  assert.equal(ctx.get("conversation"), undefined);
  assert.equal(tryOfficialSetDraft(ctx, SESSION, "x"), false);
});

test("写回：无 sessions.scope 时返回 false（legacy-rc7 降级 paste）", () => {
  const ctx = makeCordisLikeCtx({
    conversation: { input: { for: () => ({ setDraft: () => {} }) } },
    sessions: {},
  });
  assert.equal(tryOfficialSetDraft(ctx, SESSION, "x"), false);
});

test("写回：非 retained 会话（scope 返回 undefined）不得写回", () => {
  const recorded = [];
  const ctx = makeSetDraftHost(recorded);
  assert.equal(tryOfficialSetDraft(ctx, "session-not-retained", "x"), false);
  assert.deepEqual(recorded, [], "未落到 setDraft");
});

test("写回：input.for 抛错（requires a retained Session scope）被吞掉转 false", () => {
  const ctx = makeCordisLikeCtx({
    sessions: { scope: () => ({}) },
    conversation: {
      input: {
        for: () => { throw new Error("conversation.input.for requires a retained Session scope"); },
      },
    },
  });
  assert.equal(tryOfficialSetDraft(ctx, SESSION, "x"), false);
});

test("写回：sessionId 缺失或空串直接返回 false，不触碰服务", () => {
  const recorded = [];
  const ctx = makeSetDraftHost(recorded);
  assert.equal(tryOfficialSetDraft(ctx, undefined, "x"), false);
  assert.equal(tryOfficialSetDraft(ctx, "", "x"), false);
  assert.deepEqual(recorded, []);
});

test("写回：setDraft 自身抛错时返回 false，让 paste 路径接手", () => {
  const ctx = makeCordisLikeCtx({
    sessions: { scope: () => ({}) },
    conversation: { input: { for: () => ({ setDraft: () => { throw new Error("editor disposed"); } }) } },
  });
  assert.equal(tryOfficialSetDraft(ctx, SESSION, "x"), false);
});

test("写回：focus 抛错不影响写回成功（焦点不是前置条件）", () => {
  const recorded = [];
  const ctx = makeCordisLikeCtx({
    sessions: { scope: () => ({}) },
    conversation: {
      input: {
        for: () => ({
          setDraft: (text) => { recorded.push(text); },
          focus: () => { throw new Error("no root element"); },
        }),
      },
    },
  });
  assert.equal(tryOfficialSetDraft(ctx, SESSION, "写回成功"), true);
  assert.deepEqual(recorded, ["写回成功"]);
});

test("写回：宿主缺 setDraft 方法（早期 current 形态）返回 false", () => {
  const ctx = makeCordisLikeCtx({
    sessions: { scope: () => ({}) },
    conversation: { input: { for: () => ({ notify: () => {}, focus: () => {} }) } },
  });
  assert.equal(tryOfficialSetDraft(ctx, SESSION, "x"), false);
});

test("写回：宿主无 ctx.get API（非 cordis ctx）返回 false 不抛错", () => {
  assert.equal(tryOfficialSetDraft({}, SESSION, "x"), false);
  assert.equal(tryOfficialSetDraft(null, SESSION, "x"), false);
});
