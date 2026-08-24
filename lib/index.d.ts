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
export type SparkleStyle = "standard" | "structured" | "english" | "cot";
/** 重写指令预设集：针对不同场景的提示词优化策略。 */
export declare const STYLE_PROMPTS: Record<SparkleStyle, string>;
export declare const SPARKLE_SYSTEM_PROMPT: string;
/** 单次润色的输出 token 上限。 */
export declare const SPARKLE_MAX_TOKENS = 1024;
/** 单次润色的端到端超时（毫秒）。 */
export declare const SPARKLE_TIMEOUT_MS = 15000;
export declare const COMMAND_NAME = "sparkle";
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
export declare const Config: z<Config>;
/** 客户端单次调用可附带的动态覆盖参数（通过 base64 JSON 传输）。 */
export interface SparkleOptions {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    fastModel?: {
        provider?: string;
        model?: string;
    };
    customPrompt?: string;
}
export declare function decodeOptions(raw?: string): SparkleOptions | undefined;
/** 浏览器半边可依赖的 wire 编码（标准 base64，无空白）。 */
export declare function encodeDraft(text: string): string;
/** 解码命令参数里的 base64 草稿；非法或空白输入抛 SparkleError。 */
export declare function decodeDraft(raw: string): string;
/** 润色失败的统一错误（message 直接面向用户）。 */
export declare class SparkleError extends Error {
}
/**
 * 用指定路由跑一次独立的润色流，返回拼接后的纯文本。
 */
export declare function runSparkle(llm: Pick<LlmRuntime, "stream">, provider: string, model: string, draft: string, signal: AbortSignal, options?: {
    system?: string;
    temperature?: number;
    maxTokens?: number;
}): Promise<string>;
/** 命令处理：解码草稿、风格与客户端选项 → 会话/极速路由 → 独立润色流 → 结果原路返回。 */
export declare function handleSparkleCommand(agent: Agent, rawInput: string, llm: Pick<LlmRuntime, "stream">, signal: AbortSignal, config?: Config): Promise<CommandResult>;
export default class PromptSparkleService extends Service {
    config: Config;
    static inject: string[];
    static Config: z<Config>;
    constructor(ctx: Context, config?: Config);
}
