#!/usr/bin/env node
/**
 * dsh-prompt-sparkle 本机发布脚本（替代已删除的 .github/workflows/publish.yml）。
 *
 * 原 CI 流程：推送 v* tag 后在 ubuntu 上 npm ci → npm test → npm publish。
 * 现改为本机一步执行：
 *   npm test（tsc 构建 + node --test）→ 版本递增 → npm publish --access public
 *   → git tag v<version> + 版本号提交（--no-git 可跳过，非 git 仓库自动跳过）。
 *
 * 用法：
 *   npm run publish:local                    # patch 递增（0.1.2 → 0.1.3）
 *   npm run publish:local -- --minor         # minor 递增
 *   npm run publish:local -- --major         # major 递增
 *   npm run publish:local -- 0.2.0            # 显式指定完整版本
 *   npm run publish:local -- --no-git        # 跳过 git tag/commit
 *   npm run publish:local -- --dry-run       # 只测试 + 算版本，不发布不打 tag
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, "..");
const PKG_PATH = join(PLUGIN_ROOT, "package.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipGit = args.includes("--no-git");
const explicit = args.find((a) => !a.startsWith("--"));
const bump = args.includes("--major") ? "major" : args.includes("--minor") ? "minor" : "patch";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

/** 在当前 semver 基础上递增（忽略 prerelease/build 后缀）。 */
function nextVersion(current, kind) {
  const base = current.split(/[-+]/)[0];
  const parts = base.split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    console.error(`✖ 无法解析当前版本：${current}`);
    process.exit(2);
  }
  if (kind === "major") return `${parts[0] + 1}.0.0`;
  if (kind === "minor") return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/**
 * 执行子进程。npm 在 Windows 上是 .cmd 批处理，不能脱离 shell 直接 spawn，
 * 因此经 cmd.exe /c 启动（避免 shell:true 的 DEP0190 弃用告警）。
 */
function run(cmd, cmdArgs, label) {
  console.log(`\n▶ ${label}`);
  let res;
  if (process.platform === "win32") {
    const cmdLine = `${cmd} ${cmdArgs.join(" ")}`;
    res = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", cmdLine], {
      cwd: PLUGIN_ROOT,
      stdio: "inherit",
    });
  } else {
    res = spawnSync(cmd, cmdArgs, { cwd: PLUGIN_ROOT, stdio: "inherit" });
  }
  if (res.status !== 0) {
    console.error(`✖ ${label} 失败（exit ${res.status ?? "信号中断"}）`);
    process.exit(res.status ?? 1);
  }
}

// 1) 测试 + 构建（对应原工作流的 npm ci + npm test；本机无需每次重装依赖）
run(npmCmd, ["test"], "npm test（tsc 构建 + node --test）");

// 2) 版本递增
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
const prev = pkg.version;
const next = explicit ?? nextVersion(prev, bump);
console.log(`\n版本 ${prev} → ${next}${dryRun ? "（dry-run：仅预览，不落盘不发布）" : ""}`);
if (!dryRun) {
  pkg.version = next;
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

// 3) 发布（对应原工作流的 npm publish --access public，需先 npm login）
if (dryRun) {
  console.log("（dry-run：跳过 npm publish --access public）");
} else {
  run(npmCmd, ["publish", "--access", "public"], "npm publish --access public");
}

// 4) git tag + 提交（对应原工作流的 v* tag 触发语义）
if (dryRun) {
  console.log("（dry-run：跳过 git tag/commit）");
} else if (skipGit) {
  console.log("（--no-git：跳过 git tag/commit）");
} else {
  const inRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: PLUGIN_ROOT,
    stdio: "ignore",
  });
  if (inRepo.status !== 0) {
    console.warn("（非 git 仓库：跳过 git tag/commit）");
  } else {
    run("git", ["add", "package.json"], "git add package.json");
    run("git", ["commit", "-m", `chore: release v${next}`], "git commit");
    run("git", ["tag", `v${next}`], `git tag v${next}`);
    console.log("\n提示：推送远端请执行  git push && git push --tags");
  }
}

console.log(`\n✔ 本机发布完成：v${next}（${new Date().toISOString()}）${dryRun ? " [dry-run]" : ""}`);
