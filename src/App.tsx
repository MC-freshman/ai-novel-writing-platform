import "marked";
import {
  BookOpen,
  Boxes,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  FilePlus2,
  FolderOpen,
  ListTree,
  ListChecks,
  Leaf,
  Maximize2,
  MessageSquarePlus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  Sun,
  Upload,
  UserRound,
  Wand2,
} from "lucide-react";
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
import { CharacterManager } from "./components/CharacterManager";
import { WorldManager } from "./components/WorldManager";
import "./lib/categories";
import { ChapterProgressStrip } from "./components/ProgressBoard";
import "./components/ProgressWorkspace";
import { countWords, formatDateTime } from "./lib/text-utils";
import { QuickPanelModal } from "./components/QuickPanelModal";
import { StoryCenterModal } from "./components/StoryCenterModal";
import { TaskCenterDrawer } from "./components/TaskCenterDrawer";
import { RichDocumentEditor } from "./components/RichDocumentEditor";
import { ChapterTree } from "./components/ChapterTree";
import { ChatPanel } from "./components/ChatPanel";
import { KnowledgeOrganizer } from "./components/KnowledgeOrganizer";
import { AnalysisPanel } from "./components/AnalysisPanel";
import { SettingsModal } from "./components/SettingsModal";
import { useAppBindings } from "./app/bindings";
import { useAppRefs } from "./app/refs";
import { useAppLifecycle } from "./app/lifecycle";
import { useAppSaving } from "./app/saving";
import { useAppLayout } from "./app/layout";
import { useAppRecovery } from "./app/recovery";
import { useAppChapters } from "./app/chapters";
import { useAppProjects } from "./app/projects";
import { useAppEntities } from "./app/entities";
import { useAppChat } from "./app/chat";
import { useAppEditor } from "./app/editor";
import { useAppEffects } from "./app/effects";

