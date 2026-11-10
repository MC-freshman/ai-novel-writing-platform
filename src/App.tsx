import "marked";
import { useMemo, useRef } from "react";
import { BookOpen, Boxes, ListTree, Search, Sparkles, UserRound } from "lucide-react";
import "@tiptap/react";
import "@tiptap/extension-image";
import "@tiptap/extension-table";
import "@tiptap/extension-table-cell";
import "@tiptap/extension-table-header";
import "@tiptap/extension-table-row";
import "@tiptap/extension-text-align";
import "@tiptap/extension-underline";
import "@tiptap/starter-kit";
import "@tiptap/pm/state";
import "@tiptap/pm/view";
import { CharacterManager } from "./components/resources/CharacterManager";
import { WorldManager } from "./components/resources/WorldManager";
import "./lib/categories";
import { ChapterTree } from "./components/shell/ChapterTree";
import { ChatPanel } from "./components/chat/ChatPanel";
import { KnowledgeOrganizer } from "./components/resources/KnowledgeOrganizer";
import { AnalysisPanel } from "./components/analysis/AnalysisPanel";
import { AppModals } from "./components/shell/AppModals";
import { EditorPanel } from "./components/writing/EditorPanel";
import { SelectionContextMenu } from "./components/writing/SelectionContextMenu";
import { StatusBar } from "./components/shell/StatusBar";
import { TopBar, type TopBarLayout } from "./components/shell/TopBar";
import { useAppController } from "./app/controller";

