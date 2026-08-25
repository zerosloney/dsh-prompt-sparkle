// dsh-prompt-sparkle 兼容性测试：版本识别模块（src/harness-version.ts）。
// 覆盖：语义化版本比较（含 prerelease）、兼容家族归类、运行时探测。
// 运行：node --test tests/compat/compat-version.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import {
  compareVersions,
  inVersionRange,
  familyOf,
  resolvePackageVersion,
  detectHarnessVersion,
  describeHarness,
} from "../../lib/harness-version.js";

// ---------- compareVersions ----------

test("compareVersions：数字部分比较", () => {
  assert.equal(compareVersions("0.1.0-rc.7", "0.1.0-rc.7"), 0);
  assert.equal(compareVersions("0.1.0-rc.7", "0.1.1-rc.2"), -1);
  assert.equal(compareVersions("0.1.1-rc.2", "0.1.0-rc.7"), 1);
  assert.equal(compareVersions("0.1.0-rc.8", "0.1.0-rc.7"), 1);
  assert.equal(compareVersions("0.2.0", "0.1.1-rc.2"), 1);
});

test("compareVersions：稳定版大于同号 prerelease", () => {
  assert.equal(compareVersions("0.1.1", "0.1.1-rc.2"), 1);
  assert.equal(compareVersions("0.1.1-rc.2", "0.1.1"), -1);
});

test("compareVersions：prerelease 分段比较（数字段 < 字母段，rc 递增）", () => {
  assert.equal(compareVersions("0.1.0-rc.2", "0.1.0-rc.10"), -1);
  assert.equal(compareVersions("0.1.0-rc.7", "0.1.0-rc.8"), -1);
  assert.equal(compareVersions("0.1.0-rc.7", "0.1.0-alpha"), 1, "alpha < rc（字典序），故 rc.7 > alpha");
  assert.equal(compareVersions("0.1.0-alpha", "0.1.0-rc.7"), -1, "alpha < rc");
  assert.equal(compareVersions("0.1.0-rc.7.1", "0.1.0-rc.7"), 1);
});

test("compareVersions：非法输入按原始字符串比较（保证全序）", () => {
  assert.equal(compareVersions("", "0.1.0-rc.7"), -1);
  assert.equal(compareVersions("garbage", "0.1.0-rc.7"), 1);
});

// ---------- inVersionRange ----------

test("inVersionRange：闭开区间语义", () => {
  assert.equal(inVersionRange("0.1.0-rc.7", "0.1.0-rc.7", "0.1.0-rc.8"), true);
  assert.equal(inVersionRange("0.1.0-rc.8", "0.1.0-rc.7", "0.1.0-rc.8"), false);
  assert.equal(inVersionRange("0.1.0-rc.6", "0.1.0-rc.7", "0.1.0-rc.8"), false);
});

// ---------- familyOf ----------

test("familyOf：0.1.0-rc.7 归类 legacy-rc7（execute 无 images 参数）", () => {
  assert.equal(familyOf("0.1.0-rc.7"), "legacy-rc7");
});

test("familyOf：0.1.0-rc.8 / 0.1.1-rc.x 归类 current（execute 带 images 参数）", () => {
  assert.equal(familyOf("0.1.0-rc.8"), "current");
  assert.equal(familyOf("0.1.1-rc.1"), "current");
  assert.equal(familyOf("0.1.1-rc.2"), "current");
});

test("familyOf：未知/空版本归类 unknown", () => {
  assert.equal(familyOf(""), "unknown");
  assert.equal(familyOf("0.0.1-rc.1"), "unknown");
  assert.equal(familyOf("0.2.0"), "unknown");
  assert.equal(familyOf("1.0.0"), "unknown");
});

// ---------- resolvePackageVersion / detectHarnessVersion ----------

test("detectHarnessVersion：在当前开发环境解析到 dsh 包版本", () => {
  const info = detectHarnessVersion();
  assert.equal(typeof info.family, "string");
  // 插件 devDependencies 安装的是 0.1.1-rc.2 系列
  assert.equal(info.packages.commands, "0.1.1-rc.2");
  assert.equal(info.packages.llm, "0.1.1-rc.2");
  assert.equal(info.packages.cordis, "4.0.1");
  assert.equal(info.family, "current");
});

test("resolvePackageVersion：不存在的包返回空字符串（不抛错）", () => {
  assert.equal(resolvePackageVersion("@deepseek-ai/definitely-not-a-real-package"), "");
});

test("describeHarness：输出人类可读摘要", () => {
  const info = detectHarnessVersion();
  const text = describeHarness(info);
  assert.match(text, /family=current/);
  assert.match(text, /commands@0\.1\.1-rc\.2/);
});
