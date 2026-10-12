import type { ChatMessage } from "../types";
import { type CreativeWorkspaceTab } from "../components/CreativeWorkspace";
import { escapeRegExp } from "../lib/text-utils";
import { makeMessageId } from "../lib/chat-utils";
import {
  findNextInRichEditor,
  replaceAllInRichEditor,
} from "../lib/editor-ops";
import type { AppContext } from "./context";

export function useAppEditor(
  context: Pick<
    AppContext,
    | "changeView"
    | "chapterContent"
    | "chatMessages"
    | "editorRef"
    | "findText"
    | "openStoryCenter"
    | "preview"
    | "replaceText"
    | "richEditorRef"
    | "selectedChapter"
    | "sendChat"
    | "setChapterContent"
    | "setContextMenu"
    | "setDirty"
    | "setSelectedText"
    | "setStatus"
    | "updateCurrentChat"
  >,
) {
  const {
    changeView,
    chapterContent,
    chatMessages,
    editorRef,
    findText,
    openStoryCenter,
    preview,
    replaceText,
    richEditorRef,
    selectedChapter,
    sendChat,
    setChapterContent,
    setContextMenu,
    setDirty,
    setSelectedText,
    setStatus,
    updateCurrentChat,
  } = context;
  function captureSelection() {
    if (!preview) {
      const text = window.getSelection()?.toString().trim() || "";
      setSelectedText(text);
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const text = chapterContent
      .slice(editor.selectionStart, editor.selectionEnd)
      .trim();
    setSelectedText(text);
  }

  function openAskSelectionMenu(event: React.MouseEvent<HTMLTextAreaElement>) {
    captureSelection();
    const editor = editorRef.current;
    if (!editor) return;
    const text = chapterContent
      .slice(editor.selectionStart, editor.selectionEnd)
      .trim();
    if (!text) return;
    event.preventDefault();
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 300)),
      text,
    });
  }

  function openRichAskSelectionMenu(event: React.MouseEvent<HTMLElement>) {
    const text = window.getSelection()?.toString().trim() || "";
    setSelectedText(text);
    if (!text) return;
    event.preventDefault();
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 300)),
      text,
    });
  }

  function findNextInChapter() {
    const needle = findText.trim();
    if (!needle) {
      setStatus("请先输入要查找的文字。");
      return;
    }
    if (!preview) {
      const result = richEditorRef.current
        ? findNextInRichEditor(richEditorRef.current, needle)
        : { found: false, wrapped: false, selectedText: "" };
      if (!result.found) {
        setSelectedText("");
        setStatus(`未找到：${needle}`);
        return;
      }
      setSelectedText(result.selectedText);
      setStatus(
        result.wrapped ? `已从开头重新定位：${needle}` : `已定位：${needle}`,
      );
      return;
    }
    const editor = editorRef.current;
    if (!editor) {
      const found = chapterContent.toLowerCase().indexOf(needle.toLowerCase());
      setStatus(found >= 0 ? `已找到：${needle}` : `未找到：${needle}`);
      return;
    }
    const start = Math.max(editor.selectionEnd, 0);
    const lower = chapterContent.toLowerCase();
    let found = lower.indexOf(needle.toLowerCase(), start);
    let wrapped = false;
    if (found < 0) {
      found = lower.indexOf(needle.toLowerCase());
      wrapped = found >= 0;
    }
    if (found < 0) {
      setStatus(`未找到：${needle}`);
      return;
    }
    editor.focus();
    editor.selectionStart = found;
    editor.selectionEnd = found + needle.length;
    setSelectedText(chapterContent.slice(found, found + needle.length));
    setStatus(wrapped ? `已从开头重新定位：${needle}` : `已定位：${needle}`);
  }

  function replaceAllInChapter() {
    const needle = findText.trim();
    if (!needle) {
      setStatus("请先输入要替换的文字。");
      return;
    }
    if (!preview) {
      const matches = richEditorRef.current
        ? replaceAllInRichEditor(richEditorRef.current, needle, replaceText)
        : 0;
      if (!matches) {
        setStatus(`没有可替换的内容：${needle}`);
        return;
      }
      setSelectedText(replaceText);
      setDirty(true);
      setStatus(`已替换 ${matches} 处`);
      return;
    }
    const regex = new RegExp(escapeRegExp(needle), "gi");
    const matches = chapterContent.match(regex)?.length || 0;
    if (!matches) {
      setStatus(`没有可替换的内容：${needle}`);
      return;
    }
    setChapterContent(chapterContent.replace(regex, replaceText));
    setDirty(true);
    setStatus(`已替换 ${matches} 处`);
  }

  async function askSelectedText(text: string) {
    setContextMenu(null);
    const question = window.prompt(
      "想让 AI 围绕选中文字回答什么？",
      "分析这段文字的作用，并给出修改建议。",
    );
    if (!question) return;
    await sendChat(question, text);
  }

  async function editSelectedText(
    action: "改写" | "润色" | "扩写" | "总结",
    text: string,
  ) {
    setContextMenu(null);
    const pendingId = makeMessageId();
    const startedMessages: ChatMessage[] = [
      ...chatMessages,
      {
        id: makeMessageId(),
        role: "user",
        content: `${action}选中文字\n\n【选中文字】\n${text}`,
        createdAt: new Date().toISOString(),
      },
      {
        id: pendingId,
        role: "assistant",
        content: `正在${action}选中文字...`,
        createdAt: new Date().toISOString(),
      },
    ];
    updateCurrentChat(startedMessages);
    try {
      const result = await window.novelAPI.editSelection({ action, text });
      updateCurrentChat(
        startedMessages.map((item) =>
          item.id === pendingId ? { ...item, content: result.answer } : item,
        ),
      );
      setStatus(`${action}完成，结果已放到右侧 AI 对话`);
    } catch (error) {
      updateCurrentChat(
        startedMessages.map((item) =>
          item.id === pendingId
            ? {
                ...item,
                content: `${action}失败：${error instanceof Error ? error.message : String(error)}`,
              }
            : item,
        ),
      );
    }
  }

  async function extractWorldCardsFromSelection(text: string) {
    setContextMenu(null);
    const sourceText = text.trim();
    if (!sourceText) {
      setStatus("请先选中要提取设定的正文。");
      return;
    }
    setStatus("正在从选中文字提取地点、势力、物品候选...");
    try {
      const result = await window.novelAPI.extractWorldCardsFromOutline({
        scope: "chapter",
        chapterId: selectedChapter?.id,
        text: sourceText,
      });
      await window.novelAPI.saveAnalysisState({
        tab: "export",
        extractScope: "chapter",
        worldCandidates: result.candidates,
      });
      await changeView("analysis");
      setStatus(
        `已从选中文字提取 ${result.candidates.length} 个候选；请在分析页勾选后写入世界观`,
      );
    } catch (error) {
      setStatus(
        `提取设定失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function openWorkspaceFromSelection(
    tab: CreativeWorkspaceTab,
    text: string,
  ) {
    setContextMenu(null);
    setSelectedText(text);
    await openStoryCenter("workspace", tab);
  }

  return {
    captureSelection,
    openAskSelectionMenu,
    openRichAskSelectionMenu,
    findNextInChapter,
    replaceAllInChapter,
    askSelectedText,
    editSelectedText,
    extractWorldCardsFromSelection,
    openWorkspaceFromSelection,
  };
}
