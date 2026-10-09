// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, IndentDecrease, IndentIncrease, ListTree, Plus, Trash2, Upload } from "lucide-react";
import type { Chapter } from "../types";

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

export function ChapterTree({
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
  const treeIdsRef = useRef({ chapterIds: allChapterIds, headingKeys: allHeadingKeys });
  treeIdsRef.current = { chapterIds: allChapterIds, headingKeys: allHeadingKeys };
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
    const { chapterIds, headingKeys } = treeIdsRef.current;
    try {
      const saved = window.localStorage.getItem(collapseStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { volumes?: string[]; chapters?: string[]; headings?: string[] };
        setCollapsedVolumes(new Set(parsed.volumes || []));
        setCollapsedChapters(new Set(parsed.chapters || []));
        setCollapsedHeadings(new Set(parsed.headings || []));
      } else {
        setCollapsedVolumes(new Set());
        setCollapsedChapters(new Set(chapterIds));
        setCollapsedHeadings(new Set(headingKeys));
      }
      previousChapterIdsRef.current = new Set(chapterIds);
    } catch {
      setCollapsedVolumes(new Set());
      setCollapsedChapters(new Set(chapterIds));
      setCollapsedHeadings(new Set(headingKeys));
      previousChapterIdsRef.current = new Set(chapterIds);
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
