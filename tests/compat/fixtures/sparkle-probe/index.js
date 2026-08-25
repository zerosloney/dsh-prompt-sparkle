/**
 * sparkle-probe：兼容性测试探针插件（仅测试用，绝不发布）。
 *
 * 作用：在真实 dsh CLI 启动流程中验证 dsh-prompt-sparkle 已作为 bundle
 * 加载——本插件静态注入 `promptSparkle` 服务（Cordis 注入即等待该服务
 * 就绪，注入失败会挂起/报错），并确认 commands 服务与 sparkle 命令
 * 注册可用，然后把结果写入 SPARKLE_PROBE_MARKER 指向的文件并退出。
 */

import { writeFileSync } from "node:fs";
import { Service } from "@deepseek-ai/cordis";

export default class SparkleProbeService extends Service {
  static inject = ["promptSparkle"];

  constructor(ctx) {
    super(ctx, "sparkleProbe");

    // 稍等一拍让命令注册 effect 落地，再写标记
    setImmediate(() => {
      let outcome;
      try {
        const sparkle = ctx.get("promptSparkle");
        const commands = ctx.get("commands");
        const sparkleCommand = typeof commands?.register === "function";
        const marker = process.env.SPARKLE_PROBE_MARKER;
        if (!marker) throw new Error("SPARKLE_PROBE_MARKER 未设置");
        outcome = {
          ok: sparkle !== undefined && sparkleCommand,
          sparkleService: sparkle !== undefined,
          commandsService: commands !== undefined,
          harnessCommandsVersion: commands?.constructor?.name ?? null,
        };
        writeFileSync(marker, JSON.stringify(outcome), "utf8");
        process.exit(outcome.ok ? 0 : 2);
      } catch (error) {
        outcome = { ok: false, error: String(error) };
        try {
          const marker = process.env.SPARKLE_PROBE_MARKER;
          if (marker) writeFileSync(marker, JSON.stringify(outcome), "utf8");
        } catch {
          // 标记写失败也照常退出非零
        }
        process.exit(1);
      }
    }, 200);
  }
}