export default function App() {
  const {
    activeRecoveryDraft,
    adjustOutlineLevel,
    aiChatOpenRequest,
    aiExpanded,
    applyAppState,
    askSelectedText,
    backgroundTasks,
    captureSelection,
    changeView,
    chapterContent,
    chapterRevision,
    chapterTitle,
    chapterVolume,
    clearCurrentChat,
    contextMenu,
    createChapter,
    createChatSession,
    createProject,
    currentWords,
    deleteChapter,
    deleteCharacter,
    deleteWorldDoc,
    dirty,
    discardRecoveryDraft,
    editSelectedText,
    editorRef,
    editorReviews,
    exportBackup,
    exportBookDocx,
    exportChapterDocx,
    extractWorldCardsFromSelection,
    findNextInChapter,
    findText,
    focusMode,
    generateCharactersFromOutline,
    generateWorldFromOutline,
    handleRichEditorReady,
    importDocument,
    importProgress,
    indexProgress,
    moveDraggingChapter,
    networkOpenRequest,
    openAskSelectionMenu,
    openOriginalDocument,
    openProject,
    openRichAskSelectionMenu,
    openSettings,
    openStoryCenter,
    openWorkspaceFromSelection,
    paneWidths,
    preview,
    progressOpenMode,
    progressOpenRequest,
    rebuildIndex,
    refreshChapterFromOriginal,
    registerPageSave,
    replaceAllInChapter,
    replaceText,
    restoreRecoveryDraft,
    saveCharacter,
    saveCurrentPage,
    saveWorldDoc,
    saving,
    scrollAnchor,
    selectChapter,
    selectedChapter,
    selectedText,
    sendChat,
    setAiExpanded,
    setBackgroundTasks,
    setChapterContent,
    setChapterTitle,
    setChapterVolume,
    setContextMenu,
    setDirty,
    setDraggingChapterId,
    setFindText,
    setFocusMode,
    setLeftWidth,
    setPreview,
    setProgressOpenMode,
    setProgressOpenRequest,
    setReplaceText,
    setRightWidth,
    setSelectedText,
    setShowFindReplace,
    setShowQuickPanel,
    setShowSettings,
    setShowStoryCenter,
    setShowTaskCenter,
    setStatus,
    setStoryCenterInitialTab,
    setWorkspaceInitialTab,
    showAiChat,
    showFindReplace,
    showQuickPanel,
    showSettings,
    showStoryCenter,
    showTaskCenter,
    startPaneResize,
    state,
    status,
    stopChatGeneration,
    stores,
    storyCenterInitialTab,
    switchChatSession,
    toggleTheme,
    updateChatRetrievalMode,
    updateProjectMemory,
    view,
    workspaceInitialTab,
    workspaceRef,
  } = useAppController();

  const editorActionsImplementation = {
    onTitleChange: setChapterTitle,
    onVolumeChange: setChapterVolume,
    onContentChange: setChapterContent,
    onDirty: () => setDirty(true),
    onTogglePreview: () => setPreview((value) => !value),
    onToggleFindReplace: () => setShowFindReplace((value) => !value),
    onToggleFocus: () => setFocusMode((value) => !value),
    onFindTextChange: setFindText,
    onReplaceTextChange: setReplaceText,
    onFindNext: findNextInChapter,
    onReplaceAll: replaceAllInChapter,
    onOpenOriginal: openOriginalDocument,
    onRefreshFromOriginal: () => void refreshChapterFromOriginal(),
    onDiscardDraft: (draft: Parameters<typeof discardRecoveryDraft>[0]) => void discardRecoveryDraft(draft),
    onRestoreDraft: restoreRecoveryDraft,
    onCaptureSelection: captureSelection,
    onAskSelectionMenu: openAskSelectionMenu,
    onRichAskSelectionMenu: openRichAskSelectionMenu,
    onEditorReady: handleRichEditorReady,
    onOpenReview: (review: Parameters<NonNullable<Parameters<typeof EditorPanel>[0]["onOpenReview"]>>[0]) => {
      setSelectedText(review.quote);
      void openStoryCenter(
        "workspace",
        review.kind === "revision" ? "revisions" : "annotations",
      );
    },
    onApplyState: applyAppState,
    onStatus: setStatus,
  };
  const editorActionsRef = useRef(editorActionsImplementation);
  editorActionsRef.current = editorActionsImplementation;
  const editorActions = useMemo(() => {
    const keys = Object.keys(editorActionsRef.current) as Array<keyof typeof editorActionsRef.current>;
    return Object.fromEntries(keys.map((key) => [key, (...args: unknown[]) => (editorActionsRef.current[key] as (...args: unknown[]) => unknown)(...args)])) as typeof editorActionsRef.current;
  }, []);

  const chapterActionsImplementation = {
    onSelect: (id: string, line?: number) => void selectChapter(id, line),
    onCreate: () => void createChapter(),
    onDelete: (id: string) => void deleteChapter(id),
    onDragStart: (id: string) => setDraggingChapterId(id),
    onDragEnd: () => setDraggingChapterId(null),
    onDropToVolume: (volume: string) => void moveDraggingChapter(volume),
    onDropOnChapter: (chapter: Parameters<NonNullable<Parameters<typeof ChapterTree>[0]["onDropOnChapter"]>>[0]) => void moveDraggingChapter(chapter.volume || "未分卷", chapter.id),
    onImportToVolume: (volume: string) => void importDocument(volume),
    onAdjustLevel: (chapterId: string, line: number, level: number, delta: number) => void adjustOutlineLevel(chapterId, line, level, delta),
  };
  const chapterActionsRef = useRef(chapterActionsImplementation);
  chapterActionsRef.current = chapterActionsImplementation;
  const chapterActions = useMemo(() => {
    const keys = Object.keys(chapterActionsRef.current) as Array<keyof typeof chapterActionsRef.current>;
    return Object.fromEntries(keys.map((key) => [key, (...args: unknown[]) => (chapterActionsRef.current[key] as (...args: unknown[]) => unknown)(...args)])) as typeof chapterActionsRef.current;
  }, []);

  const openProgressTool = (tool: "mindmap" | "network" | "grid") => {
    setProgressOpenMode(tool);
    setProgressOpenRequest((value) => value + 1);
    void changeView("analysis");
  };

  const applyTopBarLayout = (nextLayout: TopBarLayout) => {
    if (nextLayout === "writing") {
      setLeftWidth(240);
      setRightWidth(360);
      setAiExpanded(false);
      setFocusMode(false);
      setStatus("已切换写作布局");
      return;
    }
    if (nextLayout === "materials") {
      setLeftWidth(320);
      setRightWidth(400);
      setAiExpanded(false);
      setFocusMode(false);
      setStatus("已切换资料布局");
      return;
    }
    setLeftWidth(220);
    setRightWidth(680);
    setAiExpanded(true);
    setFocusMode(false);
    setStatus("已切换对话布局");
  };

  if (!state) {
    return (
      <div className="loading-screen">
        <Sparkles className="spin-slow" />
        <p>{status}</p>
      </div>
    );
  }

  return (
    <div
      className={`app-shell ${focusMode ? "focus" : ""}`}
      onClick={() => setContextMenu(null)}
    >
      <TopBar
        title={state.config.title}
        theme={state.config.ui.theme}
        focusMode={focusMode}
        onCreateProject={createProject}
        onOpenProject={openProject}
        onImportDocument={() => void importDocument()}
        onExportBook={() =>
          void exportBookDocx({
            includeOutline: false,
            includeMaterials: false,
            includeCharacters: false,
            includeWorld: false,
          })
        }
        onSave={() => void saveCurrentPage()}
        onKnowledge={() => void changeView("knowledge")}
        onExportChapterDocx={exportChapterDocx}
        onBackup={exportBackup}
        onRebuildIndex={rebuildIndex}
        onSelectLayout={applyTopBarLayout}
        onShowAiChat={showAiChat}
        onOpenQuickPanel={() => setShowQuickPanel(true)}
        onOpenSettings={() => void openSettings()}
        onToggleTheme={() => void toggleTheme()}
        onToggleFocus={() => setFocusMode((value) => !value)}
      />

      <main
        className={`workspace ${aiExpanded ? "ai-expanded" : ""}`}
        ref={workspaceRef}
        style={{
          gridTemplateColumns: focusMode
            ? "minmax(0, 1fr)"
            : `minmax(0, ${paneWidths.left}px) 6px minmax(${paneWidths.centerMinimum}px, 1fr) 6px minmax(0, ${paneWidths.right}px)`,
        }}
      >
        {!focusMode && (
          <aside className="left-pane">
            <div className="pane-tabs">
              <button
                aria-current={view === "chapters" ? "page" : undefined}
                className={view === "chapters" ? "active" : ""}
                onClick={() => void changeView("chapters")}
                title="章节"
              >
                <BookOpen size={16} /> 章节
              </button>
              <button
                aria-current={view === "characters" ? "page" : undefined}
                className={view === "characters" ? "active" : ""}
                onClick={() => void changeView("characters")}
                title="角色"
              >
                <UserRound size={16} /> 角色
              </button>
              <button
                aria-current={view === "world" ? "page" : undefined}
                className={view === "world" ? "active" : ""}
                onClick={() => void changeView("world")}
                title="世界"
              >
                <Boxes size={16} /> 世界
              </button>
              <button
                aria-current={view === "knowledge" ? "page" : undefined}
                className={view === "knowledge" ? "active" : ""}
                onClick={() => void changeView("knowledge")}
                title="知识库"
              >
                <ListTree size={16} /> 知识库
              </button>
              <button
                aria-current={view === "analysis" ? "page" : undefined}
                className={view === "analysis" ? "active" : ""}
                onClick={() => void changeView("analysis")}
                title="分析"
              >
                <Search size={16} /> 分析
              </button>
            </div>
            <ChapterTree
              projectPath={state.projectPath}
              chapters={state.chapters}
              selectedId={selectedChapter?.id ?? ""}
              {...chapterActions}
            />
            <div className="project-path" title={state.projectPath}>
              {state.projectPath}
            </div>
          </aside>
        )}

        {!focusMode && (
          <div
            className="pane-resizer"
            title="拖动调整左侧宽度"
            onMouseDown={(event) => startPaneResize("left", event)}
          />
        )}

        <section className="center-pane">
          {view === "chapters" && (
            <EditorPanel
              selectedChapter={selectedChapter}
              chapterTitle={chapterTitle}
              chapterVolume={chapterVolume}
              chapterContent={chapterContent}
              chapterRevision={chapterRevision}
              preview={preview}
              showFindReplace={showFindReplace}
              findText={findText}
              replaceText={replaceText}
              selectedText={selectedText}
              activeRecoveryDraft={activeRecoveryDraft}
              editorRef={editorRef}
              editorReviews={editorReviews}
              scrollAnchor={scrollAnchor}
              fontSize={state.config.ui.fontSize}
              lineHeight={state.config.ui.lineHeight}
              stores={stores}
              {...editorActions}
            />
          )}

          {view === "characters" && (
            <CharacterManager
              key={state.projectPath}
              projectPath={state.projectPath}
              recoveryEnabled={state.config.ui.recoveryEnabled !== false}
              onRegisterSave={registerPageSave}
              cards={state.characters}
              onSave={saveCharacter}
              onDelete={deleteCharacter}
              onGenerate={() => void generateCharactersFromOutline()}
            />
          )}

          {view === "world" && (
            <WorldManager
              key={state.projectPath}
              projectPath={state.projectPath}
              recoveryEnabled={state.config.ui.recoveryEnabled !== false}
              onRegisterSave={registerPageSave}
              docs={state.worldDocs}
              onSave={saveWorldDoc}
              onDelete={deleteWorldDoc}
              onGenerate={() => void generateWorldFromOutline()}
            />
          )}

          {view === "knowledge" && (
            <KnowledgeOrganizer
              key={state.projectPath}
              state={state}
              onRegisterSave={registerPageSave}
              onApplyState={applyAppState}
              onStatus={setStatus}
            />
          )}

          {view === "analysis" && (
            <AnalysisPanel
              key={state.projectPath}
              state={state}
              onRegisterSave={registerPageSave}
              networkOpenRequest={networkOpenRequest}
              progressOpenRequest={progressOpenRequest}
              progressOpenMode={progressOpenMode}
              selectedChapterId={selectedChapter?.id || ""}
              onSelectChapter={(chapterId) => void selectChapter(chapterId)}
              onOpenSource={(result) => {
                if (result.sourceType === "chapter")
                  void selectChapter(result.sourceId);
                if (result.sourceType === "character")
                  void changeView("characters");
                if (result.sourceType === "world") void changeView("world");
              }}
              onExportBook={() =>
                void exportBookDocx({
                  includeOutline: false,
                  includeMaterials: false,
                  includeCharacters: false,
                  includeWorld: false,
                })
              }
              onExportBookWithOptions={(options) =>
                void exportBookDocx(options)
              }
              onApplyState={applyAppState}
              onStatus={setStatus}
            />
          )}
        </section>

        {!focusMode && (
          <div
            className="pane-resizer"
            title="拖动调整右侧宽度"
            onMouseDown={(event) => startPaneResize("right", event)}
          />
        )}

        {!focusMode && (
          <ChatPanel
            state={state}
            stores={stores}
            selectedChapterId={selectedChapter?.id || ""}
            selectedText={selectedText}
            onRetrievalModeChange={updateChatRetrievalMode}
            onSend={(question, mode) =>
              void sendChat(question, selectedText, mode)
            }
            onRetryWithSources={(question, sourceIds, mode) =>
              void sendChat(question, "", mode, sourceIds)
            }
            onStop={() => void stopChatGeneration()}
            onClear={clearCurrentChat}
            onNewSession={createChatSession}
            onSwitchSession={switchChatSession}
            onProjectMemoryChange={updateProjectMemory}
            onQuick={(question) =>
              void sendChat(
                question,
                question.includes("当前章节") ? chapterContent : selectedText,
              )
            }
            onStatus={setStatus}
            expanded={aiExpanded}
            chatOpenRequest={aiChatOpenRequest}
            onToggleExpanded={() => setAiExpanded((value) => !value)}
            onOpenStoryCenter={() => void openStoryCenter()}
          />
        )}
      </main>

      <StatusBar
        view={view}
        saving={saving}
        dirty={dirty}
        currentWords={currentWords}
        todayWords={state.config.stats.todayWords}
        totalWords={state.config.stats.totalWords}
        vectorStats={state.vectorStats}
        chatModel={state.config.api.chatModel}
        backgroundTasks={backgroundTasks}
        importProgress={importProgress}
        indexProgress={indexProgress}
        status={status}
        onOpenTaskCenter={() => setShowTaskCenter(true)}
        onCancelImport={() => void window.novelAPI.cancelImport()}
      />

      {contextMenu && (
        <SelectionContextMenu
          menu={contextMenu}
          onAsk={(text) => void askSelectedText(text)}
          onEdit={(action, text) => void editSelectedText(action, text)}
          onExtractWorld={(text) => void extractWorldCardsFromSelection(text)}
          onOpenWorkspace={(tab, text) =>
            void openWorkspaceFromSelection(tab, text)
          }
        />
      )}

      <AppModals
        state={state}
        selectedChapterId={selectedChapter?.id || ""}
        selectedText={selectedText}
        chapterRevision={chapterRevision}
        view={view}
        showSettings={showSettings}
        showQuickPanel={showQuickPanel}
        showStoryCenter={showStoryCenter}
        showTaskCenter={showTaskCenter}
        storyCenterInitialTab={storyCenterInitialTab}
        workspaceInitialTab={workspaceInitialTab}
        backgroundTasks={backgroundTasks}
        onCloseSettings={() => setShowSettings(false)}
        onSaveSettings={(nextState) => {
          applyAppState(nextState);
          setShowSettings(false);
        }}
        onCloseQuickPanel={() => setShowQuickPanel(false)}
        onOpenView={(nextView) => {
          setShowQuickPanel(false);
          void changeView(nextView);
        }}
        onOpenProgress={(tool) => {
          setShowQuickPanel(false);
          openProgressTool(tool);
        }}
        onImportDocument={() => {
          setShowQuickPanel(false);
          void importDocument();
        }}
        onExportChapterDocx={() => {
          setShowQuickPanel(false);
          void exportChapterDocx();
        }}
        onExportBook={() => {
          setShowQuickPanel(false);
          void exportBookDocx({
            includeOutline: false,
            includeMaterials: false,
            includeCharacters: false,
            includeWorld: false,
          });
        }}
        onBackup={() => {
          setShowQuickPanel(false);
          void exportBackup();
        }}
        onRebuildIndex={() => {
          setShowQuickPanel(false);
          void rebuildIndex();
        }}
        onOpenSettings={() => {
          setShowQuickPanel(false);
          void openSettings();
        }}
        onCloseStoryCenter={() => {
          setShowStoryCenter(false);
          setStoryCenterInitialTab("facts");
          setWorkspaceInitialTab("planning");
        }}
        onOpenChapter={(chapterId) => {
          setShowStoryCenter(false);
          void selectChapter(chapterId);
        }}
        onOpenEvidence={(chapterId, quote) => {
          setShowStoryCenter(false);
          void selectChapter(chapterId, undefined, quote);
        }}
        onApplyState={applyAppState}
        onTaskCreated={(task) => {
          setBackgroundTasks((current) => [
            task,
            ...current.filter((item) => item.id !== task.id),
          ]);
          setShowTaskCenter(true);
        }}
        onStatus={setStatus}
        onCloseTaskCenter={() => setShowTaskCenter(false)}
        onChangeTasks={setBackgroundTasks}
        onOpenStoryCenter={(tab) => {
          setShowTaskCenter(false);
          void openStoryCenter(tab);
        }}
        onBeforeDisableMindMap={() => saveCurrentPage()}
      />
    </div>
  );
}
