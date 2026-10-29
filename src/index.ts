/**
 * dsh-prompt-sparkle 插件入口：注册 /sparkle 命令。
 *
 * 架构：Cordis 类插件（Service 形态）。依赖 harness 的 `commands`（命令
 * 注册表）与 `llm`（模型流）两个核心 seam。命令不做 inbox 注入——润色
 * 结果通过 CommandResult 原路返回给发起调用的浏览器半边，写回 composer
 * 草稿，不进模型上下文。`recordInput: false`：草稿的 base64 不落会话
 * 日志（`command/done` 仍记录润色结果的摘要性全文，见 README）。
 *
 * 浏览器半边（lib/client.js）用 `ctx.remote.commands.execute(sessionId,
 * '/sparkle <base64>', [])` 程序化调用本命令。
 *
 * 跨版本兼容（0.1.0-rc.7 ~ 0.2.x）：
 * - host 侧 seam（commands.register / CommandInvocation / CommandResult /
 *   agent.options / LlmRuntime.stream / BlockAssembler / cordis Service）
 *   在 0.1.x 与 0.2.x 源码级一致，无需分支。
 * - 一次性润色请求的 user 消息用 `RequestUserInput` 形状（仅 role +
 *   content，无 id、无 source）。dsh 0.2.x 起 `MessageSourceMap` 不再
 *   提供共享的 `plugin` kind，且 0.2.x 的 GenerateOptions.messages 明确
 *   允许"hand-built one-shot"输入；两个版本的 LlmRuntime.forAdapter 都
 *   在 `message.role !== "assistant"` 处提前返回，不会读取 user 消息的
 *   source，因此该形状在 0.1.x 与 0.2.x 运行时均可安全工作。
 */

import { Context, Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { CommandResult } from "@deepseek-ai/dsh-commands";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { BlockAssembler } from "@deepseek-ai/dsh-llm";
import { detectHarnessVersion, describeHarness } from "./harness-version.js";
export { detectHarnessVersion, describeHarness, familyOf, compareVersions } from "./harness-version.js";
import type { LlmRuntime, RequestMessage } from "@deepseek-ai/dsh-llm";

export type SparkleStyle = "standard" | "structured" | "english" | "cot";

/** 重写指令预设集：针对不同场景的提示词优化策略。 */
export const STYLE_PROMPTS: Record<SparkleStyle, string> = {
  standard: [
    "You are a prompt-rewriting assistant. Rewrite the user's draft into a clearer, more direct prompt that the same model would answer better.",
    "Preserve the user's intent, language, code blocks, placeholder variables (e.g. {{var}}), and domain terms. Keep the output a single prompt, not an answer.",
    "Do not add greetings, disclaimers, explanations, or thinking traces. Do not wrap the output in quotes, code fences, or Markdown. Output the rewritten prompt only, in plain text.",
  ].join("\n"),
  structured: [
    "You are an expert prompt engineer. Rewrite the user's draft into a well-structured prompt following standard components:",
    "- Role & Persona",
    "- Task & Primary Objective",
    "- Context & Background",
    "- Constraints & Requirements",
    "- Expected Output Format",
    "Preserve the user's intent and language. Output the rewritten structured prompt only with clean markdown headers and bullet points, without meta-chatter or explanation.",
  ].join("\n"),
  english: [
    "You are an elite prompt engineer. Translate and rewrite the user's draft into high-quality, professional English for optimal LLM instruction following.",
    "Preserve all variables, placeholders, code snippets, and domain technical terms. Output the English rewritten prompt only, in plain text without conversational filler.",
  ].join("\n"),
  cot: [
    "You are a prompt-rewriting assistant. Rewrite the user's draft into a high-performance prompt that guides step-by-step reasoning (Chain of Thought).",
    "Incorporate explicit guidance to analyze requirements, consider edge cases, verify intermediate steps, and produce a well-reasoned solution.",
    "Preserve the user's language and core intent. Output the rewritten prompt only, in plain text.",
  ].join("\n"),
};

export const SPARKLE_SYSTEM_PROMPT = STYLE_PROMPTS.standard;

/** 单次润色的输出 token 上限。 */
export const SPARKLE_MAX_TOKENS = 1024;

/** 单次润色的端到端超时（毫秒）。 */
export const SPARKLE_TIMEOUT_MS = 15_000;

export const COMMAND_NAME = "sparkle";

export interface FastModelConfig {
  provider?: string;
  model?: string;
}

/** 插件配置 Schema：供 DSH 设置面板及运行期定制。 */
export interface Config {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  defaultStyle?: SparkleStyle;
  customPrompt?: string;
  fastModel?: FastModelConfig;
}

export const Config: z<Config> = z.object({
  temperature: z.number().min(0).max(1).default(0.3).description("润色采样的温度系数 (0-1)，越低越稳定"),
  maxTokens: z.number().min(128).max(8192).default(1024).description("润色单次输出 token 上限"),
  timeoutMs: z.number().min(3000).max(60000).default(15000).description("润色请求超时时间（毫秒）"),
  defaultStyle: z.union(["standard", "structured", "english", "cot"]).default("standard").description("默认润色风格预设"),
  customPrompt: z.string().role("textarea").default("").description("自定义系统提示词（非空时优先覆盖所选预设）"),
  fastModel: z.object({
    provider: z.string().default("").description("极速专用模型提供商（如 deepseek）"),
    model: z.string().default("").description("极速专用模型名称（如 deepseek-chat）"),
  }).default({ provider: "", model: "" }).description("极速专用模型路由（配置后润色不再跟随会话思考模型，实现秒级响应）"),
});

/** 客户端单次调用可附带的动态覆盖参数（通过 base64 JSON 传输）。 */
export interface SparkleOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  fastModel?: { provider?: string; model?: string };
  customPrompt?: string;
}

