import { getErrorMessage } from "../lib/text-utils";
import type { AppContext } from "./context";

export function useAppProjects(
  context: Pick<
    AppContext,
    | "applyAppState"
    | "chapterRevision"
    | "saveBeforeLeavingChapter"
    | "selectedChapter"
    | "setPreview"
    | "setSaving"
    | "setStatus"
    | "setView"
  >,
) {
  const {
    applyAppState,
    chapterRevision,
    saveBeforeLeavingChapter,
    selectedChapter,
    setPreview,
    setSaving,
    setStatus,
    setView,
  } = context;
  async function createProject() {
    if (!(await saveBeforeLeavingChapter())) return;
    const title = window.prompt("新小说项目名称", "新小说项目");
    if (!title) return;
    try {
      const result = await window.novelAPI.createProject({ title });
      if (!("canceled" in result)) applyAppState(result);
      else setStatus("已取消新建项目");
    } catch (error) {
      setStatus(`新建项目失败：${getErrorMessage(error)}`);
    }
  }

  async function openProject() {
    if (!(await saveBeforeLeavingChapter())) return;
    try {
      const result = await window.novelAPI.openProject();
      if (!("canceled" in result)) applyAppState(result);
      else setStatus("已取消打开项目");
    } catch (error) {
      setStatus(`打开项目失败：${getErrorMessage(error)}`);
    }
  }

  async function importDocument(volume = "") {
    if (!(await saveBeforeLeavingChapter())) return;
    const targetVolume = volume.trim();
    setStatus(
      targetVolume
        ? `正在导入文档到「${targetVolume}」并建立知识库...`
        : "正在导入文档并建立知识库...",
    );
    try {
      const result = await window.novelAPI.importDocument(
        targetVolume ? { volume: targetVolume } : undefined,
      );
      if ("canceled" in result) {
        setStatus(result.message || "已取消导入文档");
        return;
      }
      const summary = result.importSummary;
      applyAppState(result);
      setView("chapters");
      setPreview(false);
      if (summary?.failed) {
        setStatus(
          `已导入 ${summary.imported}/${summary.total} 个文档${targetVolume ? `到「${targetVolume}」` : ""}，${summary.failed} 个失败；成功导入的文档已加入知识库`,
        );
      } else if (summary?.canceled) {
        setStatus(
          `已取消导入；已完成 ${summary.imported}/${summary.total} 个文档`,
        );
      } else if (summary?.imported && summary.imported > 1) {
        setStatus(
          `已批量导入 ${summary.imported} 个文档${targetVolume ? `到「${targetVolume}」` : ""}，并已加入知识库`,
        );
      } else {
        setStatus(
          `文档已导入${targetVolume ? `到「${targetVolume}」` : "为章节"}，并已加入知识库`,
        );
      }
    } catch (error) {
      setStatus(
        `导入失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function exportChapterDocx() {
    if (!selectedChapter) {
      setStatus("请先选择要导出的文档。");
      return;
    }
    if (!(await saveBeforeLeavingChapter())) return;
    setStatus("正在导出 Word 文档...");
    try {
      const result = await window.novelAPI.exportChapterDocx(
        selectedChapter.id,
      );
      if (result.canceled) {
        setStatus("已取消导出");
        return;
      }
      if (result.filePath) setStatus(`Word 文档已导出：${result.filePath}`);
      else setStatus("导出已结束，但没有收到保存位置。请重新选择导出路径。");
    } catch (error) {
      setStatus(
        `导出失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function exportBookDocx(options?: {
    includeOutline?: boolean;
    includeMaterials?: boolean;
    includeCharacters?: boolean;
    includeWorld?: boolean;
  }) {
    if (!(await saveBeforeLeavingChapter())) return;
    setStatus("正在按目录树逐篇生成 Word 文档...");
    try {
      const result = await window.novelAPI.exportBookDocx(options);
      if (result.canceled) {
        setStatus("已取消批量导出");
        return;
      }
      if (result.directoryPath) {
        const failureNotice = result.failedCount
          ? `，${result.failedCount} 个失败`
          : "";
        setStatus(
          `已逐篇导出 ${result.exportedCount || 0} 个 Word 文档${failureNotice}：${result.directoryPath}`,
        );
      } else {
        setStatus("批量导出已结束，但没有收到保存位置。请重新选择导出目录。");
      }
    } catch (error) {
      setStatus(
        `批量导出失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function openOriginalDocument() {
    if (!selectedChapter) {
      setStatus("请先选择一个导入的文档。");
      return;
    }
    try {
      const result = await window.novelAPI.openOriginalDocument(
        selectedChapter.id,
      );
      if (result.error) {
        setStatus(`打开 Word 原文失败：${result.error}`);
        return;
      }
      if (result.filePath) setStatus(`已打开 Word 原文：${result.filePath}`);
      else setStatus("这个文档没有可打开的 Word 原文记录。");
    } catch (error) {
      setStatus(`打开 Word 原文失败：${getErrorMessage(error)}`);
    }
  }

  async function refreshChapterFromOriginal() {
    if (!selectedChapter) {
      setStatus("请先选择一个导入的 Word 文档。");
      return;
    }
    if (
      !window.confirm(
        "将从导入时的 Word 原文重新生成富文档内容，用来恢复表格和版式。当前编辑副本会先自动备份，但正文里的后续手改内容可能被原文覆盖。继续吗？",
      )
    )
      return;
    if (!(await saveBeforeLeavingChapter())) return;
    setSaving(true);
    setStatus("正在从 Word 原文恢复表格和富文档格式...");
    try {
      const result = await window.novelAPI.refreshChapterFromOriginal({
        chapterId: selectedChapter.id,
        expectedRevision: chapterRevision,
      });
      applyAppState(result.state);
      setView("chapters");
      setPreview(false);
      setStatus(
        `已恢复 Word 表格：${result.tableCount} 个表格、${result.imageCount} 张图片；旧编辑副本已备份到 ${result.backupPath || "backups/docx_refresh"}`,
      );
    } catch (error) {
      setStatus(
        `恢复 Word 格式失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function exportBackup() {
    if (!(await saveBeforeLeavingChapter())) return;
    try {
      const result = await window.novelAPI.exportBackup();
      if (result.canceled) {
        setStatus("已取消备份导出");
        return;
      }
      if (result.filePath) setStatus(`备份已导出：${result.filePath}`);
      else
        setStatus("备份导出已结束，但没有收到保存位置。请重新选择导出路径。");
    } catch (error) {
      setStatus(`备份导出失败：${getErrorMessage(error)}`);
    }
  }

  async function rebuildIndex() {
    if (!(await saveBeforeLeavingChapter())) return;
    setStatus("正在重建整本小说知识库...");
    try {
      const result = await window.novelAPI.rebuildIndex();
      applyAppState(result.state);
      setStatus(`知识库已重建，共 ${result.chunks} 个片段`);
    } catch (error) {
      setStatus(`重建知识库失败：${getErrorMessage(error)}`);
    }
  }

  return {
    createProject,
    openProject,
    importDocument,
    exportChapterDocx,
    exportBookDocx,
    openOriginalDocument,
    refreshChapterFromOriginal,
    exportBackup,
    rebuildIndex,
  };
}
