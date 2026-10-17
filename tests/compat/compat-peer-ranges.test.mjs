// dsh-prompt-sparkle 兼容性测试：peer 依赖范围覆盖两个 deepseek-harness 版本。
// 语义：dsh-app-boot 的 evaluatePluginCompatibility 用
// semver.satisfies(runtime, range, { includePrerelease: true }) 校验每个
// @deepseek-ai/dsh 与 @deepseek-ai/dsh-* peer，因此范围必须用
// `>=0.1.0-rc.7 <0.3.0-0` 这种带 -0 上界的形式：既纳入 0.2.x 的
// prerelease（0.2.1-rc.2），又把 0.3.0 的 prerelease 排除在外。
// 运行：node --test tests/compat/compat-peer-ranges.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import semver from "semver";

const require = createRequire(import.meta.url);
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = require(join(pluginRoot, "package.json"));

/** 已支持版本的 harness 包版本集（0.1.x 与 0.2.x 全线）。 */
const SUPPORTED_HARNESS_VERSIONS = [
  "0.1.0-rc.7",
  "0.1.0-rc.8",
  "0.1.1-rc.1",
  "0.1.1-rc.2",
  "0.2.0-rc.1",
  "0.2.0-rc.2",
  "0.2.1-rc.2",
];

/** 与 harness 版本锁步发布的 peer 包（dsh-*）。 */
const LOCKSTEP_PEERS = [
  "@deepseek-ai/dsh-agent",
  "@deepseek-ai/dsh-commands",
  "@deepseek-ai/dsh-llm",
];

test("peerDependencies 存在且完整", () => {
  assert.ok(manifest.peerDependencies, "缺少 peerDependencies");
  for (const name of ["@deepseek-ai/cordis", ...LOCKSTEP_PEERS]) {
    assert.ok(manifest.peerDependencies[name], `缺少 peer 声明：${name}`);
  }
});

test("dsh-* peer 范围覆盖 0.1.0-rc.7 至 0.2.x 全线", () => {
  for (const name of LOCKSTEP_PEERS) {
    const range = manifest.peerDependencies[name];
    for (const version of SUPPORTED_HARNESS_VERSIONS) {
      assert.equal(
        semver.satisfies(version, range, { includePrerelease: true }),
        true,
        `${name} peer 范围 ${range} 应满足 ${version}`,
      );
    }
  }
});

test("dsh-* peer 范围排除明显不支持的版本", () => {
  for (const name of LOCKSTEP_PEERS) {
    const range = manifest.peerDependencies[name];
    assert.equal(semver.satisfies("0.1.0-rc.6", range, { includePrerelease: true }), false, `${name} 不应匹配 0.1.0-rc.6`);
    assert.equal(semver.satisfies("0.3.0-rc.1", range, { includePrerelease: true }), false, `${name} 不应匹配 0.3.0-rc.1`);
    assert.equal(semver.satisfies("0.3.0", range), false, `${name} 不应匹配 0.3.0`);
    assert.equal(semver.satisfies("1.0.0", range), false, `${name} 不应匹配 1.0.0`);
  }
});

test("cordis peer 覆盖 4.0.x（0.1.x 用 4.0.1，0.2.x 用 4.0.4/4.0.5）", () => {
  const range = manifest.peerDependencies["@deepseek-ai/cordis"];
  for (const version of ["4.0.1", "4.0.4", "4.0.5"]) {
    assert.equal(semver.satisfies(version, range), true, `cordis peer 范围 ${range} 应满足 ${version}`);
  }
  assert.equal(semver.satisfies("5.0.0", range), false, "cordis peer 不应匹配 5.x");
});

test("dsh-llm 必须位于 peerDependencies 而非 dependencies（避免与宿主副本重复）", () => {
  assert.equal(manifest.dependencies?.["@deepseek-ai/dsh-llm"], undefined,
    "dsh-llm 不应作为运行时依赖安装独立副本");
  assert.ok(manifest.peerDependencies["@deepseek-ai/dsh-llm"]);
});

test("schemastery 依赖覆盖 3.18.x（0.1.x 用 3.18.1，0.2.x 用 3.18.5）", () => {
  const range = manifest.dependencies["@deepseek-ai/schemastery"];
  for (const version of ["3.18.1", "3.18.5"]) {
    assert.equal(semver.satisfies(version, range), true, `schemastery 依赖范围 ${range} 应满足 ${version}`);
  }
});

test("devDependencies 覆盖测试所需的 0.2.1-rc.2 系列", () => {
  for (const name of [...LOCKSTEP_PEERS, "@deepseek-ai/cordis"]) {
    assert.ok(manifest.devDependencies?.[name], `缺少 devDependency：${name}`);
  }
  // 编译/类型检查基线：devDeps 精确锁到当前运行时 0.2.1-rc.2（与宿主同版本）
  for (const name of LOCKSTEP_PEERS) {
    assert.equal(
      manifest.devDependencies[name],
      "0.2.1-rc.2",
      `devDependencies ${name} 应精确锁定 0.2.1-rc.2`,
    );
  }
});
