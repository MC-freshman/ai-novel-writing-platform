const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createManifest, verifyManifest, releaseNames } = require("../../lib/release-checksums.cjs");
const { extractButtonElements } = require("../../lib/button-audit.cjs");

test("JSX按钮审计识别动态标签和条件文字，图标没有文字，分隔符不成为重复标签", () => {
  const buttons = extractButtonElements('<><button>{label}</button><button>{locked ? "解锁" : "锁定"}</button><button><Plus /></button><button>{item.volume} / {item.title}</button></>');
  assert.deepEqual(buttons.map((item) => item.dynamicLabel), [true, true, false, true]);
  assert.equal(buttons[2].label, "");
  assert.equal(buttons[3].label, "/");
});
test("发布校验拒绝缺项、篡改和错版本", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-checksums-"));
  t.after(async () => {
    const relative = path.relative(path.resolve(os.tmpdir()), root);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  });
  for (const name of releaseNames("1.2.3")) await fs.writeFile(path.join(root, name), name === "latest.yml" ? "version: 1.2.3\n" : name);
  const body = await createManifest(root, "1.2.3");
  assert.equal(await verifyManifest(root, "1.2.3", body), 4);
  await assert.rejects(verifyManifest(root, "1.2.3", body.split("\n").slice(1).join("\n")), /缺项/);
  await fs.writeFile(path.join(root, releaseNames("1.2.3")[0]), "被篡改");
  await assert.rejects(verifyManifest(root, "1.2.3", body), /哈希/);
  await fs.writeFile(path.join(root, "latest.yml"), "version: 1.2.2\n");
  await assert.rejects(createManifest(root, "1.2.3"), /版本/);
});
