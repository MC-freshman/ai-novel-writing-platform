import { marked } from "marked";
import {
  Activity,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bot,
  Bold,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  FilePlus2,
  FolderOpen,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  ListTree,
  ListChecks,
  Leaf,
  Lock,
  LayoutGrid,
  Maximize2,
  Minimize2,
  MessageSquarePlus,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Quote,
  RefreshCcw,
  Redo2,
  Save,
  Search,
  Send,
  Settings,
  Sparkles,
  Square,
  Sun,
  Table2,
  Trash2,
  TriangleAlert,
  Unlock,
  Underline as UnderlineIcon,
  Undo2,
  Upload,
  UserRound,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Extension, type Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type {
  AppState,
  AgentPermissionLevel,
  AgentScopeType,
  AnalysisSnapshot,
  Chapter,
  ChapterVersion,
  ChapterVersionCompare,
  CharacterCard,
  ChatMessage,
  ChatSession,
  ConsistencyIssue,
  CreativeAdviceItem,
  CreativeAdviceMode,
  CreativeAdviceResult,
  CreativeAgentRun,
  ExtractedWorldCandidate,
  GlobalSearchResult,
  AppearanceStat,
  MaterialItem,
  MaintenanceDiagnostics,
  ProgressState,
  Provider,
  KnowledgeItem,
  KnowledgeRole,
  KnowledgeSyncStatus,
  ProjectHealthReport,
  RelationshipEdge,
  RelationshipNode,
  RetrievalMode,
  RetrievalDiagnostics,
  TimelineEvent,
  WorldDoc,
  WorldMapEdge,
  WorldMapNode,
  BackgroundTask,
  ChapterPreparationBoard,
  ForeshadowItem,
  ForeshadowStatus,
  ProjectBranches,
  ProjectSnapshot,
  ProjectSnapshotComparison,
  StoryFact,
  StoryFactStatus,
  StoryOverview,
  RecoveryDraft,
  OperationJournalItem,
} from "./types";
import { CharacterManager } from "./components/CharacterManager";
import { WorldManager } from "./components/WorldManager";
import { groupByCategory, normalizeCategoryLabel, type CategoryGroup } from "./lib/categories";
import type { PageSaveHandle, PageSaveKind } from "./hooks/useEntityDraft";
import { CreativeWorkspace, type CreativeWorkspaceTab } from "./components/CreativeWorkspace";
import { ChapterProgressStrip } from "./components/ProgressBoard";
import { ProgressWorkspace } from "./components/ProgressWorkspace";
import { countWords, escapeRegExp, formatDateTime, getErrorMessage } from "./lib/text-utils";
import { RETRIEVAL_MODE_OPTIONS, makeMessageId, makeChatSession, titleFromMessages, compactChatMessages, keepRecentChatSessions } from "./lib/chat-utils";
import { findNextInRichEditor, replaceAllInRichEditor, changeHeadingLevel } from "./lib/editor-ops";
import { QuickPanelModal } from "./components/QuickPanelModal";
import { StoryCenterModal } from "./components/StoryCenterModal";
import { TaskCenterDrawer } from "./components/TaskCenterDrawer";
import { RichDocumentEditor } from "./components/RichDocumentEditor";
import { ChapterTree } from "./components/ChapterTree";
import { ChatPanel } from "./components/ChatPanel";
import { KnowledgeOrganizer } from "./components/KnowledgeOrganizer";
import { AnalysisPanel } from "./components/AnalysisPanel";
import { SettingsModal } from "./components/SettingsModal";
import type { AnalysisTab, EditorScrollAnchor } from "./types";
import type { InlineReviewItem } from "./lib/editor-ops";









export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [chapterContent, setChapterContent] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterVolume, setChapterVolume] = useState("卷一");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("正在打开项目...");
  const [view, setView] = useState<"chapters" | "characters" | "world" | "knowledge" | "analysis">("chapters");
  const [networkOpenRequest, setNetworkOpenRequest] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showQuickPanel, setShowQuickPanel] = useState(false);
  const [showStoryCenter, setShowStoryCenter] = useState(false);
  const [storyCenterInitialTab, setStoryCenterInitialTab] = useState<"facts" | "workspace">("facts");
  const [workspaceInitialTab, setWorkspaceInitialTab] = useState<CreativeWorkspaceTab>("planning");
  const [showTaskCenter, setShowTaskCenter] = useState(false);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [focusMode, setFocusMode] = useState(false);
  const [preview, setPreview] = useState(false);
  const [scrollAnchor, setScrollAnchor] = useState<EditorScrollAnchor | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [editorReviews, setEditorReviews] = useState<InlineReviewItem[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState("");
  const [aiProjectMemory, setAiProjectMemory] = useState("");
  const [chatRetrievalMode, setChatRetrievalMode] = useState<RetrievalMode>("auto");
  const [chatLoaded, setChatLoaded] = useState(false);
  const [activeAiRequestId, setActiveAiRequestId] = useState("");
  const [aiProgress, setAiProgress] = useState<{ phase: string; stopped?: boolean; streamedChars: number; retrieval?: RetrievalDiagnostics } | null>(null);
  const [draggingChapterId, setDraggingChapterId] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ProgressState | null>(null);
  const [indexProgress, setIndexProgress] = useState<ProgressState | null>(null);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [leftWidth, setLeftWidth] = useState(256);
  const [rightWidth, setRightWidth] = useState(360);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [aiExpanded, setAiExpanded] = useState(false);
  const [aiChatOpenRequest, setAiChatOpenRequest] = useState(0);
  const [previewWidth, setPreviewWidth] = useState(46);
  const [recoveryDrafts, setRecoveryDrafts] = useState<RecoveryDraft[]>([]);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const richEditorRef = useRef<Editor | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const selectedChapterIdRef = useRef("");
  const chapterRevisionRef = useRef("");
  const chapterLoadRequestRef = useRef(0);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const closingRef = useRef(false);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const chapterDraftRef = useRef({ content: "", title: "", volume: "" });
  const pageSaversRef = useRef(new Map<PageSaveKind, PageSaveHandle>());
  const registerPageSave = useCallback((kind: PageSaveKind, handle: PageSaveHandle | null) => {
    if (handle) pageSaversRef.current.set(kind, handle);
    else pageSaversRef.current.delete(kind);
  }, []);

  const handleRichEditorReady = useCallback((editor: Editor | null) => {
    richEditorRef.current = editor;
  }, []);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  const applyAppState = useCallback((nextState: AppState) => {
    chapterLoadRequestRef.current += 1;
    selectedChapterIdRef.current = nextState.selectedChapter?.id ?? "";
    chapterDraftRef.current = {
      content: nextState.chapterContent,
      title: nextState.selectedChapter?.title ?? "",
      volume: nextState.selectedChapter?.volume ?? "卷一",
    };
    setState(nextState);
    setSelectedChapter(nextState.selectedChapter);
    setChapterContent(nextState.chapterContent);
    setChapterTitle(nextState.selectedChapter?.title ?? "");
    setChapterVolume(nextState.selectedChapter?.volume ?? "卷一");
    chapterRevisionRef.current = nextState.chapterRevision || "";
    document.documentElement.dataset.theme = nextState.config.ui.theme;
    setDirty(false);
    setStatus(`已打开：${nextState.config.title}`);
  }, []);

  useEffect(() => {
    window.novelAPI
      .getAppState()
      .then(applyAppState)
      .catch((error) => setStatus(`打开失败：${error.message}`));
  }, [applyAppState]);

  useEffect(() => {
    if (!state?.projectPath) return;
    void window.novelAPI.getRecoveryStatus().then((recovery) => {
      setRecoveryDrafts(recovery.drafts);
      if (recovery.windowState) {
        setView(recovery.windowState.view || "chapters");
        setLeftWidth(Math.min(520, Math.max(210, recovery.windowState.leftWidth || 256)));
        setRightWidth(Math.min(900, Math.max(300, recovery.windowState.rightWidth || 360)));
        setPreviewWidth(Math.min(68, Math.max(28, recovery.windowState.previewWidth || 46)));
      }
      if (recovery.drafts.length || recovery.interruptedOperations.length) {
        setStatus(`发现可恢复内容：${recovery.drafts.length} 份草稿，${recovery.interruptedOperations.length} 项中断操作`);
      }
    }).catch(() => null);
  }, [state?.projectPath]);

  useEffect(() => {
    const chapterId = selectedChapter?.id;
    if (!state?.projectPath || !chapterId || showStoryCenter) return;
    void window.novelAPI.getCreativeWorkspace()
      .then((workspace) => {
        const annotations: InlineReviewItem[] = workspace.annotations
          .filter((item) => item.chapterId === chapterId)
          .map((item) => ({ id: item.id, kind: "annotation", quote: item.quote, label: item.comment, status: item.status }));
        const revisions: InlineReviewItem[] = workspace.revisions
          .filter((item) => item.chapterId === chapterId && ["待确认", "部分采纳"].includes(item.status) && item.original && item.replacement)
          .map((item) => ({ id: item.id, kind: "revision", quote: item.original, label: `${item.action}：${item.replacement}`, status: item.status }));
        setEditorReviews([...annotations, ...revisions]);
      })
      .catch(() => setEditorReviews([]));
  }, [selectedChapter?.id, showStoryCenter, state?.projectPath]);

  useEffect(() => {
    selectedChapterIdRef.current = selectedChapter?.id ?? "";
    chapterDraftRef.current = { content: chapterContent, title: chapterTitle, volume: chapterVolume };
  }, [chapterContent, chapterTitle, chapterVolume, selectedChapter?.id]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  useEffect(() => {
    if (!state?.projectPath) return;
    setChatLoaded(false);
    window.novelAPI
      .getAnalysisState()
      .then((snapshot) => {
        const restored = keepRecentChatSessions(snapshot.chatSessions || [], snapshot.activeChatSessionId || "");
        let initialSessions = restored.length ? restored : [makeChatSession()];
        const activeId = initialSessions.some((session) => session.id === snapshot.activeChatSessionId) ? snapshot.activeChatSessionId || initialSessions[0].id : initialSessions[0].id;
        let active = initialSessions.find((session) => session.id === activeId) || initialSessions[0];
        const recovery = snapshot.aiStreamRecovery;
        if (recovery?.requestId && recovery.answer) {
          const existing = active.messages.find((message) => message.id === recovery.requestId);
          let recoveredMessages = active.messages;
          if (existing) {
            recoveredMessages = active.messages.map((message) =>
              message.id === recovery.requestId && recovery.answer.length > message.content.length ? { ...message, content: recovery.answer } : message,
            );
          } else {
            const lastUser = [...active.messages].reverse().find((message) => message.role === "user");
            recoveredMessages = [
              ...active.messages,
              ...(lastUser?.content.startsWith(recovery.question)
                ? []
                : [{ id: `${recovery.requestId}_question`, role: "user" as const, content: recovery.question, createdAt: recovery.updatedAt }]),
              { id: recovery.requestId, role: "assistant" as const, content: recovery.answer, createdAt: recovery.updatedAt },
            ];
          }
          active = { ...active, messages: recoveredMessages, updatedAt: recovery.updatedAt };
          initialSessions = initialSessions.map((session) => (session.id === active.id ? active : session));
          if (recovery.status !== "completed") setStatus("已恢复上次生成中断前收到的 AI 内容");
        }
        setChatSessions(initialSessions);
        setActiveChatSessionId(active.id);
        setChatMessages(active.messages || []);
        setAiProjectMemory(snapshot.aiProjectMemory || "");
        setChatRetrievalMode(snapshot.chatRetrievalMode || "auto");
      })
      .catch(() => {
        const session = makeChatSession();
        setChatSessions([session]);
        setActiveChatSessionId(session.id);
        setChatMessages([]);
        setAiProjectMemory("");
        setChatRetrievalMode("auto");
      })
      .finally(() => setChatLoaded(true));
  }, [state?.projectPath]);

  useEffect(() => {
    if (!state?.projectPath) return undefined;
    void window.novelAPI.listTasks().then((result) => setBackgroundTasks(result.tasks)).catch(() => setBackgroundTasks([]));
    const off = window.novelAPI.onTaskProgress((task) => {
      if (task.projectPath && task.projectPath !== state.projectPath) return;
      setBackgroundTasks((current) => [task, ...current.filter((item) => item.id !== task.id)].slice(0, 120));
      if (task.type === "knowledge-rebuild" && task.status === "已完成") {
        void window.novelAPI.getAppState().then((nextState) => {
          setState((current) => current ? { ...current, vectorStats: nextState.vectorStats, chapters: nextState.chapters, config: nextState.config } : nextState);
        }).catch(() => null);
      }
    });
    return off;
  }, [state?.projectPath]);

  useEffect(() => {
    const offImport = window.novelAPI.onImportProgress((progress) => {
      setImportProgress(progress.active ? progress : null);
      if (progress.active) {
        setStatus(`${progress.phase}${progress.total ? ` ${progress.current}/${progress.total}` : ""}${progress.fileName ? `：${progress.fileName}` : ""}`);
      }
    });
    const offIndex = window.novelAPI.onIndexProgress((progress) => {
      setIndexProgress(progress.active ? progress : null);
      if (progress.active) {
        setStatus(`${progress.phase}${progress.total ? ` ${progress.current}/${progress.total}` : ""}${progress.detail ? `：${progress.detail}` : ""}`);
      }
    });
    return () => {
      offImport();
      offIndex();
    };
  }, []);

  useEffect(() => {
    const off = window.novelAPI.onAIStream((payload) => {
      if (!payload.requestId) return;
      if (payload.type === "chunk" && payload.text) {
        setChatMessages((current) =>
          current.map((message) => {
            if (message.id !== payload.requestId) return message;
            const shouldReplace = message.content.startsWith("正在检索小说知识库");
            return { ...message, content: shouldReplace ? payload.text || "" : `${message.content}${payload.text}` };
          }),
        );
      }
      setAiProgress((current) => ({
        phase: payload.phase || (payload.type === "chunk" ? "正在生成回答" : current?.phase || "处理中"),
        stopped: payload.stopped ?? current?.stopped ?? false,
        streamedChars: payload.streamedChars ?? current?.streamedChars ?? 0,
        retrieval: payload.retrieval || current?.retrieval,
      }));
    });
    return off;
  }, []);

  useEffect(() => {
    if (!chatLoaded || !activeChatSessionId) return;
    const timer = window.setTimeout(() => {
      const now = new Date().toISOString();
      setChatSessions((current) => {
        const active = current.find((session) => session.id === activeChatSessionId) || current[0];
        if (!active) return current;
        const nextSession = {
          ...active,
          title: titleFromMessages(chatMessages, active.title || "新会话"),
          messages: compactChatMessages(chatMessages),
          updatedAt: now,
        };
        const next = keepRecentChatSessions([nextSession, ...current.filter((session) => session.id !== active.id)], active.id);
        void window.novelAPI
          .saveAnalysisState({
            chatSessions: next,
            activeChatSessionId: active.id,
            aiProjectMemory,
            chatRetrievalMode,
          })
          .catch(() => null);
        return next;
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [activeChatSessionId, aiProjectMemory, chatLoaded, chatMessages, chatRetrievalMode]);

  const saveChapter = useCallback((): Promise<boolean> => {
    if (!selectedChapter) {
      setStatus("请先选择一个文档再保存。");
      return Promise.resolve(false);
    }
    if (savePromiseRef.current) {
      setStatus("当前文档正在保存，请稍候。");
      return savePromiseRef.current;
    }
    const draft = {
      chapterId: selectedChapter.id,
      title: chapterTitle,
      volume: chapterVolume,
      content: chapterContent,
      expectedRevision: chapterRevisionRef.current,
    };
    let operation!: Promise<boolean>;
    operation = (async () => {
      setSaving(true);
      setStatus("正在保存并更新知识库...");
      try {
        const result = await window.novelAPI.saveChapter(draft);
        const stillViewingSameChapter = selectedChapterIdRef.current === draft.chapterId;
        const currentDraft = chapterDraftRef.current;
        const draftUnchanged =
          currentDraft.content === draft.content && currentDraft.title === draft.title && currentDraft.volume === draft.volume;
        if (stillViewingSameChapter) {
          setSelectedChapter(result.chapter);
        }
        setState((current) =>
          current
            ? {
                ...current,
                config: result.config,
                chapters: result.config.chapters,
                selectedChapter: current.selectedChapter?.id === draft.chapterId ? result.chapter : current.selectedChapter,
                vectorStats: result.vectorStats,
                chapterRevision: current.selectedChapter?.id === draft.chapterId ? result.revision : current.chapterRevision,
              }
            : current,
        );
        if (stillViewingSameChapter) {
          chapterRevisionRef.current = result.revision;
          if (draftUnchanged) {
            setDirty(false);
            setRecoveryDrafts((current) => current.filter((item) => item.chapterId !== draft.chapterId));
            void window.novelAPI.clearRecoveryDraft(draft.chapterId).catch(() => null);
          }
        }
        const mode = result.indexResult.chunks > 0 ? `索引 ${result.indexResult.chunks} 个片段` : "暂无可索引内容";
        setStatus([result.indexWarning, result.journalWarning].filter(Boolean).join("；") || (draftUnchanged ? `已保存，${mode}` : "已保存此前版本，当前还有新改动待保存"));
        return stillViewingSameChapter && draftUnchanged;
      } catch (error) {
        setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`);
        return false;
      } finally {
        if (savePromiseRef.current === operation) savePromiseRef.current = null;
        setSaving(false);
      }
    })();
    savePromiseRef.current = operation;
    return operation;
  }, [chapterContent, chapterTitle, chapterVolume, selectedChapter]);

  const saveChapterIfDirty = useCallback(async () => {
    if (!dirty) return true;
    return saveChapter();
  }, [dirty, saveChapter]);

  const saveBeforeLeavingChapter = useCallback(async () => {
    const networkSaver = pageSaversRef.current.get("novel-network");
    if (networkSaver && !(await networkSaver.protect())) return false;
    const kind = view === "characters" ? "character" : view === "world" ? "world" : null;
    if (kind && !(await pageSaversRef.current.get(kind)?.protect())) return false;
    return saveChapterIfDirty();
  }, [saveChapterIfDirty, view]);

  const saveCurrentPage = useCallback(async () => {
    const networkSaver = pageSaversRef.current.get("novel-network");
    if (networkSaver) return networkSaver.save();
    const kind = view === "characters" ? "character" : view === "world" ? "world" : null;
    if (kind) return (await pageSaversRef.current.get(kind)?.save()) ?? false;
    if (view === "chapters") return saveChapter();
    setStatus("当前页面的操作会即时保存。");
    return true;
  }, [saveChapter, view]);

  useEffect(() => {
    return window.novelAPI.onAppCloseRequested(() => {
      if (closingRef.current) return;
      closingRef.current = true;
      void (async () => {
        try {
          if (dirty && selectedChapter?.id && state?.config.ui.recoveryEnabled !== false) {
            const draft = chapterDraftRef.current;
            await window.novelAPI.saveRecoveryDraft({
              chapterId: selectedChapter.id,
              chapterTitle: draft.title,
              volume: draft.volume,
              content: draft.content,
              baseRevision: chapterRevisionRef.current,
              wordCount: countWords(draft.content),
            });
          }
          if (dirty && !(await saveChapter())) { window.novelAPI.cancelAppClose(); return; }
          for (const handle of pageSaversRef.current.values()) {
            if (!(await handle.save())) { setStatus("当前页面保存失败或仍有新改动，窗口保持打开。"); window.novelAPI.cancelAppClose(); return; }
          }
          window.novelAPI.confirmAppClose();
        } catch (error) {
          setStatus(`关闭前保护失败，窗口保持打开：${getErrorMessage(error)}`);
          window.novelAPI.cancelAppClose();
        } finally {
          closingRef.current = false;
        }
      })();
    });
  }, [dirty, saveChapter, selectedChapter?.id, state?.config.ui.recoveryEnabled]);

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

  async function openStoryCenter(initialTab: "facts" | "workspace" = storyCenterInitialTab, workspaceTab: CreativeWorkspaceTab = workspaceInitialTab) {
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

  useEffect(() => {
    if (!dirty || !state?.config.ui.autosaveMs) return;
    const timer = window.setTimeout(() => {
      void saveChapter();
    }, state.config.ui.autosaveMs);
    return () => window.clearTimeout(timer);
  }, [dirty, saveChapter, state?.config.ui.autosaveMs]);

  useEffect(() => {
    if (!dirty || !selectedChapter?.id || state?.config.ui.recoveryEnabled === false) return;
    const timer = window.setTimeout(() => {
      void window.novelAPI.saveRecoveryDraft({
        chapterId: selectedChapter.id,
        chapterTitle,
        volume: chapterVolume,
        content: chapterContent,
        baseRevision: chapterRevisionRef.current,
        wordCount: countWords(chapterContent),
      }).catch(() => null);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [chapterContent, chapterTitle, chapterVolume, dirty, selectedChapter?.id, state?.config.ui.recoveryEnabled]);

  useEffect(() => {
    if (!state?.projectPath) return;
    const timer = window.setTimeout(() => {
      void window.novelAPI.saveWindowRecoveryState({
        selectedChapterId: selectedChapter?.id,
        view,
        leftWidth,
        rightWidth,
        previewWidth,
      }).catch(() => null);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [leftWidth, previewWidth, rightWidth, selectedChapter?.id, state?.projectPath, view]);

  const activeRecoveryDraft = useMemo(
    () => recoveryDrafts.find((item) => item.chapterId === selectedChapter?.id && item.content !== chapterContent) || null,
    [chapterContent, recoveryDrafts, selectedChapter?.id],
  );

  function restoreRecoveryDraft(draft: RecoveryDraft) {
    if (draft.kind === "novel-network") {
      void changeView("analysis").then((changed) => { if (changed) setNetworkOpenRequest((value) => value + 1); });
      setStatus("请在进度 → 小说统筹网中查看已恢复的草稿");
      return;
    }
    if (draft.kind === "character" || draft.kind === "world") {
      void changeView(draft.kind === "character" ? "characters" : "world");
      setStatus("请在对应表单中查看已恢复的草稿");
      return;
    }
    setChapterContent(draft.content);
    setChapterTitle(draft.chapterTitle || chapterTitle);
    setChapterVolume(draft.volume || chapterVolume);
    setRecoveryDrafts((current) => current.filter((item) => item.chapterId !== draft.chapterId));
    setDirty(true);
    setStatus(draft.baseRevision && draft.baseRevision !== chapterRevisionRef.current ? "已恢复草稿；原章节保存后曾变化，请对照历史版本后再保存" : "已恢复未保存草稿");
  }

  async function discardRecoveryDraft(draft: RecoveryDraft) {
    await window.novelAPI.clearRecoveryDraft(draft.chapterId).catch(() => null);
    setRecoveryDrafts((current) => current.filter((item) => item.chapterId !== draft.chapterId));
    setStatus("已放弃这份恢复草稿，当前正文未变化");
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const dialogOpen = showSettings || showQuickPanel || showStoryCenter || showTaskCenter || Boolean(contextMenu);
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f" && view === "chapters" && !dialogOpen) {
        event.preventDefault();
        setFocusMode((value) => !value);
      }
      if (event.key === "Escape" && focusMode && !dialogOpen) {
        event.preventDefault();
        setFocusMode(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveCurrentPage();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowQuickPanel(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [contextMenu, focusMode, saveCurrentPage, showQuickPanel, showSettings, showStoryCenter, showTaskCenter, view]);

  useEffect(() => {
    if (!focusMode || view !== "chapters") return;
    const frame = window.requestAnimationFrame(() => {
      if (preview) editorRef.current?.focus();
      else richEditorRef.current?.view.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusMode, preview, view]);

  const currentWords = useMemo(() => countWords(chapterContent), [chapterContent]);
  const paneWidths = useMemo(() => {
    const centerMinimum = aiExpanded ? 240 : 380;
    const rightMinimum = aiExpanded ? 520 : 300;
    const sideBudget = Math.max(510, viewportWidth - centerMinimum - 12);
    const left = Math.min(leftWidth, Math.max(210, sideBudget - rightMinimum));
    const desiredRight = aiExpanded ? Math.max(rightWidth, 680) : rightWidth;
    const right = Math.min(desiredRight, Math.max(rightMinimum, sideBudget - left));
    return { left, right, centerMinimum };
  }, [aiExpanded, leftWidth, rightWidth, viewportWidth]);

  async function selectChapter(chapterId: string, line?: number, quote?: string) {
    const requestId = ++chapterLoadRequestRef.current;
    if (!(await saveBeforeLeavingChapter())) return;
    if (requestId !== chapterLoadRequestRef.current) return;
    try {
      const payload = await window.novelAPI.loadChapter(chapterId);
      if (requestId !== chapterLoadRequestRef.current) return;
      if (!payload.chapter || payload.chapter.id !== chapterId) throw new Error("章节身份校验失败，已停止切换。");
      selectedChapterIdRef.current = payload.chapter.id;
      chapterDraftRef.current = {
        content: payload.content,
        title: payload.chapter.title,
        volume: payload.chapter.volume || "卷一",
      };
      setSelectedChapter(payload.chapter);
      setChapterContent(payload.content);
      setChapterTitle(payload.chapter?.title ?? "");
      setChapterVolume(payload.chapter?.volume ?? "卷一");
      chapterRevisionRef.current = payload.revision || "";
      setState((current) => current ? {
        ...current,
        selectedChapter: payload.chapter,
        chapterContent: payload.content,
        chapterRevision: payload.revision || "",
      } : current);
      setDirty(false);
      setView("chapters");
      if (typeof line === "number" || quote) {
        const headingIndex = typeof line === "number" ? (payload.chapter?.outline || []).findIndex((item) => item.line === line) : -1;
        setScrollAnchor({ key: Date.now(), headingIndex: headingIndex >= 0 ? headingIndex : undefined, quote: String(quote || "").trim() || undefined });
        window.requestAnimationFrame(() => {
          const editor = editorRef.current;
          if (!editor) return;
          const lines = payload.content.split(/\r?\n/);
          const quoteIndex = quote ? payload.content.indexOf(quote) : -1;
          const targetLine = quoteIndex >= 0 ? payload.content.slice(0, quoteIndex).split(/\r?\n/).length - 1 : Number(line || 0);
          const position = quoteIndex >= 0 ? quoteIndex : lines.slice(0, targetLine).join("\n").length + (targetLine > 0 ? 1 : 0);
          editor.focus();
          editor.selectionStart = position;
          editor.selectionEnd = position + (quote?.length || lines[targetLine]?.length || 0);
          const ratio = Math.max(0, targetLine / Math.max(1, lines.length));
          editor.scrollTop = ratio * editor.scrollHeight;
        });
      }
    } catch (error) {
      if (requestId === chapterLoadRequestRef.current) setStatus(`打开文档失败：${getErrorMessage(error)}`);
    }
  }

  async function createChapter() {
    if (!(await saveBeforeLeavingChapter())) return;
    const title = `第${(state?.chapters.length ?? 0) + 1}章 新章节`;
    try {
      const next = await window.novelAPI.createChapter({ title, volume: chapterVolume || "卷一" });
      applyAppState(next);
      setStatus("已创建新章节，可以在中间顶部修改标题");
    } catch (error) {
      setStatus(`新建章节失败：${getErrorMessage(error)}`);
    }
  }

  async function deleteChapter(chapterId: string) {
    if (!window.confirm("确定删除这个章节吗？对应的本地文件和向量索引都会删除。")) return;
    if (!(await saveBeforeLeavingChapter())) return;
    try {
      const next = await window.novelAPI.deleteChapter(chapterId);
      applyAppState(next);
      setStatus("章节已删除");
    } catch (error) {
      setStatus(`删除章节失败：${getErrorMessage(error)}`);
    }
  }

  async function moveDraggingChapter(volume: string, beforeChapterId = "") {
    if (!state || !draggingChapterId) return;
    if (beforeChapterId && draggingChapterId === beforeChapterId) {
      setDraggingChapterId(null);
      return;
    }
    if (!(await saveBeforeLeavingChapter())) return;
    const targetVolume = volume.trim() || "未分卷";
    try {
      const next = await window.novelAPI.moveChapterToVolume({
        chapterId: draggingChapterId,
        volume: targetVolume,
        beforeChapterId,
      });
      applyAppState(next);
      setView("chapters");
      setStatus(`已移动到分组：${targetVolume}`);
    } catch (error) {
      setStatus(`移动失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDraggingChapterId(null);
    }
  }

  async function adjustOutlineLevel(chapterId: string, lineOrIndex: number, currentLevel: number, delta: number) {
    if (!(await saveBeforeLeavingChapter())) return;
    let payload: Awaited<ReturnType<typeof window.novelAPI.loadChapter>>;
    try {
      payload = await window.novelAPI.loadChapter(chapterId);
    } catch (error) {
      setStatus(`读取目录对应文档失败：${getErrorMessage(error)}`);
      return;
    }
    if (!payload.chapter) {
      setStatus("没有找到要调整目录等级的文档。");
      return;
    }
    const nextLevel = Math.min(6, Math.max(1, currentLevel + delta));
    if (nextLevel === currentLevel) {
      setStatus(delta < 0 ? "已经是最高级标题" : "已经是最低级标题");
      return;
    }
    const nextContent = changeHeadingLevel(payload.content, lineOrIndex, nextLevel);
    if (nextContent === payload.content) {
      setStatus("没有找到可调整的标题，请先在正文里保存一次");
      return;
    }
    const optimisticChapter = {
      ...payload.chapter,
      wordCount: countWords(nextContent),
      outline: (payload.chapter.outline || []).map((item) => (item.line === lineOrIndex ? { ...item, level: nextLevel } : item)),
    };
    setState((current) => {
      if (!current) return current;
      const chapters = current.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, outline: optimisticChapter.outline, wordCount: optimisticChapter.wordCount } : chapter));
      return {
        ...current,
        chapters,
        config: { ...current.config, chapters },
        selectedChapter: chapterId === selectedChapter?.id ? optimisticChapter : current.selectedChapter,
      };
    });
    if (chapterId === selectedChapter?.id) {
      setSelectedChapter(optimisticChapter);
      setChapterContent(nextContent);
      setChapterTitle(optimisticChapter.title);
      setChapterVolume(optimisticChapter.volume);
      setDirty(false);
    }
    setSaving(true);
    setStatus("正在调整目录等级并保存...");
    try {
      const result = await window.novelAPI.saveChapter({
        chapterId,
        title: payload.chapter.title,
        volume: payload.chapter.volume,
        content: nextContent,
        expectedRevision: payload.revision,
      });
      setState((current) =>
        current
          ? {
              ...current,
              config: result.config,
              chapters: result.config.chapters,
              selectedChapter: chapterId === selectedChapter?.id ? result.chapter : current.selectedChapter,
              vectorStats: result.vectorStats,
              chapterRevision: chapterId === selectedChapter?.id ? result.revision : current.chapterRevision,
            }
          : current,
      );
      if (chapterId === selectedChapter?.id) {
        chapterRevisionRef.current = result.revision;
        setSelectedChapter(result.chapter);
        setChapterContent(nextContent);
        setChapterTitle(result.chapter.title);
        setChapterVolume(result.chapter.volume);
        setDirty(false);
      }
      setStatus(`已把标题调整为 ${nextLevel} 级，并同步更新知识库`);
    } catch (error) {
      if (chapterId === selectedChapter?.id) setDirty(true);
      setStatus(`调整目录等级失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }

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
    setStatus(targetVolume ? `正在导入文档到「${targetVolume}」并建立知识库...` : "正在导入文档并建立知识库...");
    try {
      const result = await window.novelAPI.importDocument(targetVolume ? { volume: targetVolume } : undefined);
      if ("canceled" in result) {
        setStatus(result.message || "已取消导入文档");
        return;
      }
      const summary = result.importSummary;
      applyAppState(result);
      setView("chapters");
      setPreview(false);
      if (summary?.failed) {
        setStatus(`已导入 ${summary.imported}/${summary.total} 个文档${targetVolume ? `到「${targetVolume}」` : ""}，${summary.failed} 个失败；成功导入的文档已加入知识库`);
      } else if (summary?.canceled) {
        setStatus(`已取消导入；已完成 ${summary.imported}/${summary.total} 个文档`);
      } else if (summary?.imported && summary.imported > 1) {
        setStatus(`已批量导入 ${summary.imported} 个文档${targetVolume ? `到「${targetVolume}」` : ""}，并已加入知识库`);
      } else {
        setStatus(`文档已导入${targetVolume ? `到「${targetVolume}」` : "为章节"}，并已加入知识库`);
      }
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`);
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
      const result = await window.novelAPI.exportChapterDocx(selectedChapter.id);
      if (result.canceled) {
        setStatus("已取消导出");
        return;
      }
      if (result.filePath) setStatus(`Word 文档已导出：${result.filePath}`);
      else setStatus("导出已结束，但没有收到保存位置。请重新选择导出路径。");
    } catch (error) {
      setStatus(`导出失败：${error instanceof Error ? error.message : String(error)}`);
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
        const failureNotice = result.failedCount ? `，${result.failedCount} 个失败` : "";
        setStatus(`已逐篇导出 ${result.exportedCount || 0} 个 Word 文档${failureNotice}：${result.directoryPath}`);
      } else {
        setStatus("批量导出已结束，但没有收到保存位置。请重新选择导出目录。");
      }
    } catch (error) {
      setStatus(`批量导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function openOriginalDocument() {
    if (!selectedChapter) {
      setStatus("请先选择一个导入的文档。");
      return;
    }
    try {
      const result = await window.novelAPI.openOriginalDocument(selectedChapter.id);
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
    if (!window.confirm("将从导入时的 Word 原文重新生成富文档内容，用来恢复表格和版式。当前编辑副本会先自动备份，但正文里的后续手改内容可能被原文覆盖。继续吗？")) return;
    if (!(await saveBeforeLeavingChapter())) return;
    setSaving(true);
    setStatus("正在从 Word 原文恢复表格和富文档格式...");
    try {
      const result = await window.novelAPI.refreshChapterFromOriginal({ chapterId: selectedChapter.id, expectedRevision: chapterRevisionRef.current });
      applyAppState(result.state);
      setView("chapters");
      setPreview(false);
      setStatus(`已恢复 Word 表格：${result.tableCount} 个表格、${result.imageCount} 张图片；旧编辑副本已备份到 ${result.backupPath || "backups/docx_refresh"}`);
    } catch (error) {
      setStatus(`恢复 Word 格式失败：${error instanceof Error ? error.message : String(error)}`);
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
      else setStatus("备份导出已结束，但没有收到保存位置。请重新选择导出路径。");
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

  function startPaneResize(kind: "left" | "right" | "preview", event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const initialLeft = leftWidth;
    const initialRight = rightWidth;
    const editorBody = (event.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect();
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

  function captureSelection() {
    if (!preview) {
      const text = window.getSelection()?.toString().trim() || "";
      setSelectedText(text);
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const text = chapterContent.slice(editor.selectionStart, editor.selectionEnd).trim();
    setSelectedText(text);
  }

  function openAskSelectionMenu(event: React.MouseEvent<HTMLTextAreaElement>) {
    captureSelection();
    const editor = editorRef.current;
    if (!editor) return;
    const text = chapterContent.slice(editor.selectionStart, editor.selectionEnd).trim();
    if (!text) return;
    event.preventDefault();
    setContextMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 300)), text });
  }

  function openRichAskSelectionMenu(event: React.MouseEvent<HTMLElement>) {
    const text = window.getSelection()?.toString().trim() || "";
    setSelectedText(text);
    if (!text) return;
    event.preventDefault();
    setContextMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 300)), text });
  }

  function findNextInChapter() {
    const needle = findText.trim();
    if (!needle) {
      setStatus("请先输入要查找的文字。");
      return;
    }
    if (!preview) {
      const result = richEditorRef.current ? findNextInRichEditor(richEditorRef.current, needle) : { found: false, wrapped: false, selectedText: "" };
      if (!result.found) {
        setSelectedText("");
        setStatus(`未找到：${needle}`);
        return;
      }
      setSelectedText(result.selectedText);
      setStatus(result.wrapped ? `已从开头重新定位：${needle}` : `已定位：${needle}`);
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
      const matches = richEditorRef.current ? replaceAllInRichEditor(richEditorRef.current, needle, replaceText) : 0;
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

  function saveChatDraft(nextSessions: ChatSession[], nextActiveId = activeChatSessionId, nextMemory = aiProjectMemory) {
    if (!chatLoaded) return;
    const compactSessions = keepRecentChatSessions(nextSessions, nextActiveId);
    void window.novelAPI
      .saveAnalysisState({
        chatSessions: compactSessions,
        activeChatSessionId: nextActiveId,
        aiProjectMemory: nextMemory,
        chatRetrievalMode,
      })
      .catch(() => null);
  }

  function updateCurrentChat(nextMessages: ChatMessage[]) {
    const now = new Date().toISOString();
    const existingSession = chatSessions.find((session) => session.id === activeChatSessionId) || chatSessions[0];
    const baseSession = existingSession || makeChatSession();
    const activeId = baseSession.id;
    const nextSession = {
      ...baseSession,
      id: activeId,
      title: titleFromMessages(nextMessages, baseSession.title || "新会话"),
      messages: compactChatMessages(nextMessages),
      updatedAt: now,
    };
    const nextSessions = keepRecentChatSessions([nextSession, ...chatSessions.filter((session) => session.id !== activeId)], activeId);
    setChatSessions(nextSessions);
    setActiveChatSessionId(activeId);
    setChatMessages(nextMessages);
    saveChatDraft(nextSessions, activeId);
  }

  function createChatSession() {
    const session = makeChatSession();
    const nextSessions = keepRecentChatSessions([session, ...chatSessions], session.id);
    setChatSessions(nextSessions);
    setActiveChatSessionId(session.id);
    setChatMessages([]);
    saveChatDraft(nextSessions, session.id);
    setStatus("已新建 AI 会话");
  }

  function switchChatSession(sessionId: string) {
    if (activeAiRequestId) {
      setStatus("当前回答仍在生成，请先停止或等待完成。");
      return;
    }
    const session = chatSessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveChatSessionId(session.id);
    setChatMessages(session.messages || []);
    saveChatDraft(chatSessions, session.id);
  }

  function clearCurrentChat() {
    if (activeAiRequestId) {
      setStatus("当前回答仍在生成，请先停止后再清空。");
      return;
    }
    const nextMessages: ChatMessage[] = [];
    updateCurrentChat(nextMessages);
    setStatus("已清空当前 AI 会话");
  }

  function updateProjectMemory(value: string) {
    const next = value.slice(0, 3000);
    setAiProjectMemory(next);
    saveChatDraft(chatSessions, activeChatSessionId, next);
  }

  async function askSelectedText(text: string) {
    setContextMenu(null);
    const question = window.prompt("想让 AI 围绕选中文字回答什么？", "分析这段文字的作用，并给出修改建议。");
    if (!question) return;
    await sendChat(question, text);
  }

  async function editSelectedText(action: "改写" | "润色" | "扩写" | "总结", text: string) {
    setContextMenu(null);
    const pendingId = makeMessageId();
    const startedMessages: ChatMessage[] = [
      ...chatMessages,
      { id: makeMessageId(), role: "user", content: `${action}选中文字\n\n【选中文字】\n${text}`, createdAt: new Date().toISOString() },
      { id: pendingId, role: "assistant", content: `正在${action}选中文字...`, createdAt: new Date().toISOString() },
    ];
    updateCurrentChat(startedMessages);
    try {
      const result = await window.novelAPI.editSelection({ action, text });
      updateCurrentChat(startedMessages.map((item) => (item.id === pendingId ? { ...item, content: result.answer } : item)));
      setStatus(`${action}完成，结果已放到右侧 AI 对话`);
    } catch (error) {
      updateCurrentChat(
        startedMessages.map((item) => (item.id === pendingId ? { ...item, content: `${action}失败：${error instanceof Error ? error.message : String(error)}` } : item)),
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
      setStatus(`已从选中文字提取 ${result.candidates.length} 个候选；请在分析页勾选后写入世界观`);
    } catch (error) {
      setStatus(`提取设定失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function openWorkspaceFromSelection(tab: CreativeWorkspaceTab, text: string) {
    setContextMenu(null);
    setSelectedText(text);
    await openStoryCenter("workspace", tab);
  }

  function updateChatRetrievalMode(mode: RetrievalMode) {
    setChatRetrievalMode(mode);
    if (chatLoaded) {
      void window.novelAPI.saveAnalysisState({ chatRetrievalMode: mode }).catch(() => null);
    }
  }

  async function sendChat(question: string, selection = selectedText, retrievalMode = chatRetrievalMode, additionalSourceIds: string[] = []) {
    const trimmed = question.trim();
    if (!trimmed) return;
    if (activeAiRequestId) {
      setStatus("AI 正在生成上一条回答，请先停止或等待完成。");
      return;
    }
    const userMessage: ChatMessage = {
      id: makeMessageId(),
      role: "user",
      content: selection ? `${trimmed}\n\n【选中文字】\n${selection}` : trimmed,
      createdAt: new Date().toISOString(),
    };
    const pendingId = makeMessageId();
    const historyMessages = chatMessages;
    const startedMessages: ChatMessage[] = [
      ...historyMessages,
      userMessage,
      { id: pendingId, role: "assistant", content: "正在检索小说知识库并组织回答...", createdAt: new Date().toISOString() },
    ];
    setActiveAiRequestId(pendingId);
    setAiProgress({ phase: "正在规划检索范围", streamedChars: 0 });
    updateCurrentChat(startedMessages);
    try {
      const response = await window.novelAPI.askAI({
        requestId: pendingId,
        question: trimmed,
        selectedText: selection,
        history: historyMessages.map((item) => ({ role: item.role, content: item.content })),
        projectMemory: aiProjectMemory,
        retrievalMode,
        selectedChapterId: selectedChapter?.id || "",
        additionalSourceIds,
      });
      updateCurrentChat(
        startedMessages.map((item) =>
          item.id === pendingId
            ? {
                ...item,
                content: response.answer,
                context: response.context,
                retrieval: response.retrieval,
              }
            : item,
        ),
      );
      const contextCount = response.contextCount ?? response.context.length;
      const candidateCount = response.candidateCount ?? contextCount;
      const scannedCount = response.scannedCount ?? candidateCount;
      const modeLabel = response.retrieval?.modeLabel || RETRIEVAL_MODE_OPTIONS.find((item) => item.value === retrievalMode)?.label || "自动判断";
      setStatus(
        response.embeddingWarning
          ? `检索已完成：${modeLabel}，扫描 ${scannedCount} 条，候选 ${candidateCount} 条，发送 ${contextCount} 条，流式接收 ${response.streamedChars || 0} 字；本地向量回退：${response.embeddingWarning}`
          : `检索已完成：${modeLabel}，扫描 ${scannedCount} 条，候选 ${candidateCount} 条，发送 ${contextCount} 条，流式接收 ${response.streamedChars || 0} 字`,
      );
    } catch (error) {
      const currentMessages = chatMessagesRef.current.length ? chatMessagesRef.current : startedMessages;
      updateCurrentChat(
        currentMessages.map((item) =>
          item.id === pendingId
            ? {
                ...item,
                content: item.content.startsWith("正在检索小说知识库")
                  ? `请求失败：${error instanceof Error ? error.message : String(error)}`
                  : `${item.content}\n\n【生成中断，以上内容已自动保留。】`,
              }
            : item,
        ),
      );
    } finally {
      setActiveAiRequestId("");
    }
  }

  async function stopChatGeneration() {
    if (!activeAiRequestId) return;
    setAiProgress((current) => ({ phase: "正在停止，已生成内容会保留", streamedChars: current?.streamedChars || 0, retrieval: current?.retrieval }));
    const result = await window.novelAPI.cancelAI(activeAiRequestId).catch(() => ({ canceled: false }));
    setStatus(result.canceled ? "正在停止生成，已收到的内容会保留" : "这次生成已经结束");
  }

  async function saveCharacter(card: Partial<CharacterCard>) {
    if (!(await saveChapterIfDirty())) return null;
    try {
      const next = await window.novelAPI.saveCharacter(card);
      applyAppState(next);
      setView("characters");
      setStatus(`角色卡片已保存：${card.name || "未命名角色"}`);
      return next.characters.find((item) => item.id === card.id) || next.characters.find((item) => item.name === (card.name || "未命名角色")) || null;
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
    if (!window.confirm("将检索当前项目中的大纲和正文，并调用 AI 生成角色卡片。生成结果会直接写入“角色”界面；同名角色会更新。继续吗？")) return;
    if (!(await saveBeforeLeavingChapter())) return;
    setStatus("正在检索大纲并生成角色卡片...");
    try {
      const result = await window.novelAPI.generateCharactersFromOutline();
      applyAppState(result.state);
      setView("characters");
      setStatus(`已生成角色卡片：新增 ${result.created} 张，更新 ${result.updated} 张；使用检索片段 ${result.contextCount} 条`);
    } catch (error) {
      setStatus(`生成角色卡片失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function saveWorldDoc(doc: Partial<WorldDoc>) {
    if (!(await saveChapterIfDirty())) return null;
    try {
      const next = await window.novelAPI.saveWorldDoc(doc);
      applyAppState(next);
      setView("world");
      setStatus(`世界观条目已保存：${doc.title || "未命名设定"}`);
      return next.worldDocs.find((item) => item.id === doc.id) || next.worldDocs.find((item) => item.title === (doc.title || "未命名设定")) || null;
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
    if (!window.confirm("将检索当前项目中的大纲和正文，并调用 AI 生成世界观条目。生成结果会直接写入“世界”界面；同名条目会更新。继续吗？")) return;
    if (!(await saveBeforeLeavingChapter())) return;
    setStatus("正在检索大纲并生成世界观条目...");
    try {
      const result = await window.novelAPI.generateWorldFromOutline();
      applyAppState(result.state);
      setView("world");
      setStatus(`已生成世界观：新增 ${result.created} 条，更新 ${result.updated} 条；使用检索片段 ${result.contextCount} 条`);
    } catch (error) {
      setStatus(`生成世界观失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }



  useEffect(() => {
    if (!state) return undefined;
    return window.novelAPI.onMenuAction((action) => {
      if (action === "newProject") void createProject();
      if (action === "openProject") void openProject();
      if (action === "importDocument") void importDocument();
      if (action === "exportChapterDocx") void exportChapterDocx();
      if (action === "exportBookDocx") void exportBookDocx({ includeOutline: true, includeMaterials: true });
      if (action === "exportBackup") void exportBackup();
      if (action === "saveChapter") void saveCurrentPage();
      if (action === "rebuildIndex") void rebuildIndex();
      if (action === "showSettings") void openSettings();
      if (action === "toggleFocus") setFocusMode((value) => !value);
      if (action === "toggleTheme") void toggleTheme();
    });
  });

  if (!state) {
    return (
      <div className="loading-screen">
        <Sparkles className="spin-slow" />
        <p>{status}</p>
      </div>
    );
  }

  return (
    <div className={`app-shell ${focusMode ? "focus" : ""}`} onClick={() => setContextMenu(null)}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><Leaf size={21} /></span>
          <div className="brand-copy"><span>{state.config.title}</span><small>{focusMode ? "专注写作 · Esc 返回" : "让故事慢慢生长"}</small></div>
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
          <button onClick={() => void importDocument()} title="导入文档（.docx、.txt、.md）">
            <Upload size={16} />
            导入文档
          </button>
          <button onClick={() => void exportBookDocx({ includeOutline: false, includeMaterials: false, includeCharacters: false, includeWorld: false })} title="每篇正文分别导出为一个 Word 文档">
            <BookOpen size={16} />
            导出正文
          </button>
          <button className="save-action" onClick={() => void saveCurrentPage()} title="保存当前页面，快捷键 Ctrl+S">
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
              <button onClick={() => void changeView("knowledge")} title="整理文档在知识库中的归属">
                <ListTree size={16} />
                知识库整理
              </button>
              <button onClick={exportChapterDocx} title="导出当前章节为 Word 文档">
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
              <button onClick={() => { setLeftWidth(240); setRightWidth(360); setAiExpanded(false); setFocusMode(false); setStatus("已切换写作布局"); }}>写作布局</button>
              <button onClick={() => { setLeftWidth(320); setRightWidth(400); setAiExpanded(false); setFocusMode(false); setStatus("已切换资料布局"); }}>资料布局</button>
              <button onClick={() => { setLeftWidth(220); setRightWidth(680); setAiExpanded(true); setFocusMode(false); setStatus("已切换对话布局"); }}>对话布局</button>
            </div>
          </details>
        </nav>
        <div className="top-actions">
          <button className="ai-chat-shortcut" onClick={showAiChat} title="显示 AI 对话">
            <MessageSquarePlus size={18} />
            <span>AI 对话</span>
          </button>
          <button onClick={() => setShowQuickPanel(true)} title="功能面板 Ctrl+K">
            <ListTree size={18} />
          </button>
          <button onClick={() => void openSettings()} title="模型和项目设置">
            <Settings size={18} />
          </button>
          <button
            onClick={() => void toggleTheme()}
            title="切换主题"
          >
            {state.config.ui.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="focus-toggle" aria-label={focusMode ? "退出专注模式" : "进入专注模式"} aria-pressed={focusMode} onClick={() => setFocusMode((value) => !value)} title="专注模式">
            {focusMode ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            <span>{focusMode ? "退出专注" : "专注写作"}</span>
          </button>
        </div>
      </header>

      <main
        className={`workspace ${aiExpanded ? "ai-expanded" : ""}`}
        ref={workspaceRef}
        style={{
          gridTemplateColumns: focusMode ? "minmax(0, 1fr)" : `minmax(0, ${paneWidths.left}px) 6px minmax(${paneWidths.centerMinimum}px, 1fr) 6px minmax(0, ${paneWidths.right}px)`,
        }}
      >
        {!focusMode && (
          <aside className="left-pane">
            <div className="pane-tabs">
              <button aria-current={view === "chapters" ? "page" : undefined} className={view === "chapters" ? "active" : ""} onClick={() => void changeView("chapters")} title="章节">
                <BookOpen size={16} /> 章节
              </button>
              <button aria-current={view === "characters" ? "page" : undefined} className={view === "characters" ? "active" : ""} onClick={() => void changeView("characters")} title="角色">
                <UserRound size={16} /> 角色
              </button>
              <button aria-current={view === "world" ? "page" : undefined} className={view === "world" ? "active" : ""} onClick={() => void changeView("world")} title="世界">
                <Boxes size={16} /> 世界
              </button>
              <button aria-current={view === "knowledge" ? "page" : undefined} className={view === "knowledge" ? "active" : ""} onClick={() => void changeView("knowledge")} title="知识库">
                <ListTree size={16} /> 知识库
              </button>
              <button aria-current={view === "analysis" ? "page" : undefined} className={view === "analysis" ? "active" : ""} onClick={() => void changeView("analysis")} title="分析">
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
              onDropOnChapter={(chapter) => void moveDraggingChapter(chapter.volume || "未分卷", chapter.id)}
              onImportToVolume={(volume) => void importDocument(volume)}
              onAdjustLevel={(chapterId, line, level, delta) => void adjustOutlineLevel(chapterId, line, level, delta)}
            />
            <div className="project-path" title={state.projectPath}>
              {state.projectPath}
            </div>
          </aside>
        )}

        {!focusMode && <div className="pane-resizer" title="拖动调整左侧宽度" onMouseDown={(event) => startPaneResize("left", event)} />}

        <section className="center-pane">
          {view === "chapters" && (
            <section key={selectedChapter?.id || "empty-document"} className="editor-panel">
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
                  {(selectedChapter?.originalDocxFile || selectedChapter?.importedFrom) && (
                    <button title="打开导入时保留的 Word 原文" onClick={openOriginalDocument}>
                      <FileText size={17} />
                    </button>
                  )}
                  {(selectedChapter?.originalDocxFile || selectedChapter?.importedFrom) && (
                    <button title="从 Word 原文恢复表格和富文档格式" onClick={() => void refreshChapterFromOriginal()}>
                      <RefreshCcw size={17} />
                    </button>
                  )}
                  <button title={preview ? "返回富文档编辑" : "查看源码"} className={preview ? "active" : ""} onClick={() => setPreview((value) => !value)}>
                    {preview ? <Eye size={17} /> : <EyeOff size={17} />}
                  </button>
                  <button title="查找替换" className={showFindReplace ? "active" : ""} onClick={() => setShowFindReplace((value) => !value)}>
                    <Search size={17} />
                  </button>
                  <button title="全屏专注" onClick={() => setFocusMode((value) => !value)}>
                    <Maximize2 size={17} />
                  </button>
                </div>
              </div>
              {activeRecoveryDraft && (
                <div className="draft-recovery-bar">
                  <div><strong>发现未保存草稿</strong><span>{formatDateTime(activeRecoveryDraft.updatedAt)} / {activeRecoveryDraft.wordCount.toLocaleString()} 字{activeRecoveryDraft.baseRevision !== chapterRevisionRef.current ? " / 原章节已变化" : ""}</span></div>
                  <button onClick={() => void discardRecoveryDraft(activeRecoveryDraft)}>放弃</button>
                  <button className="primary" onClick={() => restoreRecoveryDraft(activeRecoveryDraft)}>恢复草稿</button>
                </div>
              )}
              {showFindReplace && (
                <div className="find-replace-bar">
                  <input value={findText} onChange={(event) => setFindText(event.target.value)} placeholder="查找" />
                  <input value={replaceText} onChange={(event) => setReplaceText(event.target.value)} placeholder="替换为" />
                  <button onClick={findNextInChapter}>查找</button>
                  <button onClick={replaceAllInChapter}>全部替换</button>
                  <span>选中：{selectedText ? `${countWords(selectedText)} 字` : "0 字"}</span>
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
                      if (!documentId || selectedChapterIdRef.current !== documentId) return;
                      setChapterContent(next);
                      setDirty(true);
                    }}
                    onSelection={captureSelection}
                    onContextMenu={openRichAskSelectionMenu}
                    onReady={handleRichEditorReady}
                    onOpenReview={(review) => {
                      setSelectedText(review.quote);
                      void openStoryCenter("workspace", review.kind === "revision" ? "revisions" : "annotations");
                    }}
                  />
                )}
              </div>
              {selectedChapter && <ChapterProgressStrip chapter={selectedChapter} onApplyState={applyAppState} onStatus={setStatus} />}
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

          {view === "knowledge" && <KnowledgeOrganizer state={state} onApplyState={applyAppState} onStatus={setStatus} />}

          {view === "analysis" && (
            <AnalysisPanel
              key={state.projectPath}
              state={state}
              onRegisterSave={registerPageSave}
              networkOpenRequest={networkOpenRequest}
              selectedChapterId={selectedChapter?.id || ""}
              onSelectChapter={(chapterId) => void selectChapter(chapterId)}
              onOpenSource={(result) => {
                if (result.sourceType === "chapter") void selectChapter(result.sourceId);
                if (result.sourceType === "character") void changeView("characters");
                if (result.sourceType === "world") void changeView("world");
              }}
              onExportBook={() => void exportBookDocx({ includeOutline: false, includeMaterials: false, includeCharacters: false, includeWorld: false })}
              onExportBookWithOptions={(options) => void exportBookDocx(options)}
              onApplyState={applyAppState}
              onStatus={setStatus}
            />
          )}
        </section>

        {!focusMode && <div className="pane-resizer" title="拖动调整右侧宽度" onMouseDown={(event) => startPaneResize("right", event)} />}

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
            onSend={(question, mode) => void sendChat(question, selectedText, mode)}
            onRetryWithSources={(question, sourceIds, mode) => void sendChat(question, "", mode, sourceIds)}
            onStop={() => void stopChatGeneration()}
            onClear={clearCurrentChat}
            onNewSession={createChatSession}
            onSwitchSession={switchChatSession}
            onProjectMemoryChange={updateProjectMemory}
            onQuick={(question) => void sendChat(question, question.includes("当前章节") ? chapterContent : selectedText, chatRetrievalMode)}
            onStatus={setStatus}
            expanded={aiExpanded}
            chatOpenRequest={aiChatOpenRequest}
            onToggleExpanded={() => setAiExpanded((value) => !value)}
            onOpenStoryCenter={() => void openStoryCenter()}
          />
        )}
      </main>

      <footer className="statusbar">
        <span className={`save-state ${dirty ? "is-dirty" : ""}`} role="status">{view === "chapters" ? saving ? "保存中..." : dirty ? "有未保存修改" : "已保存" : view === "characters" ? "角色卡 · 保存状态见当前表单" : view === "world" ? "世界观 · 保存状态见当前表单" : view === "analysis" ? "保存状态见当前面板" : "当前页操作即时保存"}</span>
        <span>当前章节：{currentWords.toLocaleString()} 字</span>
        <span>今日：{state.config.stats.todayWords.toLocaleString()} 字</span>
        <span>总字数：{state.config.stats.totalWords.toLocaleString()} 字</span>
        <span>知识库：{state.vectorStats.chunks} 片段</span>
        {state.vectorStats.recovery && <span className="index-recovery-note" role="status" title={state.vectorStats.recovery.message}>{state.vectorStats.recovery.status === "degraded" ? "索引需重建" : "索引已恢复"}</span>}
        <span>模型：{state.config.api.chatModel || "未配置"}</span>
        <button className="task-status-button" onClick={() => setShowTaskCenter(true)} title="查看后台任务">
          <ListChecks size={13} />
          任务 {backgroundTasks.filter((task) => ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status)).length}
        </button>
        {importProgress && (
          <span className="progress-pill">
            导入：{importProgress.current}/{importProgress.total || "?"} {importProgress.fileName || importProgress.phase}
            {importProgress.cancellable && (
              <button onClick={() => void window.novelAPI.cancelImport()} title="取消后会在当前文件处理完后停止">
                取消
              </button>
            )}
          </span>
        )}
        {indexProgress && (
          <span className="progress-pill">
            索引：{indexProgress.current}/{indexProgress.total || "?"} {indexProgress.detail || indexProgress.phase}
          </span>
        )}
        <strong>{status}</strong>
      </footer>

      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <div className="context-menu-note">{contextMenu.text.length} 字</div>
          <button onClick={() => void askSelectedText(contextMenu.text)}>
            <Wand2 size={15} />
            向 AI 提问
          </button>
          {(["改写", "润色", "扩写", "总结"] as const).map((action) => (
            <button key={action} onClick={() => void editSelectedText(action, contextMenu.text)}>
              <Sparkles size={15} />
              {action}
            </button>
          ))}
          <button
            onClick={() => void extractWorldCardsFromSelection(contextMenu.text)}
          >
            <Boxes size={15} />
            提取设定
          </button>
          <button onClick={() => openWorkspaceFromSelection("revisions", contextMenu.text)}>
            <Save size={15} />
            生成安全修订
          </button>
          <button onClick={() => openWorkspaceFromSelection("annotations", contextMenu.text)}>
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
            void exportBookDocx({ includeOutline: false, includeMaterials: false, includeCharacters: false, includeWorld: false });
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
          chapterRevision={chapterRevisionRef.current}
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
            setBackgroundTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
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