const MAX_DRAFT_CHARS = 100_000;
const MAX_CUSTOM_PROMPT_CHARS = 20_000;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeBase64Strict(raw: string, label: string): string {
  const encoded = raw.trim();
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) {
    throw new SparkleError(`${label}编码无效`);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw new SparkleError(`${label}编码无效`);
  return bytes.toString("utf8");
}

function optionalFiniteNumber(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new SparkleError(`${name}超出允许范围`);
  }
  return value;
}

export function decodeOptions(raw?: string): SparkleOptions | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(decodeBase64Strict(raw, "选项"));
  } catch (error) {
    if (error instanceof SparkleError) throw error;
    throw new SparkleError("选项格式无效");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SparkleError("选项格式无效");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(["temperature", "maxTokens", "timeoutMs", "fastModel", "customPrompt"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new SparkleError("选项包含未知字段");
  const options: SparkleOptions = {
    temperature: optionalFiniteNumber(input.temperature, "temperature", 0, 1),
    maxTokens: optionalFiniteNumber(input.maxTokens, "maxTokens", 128, 8192),
    timeoutMs: optionalFiniteNumber(input.timeoutMs, "timeoutMs", 3000, 60000),
  };
  if (options.maxTokens !== undefined && !Number.isInteger(options.maxTokens)) throw new SparkleError("maxTokens 必须为整数");
  if (options.timeoutMs !== undefined && !Number.isInteger(options.timeoutMs)) throw new SparkleError("timeoutMs 必须为整数");
  if (input.customPrompt !== undefined) {
    if (typeof input.customPrompt !== "string" || input.customPrompt.length > MAX_CUSTOM_PROMPT_CHARS) {
      throw new SparkleError("customPrompt 格式无效或过长");
    }
    options.customPrompt = input.customPrompt;
  }
  if (input.fastModel !== undefined) {
    if (input.fastModel === null || typeof input.fastModel !== "object" || Array.isArray(input.fastModel)) {
      throw new SparkleError("fastModel 格式无效");
    }
    const route = input.fastModel as Record<string, unknown>;
    if (Object.keys(route).some((key) => key !== "provider" && key !== "model") ||
        typeof route.provider !== "string" || typeof route.model !== "string" ||
        route.provider.trim().length === 0 || route.model.trim().length === 0 ||
        route.provider.length > 200 || route.model.length > 200) {
      throw new SparkleError("fastModel 路由无效");
    }
    options.fastModel = { provider: route.provider.trim(), model: route.model.trim() };
  }
  return options;
}

/** 浏览器半边可依赖的 wire 编码（标准 base64，无空白）。 */
export function encodeDraft(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

/** 解码命令参数里的 base64 草稿；非法或空白输入抛 SparkleError。 */
export function decodeDraft(raw: string): string {
  const text = decodeBase64Strict(raw, "草稿");
  if (text.trim().length === 0) throw new SparkleError("草稿为空或编码无效");
  if (text.length > MAX_DRAFT_CHARS) throw new SparkleError("草稿过长，请缩短后重试");
  return text;
}

/** 润色失败的统一错误（message 直接面向用户）。 */
export class SparkleError extends Error {}

/**
 * 取接收命令的 agent 当前选定的 provider/model 路由。
 * 路由缺失（会话未选模型）时抛 SparkleError。
 */
function routeOf(agent: Agent): { provider: string; model: string } {
  const { provider, model } = agent.options;
  if (provider === undefined || model === undefined) {
    throw new SparkleError("当前会话没有选定的模型路由，请先在对话框选择模型");
  }
  return { provider, model };
}

/**
 * 用指定路由跑一次独立的润色流，返回拼接后的纯文本。
 *
 * 草稿以 `RequestUserInput` 形状进 request（仅 role + content）：这是
 * dsh 0.2.x 为"hand-built one-shot"显式设计的形状，0.2.x 起
 * `MessageSourceMap` 不再有共享 `plugin` kind；0.1.x 的
 * `LlmRuntime.forAdapter` 也只在 `message.role === "assistant"` 时读
 * source，故同一形状跨 0.1.x / 0.2.x 均安全。
 */
export async function runSparkle(
  llm: Pick<LlmRuntime, "stream">,
  provider: string,
  model: string,
  draft: string,
  signal: AbortSignal,
  options: {
    system?: string;
    temperature?: number;
    maxTokens?: number;
  } = {},
): Promise<string> {
  const system = options.system ?? SPARKLE_SYSTEM_PROMPT;
  const temperature = options.temperature ?? 0.3;
  const maxTokens = options.maxTokens ?? SPARKLE_MAX_TOKENS;

  const messages: RequestMessage[] = [
    { role: "user", content: [{ type: "text", text: draft }] },
  ];
  const assembler = new BlockAssembler();
  for await (const chunk of llm.stream({
    provider,
    model,
    messages,
    system,
    temperature,
    maxTokens,
    signal,
  })) {
    assembler.push(chunk);
  }
  const finish = assembler.finish;
  if (finish.kind === "max-tokens") {
    throw new SparkleError("润色输出超过 token 上限，请缩短草稿后重试");
  }
  if (finish.kind === "error" || finish.kind === "aborted") {
    throw new SparkleError("模型服务暂时不可用，请稍后重试");
  }
  const blocks = assembler.blocks();
  if (blocks.some((block) => block.type === "tool-call")) {
    throw new SparkleError("润色输出意外包含工具调用");
  }
  const text = blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (text.length === 0) {
    throw new SparkleError("模型没有输出任何文本");
  }
  return text;
}

/** 命令处理：解码草稿、风格与客户端选项 → 会话/极速路由 → 独立润色流 → 结果原路返回。 */
export async function handleSparkleCommand(
  agent: Agent,
  rawInput: string,
  llm: Pick<LlmRuntime, "stream">,
  signal: AbortSignal,
  config: Config = {},
): Promise<CommandResult> {
  const parts = rawInput.trim().split(/\s+/);
  const b64 = parts[0] ?? "";
  const styleArg = (parts[1] as SparkleStyle) ?? config.defaultStyle ?? "standard";

  try {
    const clientOptions = decodeOptions(parts[2]);
    const customPrompt = clientOptions?.customPrompt ?? config.customPrompt;
    const systemPrompt =
      customPrompt && customPrompt.trim().length > 0
        ? customPrompt
        : STYLE_PROMPTS[styleArg] ?? STYLE_PROMPTS.standard;
    const draft = decodeDraft(b64);
    let provider: string;
    let model: string;
    const fast = clientOptions?.fastModel ?? config.fastModel;
    if (fast?.provider && fast.provider.trim() !== "" && fast?.model && fast.model.trim() !== "") {
      provider = fast.provider.trim();
      model = fast.model.trim();
    } else {
      const routed = routeOf(agent);
      provider = routed.provider;
      model = routed.model;
    }

    const timeout = clientOptions?.timeoutMs ?? config.timeoutMs ?? SPARKLE_TIMEOUT_MS;
    const temperature = clientOptions?.temperature ?? config.temperature ?? 0.3;
    const maxTokens = clientOptions?.maxTokens ?? config.maxTokens ?? SPARKLE_MAX_TOKENS;

    const withDeadline = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    const enhanced = await runSparkle(llm, provider, model, draft, withDeadline, {
      system: systemPrompt,
      temperature,
      maxTokens,
    });
    return { kind: "success", text: enhanced };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      kind: "error",
      text: error instanceof SparkleError ? error.message : "润色失败，请稍后重试",
    };
  }
}

export default class PromptSparkleService extends Service {
  static inject = ["commands", "llm"];
  static Config = Config;

  constructor(ctx: Context, public config: Config = {}) {
    super(ctx, "promptSparkle");

    // 启动时自动探测宿主 harness 版本（兼容家族 + 各 seam 包版本），仅记录日志。
    // 两个支持版本在 host seam 上源码级一致，行为分支在浏览器半边的线协议层。
    try {
      ctx.logger.info("[prompt-sparkle] deepseek-harness " + describeHarness(detectHarnessVersion()));
    } catch (error) {
      ctx.logger.warn("[prompt-sparkle] harness version detection failed: " + String(error));
    }

    ctx.effect(
      () =>
        ctx.commands.register({
          name: COMMAND_NAME,
          description: "润色当前输入框草稿：用当前会话的模型重写为更清晰的提示词 (/sparkle <base64> [style] [optionsBase64])",
          // 草稿以 base64 走参数，不落会话日志。
          recordInput: false,
          handler: (invocation) =>
            handleSparkleCommand(invocation.agent, invocation.rawInput, ctx.llm, invocation.signal, this.config),
        }),
      "prompt-sparkle: /sparkle command",
    );
  }
}