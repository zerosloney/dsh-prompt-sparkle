/**
 * dsh-prompt-sparkle 兼容层：自动识别 deepseek-harness 版本。
 *
 * 插件同时支持 deepseek-harness 0.1.0-rc.7 与 0.1.1-rc.x（当前线）。
 * 两个版本在插件用到的 host seam 上源码级一致，唯一的行为差异在浏览器
 * 半边的 `commands.execute` wire 协议（0.1.0-rc.8 起新增 `images` 业务
 * 参数）。本模块负责 host 侧的版本探测与“兼容家族”归类，供启动日志与
 * 诊断使用；浏览器半边另有独立的线协议能力探测（见 lib/client.js 的
 * resolveExecuteMode），两者互补。
 *
 * 依赖解析策略：dsh-commands / dsh-agent / dsh-llm / cordis 均以 peer
 * 语义由宿主 harness 提供，因此这里直接从插件自身的解析锚点向上查找
 * 宿主安装的包版本，绝不额外安装任何副本。
 */
/**
 * 兼容家族：
 * - `legacy-rc7`：execute 线协议为 `(agent, line, signal)`（0.1.0-rc.7）
 * - `current`：execute 线协议为 `(agent, line, images, signal)`（≥0.1.0-rc.8）
 * - `unknown`：无法解析或版本超出已知范围
 */
export type HarnessCompatFamily = "legacy-rc7" | "current" | "unknown";
/** 一次完整的版本探测结果。 */
export interface HarnessVersionInfo {
    /** 兼容家族（驱动行为归类的规范标签）。 */
    readonly family: HarnessCompatFamily;
    /** 关键宿主包的实测版本；解析失败为空字符串。 */
    readonly packages: {
        readonly commands: string;
        readonly agent: string;
        readonly llm: string;
        readonly cordis: string;
    };
}
/** 参与探测的宿主包名。 */
export declare const HARNESS_PACKAGES: readonly ["@deepseek-ai/dsh-commands", "@deepseek-ai/dsh-agent", "@deepseek-ai/dsh-llm", "@deepseek-ai/cordis"];
/**
 * 解析一个包在宿主安装中的实际版本号。
 * 优先走 `包名/package.json` 导出；导出缺失时回退到主入口向上找包目录。
 * 解析不到返回空字符串（不抛错）。
 */
export declare function resolvePackageVersion(packageName: string, anchorPath?: string): string;
/**
 * 语义化版本比较（含 prerelease），返回 -1 / 0 / 1。
 * 规则：数字部分先比；相等时带 prerelease 的版本小于不带 prerelease 的版本；
 * prerelease 逐段比较（数字段按数值，字母段按字典序，数字段 < 字母段）。
 */
export declare function compareVersions(left: string, right: string): -1 | 0 | 1;
/** 版本号是否落在 [lower, upper) 区间（含下界、不含上界）。 */
export declare function inVersionRange(version: string, lower: string, upper: string): boolean;
/** 按已知 wire 协议分界把版本归类为兼容家族。 */
export declare function familyOf(version: string): HarnessCompatFamily;
/**
 * 探测当前宿主 harness 的版本信息。
 * 以 dsh-commands 的实测版本为主判据（与 harness 版本锁步发布），
 * 其余包版本一并带回供日志与诊断。
 */
export declare function detectHarnessVersion(anchorPath?: string): HarnessVersionInfo;
/** 人类可读的探测摘要（供启动日志）。 */
export declare function describeHarness(info: HarnessVersionInfo): string;
