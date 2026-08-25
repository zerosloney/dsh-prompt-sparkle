// dsh-prompt-sparkle 兼容性测试：安装 + 组合 + 真实 CLI 启动加载。
//
// 在隔离的 DSH_HOME（compat-env/home-<ver>）中用目标版本的 dsh CLI
// （DSH_HARNESS_DIR）执行：
//   1. `dsh plugin --profile headless add <plugin> <probe>` —— 安装插件
//   2. 校验 profile 依赖与 bundles 清单
//   3. `dsh --profile headless --dump-config` —— 组合树含插件行
//   4. `dsh --profile headless "probe-task"` —— 真实启动；探针插件注入
//      promptSparkle 服务成功后写标记并退出 0
// 运行（由 scripts/run-compat-tests.mjs 编排）：
//   DSH_HARNESS_DIR=<dir> DSH_HARNESS_FAMILY=<legacy-rc7|current> \
//   node --test tests/compat/compat-install-load.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, "..", "..");
const PROBE_DIR = join(HERE, "fixtures", "sparkle-probe");
const COMPAT_ENV_ROOT = join(PLUGIN_ROOT, "..", "compat-env");

const harnessDir = process.env.DSH_HARNESS_DIR;
const expectedFamily = process.env.DSH_HARNESS_FAMILY ?? "unknown";
assert.ok(harnessDir && existsSync(harnessDir), "需要 DSH_HARNESS_DIR");

const versionTag = expectedFamily === "legacy-rc7" ? "0.1.0-rc.7" : "0.1.1-rc.2";
const dshBin = join(harnessDir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const dshHome = join(COMPAT_ENV_ROOT, `home-${versionTag}`);
const profileDir = join(dshHome, "profiles", "headless");
const markerFile = join(tmpdir(), `sparkle-probe-marker-${versionTag}.json`);

function runDsh(args, options = {}) {
  const result = spawnSync(process.execPath, [dshBin, ...args], {
    cwd: PLUGIN_ROOT,
    env: {
      ...process.env,
      DSH_HOME: dshHome,
      ...(options.env ?? {}),
    },
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return result;
}

test.before(() => {
  rmSync(dshHome, { recursive: true, force: true });
  rmSync(markerFile, { force: true });
  mkdirSync(join(harnessDir, "node_modules"), { recursive: true });
  assert.ok(existsSync(dshBin), `dsh CLI 入口缺失：${dshBin}`);
});

// ---------- 安装 ----------

test("安装：dsh plugin add 在目标版本下成功（peer 范围被接受）", { timeout: 240_000 }, () => {
  const result = runDsh(["plugin", "--profile", "headless", "add", PLUGIN_ROOT, PROBE_DIR], {
    timeout: 240_000,
  });
  assert.equal(result.status, 0, `dsh plugin add 失败\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.doesNotMatch(result.stderr, /ERR_PNPM|unmet peer|not satisfy/i,
    `peer 依赖不应报错：\n${result.stderr}`);
});

test("安装状态：profile 依赖与 bundles 清单包含两个插件", () => {
  const manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
  const dep = manifest.dependencies["dsh-prompt-sparkle"];
  const normalizedRoot = PLUGIN_ROOT.replaceAll("\\", "/");
  assert.ok(dep && (dep === normalizedRoot || dep === `link:${normalizedRoot}` || dep === `file:${normalizedRoot}`),
    `profile 依赖应包含 dsh-prompt-sparkle（本地路径），实际为 ${dep}`);
  assert.ok(manifest.dependencies["sparkle-probe"], "profile 依赖应包含 sparkle-probe");
  const bundles = manifest.dsh.profile.bundles;
  assert.ok(bundles.includes("dsh-prompt-sparkle"), "bundles 应包含 dsh-prompt-sparkle");
  assert.ok(bundles.includes("sparkle-probe"), "bundles 应包含 sparkle-probe");
  // 插件的包必须在 profile 的 node_modules 中可解析
  assert.ok(existsSync(join(profileDir, "node_modules", "dsh-prompt-sparkle", "lib", "index.js")),
    "dsh-prompt-sparkle 应安装到 profile node_modules");
});

// ---------- 组合 ----------

test("组合：--dump-config 输出包含两个插件的行", () => {
  const result = runDsh(["--profile", "headless", "--dump-config"]);
  assert.equal(result.status, 0, `dump-config 失败：${result.stderr}`);
  assert.match(result.stdout, /prompt-sparkle/, "组合树应含 prompt-sparkle 行");
  assert.match(result.stdout, /sparkle-probe/, "组合树应含 sparkle-probe 行");
  assert.match(result.stdout, /dsh-prompt-sparkle/, "组合树应引用 dsh-prompt-sparkle 包");
});

// ---------- 真实启动加载 ----------

test("启动加载：headless boot 中插件加载、promptSparkle 服务注入成功", { timeout: 180_000 }, () => {
  const result = runDsh(["--profile", "headless", "probe-task"], {
    env: { SPARKLE_PROBE_MARKER: markerFile },
    timeout: 120_000,
  });
  assert.ok(existsSync(markerFile), `探针标记未写出。exit=${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  const probe = JSON.parse(readFileSync(markerFile, "utf8"));
  assert.equal(probe.ok, true, `探针断言失败：${JSON.stringify(probe)}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.equal(probe.sparkleService, true, "promptSparkle 服务应存在");
  assert.equal(probe.commandsService, true, "commands 服务应存在");
  assert.equal(result.status, 0, `探针应使进程以 0 退出，实际 ${result.status}`);
});

// ---------- 环境版本自检 ----------

test("环境版本：解析到的 harness 包版本与家族一致", () => {
  const manifest = JSON.parse(readFileSync(join(harnessDir, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8"));
  assert.equal(manifest.version, versionTag, `@deepseek-ai/dsh 版本应为 ${versionTag}`);
});
