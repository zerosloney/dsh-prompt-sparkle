#!/usr/bin/env node
/**
 * dsh-prompt-sparkle 兼容环境供给脚本：把一个隔离 harness 环境装到"该版本
 * 发布时刻"的依赖形态。供 run-compat-tests.mjs 调用，也可单独执行。
 *
 * 为什么不是一条 npm install：
 *  1. harness 各包互相以 ^range 互依，同版本列车后续版（如 0.1.0-rc.8）发布
 *     后，全新安装会漂移到列车末版，execute 线协议与 cordis 版本随之改变。
 *     legacy-rc7 家族须按根包自己的依赖清单，把 @deepseek-ai 依赖精确钉回根
 *     版本——这些包在根版本发布时必然已存在（否则根包无法发布），无需查询。
 *  2. --legacy-peer-deps 跳过 peer 自动安装（strict peer 解析在本机可长达
 *     30 分钟仍解不完），缺的 peer 由安装后的文件系统扫描按声明范围补齐；
 *     已精确钉版的依赖不受补装影响。
 *  3. npm 11.19+ 的 install-scripts 白名单（RFC npm/rfcs#868）要求落在
 *     package.json 层（CLI/env 层传入会在项目级 install 直接抛
 *     EALLOWSCRIPTS），因此 allowScripts 写在本环境的 package.json 里。
 *
 * 用法：
 *   node scripts/setup-compat-env.mjs --dir <envDir> --version <dshVersion> \
 *     --family <family> [--pin <name@ver>]...
 *
 * 幂等：环境 package.json 的 compat 标记与目标一致时直接返回。
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const args = process.argv.slice(2);
const envDir = argValue(args, "--dir");
const version = argValue(args, "--version");
const family = argValue(args, "--family") ?? "unknown";
const pins = args.flatMap((a, i) => (a === "--pin" && args[i + 1] ? [args[i + 1]] : []));

if (!envDir || !version) {
  console.error("用法：setup-compat-env.mjs --dir <envDir> --version <dshVersion> [--family <f>] [--pin name@ver]...");
  process.exit(2);
}

const pkgPath = join(envDir, "package.json");

/** 带 install-scripts 白名单的依赖（harness 依赖树中的原生包）。 */
const ALLOW_SCRIPTS = {
  "@deepseek-ai/dsh-subprocess-local": true,
  "koffi": true,
  "node-pty": true,
  "@google/genai": true,
  "protobufjs": true,
};

function npmEnv() {
  const env = { ...process.env };
  // 编排器常经 `npm run` 拉起：npm_config_allow_scripts 会被下游 npm 视为
  // CLI/env 层策略，在项目级 install 抛 EALLOWSCRIPTS（见文件头注释 3）。
  for (const key of Object.keys(env)) {
    if (/^npm_config_allow_scripts$/i.test(key)) delete env[key];
  }
  return env;
}

function npmCmd(args, options = {}) {
  const isWin = process.platform === "win32";
  return spawnSync(isWin ? "npm.cmd" : "npm", args, {
    env: npmEnv(),
    encoding: "utf8",
    shell: isWin,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function npmInstall(extraSpecs, label) {
  const result = npmCmd(["install", ...extraSpecs, "--no-audit", "--no-fund", "--legacy-peer-deps", "--prefer-offline"], {
    cwd: envDir,
    timeout: 1_800_000,
  });
  if (result.status !== 0) {
    const cause = result.error ? String(result.error) : result.signal ? `信号终止：${result.signal}` : "退出码非零";
    console.error(`[setup-compat-env] ${label} 失败（${cause}）：\n${(result.stderr || result.stdout || "").slice(-4000)}`);
    process.exit(1);
  }
}

/** 递归收集树内未满足的 peerDependencies（声明范围取自任一依赖方）。 */
function scanMissingPeers() {
  const nm = join(envDir, "node_modules");
  const peers = new Map();
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = join(dir, entry.name);
      if (entry.name.startsWith("@")) { walk(child); continue; }
      const pj = join(child, "package.json");
      if (existsSync(pj)) {
        try {
          const pkg = JSON.parse(readFileSync(pj, "utf8"));
          for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
            if (name.startsWith("node:") || pkg.peerDependenciesMeta?.[name]?.optional) continue;
            if (!peers.has(name)) {
              peers.set(name, { range, present: existsSync(join(nm, name, "package.json")) });
            }
          }
        } catch { /* 忽略坏包 */ }
      }
      walk(join(child, "node_modules"));
    }
  };
  walk(nm);
  return [...peers.entries()]
    .filter(([, v]) => !v.present)
    .map(([name, { range }]) => (range === "*" || range === "" ? name : `${name}@${range}`));
}