export default function App() {
  const bindings = useAppBindings();
  const refs = useAppRefs();
  const lifecycle = useAppLifecycle({ ...bindings, ...refs });
  const savingController = useAppSaving({ ...bindings, ...refs, ...lifecycle });
  const layout = useAppLayout({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
  });
  const recovery = useAppRecovery({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
  });
  const chapters = useAppChapters({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
  });
  const projects = useAppProjects({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
    ...chapters,
  });
  const entities = useAppEntities({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
    ...chapters,
    ...projects,
  });
  const chat = useAppChat({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
    ...chapters,
    ...projects,
    ...entities,
  });
  const editor = useAppEditor({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
    ...chapters,
    ...projects,
    ...entities,
    ...chat,
  });
  useAppEffects({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
    ...chapters,
    ...projects,
    ...entities,
    ...chat,
    ...editor,
  });
  const {
    activeAiRequestId,
    activeChatSessionId,
    activeRecoveryDraft,
    adjustOutlineLevel,
    aiChatOpenRequest,
    aiExpanded,
    aiProgress,
    aiProjectMemory,
    applyAppState,
    askSelectedText,
    backgroundTasks,
    captureSelection,
    changeView,
    chapterContent,
    chapterRevision,
    chapterTitle,
    chapterVolume,
    chatMessages,
    chatRetrievalMode,
    chatSessions,
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
  } = {
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
    ...chapters,
    ...projects,
    ...entities,
    ...chat,
    ...editor,
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
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Leaf size={21} />
          </span>
          <div className="brand-copy">
            <span>{state.config.title}</span>
            <small>
              {focusMode ? "专注写作 · Esc 返回" : "让故事慢慢生长"}
            </small>
          </div>
        </div>
        <nav className="menu">
          <button onClick={createProject} title="新建小说项目">
            <FilePlus2 size={16} />
            新建
          </button>
          <button onClick={openProject} title="打开小说项目">
            <FolderOpen size={16} />
            打开
          </button>
          <button
            onClick={() => void importDocument()}
            title="导入文档（.docx、.txt、.md）"
          >
            <Upload size={16} />
            导入文档
          </button>
          <button
            onClick={() =>
              void exportBookDocx({
                includeOutline: false,
                includeMaterials: false,
                includeCharacters: false,
                includeWorld: false,
              })
            }
            title="每篇正文分别导出为一个 Word 文档"
          >
            <BookOpen size={16} />
            导出正文
          </button>
          <button
            className="save-action"
            onClick={() => void saveCurrentPage()}
            title="保存当前页面，快捷键 Ctrl+S"
          >
            <Save size={16} />
            保存
          </button>
          <details className="top-more-actions">
            <summary title="更多项目功能">
              <ListTree size={16} />
              更多
            </summary>
            <div className="top-more-menu">
              <span className="menu-group-label">项目与知识库</span>
              <button
                onClick={() => void changeView("knowledge")}
                title="整理文档在知识库中的归属"
              >
                <ListTree size={16} />
                知识库整理
              </button>
              <button
                onClick={exportChapterDocx}
                title="导出当前章节为 Word 文档"
              >
                <FileDown size={16} />
                导出当前DOCX
              </button>
              <button onClick={exportBackup} title="导出压缩备份">
                <Download size={16} />
                备份项目
              </button>
              <button onClick={rebuildIndex} title="重建知识库索引">
                <RefreshCcw size={16} />
                重建索引
              </button>
              <span className="menu-group-label">侧栏布局</span>
              <button
                onClick={() => {
                  setLeftWidth(240);
                  setRightWidth(360);
                  setAiExpanded(false);
                  setFocusMode(false);
                  setStatus("已切换写作布局");
                }}
              >
                写作布局
              </button>
              <button
                onClick={() => {
                  setLeftWidth(320);
                  setRightWidth(400);
                  setAiExpanded(false);
                  setFocusMode(false);
                  setStatus("已切换资料布局");
                }}
              >
                资料布局
              </button>
              <button
                onClick={() => {
                  setLeftWidth(220);
                  setRightWidth(680);
                  setAiExpanded(true);
                  setFocusMode(false);
                  setStatus("已切换对话布局");
                }}
              >
                对话布局
              </button>
            </div>
          </details>
        </nav>
        <div className="top-actions">
          <button
            className="ai-chat-shortcut"
            onClick={showAiChat}
            title="显示 AI 对话"
          >
            <MessageSquarePlus size={18} />
            <span>AI 对话</span>
          </button>
          <button
            onClick={() => setShowQuickPanel(true)}
            title="功能面板 Ctrl+K"
          >
            <ListTree size={18} />
          </button>
          <button onClick={() => void openSettings()} title="模型和项目设置">
            <Settings size={18} />
          </button>
          <button onClick={() => void toggleTheme()} title="切换主题">
            {state.config.ui.theme === "dark" ? (
              <Sun size={18} />
            ) : (
              <Moon size={18} />
            )}
          </button>
          <button
            className="focus-toggle"
            aria-label={focusMode ? "退出专注模式" : "进入专注模式"}
            aria-pressed={focusMode}
            onClick={() => setFocusMode((value) => !value)}
            title="专注模式"
          >
            {focusMode ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
            <span>{focusMode ? "退出专注" : "专注写作"}</span>
          </button>
        </div>
      </header>

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
              onSelect={(id, line) => void selectChapter(id, line)}
              onCreate={() => void createChapter()}
              onDelete={(id) => void deleteChapter(id)}
              onDragStart={setDraggingChapterId}
              onDragEnd={() => setDraggingChapterId(null)}
              onDropToVolume={(volume) => void moveDraggingChapter(volume)}
              onDropOnChapter={(chapter) =>
                void moveDraggingChapter(chapter.volume || "未分卷", chapter.id)
              }
              onImportToVolume={(volume) => void importDocument(volume)}
              onAdjustLevel={(chapterId, line, level, delta) =>
                void adjustOutlineLevel(chapterId, line, level, delta)
              }
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
            <section
              key={selectedChapter?.id || "empty-document"}
              className="editor-panel"
            >
              <div className="editor-header">
                <input
                  className="title-input"
                  aria-label="章节标题"
                  value={chapterTitle}
                  onChange={(event) => {
                    setChapterTitle(event.target.value);
                    setDirty(true);
                  }}
                />
                <input
                  className="volume-input"
                  aria-label="所属分卷"
                  value={chapterVolume}
                  onChange={(event) => {
                    setChapterVolume(event.target.value);
                    setDirty(true);
                  }}
                />
                <div className="editor-tools">
                  {(selectedChapter?.originalDocxFile ||
                    selectedChapter?.importedFrom) && (
                    <button
                      title="打开导入时保留的 Word 原文"
                      onClick={openOriginalDocument}
                    >
                      <FileText size={17} />
                    </button>
                  )}
                  {(selectedChapter?.originalDocxFile ||
                    selectedChapter?.importedFrom) && (
                    <button
                      title="从 Word 原文恢复表格和富文档格式"
                      onClick={() => void refreshChapterFromOriginal()}
                    >
                      <RefreshCcw size={17} />
                    </button>
                  )}
                  <button
                    title={preview ? "返回富文档编辑" : "查看源码"}
                    className={preview ? "active" : ""}
                    onClick={() => setPreview((value) => !value)}
                  >
                    {preview ? <Eye size={17} /> : <EyeOff size={17} />}
                  </button>
                  <button
                    title="查找替换"
                    className={showFindReplace ? "active" : ""}
                    onClick={() => setShowFindReplace((value) => !value)}
                  >
                    <Search size={17} />
                  </button>
                  <button
                    title="全屏专注"
                    onClick={() => setFocusMode((value) => !value)}
                  >
                    <Maximize2 size={17} />
                  </button>
                </div>
              </div>
              {activeRecoveryDraft && (
                <div className="draft-recovery-bar">
                  <div>
                    <strong>发现未保存草稿</strong>
                    <span>
                      {formatDateTime(activeRecoveryDraft.updatedAt)} /{" "}
                      {activeRecoveryDraft.wordCount.toLocaleString()} 字
                      {activeRecoveryDraft.baseRevision !== chapterRevision
                        ? " / 原章节已变化"
                        : ""}
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      void discardRecoveryDraft(activeRecoveryDraft)
                    }
                  >
                    放弃
                  </button>
                  <button
                    className="primary"
                    onClick={() => restoreRecoveryDraft(activeRecoveryDraft)}
                  >
                    恢复草稿
                  </button>
                </div>
              )}
              {showFindReplace && (
                <div className="find-replace-bar">
                  <input
                    value={findText}
                    onChange={(event) => setFindText(event.target.value)}
                    placeholder="查找"
                  />
                  <input
                    value={replaceText}
                    onChange={(event) => setReplaceText(event.target.value)}
                    placeholder="替换为"
                  />
                  <button onClick={findNextInChapter}>查找</button>
                  <button onClick={replaceAllInChapter}>全部替换</button>
                  <span>
                    选中：
                    {selectedText ? `${countWords(selectedText)} 字` : "0 字"}
                  </span>
                </div>
              )}
              <div className="editor-body">
                {preview ? (
                  <textarea
                    ref={editorRef}
                    value={chapterContent}
                    onChange={(event) => {
                      setChapterContent(event.target.value);
                      setDirty(true);
                    }}
                    onMouseUp={captureSelection}
                    onKeyUp={captureSelection}
                    onContextMenu={openAskSelectionMenu}
                    spellCheck={false}
                    style={{
                      fontSize: `${state.config.ui.fontSize}px`,
                      lineHeight: state.config.ui.lineHeight,
                    }}
                  />
                ) : (
                  <RichDocumentEditor
                    key={selectedChapter?.id || "empty-document"}
                    documentId={selectedChapter?.id || ""}
                    value={chapterContent}
                    fontSize={state.config.ui.fontSize}
                    lineHeight={state.config.ui.lineHeight}
                    scrollAnchor={scrollAnchor}
                    reviews={editorReviews}
                    onChange={(documentId, next) => {
                      if (
                        !documentId ||
                        (stores.project.store.getState().selectedChapter?.id ||
                          "") !== documentId
                      )
                        return;
                      setChapterContent(next);
                      setDirty(true);
                    }}
                    onSelection={captureSelection}
                    onContextMenu={openRichAskSelectionMenu}
                    onReady={handleRichEditorReady}
                    onOpenReview={(review) => {
                      setSelectedText(review.quote);
                      void openStoryCenter(
                        "workspace",
                        review.kind === "revision"
                          ? "revisions"
                          : "annotations",
                      );
                    }}
                  />
                )}
              </div>
              {selectedChapter && (
                <ChapterProgressStrip
                  chapter={selectedChapter}
                  onApplyState={applyAppState}
                  onStatus={setStatus}
                />
              )}
            </section>
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
              state={state}
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
            selectedChapterId={selectedChapter?.id || ""}
            messages={chatMessages}
            sessions={chatSessions}
            activeSessionId={activeChatSessionId}
            projectMemory={aiProjectMemory}
            retrievalMode={chatRetrievalMode}
            selectedText={selectedText}
            generating={Boolean(activeAiRequestId)}
            progress={aiProgress}
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
                chatRetrievalMode,
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

      <footer className="statusbar">
        <span className={`save-state ${dirty ? "is-dirty" : ""}`} role="status">
          {view === "chapters"
            ? saving
              ? "保存中..."
              : dirty
                ? "有未保存修改"
                : "已保存"
            : view === "characters"
              ? "角色卡 · 保存状态见当前表单"
              : view === "world"
                ? "世界观 · 保存状态见当前表单"
                : view === "analysis"
                  ? "保存状态见当前面板"
                  : "当前页操作即时保存"}
        </span>
        <span>当前章节：{currentWords.toLocaleString()} 字</span>
        <span>今日：{state.config.stats.todayWords.toLocaleString()} 字</span>
        <span>总字数：{state.config.stats.totalWords.toLocaleString()} 字</span>
        <span>知识库：{state.vectorStats.chunks} 片段</span>
        {state.vectorStats.recovery && (
          <span
            className="index-recovery-note"
            role="status"
            title={state.vectorStats.recovery.message}
          >
            {state.vectorStats.recovery.status === "degraded"
              ? "索引需重建"
              : "索引已恢复"}
          </span>
        )}
        <span>模型：{state.config.api.chatModel || "未配置"}</span>
        <button
          className="task-status-button"
          onClick={() => setShowTaskCenter(true)}
          title="查看后台任务"
        >
          <ListChecks size={13} />
          任务{" "}
          {
            backgroundTasks.filter((task) =>
              ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status),
            ).length
          }
        </button>
        {importProgress && (
          <span className="progress-pill">
            导入：{importProgress.current}/{importProgress.total || "?"}{" "}
            {importProgress.fileName || importProgress.phase}
            {importProgress.cancellable && (
              <button
                onClick={() => void window.novelAPI.cancelImport()}
                title="取消后会在当前文件处理完后停止"
              >
                取消
              </button>
            )}
          </span>
        )}
        {indexProgress && (
          <span className="progress-pill">
            索引：{indexProgress.current}/{indexProgress.total || "?"}{" "}
            {indexProgress.detail || indexProgress.phase}
          </span>
        )}
        <strong>{status}</strong>
      </footer>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="context-menu-note">{contextMenu.text.length} 字</div>
          <button onClick={() => void askSelectedText(contextMenu.text)}>
            <Wand2 size={15} />向 AI 提问
          </button>
          {(["改写", "润色", "扩写", "总结"] as const).map((action) => (
            <button
              key={action}
              onClick={() => void editSelectedText(action, contextMenu.text)}
            >
              <Sparkles size={15} />
              {action}
            </button>
          ))}
          <button
            onClick={() =>
              void extractWorldCardsFromSelection(contextMenu.text)
            }
          >
            <Boxes size={15} />
            提取设定
          </button>
          <button
            onClick={() =>
              openWorkspaceFromSelection("revisions", contextMenu.text)
            }
          >
            <Save size={15} />
            生成安全修订
          </button>
          <button
            onClick={() =>
              openWorkspaceFromSelection("annotations", contextMenu.text)
            }
          >
            <MessageSquarePlus size={15} />
            添加批注
          </button>
        </div>
      )}

      {showSettings && (
        <SettingsModal
          state={state}
          selectedChapterId={selectedChapter?.id}
          onClose={() => setShowSettings(false)}
          onSave={(nextState) => {
            applyAppState(nextState);
            setShowSettings(false);
          }}
        />
      )}
      {showQuickPanel && (
        <QuickPanelModal
          state={state}
          currentView={view}
          onClose={() => setShowQuickPanel(false)}
          onOpenView={(nextView) => {
            setShowQuickPanel(false);
            void changeView(nextView);
          }}
          onImport={() => {
            setShowQuickPanel(false);
            void importDocument();
          }}
          onExportChapter={() => {
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
          onSettings={() => {
            setShowQuickPanel(false);
            void openSettings();
          }}
        />
      )}
      {showStoryCenter && (
        <StoryCenterModal
          state={state}
          selectedChapterId={selectedChapter?.id || ""}
          selectedText={selectedText}
          chapterRevision={chapterRevision}
          initialTab={storyCenterInitialTab}
          workspaceInitialTab={workspaceInitialTab}
          onClose={() => {
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
        />
      )}
      {showTaskCenter && (
        <TaskCenterDrawer
          tasks={backgroundTasks}
          onClose={() => setShowTaskCenter(false)}
          onChange={setBackgroundTasks}
          onOpenStoryCenter={() => {
            setShowTaskCenter(false);
            void openStoryCenter();
          }}
          onStatus={setStatus}
        />
      )}
    </div>
  );
}
