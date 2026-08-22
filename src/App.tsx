import { marked } from "marked";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bot,
  Bold,
  BookOpen,
  Boxes,
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
  Heading1,
  Heading2,
  Heading3,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  ListTree,
  Maximize2,
  Minimize2,
  MessageSquarePlus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pilcrow,
  Plus,
  Quote,
  RefreshCcw,
  Redo2,
  Save,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Table2,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  Upload,
  UserRound,
  Wand2,
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
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type {
  AppState,
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
  ExtractedWorldCandidate,
  GlobalSearchResult,
  AppearanceStat,
  MaterialItem,
  ProgressState,
  Provider,
  KnowledgeItem,
  KnowledgeRole,
  RelationshipEdge,
  RelationshipNode,
  RetrievalMode,
  TimelineEvent,
  WorldDoc,
  WorldMapEdge,
  WorldMapNode,
} from "./types";

const PROVIDER_DEFAULTS: Record<Provider, { baseUrl: string; model: string; label: string }> = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  qwen: { label: "通义千问 / Qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  kimi: { label: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  claude: { label: "Claude", baseUrl: "https://api.anthropic.com", model: "claude-3-5-sonnet-latest" },
  ollama: { label: "Ollama 本地", baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b" },
  custom: { label: "自定义兼容接口", baseUrl: "https://api.example.com/v1", model: "model-name" },
};

const QUICK_PROMPTS = [
  "分析当前章节节奏，并指出哪里需要放慢或加速。",
  "检查已有内容里可能存在的时间线矛盾。",
  "根据当前剧情给出三条下一章续写建议。",
  "总结主要角色目前的目标、秘密和冲突。",
];

const MAX_CHAT_TOKENS = 393216;
const MAX_RETRIEVAL_TOP_K = 1000;
const MAX_RETRIEVAL_SCAN_K = 50000;
const DEFAULT_CATEGORY_LABEL = "未分类";
type AnalysisTab = "search" | "timeline" | "relations" | "consistency" | "versions" | "export";

const RETRIEVAL_MODE_OPTIONS: Array<{ value: RetrievalMode; label: string }> = [
  { value: "auto", label: "自动判断" },
  { value: "inventory", label: "资料盘点" },
  { value: "chapter", label: "指定章节" },
  { value: "entity", label: "角色/设定" },
  { value: "book", label: "全书分析" },
  { value: "current", label: "当前文档" },
  { value: "normal", label: "普通问答" },
];

const CREATIVE_ADVICE_MODES: Array<{ value: CreativeAdviceMode; label: string }> = [
  { value: "next", label: "下一章建议" },
  { value: "plot", label: "剧情推进" },
  { value: "foreshadow", label: "伏笔建议" },
];

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeCategoryLabel(value?: string) {
  return (value || "").replace(/\s+/g, " ").trim().slice(0, 40) || DEFAULT_CATEGORY_LABEL;
}

type CategoryGroup<T> = {
  key: string;
  category: string;
  items: T[];
  children: Array<CategoryGroup<T>>;
  count: number;
};

function splitCategoryPath(value?: string) {
  const category = normalizeCategoryLabel(value);
  const segments = category
    .split(/[\\/|｜>＞]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return segments.length ? segments : [DEFAULT_CATEGORY_LABEL];
}

function sortCategoryGroups<T extends { name?: string; title?: string }>(groups: Array<CategoryGroup<T>>) {
  groups.sort((a, b) => {
    if (a.category === DEFAULT_CATEGORY_LABEL && b.category !== DEFAULT_CATEGORY_LABEL) return 1;
    if (b.category === DEFAULT_CATEGORY_LABEL && a.category !== DEFAULT_CATEGORY_LABEL) return -1;
    return a.category.localeCompare(b.category, "zh-CN");
  });
  groups.forEach((group) => {
    group.items.sort((a, b) => (a.name || a.title || "").localeCompare(b.name || b.title || "", "zh-CN"));
    sortCategoryGroups(group.children);
    group.count = group.items.length + group.children.reduce((sum, child) => sum + child.count, 0);
  });
}

function groupByCategory<T extends { category?: string; name?: string; title?: string }>(items: T[]) {
  const roots: Array<CategoryGroup<T>> = [];
  items.forEach((item) => {
    const segments = splitCategoryPath(item.category);
    let siblings = roots;
    let current: CategoryGroup<T> | null = null;
    const pathParts: string[] = [];
    for (const segment of segments) {
      pathParts.push(segment);
      const key = pathParts.join("/");
      let group = siblings.find((candidate) => candidate.key === key);
      if (!group) {
        group = { key, category: segment, items: [], children: [], count: 0 };
        siblings.push(group);
      }
      current = group;
      siblings = group.children;
    }
    if (current) current.items.push(item);
  });
  sortCategoryGroups(roots);
  return roots;
}

function makeMessageId() {
  return `${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

function makeChatSession(title = "新会话", messages: ChatMessage[] = []): ChatSession {
  const now = new Date().toISOString();
  return {
    id: `chat_${makeMessageId()}`,
    title,
    messages,
    createdAt: now,
    updatedAt: now,
  };
}

function titleFromMessages(messages: ChatMessage[], fallback = "新会话") {
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim());
  const title = (firstUser?.content || fallback).replace(/\s+/g, " ").trim();
  return title.length > 18 ? `${title.slice(0, 18)}...` : title || fallback;
}

function compactChatMessages(messages: ChatMessage[]) {
  return messages.slice(-40).map((message) => ({
    ...message,
    content: message.content.slice(0, 6000),
    context: message.context?.slice(0, 6).map((chunk) => ({
      ...chunk,
      text: chunk.text.slice(0, 600),
    })),
  }));
}

function keepRecentChatSessions(sessions: ChatSession[], activeId: string) {
  const unique = new Map<string, ChatSession>();
  for (const session of sessions) {
    if (!session?.id) continue;
    unique.set(session.id, {
      ...session,
      title: session.title || titleFromMessages(session.messages || []),
      messages: compactChatMessages(session.messages || []),
      createdAt: session.createdAt || new Date().toISOString(),
      updatedAt: session.updatedAt || session.createdAt || new Date().toISOString(),
    });
  }
  const sorted = [...unique.values()].sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  return sorted.slice(0, 10);
}

function countWords(text: string) {
  const clean = contentToPlainText(text);
  const cjk = clean.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const words = clean.replace(/[\u4e00-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + words;
}

function isHtmlContent(content: string) {
  return /<\/?(h[1-6]|p|div|table|img|ul|ol|li|blockquote|section|details|summary|figure)\b/i.test(content || "");
}

function contentToHtml(content: string) {
  const html = isHtmlContent(content) ? content : (marked.parse(content || "") as string);
  return promoteMarkdownHeadingsInHtml(html);
}

function contentToPlainText(content: string) {
  const doc = new DOMParser().parseFromString(contentToHtml(content || ""), "text/html");
  return doc.body.textContent?.replace(/\s+/g, " ").trim() || "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRichTextIndex(editor: Editor) {
  const chars: string[] = [];
  const positions: Array<number | null> = [];
  let previousTextEnd = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    if (previousTextEnd >= 0 && pos > previousTextEnd) {
      chars.push("\n");
      positions.push(null);
    }
    for (let index = 0; index < node.text.length; index += 1) {
      chars.push(node.text[index]);
      positions.push(pos + index);
    }
    previousTextEnd = pos + node.text.length;
    return true;
  });
  return { text: chars.join(""), positions };
}

function textOffsetFromDocPos(positions: Array<number | null>, docPos: number) {
  const offset = positions.findIndex((position) => typeof position === "number" && position >= docPos);
  return offset < 0 ? positions.length : offset;
}

function scrollRichSelectionIntoView(editor: Editor, from: number) {
  window.requestAnimationFrame(() => {
    try {
      const shell = editor.view.dom.closest(".rich-page-shell") as HTMLElement | null;
      if (!shell) return;
      const coords = editor.view.coordsAtPos(from);
      const rect = shell.getBoundingClientRect();
      shell.scrollTop += coords.top - rect.top - shell.clientHeight * 0.4;
    } catch {
      editor.view.dom.scrollIntoView({ block: "nearest" });
    }
  });
}

function findNextInRichEditor(editor: Editor, query: string) {
  const index = buildRichTextIndex(editor);
  const needle = query.toLowerCase();
  const haystack = index.text.toLowerCase();
  const startOffset = textOffsetFromDocPos(index.positions, editor.state.selection.to);
  let found = haystack.indexOf(needle, startOffset);
  let wrapped = false;
  if (found < 0 && startOffset > 0) {
    found = haystack.indexOf(needle, 0);
    wrapped = true;
  }
  const from = index.positions[found];
  const last = index.positions[found + query.length - 1];
  if (found < 0 || typeof from !== "number" || typeof last !== "number") return { found: false, wrapped, selectedText: "" };
  const to = last + 1;
  editor.commands.setTextSelection({ from, to });
  editor.commands.focus();
  scrollRichSelectionIntoView(editor, from);
  return { found: true, wrapped, selectedText: index.text.slice(found, found + query.length) };
}

function replaceAllInRichEditor(editor: Editor, query: string, replacement: string) {
  const index = buildRichTextIndex(editor);
  const needle = query.toLowerCase();
  const haystack = index.text.toLowerCase();
  const matches: Array<{ from: number; to: number }> = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found < 0) break;
    const from = index.positions[found];
    const last = index.positions[found + query.length - 1];
    if (typeof from !== "number" || typeof last !== "number") {
      cursor = found + Math.max(1, query.length);
      continue;
    }
    matches.push({
      from,
      to: last + 1,
    });
    cursor = found + Math.max(1, query.length);
  }
  if (!matches.length) return 0;
  let transaction = editor.state.tr;
  for (const range of matches.slice().reverse()) {
    transaction = replacement ? transaction.insertText(replacement, range.from, range.to) : transaction.delete(range.from, range.to);
  }
  editor.view.dispatch(transaction);
  const first = matches[0];
  editor.commands.setTextSelection({ from: first.from, to: first.from + replacement.length });
  editor.commands.focus();
  scrollRichSelectionIntoView(editor, first.from);
  return matches.length;
}

function changeHeadingLevel(content: string, headingLineOrIndex: number, nextLevel: number) {
  const level = Math.min(6, Math.max(1, Math.floor(nextLevel)));
  if (isHtmlContent(content)) {
    const doc = new DOMParser().parseFromString(contentToHtml(content || ""), "text/html");
    const headings = Array.from(doc.body.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    const target = headings[headingLineOrIndex] as HTMLElement | undefined;
    if (!target) return content;
    const replacement = doc.createElement(`h${level}`);
    replacement.innerHTML = target.innerHTML;
    Array.from(target.attributes).forEach((attribute) => {
      if (attribute.name === "class" || attribute.name.startsWith("data-")) return;
      replacement.setAttribute(attribute.name, attribute.value);
    });
    target.replaceWith(replacement);
    return doc.body.innerHTML;
  }

  const lines = content.split(/\r?\n/);
  const line = lines[headingLineOrIndex];
  const match = line?.match(/^(#{1,6})(\s+)(.+?)\s*$/);
  if (!match) return content;
  lines[headingLineOrIndex] = `${"#".repeat(level)} ${match[3].trim()}`;
  return lines.join("\n");
}

function promoteMarkdownHeadingsInHtml(html: string) {
  const doc = new DOMParser().parseFromString(html || "<p></p>", "text/html");
  doc.body.querySelectorAll("p,div").forEach((element) => {
    if (element.querySelector("img,table,ul,ol,blockquote")) return;
    const text = element.textContent?.replace(/\s+/g, " ").trim() || "";
    const match = text.match(/^(#{1,6})\s+(.+)$/);
    if (!match) return;
    const heading = doc.createElement(`h${match[1].length}`);
    heading.textContent = match[2].trim();
    element.replaceWith(heading);
  });
  return doc.body.innerHTML;
}

function makeHeadingFoldKey(level: number, title: string, index: number) {
  return `${level}:${index}:${title.replace(/\s+/g, " ").trim().slice(0, 120)}`;
}

const CollapsibleHeadings = Extension.create<Record<string, never>, { folded: Set<string> }>({
  name: "collapsibleHeadings",

  addStorage() {
    return {
      folded: new Set<string>(),
    };
  },

  addProseMirrorPlugins() {
    const extension = this;
    return [
      new Plugin({
        key: new PluginKey("collapsibleHeadings"),
        props: {
          decorations(state) {
            const headings: Array<{ pos: number; size: number; level: number; key: string }> = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "heading") return true;
              const level = Number(node.attrs.level || 1);
              const key = makeHeadingFoldKey(level, node.textContent || "", headings.length);
              headings.push({ pos, size: node.nodeSize, level, key });
              return false;
            });

            if (!headings.length) return DecorationSet.empty;

            const ranges: Array<{ from: number; to: number; key: string }> = [];
            headings.forEach((heading, index) => {
              if (!extension.storage.folded.has(heading.key)) return;
              const nextPeer = headings.slice(index + 1).find((item) => item.level <= heading.level);
              const from = heading.pos + heading.size;
              const to = nextPeer ? nextPeer.pos : state.doc.content.size;
              if (to > from) ranges.push({ from, to, key: heading.key });
            });

            const isHidden = (pos: number) => ranges.some((range) => pos >= range.from && pos < range.to);
            const decorations = headings.flatMap((heading) => {
              if (isHidden(heading.pos)) return [];
              const folded = extension.storage.folded.has(heading.key);
              const button = Decoration.widget(
                heading.pos + 1,
                () => {
                  const element = document.createElement("button");
                  element.type = "button";
                  element.className = `heading-fold-button ${folded ? "folded" : ""}`;
                  element.dataset.foldKey = heading.key;
                  element.contentEditable = "false";
                  element.title = folded ? "展开这一节" : "折叠这一节";
                  element.textContent = folded ? "▸" : "▾";
                  return element;
                },
                { key: `fold-${heading.key}-${folded ? "closed" : "open"}`, side: -1 },
              );
              const stateClass = folded ? Decoration.node(heading.pos, heading.pos + heading.size, { class: "is-folded-heading" }) : null;
              return stateClass ? [stateClass, button] : [button];
            });

            state.doc.descendants((node, pos, parent) => {
              if (parent !== state.doc || !isHidden(pos)) return true;
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "is-folded-block" }, { key: `hidden-${pos}` }));
              return false;
            });

            return DecorationSet.create(state.doc, decorations);
          },
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;
              const button = target?.closest(".heading-fold-button") as HTMLButtonElement | null;
              if (!button) return false;
              event.preventDefault();
              const key = button.dataset.foldKey;
              if (!key) return true;
              if (extension.storage.folded.has(key)) {
                extension.storage.folded.delete(key);
              } else {
                extension.storage.folded.add(key);
              }
              view.dispatch(view.state.tr.setMeta("collapsibleHeadings", Date.now()));
              return true;
            },
          },
        },
      }),
    ];
  },
});

function sourceLabel(sourceType: string) {
  if (sourceType === "chapter") return "章节";
  if (sourceType === "character") return "角色";
  return "世界观";
}

function formatDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

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
  const [showSettings, setShowSettings] = useState(false);
  const [showQuickPanel, setShowQuickPanel] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [preview, setPreview] = useState(false);
  const [scrollAnchor, setScrollAnchor] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState("");
  const [aiProjectMemory, setAiProjectMemory] = useState("");
  const [chatRetrievalMode, setChatRetrievalMode] = useState<RetrievalMode>("auto");
  const [chatLoaded, setChatLoaded] = useState(false);
  const [draggingChapterId, setDraggingChapterId] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ProgressState | null>(null);
  const [indexProgress, setIndexProgress] = useState<ProgressState | null>(null);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(520);
  const [aiExpanded, setAiExpanded] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(46);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const richEditorRef = useRef<Editor | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const selectedChapterIdRef = useRef("");
  const chapterDraftRef = useRef({ content: "", title: "", volume: "" });

  const handleRichEditorReady = useCallback((editor: Editor | null) => {
    richEditorRef.current = editor;
  }, []);

  const applyAppState = useCallback((nextState: AppState) => {
    setState(nextState);
    setSelectedChapter(nextState.selectedChapter);
    setChapterContent(nextState.chapterContent);
    setChapterTitle(nextState.selectedChapter?.title ?? "");
    setChapterVolume(nextState.selectedChapter?.volume ?? "卷一");
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
    selectedChapterIdRef.current = selectedChapter?.id ?? "";
    chapterDraftRef.current = { content: chapterContent, title: chapterTitle, volume: chapterVolume };
  }, [chapterContent, chapterTitle, chapterVolume, selectedChapter?.id]);

  useEffect(() => {
    if (!state?.projectPath) return;
    setChatLoaded(false);
    window.novelAPI
      .getAnalysisState()
      .then((snapshot) => {
        const restored = keepRecentChatSessions(snapshot.chatSessions || [], snapshot.activeChatSessionId || "");
        const initialSessions = restored.length ? restored : [makeChatSession()];
        const activeId = initialSessions.some((session) => session.id === snapshot.activeChatSessionId) ? snapshot.activeChatSessionId || initialSessions[0].id : initialSessions[0].id;
        const active = initialSessions.find((session) => session.id === activeId) || initialSessions[0];
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

  const saveChapter = useCallback(async () => {
    if (!selectedChapter) {
      setStatus("请先选择一个文档再保存。");
      return false;
    }
    if (saving) {
      setStatus("当前文档正在保存，请稍候。");
      return false;
    }
    const draft = {
      chapterId: selectedChapter.id,
      title: chapterTitle,
      volume: chapterVolume,
      content: chapterContent,
    };
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
            }
          : current,
      );
      if (stillViewingSameChapter && draftUnchanged) {
        setDirty(false);
      }
      const mode = result.indexResult.chunks > 0 ? `索引 ${result.indexResult.chunks} 个片段` : "暂无可索引内容";
      setStatus(draftUnchanged ? `已保存，${mode}` : "已保存此前版本，当前还有新改动待保存");
      return stillViewingSameChapter && draftUnchanged;
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [chapterContent, chapterTitle, chapterVolume, saving, selectedChapter]);

  const saveBeforeLeavingChapter = useCallback(async () => {
    if (!dirty) return true;
    if (saving) {
      setStatus("当前章节正在保存，请等保存完成后再切换或执行其他操作。");
      return false;
    }
    return saveChapter();
  }, [dirty, saveChapter, saving]);

  useEffect(() => {
    if (!dirty || !state?.config.ui.autosaveMs) return;
    const timer = window.setTimeout(() => {
      void saveChapter();
    }, state.config.ui.autosaveMs);
    return () => window.clearTimeout(timer);
  }, [dirty, saveChapter, state?.config.ui.autosaveMs]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveChapter();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowQuickPanel(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveChapter]);

  const currentWords = useMemo(() => countWords(chapterContent), [chapterContent]);

  async function selectChapter(chapterId: string, line?: number) {
    if (!(await saveBeforeLeavingChapter())) return;
    try {
      const payload = await window.novelAPI.loadChapter(chapterId);
      setSelectedChapter(payload.chapter);
      setChapterContent(payload.content);
      setChapterTitle(payload.chapter?.title ?? "");
      setChapterVolume(payload.chapter?.volume ?? "卷一");
      setDirty(false);
      setView("chapters");
      if (typeof line === "number") {
        setScrollAnchor(`${Date.now()}_${line}`);
        window.requestAnimationFrame(() => {
          const editor = editorRef.current;
          if (!editor) return;
          const lines = payload.content.split(/\r?\n/);
          const position = lines.slice(0, line).join("\n").length + (line > 0 ? 1 : 0);
          editor.focus();
          editor.selectionStart = position;
          editor.selectionEnd = position + (lines[line]?.length || 0);
          const ratio = Math.max(0, line / Math.max(1, lines.length));
          editor.scrollTop = ratio * editor.scrollHeight;
        });
      }
    } catch (error) {
      setStatus(`打开文档失败：${getErrorMessage(error)}`);
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
      });
      setState((current) =>
        current
          ? {
              ...current,
              config: result.config,
              chapters: result.config.chapters,
              selectedChapter: chapterId === selectedChapter?.id ? result.chapter : current.selectedChapter,
              vectorStats: result.vectorStats,
            }
          : current,
      );
      if (chapterId === selectedChapter?.id) {
        setSelectedChapter(result.chapter);
        setChapterContent(nextContent);
        setChapterTitle(result.chapter.title);
        setChapterVolume(result.chapter.volume);
        setDirty(false);
      }
      setStatus(`已把标题调整为 ${nextLevel} 级，并同步更新知识库`);
    } catch (error) {
      setStatus(`调整目录等级失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function createProject() {
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

  async function exportBookDocx(options?: { includeOutline?: boolean; includeCharacters?: boolean; includeWorld?: boolean }) {
    if (!(await saveBeforeLeavingChapter())) return;
    setStatus("正在导出整本小说 Word 文档...");
    try {
      const result = await window.novelAPI.exportBookDocx(options);
      if (result.canceled) {
        setStatus("已取消导出整书");
        return;
      }
      if (result.filePath) setStatus(`整书 Word 文档已导出：${result.filePath}`);
      else setStatus("整书导出已结束，但没有收到保存位置。请重新选择导出路径。");
    } catch (error) {
      setStatus(`导出整书失败：${error instanceof Error ? error.message : String(error)}`);
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
      const result = await window.novelAPI.refreshChapterFromOriginal(selectedChapter.id);
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
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width || window.innerWidth;
    const editorBody = (event.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect();
    const initialPreview = previewWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      if (kind === "left") {
        setLeftWidth(Math.min(460, Math.max(210, initialLeft + delta)));
      }
      if (kind === "right") {
        setRightWidth(Math.min(860, Math.max(360, initialRight - delta)));
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
    setContextMenu({ x: event.clientX, y: event.clientY, text });
  }

  function openRichAskSelectionMenu(event: React.MouseEvent<HTMLElement>) {
    const text = window.getSelection()?.toString().trim() || "";
    setSelectedText(text);
    if (!text) return;
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, text });
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
    const session = chatSessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveChatSessionId(session.id);
    setChatMessages(session.messages || []);
    saveChatDraft(chatSessions, session.id);
  }

  function clearCurrentChat() {
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
      setView("analysis");
      setStatus(`已从选中文字提取 ${result.candidates.length} 个候选；请在分析页勾选后写入世界观`);
    } catch (error) {
      setStatus(`提取设定失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function updateChatRetrievalMode(mode: RetrievalMode) {
    setChatRetrievalMode(mode);
    if (chatLoaded) {
      void window.novelAPI.saveAnalysisState({ chatRetrievalMode: mode }).catch(() => null);
    }
  }

  async function sendChat(question: string, selection = selectedText, retrievalMode = chatRetrievalMode) {
    const trimmed = question.trim();
    if (!trimmed) return;
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
    updateCurrentChat(startedMessages);
    try {
      const response = await window.novelAPI.askAI({
        question: trimmed,
        selectedText: selection,
        history: historyMessages.map((item) => ({ role: item.role, content: item.content })),
        projectMemory: aiProjectMemory,
        retrievalMode,
        selectedChapterId: selectedChapter?.id || "",
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
          ? `检索已完成：${modeLabel}，扫描 ${scannedCount} 条，候选 ${candidateCount} 条，发送 ${contextCount} 条；本地向量回退：${response.embeddingWarning}`
          : `检索已完成：${modeLabel}，扫描 ${scannedCount} 条，候选 ${candidateCount} 条，发送 ${contextCount} 条`,
      );
    } catch (error) {
      updateCurrentChat(
        startedMessages.map((item) =>
          item.id === pendingId
            ? { ...item, content: `请求失败：${error instanceof Error ? error.message : String(error)}` }
            : item,
        ),
      );
    }
  }

  async function saveCharacter(card: Partial<CharacterCard>) {
    try {
      const next = await window.novelAPI.saveCharacter(card);
      applyAppState(next);
      setView("characters");
      setStatus(`角色卡片已保存：${card.name || "未命名角色"}`);
    } catch (error) {
      setStatus(`保存角色失败：${getErrorMessage(error)}`);
    }
  }

  async function deleteCharacter(characterId: string) {
    if (!window.confirm("确定删除这个角色卡片吗？")) return;
    try {
      const next = await window.novelAPI.deleteCharacter(characterId);
      applyAppState(next);
      setView("characters");
      setStatus("角色卡片已删除");
    } catch (error) {
      setStatus(`删除角色失败：${getErrorMessage(error)}`);
    }
  }

  async function generateCharactersFromOutline() {
    if (!window.confirm("将检索当前项目中的大纲和正文，并调用 AI 生成角色卡片。生成结果会直接写入“角色”界面；同名角色会更新。继续吗？")) return;
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
    try {
      const next = await window.novelAPI.saveWorldDoc(doc);
      applyAppState(next);
      setView("world");
      setStatus(`世界观条目已保存：${doc.title || "未命名设定"}`);
    } catch (error) {
      setStatus(`保存世界观失败：${getErrorMessage(error)}`);
    }
  }

  async function deleteWorldDoc(docId: string) {
    if (!window.confirm("确定删除这份世界观设定吗？")) return;
    try {
      const next = await window.novelAPI.deleteWorldDoc(docId);
      applyAppState(next);
      setView("world");
      setStatus("世界观条目已删除");
    } catch (error) {
      setStatus(`删除世界观失败：${getErrorMessage(error)}`);
    }
  }

  async function generateWorldFromOutline() {
    if (!window.confirm("将检索当前项目中的大纲和正文，并调用 AI 生成世界观条目。生成结果会直接写入“世界”界面；同名条目会更新。继续吗？")) return;
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

  async function extractWorldCardsFromOutline() {
    if (!window.confirm("将调用 AI 从大纲和正文中提取地点、势力、物品候选，提取后请在“分析 / 导出/提取”中勾选写入。继续吗？")) return;
    setStatus("正在从全书提取地点、势力、物品候选...");
    try {
      const result = await window.novelAPI.extractWorldCardsFromOutline({ scope: "book" });
      await window.novelAPI.saveAnalysisState({
        tab: "export",
        extractScope: "book",
        worldCandidates: result.candidates,
      });
      setView("analysis");
      setStatus(`已提取 ${result.candidates.length} 个候选；请在分析页勾选后写入世界观`);
    } catch (error) {
      setStatus(`提取候选失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  useEffect(() => {
    if (!state) return undefined;
    return window.novelAPI.onMenuAction((action) => {
      if (action === "newProject") void createProject();
      if (action === "openProject") void openProject();
      if (action === "importDocument") void importDocument();
      if (action === "exportChapterDocx") void exportChapterDocx();
      if (action === "exportBookDocx") void exportBookDocx();
      if (action === "exportBackup") void exportBackup();
      if (action === "saveChapter") void saveChapter();
      if (action === "rebuildIndex") void rebuildIndex();
      if (action === "showSettings") setShowSettings(true);
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
          <BookOpen size={20} />
          <span>{state.config.title}</span>
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
          <button onClick={() => void exportBookDocx({ includeOutline: false, includeCharacters: false, includeWorld: false })} title="只导出知识库中标为正文的文档">
            <BookOpen size={16} />
            导出正文
          </button>
          <button onClick={saveChapter} title="保存当前章节，快捷键 Ctrl+S">
            <Save size={16} />
            保存
          </button>
          <details className="top-more-actions">
            <summary title="更多项目功能">
              <ListTree size={16} />
              更多
            </summary>
            <div className="top-more-menu">
              <button onClick={() => setView("knowledge")} title="整理文档在知识库中的归属">
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
            </div>
          </details>
        </nav>
        <div className="top-actions">
          <button onClick={() => setShowQuickPanel(true)} title="功能面板 Ctrl+K">
            <ListTree size={18} />
          </button>
          <button onClick={() => setShowSettings(true)} title="模型和项目设置">
            <Settings size={18} />
          </button>
          <button
            onClick={() => void toggleTheme()}
            title="切换主题"
          >
            {state.config.ui.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button onClick={() => setFocusMode((value) => !value)} title="专注模式">
            {focusMode ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
      </header>

      <main
        className={`workspace ${aiExpanded ? "ai-expanded" : ""}`}
        ref={workspaceRef}
        style={{
          gridTemplateColumns: focusMode ? "minmax(520px, 1fr)" : `${leftWidth}px 6px minmax(380px, 1fr) 6px ${aiExpanded ? Math.max(rightWidth, 680) : rightWidth}px`,
        }}
      >
        {!focusMode && (
          <aside className="left-pane">
            <div className="pane-tabs">
              <button className={view === "chapters" ? "active" : ""} onClick={() => setView("chapters")}>
                <BookOpen size={16} /> 章节
              </button>
              <button className={view === "characters" ? "active" : ""} onClick={() => setView("characters")}>
                <UserRound size={16} /> 角色
              </button>
              <button className={view === "world" ? "active" : ""} onClick={() => setView("world")}>
                <Boxes size={16} /> 世界
              </button>
              <button className={view === "knowledge" ? "active" : ""} onClick={() => setView("knowledge")}>
                <ListTree size={16} /> 知识库
              </button>
              <button className={view === "analysis" ? "active" : ""} onClick={() => setView("analysis")}>
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
            <section className="editor-panel">
              <div className="editor-header">
                <input
                  className="title-input"
                  value={chapterTitle}
                  onChange={(event) => {
                    setChapterTitle(event.target.value);
                    setDirty(true);
                  }}
                />
                <input
                  className="volume-input"
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
                    value={chapterContent}
                    fontSize={state.config.ui.fontSize}
                    lineHeight={state.config.ui.lineHeight}
                    scrollAnchor={scrollAnchor}
                    onChange={(next) => {
                      setChapterContent(next);
                      setDirty(true);
                    }}
                    onSelection={captureSelection}
                    onContextMenu={openRichAskSelectionMenu}
                    onReady={handleRichEditorReady}
                  />
                )}
              </div>
            </section>
          )}

          {view === "characters" && (
            <CharacterManager
              cards={state.characters}
              onSave={(card) => void saveCharacter(card)}
              onDelete={(id) => void deleteCharacter(id)}
              onGenerate={() => void generateCharactersFromOutline()}
            />
          )}

          {view === "world" && (
            <WorldManager
              docs={state.worldDocs}
              onSave={(doc) => void saveWorldDoc(doc)}
              onDelete={(id) => void deleteWorldDoc(id)}
              onGenerate={() => void generateWorldFromOutline()}
            />
          )}

          {view === "knowledge" && <KnowledgeOrganizer state={state} onApplyState={applyAppState} onStatus={setStatus} />}

          {view === "analysis" && (
            <AnalysisPanel
              state={state}
              selectedChapterId={selectedChapter?.id || ""}
              onSelectChapter={(chapterId) => void selectChapter(chapterId)}
              onOpenSource={(result) => {
                if (result.sourceType === "chapter") void selectChapter(result.sourceId);
                if (result.sourceType === "character") setView("characters");
                if (result.sourceType === "world") setView("world");
              }}
              onExportBook={() => void exportBookDocx({ includeOutline: false, includeCharacters: false, includeWorld: false })}
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
            onRetrievalModeChange={updateChatRetrievalMode}
            onSend={(question, mode) => void sendChat(question, selectedText, mode)}
            onClear={clearCurrentChat}
            onNewSession={createChatSession}
            onSwitchSession={switchChatSession}
            onProjectMemoryChange={updateProjectMemory}
            onQuick={(question) => void sendChat(question, question.includes("当前章节") ? chapterContent : selectedText, chatRetrievalMode)}
            onStatus={setStatus}
            expanded={aiExpanded}
            onToggleExpanded={() => setAiExpanded((value) => !value)}
          />
        )}
      </main>

      <footer className="statusbar">
        <span>{saving ? "保存中..." : dirty ? "有未保存修改" : "已保存"}</span>
        <span>当前章节：{currentWords.toLocaleString()} 字</span>
        <span>今日：{state.config.stats.todayWords.toLocaleString()} 字</span>
        <span>总字数：{state.config.stats.totalWords.toLocaleString()} 字</span>
        <span>知识库：{state.vectorStats.chunks} 片段</span>
        <span>模型：{state.config.api.chatModel || "未配置"}</span>
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
            setView(nextView);
            setShowQuickPanel(false);
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
            void exportBookDocx({ includeOutline: false, includeCharacters: false, includeWorld: false });
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
            setShowSettings(true);
          }}
        />
      )}
    </div>
  );
}

function QuickPanelModal({
  state,
  currentView,
  onClose,
  onOpenView,
  onImport,
  onExportChapter,
  onExportBook,
  onBackup,
  onRebuildIndex,
  onSettings,
}: {
  state: AppState;
  currentView: "chapters" | "characters" | "world" | "knowledge" | "analysis";
  onClose: () => void;
  onOpenView: (view: "chapters" | "characters" | "world" | "knowledge" | "analysis") => void;
  onImport: () => void;
  onExportChapter: () => void;
  onExportBook: () => void;
  onBackup: () => void;
  onRebuildIndex: () => void;
  onSettings: () => void;
}) {
  const views = [
    { id: "chapters" as const, label: "章节", icon: <BookOpen size={18} />, count: state.chapters.length },
    { id: "characters" as const, label: "角色", icon: <UserRound size={18} />, count: state.characters.length },
    { id: "world" as const, label: "世界", icon: <Boxes size={18} />, count: state.worldDocs.length },
    { id: "knowledge" as const, label: "知识库", icon: <ListTree size={18} />, count: state.chapters.length },
    { id: "analysis" as const, label: "分析", icon: <Search size={18} />, count: state.vectorStats.chunks },
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="quick-panel-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <ListTree size={18} />
            <strong>功能面板</strong>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>
        <div className="quick-panel-grid">
          {views.map((item) => (
            <button key={item.id} className={currentView === item.id ? "active" : ""} onClick={() => onOpenView(item.id)}>
              {item.icon}
              <span>{item.label}</span>
              <small>{item.count.toLocaleString()}</small>
            </button>
          ))}
        </div>
        <div className="quick-panel-actions">
          <button onClick={onImport}>
            <Upload size={17} />
            导入文档
          </button>
          <button onClick={onExportChapter}>
            <FileDown size={17} />
            导出当前 DOCX
          </button>
          <button onClick={onExportBook}>
            <BookOpen size={17} />
            导出正文
          </button>
          <button onClick={onBackup}>
            <Download size={17} />
            备份
          </button>
          <button onClick={onRebuildIndex}>
            <RefreshCcw size={17} />
            重建索引
          </button>
          <button onClick={onSettings}>
            <Settings size={17} />
            设置
          </button>
        </div>
      </section>
    </div>
  );
}

function RichDocumentEditor({
  value,
  fontSize,
  lineHeight,
  scrollAnchor,
  onChange,
  onSelection,
  onContextMenu,
  onReady,
}: {
  value: string;
  fontSize: number;
  lineHeight: number;
  scrollAnchor: string;
  onChange: (value: string) => void;
  onSelection: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onReady?: (editor: Editor | null) => void;
}) {
  const lastHtmlRef = useRef("");
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
        Underline,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Image.configure({ allowBase64: true, inline: false }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        CollapsibleHeadings,
      ],
      content: contentToHtml(value || "<p></p>"),
      editorProps: {
        attributes: {
          class: "rich-document-page",
          spellcheck: "false",
        },
        handleDOMEvents: {
          mouseup() {
            window.setTimeout(onSelection, 0);
            return false;
          },
          keyup() {
            window.setTimeout(onSelection, 0);
            return false;
          },
        },
      },
      onUpdate({ editor }) {
        const next = editor.getHTML();
        lastHtmlRef.current = next;
        onChange(next);
      },
    },
    [],
  );

  useEffect(() => {
    onReady?.(editor);
    return () => onReady?.(null);
  }, [editor, onReady]);

  useEffect(() => {
    if (!editor) return;
    const next = contentToHtml(value || "<p></p>");
    if (lastHtmlRef.current === value || editor.getHTML() === next) return;
    editor.commands.setContent(next, { emitUpdate: false });
    lastHtmlRef.current = next;
  }, [editor, value]);

  useEffect(() => {
    if (!editor || !scrollAnchor) return;
    const [, index] = scrollAnchor.split("_");
    const headings = editor.view.dom.querySelectorAll("h1,h2,h3,h4,h5,h6");
    const target = headings[Number(index)] as HTMLElement | undefined;
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [editor, scrollAnchor]);

  return (
    <article className="rich-document-editor" onContextMenu={onContextMenu}>
      <RichEditorToolbar editor={editor} />
      <div className="rich-page-shell" style={{ fontSize: `${fontSize}px`, lineHeight }}>
        <EditorContent editor={editor} />
      </div>
    </article>
  );
}

function RichEditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="rich-editor-toolbar" />;
  const activeEditor: Editor = editor;
  const headingValue = activeEditor.isActive("heading", { level: 1 })
    ? "h1"
    : activeEditor.isActive("heading", { level: 2 })
      ? "h2"
      : activeEditor.isActive("heading", { level: 3 })
        ? "h3"
        : activeEditor.isActive("heading", { level: 4 })
          ? "h4"
          : activeEditor.isActive("heading", { level: 5 })
            ? "h5"
            : activeEditor.isActive("heading", { level: 6 })
              ? "h6"
              : "paragraph";

  function run(command: () => void) {
    return (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      command();
    };
  }

  function applyBlock(value: string) {
    if (value === "paragraph") {
      activeEditor.chain().focus().setParagraph().run();
      return;
    }
    const level = Number(value.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
    activeEditor.chain().focus().toggleHeading({ level }).run();
  }

  return (
    <div className="rich-editor-toolbar" contentEditable={false}>
      <select title="段落样式" value={headingValue} onChange={(event) => applyBlock(event.target.value)}>
        <option value="paragraph">正文</option>
        <option value="h1">标题 1</option>
        <option value="h2">标题 2</option>
        <option value="h3">标题 3</option>
        <option value="h4">标题 4</option>
        <option value="h5">标题 5</option>
        <option value="h6">标题 6</option>
      </select>
      <button title="正文" className={headingValue === "paragraph" ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().setParagraph().run())}>
        <Pilcrow size={16} />
      </button>
      <button title="标题 1" className={activeEditor.isActive("heading", { level: 1 }) ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().toggleHeading({ level: 1 }).run())}>
        <Heading1 size={17} />
      </button>
      <button title="标题 2" className={activeEditor.isActive("heading", { level: 2 }) ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().toggleHeading({ level: 2 }).run())}>
        <Heading2 size={17} />
      </button>
      <button title="标题 3" className={activeEditor.isActive("heading", { level: 3 }) ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().toggleHeading({ level: 3 }).run())}>
        <Heading3 size={17} />
      </button>
      <span className="toolbar-divider" />
      <button title="粗体" className={activeEditor.isActive("bold") ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().toggleBold().run())}>
        <Bold size={17} />
      </button>
      <button title="斜体" className={activeEditor.isActive("italic") ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().toggleItalic().run())}>
        <Italic size={17} />
      </button>
      <button title="下划线" className={activeEditor.isActive("underline") ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().toggleUnderline().run())}>
        <UnderlineIcon size={17} />
      </button>
      <button title="引用" className={activeEditor.isActive("blockquote") ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().toggleBlockquote().run())}>
        <Quote size={17} />
      </button>
      <span className="toolbar-divider" />
      <button title="项目列表" className={activeEditor.isActive("bulletList") ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().toggleBulletList().run())}>
        <List size={17} />
      </button>
      <button title="编号列表" className={activeEditor.isActive("orderedList") ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().toggleOrderedList().run())}>
        <ListOrdered size={17} />
      </button>
      <button title="左对齐" className={activeEditor.isActive({ textAlign: "left" }) ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().setTextAlign("left").run())}>
        <AlignLeft size={17} />
      </button>
      <button title="居中" className={activeEditor.isActive({ textAlign: "center" }) ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().setTextAlign("center").run())}>
        <AlignCenter size={17} />
      </button>
      <button title="右对齐" className={activeEditor.isActive({ textAlign: "right" }) ? "active" : ""} onMouseDown={run(() => activeEditor.chain().focus().setTextAlign("right").run())}>
        <AlignRight size={17} />
      </button>
      <span className="toolbar-divider" />
      <button title="插入表格" onMouseDown={run(() => activeEditor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>
        <Table2 size={17} />
      </button>
      {activeEditor.isActive("table") && (
        <>
          <button title="增加一行" onMouseDown={run(() => activeEditor.chain().focus().addRowAfter().run())}>
            行+
          </button>
          <button title="增加一列" onMouseDown={run(() => activeEditor.chain().focus().addColumnAfter().run())}>
            列+
          </button>
          <button title="删除表格" onMouseDown={run(() => activeEditor.chain().focus().deleteTable().run())}>
            删表
          </button>
        </>
      )}
      <span className="toolbar-divider" />
      <button title="撤销" disabled={!activeEditor.can().chain().focus().undo().run()} onMouseDown={run(() => activeEditor.chain().focus().undo().run())}>
        <Undo2 size={17} />
      </button>
      <button title="重做" disabled={!activeEditor.can().chain().focus().redo().run()} onMouseDown={run(() => activeEditor.chain().focus().redo().run())}>
        <Redo2 size={17} />
      </button>
    </div>
  );
}

