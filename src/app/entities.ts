import type { CharacterCard, WorldDoc } from "../types";
import { getErrorMessage } from "../lib/text-utils";
import type { AppContext } from "./context";

export function useAppEntities(
  context: Pick<
    AppContext,
    | "applyAppState"
    | "saveBeforeLeavingChapter"
    | "saveChapterIfDirty"
    | "setStatus"
    | "setView"
  >,
) {
  const {
    applyAppState,
    saveBeforeLeavingChapter,
    saveChapterIfDirty,
    setStatus,
    setView,
  } = context;
  async function saveCharacter(card: Partial<CharacterCard>) {
    if (!(await saveChapterIfDirty())) return null;
    try {
      const next = await window.novelAPI.saveCharacter(card);
      applyAppState(next);
      setView("characters");
      setStatus(`角色卡片已保存：${card.name || "未命名角色"}`);
      return (
        next.characters.find((item) => item.id === card.id) ||
        next.characters.find(
          (item) => item.name === (card.name || "未命名角色"),
        ) ||
        null
      );
    } catch (error) {
      setStatus(`保存角色失败：${getErrorMessage(error)}`);
      return null;
    }
  }

  async function deleteCharacter(characterId: string) {
    if (!window.confirm("确定删除这个角色卡片吗？")) return false;
    if (!(await saveBeforeLeavingChapter())) return false;
    try {
      const next = await window.novelAPI.deleteCharacter(characterId);
      applyAppState(next);
      setView("characters");
      setStatus("角色卡片已删除");
      return true;
    } catch (error) {
      setStatus(`删除角色失败：${getErrorMessage(error)}`);
      return false;
    }
  }

  async function generateCharactersFromOutline() {
    if (
      !window.confirm(
        "将检索当前项目中的大纲和正文，并调用 AI 生成角色卡片。生成结果会直接写入“角色”界面；同名角色会更新。继续吗？",
      )
    )
      return;
    if (!(await saveBeforeLeavingChapter())) return;
    setStatus("正在检索大纲并生成角色卡片...");
    try {
      const result = await window.novelAPI.generateCharactersFromOutline();
      applyAppState(result.state);
      setView("characters");
      setStatus(
        `已生成角色卡片：新增 ${result.created} 张，更新 ${result.updated} 张；使用检索片段 ${result.contextCount} 条`,
      );
    } catch (error) {
      setStatus(
        `生成角色卡片失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function saveWorldDoc(doc: Partial<WorldDoc>) {
    if (!(await saveChapterIfDirty())) return null;
    try {
      const next = await window.novelAPI.saveWorldDoc(doc);
      applyAppState(next);
      setView("world");
      setStatus(`世界观条目已保存：${doc.title || "未命名设定"}`);
      return (
        next.worldDocs.find((item) => item.id === doc.id) ||
        next.worldDocs.find(
          (item) => item.title === (doc.title || "未命名设定"),
        ) ||
        null
      );
    } catch (error) {
      setStatus(`保存世界观失败：${getErrorMessage(error)}`);
      return null;
    }
  }

  async function deleteWorldDoc(docId: string) {
    if (!window.confirm("确定删除这份世界观设定吗？")) return false;
    if (!(await saveBeforeLeavingChapter())) return false;
    try {
      const next = await window.novelAPI.deleteWorldDoc(docId);
      applyAppState(next);
      setView("world");
      setStatus("世界观条目已删除");
      return true;
    } catch (error) {
      setStatus(`删除世界观失败：${getErrorMessage(error)}`);
      return false;
    }
  }

  async function generateWorldFromOutline() {
    if (
      !window.confirm(
        "将检索当前项目中的大纲和正文，并调用 AI 生成世界观条目。生成结果会直接写入“世界”界面；同名条目会更新。继续吗？",
      )
    )
      return;
    if (!(await saveBeforeLeavingChapter())) return;
    setStatus("正在检索大纲并生成世界观条目...");
    try {
      const result = await window.novelAPI.generateWorldFromOutline();
      applyAppState(result.state);
      setView("world");
      setStatus(
        `已生成世界观：新增 ${result.created} 条，更新 ${result.updated} 条；使用检索片段 ${result.contextCount} 条`,
      );
    } catch (error) {
      setStatus(
        `生成世界观失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    saveCharacter,
    deleteCharacter,
    generateCharactersFromOutline,
    saveWorldDoc,
    deleteWorldDoc,
    generateWorldFromOutline,
  };
}
