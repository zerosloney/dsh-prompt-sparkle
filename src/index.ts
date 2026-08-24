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
 */

import { Context, Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { CommandResult } from "@deepseek-ai/dsh-commands";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
import type { LlmRuntime, Message } from "@deepseek-ai/dsh-llm";

/** 插件配置：当前无配置项（保留 schema 以便后续扩展，与 dsh 插件约定一致）。 */
export interface Config {}

/** 重写指令：保持语言与意图，输出单个提示词本体，无问候/解释/包裹。 */
export const SPARKLE_SYSTEM_PROMPT = [
  "You are a prompt-rewriting assistant. Rewrite the user's draft into a clearer, more direct prompt that the same model would answer better.",
  "Preserve the user's intent, language, and any domain-specific terms. Keep the output a single prompt, not an answer.",
  "Do not add greetings, disclaimers, or explanations. Do not wrap the output in quotes, code fences, or Markdown. Output the rewritten prompt only, in plain text.",
].join("\n");

/** 单次润色的输出 token 上限。 */
export const SPARKLE_MAX_TOKENS = 1024;

/** 单次润色的端到端超时（毫秒）。 */
export const SPARKLE_TIMEOUT_MS = 15_000;

export const COMMAND_NAME = "sparkle";

/** 浏览器半边可依赖的 wire 编码（标准 base64，无空白）。 */
export function encodeDraft(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

/** 解码命令参数里的 base64 草稿；非法或空白输入抛 SparkleError。 */
export function decodeDraft(raw: string): string {
  const text = Buffer.from(raw.trim(), "base64").toString("utf8");
  if (text.trim().length === 0) {
    throw new SparkleError("草稿为空或编码无效");
  }
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
 * @param llm - LLM 运行时（只需 stream）。
 * @param provider - 会话当前选定的 provider。
 * @param model - 会话当前选定的 model。
 * @param draft - 解码后的草稿文本。
 * @param signal - 取消信号（UI 取消 + 超时的合成信号）。
 */
export async function runSparkle(
  llm: Pick<LlmRuntime, "stream">,
  provider: string,
  model: string,
  draft: string,
  signal: AbortSignal,
): Promise<string> {
  const messages: Message[] = [
    createUserMessage({
      content: [{ type: "text", text: draft }],
      source: { kind: "plugin", plugin: "dsh-prompt-sparkle" },
    }),
  ];
  const assembler = new BlockAssembler();
  for await (const chunk of llm.stream({
    provider,
    model,
    messages,
    system: SPARKLE_SYSTEM_PROMPT,
    maxTokens: SPARKLE_MAX_TOKENS,
    signal,
  })) {
    assembler.push(chunk);
  }
  const finish = assembler.finish;
  if (finish.kind === "max-tokens") {
    throw new SparkleError("润色输出超过 token 上限，请缩短草稿后重试");
  }
  if (finish.kind === "error" || finish.kind === "aborted") {
    throw new SparkleError(`润色请求失败：${finish.failure.message}`);
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

/** 命令处理：解码草稿 → 会话路由 → 独立润色流 → 结果原路返回。 */
export async function handleSparkleCommand(
  agent: Agent,
  rawInput: string,
  llm: Pick<LlmRuntime, "stream">,
  signal: AbortSignal,
): Promise<CommandResult> {
  let draft: string;
  try {
    draft = decodeDraft(rawInput);
  } catch (error) {
    return { kind: "error", text: error instanceof SparkleError ? error.message : String(error) };
  }
  try {
    const { provider, model } = routeOf(agent);
    const withDeadline = AbortSignal.any([signal, AbortSignal.timeout(SPARKLE_TIMEOUT_MS)]);
    const enhanced = await runSparkle(llm, provider, model, draft, withDeadline);
    return { kind: "success", text: enhanced };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      kind: "error",
      text: error instanceof SparkleError ? error.message : `润色失败：${String(error)}`,
    };
  }
}

export default class PromptSparkleService extends Service {
  static inject = ["commands", "llm"];

  static Config = z.object({});

  constructor(ctx: Context, config: Config) {
    super(ctx, "promptSparkle");
    void config;

    ctx.effect(
      () =>
        ctx.commands.register({
          name: COMMAND_NAME,
          description: "润色当前输入框草稿：用当前会话的模型重写为更清晰的提示词",
          // 草稿以 base64 走参数，不落会话日志。
          recordInput: false,
          handler: (invocation) =>
            handleSparkleCommand(invocation.agent, invocation.rawInput, ctx.llm, invocation.signal),
        }),
      "prompt-sparkle: /sparkle command",
    );
  }
}