function writeMarker() {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.compat = { provisioned: version, family };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

// ---------- 幂等检查 ----------

if (existsSync(pkgPath)) {
  try {
    const marker = JSON.parse(readFileSync(pkgPath, "utf8")).compat;
    if (marker?.provisioned === version && marker?.family === family) {
      console.log(`[setup-compat-env] ${basename(envDir)} 已供给（${version} / ${family}），跳过`);
      process.exit(0);
    }
  } catch { /* 标记缺失或损坏：重新供给 */ }
}

// ---------- 供给 ----------

console.log(`[setup-compat-env] 供给 ${basename(envDir)}：@deepseek-ai/dsh@${version} (${family})`);
rmSync(envDir, { recursive: true, force: true });
mkdirSync(envDir, { recursive: true });

const dependencies = { "@deepseek-ai/dsh": version };
for (const pin of pins) {
  const at = pin.lastIndexOf("@");
  dependencies[pin.slice(0, at)] = pin.slice(at + 1);
}
writeFileSync(pkgPath, JSON.stringify({
  name: basename(envDir),
  private: true,
  allowScripts: ALLOW_SCRIPTS,
  dependencies,
}, null, 2) + "\n", "utf8");

// 1. 根包 + 显式 pin（legacy-rc7 家族随后会把整棵 @deepseek-ai 树钉回根版本）
npmInstall([], "基础安装");

// 2. 家族纯度钉版：基础安装后 @deepseek-ai/dsh-* 全被 caret 范围顶到列车
//    末版（rc.8），而漂移后的树里声明的范围是 ^0.1.0-rc.8（不承认 rc.7），
//    所以钉版集合不能从树内范围推导——逐包查注册表，rc.7 版本存在的（与根
//    包同一列车）一律精确钉回；rc.8 才引入的包保持自由解析。
if (family === "legacy-rc7") {
  const scopeDir = join(envDir, "node_modules", "@deepseek-ai");
  const names = existsSync(scopeDir)
    ? readdirSync(scopeDir).filter((n) => n.startsWith("dsh-") && n !== "dsh")
    : [];
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  let pinned = 0;
  for (const name of names) {
    const probe = npmCmd(["view", `@deepseek-ai/${name}@${version}`, "version", "--silent"], { timeout: 60_000 });
    if (probe.status !== 0) continue;
    pkg.dependencies[`@deepseek-ai/${name}`] = version;
    pinned += 1;
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  npmInstall([], `家族钉版（${pinned}/${names.length} 个 @deepseek-ai 包 → ${version}）`);
}

// 3. 补齐 --legacy-peer-deps 跳过的 peer。范围并入 package.json 再无参安装：
//    react 的 `^16 || ^17 || ...` 之类经 cmd 命令行传参会被当作 shell 管道
//    拆掉，JSON 清单则不受影响；钉版依赖不受补装顶版。
//
// 0.2.x 列车的树里存在"声明了但注册表查无此版本"的 peer（例如
// `@deepseek-ai/cordis-plugin-group@~1.0.5`——该列车实际发的是 1.0.4），
// 整批补装会因一个不可满足的范围整体 ETARGET 失败。因此改为逐个探测：
// 只补注册表确实存在的版本，不可满足的范围记入 warnings 后跳过
// （这些 peer 对插件的 host seam 测试无用：测试只用 cordis /
// dsh-commands / dsh-agent / dsh-llm / schemastery）。
const missing = scanMissingPeers();
const warnings = [];
if (missing.length > 0) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const installable = [];
  for (const spec of missing) {
    const at = spec.indexOf("@", 1);
    const name = at === -1 ? spec : spec.slice(0, at);
    const range = at === -1 ? "*" : spec.slice(at + 1);
    const probe = npmCmd(["view", `${name}@${range}`, "version", "--silent"], { timeout: 60_000 });
    if (probe.status !== 0) {
      warnings.push(`${name}@${range}（注册表无满足版本，跳过）`);
      continue;
    }
    pkg.dependencies[name] = range;
    installable.push(spec);
  }
  if (installable.length > 0) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    npmInstall([], `补装 ${installable.length} 个缺失 peer`);
  }
}

writeMarker();
for (const warning of warnings) {
  console.warn(`[setup-compat-env] 警告：跳过不可满足的 peer ${warning}`);
}
console.log(`[setup-compat-env] ${basename(envDir)} 供给完成`);
