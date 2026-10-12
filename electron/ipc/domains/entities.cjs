"use strict";
const { registerIpcHandler } = require("../register.cjs");
const {
  buildAppState,
  characterToMarkdown,
  ensureCurrentProject,
  fs,
  getCharacterPath,
  getWorldDocPath,
  indexSource,
  loadCharacters,
  loadWorldDocs,
  makeId,
  normalizeCategory,
  normalizeManagedFileName,
  nowIso,
  path,
  removeSourceFromIndex,
  uniqueContentFileName,
  withProjectTransaction,
  writeJson,
  writeWorldDoc,
} = require("../dependencies.cjs");

function registerDomain() {
  registerIpcHandler("character:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
      const characters = await loadCharacters(projectPath);
      const previous = payload.id
        ? characters.find((item) => item.id === payload.id)
        : null;
      const fileName = await uniqueContentFileName(
        projectPath,
        "characters",
        payload.name || payload.id || "未命名角色",
        ".json",
        previous?.fileName || "",
      );
      const card = {
        id: payload.id || makeId("character"),
        name: payload.name || "未命名角色",
        category: normalizeCategory(payload.category),
        appearance: payload.appearance || "",
        personality: payload.personality || "",
        background: payload.background || "",
        relationships: payload.relationships || "",
        notes: payload.notes || "",
        fileName,
        updatedAt: nowIso(),
      };
      const nextPath = getCharacterPath(projectPath, card);
      await writeJson(nextPath, card);
      // A rename only removes the old card after its replacement is durable.
      if (
        previous?.fileName &&
        path.basename(nextPath) !==
          normalizeManagedFileName(previous.fileName, ".json")
      ) {
        await fs.rm(getCharacterPath(projectPath, previous), { force: true });
      }
      await indexSource(projectPath, {
        id: card.id,
        type: "character",
        title: card.name,
        content: characterToMarkdown(card),
      });
      return buildAppState(projectPath);
    });
  });

  registerIpcHandler("character:delete", async (_event, characterId) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
      const characters = await loadCharacters(projectPath);
      const card = characters.find((item) => item.id === characterId);
      if (card)
        await fs.rm(getCharacterPath(projectPath, card), { force: true });
      await removeSourceFromIndex(projectPath, characterId);
      return buildAppState(projectPath);
    });
  });

  registerIpcHandler("world:save", async (_event, payload) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
      const title = payload.title || "未命名设定";
      const worldDocs = await loadWorldDocs(projectPath);
      const previous = payload.id
        ? worldDocs.find((item) => item.id === payload.id)
        : null;
      const fileName =
        previous?.fileName ||
        (await uniqueContentFileName(
          projectPath,
          "worldbuilding",
          title,
          ".md",
        ));
      const doc = {
        id: previous?.id || fileName.replace(/\.md$/i, ""),
        title,
        category: normalizeCategory(payload.category),
        fileName,
        content: payload.content || "",
        updatedAt: nowIso(),
      };
      await writeWorldDoc(projectPath, doc);
      await indexSource(projectPath, {
        id: doc.id,
        type: "world",
        title: doc.title,
        content: doc.content,
      });
      return buildAppState(projectPath);
    });
  });

  registerIpcHandler("world:delete", async (_event, docId) => {
    const projectPath = await ensureCurrentProject();
    return withProjectTransaction(projectPath, async () => {
      const worldDocs = await loadWorldDocs(projectPath);
      const doc = worldDocs.find((item) => item.id === docId);
      if (doc) await fs.rm(getWorldDocPath(projectPath, doc), { force: true });
      await removeSourceFromIndex(projectPath, docId);
      return buildAppState(projectPath);
    });
  });
}
module.exports = { registerDomain };