type OutlineItem = NonNullable<Chapter["outline"]>[number];
type OutlineTreeNode = OutlineItem & {
  key: string;
  children: OutlineTreeNode[];
};

function buildOutlineTree(items: OutlineItem[], chapterId: string) {
  const roots: OutlineTreeNode[] = [];
  const stack: Array<{ level: number; children: OutlineTreeNode[] }> = [{ level: 0, children: roots }];

  items.forEach((item, index) => {
    const node: OutlineTreeNode = {
      ...item,
      key: `${chapterId}:${item.line}:${index}:${item.title}`,
      children: [],
    };
    while (stack.length > 1 && stack[stack.length - 1].level >= item.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push({ level: item.level, children: node.children });
  });

  return roots;
}

function flattenOutlineKeys(node: OutlineTreeNode): string[] {
  return [node.key, ...node.children.flatMap((child) => flattenOutlineKeys(child))];
}

function ChapterTree({
  projectPath,
  chapters,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
  onDragStart,
  onDragEnd,
  onDropToVolume,
  onDropOnChapter,
  onImportToVolume,
  onAdjustLevel,
}: {
  projectPath: string;
  chapters: Chapter[];
  selectedId: string;
  onSelect: (id: string, line?: number) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropToVolume: (volume: string) => void;
  onDropOnChapter: (chapter: Chapter) => void;
  onImportToVolume: (volume: string) => void;
  onAdjustLevel: (chapterId: string, line: number, level: number, delta: number) => void;
}) {
  const [collapsedVolumes, setCollapsedVolumes] = useState<Set<string>>(() => new Set());
  const [collapsedChapters, setCollapsedChapters] = useState<Set<string>>(() => new Set());
  const [collapsedHeadings, setCollapsedHeadings] = useState<Set<string>>(() => new Set());
  const [collapseStateLoaded, setCollapseStateLoaded] = useState(false);
  const [dragOverVolume, setDragOverVolume] = useState("");
  const [dragHint, setDragHint] = useState("");
  const previousChapterIdsRef = useRef<Set<string>>(new Set());
  const collapseStorageKey = useMemo(() => `ai-novel.chapter-tree.${projectPath}`, [projectPath]);
  const allChapterIds = useMemo(() => chapters.map((chapter) => chapter.id), [chapters]);
  const allHeadingKeys = useMemo(
    () => chapters.flatMap((chapter) => buildOutlineTree((chapter.outline || []).slice(1), chapter.id).flatMap((node) => flattenOutlineKeys(node))),
    [chapters],
  );
  const grouped = useMemo(() => {
    const map = new Map<string, Chapter[]>();
    for (const chapter of chapters) {
      const key = chapter.volume || "未分卷";
      map.set(key, [...(map.get(key) || []), chapter]);
    }
    return [...map.entries()];
  }, [chapters]);

  useEffect(() => {
    setCollapseStateLoaded(false);
    try {
      const saved = window.localStorage.getItem(collapseStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { volumes?: string[]; chapters?: string[]; headings?: string[] };
        setCollapsedVolumes(new Set(parsed.volumes || []));
        setCollapsedChapters(new Set(parsed.chapters || []));
        setCollapsedHeadings(new Set(parsed.headings || []));
      } else {
        setCollapsedVolumes(new Set());
        setCollapsedChapters(new Set(allChapterIds));
        setCollapsedHeadings(new Set(allHeadingKeys));
      }
      previousChapterIdsRef.current = new Set(allChapterIds);
    } catch {
      setCollapsedVolumes(new Set());
      setCollapsedChapters(new Set(allChapterIds));
      setCollapsedHeadings(new Set(allHeadingKeys));
      previousChapterIdsRef.current = new Set(allChapterIds);
    } finally {
      setCollapseStateLoaded(true);
    }
  }, [collapseStorageKey]);

  useEffect(() => {
    if (!collapseStateLoaded) return;
    const previousIds = previousChapterIdsRef.current;
    const newIds = allChapterIds.filter((id) => !previousIds.has(id));
    setCollapsedChapters((current) => {
      const known = new Set(allChapterIds);
      const next = new Set([...current].filter((id) => known.has(id)));
      for (const id of newIds) next.add(id);
      return next;
    });
    previousChapterIdsRef.current = new Set(allChapterIds);
  }, [allChapterIds, collapseStateLoaded]);

  useEffect(() => {
    if (!collapseStateLoaded) return;
    try {
      window.localStorage.setItem(
        collapseStorageKey,
        JSON.stringify({
          volumes: [...collapsedVolumes],
          chapters: [...collapsedChapters],
          headings: [...collapsedHeadings],
        }),
      );
    } catch {
      // 忽略本机存储不可用的情况，目录树仍可正常手动折叠。
    }
  }, [collapseStorageKey, collapseStateLoaded, collapsedVolumes, collapsedChapters, collapsedHeadings]);

  function toggleSet(setter: (updater: (current: Set<string>) => Set<string>) => void, key: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function collapseOrExpandAll() {
    const allCollapsed = chapters.length > 0 && collapsedChapters.size >= chapters.length;
    setCollapsedChapters(allCollapsed ? new Set() : new Set(allChapterIds));
    setCollapsedHeadings(allCollapsed ? new Set() : new Set(allHeadingKeys));
  }

  function renderOutlineNode(chapter: Chapter, node: OutlineTreeNode) {
    const hasChildren = node.children.length > 0;
    const collapsed = collapsedHeadings.has(node.key);
    return (
      <div className="outline-branch" key={node.key}>
        <div
          className="outline-row"
          style={{ paddingLeft: `${Math.min(70, Math.max(0, (node.level - 1) * 14))}px` }}
          title={`${node.title}（${node.level} 级标题）`}
          onClick={() => onSelect(chapter.id, node.line)}
        >
          {hasChildren ? (
            <button
              className="tree-toggle"
              title={collapsed ? "展开小标题" : "折叠小标题"}
              onClick={(event) => {
                event.stopPropagation();
                toggleSet(setCollapsedHeadings, node.key);
              }}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          ) : (
            <span className="tree-toggle-spacer" />
          )}
          <span className="outline-title">{node.title}</span>
          <span className="outline-level">H{node.level}</span>
          <div className="outline-actions">
            <button
              title="升级标题"
              disabled={node.level <= 1}
              onClick={(event) => {
                event.stopPropagation();
                onAdjustLevel(chapter.id, node.line, node.level, -1);
              }}
            >
              <IndentDecrease size={13} />
            </button>
            <button
              title="降级标题"
              disabled={node.level >= 6}
              onClick={(event) => {
                event.stopPropagation();
                onAdjustLevel(chapter.id, node.line, node.level, 1);
              }}
            >
              <IndentIncrease size={13} />
            </button>
          </div>
        </div>
        {hasChildren && !collapsed && <div className="outline-children">{node.children.map((child) => renderOutlineNode(chapter, child))}</div>}
      </div>
    );
  }

  return (
    <div className="chapter-tree">
      <div className="section-heading">
        <span>目录树</span>
        <div className="section-heading-actions">
          <button title="折叠/展开所有文档" onClick={collapseOrExpandAll}>
            <ListTree size={16} />
          </button>
          <button title="新建章节" onClick={onCreate}>
            <Plus size={16} />
          </button>
        </div>
      </div>
      {dragHint && <div className="drag-hint">{dragHint}</div>}
      {grouped.map(([volume, items]) => (
        <div className="volume" key={volume}>
          <div
            className={`volume-header ${dragOverVolume === volume ? "drag-over" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverVolume(volume);
              setDragHint(`将移动到「${volume}」分组末尾，保持文档层级`);
            }}
            onDragLeave={() => {
              setDragOverVolume((current) => (current === volume ? "" : current));
              setDragHint("");
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOverVolume("");
              setDragHint("");
              onDropToVolume(volume);
            }}
          >
            <button className="volume-title" onClick={() => toggleSet(setCollapsedVolumes, volume)} title={collapsedVolumes.has(volume) ? "展开分组" : "折叠分组"}>
              {collapsedVolumes.has(volume) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              <span>{volume}</span>
            </button>
            <button
              className="volume-import-button"
              title={`导入文档到「${volume}」`}
              onClick={(event) => {
                event.stopPropagation();
                onImportToVolume(volume);
              }}
            >
              <Upload size={14} />
            </button>
          </div>
          {!collapsedVolumes.has(volume) &&
            items.map((chapter) => {
              const outlineTree = buildOutlineTree((chapter.outline || []).slice(1), chapter.id);
              const chapterCollapsed = collapsedChapters.has(chapter.id);
              return (
                <div className="chapter-node" key={chapter.id}>
                  <div
                    className={`chapter-item ${selectedId === chapter.id ? "active" : ""}`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", chapter.id);
                      onDragStart(chapter.id);
                    }}
                    onDragEnd={() => {
                      setDragHint("");
                      onDragEnd();
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragHint(`将移动到《${chapter.title}》前面，并归入「${chapter.volume || "未分卷"}」`);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDragHint("");
                      onDropOnChapter(chapter);
                    }}
                    onClick={() => onSelect(chapter.id)}
                  >
                    {outlineTree.length > 0 ? (
                      <button
                        className="tree-toggle"
                        title={chapterCollapsed ? "展开文档目录" : "折叠文档目录"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSet(setCollapsedChapters, chapter.id);
                        }}
                      >
                        {chapterCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                      </button>
                    ) : (
                      <span className="tree-toggle-spacer" />
                    )}
                    <span>{chapter.title}</span>
                    <small>{chapter.wordCount.toLocaleString()}</small>
                    <button
                      className="tree-icon-button danger-icon"
                      title="删除文档"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(chapter.id);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {!chapterCollapsed && outlineTree.length > 0 && <div className="outline-tree">{outlineTree.map((node) => renderOutlineNode(chapter, node))}</div>}
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}

function SidebarCreativeAdvisor({
  state,
  selectedChapterId,
  onStatus,
}: {
  state: AppState;
  selectedChapterId: string;
  onStatus: (message: string) => void;
}) {
  const [creativeMode, setCreativeMode] = useState<CreativeAdviceMode>("next");
  const [creativeFocus, setCreativeFocus] = useState("");
  const [creativeAdvice, setCreativeAdvice] = useState<CreativeAdviceResult | null>(null);
  const [advisorChapterId, setAdvisorChapterId] = useState(selectedChapterId || state.chapters[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const previousSelectedRef = useRef(selectedChapterId);
  const advisorChapter = state.chapters.find((chapter) => chapter.id === advisorChapterId) || state.chapters.find((chapter) => chapter.id === selectedChapterId) || state.chapters[0];

  useEffect(() => {
    window.novelAPI
      .getAnalysisState()
      .then((snapshot) => {
        if (snapshot.creativeAdvice) setCreativeAdvice(snapshot.creativeAdvice);
        if (snapshot.creativeOptions?.mode) setCreativeMode(snapshot.creativeOptions.mode);
        if (typeof snapshot.creativeOptions?.focus === "string") setCreativeFocus(snapshot.creativeOptions.focus);
        if (snapshot.creativeOptions?.chapterId && state.chapters.some((chapter) => chapter.id === snapshot.creativeOptions?.chapterId)) {
          setAdvisorChapterId(snapshot.creativeOptions.chapterId);
        } else {
          setAdvisorChapterId(selectedChapterId || state.chapters[0]?.id || "");
        }
      })
      .catch(() => null);
  }, [state.projectPath]);

  useEffect(() => {
    setAdvisorChapterId((current) => {
      const exists = current && state.chapters.some((chapter) => chapter.id === current);
      const shouldFollowCurrent = !current || current === previousSelectedRef.current || !exists;
      return shouldFollowCurrent ? selectedChapterId || state.chapters[0]?.id || "" : current;
    });
    previousSelectedRef.current = selectedChapterId;
  }, [selectedChapterId, state.chapters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void window.novelAPI
        .saveAnalysisState({
          creativeAdvice: creativeAdvice || undefined,
          creativeOptions: { mode: creativeMode, chapterId: advisorChapter?.id || advisorChapterId, focus: creativeFocus },
        })
        .catch(() => null);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [advisorChapter?.id, advisorChapterId, creativeAdvice, creativeFocus, creativeMode]);

  async function runCreativeAdvice(mode = creativeMode) {
    const targetChapterId = advisorChapter?.id || selectedChapterId;
    if (!targetChapterId) {
      onStatus("请先选择一个章节或大纲文档。");
      return;
    }
    setCreativeMode(mode);
    setBusy(true);
    onStatus("创作参谋正在整理建议...");
    try {
      const result = await window.novelAPI.getCreativeAdvice({ mode, chapterId: targetChapterId, focus: creativeFocus });
      setCreativeAdvice(result);
      setAdvisorChapterId(result.chapterId);
      onStatus(result.apiError ? `已显示本地兜底建议：${result.apiError}` : `创作参谋已生成 ${result.items.length} 条建议`);
    } catch (error) {
      onStatus(`生成创作建议失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveAdviceAsMaterial(item: CreativeAdviceItem) {
    const section = (title: string, value: string | string[]) => {
      const content = Array.isArray(value) ? value.filter(Boolean).map((entry) => `- ${entry}`).join("\n") : value;
      return content ? `\n\n## ${title}\n${content}` : "";
    };
    const content = `# ${item.title}

类型：${item.type}
优先级：${item.priority}
目标文档：${item.targetChapter || creativeAdvice?.chapterTitle || advisorChapter?.title || "未指定"}
生成时间：${creativeAdvice?.generatedAt ? formatDateTime(creativeAdvice.generatedAt) : formatDateTime(new Date().toISOString())}

## 建议
${item.summary}${section("为什么适合", item.rationale)}${section("收益", item.benefits)}${section("风险", item.risks)}${section("相关角色", item.relatedCharacters)}${section("相关设定", item.relatedSettings)}${section("使用方式", item.suggestedUse)}`;
    try {
      await window.novelAPI.saveMaterial({ title: item.title, category: `创作参谋/${item.type}`, content });
      onStatus(`已保存为素材：${item.title}`);
    } catch (error) {
      onStatus(`保存素材失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div className="ai-advisor-panel">
      <div className="advisor-controls">
        <div className="advisor-mode-row">
          {CREATIVE_ADVICE_MODES.map((mode) => (
            <button key={mode.value} className={creativeMode === mode.value ? "active" : ""} onClick={() => setCreativeMode(mode.value)}>
              {mode.label}
            </button>
          ))}
        </div>
        <div className="advisor-form-grid">
          <label>
            <span>参考文档</span>
            <select value={advisorChapter?.id || ""} onChange={(event) => setAdvisorChapterId(event.target.value)}>
              {state.chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.volume || "未分卷"} / {chapter.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>当前关注</span>
            <textarea
              value={creativeFocus}
              onChange={(event) => setCreativeFocus(event.target.value)}
              placeholder="比如：下一章事件、人物动机、节奏、伏笔回收"
            />
          </label>
        </div>
        <div className="analysis-actions advisor-actions">
          <button onClick={() => void runCreativeAdvice()} disabled={busy}>
            <Sparkles size={16} />
            生成
          </button>
          <button onClick={() => void runCreativeAdvice("next")} disabled={busy}>
            下一章
          </button>
          <button onClick={() => void runCreativeAdvice("plot")} disabled={busy}>
            推剧情
          </button>
          <button onClick={() => void runCreativeAdvice("foreshadow")} disabled={busy}>
            伏笔
          </button>
        </div>
      </div>

      {creativeAdvice ? (
        <>
          <div className="advisor-result-meta">
            <strong>{creativeAdvice.chapterTitle}</strong>
            <span>
              {CREATIVE_ADVICE_MODES.find((mode) => mode.value === creativeAdvice.mode)?.label || "创作建议"} / {creativeAdvice.contextCount} 片段
            </span>
          </div>
          {creativeAdvice.apiError && <div className="advisor-notice">AI 接口暂时不可用，下面显示本地兜底建议。</div>}
          <div className="advisor-card-grid">
            {creativeAdvice.items.map((item) => (
              <article key={item.id} className={`advisor-card priority-${item.priority}`}>
                <header>
                  <div>
                    <small>{item.type} / {item.priority}</small>
                    <strong>{item.title}</strong>
                  </div>
                  <button onClick={() => void saveAdviceAsMaterial(item)}>存素材</button>
                </header>
                <p>{item.summary}</p>
                {item.rationale && (
                  <section>
                    <strong>理由</strong>
                    <p>{item.rationale}</p>
                  </section>
                )}
                {(!!item.benefits.length || !!item.risks.length) && (
                  <div className="advisor-columns">
                    {!!item.benefits.length && (
                      <section>
                        <strong>收益</strong>
                        {item.benefits.map((text) => (
                          <span key={text}>{text}</span>
                        ))}
                      </section>
                    )}
                    {!!item.risks.length && (
                      <section>
                        <strong>注意</strong>
                        {item.risks.map((text) => (
                          <span key={text}>{text}</span>
                        ))}
                      </section>
                    )}
                  </div>
                )}
                {(!!item.relatedCharacters.length || !!item.relatedSettings.length || item.targetChapter) && (
                  <div className="advisor-tags">
                    {item.targetChapter && <span>{item.targetChapter}</span>}
                    {item.relatedCharacters.map((name) => (
                      <span key={`character_${name}`}>{name}</span>
                    ))}
                    {item.relatedSettings.map((name) => (
                      <span key={`setting_${name}`}>{name}</span>
                    ))}
                  </div>
                )}
                {item.suggestedUse && <em>{item.suggestedUse}</em>}
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="analysis-empty">这里会按当前章节给出下一章、剧情推进和伏笔建议。</div>
      )}
    </div>
  );
}

function ChatPanel({
  state,
  selectedChapterId,
  messages,
  sessions,
  activeSessionId,
  projectMemory,
  retrievalMode,
  selectedText,
  onSend,
  onRetrievalModeChange,
  onClear,
  onNewSession,
  onSwitchSession,
  onProjectMemoryChange,
  onQuick,
  onStatus,
  expanded,
  onToggleExpanded,
}: {
  state: AppState;
  selectedChapterId: string;
  messages: ChatMessage[];
  sessions: ChatSession[];
  activeSessionId: string;
  projectMemory: string;
  retrievalMode: RetrievalMode;
  selectedText: string;
  onSend: (question: string, retrievalMode: RetrievalMode) => void;
  onRetrievalModeChange: (mode: RetrievalMode) => void;
  onClear: () => void;
  onNewSession: () => void;
  onSwitchSession: (sessionId: string) => void;
  onProjectMemoryChange: (value: string) => void;
  onQuick: (question: string) => void;
  onStatus: (message: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const [input, setInput] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [assistantTab, setAssistantTab] = useState<"chat" | "advisor">("chat");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function submit() {
    const value = input.trim();
    if (!value) {
      onStatus("请先输入要问 AI 的内容。");
      return;
    }
    onSend(value, retrievalMode);
    setInput("");
  }

  function copyMessageAsBody(message: ChatMessage) {
    const text = message.content
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/^\s*[-*]\s+/gm, "• ");
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedMessageId(message.id);
        onStatus("已复制为普通正文，不会自动变成标题格式");
        window.setTimeout(() => setCopiedMessageId((current) => (current === message.id ? "" : current)), 1600);
      })
      .catch((error) => onStatus(`复制失败：${getErrorMessage(error)}`));
  }

  function formatCategoryCounts(counts?: Record<string, number>) {
    return Object.entries(counts || {})
      .map(([name, count]) => `${name} ${count}`)
      .join("；");
  }

  return (
    <aside className={`right-pane ${expanded ? "expanded" : ""}`}>
      <div className="chat-header">
        <div>
          <Bot size={18} />
          <span>AI 助手</span>
        </div>
        <div className="chat-header-actions">
          <button title={expanded ? "收起 AI 阅读区" : "展开 AI 阅读区"} onClick={onToggleExpanded}>
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button title="清空当前对话" onClick={onClear}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="assistant-tabs">
        <button className={assistantTab === "chat" ? "active" : ""} onClick={() => setAssistantTab("chat")}>
          <MessageSquarePlus size={15} />
          对话
        </button>
        <button className={assistantTab === "advisor" ? "active" : ""} onClick={() => setAssistantTab("advisor")}>
          <Sparkles size={15} />
          创作参谋
        </button>
      </div>

      {assistantTab === "chat" ? (
        <div className="chat-stack">
          <div className="chat-session-bar">
            <select value={activeSessionId} onChange={(event) => onSwitchSession(event.target.value)} title="切换 AI 会话">
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title || "新会话"} · {formatDateTime(session.updatedAt)}
                </option>
              ))}
            </select>
            <button onClick={onNewSession} title="新建 AI 会话">
              新会话
            </button>
          </div>

          <details className="chat-memory-box">
            <summary>项目 AI 记忆</summary>
            <textarea
              value={projectMemory}
              maxLength={3000}
              onChange={(event) => onProjectMemoryChange(event.target.value)}
              placeholder="写下需要跨会话保留的项目内背景、偏好或已确认结论。建议简短，越短越省 token。"
            />
            <small>{projectMemory.length}/3000 字</small>
          </details>

          <div className="retrieval-mode-bar">
            <label>
              <span>检索模式</span>
              <select value={retrievalMode} onChange={(event) => onRetrievalModeChange(event.target.value as RetrievalMode)} title="默认自动判断，必要时可手动指定">
                {RETRIEVAL_MODE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <details className="quick-prompts-box">
            <summary>常用提问</summary>
            <div className="quick-prompts">
              {QUICK_PROMPTS.map((prompt) => (
                <button key={prompt} onClick={() => onQuick(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </details>

          <div className="selected-note">{selectedText ? `已选中 ${selectedText.length} 字，可随问题发送。` : "选中正文后右键可向 AI 提问。"}</div>

          <div className="messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="empty-chat">
                <Sparkles size={22} />
                <p>提问时会先检索当前小说知识库，再把相关片段交给模型接口。</p>
              </div>
            )}
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                {message.role === "assistant" && (
                  <div className="message-actions">
                    <button title="复制为普通正文" onClick={() => copyMessageAsBody(message)}>
                      <Copy size={14} />
                      {copiedMessageId === message.id ? "已复制" : "复制正文"}
                    </button>
                  </div>
                )}
                <p>{message.content}</p>
                {message.retrieval && (
                  <details className="retrieval-diagnostics">
                    <summary>
                      检索：{message.retrieval.modeLabel} / 扫描 {message.retrieval.scannedCount} / 候选 {message.retrieval.candidateCount} / 发送 {message.retrieval.contextCount}
                    </summary>
                    <div className="retrieval-grid">
                      <span>请求模式：{RETRIEVAL_MODE_OPTIONS.find((item) => item.value === message.retrieval?.requestedMode)?.label || message.retrieval.requestedMode}</span>
                      <span>扫描上限：{message.retrieval.scanLimit}</span>
                      <span>发送上限：{message.retrieval.sendLimit}</span>
                      <span>命中文档：{message.retrieval.documentCount}</span>
                      <span>目录兜底：{message.retrieval.catalogUsed ? "已使用" : "未使用"}</span>
                      <span>分类占比：{formatCategoryCounts(message.retrieval.categoryCounts) || "无"}</span>
                    </div>
                    {message.retrieval.notes.length > 0 && <p className="retrieval-note">{message.retrieval.notes.join("；")}</p>}
                    {message.retrieval.includedTitles.length > 0 && (
                      <div className="retrieval-list">
                        <strong>本次读取</strong>
                        <span>{message.retrieval.includedTitles.slice(0, 36).join("；")}</span>
                      </div>
                    )}
                    {message.retrieval.existingButNotRead.length > 0 && (
                      <div className="retrieval-list">
                        <strong>目录存在但未读原文</strong>
                        <span>{message.retrieval.existingButNotRead.slice(0, 36).join("；")}</span>
                      </div>
                    )}
                  </details>
                )}
                {message.context && message.context.length > 0 && (
                  <details>
                    <summary>引用片段 {message.context.length}</summary>
                    {message.context.map((chunk) => (
                      <div className="context-card" key={chunk.id}>
                        <strong>
                          {sourceLabel(chunk.sourceType)} · {chunk.title}
                        </strong>
                        <small>相关度 {chunk.score.toFixed(3)}</small>
                        <p>{chunk.text}</p>
                      </div>
                    ))}
                  </details>
                )}
              </article>
            ))}
          </div>

          <div className="chat-input">
            <textarea
              value={input}
              placeholder="问 AI..."
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit();
              }}
            />
            <button title="发送" onClick={submit}>
              <Send size={18} />
            </button>
          </div>
        </div>
      ) : (
        <SidebarCreativeAdvisor state={state} selectedChapterId={selectedChapterId} onStatus={onStatus} />
      )}
    </aside>
  );
}

function KnowledgeOrganizer({
  state,
  onApplyState,
  onStatus,
}: {
  state: AppState;
  onApplyState: (state: AppState) => void;
  onStatus: (message: string) => void;
}) {
  const [items, setItems] = useState<KnowledgeItem[]>(() =>
    state.chapters.map((chapter) => ({
      id: chapter.id,
      sourceId: chapter.id,
      sourceType: "chapter",
      title: chapter.title,
      volume: chapter.volume || "未分卷",
      knowledgeRole: chapter.knowledgeRole || "正文",
      order: chapter.order,
      wordCount: chapter.wordCount,
      updatedAt: chapter.updatedAt,
    })),
  );
  const [filter, setFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<KnowledgeRole | "全部">("全部");
  const [saving, setSaving] = useState(false);
  const volumes = useMemo(() => [...new Set(items.map((item) => item.volume || "未分卷"))].sort((a, b) => a.localeCompare(b, "zh-CN")), [items]);
  const visibleItems = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    return items.filter((item) => {
      const roleMatched = roleFilter === "全部" || item.knowledgeRole === roleFilter;
      const keywordMatched = !keyword || item.title.toLowerCase().includes(keyword) || item.volume.toLowerCase().includes(keyword);
      return roleMatched && keywordMatched;
    });
  }, [filter, items, roleFilter]);
  const groupedItems = useMemo(() => {
    const map = new Map<string, KnowledgeItem[]>();
    for (const item of visibleItems) map.set(item.volume || "未分卷", [...(map.get(item.volume || "未分卷") || []), item]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
  }, [visibleItems]);

  useEffect(() => {
    window.novelAPI
      .listKnowledgeItems()
      .then((result) => setItems(result.items))
      .catch((error) => onStatus(`读取知识库整理信息失败：${error instanceof Error ? error.message : String(error)}`));
  }, [state.projectPath]);

  function updateItem(id: string, patch: Partial<KnowledgeItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function applyRoleToVisible(role: KnowledgeRole) {
    const ids = new Set(visibleItems.map((item) => item.id));
    setItems((current) => current.map((item) => (ids.has(item.id) ? { ...item, knowledgeRole: role } : item)));
  }

  async function saveKnowledgeItems() {
    setSaving(true);
    onStatus("正在保存知识库分类...");
    try {
      const result = await window.novelAPI.updateKnowledgeItems({ items });
      setItems(result.items);
      onApplyState(result.state);
      onStatus(`知识库整理完成：${result.items.length} 个文档已同步到目录树`);
    } catch (error) {
      onStatus(`保存知识库分类失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="knowledge-panel">
      <header className="knowledge-header">
        <div>
          <ListTree size={20} />
          <strong>知识库整理</strong>
        </div>
        <button className="primary" onClick={() => void saveKnowledgeItems()} disabled={saving}>
          <Save size={16} />
          保存整理
        </button>
      </header>
      <div className="knowledge-toolbar">
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索文档或分卷" />
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as KnowledgeRole | "全部")}>
          <option value="全部">全部类型</option>
          <option value="大纲">大纲</option>
          <option value="正文">正文</option>
          <option value="补充材料">补充材料</option>
        </select>
        <button onClick={() => applyRoleToVisible("大纲")}>当前列表设为大纲</button>
        <button onClick={() => applyRoleToVisible("正文")}>当前列表设为正文</button>
        <button onClick={() => applyRoleToVisible("补充材料")}>当前列表设为补充材料</button>
      </div>
      <div className="knowledge-list">
        {groupedItems.map(([volume, groupItems]) => (
          <section key={volume} className="knowledge-group">
            <header>
              <strong>{volume}</strong>
              <span>{groupItems.length} 个文档</span>
            </header>
            {groupItems.map((item) => (
              <article key={item.id} className="knowledge-row">
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.wordCount.toLocaleString()} 字 / {formatDateTime(item.updatedAt)}</small>
                </div>
                <label>
                  资料类型
                  <select value={item.knowledgeRole} onChange={(event) => updateItem(item.id, { knowledgeRole: event.target.value as KnowledgeRole })}>
                    <option value="大纲">大纲</option>
                    <option value="正文">正文</option>
                    <option value="补充材料">补充材料</option>
                  </select>
                </label>
                <label>
                  所属目录
                  <input list="knowledge-volumes" value={item.volume} onChange={(event) => updateItem(item.id, { volume: event.target.value })} />
                </label>
              </article>
            ))}
          </section>
        ))}
        {!groupedItems.length && <div className="analysis-empty">没有匹配的文档。</div>}
      </div>
      <datalist id="knowledge-volumes">
        {volumes.map((volume) => (
          <option key={volume} value={volume} />
        ))}
      </datalist>
    </section>
  );
}

function AnalysisPanel({
  state,
  selectedChapterId,
  onSelectChapter,
  onOpenSource,
  onExportBook,
  onExportBookWithOptions,
  onApplyState,
  onStatus,
}: {
  state: AppState;
  selectedChapterId: string;
  onSelectChapter: (chapterId: string) => void;
  onOpenSource: (result: GlobalSearchResult) => void;
  onExportBook: () => void;
  onExportBookWithOptions: (options: { includeOutline?: boolean; includeCharacters?: boolean; includeWorld?: boolean }) => void;
  onApplyState: (state: AppState) => void;
  onStatus: (message: string) => void;
}) {
  const [tab, setTab] = useState<AnalysisTab>("search");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [relationshipNodes, setRelationshipNodes] = useState<RelationshipNode[]>([]);
  const [relationshipEdges, setRelationshipEdges] = useState<RelationshipEdge[]>([]);
  const [issues, setIssues] = useState<ConsistencyIssue[]>([]);
  const [consistencyNotice, setConsistencyNotice] = useState("");
  const [versions, setVersions] = useState<ChapterVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [versionCompare, setVersionCompare] = useState<ChapterVersionCompare | null>(null);
  const [timelineMode, setTimelineMode] = useState<"local" | "ai">("ai");
  const [draggingEventId, setDraggingEventId] = useState("");
  const [selectedRelationNames, setSelectedRelationNames] = useState<string[]>([]);
  const [relationTypes, setRelationTypes] = useState<string[]>(["同盟", "敌对", "师徒", "亲属", "感情", "交易", "背叛"]);
  const [newRelationType, setNewRelationType] = useState("");
  const [exportOptions, setExportOptions] = useState({ includeOutline: false, includeCharacters: false, includeWorld: false });
  const [extractScope, setExtractScope] = useState<"book" | "chapter">("book");
  const [worldCandidates, setWorldCandidates] = useState<ExtractedWorldCandidate[]>([]);
  const [appearanceStats, setAppearanceStats] = useState<AppearanceStat[]>([]);
  const [worldMapNodes, setWorldMapNodes] = useState<WorldMapNode[]>([]);
  const [worldMapEdges, setWorldMapEdges] = useState<WorldMapEdge[]>([]);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [materialDraft, setMaterialDraft] = useState<Partial<MaterialItem>>({ title: "", category: "灵感", content: "" });
  const [busy, setBusy] = useState("");
  const [analysisLoaded, setAnalysisLoaded] = useState(false);
  const [relationSearch, setRelationSearch] = useState("");
  const [relationCategoryFilter, setRelationCategoryFilter] = useState("");
  const [graphScale, setGraphScale] = useState(1);
  const [graphOffset, setGraphOffset] = useState({ x: 0, y: 0 });
  const [graphDragStart, setGraphDragStart] = useState<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const graphShellRef = useRef<HTMLDivElement | null>(null);
  const [consistencyChapterIds, setConsistencyChapterIds] = useState<string[]>([]);
  const [consistencySourceIds, setConsistencySourceIds] = useState<string[]>([]);
  const [scopeOpen, setScopeOpen] = useState(false);
  const selectedChapter = state.chapters.find((chapter) => chapter.id === selectedChapterId) || state.selectedChapter;
  const relationCategories = useMemo(() => [...new Set(state.characters.map((card) => normalizeCategoryLabel(card.category)))].sort((a, b) => a.localeCompare(b, "zh-CN")), [state.characters]);
  const relationVisibleCards = useMemo(() => {
    const keyword = relationSearch.trim().toLowerCase();
    return state.characters.filter((card) => {
      const category = normalizeCategoryLabel(card.category);
      const categoryMatched = !relationCategoryFilter || category === relationCategoryFilter || category.startsWith(`${relationCategoryFilter}/`);
      const keywordMatched =
        !keyword ||
        card.name.toLowerCase().includes(keyword) ||
        category.toLowerCase().includes(keyword) ||
        String(card.relationships || "").toLowerCase().includes(keyword);
      return categoryMatched && keywordMatched;
    });
  }, [relationCategoryFilter, relationSearch, state.characters]);
  const relationGroupedCards = useMemo(() => groupByCategory(relationVisibleCards), [relationVisibleCards]);
  const knowledgeSources = useMemo(
    () => [
      ...state.chapters.map((chapter) => ({
        id: chapter.id,
        sourceType: "chapter" as const,
        title: chapter.title,
        group: chapter.volume || "未分卷",
        role: chapter.knowledgeRole || "正文",
      })),
      ...state.characters.map((card) => ({
        id: card.id,
        sourceType: "character" as const,
        title: card.name,
        group: normalizeCategoryLabel(card.category),
        role: "角色卡",
      })),
      ...state.worldDocs.map((doc) => ({
        id: doc.id,
        sourceType: "world" as const,
        title: doc.title,
        group: normalizeCategoryLabel(doc.category),
        role: "世界观",
      })),
    ],
    [state.chapters, state.characters, state.worldDocs],
  );

  function saveAnalysisDraft(patch: Partial<AnalysisSnapshot>) {
    void window.novelAPI.saveAnalysisState(patch).catch(() => null);
  }

  function restoreAnalysisSnapshot(snapshot: AnalysisSnapshot) {
    if (snapshot.tab && ["search", "timeline", "relations", "consistency", "versions", "export"].includes(snapshot.tab)) {
      setTab(snapshot.tab as AnalysisTab);
    }
    if (typeof snapshot.query === "string") setQuery(snapshot.query);
    if (Array.isArray(snapshot.searchResults)) setSearchResults(snapshot.searchResults);
    if (snapshot.timeline?.events) setTimelineEvents(snapshot.timeline.events);
    if (snapshot.timelineOptions?.mode === "local" || snapshot.timelineOptions?.mode === "ai") setTimelineMode(snapshot.timelineOptions.mode);
    if (snapshot.relationships?.nodes) setRelationshipNodes(snapshot.relationships.nodes);
    if (snapshot.relationships?.edges) setRelationshipEdges(snapshot.relationships.edges);
    if (Array.isArray(snapshot.relationshipOptions?.characterNames)) setSelectedRelationNames(snapshot.relationshipOptions.characterNames);
    if (typeof snapshot.relationshipOptions?.categoryFilter === "string") setRelationCategoryFilter(snapshot.relationshipOptions.categoryFilter);
    if (Array.isArray(snapshot.relationshipOptions?.relationTypes) && snapshot.relationshipOptions.relationTypes.length) setRelationTypes(snapshot.relationshipOptions.relationTypes);
    if (snapshot.consistency?.issues) setIssues(snapshot.consistency.issues);
    if (snapshot.consistency?.notice || snapshot.consistency?.apiError) setConsistencyNotice(snapshot.consistency.notice || `AI 暂时不可用，已显示本地检查结果：${snapshot.consistency.apiError}`);
    if (Array.isArray(snapshot.consistencyOptions?.chapterIds)) setConsistencyChapterIds(snapshot.consistencyOptions.chapterIds);
    if (Array.isArray(snapshot.consistencyOptions?.knowledgeSourceIds)) setConsistencySourceIds(snapshot.consistencyOptions.knowledgeSourceIds);
    if (snapshot.exportOptions) setExportOptions({ includeOutline: false, includeCharacters: false, includeWorld: false, ...snapshot.exportOptions });
    if (snapshot.extractScope === "book" || snapshot.extractScope === "chapter") setExtractScope(snapshot.extractScope);
    if (Array.isArray(snapshot.worldCandidates)) setWorldCandidates(snapshot.worldCandidates);
    if (Array.isArray(snapshot.appearanceStats)) setAppearanceStats(snapshot.appearanceStats);
    if (Array.isArray(snapshot.worldMapNodes)) setWorldMapNodes(snapshot.worldMapNodes);
    if (Array.isArray(snapshot.worldMapEdges)) setWorldMapEdges(snapshot.worldMapEdges);
    if (Array.isArray(snapshot.materials)) setMaterials(snapshot.materials);
    if (snapshot.materialDraft) setMaterialDraft(snapshot.materialDraft);
  }

  useEffect(() => {
    setAnalysisLoaded(false);
    window.novelAPI
      .getAnalysisState()
      .then((snapshot) => restoreAnalysisSnapshot(snapshot || {}))
      .catch(() => null)
      .finally(() => setAnalysisLoaded(true));
  }, [state.projectPath]);

  useEffect(() => {
    if (!analysisLoaded) return;
    const timer = window.setTimeout(() => {
      saveAnalysisDraft({
        tab,
        query,
        searchResults,
        timeline: { events: timelineEvents },
        timelineOptions: { mode: timelineMode },
        relationships: { nodes: relationshipNodes, edges: relationshipEdges },
        relationshipOptions: {
          characterNames: selectedRelationNames,
          categoryFilter: relationCategoryFilter,
          relationTypes,
        },
        consistency: { issues, notice: consistencyNotice },
        consistencyOptions: {
          chapterIds: consistencyChapterIds,
          knowledgeSourceIds: consistencySourceIds,
        },
        exportOptions,
        extractScope,
        worldCandidates,
        appearanceStats,
        worldMapNodes,
        worldMapEdges,
        materials,
        materialDraft,
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    analysisLoaded,
    tab,
    query,
    searchResults,
    timelineEvents,
    timelineMode,
    relationshipNodes,
    relationshipEdges,
    selectedRelationNames,
    relationCategoryFilter,
    relationTypes,
    issues,
    consistencyNotice,
    consistencyChapterIds,
    consistencySourceIds,
    exportOptions,
    extractScope,
    worldCandidates,
    appearanceStats,
    worldMapNodes,
    worldMapEdges,
    materials,
    materialDraft,
    selectedChapterId,
  ]);

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      onStatus("请先输入要搜索的关键词。");
      return;
    }
    setBusy("search");
    onStatus("正在全局搜索...");
    try {
      const result = await window.novelAPI.globalSearch({ query: trimmed });
      setSearchResults(result.results);
      saveAnalysisDraft({ query: trimmed, searchResults: result.results });
      onStatus(`搜索完成：找到 ${result.results.length} 条结果`);
    } catch (error) {
      onStatus(`搜索失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function loadTimeline() {
    setBusy("timeline");
    onStatus(timelineMode === "ai" ? "正在让 AI 识别真实剧情事件..." : "正在整理时间线...");
    try {
      const result = await window.novelAPI.buildTimeline({ mode: timelineMode, refresh: true });
      setTimelineEvents(result.events);
      saveAnalysisDraft({ timeline: result, timelineOptions: { mode: timelineMode } });
      onStatus(result.apiError ? `AI 时间线失败，已使用本地结果：${result.apiError}` : `时间线已整理：${result.events.length} 个事件`);
    } catch (error) {
      onStatus(`整理时间线失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  function moveTimelineEvent(targetId: string) {
    if (!draggingEventId || draggingEventId === targetId) return;
    setTimelineEvents((items) => {
      const moving = items.find((item) => item.id === draggingEventId);
      if (!moving) return items;
      const rest = items.filter((item) => item.id !== draggingEventId);
      const targetIndex = rest.findIndex((item) => item.id === targetId);
      rest.splice(targetIndex < 0 ? rest.length : targetIndex, 0, moving);
      const next = rest.map((item, index) => ({ ...item, order: index }));
      saveAnalysisDraft({ timeline: { events: next }, timelineOptions: { mode: timelineMode } });
      return next;
    });
    setDraggingEventId("");
    onStatus("已手动调整时间线顺序");
  }

  async function loadRelationships() {
    setBusy("relations");
    onStatus("正在生成角色关系网...");
    try {
      const result = await window.novelAPI.buildRelationshipGraph({
        characterNames: selectedRelationNames,
        categoryFilter: relationCategoryFilter,
        relationTypes,
        refresh: true,
      });
      setRelationshipNodes(result.nodes);
      setRelationshipEdges(result.edges);
      saveAnalysisDraft({
        relationships: result,
        relationshipOptions: {
          characterNames: selectedRelationNames,
          categoryFilter: relationCategoryFilter,
          relationTypes,
        },
      });
      onStatus(`关系网已生成：${result.nodes.length} 个角色，${result.edges.length} 条关系`);
    } catch (error) {
      onStatus(`生成关系网失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  function toggleRelationName(name: string) {
    setSelectedRelationNames((items) => (items.includes(name) ? items.filter((item) => item !== name) : [...items, name]));
  }

  function addRelationType() {
    const value = newRelationType.trim();
    if (!value) {
      onStatus("请先输入新的关系类型。");
      return;
    }
    if (relationTypes.includes(value)) {
      onStatus(`关系类型已存在：${value}`);
      return;
    }
    setRelationTypes((items) => [...items, value]);
    setNewRelationType("");
    onStatus(`已添加关系类型：${value}`);
  }

  async function runConsistencyCheck() {
    setBusy("consistency");
    setConsistencyNotice("");
    onStatus("正在检查设定一致性...");
    try {
      const result = await window.novelAPI.analyzeConsistency({
        refresh: true,
        chapterIds: consistencyChapterIds,
        knowledgeSourceIds: consistencySourceIds,
      });
      setIssues(result.issues);
      const notice = result.apiError ? `AI 暂时不可用，已显示本地检查结果：${result.apiError}` : `AI 检查完成，引用检索片段 ${result.contextCount} 条`;
      setConsistencyNotice(notice);
      saveAnalysisDraft({
        consistency: { ...result, notice },
        consistencyOptions: {
          chapterIds: consistencyChapterIds,
          knowledgeSourceIds: consistencySourceIds,
        },
      });
      onStatus(`设定检查完成：发现 ${result.issues.length} 条待确认问题`);
    } catch (error) {
      onStatus(`设定检查失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function updateIssueStatus(issueId: string, status: ConsistencyIssue["status"]) {
    if (!status) return;
    try {
      await window.novelAPI.updateIssueStatus({ issueId, status });
      setIssues((items) => {
        const next = items.map((item) => (item.id === issueId ? { ...item, status } : item));
        saveAnalysisDraft({ consistency: { issues: next, notice: consistencyNotice } });
        return next;
      });
      onStatus(`问题已标记为：${status}`);
    } catch (error) {
      onStatus(`更新问题状态失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function loadVersions() {
    if (!selectedChapterId) return;
    setBusy("versions");
    setVersionCompare(null);
    onStatus("正在读取章节历史版本...");
    try {
      const result = await window.novelAPI.listChapterVersions(selectedChapterId);
      setVersions(result.versions);
      setSelectedVersionId(result.versions[0]?.id || "");
      onStatus(result.versions.length ? `已读取 ${result.versions.length} 个历史版本` : "当前章节还没有历史版本；保存修改后会开始记录");
    } catch (error) {
      onStatus(`读取历史版本失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function compareVersion() {
    if (!selectedChapterId || !selectedVersionId) return;
    setBusy("compare");
    onStatus("正在对比版本...");
    try {
      const result = await window.novelAPI.compareChapterVersion({ chapterId: selectedChapterId, versionId: selectedVersionId });
      setVersionCompare(result);
      onStatus(`版本对比完成：新增 ${result.added} 行，删除 ${result.removed} 行`);
    } catch (error) {
      onStatus(`版本对比失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function prepareWorldCandidates() {
    setBusy("extract");
    onStatus(extractScope === "chapter" ? "正在从当前文档提取候选..." : "正在从全书提取候选...");
    try {
      const result = await window.novelAPI.extractWorldCardsFromOutline({ scope: extractScope, chapterId: selectedChapterId });
      setWorldCandidates(result.candidates);
      saveAnalysisDraft({ extractScope, worldCandidates: result.candidates });
      onStatus(`已提取 ${result.candidates.length} 个候选；请勾选后写入世界观`);
    } catch (error) {
      onStatus(`提取候选失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function saveSelectedCandidates() {
    setBusy("save-candidates");
    onStatus("正在写入选中的资料条目...");
    try {
      const result = await window.novelAPI.saveWorldCardCandidates({ candidates: worldCandidates });
      onApplyState(result.state);
      setWorldCandidates([]);
      saveAnalysisDraft({ worldCandidates: [] });
      onStatus(`已写入资料条目：新增 ${result.created} 条，合并 ${result.updated} 条`);
    } catch (error) {
      onStatus(`写入资料失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function loadAppearanceStats() {
    setBusy("appearance");
    try {
      const result = await window.novelAPI.getAppearanceStats();
      setAppearanceStats(result.stats);
      saveAnalysisDraft({ appearanceStats: result.stats });
      onStatus(`人物出场统计完成：${result.stats.length} 个角色`);
    } catch (error) {
      onStatus(`人物出场统计失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function loadWorldMap() {
    setBusy("world-map");
    try {
      const result = await window.novelAPI.getWorldMap();
      setWorldMapNodes(result.nodes);
      setWorldMapEdges(result.edges);
      saveAnalysisDraft({ worldMapNodes: result.nodes, worldMapEdges: result.edges });
      onStatus(`地点/势力版图已整理：${result.nodes.length} 个节点，${result.edges.length} 条关联`);
    } catch (error) {
      onStatus(`整理版图失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function loadMaterials() {
    setBusy("materials");
    try {
      const result = await window.novelAPI.listMaterials();
      setMaterials(result.materials);
      saveAnalysisDraft({ materials: result.materials });
      onStatus(`素材已刷新：${result.materials.length} 条`);
    } catch (error) {
      onStatus(`刷新素材失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function saveMaterialDraft() {
    setBusy("save-material");
    try {
      const result = await window.novelAPI.saveMaterial(materialDraft);
      setMaterials(result.materials);
      setMaterialDraft({ title: "", category: "灵感", content: "" });
      saveAnalysisDraft({ materials: result.materials, materialDraft: { title: "", category: "灵感", content: "" } });
      onStatus(`素材已保存：${result.material.title}`);
    } catch (error) {
      onStatus(`保存素材失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function deleteMaterialItem(materialId: string) {
    setBusy("delete-material");
    try {
      const result = await window.novelAPI.deleteMaterial(materialId);
      setMaterials(result.materials);
      saveAnalysisDraft({ materials: result.materials });
      onStatus("素材已删除");
    } catch (error) {
      onStatus(`删除素材失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (tab === "versions" && selectedChapterId) void loadVersions();
  }, [tab, selectedChapterId]);

  const graph = useMemo(() => {
    const width = 1240;
    const degree = new Map<string, number>();
    relationshipEdges.forEach((edge) => {
      degree.set(edge.source, (degree.get(edge.source) || 0) + edge.weight);
      degree.set(edge.target, (degree.get(edge.target) || 0) + edge.weight);
    });
    const nodes = relationshipNodes
      .slice()
      .sort((a, b) => (degree.get(b.id) || 0) + b.size - ((degree.get(a.id) || 0) + a.size));
    const center = nodes[0];
    const others = nodes.slice(1);
    const left: RelationshipNode[] = [];
    const right: RelationshipNode[] = [];
    others.forEach((node, index) => {
      const target = index % 2 === 0 ? right : left;
      target.push(node);
    });
    const rowGap = 82;
    const height = Math.max(520, (Math.max(left.length, right.length, 1) - 1) * rowGap + 220);
    const centerX = width / 2;
    const centerY = height / 2;
    const positions = new Map<string, { x: number; y: number; width: number; height: number; side: "center" | "left" | "right" }>();
    const measure = (name: string) => Math.max(108, Math.min(190, name.length * 15 + 46));
    if (center) {
      positions.set(center.id, { x: centerX, y: centerY, width: measure(center.name) + 24, height: 48, side: "center" });
    }
    const placeSide = (items: RelationshipNode[], side: "left" | "right") => {
      const x = centerX + (side === "right" ? 330 : -330);
      const startY = centerY - ((items.length - 1) * rowGap) / 2;
      items.forEach((node, index) => {
        positions.set(node.id, { x, y: startY + index * rowGap, width: measure(node.name), height: 42, side });
      });
    };
    placeSide(left, "left");
    placeSide(right, "right");
    return { width, height, positions };
  }, [relationshipNodes, relationshipEdges]);

  function resetGraphView() {
    setGraphScale(1);
    setGraphOffset({ x: 0, y: 0 });
  }

  function zoomGraphByWheel(deltaY: number) {
    const factor = deltaY < 0 ? 1.12 : 0.88;
    setGraphScale((value) => Math.min(3.2, Math.max(0.35, Number((value * factor).toFixed(3)))));
  }

  function zoomGraph(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    zoomGraphByWheel(event.deltaY);
  }

  useEffect(() => {
    const shell = graphShellRef.current;
    if (!shell) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zoomGraphByWheel(event.deltaY);
    };
    shell.addEventListener("wheel", handleWheel, { passive: false });
    return () => shell.removeEventListener("wheel", handleWheel);
  }, [relationshipNodes.length, tab]);

  function startGraphPan(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;
    setGraphDragStart({ x: event.clientX, y: event.clientY, offsetX: graphOffset.x, offsetY: graphOffset.y });
  }

  function moveGraphPan(event: React.MouseEvent<HTMLDivElement>) {
    if (!graphDragStart) return;
    event.preventDefault();
    event.stopPropagation();
    setGraphOffset({
      x: graphDragStart.offsetX + event.clientX - graphDragStart.x,
      y: graphDragStart.offsetY + event.clientY - graphDragStart.y,
    });
  }

  function stopGraphPan() {
    setGraphDragStart(null);
  }

  function toggleConsistencyChapter(chapterId: string) {
    setConsistencyChapterIds((items) => (items.includes(chapterId) ? items.filter((id) => id !== chapterId) : [...items, chapterId]));
  }

  function toggleConsistencySource(sourceId: string) {
    setConsistencySourceIds((items) => (items.includes(sourceId) ? items.filter((id) => id !== sourceId) : [...items, sourceId]));
  }

  function selectVisibleRelationCards() {
    const names = relationVisibleCards.map((card) => card.name).filter(Boolean);
    setSelectedRelationNames((items) => [...new Set([...items, ...names])]);
  }

  function renderRelationGroup(group: CategoryGroup<CharacterCard>, depth = 0) {
    return (
      <div className="relation-category-group" key={group.key}>
        <div className="relation-category-title" style={{ paddingLeft: 8 + depth * 14 }}>
          <span>{group.category}</span>
          <small>{group.count}</small>
        </div>
        {group.children.map((child) => renderRelationGroup(child, depth + 1))}
        {group.items.map((card) => (
          <label key={card.id} style={{ paddingLeft: 24 + depth * 14 }}>
            <input type="checkbox" checked={selectedRelationNames.includes(card.name)} onChange={() => toggleRelationName(card.name)} />
            <span>{card.name}</span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <section className="analysis-panel">
      <div className="analysis-tabs">
        <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>
          <Search size={16} />
          全局搜索
        </button>
        <button className={tab === "timeline" ? "active" : ""} onClick={() => setTab("timeline")}>
          <ListTree size={16} />
          时间线
        </button>
        <button className={tab === "relations" ? "active" : ""} onClick={() => setTab("relations")}>
          <UserRound size={16} />
          关系网
        </button>
        <button className={tab === "consistency" ? "active" : ""} onClick={() => setTab("consistency")}>
          <RefreshCcw size={16} />
          一致性
        </button>
        <button className={tab === "versions" ? "active" : ""} onClick={() => setTab("versions")}>
          <FileText size={16} />
          版本对比
        </button>
        <button className={tab === "export" ? "active" : ""} onClick={() => setTab("export")}>
          <FileDown size={16} />
          导出/提取
        </button>
      </div>

      {tab === "search" && (
        <div className="analysis-section">
          <form
            className="analysis-search"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索章节、角色、世界观" />
            <button disabled={busy === "search"}>
              <Search size={16} />
              搜索
            </button>
          </form>
          <div className="search-results">
            {searchResults.map((result) => (
              <button key={result.id} className="search-result" onClick={() => onOpenSource(result)}>
                <strong>{result.title}</strong>
                <span>{sourceLabel(result.sourceType)}{result.volume ? ` / ${result.volume}` : result.category ? ` / ${result.category}` : ""}</span>
                <p>{result.snippet || "匹配标题或分类"}</p>
              </button>
            ))}
            {!searchResults.length && <div className="analysis-empty">输入关键词后可搜索章节正文、角色卡片和世界观条目。</div>}
          </div>
        </div>
      )}

      {tab === "timeline" && (
        <div className="analysis-section">
          <div className="analysis-actions">
            <select value={timelineMode} onChange={(event) => setTimelineMode(event.target.value as "local" | "ai")}>
              <option value="ai">AI 识别真实事件</option>
              <option value="local">本地规则整理</option>
            </select>
            <button onClick={() => void loadTimeline()} disabled={busy === "timeline"}>
              <RefreshCcw size={16} />
              刷新时间线
            </button>
          </div>
          <div className="timeline-list">
            {timelineEvents.map((event) => (
              <button
                key={event.id}
                className="timeline-item"
                draggable
                onDragStart={() => setDraggingEventId(event.id)}
                onDragOver={(dragEvent) => {
                  dragEvent.preventDefault();
                  dragEvent.dataTransfer.dropEffect = "move";
                }}
                onDrop={(dragEvent) => {
                  dragEvent.preventDefault();
                  moveTimelineEvent(event.id);
                }}
                onDragEnd={() => setDraggingEventId("")}
                onClick={() => onSelectChapter(event.chapterId)}
              >
                <span className="timeline-dot" />
                <div>
                  <strong>{event.timeHint || event.title}</strong>
                  <small>{event.volume} / {event.chapterTitle}</small>
                  <p>{event.summary}</p>
                  {!!event.characters.length && <em>{event.characters.join("、")}</em>}
                </div>
              </button>
            ))}
            {!timelineEvents.length && <div className="analysis-empty">时间线会从章节顺序、时间词和小标题中整理事件。</div>}
          </div>
        </div>
      )}

      {tab === "relations" && (
        <div className="analysis-section">
          <div className="relation-controls">
            <details>
              <summary>选择角色卡</summary>
              <div className="relation-filter-row">
                <input value={relationSearch} onChange={(event) => setRelationSearch(event.target.value)} placeholder="搜索角色、分类或关系" />
                <select value={relationCategoryFilter} onChange={(event) => setRelationCategoryFilter(event.target.value)}>
                  <option value="">全部分类</option>
                  {relationCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div className="relation-tree-select">
                {relationGroupedCards.map((group) => renderRelationGroup(group))}
                {!relationGroupedCards.length && <p>没有匹配的角色卡。</p>}
              </div>
              <div className="relation-filter-actions">
                <button onClick={selectVisibleRelationCards}>勾选当前筛选</button>
                <button onClick={() => setSelectedRelationNames([])}>显示全部角色</button>
              </div>
            </details>
            <details>
              <summary>关系类型</summary>
              <div className="chip-list">
                {relationTypes.map((type) => (
                  <button key={type} onClick={() => setRelationTypes((items) => items.filter((item) => item !== type))} title="点击移除">
                    {type}
                  </button>
                ))}
              </div>
              <div className="inline-form">
                <input value={newRelationType} onChange={(event) => setNewRelationType(event.target.value)} placeholder="新增关系类型" />
                <button onClick={addRelationType}>添加</button>
              </div>
            </details>
          </div>
          <div className="analysis-actions">
            <button onClick={() => void loadRelationships()} disabled={busy === "relations"}>
              <RefreshCcw size={16} />
              刷新关系网
            </button>
          </div>
          {relationshipNodes.length ? (
            <>
              <div
                ref={graphShellRef}
                className={`relationship-graph-shell ${graphDragStart ? "dragging" : ""}`}
                onWheel={zoomGraph}
                onMouseDown={startGraphPan}
                onMouseMove={moveGraphPan}
                onMouseUp={stopGraphPan}
                onMouseLeave={stopGraphPan}
              >
                <div className="relationship-graph-tools">
                  <span>{Math.round(graphScale * 100)}%</span>
                  <button onMouseDown={(event) => event.stopPropagation()} onClick={resetGraphView}>重置视图</button>
                </div>
                <svg className="relationship-graph" viewBox={`0 0 ${graph.width} ${graph.height}`} role="img">
                  <g transform={`translate(${graphOffset.x} ${graphOffset.y}) scale(${graphScale})`}>
                    {relationshipEdges.map((edge) => {
                      const source = graph.positions.get(edge.source);
                      const target = graph.positions.get(edge.target);
                      if (!source || !target) return null;
                      const sourceAnchorX = source.x + (target.x >= source.x ? source.width / 2 : -source.width / 2);
                      const targetAnchorX = target.x + (target.x >= source.x ? -target.width / 2 : target.width / 2);
                      const curve = Math.max(80, Math.abs(targetAnchorX - sourceAnchorX) * 0.42);
                      const labelX = edge.labelX ?? (source.x + target.x) / 2;
                      const labelY = edge.labelY ?? (source.y + target.y) / 2;
                      return (
                        <g key={edge.id}>
                          <path
                            className="relationship-branch"
                            d={`M ${sourceAnchorX} ${source.y} C ${sourceAnchorX + (target.x >= source.x ? curve : -curve)} ${source.y}, ${targetAnchorX + (target.x >= source.x ? -curve : curve)} ${target.y}, ${targetAnchorX} ${target.y}`}
                            strokeWidth={Math.max(1.6, edge.weight / 2)}
                          />
                          <text className="relationship-edge-label" x={labelX} y={labelY - 6} textAnchor="middle">
                            {edge.label || "关系"}
                          </text>
                          <title>{edge.evidence[0] || "来自角色关系或正文同场统计"}</title>
                        </g>
                      );
                    })}
                    {relationshipNodes.map((node) => {
                      const position = graph.positions.get(node.id);
                      if (!position) return null;
                      return (
                        <g key={node.id} className={`relationship-node ${position.side}`}>
                          <rect x={position.x - position.width / 2} y={position.y - position.height / 2} width={position.width} height={position.height} rx={8} />
                          <text x={position.x} y={position.y + 5} textAnchor="middle">
                            {node.name}
                          </text>
                          <title>{node.category}</title>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>
              <div className="relationship-edges">
                {relationshipEdges.slice(0, 24).map((edge) => (
                  <div key={edge.id}>
                    <strong>{edge.source} - {edge.target}</strong>
                    <span>{edge.label} / 强度 {edge.weight}</span>
                    <p>{edge.evidence[0] || "来自角色关系或正文同场统计"}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="analysis-empty">角色卡片越完整，关系网越清晰。正文中同场出现也会形成关系线。</div>
          )}
        </div>
      )}

      {tab === "consistency" && (
        <div className="analysis-section">
          <details className="scope-panel" open={scopeOpen} onToggle={(event) => setScopeOpen(event.currentTarget.open)}>
            <summary>审查范围</summary>
            <div className="scope-grid">
              <section>
                <header>
                  <strong>审查哪些章节</strong>
                  <div>
                    <button onClick={() => setConsistencyChapterIds(state.chapters.map((chapter) => chapter.id))}>全选</button>
                    <button onClick={() => setConsistencyChapterIds([])}>全书</button>
                  </div>
                </header>
                <div className="scope-check-list">
                  {state.chapters.map((chapter) => (
                    <label key={chapter.id}>
                      <input type="checkbox" checked={consistencyChapterIds.includes(chapter.id)} onChange={() => toggleConsistencyChapter(chapter.id)} />
                      <span>{chapter.volume || "未分卷"} / {chapter.title}</span>
                    </label>
                  ))}
                </div>
              </section>
              <section>
                <header>
                  <strong>依据哪些资料</strong>
                  <div>
                    <button onClick={() => setConsistencySourceIds(knowledgeSources.map((source) => source.id))}>全选</button>
                    <button onClick={() => setConsistencySourceIds([])}>全项目</button>
                  </div>
                </header>
                <div className="scope-check-list">
                  {knowledgeSources.map((source) => (
                    <label key={`${source.sourceType}_${source.id}`}>
                      <input type="checkbox" checked={consistencySourceIds.includes(source.id)} onChange={() => toggleConsistencySource(source.id)} />
                      <span>{source.role} / {source.group} / {source.title}</span>
                    </label>
                  ))}
                </div>
              </section>
            </div>
          </details>
          <div className="analysis-actions">
            <button onClick={() => void runConsistencyCheck()} disabled={busy === "consistency"}>
              <RefreshCcw size={16} />
              开始检查
            </button>
            {consistencyNotice && <span>{consistencyNotice}</span>}
          </div>
          <div className="issue-list">
            {issues.map((issue) => (
              <article key={issue.id} className={`issue-card severity-${issue.severity}`}>
                <header>
                  <strong>{issue.title}</strong>
                  <span>{issue.severity} / {issue.category} / {issue.status || "待处理"}</span>
                </header>
                <p>{issue.detail}</p>
                {issue.suggestion && <em>{issue.suggestion}</em>}
                {!!issue.evidence.length && <small>{issue.evidence.join("；")}</small>}
                <div className="issue-actions">
                  {(["已确认", "已忽略", "已修复", "待处理"] as const).map((status) => (
                    <button key={status} onClick={() => void updateIssueStatus(issue.id, status)}>
                      {status}
                    </button>
                  ))}
                </div>
              </article>
            ))}
            {!issues.length && <div className="analysis-empty">点击“开始检查”后，会结合 AI 和本地规则查找前后矛盾。</div>}
          </div>
        </div>
      )}

      {tab === "versions" && (
        <div className="analysis-section">
          <div className="analysis-actions">
            <button onClick={() => void loadVersions()} disabled={!selectedChapterId || busy === "versions"}>
              <RefreshCcw size={16} />
              读取版本
            </button>
            <span>{selectedChapter ? `当前章节：${selectedChapter.title}` : "请选择一个章节"}</span>
          </div>
          <div className="version-tools">
            <select value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)} disabled={!versions.length}>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {formatDateTime(version.createdAt)} / {version.wordCount} 字
                </option>
              ))}
            </select>
            <button onClick={() => void compareVersion()} disabled={!selectedVersionId || busy === "compare"}>
              对比当前版本
            </button>
          </div>
          {versionCompare ? (
            <div className="diff-view">
              <div className="diff-summary">
                <strong>{formatDateTime(versionCompare.version.createdAt)} 对比当前</strong>
                <span>新增 {versionCompare.added} 行 / 删除 {versionCompare.removed} 行{versionCompare.truncated ? " / 已截断显示" : ""}</span>
              </div>
              {versionCompare.diff.map((line, index) => (
                <p key={`${line.type}_${index}`} className={`diff-line ${line.type}`}>
                  <span>{line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}</span>
                  {line.text}
                </p>
              ))}
            </div>
          ) : (
            <div className="analysis-empty">修改并保存章节后，软件会自动保留保存前版本；这里可以和当前内容对比。</div>
          )}
        </div>
      )}

      {tab === "export" && (
        <div className="analysis-section export-lab">
          <div className="tool-grid">
            <div className="tool-card">
              <FileDown size={22} />
              <strong>导出整书 DOCX</strong>
              <label>
                <input type="checkbox" checked={exportOptions.includeOutline} onChange={(event) => setExportOptions((value) => ({ ...value, includeOutline: event.target.checked }))} />
                带大纲
              </label>
              <label>
                <input type="checkbox" checked={exportOptions.includeCharacters} onChange={(event) => setExportOptions((value) => ({ ...value, includeCharacters: event.target.checked }))} />
                带角色卡
              </label>
              <label>
                <input type="checkbox" checked={exportOptions.includeWorld} onChange={(event) => setExportOptions((value) => ({ ...value, includeWorld: event.target.checked }))} />
                带世界观资料
              </label>
              <button onClick={() => onExportBookWithOptions(exportOptions)}>开始导出</button>
              <button onClick={() => onExportBook()}>只导出正文</button>
            </div>
            <div className="tool-card">
              <Wand2 size={22} />
              <strong>提取地点/势力/物品候选</strong>
              <select value={extractScope} onChange={(event) => setExtractScope(event.target.value as "book" | "chapter")}>
                <option value="book">从全书提取</option>
                <option value="chapter">仅从当前文档提取</option>
              </select>
              <button onClick={() => void prepareWorldCandidates()} disabled={busy === "extract"}>
                生成候选
              </button>
              <span>候选会先显示在下方，勾选后才写入世界观。</span>
            </div>
          </div>
          {!!worldCandidates.length && (
            <div className="candidate-list">
              <div className="analysis-actions">
                <button onClick={() => setWorldCandidates((items) => items.map((item) => ({ ...item, selected: true })))}>全选</button>
                <button onClick={() => setWorldCandidates((items) => items.map((item) => ({ ...item, selected: false })))}>全不选</button>
                <button onClick={() => void saveSelectedCandidates()} disabled={busy === "save-candidates"}>
                  写入选中条目
                </button>
              </div>
              {worldCandidates.map((candidate) => (
                <article key={candidate.id} className="candidate-card">
                  <label>
                    <input
                      type="checkbox"
                      checked={candidate.selected}
                      onChange={(event) => setWorldCandidates((items) => items.map((item) => (item.id === candidate.id ? { ...item, selected: event.target.checked } : item)))}
                    />
                    <strong>{candidate.title}</strong>
                  </label>
                  <span>
                    {candidate.category} / {candidate.action === "merge" ? `合并到：${candidate.matchedTitle}` : "新建条目"}
                  </span>
                  <p>{contentToPlainText(candidate.content).slice(0, 180)}</p>
                </article>
              ))}
            </div>
          )}
          <details className="experimental-card">
            <summary>试验功能</summary>
            <ExperimentalTools
              appearanceStats={appearanceStats}
              worldMapNodes={worldMapNodes}
              worldMapEdges={worldMapEdges}
              materials={materials}
              materialDraft={materialDraft}
              onLoadAppearance={() => void loadAppearanceStats()}
              onLoadWorldMap={() => void loadWorldMap()}
              onLoadMaterials={() => void loadMaterials()}
              onMaterialDraft={setMaterialDraft}
              onSaveMaterial={() => void saveMaterialDraft()}
              onDeleteMaterial={(id) => void deleteMaterialItem(id)}
            />
          </details>
        </div>
      )}
    </section>
  );
}

function ExperimentalTools({
  appearanceStats,
  worldMapNodes,
  worldMapEdges,
  materials,
  materialDraft,
  onLoadAppearance,
  onLoadWorldMap,
  onLoadMaterials,
  onMaterialDraft,
  onSaveMaterial,
  onDeleteMaterial,
}: {
  appearanceStats: AppearanceStat[];
  worldMapNodes: WorldMapNode[];
  worldMapEdges: WorldMapEdge[];
  materials: MaterialItem[];
  materialDraft: Partial<MaterialItem>;
  onLoadAppearance: () => void;
  onLoadWorldMap: () => void;
  onLoadMaterials: () => void;
  onMaterialDraft: (draft: Partial<MaterialItem>) => void;
  onSaveMaterial: () => void;
  onDeleteMaterial: (id: string) => void;
}) {
  return (
    <div className="experimental-grid">
      <section>
        <header>
          <strong>人物出场统计</strong>
          <button onClick={onLoadAppearance}>统计</button>
        </header>
        <div className="compact-list">
          {appearanceStats.slice(0, 12).map((item) => (
            <div key={item.id}>
              <span>{item.name}</span>
              <small>{item.total} 次 / {item.chapters.length} 章</small>
            </div>
          ))}
          {!appearanceStats.length && <p>统计角色在各章节出现次数。</p>}
        </div>
      </section>
      <section>
        <header>
          <strong>地点/势力版图</strong>
          <button onClick={onLoadWorldMap}>整理</button>
        </header>
        <div className="compact-list">
          {worldMapNodes.slice(0, 16).map((node) => (
            <div key={node.id}>
              <span>{node.title}</span>
              <small>{node.type} / {node.category}</small>
            </div>
          ))}
          {!worldMapNodes.length && <p>从世界观条目整理地点、势力、物品节点。</p>}
          {!!worldMapEdges.length && <p>{worldMapEdges.length} 条文本关联。</p>}
        </div>
      </section>
      <section>
        <header>
          <strong>素材库</strong>
          <button onClick={onLoadMaterials}>刷新</button>
        </header>
        <div className="material-form">
          <input value={materialDraft.title || ""} onChange={(event) => onMaterialDraft({ ...materialDraft, title: event.target.value })} placeholder="素材标题" />
          <input value={materialDraft.category || ""} onChange={(event) => onMaterialDraft({ ...materialDraft, category: event.target.value })} placeholder="分类" />
          <textarea value={materialDraft.content || ""} onChange={(event) => onMaterialDraft({ ...materialDraft, content: event.target.value })} placeholder="灵感、桥段、句子或设定碎片" />
          <button onClick={onSaveMaterial}>保存素材</button>
        </div>
        <div className="compact-list">
          {materials.slice(0, 8).map((item) => (
            <div key={item.id}>
              <span>{item.title}</span>
              <small>{item.category}</small>
              <button onClick={() => onDeleteMaterial(item.id)}>删除</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CharacterManager({
  cards,
  onSave,
  onDelete,
  onGenerate,
}: {
  cards: CharacterCard[];
  onSave: (card: Partial<CharacterCard>) => void;
  onDelete: (id: string) => void;
  onGenerate: () => void;
}) {
  const blankCard = { name: "", category: DEFAULT_CATEGORY_LABEL, appearance: "", personality: "", background: "", relationships: "", notes: "" };
  const [active, setActive] = useState<Partial<CharacterCard>>(cards[0] || blankCard);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [draggingCardId, setDraggingCardId] = useState("");
  const [dragOverCategory, setDragOverCategory] = useState("");
  const [dragHint, setDragHint] = useState("");
  const groupedCards = useMemo(() => groupByCategory(cards), [cards]);

  useEffect(() => {
    setActive((current) => cards.find((card) => card.id && card.id === current.id) || cards[0] || { ...blankCard, name: "新角色" });
  }, [cards]);

  function updateField(field: keyof CharacterCard, value: string) {
    setActive((card) => ({ ...card, [field]: value }));
  }

  function toggleCategory(categoryKey: string) {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryKey)) next.delete(categoryKey);
      else next.add(categoryKey);
      return next;
    });
  }

  function moveCardToCategory(category: string) {
    if (!draggingCardId) return;
    const card = cards.find((item) => item.id === draggingCardId);
    if (!card) return;
    const next = { ...card, category };
    setActive(next);
    onSave(next);
    setDraggingCardId("");
    setDragOverCategory("");
    setDragHint("");
  }

  function renderCategoryGroup(group: CategoryGroup<CharacterCard>, depth = 0) {
    const collapsed = collapsedCategories.has(group.key);
    return (
      <div className="manager-group" key={group.key}>
        <button
          className={`manager-group-header ${dragOverCategory === group.key ? "drag-over" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => toggleCategory(group.key)}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDragOverCategory(group.key);
            setDragHint(`将移动到「${group.key}」，分类等级 ${splitCategoryPath(group.key).length} 级`);
          }}
          onDragLeave={() => {
            setDragOverCategory((current) => (current === group.key ? "" : current));
            setDragHint("");
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            moveCardToCategory(group.key);
          }}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <span>{group.category}</span>
          <small>{group.count}</small>
        </button>
        {!collapsed && (
          <>
            {group.children.map((child) => renderCategoryGroup(child, depth + 1))}
            {group.items.map((card) => (
              <button
                key={card.id}
                className={`manager-item ${active.id === card.id ? "active" : ""}`}
                draggable
                style={{ paddingLeft: 28 + depth * 14 }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", card.id);
                  setDraggingCardId(card.id);
                }}
                onDragEnd={() => {
                  setDraggingCardId("");
                  setDragOverCategory("");
                  setDragHint("");
                }}
                onClick={() => setActive(card)}
              >
                <UserRound size={15} />
                <span>{card.name}</span>
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <section className="manager-panel">
      <div className="manager-list">
        <div className="section-heading">
          <span>角色卡片</span>
          <div className="section-heading-actions">
            <button title="从大纲生成角色卡片" onClick={onGenerate}>
              <Wand2 size={16} />
            </button>
            <button title="新建角色" onClick={() => setActive({ ...blankCard })}>
              <Plus size={16} />
            </button>
          </div>
        </div>
        {dragHint && <div className="drag-hint">{dragHint}</div>}
        {groupedCards.length ? groupedCards.map((group) => renderCategoryGroup(group)) : <div className="manager-empty">暂无角色卡片</div>}
      </div>
      <div className="form-panel">
        <h2 className="form-title">{active.id ? `编辑角色：${active.name || "未命名角色"}` : "新建角色"}</h2>
        <label>
          姓名
          <input value={active.name || ""} onChange={(event) => updateField("name", event.target.value)} />
        </label>
        <label>
          分类
          <input value={active.category || ""} placeholder="例如：主角团 / 十二英雄 / 反派" onChange={(event) => updateField("category", event.target.value)} />
        </label>
        <label>
          外貌
          <textarea value={active.appearance || ""} onChange={(event) => updateField("appearance", event.target.value)} />
        </label>
        <label>
          性格
          <textarea value={active.personality || ""} onChange={(event) => updateField("personality", event.target.value)} />
        </label>
        <label>
          背景
          <textarea value={active.background || ""} onChange={(event) => updateField("background", event.target.value)} />
        </label>
        <label>
          关系
          <textarea value={active.relationships || ""} onChange={(event) => updateField("relationships", event.target.value)} />
        </label>
        <label>
          备注
          <textarea value={active.notes || ""} onChange={(event) => updateField("notes", event.target.value)} />
        </label>
        <div className="form-actions">
          <button onClick={() => onSave(active)}>
            <Save size={16} />
            保存并加入知识库
          </button>
          {active.id && (
            <button className="danger" onClick={() => onDelete(active.id!)}>
              <Trash2 size={16} />
              删除
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function WorldManager({
  docs,
  onSave,
  onDelete,
  onGenerate,
}: {
  docs: WorldDoc[];
  onSave: (doc: Partial<WorldDoc>) => void;
  onDelete: (id: string) => void;
  onGenerate: () => void;
}) {
  const blankDoc = { title: "", category: DEFAULT_CATEGORY_LABEL, content: "# 新设定\n\n" };
  const [active, setActive] = useState<Partial<WorldDoc>>(docs[0] || blankDoc);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [draggingDocId, setDraggingDocId] = useState("");
  const [dragOverCategory, setDragOverCategory] = useState("");
  const [dragHint, setDragHint] = useState("");
  const groupedDocs = useMemo(() => groupByCategory(docs), [docs]);

  useEffect(() => {
    setActive((current) => docs.find((doc) => doc.id && doc.id === current.id) || docs[0] || { ...blankDoc, title: "新设定", content: "# 新设定\n\n" });
  }, [docs]);

  function toggleCategory(categoryKey: string) {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryKey)) next.delete(categoryKey);
      else next.add(categoryKey);
      return next;
    });
  }

  function moveDocToCategory(category: string) {
    if (!draggingDocId) return;
    const doc = docs.find((item) => item.id === draggingDocId);
    if (!doc) return;
    const next = { ...doc, category };
    setActive(next);
    onSave(next);
    setDraggingDocId("");
    setDragOverCategory("");
    setDragHint("");
  }

  function renderCategoryGroup(group: CategoryGroup<WorldDoc>, depth = 0) {
    const collapsed = collapsedCategories.has(group.key);
    return (
      <div className="manager-group" key={group.key}>
        <button
          className={`manager-group-header ${dragOverCategory === group.key ? "drag-over" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => toggleCategory(group.key)}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDragOverCategory(group.key);
            setDragHint(`将移动到「${group.key}」，分类等级 ${splitCategoryPath(group.key).length} 级`);
          }}
          onDragLeave={() => {
            setDragOverCategory((current) => (current === group.key ? "" : current));
            setDragHint("");
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            moveDocToCategory(group.key);
          }}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <span>{group.category}</span>
          <small>{group.count}</small>
        </button>
        {!collapsed && (
          <>
            {group.children.map((child) => renderCategoryGroup(child, depth + 1))}
            {group.items.map((doc) => (
              <button
                key={doc.id}
                className={`manager-item ${active.id === doc.id ? "active" : ""}`}
                draggable
                style={{ paddingLeft: 28 + depth * 14 }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", doc.id);
                  setDraggingDocId(doc.id);
                }}
                onDragEnd={() => {
                  setDraggingDocId("");
                  setDragOverCategory("");
                  setDragHint("");
                }}
                onClick={() => setActive(doc)}
              >
                <Boxes size={15} />
                <span>{doc.title}</span>
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <section className="manager-panel">
      <div className="manager-list">
        <div className="section-heading">
          <span>世界观</span>
          <div className="section-heading-actions">
            <button title="从大纲生成世界观条目" onClick={onGenerate}>
              <Sparkles size={16} />
            </button>
            <button title="新建设定" onClick={() => setActive({ ...blankDoc })}>
              <Plus size={16} />
            </button>
          </div>
        </div>
        {dragHint && <div className="drag-hint">{dragHint}</div>}
        {groupedDocs.length ? groupedDocs.map((group) => renderCategoryGroup(group)) : <div className="manager-empty">暂无世界观设定</div>}
      </div>
      <div className="form-panel world-editor">
        <h2 className="form-title">{active.id ? `编辑设定：${active.title || "未命名设定"}` : "新建设定"}</h2>
        <label>
          标题
          <input value={active.title || ""} onChange={(event) => setActive((doc) => ({ ...doc, title: event.target.value }))} />
        </label>
        <label>
          分类
          <input
            value={active.category || ""}
            placeholder="例如：地理 / 势力 / 神明/权柄"
            onChange={(event) => setActive((doc) => ({ ...doc, category: event.target.value }))}
          />
        </label>
        <label>
          设定正文
          <textarea value={active.content || ""} onChange={(event) => setActive((doc) => ({ ...doc, content: event.target.value }))} />
        </label>
        <div className="form-actions">
          <button onClick={() => onSave(active)}>
            <Save size={16} />
            保存并加入知识库
          </button>
          {active.id && (
            <button className="danger" onClick={() => onDelete(active.id!)}>
              <Trash2 size={16} />
              删除
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function SettingsModal({
  state,
  selectedChapterId,
  onClose,
  onSave,
}: {
  state: AppState;
  selectedChapterId?: string;
  onClose: () => void;
  onSave: (state: AppState) => void;
}) {
  const [draft, setDraft] = useState(state.config);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const provider = draft.api.provider;

  function updateApi<K extends keyof typeof draft.api>(key: K, value: (typeof draft.api)[K]) {
    setDraft((config) => ({ ...config, api: { ...config.api, [key]: value } }));
  }

  function updateUi<K extends keyof typeof draft.ui>(key: K, value: (typeof draft.ui)[K]) {
    setDraft((config) => ({ ...config, ui: { ...config.ui, [key]: value } }));
  }

  async function save() {
    setSaving(true);
    setErrorText("");
    const normalized = {
      ...draft,
      api: {
        ...draft.api,
        temperature: clampNumber(Number(draft.api.temperature), 0, 2, 0.7),
        maxTokens: Math.floor(clampNumber(Number(draft.api.maxTokens), 1, MAX_CHAT_TOKENS, 8000)),
        topK: Math.floor(clampNumber(Number(draft.api.topK), 1, MAX_RETRIEVAL_TOP_K, 5)),
        scanK: Math.floor(clampNumber(Number(draft.api.scanK), Number(draft.api.topK) || 1, MAX_RETRIEVAL_SCAN_K, 5000)),
      },
    };
    try {
      const next = await window.novelAPI.saveProjectSettings({ ...normalized, selectedChapterId });
      onSave(next);
    } catch (error) {
      setErrorText(`保存设置失败：${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="settings-modal">
        <header>
          <div>
            <Settings size={20} />
            <strong>设置</strong>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>

        <div className="settings-grid">
          <label>
            小说名称
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label>
            作者
            <input value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })} />
          </label>
          <label>
            接口提供商
            <select
              value={provider}
              onChange={(event) => {
                const nextProvider = event.target.value as Provider;
                const defaults = PROVIDER_DEFAULTS[nextProvider];
                setDraft({
                  ...draft,
                  api: {
                    ...draft.api,
                    provider: nextProvider,
                    baseUrl: defaults.baseUrl,
                    chatModel: defaults.model,
                  },
                });
              }}
            >
              {(Object.keys(PROVIDER_DEFAULTS) as Provider[]).map((item) => (
                <option value={item} key={item}>
                  {PROVIDER_DEFAULTS[item].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            接口密钥
            <input type="password" value={draft.api.apiKey} onChange={(event) => updateApi("apiKey", event.target.value)} />
          </label>
          <label>
            接口地址
            <input value={draft.api.baseUrl} onChange={(event) => updateApi("baseUrl", event.target.value)} />
          </label>
          <label>
            聊天模型
            <input value={draft.api.chatModel} onChange={(event) => updateApi("chatModel", event.target.value)} />
          </label>
          <label>
            创造性
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={draft.api.temperature}
              onChange={(event) => updateApi("temperature", clampNumber(Number(event.target.value), 0, 2, 0.7))}
            />
          </label>
          <label>
            最大输出字数
            <input
              type="number"
              min="1"
              max={MAX_CHAT_TOKENS}
              value={draft.api.maxTokens}
              onChange={(event) => updateApi("maxTokens", Math.floor(clampNumber(Number(event.target.value), 1, MAX_CHAT_TOKENS, 8000)))}
            />
          </label>
          <label>
            发送片段上限（最高 1000）
            <input
              type="number"
              min="1"
              max={MAX_RETRIEVAL_TOP_K}
              value={draft.api.topK}
              onChange={(event) => updateApi("topK", Math.floor(clampNumber(Number(event.target.value), 1, MAX_RETRIEVAL_TOP_K, 5)))}
            />
          </label>
          <label>
            候选扫描上限（最高 50000）
            <input
              type="number"
              min={Math.max(1, Number(draft.api.topK) || 1)}
              max={MAX_RETRIEVAL_SCAN_K}
              value={draft.api.scanK}
              onChange={(event) => updateApi("scanK", Math.floor(clampNumber(Number(event.target.value), Math.max(1, Number(draft.api.topK) || 1), MAX_RETRIEVAL_SCAN_K, 5000)))}
            />
          </label>
          <label>
            向量接口地址
            <input value={draft.api.embeddingBaseUrl} onChange={(event) => updateApi("embeddingBaseUrl", event.target.value)} />
          </label>
          <label>
            向量接口密钥
            <input type="password" value={draft.api.embeddingApiKey} onChange={(event) => updateApi("embeddingApiKey", event.target.value)} />
          </label>
          <label>
            向量模型
            <input value={draft.api.embeddingModel} onChange={(event) => updateApi("embeddingModel", event.target.value)} />
          </label>
          <label>
            字号
            <input type="number" min="13" max="28" value={draft.ui.fontSize} onChange={(event) => updateUi("fontSize", Number(event.target.value))} />
          </label>
          <label>
            行距
            <input
              type="number"
              min="1.3"
              max="2.4"
              step="0.05"
              value={draft.ui.lineHeight}
              onChange={(event) => updateUi("lineHeight", Number(event.target.value))}
            />
          </label>
          <label>
            自动保存毫秒
            <input type="number" min="600" value={draft.ui.autosaveMs} onChange={(event) => updateUi("autosaveMs", Number(event.target.value))} />
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={draft.ui.backupOnSave} onChange={(event) => updateUi("backupOnSave", event.target.checked)} />
            每次保存后自动备份
          </label>
        </div>

        <div className="settings-help">
          <strong>接口说明</strong>
          <p>DeepSeek 推荐：接口地址 https://api.deepseek.com/v1，聊天模型 deepseek-chat。通义千问推荐：接口地址 https://dashscope.aliyuncs.com/compatible-mode/v1，聊天模型 qwen-plus。候选扫描上限表示本地最多先看多少片段，发送片段上限表示最多交给 AI 多少片段。长篇项目建议候选扫描 5000-20000，发送片段日常 80-180，全书分析再临时提高。DeepSeek、通义千问、OpenAI、Kimi、Ollama 和大多数中转接口使用 /chat/completions；Claude 使用 /v1/messages。向量接口使用 /embeddings。若不填向量接口密钥，软件会使用本地哈希向量作为临时索引。</p>
        </div>

        <footer>
          {errorText && <span className="settings-error">{errorText}</span>}
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "保存中..." : "保存设置"}
          </button>
        </footer>
      </section>
    </div>
  );
}
