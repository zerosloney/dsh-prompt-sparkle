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
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
/** 重写指令预设集：针对不同场景的提示词优化策略。 */
export const STYLE_PROMPTS = {
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
export const Config = z.object({
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
export function decodeOptions(raw) {
    if (!raw || raw.trim().length === 0)
        return undefined;
    try {
        const json = Buffer.from(raw.trim(), "base64").toString("utf8");
        return JSON.parse(json);
    }
    catch {
        return undefined;
    }
}
/** 浏览器半边可依赖的 wire 编码（标准 base64，无空白）。 */
export function encodeDraft(text) {
    return Buffer.from(text, "utf8").toString("base64");
}
/** 解码命令参数里的 base64 草稿；非法或空白输入抛 SparkleError。 */
export function decodeDraft(raw) {
    const text = Buffer.from(raw.trim(), "base64").toString("utf8");
    if (text.trim().length === 0) {
        throw new SparkleError("草稿为空或编码无效");
    }
    return text;
}
/** 润色失败的统一错误（message 直接面向用户）。 */
export class SparkleError extends Error {
}
/**
 * 取接收命令的 agent 当前选定的 provider/model 路由。
 * 路由缺失（会话未选模型）时抛 SparkleError。
 */
function routeOf(agent) {
    const { provider, model } = agent.options;
    if (provider === undefined || model === undefined) {
        throw new SparkleError("当前会话没有选定的模型路由，请先在对话框选择模型");
    }
    return { provider, model };
}
/**
 * 用指定路由跑一次独立的润色流，返回拼接后的纯文本。
 */
export async function runSparkle(llm, provider, model, draft, signal, options = {}) {
    const system = options.system ?? SPARKLE_SYSTEM_PROMPT;
    const temperature = options.temperature ?? 0.3;
    const maxTokens = options.maxTokens ?? SPARKLE_MAX_TOKENS;
    const messages = [
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
        throw new SparkleError(`润色请求失败：${finish.failure.message}`);
    }
    const blocks = assembler.blocks();
    if (blocks.some((block) => block.type === "tool-call")) {
        throw new SparkleError("润色输出意外包含工具调用");
    }
    const text = blocks
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
    if (text.length === 0) {
        throw new SparkleError("模型没有输出任何文本");
    }
    return text;
}
/** 命令处理：解码草稿、风格与客户端选项 → 会话/极速路由 → 独立润色流 → 结果原路返回。 */
export async function handleSparkleCommand(agent, rawInput, llm, signal, config = {}) {
    const parts = rawInput.trim().split(/\s+/);
    const b64 = parts[0] ?? "";
    const styleArg = parts[1] ?? config.defaultStyle ?? "standard";
    const clientOptions = decodeOptions(parts[2]);
    const customPrompt = clientOptions?.customPrompt ?? config.customPrompt;
    const systemPrompt = customPrompt && customPrompt.trim().length > 0
        ? customPrompt
        : STYLE_PROMPTS[styleArg] ?? STYLE_PROMPTS.standard;
    let draft;
    try {
        draft = decodeDraft(b64);
    }
    catch (error) {
        return { kind: "error", text: error instanceof SparkleError ? error.message : String(error) };
    }
    try {
        let provider;
        let model;
        const fast = clientOptions?.fastModel ?? config.fastModel;
        if (fast?.provider && fast.provider.trim() !== "" && fast?.model && fast.model.trim() !== "") {
            provider = fast.provider.trim();
            model = fast.model.trim();
        }
        else {
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
    }
    catch (error) {
        if (signal.aborted)
            throw error;
        return {
            kind: "error",
            text: error instanceof SparkleError ? error.message : `润色失败：${String(error)}`,
        };
    }
}
export default class PromptSparkleService extends Service {
    config;
    static inject = ["commands", "llm"];
    static Config = Config;
    constructor(ctx, config = {}) {
        super(ctx, "promptSparkle");
        this.config = config;
        ctx.effect(() => ctx.commands.register({
            name: COMMAND_NAME,
            description: "润色当前输入框草稿：用当前会话的模型重写为更清晰的提示词 (/sparkle <base64> [style] [optionsBase64])",
            // 草稿以 base64 走参数，不落会话日志。
            recordInput: false,
            handler: (invocation) => handleSparkleCommand(invocation.agent, invocation.rawInput, ctx.llm, invocation.signal, this.config),
        }), "prompt-sparkle: /sparkle command");
    }
}
//# sourceMappingURL=index.js.map