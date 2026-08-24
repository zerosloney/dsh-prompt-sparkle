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
import type { LlmRuntime } from "@deepseek-ai/dsh-llm";
/** 插件配置：当前无配置项（保留 schema 以便后续扩展，与 dsh 插件约定一致）。 */
export interface Config {
}
/** 重写指令：保持语言与意图，输出单个提示词本体，无问候/解释/包裹。 */
export declare const SPARKLE_SYSTEM_PROMPT: string;
/** 单次润色的输出 token 上限。 */
export declare const SPARKLE_MAX_TOKENS = 1024;
/** 单次润色的端到端超时（毫秒）。 */
export declare const SPARKLE_TIMEOUT_MS = 15000;
export declare const COMMAND_NAME = "sparkle";
/** 浏览器半边可依赖的 wire 编码（标准 base64，无空白）。 */
export declare function encodeDraft(text: string): string;
/** 解码命令参数里的 base64 草稿；非法或空白输入抛 SparkleError。 */
export declare function decodeDraft(raw: string): string;
/** 润色失败的统一错误（message 直接面向用户）。 */
export declare class SparkleError extends Error {
}
/**
 * 用指定路由跑一次独立的润色流，返回拼接后的纯文本。
 * @param llm - LLM 运行时（只需 stream）。
 * @param provider - 会话当前选定的 provider。
 * @param model - 会话当前选定的 model。
 * @param draft - 解码后的草稿文本。
 * @param signal - 取消信号（UI 取消 + 超时的合成信号）。
 */
export declare function runSparkle(llm: Pick<LlmRuntime, "stream">, provider: string, model: string, draft: string, signal: AbortSignal): Promise<string>;
/** 命令处理：解码草稿 → 会话路由 → 独立润色流 → 结果原路返回。 */
export declare function handleSparkleCommand(agent: Agent, rawInput: string, llm: Pick<LlmRuntime, "stream">, signal: AbortSignal): Promise<CommandResult>;
export default class PromptSparkleService extends Service {
    static inject: string[];
    static Config: z<Schemastery.ObjectS<{}>, Schemastery.ObjectT<{}>>;
    constructor(ctx: Context, config: Config);
}
