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
  Heading1,
  Heading2,
  Heading3,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  ListTree,
  ListChecks,
  Lock,
  Maximize2,
  Minimize2,
  MessageSquarePlus,
  Minus,
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
  Square,
  Sun,
  Table2,
  Trash2,
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
  BackgroundTaskType,
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
import { CreativeWorkspace, type CreativeWorkspaceTab } from "./components/CreativeWorkspace";

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

interface EditorScrollAnchor {
  key: number;
  headingIndex?: number;
  quote?: string;
}
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
  let remainingChars = 600000;
  return messages
    .slice(-40)
    .reverse()
    .map((message) => {
      const maxForMessage = Math.min(240000, remainingChars);
      const content = message.content.slice(0, maxForMessage);
      remainingChars = Math.max(0, remainingChars - content.length);
      return {
        ...message,
        content,
        context: message.context?.slice(0, 8).map((chunk) => ({
          ...chunk,
          text: chunk.text.slice(0, 900),
        })),
      };
    })
    .reverse();
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

function moveCurrentTopLevelBlock(editor: Editor, direction: -1 | 1) {
  const blocks: Array<{ pos: number; node: Editor["state"]["doc"] }> = [];
  editor.state.doc.forEach((node, offset) => blocks.push({ pos: offset, node: node as Editor["state"]["doc"] }));
  const selectionPos = editor.state.selection.from;
  const currentIndex = blocks.findIndex((item) => selectionPos >= item.pos && selectionPos <= item.pos + item.node.nodeSize);
  const targetIndex = currentIndex + direction;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= blocks.length) return false;
  const firstIndex = Math.min(currentIndex, targetIndex);
  const secondIndex = Math.max(currentIndex, targetIndex);
  const first = blocks[firstIndex];
  const second = blocks[secondIndex];
  const replacement = direction < 0 ? [second.node, first.node] : [second.node, first.node];
  const transaction = editor.state.tr.replaceWith(first.pos, second.pos + second.node.nodeSize, replacement);
  const nextPos = direction < 0 ? first.pos + 1 : first.pos + second.node.nodeSize + 1;
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(transaction.doc.content.size, nextPos))));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.commands.focus();
  return true;
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

interface InlineReviewItem {
  id: string;
  kind: "annotation" | "revision";
  quote: string;
  label: string;
  status: string;
}

const inlineReviewPluginKey = new PluginKey<{ items: InlineReviewItem[]; decorations: DecorationSet }>("inlineReviews");

function buildReviewTextIndex(doc: Editor["state"]["doc"]) {
  const chars: string[] = [];
  const positions: Array<number | null> = [];
  let previousEnd = -1;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    if (previousEnd >= 0 && pos > previousEnd) {
      chars.push("\n");
      positions.push(null);
    }
    for (let index = 0; index < node.text.length; index += 1) {
      chars.push(node.text[index]);
      positions.push(pos + index);
    }
    previousEnd = pos + node.text.length;
    return true;
  });
  const normalized: string[] = [];
  const normalizedPositions: Array<number | null> = [];
  let inWhitespace = false;
  chars.forEach((char, index) => {
    if (/\s/.test(char)) {
      if (!inWhitespace && normalized.length) {
        normalized.push(" ");
        normalizedPositions.push(positions[index]);
      }
      inWhitespace = true;
      return;
    }
    inWhitespace = false;
    normalized.push(char);
    normalizedPositions.push(positions[index]);
  });
  return { text: normalized.join("").trim(), positions: normalizedPositions };
}

function buildInlineReviewDecorations(doc: Editor["state"]["doc"], items: InlineReviewItem[]) {
  if (!items.length) return DecorationSet.empty;
  const index = buildReviewTextIndex(doc);
  const decorations: Decoration[] = [];
  items.forEach((item) => {
    const quote = item.quote.replace(/\s+/g, " ").trim();
    if (!quote) return;
    const offset = index.text.indexOf(quote);
    if (offset < 0) return;
    const from = index.positions[offset];
    const last = index.positions[offset + quote.length - 1];
    if (typeof from !== "number" || typeof last !== "number" || last < from) return;
    decorations.push(Decoration.inline(from, last + 1, {
      class: `inline-review inline-review-${item.kind}`,
      "data-review-id": item.id,
      title: `${item.status}：${item.label}`,
    }));
  });
  return DecorationSet.create(doc, decorations);
}

const InlineReviews = Extension.create({
  name: "inlineReviews",
  addProseMirrorPlugins() {
    return [new Plugin<{ items: InlineReviewItem[]; decorations: DecorationSet }>({
      key: inlineReviewPluginKey,
      state: {
        init: () => ({ items: [] as InlineReviewItem[], decorations: DecorationSet.empty }),
        apply(transaction, current, _oldState, nextState) {
          const nextItems = transaction.getMeta(inlineReviewPluginKey) as InlineReviewItem[] | undefined;
          const items = nextItems || current.items;
          if (!transaction.docChanged && !nextItems) return current;
          return { items, decorations: buildInlineReviewDecorations(nextState.doc, items) };
        },
      },
      props: {
        decorations(state) {
          return inlineReviewPluginKey.getState(state)?.decorations || DecorationSet.empty;
        },
      },
    })];
  },
});

const DocxImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: (element) => element.getAttribute("data-docx-width") || element.getAttribute("width"), renderHTML: (attributes) => attributes.width ? { width: attributes.width, "data-docx-width": attributes.width } : {} },
      height: { default: null, parseHTML: (element) => element.getAttribute("data-docx-height") || element.getAttribute("height"), renderHTML: (attributes) => attributes.height ? { height: attributes.height, "data-docx-height": attributes.height } : {} },
      docxPosition: { default: "inline", parseHTML: (element) => element.getAttribute("data-docx-position") || "inline", renderHTML: (attributes) => ({ "data-docx-position": attributes.docxPosition || "inline" }) },
      docxAlign: { default: "center", parseHTML: (element) => element.getAttribute("data-docx-align") || "center", renderHTML: (attributes) => ({ "data-docx-align": attributes.docxAlign || "center" }) },
    };
  },
});

const DocxTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      docxWidth: { default: 100, parseHTML: (element) => Number(element.getAttribute("data-docx-width") || 100), renderHTML: (attributes) => ({ "data-docx-width": attributes.docxWidth || 100, style: `width:${attributes.docxWidth || 100}%` }) },
    };
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
  const [aiProgress, setAiProgress] = useState<{ phase: string; streamedChars: number; retrieval?: RetrievalDiagnostics } | null>(null);
  const [draggingChapterId, setDraggingChapterId] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ProgressState | null>(null);
  const [indexProgress, setIndexProgress] = useState<ProgressState | null>(null);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(520);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [aiExpanded, setAiExpanded] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(46);
  const [recoveryDrafts, setRecoveryDrafts] = useState<RecoveryDraft[]>([]);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const richEditorRef = useRef<Editor | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const selectedChapterIdRef = useRef("");
  const chapterRevisionRef = useRef("");
  const chapterLoadRequestRef = useRef(0);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const chapterDraftRef = useRef({ content: "", title: "", volume: "" });

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
        setLeftWidth(Math.min(520, Math.max(210, recovery.windowState.leftWidth || 280)));
        setRightWidth(Math.min(900, Math.max(360, recovery.windowState.rightWidth || 520)));
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
        setStatus(draftUnchanged ? `已保存，${mode}` : "已保存此前版本，当前还有新改动待保存");
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

  const saveBeforeLeavingChapter = useCallback(async () => {
    if (!dirty) return true;
    return saveChapter();
  }, [dirty, saveChapter]);

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
  const paneWidths = useMemo(() => {
    const centerMinimum = aiExpanded ? 240 : 380;
    const rightMinimum = aiExpanded ? 520 : 360;
    const sideBudget = Math.max(570, viewportWidth - centerMinimum - 12);
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
      setView("analysis");
      setStatus(`已从选中文字提取 ${result.candidates.length} 个候选；请在分析页勾选后写入世界观`);
    } catch (error) {
      setStatus(`提取设定失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function openWorkspaceFromSelection(tab: CreativeWorkspaceTab, text: string) {
    setContextMenu(null);
    setSelectedText(text);
    setStoryCenterInitialTab("workspace");
    setWorkspaceInitialTab(tab);
    setShowStoryCenter(true);
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
      if (action === "exportBookDocx") void exportBookDocx({ includeOutline: true, includeMaterials: true });
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
          <button onClick={() => void exportBookDocx({ includeOutline: false, includeMaterials: false, includeCharacters: false, includeWorld: false })} title="每篇正文分别导出为一个 Word 文档">
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
          gridTemplateColumns: focusMode ? "minmax(520px, 1fr)" : `${paneWidths.left}px 6px minmax(${paneWidths.centerMinimum}px, 1fr) 6px ${paneWidths.right}px`,
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
            <section key={selectedChapter?.id || "empty-document"} className="editor-panel">
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
                      setStoryCenterInitialTab("workspace");
                      setWorkspaceInitialTab(review.kind === "revision" ? "revisions" : "annotations");
                      setShowStoryCenter(true);
                    }}
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
            onToggleExpanded={() => setAiExpanded((value) => !value)}
            onOpenStoryCenter={() => setShowStoryCenter(true)}
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
            setShowSettings(true);
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
            setShowStoryCenter(true);
          }}
          onStatus={setStatus}
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

type StoryCenterTab = "facts" | "characters" | "foreshadows" | "board" | "snapshots" | "workspace";

function StoryCenterModal({
  state,
  selectedChapterId,
  selectedText,
  chapterRevision,
  initialTab = "facts",
  workspaceInitialTab = "planning",
  onClose,
  onOpenChapter,
  onOpenEvidence,
  onApplyState,
  onTaskCreated,
  onStatus,
}: {
  state: AppState;
  selectedChapterId: string;
  selectedText: string;
  chapterRevision: string;
  initialTab?: StoryCenterTab;
  workspaceInitialTab?: CreativeWorkspaceTab;
  onClose: () => void;
  onOpenChapter: (chapterId: string) => void;
  onOpenEvidence: (chapterId: string, quote: string) => void;
  onApplyState: (state: AppState) => void;
  onTaskCreated: (task: BackgroundTask) => void;
  onStatus: (message: string) => void;
}) {
  const [tab, setTab] = useState<StoryCenterTab>(initialTab);
  const [overview, setOverview] = useState<StoryOverview | null>(null);
  const [board, setBoard] = useState<ChapterPreparationBoard | null>(null);
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([]);
  const [branches, setBranches] = useState<ProjectBranches | null>(null);
  const [snapshotComparison, setSnapshotComparison] = useState<ProjectSnapshotComparison | null>(null);
  const [snapshotRestorePaths, setSnapshotRestorePaths] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [factStatus, setFactStatus] = useState<StoryFactStatus | "全部">("全部");
  const [foreshadowStatus, setForeshadowStatus] = useState<ForeshadowStatus | "全部">("全部");
  const [volumeFilter, setVolumeFilter] = useState("全部");
  const [chapterFilter, setChapterFilter] = useState("全部");
  const [entryEditor, setEntryEditor] = useState<null | {
    kind: "fact" | "foreshadow";
    id?: string;
    chapterId: string;
    title: string;
    subject: string;
    type: string;
    detail: string;
    plannedPayoff: string;
    userNote: string;
  }>(null);
  const [busy, setBusy] = useState("");
  const [draggingBeatId, setDraggingBeatId] = useState("");
  const overviewRequestRef = useRef(0);
  const selectedChapter = state.chapters.find((chapter) => chapter.id === selectedChapterId) || state.chapters[0];

  useEffect(() => setTab(initialTab), [initialTab]);

  const loadOverview = useCallback(async () => {
    const requestId = ++overviewRequestRef.current;
    setBusy("overview");
    try {
      const result = await window.novelAPI.getStoryOverview({
        chapterIds: chapterFilter === "全部" ? [] : [chapterFilter],
        volume: volumeFilter === "全部" ? undefined : volumeFilter,
        query: query.trim(),
        factStatus: factStatus === "全部" ? undefined : factStatus,
        foreshadowStatus: foreshadowStatus === "全部" ? undefined : foreshadowStatus,
        factLimit: 100,
        characterLimit: 100,
        foreshadowLimit: 100,
      });
      if (requestId === overviewRequestRef.current) setOverview(result);
    } catch (error) {
      onStatus(`读取创作状态失败：${getErrorMessage(error)}`);
    } finally {
      if (requestId === overviewRequestRef.current) setBusy("");
    }
  }, [chapterFilter, factStatus, foreshadowStatus, onStatus, query, state.projectPath, volumeFilter]);

  const loadBoard = useCallback(async () => {
    if (!selectedChapter?.id) return;
    const result = await window.novelAPI.getChapterBoard(selectedChapter.id);
    setBoard(result.board);
  }, [selectedChapter?.id]);

  const loadSnapshots = useCallback(async () => {
    const result = await window.novelAPI.listSnapshots();
    setSnapshots(result.snapshots);
    setBranches(result.branches);
  }, [state.projectPath]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOverview(), 180);
    return () => window.clearTimeout(timer);
  }, [loadOverview]);

  useEffect(() => {
    if (tab === "board") void loadBoard().catch((error) => onStatus(`读取筹备板失败：${getErrorMessage(error)}`));
    if (tab === "snapshots") void loadSnapshots().catch((error) => onStatus(`读取快照失败：${getErrorMessage(error)}`));
  }, [loadBoard, loadSnapshots, onStatus, tab]);

  const visibleFacts = overview?.facts || [];
  const volumes = useMemo(() => [...new Set(state.chapters.map((chapter) => chapter.volume || "未分卷"))], [state.chapters]);
  const filterChapters = useMemo(() => state.chapters.filter((chapter) => volumeFilter === "全部" || (chapter.volume || "未分卷") === volumeFilter), [state.chapters, volumeFilter]);

  async function runLocalAnalysis(chapterIds: string[]) {
    if (!chapterIds.length) {
      const result = await window.novelAPI.enqueueTask({
        type: "story-analysis",
        title: "本地更新全书创作状态",
        total: state.chapters.length,
        scope: { chapterIds: [] },
        options: { useAI: false },
      });
      onTaskCreated(result.task);
      onStatus("已加入后台任务：本地更新全书创作状态");
      return;
    }
    setBusy("local");
    try {
      await window.novelAPI.analyzeStoryLocally({ chapterIds });
      await loadOverview();
      onStatus(`本地创作状态已更新：${chapterIds.length ? "当前文档" : "全项目"}`);
    } catch (error) {
      onStatus(`更新创作状态失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function enqueueDeepAnalysis(chapterIds: string[]) {
    const total = chapterIds.length || state.chapters.length;
    const result = await window.novelAPI.enqueueTask({
      type: "story-analysis",
      title: chapterIds.length === 1 ? `深度分析：${selectedChapter?.title || "当前文档"}` : "AI 深度整理全书创作状态",
      total,
      scope: { chapterIds },
      options: { useAI: true },
    });
    onTaskCreated(result.task);
    onStatus(`已加入后台任务：${result.task.title}`);
  }

  async function updateFactStatus(fact: StoryFact, status: StoryFactStatus) {
    const updated = await window.novelAPI.updateStoryFact({ factId: fact.id, patch: { status } });
    setOverview((current) => current ? { ...current, facts: current.facts.map((item) => item.id === updated.id ? updated : item) } : current);
  }

  async function updateForeshadowStatus(item: ForeshadowItem, status: ForeshadowStatus) {
    const updated = await window.novelAPI.updateForeshadow({ foreshadowId: item.id, patch: { status } });
    setOverview((current) => current ? { ...current, foreshadows: current.foreshadows.map((candidate) => candidate.id === updated.id ? updated : candidate) } : current);
  }

  function openEntryEditor(kind: "fact" | "foreshadow", item?: StoryFact | ForeshadowItem) {
    const chapterId = kind === "fact" && item ? (item as StoryFact).chapterId : kind === "foreshadow" && item ? (item as ForeshadowItem).plantedAt[0]?.chapterId : selectedChapter?.id;
    setEntryEditor({
      kind,
      id: item?.id,
      chapterId: chapterId || selectedChapter?.id || "",
      title: kind === "foreshadow" && item ? (item as ForeshadowItem).title : "",
      subject: kind === "fact" && item ? (item as StoryFact).subject : "",
      type: kind === "fact" && item ? (item as StoryFact).type : "剧情事件",
      detail: kind === "fact" && item ? (item as StoryFact).object : kind === "foreshadow" && item ? (item as ForeshadowItem).description : "",
      plannedPayoff: kind === "foreshadow" && item ? (item as ForeshadowItem).plannedPayoff || "" : "",
      userNote: item?.userNote || "",
    });
  }

  async function saveEntryEditor() {
    if (!entryEditor) return;
    setBusy("entry");
    try {
      if (entryEditor.kind === "fact") {
        if (entryEditor.id) {
          await window.novelAPI.updateStoryFact({ factId: entryEditor.id, patch: { subject: entryEditor.subject, type: entryEditor.type, predicate: entryEditor.type, object: entryEditor.detail, userNote: entryEditor.userNote } });
        } else {
          await window.novelAPI.createStoryFact({ chapterId: entryEditor.chapterId, subject: entryEditor.subject, type: entryEditor.type, predicate: entryEditor.type, object: entryEditor.detail, userNote: entryEditor.userNote });
        }
      } else if (entryEditor.id) {
        await window.novelAPI.updateForeshadow({ foreshadowId: entryEditor.id, patch: { title: entryEditor.title, description: entryEditor.detail, plannedPayoff: entryEditor.plannedPayoff, userNote: entryEditor.userNote } });
      } else {
        await window.novelAPI.createForeshadow({ chapterId: entryEditor.chapterId, title: entryEditor.title, description: entryEditor.detail, plannedPayoff: entryEditor.plannedPayoff, userNote: entryEditor.userNote });
      }
      setEntryEditor(null);
      await loadOverview();
      onStatus(entryEditor.id ? "创作状态记录已更新" : "已添加人工创作状态记录");
    } catch (error) {
      onStatus(`保存记录失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function deleteManualEntry(kind: "fact" | "foreshadow", id: string) {
    if (!window.confirm("确定删除这条人工记录吗？")) return;
    try {
      if (kind === "fact") await window.novelAPI.deleteStoryFact(id);
      else await window.novelAPI.deleteForeshadow(id);
      await loadOverview();
      onStatus("人工记录已删除");
    } catch (error) {
      onStatus(`删除失败：${getErrorMessage(error)}`);
    }
  }

  async function loadMore(kind: "facts" | "characters" | "foreshadows") {
    if (!overview) return;
    const requestId = ++overviewRequestRef.current;
    const result = await window.novelAPI.getStoryOverview({
      chapterIds: chapterFilter === "全部" ? [] : [chapterFilter],
      volume: volumeFilter === "全部" ? undefined : volumeFilter,
      query: query.trim(),
      factStatus: factStatus === "全部" ? undefined : factStatus,
      foreshadowStatus: foreshadowStatus === "全部" ? undefined : foreshadowStatus,
      factOffset: kind === "facts" ? overview.facts.length : 0,
      characterOffset: kind === "characters" ? overview.characterStates.length : 0,
      foreshadowOffset: kind === "foreshadows" ? overview.foreshadows.length : 0,
      factLimit: kind === "facts" ? 100 : 20,
      characterLimit: kind === "characters" ? 100 : 20,
      foreshadowLimit: kind === "foreshadows" ? 100 : 20,
    });
    if (requestId !== overviewRequestRef.current) return;
    setOverview((current) => current ? {
      ...current,
      facts: kind === "facts" ? [...current.facts, ...result.facts] : current.facts,
      characterStates: kind === "characters" ? [...current.characterStates, ...result.characterStates] : current.characterStates,
      foreshadows: kind === "foreshadows" ? [...current.foreshadows, ...result.foreshadows] : current.foreshadows,
      pageInfo: { facts: kind === "facts" ? result.pageInfo!.facts : current.pageInfo!.facts, characters: kind === "characters" ? result.pageInfo!.characters : current.pageInfo!.characters, foreshadows: kind === "foreshadows" ? result.pageInfo!.foreshadows : current.pageInfo!.foreshadows },
    } : current);
  }

  async function updatePendingCoverage() {
    const chapterIds = [...new Set([...(overview?.coverage.missing || []), ...(overview?.coverage.stale || [])])];
    if (!chapterIds.length) return;
    const result = await window.novelAPI.enqueueTask({ type: "story-analysis", title: `更新 ${chapterIds.length} 个待处理文档`, total: chapterIds.length, scope: { chapterIds }, options: { useAI: false } });
    onTaskCreated(result.task);
    onStatus(`已在后台更新 ${chapterIds.length} 个缺失或过期文档`);
  }

  async function generateBoard() {
    if (!selectedChapter?.id) return;
    setBusy("board");
    try {
      const result = await window.novelAPI.generateChapterBoard({ chapterId: selectedChapter.id });
      setBoard(result.board);
      onStatus("已根据当前创作状态生成筹备板");
    } catch (error) {
      onStatus(`生成筹备板失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function improveBoardWithAI() {
    if (!selectedChapter?.id) return;
    const result = await window.novelAPI.enqueueTask({
      type: "creative-board",
      title: `AI 完善筹备板：${selectedChapter.title}`,
      total: 3,
      scope: { chapterId: selectedChapter.id },
      options: { useAI: true },
    });
    onTaskCreated(result.task);
  }

  function patchBoardItem(itemId: string, patch: Partial<ChapterPreparationBoard["items"][number]>) {
    setBoard((current) => current ? { ...current, items: current.items.map((item) => item.id === itemId ? { ...item, ...patch } : item) } : current);
  }

  async function addCustomBoardItem() {
    if (!selectedChapter?.id) return;
    let current = board;
    if (!current) current = (await window.novelAPI.generateChapterBoard({ chapterId: selectedChapter.id })).board;
    const item = {
      id: `beat_manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: "自定义",
      title: "新的筹备项",
      detail: "",
      order: current.items.length,
      locked: true,
      completed: false,
      sourceRefs: [],
    };
    setBoard({ ...current, items: [...current.items, item] });
  }

  function moveBoardItem(targetId: string) {
    if (!board || !draggingBeatId || draggingBeatId === targetId) return;
    const items = [...board.items];
    const fromIndex = items.findIndex((item) => item.id === draggingBeatId);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    const [moved] = items.splice(fromIndex, 1);
    items.splice(targetIndex, 0, moved);
    setBoard({ ...board, items: items.map((item, index) => ({ ...item, order: index })) });
  }

  async function saveBoard() {
    if (!board) return;
    setBusy("save-board");
    try {
      setBoard((await window.novelAPI.saveChapterBoard({ board })).board);
      onStatus("下一章筹备板已保存");
    } finally {
      setBusy("");
    }
  }

  async function enqueueSnapshot() {
    const result = await window.novelAPI.enqueueTask({
      type: "snapshot",
      title: "手动项目快照",
      options: { name: `手动快照 ${new Date().toLocaleString("zh-CN")}`, reason: "用户手动创建" },
    });
    onTaskCreated(result.task);
  }

  async function restoreSnapshot(snapshot: ProjectSnapshot, paths: string[] = []) {
    try {
      setBusy("compare");
      const comparison = await window.novelAPI.compareSnapshot(snapshot.id);
      setSnapshotComparison(comparison);
      const changeSummary = `修改 ${comparison.changed.length} 个、新增 ${comparison.added.length} 个、当前缺失 ${comparison.missing.length} 个文件`;
      const partial = paths.length > 0;
      if (!window.confirm(partial ? `确定从“${snapshot.name}”恢复选中的 ${paths.length} 个文件吗？恢复前会自动创建安全快照，其他文件不变。` : `快照“${snapshot.name}”与当前项目相比：${changeSummary}。\n\n确定恢复吗？恢复前会自动创建安全快照，快照后新增的受管文件会被清理。`)) return;
      setBusy("restore");
      const result = await window.novelAPI.restoreSnapshot({ snapshotId: snapshot.id, paths });
      onTaskCreated(result.task);
      onApplyState(result.state);
      onStatus(partial ? `已从快照恢复 ${result.restored} 个文件，知识库正在后台重建` : `已恢复项目快照：${snapshot.name}；清理 ${result.removed} 个新增文件，知识库正在后台重建`);
      onClose();
    } catch (error) {
      onStatus(`恢复快照失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function compareSnapshot(snapshot: ProjectSnapshot) {
    setBusy("compare");
    try {
      const comparison = await window.novelAPI.compareSnapshot(snapshot.id);
      setSnapshotComparison(comparison);
      setSnapshotRestorePaths([...comparison.changed, ...comparison.missing]);
    } catch (error) {
      onStatus(`比较快照失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function compareBranch(snapshotId: string) {
    if (!snapshotId) return onStatus("这个分支还没有可比较的起点快照。");
    setBusy("compare");
    try {
      const comparison = await window.novelAPI.compareSnapshot(snapshotId);
      setSnapshotComparison(comparison);
      setSnapshotRestorePaths([...comparison.changed, ...comparison.missing]);
    } catch (error) {
      onStatus(`比较分支失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function renameSnapshot(snapshot: ProjectSnapshot) {
    const name = window.prompt("输入新的快照名称", snapshot.name)?.trim();
    if (!name || name === snapshot.name) return;
    try {
      await window.novelAPI.renameSnapshot({ snapshotId: snapshot.id, name });
      await loadSnapshots();
      onStatus("快照已重命名");
    } catch (error) {
      onStatus(`重命名快照失败：${getErrorMessage(error)}`);
    }
  }

  async function deleteSnapshot(snapshot: ProjectSnapshot) {
    if (!window.confirm(`确定删除快照“${snapshot.name}”吗？被创作分支使用的快照不会被删除。`)) return;
    try {
      const result = await window.novelAPI.deleteSnapshot(snapshot.id);
      await loadSnapshots();
      setSnapshotComparison((current) => current?.snapshot.id === snapshot.id ? null : current);
      onStatus(`快照已删除，并清理 ${result.garbageCollection.removedObjects} 个不再使用的数据对象`);
    } catch (error) {
      onStatus(`删除快照失败：${getErrorMessage(error)}`);
    }
  }

  async function cleanupSnapshots() {
    try {
      const result = await window.novelAPI.cleanupSnapshots();
      onStatus(`快照存储清理完成：移除 ${result.removedObjects} 个无引用对象，释放 ${(result.removedBytes / 1024 / 1024).toFixed(1)} MB`);
    } catch (error) {
      onStatus(`清理快照存储失败：${getErrorMessage(error)}`);
    }
  }

  async function createBranch() {
    const name = window.prompt("输入实验分支名称", `实验分支 ${new Date().toLocaleDateString("zh-CN")}`)?.trim();
    if (!name) return;
    setBusy("branch");
    try {
      const result = await window.novelAPI.createBranch({ name });
      setBranches(result.branches);
      await loadSnapshots();
      onStatus(`已创建创作分支：${result.branch.name}`);
    } catch (error) {
      onStatus(`创建分支失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function switchBranch(branchId: string) {
    const branch = branches?.branches.find((item) => item.id === branchId);
    if (!branch || branch.id === branches?.activeBranchId) return;
    if (!window.confirm(`切换到“${branch.name}”吗？当前分支会先自动创建快照。`)) return;
    setBusy("branch");
    try {
      const result = await window.novelAPI.switchBranch(branch.id);
      setBranches(result.branches);
      if (result.task) onTaskCreated(result.task);
      onApplyState(result.state);
      onStatus(`已切换创作分支：${result.activeBranch.name}；知识库正在后台重建`);
      onClose();
    } catch (error) {
      onStatus(`切换分支失败：${getErrorMessage(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function deleteBranch(branchId: string) {
    const branch = branches?.branches.find((item) => item.id === branchId);
    if (!branch || branch.id === "main" || branch.id === branches?.activeBranchId) return;
    if (!window.confirm(`确定删除实验分支“${branch.name}”吗？分支对应的快照仍会保留。`)) return;
    try {
      const result = await window.novelAPI.deleteBranch(branch.id);
      setBranches(result.branches);
      onStatus(`实验分支已删除：${branch.name}`);
    } catch (error) {
      onStatus(`删除分支失败：${getErrorMessage(error)}`);
    }
  }

  const tabs: Array<{ id: StoryCenterTab; label: string; count?: number }> = [
    { id: "facts", label: "剧情事实", count: overview?.counts.facts },
    { id: "characters", label: "角色状态", count: overview?.characterStates.length },
    { id: "foreshadows", label: "伏笔", count: overview?.counts.foreshadows },
    { id: "board", label: "下一章筹备", count: board?.items.length },
    { id: "snapshots", label: "快照与分支", count: snapshots.length },
    { id: "workspace", label: "创作工作台", count: (overview?.counts.boards || 0) + (overview?.counts.foreshadows || 0) },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="story-center-modal" onClick={(event) => event.stopPropagation()}>
        <header className="story-center-header">
          <div><Activity size={18} /><strong>创作状态</strong></div>
          <div className="story-center-summary">
            <span>覆盖 {overview?.coverage.analyzed || 0}/{overview?.coverage.total || state.chapters.length}</span>
            {!!overview?.coverage.stale.length && <span className="warning">{overview.coverage.stale.length} 章待更新</span>}
            {!!overview?.coverage.missing.length && <span className="warning">{overview.coverage.missing.length} 章未整理</span>}
          </div>
          <button onClick={onClose} title="关闭"><X size={17} /></button>
        </header>
        <div className="story-center-tabs">
          {tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}{item.count !== undefined ? ` ${item.count}` : ""}</button>)}
        </div>
        {tab !== "workspace" && <div className="story-center-toolbar">
          <button onClick={() => void runLocalAnalysis(selectedChapter?.id ? [selectedChapter.id] : [])} disabled={Boolean(busy)}>更新当前文档</button>
          <button onClick={() => void enqueueDeepAnalysis(selectedChapter?.id ? [selectedChapter.id] : [])}>AI 深度分析当前文档</button>
          <details>
            <summary>全书操作</summary>
            <div>
              <button onClick={() => void runLocalAnalysis([])} disabled={Boolean(busy)}>本地更新全书</button>
              <button onClick={() => void enqueueDeepAnalysis([])}>AI 深度分析全书</button>
            </div>
          </details>
          {!!((overview?.coverage.stale.length || 0) + (overview?.coverage.missing.length || 0)) && <button onClick={() => void updatePendingCoverage()}>更新待处理文档</button>}
          {busy && <span>正在处理...</span>}
        </div>}
        <div className="story-center-body">
          {tab === "facts" && (
            <section className="story-facts-view">
              <div className="story-filter-row">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索人物、事件或章节" />
                <select value={volumeFilter} onChange={(event) => { setVolumeFilter(event.target.value); setChapterFilter("全部"); }}><option value="全部">全部分卷</option>{volumes.map((volume) => <option key={volume}>{volume}</option>)}</select>
                <select value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)}><option value="全部">全部文档</option>{filterChapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select>
                <select value={factStatus} onChange={(event) => setFactStatus(event.target.value as StoryFactStatus | "全部")}>
                  <option value="全部">全部状态</option><option value="AI识别">AI识别</option><option value="已确认">已确认</option><option value="已忽略">已忽略</option>
                </select>
                <button onClick={() => openEntryEditor("fact")}><Plus size={14} />人工事实</button>
              </div>
              <div className="story-list">
                {visibleFacts.map((fact) => (
                  <article key={fact.id} className="story-row">
                    <div><strong>{fact.subject}</strong><span>{fact.type} / {fact.chapterTitle}{fact.stale ? " / 原文已变化，待核对" : ""}</span></div>
                    <p>{fact.object}</p>
                    {!!fact.evidence.length && <button className="evidence-link" onClick={() => fact.evidence[0].heading === "人工记录" ? onOpenChapter(fact.chapterId) : onOpenEvidence(fact.chapterId, fact.evidence[0].quote)} title={fact.evidence[0].quote}>{fact.evidence[0].heading === "人工记录" ? "打开关联文档" : `原文：${fact.evidence[0].quote}`}</button>}
                    <div className="story-row-actions">
                      <select value={fact.status} onChange={(event) => void updateFactStatus(fact, event.target.value as StoryFactStatus)}>
                        <option value="AI识别">AI识别</option><option value="已确认">已确认</option><option value="已忽略">已忽略</option>
                      </select>
                      <button onClick={() => openEntryEditor("fact", fact)}>编辑</button>
                      {fact.origin === "manual" && <button onClick={() => void deleteManualEntry("fact", fact.id)} title="删除人工事实"><Trash2 size={13} /></button>}
                    </div>
                  </article>
                ))}
                {!visibleFacts.length && <div className="analysis-empty">保存章节后会自动进行本地事实整理；AI 深度分析会补充更严格的证据。</div>}
                {(overview?.pageInfo?.facts.total || 0) > visibleFacts.length && <button className="story-load-more" onClick={() => void loadMore("facts")}>继续显示（{visibleFacts.length}/{overview?.pageInfo?.facts.total}）</button>}
              </div>
            </section>
          )}
          {tab === "characters" && (
            <section className="story-facts-view">
              <div className="story-filter-row compact-filter-row">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索角色、地点、目标或知情内容" />
                <select value={volumeFilter} onChange={(event) => { setVolumeFilter(event.target.value); setChapterFilter("全部"); }}><option value="全部">全部分卷</option>{volumes.map((volume) => <option key={volume}>{volume}</option>)}</select>
                <select value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)}><option value="全部">全部文档</option>{filterChapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select>
              </div>
              <div className="story-list character-state-list">
                {(overview?.characterStates || []).map((record) => (
                  <details key={record.characterId} className="story-row">
                    <summary><strong>{record.characterName}</strong><span>{record.latest?.chapterTitle || "暂无状态"} / {record.latest?.location || "地点未记录"}</span></summary>
                    {record.states.slice().reverse().map((item) => (
                      <article key={item.id}>
                        <button title={`打开${item.chapterTitle}`} onClick={() => onOpenChapter(item.chapterId)}><span>{item.volume}</span><span>{item.chapterTitle}</span></button>
                        <p>目标：{item.goals.join("；") || "未记录"}</p>
                        <p>知情：{item.knowledge.join("；") || "未记录"}</p>
                        <p>持有：{item.possessions.join("；") || "未记录"}</p>
                      </article>
                    ))}
                  </details>
                ))}
                {!overview?.characterStates.length && <div className="analysis-empty">角色在正文中出现并保存后，这里会按章节记录位置、目标、知情范围和持有物品。</div>}
                {(overview?.pageInfo?.characters.total || 0) > (overview?.characterStates.length || 0) && <button className="story-load-more" onClick={() => void loadMore("characters")}>继续显示（{overview?.characterStates.length}/{overview?.pageInfo?.characters.total}）</button>}
              </div>
            </section>
          )}
          {tab === "foreshadows" && (
            <section className="story-facts-view">
              <div className="story-filter-row">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索伏笔、计划或备注" />
                <select value={volumeFilter} onChange={(event) => { setVolumeFilter(event.target.value); setChapterFilter("全部"); }}><option value="全部">全部分卷</option>{volumes.map((volume) => <option key={volume}>{volume}</option>)}</select>
                <select value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)}><option value="全部">全部文档</option>{filterChapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select>
                <select value={foreshadowStatus} onChange={(event) => setForeshadowStatus(event.target.value as ForeshadowStatus | "全部")}><option value="全部">全部状态</option>{(["AI候选", "已确认埋下", "持续强化", "等待回收", "已经回收", "已废弃"] as ForeshadowStatus[]).map((status) => <option key={status}>{status}</option>)}</select>
                <button onClick={() => openEntryEditor("foreshadow")}><Plus size={14} />人工伏笔</button>
              </div>
              <div className="story-list">
              {(overview?.foreshadows || []).map((item) => (
                <article key={item.id} className="story-row foreshadow-row">
                  <div><strong>{item.title}</strong><span>{item.plantedAt[0]?.chapterTitle || "未关联章节"}{item.stale ? " / 待核对" : ""}</span></div>
                  <p>{item.description}</p>
                  {item.plannedPayoff && <em>计划回收：{item.plannedPayoff}</em>}
                  {!!item.plantedAt.length && <button className="evidence-link" title={item.plantedAt[0].quote} onClick={() => item.plantedAt[0].heading === "人工记录" ? onOpenChapter(item.plantedAt[0].chapterId) : onOpenEvidence(item.plantedAt[0].chapterId, item.plantedAt[0].quote)}>{item.plantedAt[0].heading === "人工记录" ? "打开关联文档" : "查看埋设原文"}</button>}
                  <div className="story-row-actions">
                    <select value={item.status} onChange={(event) => void updateForeshadowStatus(item, event.target.value as ForeshadowStatus)}>
                      {(["AI候选", "已确认埋下", "持续强化", "等待回收", "已经回收", "已废弃"] as ForeshadowStatus[]).map((status) => <option key={status}>{status}</option>)}
                    </select>
                    <button onClick={() => openEntryEditor("foreshadow", item)}>编辑</button>
                    {item.origin === "manual" && <button onClick={() => void deleteManualEntry("foreshadow", item.id)} title="删除人工伏笔"><Trash2 size={13} /></button>}
                  </div>
                </article>
              ))}
              {!overview?.foreshadows.length && <div className="analysis-empty">AI 或本地规则识别到的伏笔会先作为候选，不会自动认定为正式设定。</div>}
              {(overview?.pageInfo?.foreshadows.total || 0) > (overview?.foreshadows.length || 0) && <button className="story-load-more" onClick={() => void loadMore("foreshadows")}>继续显示（{overview?.foreshadows.length}/{overview?.pageInfo?.foreshadows.total}）</button>}
              </div>
            </section>
          )}
          {tab === "board" && (
            <section className="board-view">
              <header><div><strong>{selectedChapter?.title || "当前章节"}</strong><span>作为下一章筹备依据</span></div><div><button onClick={() => void generateBoard()} disabled={Boolean(busy)}>生成筹备板</button><button onClick={() => void addCustomBoardItem()}><Plus size={14} />自定义项</button><button onClick={() => void improveBoardWithAI()}>AI 完善</button><button className="primary" onClick={() => void saveBoard()} disabled={!board || Boolean(busy)}>保存筹备板</button></div></header>
              <div className="board-list">
                {(board?.items || []).map((item) => (
                  <article key={item.id} className={`board-item ${item.completed ? "completed" : ""}`} draggable onDragStart={() => setDraggingBeatId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveBoardItem(item.id)} onDragEnd={() => setDraggingBeatId("")}>
                    <div className="board-item-main"><span>{item.order + 1}</span><input value={item.title} onChange={(event) => patchBoardItem(item.id, { title: event.target.value })} /><small>{item.type}</small></div>
                    <textarea value={item.detail} onChange={(event) => patchBoardItem(item.id, { detail: event.target.value })} />
                    {!!item.sourceRefs.length && <div className="board-source-refs">{item.sourceRefs.slice(0, 4).map((evidence, index) => <button key={`${evidence.chapterId}_${index}`} onClick={() => evidence.heading === "人工记录" ? onOpenChapter(evidence.chapterId) : onOpenEvidence(evidence.chapterId, evidence.quote)} title={evidence.quote}>{evidence.chapterTitle}</button>)}</div>}
                    <div className="board-item-actions">
                      <label><input type="checkbox" checked={item.completed} onChange={(event) => patchBoardItem(item.id, { completed: event.target.checked })} />完成</label>
                      <button onClick={() => patchBoardItem(item.id, { locked: !item.locked })} title={item.locked ? "解除锁定" : "锁定后重新生成时保留"}>{item.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
                      <button onClick={() => setBoard((current) => current ? { ...current, items: current.items.filter((candidate) => candidate.id !== item.id).map((candidate, index) => ({ ...candidate, order: index })) } : current)} title="删除筹备项"><Trash2 size={14} /></button>
                    </div>
                  </article>
                ))}
                {!board?.items.length && <div className="analysis-empty">筹备板用于安排目标、冲突、人物表现、信息释放、伏笔和结尾，不会直接改写正文。</div>}
              </div>
            </section>
          )}
          {tab === "snapshots" && (
            <section className="snapshot-view">
              <div className="snapshot-toolbar">
                <button onClick={() => void enqueueSnapshot()}>创建项目快照</button><button onClick={() => void createBranch()} disabled={Boolean(busy)}>创建实验分支</button><button onClick={() => void loadSnapshots()}>刷新</button><button onClick={() => void cleanupSnapshots()}>清理存储</button>
                <select value={branches?.activeBranchId || "main"} onChange={(event) => void switchBranch(event.target.value)}>
                  {(branches?.branches || []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.id === branches?.activeBranchId ? "（当前）" : ""}</option>)}
                </select>
              </div>
              <details className="branch-manager">
                <summary>管理创作分支（{branches?.branches.length || 0}）</summary>
                {(branches?.branches || []).map((branch) => <div key={branch.id}><span>{branch.name}{branch.id === branches?.activeBranchId ? "（当前）" : ""}</span><button onClick={() => void compareBranch(branch.snapshotId)} disabled={!branch.snapshotId || Boolean(busy)}>与当前比较</button>{branch.id !== "main" && branch.id !== branches?.activeBranchId && <button onClick={() => void deleteBranch(branch.id)} title="删除未使用的实验分支"><Trash2 size={13} /></button>}</div>)}
              </details>
              <div className="story-list">
                {snapshots.map((snapshot) => (
                  <article key={snapshot.id} className="story-row snapshot-row"><div><strong>{snapshot.name}</strong><span>{formatDateTime(snapshot.createdAt)} / {snapshot.fileCount} 个文件 / {(snapshot.totalBytes / 1024 / 1024).toFixed(1)} MB</span></div><p>{snapshot.reason}</p><div className="snapshot-actions"><button onClick={() => void compareSnapshot(snapshot)} disabled={Boolean(busy)}>比较</button><button onClick={() => void restoreSnapshot(snapshot)} disabled={Boolean(busy)}>恢复</button><button onClick={() => void renameSnapshot(snapshot)}>改名</button><button onClick={() => void deleteSnapshot(snapshot)} title="删除未被分支使用的快照"><Trash2 size={13} /></button></div></article>
                ))}
                {!snapshots.length && <div className="analysis-empty">快照按内容哈希去重；恢复前还会自动创建安全快照。</div>}
              </div>
              {snapshotComparison && (
                <div className="snapshot-comparison">
                  <header><strong>与“{snapshotComparison.snapshot.name}”比较</strong><button onClick={() => setSnapshotComparison(null)} title="关闭比较结果"><X size={14} /></button></header>
                  <div><span>已修改 {snapshotComparison.changed.length}</span><span>快照后新增 {snapshotComparison.added.length}</span><span>当前缺失 {snapshotComparison.missing.length}</span></div>
                  <details open={snapshotComparison.changed.length + snapshotComparison.added.length + snapshotComparison.missing.length <= 12}>
                    <summary>选择要恢复的文件</summary>
                    {[...snapshotComparison.changed.map((file) => ({ file, state: "已修改", restorable: true })), ...snapshotComparison.missing.map((file) => ({ file, state: "当前缺失", restorable: true })), ...snapshotComparison.added.map((file) => ({ file, state: "快照后新增", restorable: false }))].slice(0, 160).map((item) => <label key={`${item.state}_${item.file}`} className={!item.restorable ? "disabled" : ""}><input type="checkbox" disabled={!item.restorable} checked={item.restorable && snapshotRestorePaths.includes(item.file)} onChange={() => setSnapshotRestorePaths((current) => current.includes(item.file) ? current.filter((file) => file !== item.file) : [...current, item.file])} /><span>{item.state}</span><code>{item.file}</code></label>)}
                    {snapshotComparison.changed.length + snapshotComparison.added.length + snapshotComparison.missing.length > 160 && <small>仅显示前 160 项</small>}
                  </details>
                  <footer><button onClick={() => setSnapshotRestorePaths([...snapshotComparison.changed, ...snapshotComparison.missing])}>全选可恢复项</button><button onClick={() => setSnapshotRestorePaths([])}>清空</button><button className="primary" disabled={!snapshotRestorePaths.length || Boolean(busy)} onClick={() => void restoreSnapshot(snapshotComparison.snapshot, snapshotRestorePaths)}>恢复选中项</button></footer>
                </div>
              )}
            </section>
          )}
          {tab === "workspace" && (
            <CreativeWorkspace
              state={state}
              selectedChapterId={selectedChapterId}
              selectedText={selectedText}
              chapterRevision={chapterRevision}
              initialTab={workspaceInitialTab}
              onApplyState={onApplyState}
              onOpenChapter={onOpenChapter}
              onStatus={onStatus}
            />
          )}
        </div>
        {entryEditor && (
          <div className="story-entry-editor-backdrop" onClick={() => setEntryEditor(null)}>
            <form className="story-entry-editor" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void saveEntryEditor(); }}>
              <header><strong>{entryEditor.id ? "编辑" : "新增"}{entryEditor.kind === "fact" ? "剧情事实" : "伏笔"}</strong><button type="button" onClick={() => setEntryEditor(null)} title="关闭"><X size={15} /></button></header>
              {!entryEditor.id && <label><span>关联文档</span><select value={entryEditor.chapterId} onChange={(event) => setEntryEditor({ ...entryEditor, chapterId: event.target.value })}>{state.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.volume || "未分卷"} / {chapter.title}</option>)}</select></label>}
              {entryEditor.kind === "fact" ? <><label><span>主体</span><input value={entryEditor.subject} onChange={(event) => setEntryEditor({ ...entryEditor, subject: event.target.value })} placeholder="人物、势力或物品" /></label><label><span>类型</span><select value={entryEditor.type} onChange={(event) => setEntryEditor({ ...entryEditor, type: event.target.value })}>{["剧情事件", "地点变化", "物品变化", "知情变化", "关系变化", "状态变化"].map((type) => <option key={type}>{type}</option>)}</select></label></> : <label><span>标题</span><input value={entryEditor.title} onChange={(event) => setEntryEditor({ ...entryEditor, title: event.target.value })} /></label>}
              <label className="wide"><span>{entryEditor.kind === "fact" ? "事实内容" : "伏笔内容"}</span><textarea value={entryEditor.detail} onChange={(event) => setEntryEditor({ ...entryEditor, detail: event.target.value })} /></label>
              {entryEditor.kind === "foreshadow" && <label className="wide"><span>计划回收</span><textarea value={entryEditor.plannedPayoff} onChange={(event) => setEntryEditor({ ...entryEditor, plannedPayoff: event.target.value })} /></label>}
              <label className="wide"><span>作者备注</span><textarea value={entryEditor.userNote} onChange={(event) => setEntryEditor({ ...entryEditor, userNote: event.target.value })} /></label>
              <footer><button type="button" onClick={() => setEntryEditor(null)}>取消</button><button className="primary" type="submit" disabled={Boolean(busy)}><Save size={14} />保存</button></footer>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}

function TaskCenterDrawer({
  tasks,
  onClose,
  onChange,
  onOpenStoryCenter,
  onStatus,
}: {
  tasks: BackgroundTask[];
  onClose: () => void;
  onChange: (tasks: BackgroundTask[]) => void;
  onOpenStoryCenter: () => void;
  onStatus: (message: string) => void;
}) {
  const activeCount = tasks.filter((task) => ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status)).length;
  const [operations, setOperations] = useState<OperationJournalItem[]>([]);

  useEffect(() => {
    void window.novelAPI.listOperationJournal().then((result) => setOperations(result.operations)).catch(() => setOperations([]));
  }, []);

  async function cancelTask(taskId: string) {
    const result = await window.novelAPI.cancelTask(taskId);
    if (result.task) onChange([result.task, ...tasks.filter((task) => task.id !== result.task?.id)]);
  }

  async function pauseTask(taskId: string) {
    const result = await window.novelAPI.pauseTask(taskId);
    if (result.task) onChange([result.task, ...tasks.filter((task) => task.id !== result.task?.id)]);
  }

  async function resumeTask(taskId: string) {
    const result = await window.novelAPI.resumeTask(taskId);
    if (result.task) onChange([result.task, ...tasks.filter((task) => task.id !== result.task?.id)]);
  }

  async function retryTask(taskId: string) {
    try {
      const result = await window.novelAPI.retryTask(taskId);
      onChange([result.task, ...tasks]);
      onStatus(`已重新加入任务：${result.task.title}`);
    } catch (error) {
      onStatus(`重试失败：${getErrorMessage(error)}`);
    }
  }

  async function removeTask(taskId: string) {
    try {
      onChange((await window.novelAPI.removeTask(taskId)).tasks);
    } catch (error) {
      onStatus(`删除任务记录失败：${getErrorMessage(error)}`);
    }
  }

  async function clearTaskHistory() {
    try {
      const result = await window.novelAPI.clearTaskHistory();
      onChange(result.tasks);
      onStatus(`已清理 ${result.removed} 条已结束任务记录`);
    } catch (error) {
      onStatus(`清理任务记录失败：${getErrorMessage(error)}`);
    }
  }

  return (
    <div className="task-drawer-backdrop" onClick={onClose}>
      <aside className="task-center-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><ListChecks size={18} /><strong>后台任务</strong><span>{activeCount ? `${activeCount} 个进行中或暂停` : "当前空闲"}</span></div><div><button onClick={() => void clearTaskHistory()} disabled={!tasks.some((task) => !["等待中", "运行中", "正在停止", "已暂停"].includes(task.status))}>清理记录</button><button onClick={onClose} title="关闭"><X size={17} /></button></div></header>
        <details className="operation-history">
          <summary>项目操作记录（{operations.length}）</summary>
          <div>{operations.slice(0, 40).map((item) => <article key={item.id} className={`operation-${item.status}`}><strong>{item.title}</strong><span>{item.status} / {formatDateTime(item.updatedAt)}</span>{item.error && <em>{item.error}</em>}</article>)}{!operations.length && <p>暂无保存、导入、拖动或修订记录。</p>}</div>
        </details>
        <div className="task-list">
          {tasks.map((task) => {
            const active = ["等待中", "运行中", "正在停止", "已暂停"].includes(task.status);
            const progress = task.total ? Math.min(100, Math.round((task.current / task.total) * 100)) : active ? 8 : task.status === "已完成" ? 100 : 0;
            return (
              <article key={task.id} className={`task-row status-${task.status}`}>
                <div className="task-row-title"><strong>{task.title}</strong><span>{task.status}</span></div>
                <p>{task.phase}{task.detail ? `：${task.detail}` : ""}</p>
                <div className="task-progress"><span style={{ width: `${progress}%` }} /></div>
                <small>{task.total ? `${task.current}/${task.total}` : ""} {formatDateTime(task.updatedAt)}{task.usage?.totalTokens ? ` / 约 ${task.usage.totalTokens.toLocaleString("zh-CN")} Token` : ""}</small>
                {task.error && <em>{task.error}</em>}
                {task.partialOutput && <details><summary>查看已保留的部分输出</summary><pre>{task.partialOutput.slice(-12000)}</pre></details>}
                <div className="task-actions">
                  {["等待中", "运行中"].includes(task.status) && <button onClick={() => void pauseTask(task.id)}>暂停</button>}
                  {task.status === "已暂停" && <button onClick={() => void resumeTask(task.id)}>继续</button>}
                  {active && <button onClick={() => void cancelTask(task.id)}>停止</button>}
                  {task.canRetry && <button onClick={() => void retryTask(task.id)}>重试</button>}
                  {task.status === "已完成" && ["story-analysis", "creative-board"].includes(task.type) && <button onClick={onOpenStoryCenter}>查看结果</button>}
                  {!active && <button onClick={() => void removeTask(task.id)} title="删除任务记录"><Trash2 size={14} /></button>}
                </div>
              </article>
            );
          })}
          {!tasks.length && <div className="analysis-empty">长篇分析、知识库重建和项目快照会在这里运行，不阻塞正文编辑。</div>}
        </div>
      </aside>
    </div>
  );
}

function RichDocumentEditor({
  documentId,
  value,
  fontSize,
  lineHeight,
  scrollAnchor,
  reviews,
  onChange,
  onSelection,
  onContextMenu,
  onReady,
  onOpenReview,
}: {
  documentId: string;
  value: string;
  fontSize: number;
  lineHeight: number;
  scrollAnchor: EditorScrollAnchor | null;
  reviews: InlineReviewItem[];
  onChange: (documentId: string, value: string) => void;
  onSelection: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onReady?: (editor: Editor | null) => void;
  onOpenReview: (review: InlineReviewItem) => void;
}) {
  const lastHtmlRef = useRef("");
  const onChangeRef = useRef(onChange);
  const [activeReviewId, setActiveReviewId] = useState("");
  const activeReview = reviews.find((item) => item.id === activeReviewId) || null;
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
        Underline,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        DocxImage.configure({ allowBase64: true, inline: false }),
        DocxTable.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        CollapsibleHeadings,
        InlineReviews,
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
        onChangeRef.current(documentId, next);
      },
    },
    [],
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(inlineReviewPluginKey, reviews));
    if (activeReviewId && !reviews.some((item) => item.id === activeReviewId)) setActiveReviewId("");
  }, [activeReviewId, editor, reviews]);

  useEffect(() => {
    if (!editor || !scrollAnchor) return;
    let target: HTMLElement | undefined;
    if (scrollAnchor.quote) {
      const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
      const needle = normalize(scrollAnchor.quote).slice(0, 120);
      const blocks = Array.from(editor.view.dom.querySelectorAll<HTMLElement>("p,li,td,th,blockquote,h1,h2,h3,h4,h5,h6"));
      target = blocks.find((item) => normalize(item.textContent || "").includes(needle));
    }
    if (!target && typeof scrollAnchor.headingIndex === "number") {
      target = editor.view.dom.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")[scrollAnchor.headingIndex];
    }
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    try {
      const from = editor.view.posAtDOM(target, 0);
      const length = Math.min(String(target.textContent || "").length, 160);
      editor.commands.setTextSelection({ from, to: Math.min(editor.state.doc.content.size, from + length) });
      editor.commands.focus();
    } catch {
      target.focus();
    }
  }, [editor, scrollAnchor]);

  return (
    <article
      className="rich-document-editor"
      onContextMenu={onContextMenu}
      onClick={(event) => {
        const marker = (event.target as HTMLElement).closest<HTMLElement>("[data-review-id]");
        if (marker?.dataset.reviewId) setActiveReviewId(marker.dataset.reviewId);
      }}
    >
      <RichEditorToolbar editor={editor} />
      {activeReview && <div className={`inline-review-popover ${activeReview.kind}`}><div><strong>{activeReview.kind === "revision" ? "待确认修订" : "正文批注"}</strong><span>{activeReview.status}</span><p>{activeReview.label}</p></div><button onClick={() => onOpenReview(activeReview)}>查看处理</button><button title="关闭" onClick={() => setActiveReviewId("")}><X size={14} /></button></div>}
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
  const headings: Array<{ pos: number; label: string }> = [];
  activeEditor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") headings.push({ pos, label: `${"　".repeat(Math.max(0, Number(node.attrs.level || 1) - 1))}${node.textContent || "未命名标题"}` });
    return true;
  });

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
      <select title="跳转到文档标题" value="" onChange={(event) => { const pos = Number(event.target.value); if (!Number.isFinite(pos)) return; activeEditor.commands.setTextSelection(pos + 1); activeEditor.commands.focus(); scrollRichSelectionIntoView(activeEditor, pos + 1); }}>
        <option value="">章节导航</option>
        {headings.map((item) => <option key={`${item.pos}-${item.label}`} value={item.pos}>{item.label}</option>)}
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
      <button title="插入场景分隔线" onMouseDown={run(() => activeEditor.chain().focus().setHorizontalRule().run())}>
        <Minus size={17} />
      </button>
      <button title="当前段落上移" onMouseDown={run(() => { moveCurrentTopLevelBlock(activeEditor, -1); })}>
        <ArrowUp size={17} />
      </button>
      <button title="当前段落下移" onMouseDown={run(() => { moveCurrentTopLevelBlock(activeEditor, 1); })}>
        <ArrowDown size={17} />
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
  selectedText,
  selectedTextRevision,
  onStatus,
}: {
  state: AppState;
  selectedChapterId: string;
  selectedText: string;
  selectedTextRevision: string;
  onStatus: (message: string) => void;
}) {
  const [creativeMode, setCreativeMode] = useState<CreativeAdviceMode>("next");
  const [creativeFocus, setCreativeFocus] = useState("");
  const [creativeAdvice, setCreativeAdvice] = useState<CreativeAdviceResult | null>(null);
  const [agentPlan, setAgentPlan] = useState<CreativeAgentRun | null>(null);
  const [agentHistory, setAgentHistory] = useState<CreativeAgentRun[]>([]);
  const [contextOverview, setContextOverview] = useState<StoryOverview | null>(null);
  const [creativeContextIds, setCreativeContextIds] = useState<string[]>([]);
  const [creativeIncludeSourceIds, setCreativeIncludeSourceIds] = useState<string[]>([]);
  const [creativeExcludeSourceIds, setCreativeExcludeSourceIds] = useState<string[]>([]);
  const [advisorChapterId, setAdvisorChapterId] = useState(selectedChapterId || state.chapters[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [permissionLevel, setPermissionLevel] = useState<AgentPermissionLevel>(state.config.agent.permissionLevel || "只读分析");
  const [scopeType, setScopeType] = useState<AgentScopeType | "auto">("auto");
  const previousSelectedRef = useRef(selectedChapterId);
  const advisorChapter = state.chapters.find((chapter) => chapter.id === advisorChapterId) || state.chapters.find((chapter) => chapter.id === selectedChapterId) || state.chapters[0];
  const advisorSources = useMemo(() => [
    ...state.chapters.map((item) => ({ id: item.id, label: item.title, group: `${item.knowledgeRole || "正文"} / ${item.volume || "未分卷"}` })),
    ...state.characters.map((item) => ({ id: item.id, label: item.name, group: `角色 / ${item.category || "未分类"}` })),
    ...state.worldDocs.map((item) => ({ id: item.id, label: item.title, group: `世界 / ${item.category || "未分类"}` })),
  ], [state.chapters, state.characters, state.worldDocs]);

  useEffect(() => {
    window.novelAPI
      .getAnalysisState()
      .then((snapshot) => {
        if (snapshot.creativeAdvice) setCreativeAdvice(snapshot.creativeAdvice);
        if (snapshot.creativeOptions?.mode) setCreativeMode(snapshot.creativeOptions.mode);
        if (typeof snapshot.creativeOptions?.focus === "string") setCreativeFocus(snapshot.creativeOptions.focus);
        if (Array.isArray(snapshot.creativeOptions?.contextIds)) setCreativeContextIds(snapshot.creativeOptions.contextIds);
        if (Array.isArray(snapshot.creativeOptions?.includeSourceIds)) setCreativeIncludeSourceIds(snapshot.creativeOptions.includeSourceIds);
        if (Array.isArray(snapshot.creativeOptions?.excludeSourceIds)) setCreativeExcludeSourceIds(snapshot.creativeOptions.excludeSourceIds);
        if (["auto", "chapter", "volume", "book"].includes(String(snapshot.creativeOptions?.scopeType || ""))) setScopeType(snapshot.creativeOptions?.scopeType as AgentScopeType | "auto");
        if (snapshot.creativeOptions?.chapterId && state.chapters.some((chapter) => chapter.id === snapshot.creativeOptions?.chapterId)) {
          setAdvisorChapterId(snapshot.creativeOptions.chapterId);
        } else {
          setAdvisorChapterId(selectedChapterId || state.chapters[0]?.id || "");
        }
      })
      .catch(() => null);
    void window.novelAPI.getCreativeWorkspace()
      .then((workspace) => {
        setAgentHistory(workspace.agentRuns);
        setAgentPlan(workspace.agentRuns.find((item) => item.status === "待确认") || null);
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
    if (!advisorChapter?.id) return;
    void window.novelAPI.getStoryOverview({ chapterIds: [advisorChapter.id], factLimit: 40, characterLimit: 30, foreshadowLimit: 40 })
      .then(setContextOverview)
      .catch(() => setContextOverview(null));
  }, [advisorChapter?.id, state.projectPath]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void window.novelAPI
        .saveAnalysisState({
          creativeAdvice: creativeAdvice || undefined,
          creativeOptions: { mode: creativeMode, chapterId: advisorChapter?.id || advisorChapterId, focus: creativeFocus, contextIds: creativeContextIds, includeSourceIds: creativeIncludeSourceIds, excludeSourceIds: creativeExcludeSourceIds, scopeType },
        })
        .catch(() => null);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [advisorChapter?.id, advisorChapterId, creativeAdvice, creativeContextIds, creativeExcludeSourceIds, creativeFocus, creativeIncludeSourceIds, creativeMode, scopeType]);

  async function prepareCreativeAdvice(mode = creativeMode) {
    const targetChapterId = advisorChapter?.id || selectedChapterId;
    if (!targetChapterId) {
      onStatus("请先选择一个章节或大纲文档。");
      return;
    }
    setCreativeMode(mode);
    setBusy(true);
    onStatus("正在预检参谋需要的资料与工具...");
    try {
      const plan = await window.novelAPI.prepareCreativeAgent({
        mode,
        chapterId: targetChapterId,
        focus: creativeFocus,
        contextIds: creativeContextIds,
        includeSourceIds: creativeIncludeSourceIds,
        excludeSourceIds: creativeExcludeSourceIds,
        permissionLevel,
        scopeType,
        selectedText,
        selectedTextRevision,
      });
      setAgentPlan(plan);
      setAgentHistory((current) => [plan, ...current.filter((item) => item.id !== plan.id)].slice(0, 80));
      onStatus("参谋计划已准备，请确认资料范围和预计 Token 后执行");
    } catch (error) {
      onStatus(`准备参谋计划失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function executeCreativeAdvice() {
    if (!agentPlan) return;
    setBusy(true);
    onStatus("创作参谋正在按已确认计划执行...");
    try {
      const result = await window.novelAPI.executeCreativeAgent(agentPlan.id);
      setAgentPlan(result.run);
      setAgentHistory((current) => [result.run, ...current.filter((item) => item.id !== result.run.id)].slice(0, 80));
      onStatus("创作 Agent 已进入后台任务，可继续编辑正文");
    } catch (error) {
      onStatus(`执行参谋计划失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function retryAgentTool(runId: string, tool: string) {
    setBusy(true);
    try {
      const result = await window.novelAPI.retryCreativeAgentTool({ runId, tool });
      setAgentPlan(result.run);
      setAgentHistory((current) => [result.run, ...current.filter((item) => item.id !== result.run.id)].slice(0, 80));
      onStatus("失败的 Agent 工具已重新进入任务中心");
    } catch (error) {
      onStatus(`重试工具失败：${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => window.novelAPI.onTaskProgress((task) => {
    if (task.type !== "agent-workflow") return;
    const runId = String(task.options?.runId || "");
    if (!runId || !agentHistory.some((item) => item.id === runId) && agentPlan?.id !== runId) return;
    if (!["已完成", "失败", "已停止", "已中断"].includes(task.status)) return;
    void window.novelAPI.getCreativeWorkspace().then((workspace) => {
      const run = workspace.agentRuns.find((item) => item.id === runId);
      if (!run) return;
      setAgentPlan(run);
      setAgentHistory((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 80));
      if (run.result) {
        setCreativeAdvice(run.result);
        setAdvisorChapterId(run.chapterId);
      }
      onStatus(run.status === "已完成" ? "创作 Agent 已完成，结果已保留" : `创作 Agent ${run.status}，已完成的阶段结果仍然保留`);
    }).catch((error) => onStatus(`刷新 Agent 结果失败：${getErrorMessage(error)}`));
  }), [agentHistory, agentPlan?.id, onStatus]);

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

  function toggleCreativeContext(id: string) {
    setAgentPlan(null);
    setCreativeContextIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-60));
  }

  function addCreativeSourceRule(id: string, rule: "include" | "exclude") {
    if (!id) return;
    setAgentPlan(null);
    if (rule === "include") {
      setCreativeIncludeSourceIds((items) => [...new Set([...items, id])]);
      setCreativeExcludeSourceIds((items) => items.filter((item) => item !== id));
    } else {
      setCreativeExcludeSourceIds((items) => [...new Set([...items, id])]);
      setCreativeIncludeSourceIds((items) => items.filter((item) => item !== id));
    }
  }

  async function addAdviceToBoard(item: CreativeAdviceItem) {
    const chapterId = creativeAdvice?.chapterId || advisorChapter?.id;
    if (!chapterId) return;
    try {
      let board = (await window.novelAPI.getChapterBoard(chapterId)).board;
      if (!board) board = (await window.novelAPI.generateChapterBoard({ chapterId })).board;
      const boardItemId = `beat_advice_${item.id}`;
      if (board.items.some((candidate) => candidate.id === boardItemId)) {
        onStatus("这条建议已经在下一章筹备板中");
        return;
      }
      board.items.push({
        id: boardItemId,
        type: item.type,
        title: item.title,
        detail: `${item.summary}${item.suggestedUse ? `\n使用建议：${item.suggestedUse}` : ""}${item.risks.length ? `\n注意：${item.risks.join("；")}` : ""}`,
        order: board.items.length,
        locked: true,
        completed: false,
        sourceRefs: item.sourceRefs || [],
      });
      await window.novelAPI.saveChapterBoard({ board });
      onStatus(`已加入下一章筹备板：${item.title}`);
    } catch (error) {
      onStatus(`加入筹备板失败：${getErrorMessage(error)}`);
    }
  }

  return (
    <div className="ai-advisor-panel">
      <div className="advisor-controls">
        <div className="advisor-mode-row">
          {CREATIVE_ADVICE_MODES.map((mode) => (
            <button key={mode.value} className={creativeMode === mode.value ? "active" : ""} onClick={() => { setCreativeMode(mode.value); setAgentPlan(null); }}>
              {mode.label}
            </button>
          ))}
        </div>
        <div className="advisor-form-grid">
          <label>
            <span>参考文档</span>
            <select value={advisorChapter?.id || ""} onChange={(event) => { setAdvisorChapterId(event.target.value); setAgentPlan(null); }}>
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
              onChange={(event) => { setCreativeFocus(event.target.value); setAgentPlan(null); }}
              placeholder="比如：下一章事件、人物动机、节奏、伏笔回收"
            />
          </label>
        </div>
        <details className="advisor-context-picker">
          <summary>指定参谋依据{creativeContextIds.length ? `（已选 ${creativeContextIds.length} 项）` : "（自动判断）"}</summary>
          <div>
            {!!contextOverview?.facts.length && <section><strong>剧情事实</strong>{contextOverview.facts.filter((item) => item.status !== "已忽略").slice(0, 16).map((item) => <label key={item.id}><input type="checkbox" checked={creativeContextIds.includes(item.id)} onChange={() => toggleCreativeContext(item.id)} /><span>{item.subject}：{item.object}</span></label>)}</section>}
            {!!contextOverview?.characterStates.length && <section><strong>角色状态</strong>{contextOverview.characterStates.slice(0, 12).map((record) => record.latest && <label key={record.latest.id}><input type="checkbox" checked={creativeContextIds.includes(record.latest.id)} onChange={() => toggleCreativeContext(record.latest!.id)} /><span>{record.characterName}：{record.latest.location || "地点未记录"} / {record.latest.goals[0] || "目标未记录"}</span></label>)}</section>}
            {!!contextOverview?.foreshadows.length && <section><strong>伏笔</strong>{contextOverview.foreshadows.filter((item) => !["已经回收", "已废弃"].includes(item.status)).slice(0, 16).map((item) => <label key={item.id}><input type="checkbox" checked={creativeContextIds.includes(item.id)} onChange={() => toggleCreativeContext(item.id)} /><span>{item.title}（{item.status}）</span></label>)}</section>}
            {!contextOverview?.facts.length && !contextOverview?.characterStates.length && !contextOverview?.foreshadows.length && <span>当前文档还没有创作状态记录。</span>}
          </div>
        </details>
        <details className="advisor-context-picker">
          <summary>Agent 权限与选区</summary>
          <div className="advisor-permission-row">
            <label>
              <span>分析范围</span>
              <select value={scopeType} onChange={(event) => { setScopeType(event.target.value as AgentScopeType | "auto"); setAgentPlan(null); }}>
                <option value="auto">自动推荐</option>
                <option value="chapter">当前章节</option>
                <option value="volume">当前分卷</option>
                <option value="book">全书</option>
              </select>
            </label>
            <label>
              <span>本次权限</span>
              <select value={permissionLevel} onChange={(event) => { setPermissionLevel(event.target.value as AgentPermissionLevel); setAgentPlan(null); }}>
                <option value="只读分析">只读分析</option>
                <option value="可创建规划">可创建规划</option>
                <option value="可生成修订候选">可生成修订候选</option>
              </select>
            </label>
            <span>{selectedText ? `已选中 ${countWords(selectedText)} 字` : "未选中文字"}；任何权限都不会直接覆盖正文</span>
          </div>
          <div className="advisor-source-rules">
            <label><span>强制纳入资料</span><select value="" onChange={(event) => addCreativeSourceRule(event.target.value, "include")}><option value="">选择一份资料...</option>{advisorSources.filter((item) => !creativeIncludeSourceIds.includes(item.id)).map((item) => <option key={`include_${item.id}`} value={item.id}>{item.group} / {item.label}</option>)}</select></label>
            <label><span>排除资料</span><select value="" onChange={(event) => addCreativeSourceRule(event.target.value, "exclude")}><option value="">选择一份资料...</option>{advisorSources.filter((item) => !creativeExcludeSourceIds.includes(item.id)).map((item) => <option key={`exclude_${item.id}`} value={item.id}>{item.group} / {item.label}</option>)}</select></label>
            {(creativeIncludeSourceIds.length > 0 || creativeExcludeSourceIds.length > 0) && <div className="advisor-source-rule-chips">{creativeIncludeSourceIds.map((id) => { const source = advisorSources.find((item) => item.id === id); return <button key={`included_${id}`} onClick={() => setCreativeIncludeSourceIds((items) => items.filter((item) => item !== id))} title="点击取消强制纳入">纳入：{source?.label || id} ×</button>; })}{creativeExcludeSourceIds.map((id) => { const source = advisorSources.find((item) => item.id === id); return <button key={`excluded_${id}`} className="excluded" onClick={() => setCreativeExcludeSourceIds((items) => items.filter((item) => item !== id))} title="点击取消排除">排除：{source?.label || id} ×</button>; })}</div>}
          </div>
        </details>
        <div className="analysis-actions advisor-actions">
          <button onClick={() => void prepareCreativeAdvice()} disabled={busy} title="先检查资料范围和预计消耗，再由你确认执行">
            <Sparkles size={16} />
            {busy ? "正在处理" : "准备参谋计划"}
          </button>
        </div>
      </div>

      {agentPlan?.status === "待确认" && (
        <section className="agent-plan-review">
          <header><strong>执行前确认</strong><span>{agentPlan.scopeLabel} / {agentPlan.permissionLevel} / 预计约 {agentPlan.retrievalAudit?.estimatedPromptTokens.toLocaleString() || 0} Token</span></header>
          <div>{agentPlan.steps.map((step, index) => <p key={`${step.tool}_${index}`}><b>{index + 1}. {step.label}</b><span>{step.reason}</span></p>)}</div>
          {!!agentPlan.retrievalAudit?.selectedSources.length && <details><summary>将读取 {agentPlan.retrievalAudit.selectedChunks} 个片段 / {agentPlan.retrievalAudit.selectedSources.length} 份资料</summary><span>{agentPlan.retrievalAudit.selectedSources.join("；")}</span></details>}
          {agentPlan.retrievalAudit && <small>证据置信度 {agentPlan.retrievalAudit.evidenceConfidence || "未评估"}；首轮 {agentPlan.retrievalAudit.firstPassCount || agentPlan.retrievalAudit.selectedChunks}，第二轮补证 {agentPlan.retrievalAudit.secondPassCount || 0}</small>}
          {!!agentPlan.retrievalAudit?.warnings.length && <p className="agent-plan-warning">{agentPlan.retrievalAudit.warnings.join("；")}</p>}
          <footer><button onClick={() => setAgentPlan(null)}>取消</button><button className="primary" onClick={() => void executeCreativeAdvice()} disabled={busy}><Check size={14} />确认执行</button></footer>
        </section>
      )}

      {agentPlan && (["等待中", "运行中", "已中断", "失败"].includes(agentPlan.status) || agentPlan.toolStates.some((item) => item.status === "失败")) && (
        <details className="agent-workflow-progress" open={agentPlan.status === "运行中" || agentPlan.status === "失败" || agentPlan.toolStates.some((item) => item.status === "失败")}>
          <summary>Agent 工作流：{agentPlan.status} / {agentPlan.scopeLabel}</summary>
          <div>{(agentPlan.stageCheckpoints?.length ? agentPlan.stageCheckpoints : agentPlan.toolStates.map((item) => ({ id: item.tool, ...item }))).map((item) => (
            <p key={item.id}>
              <strong>{item.label}</strong>
              <span>{item.status}{item.error ? `：${item.error}` : item.detail ? `：${item.detail}` : ""}</span>
              {item.status === "失败" && item.id !== "creative_advisor" && <button disabled={busy} onClick={() => void retryAgentTool(agentPlan.id, item.id)}>重试</button>}
            </p>
          ))}</div>
          {agentPlan.taskId && <small>停止或重试整个工作流请打开底部“任务”。</small>}
        </details>
      )}

      {!!agentHistory.length && (
        <details className="agent-history">
          <summary>参谋历史（{agentHistory.length}）</summary>
          <div>{agentHistory.slice(0, 12).map((run) => <button key={run.id} title={`回看${run.chapterTitle}的参谋结果`} disabled={!run.result} onClick={() => { if (run.result) { setCreativeAdvice(run.result); setAdvisorChapterId(run.chapterId); } }}><span>{run.chapterTitle}</span><small><span>{run.scopeLabel || "当前章节"} / {run.status}</span><time>{formatDateTime(run.updatedAt)}</time></small></button>)}</div>
        </details>
      )}

      {creativeAdvice ? (
        <>
          <div className="advisor-result-meta">
            <strong>{creativeAdvice.chapterTitle}</strong>
            <span>
              {CREATIVE_ADVICE_MODES.find((mode) => mode.value === creativeAdvice.mode)?.label || "创作建议"} / {creativeAdvice.contextCount} 片段
            </span>
          </div>
          {!!creativeAdvice.toolReport?.length && (
            <details className="advisor-tool-report">
              <summary>本次 Agent 查阅了 {creativeAdvice.toolReport.length} 项资料</summary>
              {creativeAdvice.toolReport.map((item) => (
                <p key={item.name}><strong>{item.name}</strong><span>{item.detail}</span></p>
              ))}
            </details>
          )}
          {creativeAdvice.retrievalAudit && (
            <details className="advisor-tool-report">
              <summary>检索审计：{creativeAdvice.retrievalAudit.selectedChunks} 个片段 / {creativeAdvice.retrievalAudit.selectedSources.length} 份资料</summary>
              <p><strong>检索问题</strong><span>{creativeAdvice.retrievalAudit.query}</span></p>
              <p><strong>资料范围</strong><span>{creativeAdvice.retrievalAudit.selectedSources.join("；") || "未命中"}</span></p>
              <p><strong>分层记忆</strong><span>{creativeAdvice.retrievalAudit.memoryCount} 条</span></p>
              <p><strong>证据覆盖</strong><span>{creativeAdvice.retrievalAudit.evidenceConfidence || "未评估"}；首轮 {creativeAdvice.retrievalAudit.firstPassCount || creativeAdvice.retrievalAudit.selectedChunks}，第二轮补证 {creativeAdvice.retrievalAudit.secondPassCount || 0}</span></p>
              {!!creativeAdvice.retrievalAudit.uncoveredTargets?.length && <p><strong>仍缺证据</strong><span>{creativeAdvice.retrievalAudit.uncoveredTargets.join("；")}</span></p>}
              {!!creativeAdvice.retrievalAudit.warnings.length && <p><strong>提醒</strong><span>{creativeAdvice.retrievalAudit.warnings.join("；")}</span></p>}
            </details>
          )}
          {creativeAdvice.apiError && <div className="advisor-notice">AI 接口暂时不可用，下面显示本地兜底建议。</div>}
          <div className="advisor-card-grid">
            {creativeAdvice.items.map((item) => (
              <article key={item.id} className={`advisor-card priority-${item.priority}`}>
                <header>
                  <div>
                    <small>{item.type} / {item.priority}</small>
                    <strong>{item.title}</strong>
                  </div>
                  <div><button onClick={() => void addAdviceToBoard(item)}>加入筹备板</button><button onClick={() => void saveAdviceAsMaterial(item)}>存素材</button></div>
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
                {!!item.sourceRefs?.length && <small className="advisor-evidence-count">依据 {item.sourceRefs.length} 处已选原文</small>}
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
  generating,
  progress,
  onSend,
  onRetryWithSources,
  onStop,
  onRetrievalModeChange,
  onClear,
  onNewSession,
  onSwitchSession,
  onProjectMemoryChange,
  onQuick,
  onStatus,
  expanded,
  onToggleExpanded,
  onOpenStoryCenter,
}: {
  state: AppState;
  selectedChapterId: string;
  messages: ChatMessage[];
  sessions: ChatSession[];
  activeSessionId: string;
  projectMemory: string;
  retrievalMode: RetrievalMode;
  selectedText: string;
  generating: boolean;
  progress: { phase: string; streamedChars: number; retrieval?: RetrievalDiagnostics } | null;
  onSend: (question: string, retrievalMode: RetrievalMode) => void;
  onRetryWithSources: (question: string, sourceIds: string[], retrievalMode: RetrievalMode) => void;
  onStop: () => void;
  onRetrievalModeChange: (mode: RetrievalMode) => void;
  onClear: () => void;
  onNewSession: () => void;
  onSwitchSession: (sessionId: string) => void;
  onProjectMemoryChange: (value: string) => void;
  onQuick: (question: string) => void;
  onStatus: (message: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenStoryCenter: () => void;
}) {
  const [input, setInput] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [assistantTab, setAssistantTab] = useState<"chat" | "advisor">("chat");
  const [supplementSourceByMessage, setSupplementSourceByMessage] = useState<Record<string, string>>({});
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

  function retryWithSupplement(message: ChatMessage) {
    const sourceId = supplementSourceByMessage[message.id];
    if (!sourceId) {
      onStatus("请先选择要补读的文档。");
      return;
    }
    const messageIndex = messages.findIndex((item) => item.id === message.id);
    const previousQuestion = messages
      .slice(0, Math.max(0, messageIndex))
      .reverse()
      .find((item) => item.role === "user")
      ?.content.split("\n\n【选中文字】")[0]
      .trim();
    if (!previousQuestion) {
      onStatus("没有找到这条回答对应的问题。");
      return;
    }
    onRetryWithSources(previousQuestion, [sourceId], retrievalMode);
  }

  return (
    <aside className={`right-pane ${expanded ? "expanded" : ""}`}>
      <div className="chat-header">
        <div>
          <Bot size={18} />
          <span>AI 助手</span>
        </div>
        <div className="chat-header-actions">
          <button title="打开创作状态" onClick={onOpenStoryCenter}>
            <Activity size={16} />
          </button>
          <button title={expanded ? "收起 AI 阅读区" : "展开 AI 阅读区"} onClick={onToggleExpanded}>
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button title="清空当前对话" onClick={onClear} disabled={generating}>
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
            <select value={activeSessionId} onChange={(event) => onSwitchSession(event.target.value)} title="切换 AI 会话" disabled={generating}>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title || "新会话"} · {formatDateTime(session.updatedAt)}
                </option>
              ))}
            </select>
            <button onClick={onNewSession} title="新建 AI 会话" disabled={generating}>
              新会话
            </button>
          </div>

          <details className="chat-memory-box">
            <summary>AI 范围与记忆</summary>
            <label className="chat-option-row">
              <span>检索模式</span>
              <select value={retrievalMode} onChange={(event) => onRetrievalModeChange(event.target.value as RetrievalMode)} title="默认自动判断，必要时可手动指定">
                {RETRIEVAL_MODE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              value={projectMemory}
              maxLength={3000}
              onChange={(event) => onProjectMemoryChange(event.target.value)}
              placeholder="写下需要跨会话保留的项目内背景、偏好或已确认结论。建议简短，越短越省 token。"
            />
            <small>{projectMemory.length}/3000 字</small>
          </details>

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

          {progress && (generating || progress.phase === "已停止，内容已保留") && (
            <details className="ai-progress-strip" open={generating}>
              <summary>
                <span>{progress.phase}</span>
                <small>{progress.streamedChars ? `${progress.streamedChars.toLocaleString()} 字` : ""}</small>
              </summary>
              {progress.retrieval && (
                <div>
                  <span>{progress.retrieval.modeLabel}</span>
                  <span>候选 {progress.retrieval.candidateCount}</span>
                  <span>发送 {progress.retrieval.contextCount}</span>
                  <span>{progress.retrieval.layersUsed?.join(" + ") || "原始片段"}</span>
                </div>
              )}
            </details>
          )}

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
                      <span>知识层级：{message.retrieval.layersUsed?.join(" + ") || "原始片段"}</span>
                      <span>证据覆盖：{message.retrieval.evidenceConfidence || "未评估"}{typeof message.retrieval.evidenceCoverageRatio === "number" ? ` / ${Math.round(message.retrieval.evidenceCoverageRatio * 100)}%` : ""}</span>
                      <span>两轮检索：首轮 {message.retrieval.firstPassCount || message.retrieval.contextCount} / 补证 {message.retrieval.secondPassCount || 0}</span>
                      {message.retrieval.freshness && <span>索引预检：更新 {message.retrieval.freshness.repairedSourceCount} / 延后 {message.retrieval.freshness.deferredSourceCount}</span>}
                      {!!message.retrieval.rawChapterCoverage?.total && (
                        <span>正文原文：{message.retrieval.rawChapterCoverage.selected}/{message.retrieval.rawChapterCoverage.total} 章</span>
                      )}
                      {!!message.retrieval.coverageByVolume?.length && <span>分卷覆盖：{message.retrieval.coverageByVolume.length} 组</span>}
                    </div>
                    {message.retrieval.notes.length > 0 && <p className="retrieval-note">{message.retrieval.notes.join("；")}</p>}
                    {!!message.retrieval.subQueries?.length && (
                      <details className="retrieval-audit-details">
                        <summary>检索子问题（{message.retrieval.subQueries.length}）</summary>
                        <div>{message.retrieval.subQueries.map((item) => <p key={item.id}><strong>{item.label}</strong><span>{item.query}</span></p>)}</div>
                      </details>
                    )}
                    {!!message.retrieval.coverageByVolume?.length && (
                      <details className="retrieval-audit-details">
                        <summary>分卷与分类覆盖</summary>
                        <div>{message.retrieval.coverageByVolume.map((item) => (
                          <p key={item.volume}>
                            <strong>{item.volume}</strong>
                            <span>原文 {item.selectedSources}/{item.indexedSources} 份，{item.selectedChunks} 个片段；分组摘要{item.summaryAvailable ? "已读取" : "不可用"}</span>
                          </p>
                        ))}</div>
                        {!!message.retrieval.coverageWarnings?.length && <small>{message.retrieval.coverageWarnings.join("；")}</small>}
                      </details>
                    )}
                    {!!message.retrieval.selectedSourceReasons?.length && (
                      <details className="retrieval-audit-details">
                        <summary>为什么读取这些资料</summary>
                        <div>{message.retrieval.selectedSourceReasons.slice(0, 60).map((item) => (
                          <p key={item.sourceId}><strong>{item.group} / {item.title}</strong><span>{item.reasons.join("、")}；{item.chunks} 个片段</span></p>
                        ))}</div>
                      </details>
                    )}
                    {!!message.retrieval.uncoveredTargets?.length && (
                      <div className="retrieval-list">
                        <strong>证据仍不足</strong>
                        <span>{message.retrieval.uncoveredTargets.join("；")}</span>
                      </div>
                    )}
                    {!!message.retrieval.addedSources?.length && (
                      <div className="retrieval-list">
                        <strong>第二轮补读</strong>
                        <span>{message.retrieval.addedSources.join("；")}</span>
                      </div>
                    )}
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
                    {!!message.retrieval.existingButNotReadSources?.length && (
                      <div className="retrieval-supplement">
                        <select
                          value={supplementSourceByMessage[message.id] || ""}
                          onChange={(event) => setSupplementSourceByMessage((current) => ({ ...current, [message.id]: event.target.value }))}
                        >
                          <option value="">补选一个未读文档...</option>
                          {message.retrieval.existingButNotReadSources.map((source) => (
                            <option key={source.sourceId} value={source.sourceId}>
                              {source.group} / {source.title}
                            </option>
                          ))}
                        </select>
                        <button onClick={() => retryWithSupplement(message)} disabled={generating}>补读后重问</button>
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
            <button title={generating ? "停止生成" : "发送"} onClick={generating ? onStop : submit} className={generating ? "stop" : ""}>
              {generating ? <Square size={17} /> : <Send size={18} />}
            </button>
          </div>
        </div>
      ) : (
        <SidebarCreativeAdvisor state={state} selectedChapterId={selectedChapterId} selectedText={selectedText} selectedTextRevision={state.chapterRevision || ""} onStatus={onStatus} />
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
  const [syncStatus, setSyncStatus] = useState<KnowledgeSyncStatus | null>(null);
  const [healthReport, setHealthReport] = useState<ProjectHealthReport | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceDiagnostics | null>(null);
  const [checking, setChecking] = useState(false);
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
    Promise.all([window.novelAPI.listKnowledgeItems(), window.novelAPI.getKnowledgeStatus(), window.novelAPI.getProjectHealth(), window.novelAPI.getMaintenanceDiagnostics()])
      .then(([result, status, health, diagnostics]) => {
        setItems(result.items);
        setSyncStatus(status);
        setHealthReport(health);
        setMaintenance(diagnostics);
      })
      .catch((error) => onStatus(`读取知识库整理信息失败：${error instanceof Error ? error.message : String(error)}`));
  }, [state.projectPath]);

  async function checkKnowledge() {
    setChecking(true);
    try {
      const [status, health, diagnostics] = await Promise.all([window.novelAPI.getKnowledgeStatus(), window.novelAPI.getProjectHealth(), window.novelAPI.getMaintenanceDiagnostics()]);
      setSyncStatus(status);
      setHealthReport(health);
      setMaintenance(diagnostics);
      onStatus(`检查完成：${status.counts.synced}/${status.counts.total} 份资料已同步，${health.issues.length} 个章节结构提示，${diagnostics.issues.length} 个维护提示`);
    } catch (error) {
      onStatus(`检查失败：${getErrorMessage(error)}`);
    } finally {
      setChecking(false);
    }
  }

  async function repairKnowledge() {
    setChecking(true);
    onStatus("正在增量补齐知识库...");
    try {
      const result = await window.novelAPI.repairKnowledge();
      setSyncStatus(result.status);
      onApplyState(result.state);
      setItems((await window.novelAPI.listKnowledgeItems()).items);
      onStatus(`知识库已补齐：${result.status.counts.synced}/${result.status.counts.total} 份资料已同步`);
    } catch (error) {
      onStatus(`补齐知识库失败：${getErrorMessage(error)}`);
    } finally {
      setChecking(false);
    }
  }

  async function repairHealth() {
    if (!window.confirm("将自动拆分共用文件，并尝试从最新历史版本恢复缺失章节。当前内容不会被无提示覆盖。继续吗？")) return;
    setChecking(true);
    try {
      const result = await window.novelAPI.repairProjectHealth();
      setHealthReport(result.health);
      onApplyState(result.state);
      onStatus(result.health.healthy ? "章节健康修复完成，未发现高风险问题" : "自动修复完成，仍有问题需要人工确认");
    } catch (error) {
      onStatus(`章节健康修复失败：${getErrorMessage(error)}`);
    } finally {
      setChecking(false);
    }
  }

  async function repairMaintenance() {
    setChecking(true);
    onStatus("正在校验并修复索引与检索缓存...");
    try {
      const result = await window.novelAPI.repairMaintenance();
      setMaintenance(result.diagnostics);
      setSyncStatus(result.status);
      onApplyState(result.state);
      onStatus(result.diagnostics.healthy ? "索引与检索缓存维护完成" : `维护完成，仍有 ${result.diagnostics.issues.length} 项需要确认`);
    } catch (error) {
      onStatus(`维护失败：${getErrorMessage(error)}`);
    } finally {
      setChecking(false);
    }
  }

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
      setSyncStatus(await window.novelAPI.getKnowledgeStatus());
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
      <details className="knowledge-status-panel">
        <summary>
          <span className="knowledge-sync-primary">
            <span className={`sync-dot ${syncStatus?.counts.errors ? "error" : syncStatus?.counts.pending ? "pending" : "ok"}`} />
            <strong>{syncStatus ? `知识库 ${syncStatus.counts.synced}/${syncStatus.counts.total} 已同步` : "正在读取知识库状态"}</strong>
          </span>
          {syncStatus && <span className="knowledge-status-meta">文档摘要 {syncStatus.hierarchy.sourceSummaries} / 分组摘要 {syncStatus.hierarchy.volumeSummaries} / 全书摘要 {syncStatus.hierarchy.hasBookSummary ? "可用" : "待建立"}</span>}
          {healthReport && <span className="knowledge-status-meta">章节健康：{healthReport.healthy ? "正常" : `${healthReport.issues.length} 项待确认`}</span>}
          {maintenance && <span className="knowledge-status-meta">检索维护：{maintenance.healthy ? "正常" : `${maintenance.issues.length} 项提示`}</span>}
        </summary>
        <div className="knowledge-status-actions">
          <button onClick={() => void checkKnowledge()} disabled={checking}><RefreshCcw size={14} />重新检查</button>
          <button onClick={() => void repairKnowledge()} disabled={checking || !syncStatus?.counts.pending}>补齐未同步资料</button>
          <button onClick={() => void repairHealth()} disabled={checking || !healthReport?.issues.some((item) => item.repairable)}>修复可恢复问题</button>
          <button onClick={() => void repairMaintenance()} disabled={checking}><Activity size={14} />修复索引与缓存</button>
        </div>
        {!!syncStatus?.items.some((item) => !["已同步", "空文档"].includes(item.status)) && (
          <div className="knowledge-status-list">
            {syncStatus.items.filter((item) => !["已同步", "空文档"].includes(item.status)).slice(0, 80).map((item) => (
              <span key={item.sourceId}><strong>{item.status}</strong> {item.group} / {item.title}：{item.detail}</span>
            ))}
          </div>
        )}
        {!!healthReport?.issues.length && (
          <div className="knowledge-status-list health">
            {healthReport.issues.slice(0, 50).map((item, index) => (
              <span key={`${item.code}_${index}`}><strong>{item.severity}</strong> {item.title}：{item.detail}</span>
            ))}
          </div>
        )}
        {maintenance && (
          <div className="knowledge-status-list maintenance">
            <span><strong>向量索引</strong> {maintenance.vectorIndex.sources} 份资料 / {maintenance.vectorIndex.chunks} 个片段</span>
            <span><strong>分卷缓存</strong> {maintenance.retrievalCache.valid ? `正常，${maintenance.retrievalCache.groups} 组` : "需要刷新"}</span>
            <span><strong>新鲜度缓存</strong> {maintenance.freshnessCache.entries} 份；过期资料 {maintenance.staleSourceCount} 份</span>
            <span><strong>Agent</strong> 中断或失败 {maintenance.interruptedAgentRuns.length} 次；引用异常 {maintenance.invalidReferences.length} 条</span>
            {maintenance.issues.map((item) => <span key={item}><strong>提示</strong> {item}</span>)}
          </div>
        )}
      </details>
      <div className="knowledge-toolbar">
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索文档或分卷" />
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as KnowledgeRole | "全部")}>
          <option value="全部">全部类型</option>
          <option value="大纲">大纲</option>
          <option value="正文">正文</option>
          <option value="补充材料">补充材料</option>
        </select>
        <details className="knowledge-batch-actions">
          <summary>批量设置</summary>
          <div>
            <button onClick={() => applyRoleToVisible("大纲")}>设为大纲</button>
            <button onClick={() => applyRoleToVisible("正文")}>设为正文</button>
            <button onClick={() => applyRoleToVisible("补充材料")}>设为补充材料</button>
          </div>
        </details>
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
                  <strong>{item.title} <span className={`sync-label ${(syncStatus?.items.find((status) => status.sourceId === item.id)?.status || "").replace(/\s/g, "-")}`}>{syncStatus?.items.find((status) => status.sourceId === item.id)?.status || ""}</span></strong>
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
  onExportBookWithOptions: (options: {
    includeOutline?: boolean;
    includeMaterials?: boolean;
    includeCharacters?: boolean;
    includeWorld?: boolean;
  }) => void;
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
  const [exportOptions, setExportOptions] = useState({ includeOutline: true, includeMaterials: true, includeCharacters: false, includeWorld: false });
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
  const [graphNodeDrag, setGraphNodeDrag] = useState<{ startX: number; startY: number; positions: Record<string, { x: number; y: number }> } | null>(null);
  const [graphSelection, setGraphSelection] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [selectedGraphNodeIds, setSelectedGraphNodeIds] = useState<string[]>([]);
  const [editingRelationEdgeId, setEditingRelationEdgeId] = useState("");
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
    if (snapshot.exportOptions) {
      const legacyOptions = snapshot.exportOptions.includeMaterials === undefined;
      setExportOptions({
        includeOutline: legacyOptions ? true : false,
        includeMaterials: true,
        includeCharacters: false,
        includeWorld: false,
        ...snapshot.exportOptions,
        ...(legacyOptions ? { includeOutline: true, includeMaterials: true } : {}),
      });
    }
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
      const mergedNodes = result.nodes.map((node) => {
        const saved = relationshipNodes.find((item) => item.id === node.id);
        return saved ? { ...node, x: saved.x, y: saved.y, color: saved.color } : node;
      });
      const mergedEdges = result.edges.map((edge) => {
        const saved = relationshipEdges.find((item) => item.id === edge.id);
        return saved ? { ...edge, label: saved.label || edge.label, labelX: saved.labelX, labelY: saved.labelY, color: saved.color, direction: saved.direction } : edge;
      });
      setRelationshipNodes(mergedNodes);
      setRelationshipEdges(mergedEdges);
      saveAnalysisDraft({
        relationships: { ...result, nodes: mergedNodes, edges: mergedEdges },
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

  async function restoreVersion() {
    if (!selectedChapterId || !selectedVersionId) return;
    if (!window.confirm("恢复后，当前内容会先自动保存为一个历史版本。确认恢复所选版本吗？")) return;
    setBusy("restore-version");
    try {
      const result = await window.novelAPI.restoreChapterVersion({ chapterId: selectedChapterId, versionId: selectedVersionId });
      onApplyState(result.state);
      setVersionCompare(null);
      onStatus(`已恢复 ${formatDateTime(result.restoredVersion.createdAt)} 的版本，恢复前内容也已备份`);
    } catch (error) {
      onStatus(`恢复版本失败：${getErrorMessage(error)}`);
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
    nodes.forEach((node) => {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
      const current = positions.get(node.id);
      if (current) positions.set(node.id, { ...current, x: Number(node.x), y: Number(node.y) });
    });
    return { width, height, positions };
  }, [relationshipNodes, relationshipEdges]);

  function resetGraphView() {
    setGraphScale(1);
    setGraphOffset({ x: 0, y: 0 });
  }

  function autoLayoutGraph() {
    setRelationshipNodes((items) => items.map(({ x: _x, y: _y, ...item }) => item));
    setSelectedGraphNodeIds([]);
    resetGraphView();
    onStatus("关系图已重新自动布局");
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
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.shiftKey) {
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setGraphSelection({ startX: x, startY: y, currentX: x, currentY: y });
      return;
    }
    setGraphDragStart({ x: event.clientX, y: event.clientY, offsetX: graphOffset.x, offsetY: graphOffset.y });
  }

  function moveGraphPan(event: React.MouseEvent<HTMLDivElement>) {
    if (graphNodeDrag) {
      event.preventDefault();
      event.stopPropagation();
      const svg = graphShellRef.current?.querySelector("svg");
      const ratio = svg ? graph.width / Math.max(1, svg.getBoundingClientRect().width) : 1;
      const dx = ((event.clientX - graphNodeDrag.startX) * ratio) / graphScale;
      const dy = ((event.clientY - graphNodeDrag.startY) * ratio) / graphScale;
      setRelationshipNodes((items) => items.map((item) => {
        const start = graphNodeDrag.positions[item.id];
        return start ? { ...item, x: start.x + dx, y: start.y + dy } : item;
      }));
      return;
    }
    if (graphSelection) {
      const rect = event.currentTarget.getBoundingClientRect();
      setGraphSelection({ ...graphSelection, currentX: event.clientX - rect.left, currentY: event.clientY - rect.top });
      return;
    }
    if (!graphDragStart) return;
    event.preventDefault();
    event.stopPropagation();
    setGraphOffset({
      x: graphDragStart.offsetX + event.clientX - graphDragStart.x,
      y: graphDragStart.offsetY + event.clientY - graphDragStart.y,
    });
  }

  function stopGraphPan() {
    if (graphSelection) {
      const svg = graphShellRef.current?.querySelector("svg");
      if (svg) {
        const rect = svg.getBoundingClientRect();
        const ratioX = graph.width / Math.max(1, rect.width);
        const ratioY = graph.height / Math.max(1, rect.height);
        const left = (Math.min(graphSelection.startX, graphSelection.currentX) * ratioX - graphOffset.x) / graphScale;
        const right = (Math.max(graphSelection.startX, graphSelection.currentX) * ratioX - graphOffset.x) / graphScale;
        const top = (Math.min(graphSelection.startY, graphSelection.currentY) * ratioY - graphOffset.y) / graphScale;
        const bottom = (Math.max(graphSelection.startY, graphSelection.currentY) * ratioY - graphOffset.y) / graphScale;
        setSelectedGraphNodeIds(relationshipNodes.filter((node) => { const position = graph.positions.get(node.id); return position && position.x >= left && position.x <= right && position.y >= top && position.y <= bottom; }).map((node) => node.id));
      }
    }
    setGraphDragStart(null);
    setGraphNodeDrag(null);
    setGraphSelection(null);
  }

  function startGraphNodeDrag(event: React.MouseEvent<SVGGElement>, nodeId: string) {
    event.preventDefault();
    event.stopPropagation();
    const nextSelected = selectedGraphNodeIds.includes(nodeId) ? selectedGraphNodeIds : event.ctrlKey ? [...selectedGraphNodeIds, nodeId] : [nodeId];
    setSelectedGraphNodeIds(nextSelected);
    const positions = Object.fromEntries(nextSelected.map((id) => { const position = graph.positions.get(id); return [id, { x: position?.x || 0, y: position?.y || 0 }]; }));
    setGraphNodeDrag({ startX: event.clientX, startY: event.clientY, positions });
  }

  async function saveRelationshipEdge(edge: RelationshipEdge) {
    const label = String(edge.label || "关系").trim() || "关系";
    setRelationshipEdges((items) => items.map((item) => item.id === edge.id ? { ...edge, label } : item));
    const source = state.characters.find((card) => card.name === edge.source);
    const target = state.characters.find((card) => card.name === edge.target);
    try {
      let nextState: AppState | null = null;
      if (source) {
        const line = `${target?.name || edge.target}：${label}`;
        nextState = await window.novelAPI.saveCharacter({ ...source, relationships: source.relationships.includes(line) ? source.relationships : [source.relationships.trim(), line].filter(Boolean).join("\n") });
      }
      if (target) {
        const line = `${source?.name || edge.source}：${label}`;
        nextState = await window.novelAPI.saveCharacter({ ...target, relationships: target.relationships.includes(line) ? target.relationships : [target.relationships.trim(), line].filter(Boolean).join("\n") });
      }
      if (nextState) onApplyState(nextState);
      setEditingRelationEdgeId("");
      onStatus(`关系“${label}”已同步到角色卡`);
    } catch (error) {
      onStatus(`保存关系失败：${getErrorMessage(error)}`);
    }
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
                className={`relationship-graph-shell ${graphDragStart || graphNodeDrag ? "dragging" : ""}`}
                onWheel={zoomGraph}
                onMouseDown={startGraphPan}
                onMouseMove={moveGraphPan}
                onMouseUp={stopGraphPan}
                onMouseLeave={stopGraphPan}
              >
                <div className="relationship-graph-tools">
                  <span>{Math.round(graphScale * 100)}%</span>
                  <button onMouseDown={(event) => event.stopPropagation()} onClick={resetGraphView}>重置视图</button>
                  <button onMouseDown={(event) => event.stopPropagation()} onClick={autoLayoutGraph}>自动布局</button>
                </div>
                <svg className="relationship-graph" viewBox={`0 0 ${graph.width} ${graph.height}`} role="img">
                  <defs><marker id="relationship-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
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
                            stroke={edge.color || undefined}
                            markerEnd={["forward", "both"].includes(edge.direction || "none") ? "url(#relationship-arrow)" : undefined}
                            markerStart={["backward", "both"].includes(edge.direction || "none") ? "url(#relationship-arrow)" : undefined}
                          />
                          <text className="relationship-edge-label" x={labelX} y={labelY - 6} textAnchor="middle" onMouseDown={(event) => event.stopPropagation()} onClick={() => setEditingRelationEdgeId(edge.id)}>
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
                        <g key={node.id} className={`relationship-node ${position.side} ${selectedGraphNodeIds.includes(node.id) ? "selected" : ""}`} onMouseDown={(event) => startGraphNodeDrag(event, node.id)}>
                          <rect x={position.x - position.width / 2} y={position.y - position.height / 2} width={position.width} height={position.height} rx={8} style={node.color ? { fill: node.color } : undefined} />
                          <text x={position.x} y={position.y + 5} textAnchor="middle">
                            {node.name}
                          </text>
                          <title>{node.category}</title>
                        </g>
                      );
                    })}
                  </g>
                </svg>
                {graphSelection && <div className="graph-selection-box" style={{ left: Math.min(graphSelection.startX, graphSelection.currentX), top: Math.min(graphSelection.startY, graphSelection.currentY), width: Math.abs(graphSelection.currentX - graphSelection.startX), height: Math.abs(graphSelection.currentY - graphSelection.startY) }} />}
                {editingRelationEdgeId && (() => { const edge = relationshipEdges.find((item) => item.id === editingRelationEdgeId); if (!edge) return null; return <div className="graph-edge-editor" onMouseDown={(event) => event.stopPropagation()}><strong>{edge.source} / {edge.target}</strong><input value={edge.label} onChange={(event) => setRelationshipEdges((items) => items.map((item) => item.id === edge.id ? { ...item, label: event.target.value } : item))} placeholder="关系类型" /><input type="color" title="连线颜色" value={edge.color || "#64748b"} onChange={(event) => setRelationshipEdges((items) => items.map((item) => item.id === edge.id ? { ...item, color: event.target.value } : item))} /><select value={edge.direction || "none"} onChange={(event) => setRelationshipEdges((items) => items.map((item) => item.id === edge.id ? { ...item, direction: event.target.value as RelationshipEdge["direction"] } : item))}><option value="none">无方向</option><option value="forward">正向</option><option value="backward">反向</option><option value="both">双向</option></select><button onClick={() => void saveRelationshipEdge(relationshipEdges.find((item) => item.id === edge.id) || edge)}>保存并同步</button><button title="关闭" onClick={() => setEditingRelationEdgeId("")}><X size={14} /></button></div>; })()}
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
            <button onClick={() => void restoreVersion()} disabled={!selectedVersionId || busy === "restore-version"}>
              恢复此版本
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
              <strong>按文档批量导出 DOCX</strong>
              <label>
                <input type="checkbox" checked={exportOptions.includeOutline} onChange={(event) => setExportOptions((value) => ({ ...value, includeOutline: event.target.checked }))} />
                带大纲
              </label>
              <label>
                <input type="checkbox" checked={exportOptions.includeMaterials} onChange={(event) => setExportOptions((value) => ({ ...value, includeMaterials: event.target.checked }))} />
                带补充材料
              </label>
              <label>
                <input type="checkbox" checked={exportOptions.includeCharacters} onChange={(event) => setExportOptions((value) => ({ ...value, includeCharacters: event.target.checked }))} />
                带角色卡
              </label>
              <label>
                <input type="checkbox" checked={exportOptions.includeWorld} onChange={(event) => setExportOptions((value) => ({ ...value, includeWorld: event.target.checked }))} />
                带世界观资料
              </label>
              <button onClick={() => onExportBookWithOptions(exportOptions)}>按选项逐篇导出</button>
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
  const [securityStatus, setSecurityStatus] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<Awaited<ReturnType<typeof window.novelAPI.checkForUpdate>> | null>(null);
  const provider = draft.api.provider;

  function updateApi<K extends keyof typeof draft.api>(key: K, value: (typeof draft.api)[K]) {
    setDraft((config) => ({ ...config, api: { ...config.api, [key]: value } }));
  }

  function updateUi<K extends keyof typeof draft.ui>(key: K, value: (typeof draft.ui)[K]) {
    setDraft((config) => ({ ...config, ui: { ...config.ui, [key]: value } }));
  }

  function updateAgent<K extends keyof typeof draft.agent>(key: K, value: (typeof draft.agent)[K]) {
    setDraft((config) => ({ ...config, agent: { ...config.agent, [key]: value } }));
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

  async function checkUpdate() {
    setSecurityBusy(true);
    setSecurityStatus("正在检查 GitHub 发布版本...");
    try {
      const result = await window.novelAPI.checkForUpdate();
      setUpdateInfo(result);
      setSecurityStatus(result.updateAvailable ? `发现新版本 ${result.latestVersion}` : `当前 ${result.currentVersion} 已是最新公开版本`);
    } catch (error) {
      setSecurityStatus(`检查更新失败：${getErrorMessage(error)}`);
    } finally {
      setSecurityBusy(false);
    }
  }

  async function downloadUpdate() {
    if (!updateInfo?.downloadUrl) return;
    if (!window.confirm(`确认下载 ${updateInfo.releaseName} 吗？下载完成后仍会再次询问是否打开更新程序。`)) return;
    setSecurityBusy(true);
    try {
      const result = await window.novelAPI.downloadUpdate({ url: updateInfo.downloadUrl, assetName: updateInfo.assetName });
      if (!result.canceled) setSecurityStatus(`更新已下载：${result.filePath}`);
    } catch (error) {
      setSecurityStatus(`下载更新失败：${getErrorMessage(error)}`);
    } finally {
      setSecurityBusy(false);
    }
  }

  async function scanPrivacy() {
    setSecurityBusy(true);
    setSecurityStatus("正在扫描发布输入文件...");
    try {
      const report = await window.novelAPI.scanReleasePrivacy();
      setSecurityStatus(report.ok ? `隐私扫描通过：已检查 ${report.scannedFiles} 个发布输入文件` : `发现 ${report.findings.length} 个风险项：${report.findings.slice(0, 3).map((item) => `${item.file}:${item.line} ${item.label}`).join("；")}`);
    } catch (error) {
      setSecurityStatus(`隐私扫描失败：${getErrorMessage(error)}`);
    } finally {
      setSecurityBusy(false);
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
          <label className="checkbox-line">
            <input type="checkbox" checked={draft.ui.recoveryEnabled !== false} onChange={(event) => updateUi("recoveryEnabled", event.target.checked)} />
            保留异常退出恢复草稿和窗口状态
          </label>
        </div>

        <details className="settings-agent-panel">
          <summary>创作 Agent 与数据保护</summary>
          <div>
            <label>
              默认执行权限
              <select value={draft.agent.permissionLevel} onChange={(event) => updateAgent("permissionLevel", event.target.value as AgentPermissionLevel)}>
                <option value="只读分析">只读分析</option>
                <option value="可创建规划">可创建规划和素材</option>
                <option value="可生成修订候选">可生成待确认修订</option>
              </select>
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={draft.agent.autoLocalAnalysis} onChange={(event) => updateAgent("autoLocalAnalysis", event.target.checked)} />
              保存后自动更新本地剧情事实与角色状态
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={draft.agent.autoDeepAnalysis} onChange={(event) => updateAgent("autoDeepAnalysis", event.target.checked)} />
              章节停止修改 45 秒后自动加入 AI 深度分析
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={draft.agent.snapshotBeforeBulkChanges} onChange={(event) => updateAgent("snapshotBeforeBulkChanges", event.target.checked)} />
              批量导入或 AI 批量写入前自动创建项目快照
            </label>
          </div>
        </details>

        <details className="settings-agent-panel settings-security-panel">
          <summary>发布、密钥与软件更新</summary>
          <div>
            <p>接口密钥：{draft.api.credentialStorage === "windows" ? "保存在 Windows 凭据管理器" : draft.api.credentialStorage === "legacy" ? "当前环境使用兼容存储" : "尚未保存"}{draft.api.credentialError ? `；凭据管理器提示：${draft.api.credentialError}` : ""}</p>
            <div className="settings-security-actions"><button disabled={securityBusy} onClick={() => void checkUpdate()}>检查更新</button>{updateInfo?.updateAvailable && updateInfo.downloadUrl && <button className="primary" disabled={securityBusy} onClick={() => void downloadUpdate()}>下载 {updateInfo.latestVersion}</button>}<button disabled={securityBusy} onClick={() => void scanPrivacy()}>运行发布隐私扫描</button></div>
            {securityStatus && <p className="settings-security-status">{securityStatus}</p>}
            {updateInfo?.notes && <details><summary>版本说明</summary><pre>{updateInfo.notes}</pre></details>}
          </div>
        </details>

        <div className="settings-help">
          <strong>接口说明</strong>
          <p>DeepSeek 推荐：接口地址 https://api.deepseek.com/v1，聊天模型 deepseek-chat。通义千问推荐：接口地址 https://dashscope.aliyuncs.com/compatible-mode/v1，聊天模型 qwen-plus。候选扫描上限表示本地最多先看多少片段，发送片段上限表示最多交给 AI 多少片段。长篇项目建议候选扫描 5000-20000，发送片段日常 80-180，全书分析再临时提高。聊天问答会流式显示，默认不再因本地等待超时而中断；如果网络在生成中断开，已收到的内容会保留下来。DeepSeek、通义千问、OpenAI、Kimi、Ollama 和大多数中转接口使用 /chat/completions；Claude 使用 /v1/messages。向量接口使用 /embeddings。若不填向量接口密钥，软件会使用本地哈希向量作为临时索引。</p>
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
