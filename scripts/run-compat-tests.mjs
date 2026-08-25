#!/usr/bin/env node
/**
 * dsh-prompt-sparkle 兼容性测试编排器。
 *
 * 在两个隔离 harness 环境（deepseek-harness 0.1.0-rc.7 与当前版
 * 0.1.1-rc.2）下依次运行：
 *   1. 回归基线：npm run build + 原有功能测试（tests/*.test.mjs）
 *   2. 版本识别模块测试（compat-version）
 *   3. peer 依赖范围测试（compat-peer-ranges）
 *   4. 宿主编排集成测试（compat-host-integration，真实 harness 包）
 *   5. 客户端线协议测试（compat-client）
 *   6. 安装 + 组合 + 真实启动加载测试（compat-install-load）
 *
 * 结果写入 JSONL 台账（tests/compat/reports/ledger-<ts>.jsonl）并汇总
 * 控制台摘要与 Markdown 报告（tests/compat/reports/report-<ts>.md）。
 *
 * 用法：
 *   node scripts/run-compat-tests.mjs [--env rc7|current|all] [--skip-install] [--no-regression]
 */

import { spawnSync } from "node:child_process";
import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, "..");
const COMPAT_ENV_ROOT = join(PLUGIN_ROOT, "..", "compat-env");
const COMPAT_TESTS = join(PLUGIN_ROOT, "tests", "compat");

const args = process.argv.slice(2);
const envFlag = argValue(args, "--env") ?? "all";
const skipInstall = args.includes("--skip-install");
const withRegression = !args.includes("--no-regression");

const ENVIRONMENTS = [
  { key: "rc7", version: "0.1.0-rc.7", family: "legacy-rc7", harnessDir: join(COMPAT_ENV_ROOT, "harness-0.1.0-rc.7") },
  { key: "current", version: "0.1.1-rc.2", family: "current", harnessDir: join(COMPAT_ENV_ROOT, "harness-0.1.1-rc.2") },
].filter((env) => envFlag === "all" || envFlag === env.key);

