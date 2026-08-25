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
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
/** 参与探测的宿主包名。 */
export const HARNESS_PACKAGES = [
    "@deepseek-ai/dsh-commands",
    "@deepseek-ai/dsh-agent",
    "@deepseek-ai/dsh-llm",
    "@deepseek-ai/cordis",
];
const defaultRequire = createRequire(import.meta.url);
/**
 * 解析一个包在宿主安装中的实际版本号。
 * 优先走 `包名/package.json` 导出；导出缺失时回退到主入口向上找包目录。
 * 解析不到返回空字符串（不抛错）。
 */
export function resolvePackageVersion(packageName, anchorPath) {
    const req = anchorPath ? createRequire(anchorPath) : defaultRequire;
    try {
        const manifest = req(`${packageName}/package.json`);
        if (manifest && typeof manifest.version === "string")
            return manifest.version;
    }
    catch {
        // exports 未暴露 ./package.json 或包缺失 → 走回退
    }
    try {
        const entry = req.resolve(packageName);
        let dir = dirname(entry);
        while (dir !== dirname(dir)) {
            const manifestPath = join(dir, "package.json");
            if (existsSync(manifestPath)) {
                try {
                    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
                    if (manifest?.name === packageName && typeof manifest.version === "string") {
                        return manifest.version;
                    }
                }
                catch {
                    // 损坏的 package.json 跳过
                }
            }
            dir = dirname(dir);
        }
    }
    catch {
        // 包完全不可解析
    }
    return "";
}
function parseVersion(raw) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(raw.trim());
    if (match === null)
        return undefined;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    const prerelease = match[4] === undefined ? [] : match[4].split(".");
    if ([major, minor, patch].some((part) => !Number.isInteger(part)))
        return undefined;
    return { major, minor, patch, prerelease };
}
function comparePrereleaseIdentifier(left, right) {
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
        const leftNumber = Number(left);
        const rightNumber = Number(right);
        return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
    }
    if (leftNumeric)
        return -1; // 数字标识符 < 字母标识符
    if (rightNumeric)
        return 1;
    return left < right ? -1 : left > right ? 1 : 0;
}
/**
 * 语义化版本比较（含 prerelease），返回 -1 / 0 / 1。
 * 规则：数字部分先比；相等时带 prerelease 的版本小于不带 prerelease 的版本；
 * prerelease 逐段比较（数字段按数值，字母段按字典序，数字段 < 字母段）。
 */
export function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (a === undefined || b === undefined) {
        // 无法解析时按原始字符串比较，保证全序
        return left < right ? -1 : left > right ? 1 : 0;
    }
    for (const key of ["major", "minor", "patch"]) {
        if (a[key] !== b[key])
            return a[key] < b[key] ? -1 : 1;
    }
    if (a.prerelease.length === 0 && b.prerelease.length === 0)
        return 0;
    if (a.prerelease.length === 0)
        return 1; // 1.0.0 > 1.0.0-rc.1
    if (b.prerelease.length === 0)
        return -1;
    const length = Math.max(a.prerelease.length, b.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = a.prerelease[index];
        const rightPart = b.prerelease[index];
        if (leftPart === undefined)
            return -1;
        if (rightPart === undefined)
            return 1;
        const compared = comparePrereleaseIdentifier(leftPart, rightPart);
        if (compared !== 0)
            return compared;
    }
    return 0;
}
/** 版本号是否落在 [lower, upper) 区间（含下界、不含上界）。 */
export function inVersionRange(version, lower, upper) {
    return compareVersions(version, lower) >= 0 && compareVersions(version, upper) < 0;
}
/** 按已知 wire 协议分界把版本归类为兼容家族。 */
export function familyOf(version) {
    if (version === "")
        return "unknown";
    // 0.1.0-rc.7 及更早（>=0.1.0-rc.7 且 <0.1.0-rc.8）：execute 无 images 参数
    if (inVersionRange(version, "0.1.0-rc.7", "0.1.0-rc.8"))
        return "legacy-rc7";
    // 0.1.0-rc.8 起（含 0.1.1-rc.x）：execute 带 images 参数
    if (inVersionRange(version, "0.1.0-rc.8", "0.2.0"))
        return "current";
    return "unknown";
}
/**
 * 探测当前宿主 harness 的版本信息。
 * 以 dsh-commands 的实测版本为主判据（与 harness 版本锁步发布），
 * 其余包版本一并带回供日志与诊断。
 */
export function detectHarnessVersion(anchorPath) {
    const commands = resolvePackageVersion("@deepseek-ai/dsh-commands", anchorPath);
    return {
        family: familyOf(commands),
        packages: {
            commands,
            agent: resolvePackageVersion("@deepseek-ai/dsh-agent", anchorPath),
            llm: resolvePackageVersion("@deepseek-ai/dsh-llm", anchorPath),
            cordis: resolvePackageVersion("@deepseek-ai/cordis", anchorPath),
        },
    };
}
/** 人类可读的探测摘要（供启动日志）。 */
export function describeHarness(info) {
    const parts = Object.entries(info.packages)
        .filter(([, version]) => version !== "")
        .map(([name, version]) => `${name}@${version}`);
    return `family=${info.family}${parts.length === 0 ? "" : ` (${parts.join(", ")})`}`;
}
//# sourceMappingURL=harness-version.js.map