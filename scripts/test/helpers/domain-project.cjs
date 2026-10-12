const fs = require("node:fs/promises");
const { fixture } = require("./service-fixture.cjs");
const platform = require("../../../electron/main.cjs");
const runtime = require("../../../electron/services/runtime-state.cjs");
const files = require("../../../electron/services/project-files.cjs");

async function domainProject(t) {
  const root = await fixture(t);
  await platform.ensureProjectStructure(root, "合成模块测试");
  const config = await platform.loadConfig(root);
  const contents = [
    "# 第一章\n\n清晨，李明进入圣城，决定寻找失踪的朋友。李明获得铜钥匙，却发现异常线索。\n王华与李明合作调查秘密。",
    "# 第二章\n\n翌日，王华返回圣城。李明知道城门已经关闭，必须寻找出口。",
    "# 第三章\n\n没有明确时间的合成段落，承接上一章并推动剧情发展。",
  ];
  const chapters = contents.map((content, index) => ({
    id: `c${index}`,
    title: `第${index + 1}章`,
    fileName: `chapter-${index}.md`,
    volume: index === 2 ? "卷二" : "卷一",
    order: index,
    wordCount: content.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    outline: [{ title: "正文" }, { title: "前往城门" }],
  }));
  config.chapters = chapters;
  config.api.apiKey = "";
  config.api.embeddingApiKey = "";
  await platform.saveConfig(root, config);
  for (const [i, chapter] of chapters.entries())
    await fs.writeFile(platform.getChapterPath(root, chapter), contents[i]);
  const characters = [
    {
      id: "li",
      name: "李明",
      category: "主角/侦探",
      background: "寻找朋友",
      personality: "坚定",
      relationships: "王华：同盟",
      notes: "",
      updatedAt: new Date().toISOString(),
    },
    {
      id: "wang",
      name: "王华",
      category: "主角/助手",
      background: "",
      personality: "",
      relationships: "李明：合作",
      notes: "",
      updatedAt: new Date().toISOString(),
    },
    {
      id: "empty",
      name: "配角",
      category: "配角",
      background: "",
      personality: "",
      relationships: "",
      notes: "",
      updatedAt: new Date().toISOString(),
    },
  ];
  for (const card of characters)
    await files.writeJson(files.getCharacterPath(root, card), card);
  await files.writeWorldDoc(root, {
    id: "city",
    title: "圣城",
    category: "地点/城市",
    fileName: "city.md",
    content: "# 圣城\n\n王华居住的城市，与铜钥匙有关，入口靠近守卫驻地。",
    updatedAt: new Date().toISOString(),
  });
  t.after(() => {
    runtime.state.projectTaskCenters.delete(root);
    for (const [key, timer] of runtime.state.deepAnalysisTimers)
      if (key.startsWith(root + "\u0000")) {
        clearTimeout(timer);
        runtime.state.deepAnalysisTimers.delete(key);
      }
  });
  return { root, config, chapters, characters, contents, platform };
}
function replace(t, object, key, value) {
  const previous = object[key];
  object[key] = value;
  t.after(() => {
    object[key] = previous;
  });
}
function control() {
  const controller = new AbortController(),
    updates = [];
  return {
    controller,
    updates,
    signal: controller.signal,
    isCanceled: () => controller.signal.aborted,
    throwIfCanceled: () => {
      if (controller.signal.aborted)
        throw Object.assign(new Error("任务已停止"), { name: "AbortError" });
    },
    update: async (patch) => {
      updates.push(patch);
    },
  };
}
module.exports = { domainProject, replace, control };
