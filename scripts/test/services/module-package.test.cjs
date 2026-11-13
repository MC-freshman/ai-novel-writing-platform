"use strict";
// 模块包完整性校验测试（P102）：生成/校验/篡改检测/未登记文件。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture } = require("../helpers/service-fixture.cjs");
const { generateManifest, verifyManifest } = require("../../verify-module-package.cjs");

test("生成清单并校验通过", async (t) => {
  const root = await fixture(t);
  const moduleDir = path.join(root, "mindmap-my");
  await fs.mkdir(path.join(moduleDir, "src"), { recursive: true });
  await fs.writeFile(path.join(moduleDir, "contract.ts"), "export const MIND_MAP_CONTRACT_VERSION = 1;");
  await fs.writeFile(path.join(moduleDir, "src", "index.tsx"), "export const x = 1;");
  const generated = generateManifest(moduleDir);
  assert.equal(generated.files, 2);
  const result = verifyManifest(moduleDir);
  assert.equal(result.verified, true);
  assert.equal(result.checked, 2);
});

test("篡改与未登记文件检测", async (t) => {
  const root = await fixture(t);
  const moduleDir = path.join(root, "module");
  await fs.mkdir(moduleDir);
  await fs.writeFile(path.join(moduleDir, "a.ts"), "original");
  generateManifest(moduleDir);
  await fs.writeFile(path.join(moduleDir, "a.ts"), "tampered");
  const tampered = verifyManifest(moduleDir);
  assert.equal(tampered.verified, false);
  assert.ok(tampered.mismatches.includes("a.ts"));
  await fs.writeFile(path.join(moduleDir, "a.ts"), "original");
  await fs.writeFile(path.join(moduleDir, "extra.ts"), "unlisted");
  const unlisted = verifyManifest(moduleDir);
  assert.equal(unlisted.verified, false);
  assert.ok(unlisted.unlisted.includes("extra.ts"));
});

test("缺少清单返回明确原因", async (t) => {
  const root = await fixture(t);
  const moduleDir = path.join(root, "empty");
  await fs.mkdir(moduleDir);
  const result = verifyManifest(moduleDir);
  assert.equal(result.verified, false);
  assert.ok(result.reason.includes("SHA256SUMS"));
});