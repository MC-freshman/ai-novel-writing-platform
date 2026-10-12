const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { connectCdp } = require("./lib/cdp-client.cjs");
const [mode, projectPath, executable, label, reportPath] =
  process.argv.slice(2);
process.env.NOVEL_PLATFORM_TEST = "1";
const platform = require("../electron/main.cjs");
const storage = require("../electron/services/project-storage.cjs");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  if (mode === "seed") {
    await platform.ensureProjectStructure(projectPath, "安装升级合成项目");
    const config = await platform.loadConfig(projectPath);
    config.ui.autosaveMs = 0;
    config.agent.autoLocalAnalysis = false;
    config.agent.autoDeepAnalysis = false;
    config.chapters = [
      {
        id: "installer-chapter",
        title: "安装验收正文",
        fileName: "installer.md",
        volume: "合成卷",
        knowledgeRole: "正文",
        order: 0,
        wordCount: 9,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    await platform.saveConfig(projectPath, config);
    await fs.writeFile(
      platform.getChapterPath(projectPath, config.chapters[0]),
      "<p>升级前保留的合成正文。</p>",
    );
    await fs.writeFile(
      path.join(projectPath, "external-preserved.txt"),
      "卸载后应保留的外部项目数据。",
    );
    return;
  }
  assert.equal(mode, "smoke");
  const port = 11000 + Math.floor(Math.random() * 1000);
  const env = { ...process.env, NOVEL_TEST_PROJECT_PATH: projectPath };
  delete env.NOVEL_PLATFORM_TEST;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${path.join(path.dirname(projectPath), "installed-user-data")}`,
    ],
    { env, stdio: "ignore", windowsHide: true },
  );
  let client;
  try {
    let target;
    for (let i = 0; i < 150 && !target; i++) {
      try {
        target = (
          await fetch(`http://127.0.0.1:${port}/json/list`).then((r) =>
            r.json(),
          )
        ).find((t) => t.type === "page");
      } catch {
        /* Startup. */
      }
      if (!target) await wait(150);
    }
    assert.ok(target, "安装版启动并暴露真实窗口");
    client = connectCdp(target.webSocketDebuggerUrl);
    await client.ready;
    let ready = false;
    for (let i = 0; i < 150; i++) {
      ready = await client.evaluate(
        "Boolean(document.querySelector('.ProseMirror')) && document.body.textContent.includes('安装升级合成项目')",
      );
      if (ready) break;
      await wait(100);
    }
    assert.ok(ready, "安装版读取外部合成项目");
    const state = await client.evaluate("window.novelAPI.getAppState()");
    assert.equal(path.resolve(state.projectPath), path.resolve(projectPath));
    const chapter = state.chapters.find((c) => c.id === "installer-chapter");
    assert.ok(chapter);
    const before = await fs.readFile(
      platform.getChapterPath(projectPath, chapter),
      "utf8",
    );
    assert.match(before, /升级前保留/);
    const marker = label + "安装版真实保存";
    await client.evaluate(`(()=>{const editor=document.querySelector('.ProseMirror');editor.focus();const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);})()`);
    await client.call("Input.insertText", { text: "升级前保留的合成正文。" + marker });
    await wait(200);
    await client.evaluate("document.querySelector('.save-action').click()");
    let saved = "";
    for (let i = 0; i < 150; i++) {
      saved = await fs.readFile(
        platform.getChapterPath(projectPath, chapter),
        "utf8",
      );
      if (saved.includes(marker)) break;
      await wait(100);
    }
    assert.match(saved, new RegExp(marker));
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(
      reportPath,
      JSON.stringify(
        {
          status: "passed",
          label,
          executable,
          projectPath,
          chapterId: chapter.id,
          beforeHash: storage.sha256(Buffer.from(before)),
          afterHash: storage.sha256(Buffer.from(saved)),
          check: "真实安装版窗口读取已有正文并通过保存按钮写入修改",
        },
        null,
        2,
      ),
    );
  } finally {
    if (client) {
      try {
        await client.evaluate("window.close()");
      } catch {
        /* Closing CDP. */
      }
      client.close();
    }
    if (child.exitCode === null) {
      await Promise.race([once(child, "exit"), wait(6000)]);
      if (child.exitCode === null) child.kill();
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
