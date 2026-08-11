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
  Chapter,
  ChapterVersion,
  ChapterVersionCompare,
  CharacterCard,
  ChatMessage,
  ConsistencyIssue,
  GlobalSearchResult,
  Provider,
  RelationshipEdge,
  RelationshipNode,
  TimelineEvent,
  WorldDoc,
} from "./types";

const PROVIDER_DEFAULTS: Record<Provider, { baseUrl: string; model: string; label: string }> = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
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
const MAX_RETRIEVAL_TOP_K = 250;
const DEFAULT_CATEGORY_LABEL = "未分类";

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

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [chapterContent, setChapterContent] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterVolume, setChapterVolume] = useState("卷一");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("正在打开项目...");
  const [view, setView] = useState<"chapters" | "characters" | "world" | "analysis">("chapters");
  const [showSettings, setShowSettings] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [preview, setPreview] = useState(false);
  const [scrollAnchor, setScrollAnchor] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [draggingChapterId, setDraggingChapterId] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(380);
  const [previewWidth, setPreviewWidth] = useState(46);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);

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

  const saveChapter = useCallback(async () => {
    if (!selectedChapter || saving) return;
    setSaving(true);
    setStatus("正在保存并更新知识库...");
    try {
      const result = await window.novelAPI.saveChapter({
        chapterId: selectedChapter.id,
        title: chapterTitle,
        volume: chapterVolume,
        content: chapterContent,
      });
      setSelectedChapter(result.chapter);
      setState((current) =>
        current
          ? {
              ...current,
              config: result.config,
              chapters: result.config.chapters,
              selectedChapter: result.chapter,
              vectorStats: result.vectorStats,
            }
          : current,
      );
      setDirty(false);
      const mode = result.indexResult.chunks > 0 ? `索引 ${result.indexResult.chunks} 个片段` : "暂无可索引内容";
      setStatus(`已保存，${mode}`);
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }, [chapterContent, chapterTitle, chapterVolume, saving, selectedChapter]);

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
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveChapter]);

  const currentWords = useMemo(() => countWords(chapterContent), [chapterContent]);
  const renderedMarkdown = useMemo(() => ({ __html: contentToHtml(chapterContent) }), [chapterContent]);

  async function selectChapter(chapterId: string, line?: number) {
    if (dirty) await saveChapter();
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
  }

  function insertMarkdown(prefix: string, suffix = "") {
    const editor = editorRef.current;
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const before = chapterContent.slice(0, start);
    const selected = chapterContent.slice(start, end);
    const after = chapterContent.slice(end);
    const next = `${before}${prefix}${selected || "文字"}${suffix}${after}`;
    setChapterContent(next);
    setDirty(true);
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.selectionStart = start + prefix.length;
      editor.selectionEnd = start + prefix.length + (selected || "文字").length;
    });
  }

  function runRichCommand(command: string, value?: string) {
    if (preview) {
      if (command === "formatBlock" && value === "h1") insertMarkdown("# ", "");
      if (command === "bold") insertMarkdown("**", "**");
      if (command === "italic") insertMarkdown("*", "*");
      if (command === "formatBlock" && value === "blockquote") insertMarkdown("> ", "");
      return;
    }
    document.execCommand(command, false, value);
    setDirty(true);
    setStatus("已应用格式，自动保存会同步知识库");
  }

  async function createChapter() {
    const title = `第${(state?.chapters.length ?? 0) + 1}章 新章节`;
    const next = await window.novelAPI.createChapter({ title, volume: chapterVolume || "卷一" });
    applyAppState(next);
    setStatus("已创建新章节，可以在中间顶部修改标题");
  }

  async function deleteChapter(chapterId: string) {
    if (!window.confirm("确定删除这个章节吗？对应的本地文件和向量索引都会删除。")) return;
    const next = await window.novelAPI.deleteChapter(chapterId);
    applyAppState(next);
  }

  async function moveDraggingChapter(volume: string, beforeChapterId = "") {
    if (!state || !draggingChapterId) return;
    if (beforeChapterId && draggingChapterId === beforeChapterId) {
      setDraggingChapterId(null);
      return;
    }
    if (dirty) await saveChapter();
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
    if (dirty) await saveChapter();
    const payload = await window.novelAPI.loadChapter(chapterId);
    if (!payload.chapter) return;
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
    const result = await window.novelAPI.createProject({ title });
    if (!("canceled" in result)) applyAppState(result);
  }

  async function openProject() {
    const result = await window.novelAPI.openProject();
    if (!("canceled" in result)) applyAppState(result);
  }

  async function importDocument(volume = "") {
    if (dirty) await saveChapter();
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
    if (!selectedChapter) return;
    if (dirty) await saveChapter();
    setStatus("正在导出 Word 文档...");
    try {
      const result = await window.novelAPI.exportChapterDocx(selectedChapter.id);
      if (result.canceled) {
        setStatus("已取消导出");
        return;
      }
      if (result.filePath) setStatus(`Word 文档已导出：${result.filePath}`);
    } catch (error) {
      setStatus(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function exportBookDocx() {
    if (dirty) await saveChapter();
    setStatus("正在导出整本小说 Word 文档...");
    try {
      const result = await window.novelAPI.exportBookDocx();
      if (result.canceled) {
        setStatus("已取消导出整书");
        return;
      }
      if (result.filePath) setStatus(`整书 Word 文档已导出：${result.filePath}`);
    } catch (error) {
      setStatus(`导出整书失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function openOriginalDocument() {
    if (!selectedChapter) return;
    const result = await window.novelAPI.openOriginalDocument(selectedChapter.id);
    if (result.error) {
      setStatus(`打开 Word 原文失败：${result.error}`);
      return;
    }
    if (result.filePath) setStatus(`已打开 Word 原文：${result.filePath}`);
  }

  async function refreshChapterFromOriginal() {
    if (!selectedChapter) return;
    if (!window.confirm("将从导入时的 Word 原文重新生成富文档内容，用来恢复表格和版式。当前编辑副本会先自动备份，但正文里的后续手改内容可能被原文覆盖。继续吗？")) return;
    if (dirty) await saveChapter();
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
    const result = await window.novelAPI.exportBackup();
    if (result.filePath) setStatus(`备份已导出：${result.filePath}`);
  }

  async function rebuildIndex() {
    setStatus("正在重建整本小说知识库...");
    const result = await window.novelAPI.rebuildIndex();
    applyAppState(result.state);
    setStatus(`知识库已重建，共 ${result.chunks} 个片段`);
  }

  async function toggleTheme() {
    if (!state) return;
    const nextTheme = state.config.ui.theme === "dark" ? "light" : "dark";
    const next = await window.novelAPI.saveProjectSettings({
      ...state.config,
      ui: { ...state.config.ui, theme: nextTheme },
      selectedChapterId: selectedChapter?.id,
    });
    applyAppState(next);
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
        setRightWidth(Math.min(560, Math.max(300, initialRight - delta)));
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

  async function askSelectedText(text: string) {
    setContextMenu(null);
    const question = window.prompt("想让 AI 围绕选中文字回答什么？", "分析这段文字的作用，并给出修改建议。");
    if (!question) return;
    await sendChat(question, text);
  }

  async function sendChat(question: string, selection = selectedText) {
    const trimmed = question.trim();
    if (!trimmed) return;
    const userMessage: ChatMessage = {
      id: makeMessageId(),
      role: "user",
      content: selection ? `${trimmed}\n\n【选中文字】\n${selection}` : trimmed,
      createdAt: new Date().toISOString(),
    };
    const pendingId = makeMessageId();
    setChatMessages((items) => [
      ...items,
      userMessage,
      { id: pendingId, role: "assistant", content: "正在检索小说知识库并组织回答...", createdAt: new Date().toISOString() },
    ]);
    try {
      const response = await window.novelAPI.askAI({
        question: trimmed,
        selectedText: selection,
        history: chatMessages.map((item) => ({ role: item.role, content: item.content })),
      });
      setChatMessages((items) =>
        items.map((item) =>
          item.id === pendingId
            ? {
                ...item,
                content: response.answer,
                context: response.context,
              }
            : item,
        ),
      );
      if (response.embeddingWarning) setStatus(`检索已完成，本地向量回退：${response.embeddingWarning}`);
    } catch (error) {
      setChatMessages((items) =>
        items.map((item) =>
          item.id === pendingId
            ? { ...item, content: `请求失败：${error instanceof Error ? error.message : String(error)}` }
            : item,
        ),
      );
    }
  }

  async function saveCharacter(card: Partial<CharacterCard>) {
    const next = await window.novelAPI.saveCharacter(card);
    applyAppState(next);
    setView("characters");
  }

  async function deleteCharacter(characterId: string) {
    if (!window.confirm("确定删除这个角色卡片吗？")) return;
    const next = await window.novelAPI.deleteCharacter(characterId);
    applyAppState(next);
    setView("characters");
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
    const next = await window.novelAPI.saveWorldDoc(doc);
    applyAppState(next);
    setView("world");
  }

  async function deleteWorldDoc(docId: string) {
    if (!window.confirm("确定删除这份世界观设定吗？")) return;
    const next = await window.novelAPI.deleteWorldDoc(docId);
    applyAppState(next);
    setView("world");
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
    if (!window.confirm("将调用 AI 从大纲和正文中提取地点、势力、物品，并直接写入“世界”界面。继续吗？")) return;
    setStatus("正在提取地点、势力、物品条目...");
    try {
      const result = await window.novelAPI.extractWorldCardsFromOutline();
      applyAppState(result.state);
      setView("world");
      setStatus(`已提取资料条目：新增 ${result.created} 条，更新 ${result.updated} 条；使用检索片段 ${result.contextCount} 条`);
    } catch (error) {
      setStatus(`提取资料条目失败：${error instanceof Error ? error.message : String(error)}`);
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
          <button onClick={exportChapterDocx} title="导出当前章节为 Word 文档">
            <FileDown size={16} />
            导出DOCX
          </button>
          <button onClick={() => void exportBookDocx()} title="导出整本小说为 Word 文档">
            <BookOpen size={16} />
            导出整书
          </button>
          <button onClick={saveChapter} title="保存当前章节，快捷键 Ctrl+S">
            <Save size={16} />
            保存
          </button>
          <button onClick={exportBackup} title="导出压缩备份">
            <Download size={16} />
            备份
          </button>
          <button onClick={rebuildIndex} title="重建知识库索引">
            <RefreshCcw size={16} />
            重建索引
          </button>
        </nav>
        <div className="top-actions">
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
        className="workspace"
        ref={workspaceRef}
        style={{
          gridTemplateColumns: focusMode ? "minmax(520px, 1fr)" : `${leftWidth}px 6px minmax(420px, 1fr) 6px ${rightWidth}px`,
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
              <button className={view === "analysis" ? "active" : ""} onClick={() => setView("analysis")}>
                <Search size={16} /> 分析
              </button>
            </div>
            <ChapterTree
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
                  <button title="全屏专注" onClick={() => setFocusMode((value) => !value)}>
                    <Maximize2 size={17} />
                  </button>
                </div>
              </div>
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
              onExportBook={() => void exportBookDocx()}
              onExtractWorldCards={() => void extractWorldCardsFromOutline()}
              onStatus={setStatus}
            />
          )}
        </section>

        {!focusMode && <div className="pane-resizer" title="拖动调整右侧宽度" onMouseDown={(event) => startPaneResize("right", event)} />}

        {!focusMode && (
          <ChatPanel
            messages={chatMessages}
            selectedText={selectedText}
            onSend={(question) => void sendChat(question)}
            onClear={() => setChatMessages([])}
            onQuick={(question) => void sendChat(question, question.includes("当前章节") ? chapterContent : selectedText)}
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
        <strong>{status}</strong>
      </footer>

      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button onClick={() => void askSelectedText(contextMenu.text)}>
            <Wand2 size={15} />
            向 AI 提问
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
}: {
  value: string;
  fontSize: number;
  lineHeight: number;
  scrollAnchor: string;
  onChange: (value: string) => void;
  onSelection: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
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

function ChapterTree({
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
  const [dragOverVolume, setDragOverVolume] = useState("");
  const grouped = useMemo(() => {
    const map = new Map<string, Chapter[]>();
    for (const chapter of chapters) {
      const key = chapter.volume || "未分卷";
      map.set(key, [...(map.get(key) || []), chapter]);
    }
    return [...map.entries()];
  }, [chapters]);

  function toggleSet(setter: (updater: (current: Set<string>) => Set<string>) => void, key: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function collapseOrExpandAll() {
    setCollapsedChapters((current) => {
      if (current.size > 0) return new Set();
      return new Set(chapters.map((chapter) => chapter.id));
    });
    setCollapsedHeadings(new Set());
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
      {grouped.map(([volume, items]) => (
        <div className="volume" key={volume}>
          <div
            className={`volume-header ${dragOverVolume === volume ? "drag-over" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverVolume(volume);
            }}
            onDragLeave={() => setDragOverVolume((current) => (current === volume ? "" : current))}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOverVolume("");
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
                    onDragEnd={onDragEnd}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
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

function ChatPanel({
  messages,
  selectedText,
  onSend,
  onClear,
  onQuick,
}: {
  messages: ChatMessage[];
  selectedText: string;
  onSend: (question: string) => void;
  onClear: () => void;
  onQuick: (question: string) => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function submit() {
    const value = input.trim();
    if (!value) return;
    onSend(value);
    setInput("");
  }

  return (
    <aside className="right-pane">
      <div className="chat-header">
        <div>
          <Bot size={18} />
          <span>AI 对话</span>
        </div>
        <button title="清空当前对话" onClick={onClear}>
          <MessageSquarePlus size={16} />
        </button>
      </div>

      <div className="quick-prompts">
        {QUICK_PROMPTS.map((prompt) => (
          <button key={prompt} onClick={() => onQuick(prompt)}>
            {prompt}
          </button>
        ))}
      </div>

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
            <p>{message.content}</p>
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
    </aside>
  );
}

function AnalysisPanel({
  state,
  selectedChapterId,
  onSelectChapter,
  onOpenSource,
  onExportBook,
  onExtractWorldCards,
  onStatus,
}: {
  state: AppState;
  selectedChapterId: string;
  onSelectChapter: (chapterId: string) => void;
  onOpenSource: (result: GlobalSearchResult) => void;
  onExportBook: () => void;
  onExtractWorldCards: () => void;
  onStatus: (message: string) => void;
}) {
  const [tab, setTab] = useState<"search" | "timeline" | "relations" | "consistency" | "versions" | "export">("search");
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
  const [busy, setBusy] = useState("");
  const selectedChapter = state.chapters.find((chapter) => chapter.id === selectedChapterId) || state.selectedChapter;

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setBusy("search");
    onStatus("正在全局搜索...");
    try {
      const result = await window.novelAPI.globalSearch({ query: trimmed });
      setSearchResults(result.results);
      onStatus(`搜索完成：找到 ${result.results.length} 条结果`);
    } catch (error) {
      onStatus(`搜索失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function loadTimeline() {
    setBusy("timeline");
    onStatus("正在整理时间线...");
    try {
      const result = await window.novelAPI.buildTimeline();
      setTimelineEvents(result.events);
      onStatus(`时间线已整理：${result.events.length} 个事件`);
    } catch (error) {
      onStatus(`整理时间线失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function loadRelationships() {
    setBusy("relations");
    onStatus("正在生成角色关系网...");
    try {
      const result = await window.novelAPI.buildRelationshipGraph();
      setRelationshipNodes(result.nodes);
      setRelationshipEdges(result.edges);
      onStatus(`关系网已生成：${result.nodes.length} 个角色，${result.edges.length} 条关系`);
    } catch (error) {
      onStatus(`生成关系网失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function runConsistencyCheck() {
    setBusy("consistency");
    setConsistencyNotice("");
    onStatus("正在检查设定一致性...");
    try {
      const result = await window.novelAPI.analyzeConsistency();
      setIssues(result.issues);
      setConsistencyNotice(result.apiError ? `AI 暂时不可用，已显示本地检查结果：${result.apiError}` : `AI 检查完成，引用检索片段 ${result.contextCount} 条`);
      onStatus(`设定检查完成：发现 ${result.issues.length} 条待确认问题`);
    } catch (error) {
      onStatus(`设定检查失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
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

  useEffect(() => {
    if (tab === "timeline" && !timelineEvents.length) void loadTimeline();
    if (tab === "relations" && !relationshipNodes.length) void loadRelationships();
    if (tab === "versions" && selectedChapterId) void loadVersions();
  }, [tab, selectedChapterId]);

  const graph = useMemo(() => {
    const width = 920;
    const height = 460;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.max(120, Math.min(190, 34 + relationshipNodes.length * 8));
    const positions = new Map<string, { x: number; y: number }>();
    relationshipNodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, relationshipNodes.length) - Math.PI / 2;
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    });
    return { width, height, positions };
  }, [relationshipNodes]);

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
            <button onClick={() => void loadTimeline()} disabled={busy === "timeline"}>
              <RefreshCcw size={16} />
              刷新时间线
            </button>
          </div>
          <div className="timeline-list">
            {timelineEvents.map((event) => (
              <button key={event.id} className="timeline-item" onClick={() => onSelectChapter(event.chapterId)}>
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
          <div className="analysis-actions">
            <button onClick={() => void loadRelationships()} disabled={busy === "relations"}>
              <RefreshCcw size={16} />
              刷新关系网
            </button>
          </div>
          {relationshipNodes.length ? (
            <>
              <svg className="relationship-graph" viewBox={`0 0 ${graph.width} ${graph.height}`} role="img">
                {relationshipEdges.map((edge) => {
                  const source = graph.positions.get(edge.source);
                  const target = graph.positions.get(edge.target);
                  if (!source || !target) return null;
                  return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} strokeWidth={Math.max(1.5, edge.weight / 2)} />;
                })}
                {relationshipNodes.map((node) => {
                  const position = graph.positions.get(node.id);
                  if (!position) return null;
                  return (
                    <g key={node.id}>
                      <circle cx={position.x} cy={position.y} r={node.size} />
                      <text x={position.x} y={position.y + node.size + 15} textAnchor="middle">
                        {node.name}
                      </text>
                    </g>
                  );
                })}
              </svg>
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
                  <span>{issue.severity} / {issue.category}</span>
                </header>
                <p>{issue.detail}</p>
                {issue.suggestion && <em>{issue.suggestion}</em>}
                {!!issue.evidence.length && <small>{issue.evidence.join("；")}</small>}
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
        <div className="analysis-section tool-grid">
          <button className="tool-card" onClick={onExportBook}>
            <FileDown size={22} />
            <strong>导出整书 DOCX</strong>
            <span>按分卷和章节合并为一个 Word 文档。</span>
          </button>
          <button className="tool-card" onClick={onExtractWorldCards}>
            <Wand2 size={22} />
            <strong>提取地点/势力/物品</strong>
            <span>调用 AI 生成世界观条目，并直接写入“世界”界面。</span>
          </button>
        </div>
      )}
    </section>
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
          }}
          onDragLeave={() => setDragOverCategory((current) => (current === group.key ? "" : current))}
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
          }}
          onDragLeave={() => setDragOverCategory((current) => (current === group.key ? "" : current))}
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
  const provider = draft.api.provider;

  function updateApi<K extends keyof typeof draft.api>(key: K, value: (typeof draft.api)[K]) {
    setDraft((config) => ({ ...config, api: { ...config.api, [key]: value } }));
  }

  function updateUi<K extends keyof typeof draft.ui>(key: K, value: (typeof draft.ui)[K]) {
    setDraft((config) => ({ ...config, ui: { ...config.ui, [key]: value } }));
  }

  async function save() {
    const normalized = {
      ...draft,
      api: {
        ...draft.api,
        temperature: clampNumber(Number(draft.api.temperature), 0, 2, 0.7),
        maxTokens: Math.floor(clampNumber(Number(draft.api.maxTokens), 1, MAX_CHAT_TOKENS, 8000)),
        topK: Math.floor(clampNumber(Number(draft.api.topK), 1, MAX_RETRIEVAL_TOP_K, 5)),
      },
    };
    const next = await window.novelAPI.saveProjectSettings({ ...normalized, selectedChapterId });
    onSave(next);
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
            检索片段数量（最高 250）
            <input
              type="number"
              min="1"
              max={MAX_RETRIEVAL_TOP_K}
              value={draft.api.topK}
              onChange={(event) => updateApi("topK", Math.floor(clampNumber(Number(event.target.value), 1, MAX_RETRIEVAL_TOP_K, 5)))}
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
          <p>DeepSeek 推荐：接口地址 https://api.deepseek.com/v1，聊天模型 deepseek-chat，最大输出字数 4000-8000，检索片段数量可按项目大小调整，长篇大纲可设到 250。DeepSeek、OpenAI、Kimi、Ollama 和大多数中转接口使用 /chat/completions；Claude 使用 /v1/messages。向量接口使用 /embeddings。若不填向量接口密钥，软件会使用本地哈希向量作为临时索引。</p>
        </div>

        <footer>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void save()}>
            保存设置
          </button>
        </footer>
      </section>
    </div>
  );
}