if (ENVIRONMENTS.length === 0) {
  console.error(`未知 --env：${envFlag}（可选 rc7 | current | all）`);
  process.exit(2);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportDir = join(COMPAT_TESTS, "reports");
mkdirSync(reportDir, { recursive: true });
const ledgerPath = join(reportDir, `ledger-${timestamp}.jsonl`);
const reportPath = join(reportDir, `report-${timestamp}.md`);

/** 台账：每个用例一行 JSON。 */
const ledger = [];
function record(entry) {
  ledger.push(entry);
  writeFileSync(ledgerPath, ledger.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
}

function run(command, argsList, options = {}) {
  const isCmd = process.platform === "win32" && (command === "npm" || command === "pnpm" || command === "npx");
  const actualCmd = isCmd ? `${command}.cmd` : command;
  const result = spawnSync(actualCmd, argsList, {
    cwd: options.cwd ?? PLUGIN_ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
    timeout: options.timeout ?? 300_000,
    maxBuffer: 64 * 1024 * 1024,
    shell: isCmd,
  });
  return result;
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseTapOutput(stdout, stderr, status) {
  const cases = [];
  const lines = stdout.split(/\r?\n/);
  let currentCase = null;
  let inYaml = false;
  let yamlLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = /^(ok|not ok)\s+\d+\s+-\s+(.+)$/.exec(line);
    if (match) {
      if (currentCase) {
        cases.push(currentCase);
      }
      currentCase = {
        name: match[2].trim(),
        pass: match[1] === "ok",
        durationMs: 0,
        error: null,
      };
      inYaml = false;
      yamlLines = [];
      continue;
    }
    if (currentCase) {
      if (line.trim() === "---") {
        inYaml = true;
        continue;
      }
      if (line.trim() === "...") {
        inYaml = false;
        const durMatch = /duration_ms:\s*([0-9.]+)/.exec(yamlLines.join("\n"));
        if (durMatch) currentCase.durationMs = parseFloat(durMatch[1]);
        if (!currentCase.pass) {
          currentCase.error = yamlLines.join("\n").trim();
        }
        continue;
      }
      if (inYaml) {
        yamlLines.push(line);
      }
    }
  }
  if (currentCase) {
    cases.push(currentCase);
  }

  if (cases.length === 0 && status !== 0) {
    cases.push({
      name: "(runner failure)",
      pass: false,
      durationMs: 0,
      error: (stderr || stdout).slice(0, 4000),
    });
  }
  return cases;
}

/** 用 TAP reporter 跑一个 node --test 文件，返回用例结果数组。 */
function runTestFile(file, env) {
  const label = `${env?.key ?? "base"}/${file}`;
  console.log(`\n=== ${label} ===`);
  const result = run(process.execPath, [
    "--test",
    "--test-reporter=tap",
    join(COMPAT_TESTS, file),
  ], {
    env: env
      ? { DSH_HARNESS_DIR: env.harnessDir, DSH_HARNESS_FAMILY: env.family }
      : undefined,
    timeout: env?.key === undefined ? 120_000 : 300_000,
  });
  const cases = parseTapOutput(result.stdout, result.stderr, result.status);
  const passed = cases.filter((c) => c.pass).length;
  for (const c of cases) {
    record({
      ts: new Date().toISOString(),
      env: env?.key ?? "base",
      harnessVersion: env?.version ?? "n/a",
      file,
      test: c.name,
      pass: c.pass,
      durationMs: c.durationMs,
      error: c.error,
    });
  }
  console.log(`  ${passed}/${cases.length} passed`);
  if (cases.some((c) => !c.pass)) {
    for (const c of cases.filter((c) => !c.pass)) {
      console.error(`  FAIL ${c.name}\n${(c.error ?? "").split("\n").slice(0, 12).join("\n")}`);
    }
  }
  return { cases, status: result.status };
}

/** 确保隔离 harness 环境已安装。 */
function ensureHarnessEnv(env) {
  if (existsSync(join(env.harnessDir, "node_modules", "@deepseek-ai", "dsh"))) return;
  if (skipInstall) {
    console.error(`环境缺失且 --skip-install：${env.harnessDir}`);
    process.exit(2);
  }
  console.log(`\n[env] 安装 @deepseek-ai/dsh@${env.version} → ${env.harnessDir}（首次较慢）`);
  mkdirSync(env.harnessDir, { recursive: true });
  writeFileSync(join(env.harnessDir, "package.json"), JSON.stringify({ name: `harness-${env.key}-env`, private: true }), "utf8");
  const result = run("npm", ["install", `@deepseek-ai/dsh@${env.version}`, "--no-audit", "--no-fund"], {
    cwd: env.harnessDir,
    timeout: 600_000,
  });
  if (result.status !== 0) {
    console.error(`@deepseek-ai/dsh@${env.version} 安装失败：\n${result.stderr}`);
    process.exit(1);
  }
  console.log(`[env] ${env.version} 安装完成`);
}

// ---------- 执行 ----------

const summary = { environments: {}, regression: null };

if (withRegression) {
  console.log("\n=== [回归基线] npm run build + 原有功能测试 ===");
  const build = run("npm", ["run", "build"]);
  if (build.status !== 0) {
    console.error(`构建失败：\n${build.stderr}`);
    process.exit(1);
  }
  const testFiles = globSync("tests/*.test.mjs", { cwd: PLUGIN_ROOT }).map((f) => join(PLUGIN_ROOT, f));
  const test = run(process.execPath, ["--test", "--test-reporter=tap", ...testFiles]);
  const cases = parseTapOutput(test.stdout, test.stderr, test.status);
  summary.regression = cases;
  for (const c of cases) {
    record({
      ts: new Date().toISOString(),
      env: "base",
      harnessVersion: "n/a",
      file: "tests/*.test.mjs (regression)",
      test: c.name,
      pass: c.pass,
      durationMs: c.durationMs,
      error: c.error,
    });
  }
  const passed = cases.filter((c) => c.pass).length;
  console.log(`  回归基线 ${passed}/${cases.length} passed`);
  if (passed !== cases.length) {
    console.error("回归基线未全通过，中止兼容性矩阵。");
    process.exit(1);
  }
}

// 环境无关测试（跑一次）
runTestFile("compat-version.test.mjs", undefined);
runTestFile("compat-peer-ranges.test.mjs", undefined);
runTestFile("compat-client.test.mjs", undefined);

for (const env of ENVIRONMENTS) {
  console.log(`\n\n########## 环境：deepseek-harness ${env.version} (${env.family}) ##########`);
  ensureHarnessEnv(env);
  const host = runTestFile("compat-host-integration.test.mjs", env);
  const install = runTestFile("compat-install-load.test.mjs", env);
  summary.environments[env.key] = { host, install };
}

// ---------- 汇总报告 ----------

const allCases = ledger;
const total = allCases.length;
const passedTotal = allCases.filter((c) => c.pass).length;
const failed = allCases.filter((c) => !c.pass);
const byEnv = Object.groupBy ? Object.groupBy(allCases, (c) => c.env) : null;

let markdown = `# dsh-prompt-sparkle 兼容性测试报告

- **时间**：${new Date().toISOString()}
- **插件版本**：${JSON.parse(readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8")).version}
- **测试环境**：Windows（node ${process.version}）
- **覆盖版本**：deepseek-harness ${ENVIRONMENTS.map((e) => e.version).join("、") || "（无）"}
- **台账**：\`tests/compat/reports/ledger-${timestamp}.jsonl\`

## 结果总览

| 环境 | 用例数 | 通过 | 失败 | 通过率 |
|------|--------|------|------|--------|
`;

const envNames = new Set(allCases.map((c) => c.env));
for (const name of [...envNames].sort()) {
  const rows = allCases.filter((c) => c.env === name);
  const pass = rows.filter((c) => c.pass).length;
  markdown += `| ${name} | ${rows.length} | ${pass} | ${rows.length - pass} | ${(100 * pass / rows.length).toFixed(1)}% |\n`;
}
markdown += `| **合计** | **${total}** | **${passedTotal}** | **${failed.length}** | **${(100 * passedTotal / total).toFixed(1)}%** |\n\n`;

markdown += `## 失败明细\n\n`;
if (failed.length === 0) {
  markdown += `无失败用例。✅\n`;
} else {
  for (const c of failed) {
    markdown += `### ${c.env} / ${c.file} / ${c.test}\n\n\`\`\`\n${c.error}\n\`\`\`\n\n`;
  }
}

markdown += `## 用例台账（摘要）\n\n| 环境 | 文件 | 用例 | 结果 | 耗时(ms) |\n|------|------|------|------|----------|\n`;
for (const c of allCases) {
  markdown += `| ${c.env} | ${c.file} | ${c.test.replaceAll("|", "\\|")} | ${c.pass ? "✅" : "❌"} | ${c.durationMs} |\n`;
}

writeFileSync(reportPath, markdown, "utf8");
console.log(`\n\n===== 汇总 =====`);
console.log(`用例总数：${total}，通过：${passedTotal}，失败：${failed.length}`);
console.log(`台账：${ledgerPath}`);
console.log(`报告：${reportPath}`);
process.exit(failed.length === 0 ? 0 : 1);
