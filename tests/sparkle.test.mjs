// dsh-prompt-sparkle 功能测试：编解码往返 / 润色流组装 / 命令分支。
// 运行：npm test（先 build，再 node --test tests/）

import test from "node:test";
import assert from "node:assert/strict";

import {
  encodeDraft,
  decodeDraft,
  runSparkle,
  handleSparkleCommand,
  SparkleError,
  SPARKLE_SYSTEM_PROMPT,
  SPARKLE_MAX_TOKENS,
} from "../lib/index.js";

// ---------- 测试替身 ----------

/** 录制请求并回放固定 chunk 脚本的最小 llm seam。 */
function fakeLlm(script) {
  const requests = [];
  return {
    requests,
    stream: async function* (options) {
      requests.push(options);
      for (const chunk of script) yield chunk;
    },
  };
}

function textScript(text) {
  return [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: text.slice(0, Math.ceil(text.length / 2)) },
    { type: "text-delta", index: 0, text: text.slice(Math.ceil(text.length / 2)) },
    { type: "block-end", index: 0, block: { type: "text", text } },
    { type: "finish", reason: { kind: "stop" } },
  ];
}

const AGENT = { options: { provider: "current-route", model: "current-model" } };
const SIGNAL = new AbortController().signal;

// ---------- encodeDraft / decodeDraft ----------

test("编解码往返保持中文、换行与 emoji", () => {
  const draft = "帮我修复登录 bug\n第二步：写测试 🐛";
  assert.equal(decodeDraft(encodeDraft(draft)), draft);
});

test("decodeDraft 拒绝空白与无效输入", () => {
  assert.throws(() => decodeDraft(""), SparkleError);
  assert.throws(() => decodeDraft("   "), SparkleError);
});

// ---------- runSparkle ----------

test("runSparkle 拼接文本块并回传请求参数", async () => {
  const llm = fakeLlm(textScript("重写后的提示词"));
  const text = await runSparkle(llm, "current-route", "current-model", "原始草稿", SIGNAL);
  assert.equal(text, "重写后的提示词");
  assert.equal(llm.requests.length, 1);
  const options = llm.requests[0];
  assert.equal(options.provider, "current-route");
  assert.equal(options.model, "current-model");
  assert.equal(options.system, SPARKLE_SYSTEM_PROMPT);
  assert.equal(options.maxTokens, SPARKLE_MAX_TOKENS);
  assert.equal(options.messages.length, 1);
  assert.equal(options.messages[0].role, "user");
  assert.equal(options.messages[0].content[0].text, "原始草稿");
});

test("runSparkle 把 max-tokens 终止翻成错误", async () => {
  const llm = fakeLlm([
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: "trunc" },
    { type: "finish", reason: { kind: "max-tokens" } },
  ]);
  await assert.rejects(
    () => runSparkle(llm, "p", "m", "draft", SIGNAL),
    SparkleError,
  );
});

test("runSparkle 拒绝空文本输出", async () => {
  const llm = fakeLlm([{ type: "finish", reason: { kind: "stop" } }]);
  await assert.rejects(
    () => runSparkle(llm, "p", "m", "draft", SIGNAL),
    SparkleError,
  );
});

// ---------- handleSparkleCommand ----------

test("handleSparkleCommand：非法参数返回 error 结果", async () => {
  const llm = fakeLlm(textScript("x"));
  const result = await handleSparkleCommand(AGENT, "  ", llm, SIGNAL);
  assert.equal(result.kind, "error");
  assert.equal(llm.requests.length, 0);
});

test("handleSparkleCommand：会话无模型路由返回 error 结果", async () => {
  const unrouted = { options: {} };
  const llm = fakeLlm(textScript("x"));
  const result = await handleSparkleCommand(unrouted, encodeDraft("draft"), llm, SIGNAL);
  assert.equal(result.kind, "error");
  assert.match(result.text, /没有选定的模型路由/);
  assert.equal(llm.requests.length, 0);
});

test("handleSparkleCommand：成功路径返回润色文本", async () => {
  const llm = fakeLlm(textScript("更清晰的提示词"));
  const result = await handleSparkleCommand(
    AGENT,
    encodeDraft("帮我修 bug"),
    llm,
    SIGNAL,
  );
  assert.deepEqual(result, { kind: "success", text: "更清晰的提示词" });
});

test("handleSparkleCommand：流失败翻译成 error 结果", async () => {
  const llm = {
    stream: async function* () {
      yield { type: "finish", reason: { kind: "error", failure: { message: "route down" } } };
    },
  };
  const result = await handleSparkleCommand(AGENT, encodeDraft("draft"), llm, SIGNAL);
  assert.equal(result.kind, "error");
  assert.match(result.text, /route down/);
});

test("handleSparkleCommand：支持多风格预设参数与自定义提示词", async () => {
  const llm = fakeLlm(textScript("结构化提示词"));
  const result = await handleSparkleCommand(
    AGENT,
    encodeDraft("帮我写一个网页") + " structured",
    llm,
    SIGNAL,
  );
  assert.equal(result.kind, "success");
  assert.equal(llm.requests.length, 1);
  assert.match(llm.requests[0].system, /structured prompt/i);

  // 测试自定义配置覆盖
  const customLlm = fakeLlm(textScript("自定义输出"));
  await handleSparkleCommand(
    AGENT,
    encodeDraft("测试草稿"),
    customLlm,
    SIGNAL,
    { customPrompt: "Custom System Prompt", temperature: 0.1, maxTokens: 2048 },
  );
  assert.equal(customLlm.requests[0].system, "Custom System Prompt");
  assert.equal(customLlm.requests[0].temperature, 0.1);
  assert.equal(customLlm.requests[0].maxTokens, 2048);
});

test("handleSparkleCommand：支持客户端 options Base64 动态覆盖与极速模型路由", async () => {
  const llm = fakeLlm(textScript("极速润色结果"));
  const clientOpts = {
    temperature: 0.15,
    maxTokens: 512,
    fastModel: { provider: "fast-provider", model: "fast-model" },
    customPrompt: "Fast Route Prompt",
  };
  const optsB64 = Buffer.from(JSON.stringify(clientOpts), "utf8").toString("base64");

  const result = await handleSparkleCommand(
    AGENT, // AGENT 本身提供的是 current-route / current-model
    encodeDraft("草稿内容") + " standard " + optsB64,
    llm,
    SIGNAL,
  );

  assert.equal(result.kind, "success");
  assert.equal(result.text, "极速润色结果");
  assert.equal(llm.requests.length, 1);
  // 验证极速模型路由生效
  assert.equal(llm.requests[0].provider, "fast-provider");
  assert.equal(llm.requests[0].model, "fast-model");
  assert.equal(llm.requests[0].temperature, 0.15);
  assert.equal(llm.requests[0].maxTokens, 512);
  assert.equal(llm.requests[0].system, "Fast Route Prompt");
});

test("handleSparkleCommand：取消信号透传而非翻译", async () => {
  const controller = new AbortController();
  controller.abort();
  // 真实 LlmRuntime 尊重 signal：进入流之前即以 signal.reason 拒绝。
  const llm = {
    stream: async function* (options) {
      if (options.signal.aborted) throw options.signal.reason;
      yield* textScript("x");
    },
  };
  await assert.rejects(
    () => handleSparkleCommand(AGENT, encodeDraft("draft"), llm, controller.signal),
  );
});
