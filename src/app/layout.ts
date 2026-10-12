import { useMemo } from "react";
import { type CreativeWorkspaceTab } from "../components/CreativeWorkspace";
import { countWords, getErrorMessage } from "../lib/text-utils";
import type { AppContext } from "./context";

export function useAppLayout(
  context: Pick<
    AppContext,
    | "aiExpanded"
    | "applyAppState"
    | "chapterContent"
    | "leftWidth"
    | "previewWidth"
    | "rightWidth"
    | "saveBeforeLeavingChapter"
    | "selectedChapter"
    | "setAiChatOpenRequest"
    | "setFocusMode"
    | "setLeftWidth"
    | "setPreviewWidth"
    | "setRightWidth"
    | "setShowSettings"
    | "setShowStoryCenter"
    | "setStatus"
    | "setStoryCenterInitialTab"
    | "setView"
    | "setWorkspaceInitialTab"
    | "state"
    | "storyCenterInitialTab"
    | "view"
    | "viewportWidth"
    | "workspaceInitialTab"
  >,
) {
  const {
    aiExpanded,
    applyAppState,
    chapterContent,
    leftWidth,
    previewWidth,
    rightWidth,
    saveBeforeLeavingChapter,
    selectedChapter,
    setAiChatOpenRequest,
    setFocusMode,
    setLeftWidth,
    setPreviewWidth,
    setRightWidth,
    setShowSettings,
    setShowStoryCenter,
    setStatus,
    setStoryCenterInitialTab,
    setView,
    setWorkspaceInitialTab,
    state,
    storyCenterInitialTab,
    view,
    viewportWidth,
    workspaceInitialTab,
  } = context;
  async function changeView(nextView: typeof view) {
    if (nextView === view) return true;
    if (!(await saveBeforeLeavingChapter())) return false;
    setView(nextView);
    return true;
  }

  async function openSettings() {
    if (!(await saveBeforeLeavingChapter())) return;
    setShowSettings(true);
  }

  async function openStoryCenter(
    initialTab: "facts" | "workspace" = storyCenterInitialTab,
    workspaceTab: CreativeWorkspaceTab = workspaceInitialTab,
  ) {
    if (!(await saveBeforeLeavingChapter())) return;
    setStoryCenterInitialTab(initialTab);
    setWorkspaceInitialTab(workspaceTab);
    setShowStoryCenter(true);
  }

  function showAiChat() {
    setFocusMode(false);
    setAiChatOpenRequest((value) => value + 1);
    setStatus("已显示右侧 AI 对话");
  }

  const currentWords = useMemo(
    () => countWords(chapterContent),
    [chapterContent],
  );

  const paneWidths = useMemo(() => {
    const centerMinimum = aiExpanded ? 240 : 380;
    const rightMinimum = aiExpanded ? 520 : 300;
    const sideBudget = Math.max(510, viewportWidth - centerMinimum - 12);
    const left = Math.min(leftWidth, Math.max(210, sideBudget - rightMinimum));
    const desiredRight = aiExpanded ? Math.max(rightWidth, 680) : rightWidth;
    const right = Math.min(
      desiredRight,
      Math.max(rightMinimum, sideBudget - left),
    );
    return { left, right, centerMinimum };
  }, [aiExpanded, leftWidth, rightWidth, viewportWidth]);

  async function toggleTheme() {
    if (!state) return;
    if (!(await saveBeforeLeavingChapter())) return;
    const nextTheme = state.config.ui.theme === "dark" ? "light" : "dark";
    try {
      const next = await window.novelAPI.saveProjectSettings({
        ...state.config,
        ui: { ...state.config.ui, theme: nextTheme },
        selectedChapterId: selectedChapter?.id,
      });
      applyAppState(next);
    } catch (error) {
      setStatus(`切换主题失败：${getErrorMessage(error)}`);
    }
  }

  function startPaneResize(
    kind: "left" | "right" | "preview",
    event: React.MouseEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const initialLeft = leftWidth;
    const initialRight = rightWidth;
    const editorBody = (
      event.currentTarget.parentElement as HTMLElement | null
    )?.getBoundingClientRect();
    const initialPreview = previewWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      if (kind === "left") {
        setLeftWidth(Math.min(460, Math.max(210, initialLeft + delta)));
      }
      if (kind === "right") {
        setRightWidth(Math.min(860, Math.max(300, initialRight - delta)));
      }
      if (kind === "preview" && editorBody) {
        const next = initialPreview - (delta / editorBody.width) * 100;
        setPreviewWidth(Math.min(68, Math.max(28, next)));
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return {
    changeView,
    openSettings,
    openStoryCenter,
    showAiChat,
    currentWords,
    paneWidths,
    toggleTheme,
    startPaneResize,
  };
}
