import { useMemo, useState } from "react";
import { Boxes, ChevronDown, ChevronRight, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import type { WorldDoc } from "../types";
import { DEFAULT_CATEGORY_LABEL, groupByCategory, splitCategoryPath, type CategoryGroup } from "../lib/categories";
import { useEntityDraft, type EntityDraftProps } from "../hooks/useEntityDraft";

const blankDoc: Partial<WorldDoc> = { title: "", category: DEFAULT_CATEGORY_LABEL, content: "# 新设定\n\n" };

export function WorldManager({
  docs,
  onSave,
  onDelete,
  onGenerate,
  ...draftProps
}: {
  docs: WorldDoc[];
  onSave: (doc: Partial<WorldDoc>) => Promise<Partial<WorldDoc> | null>;
  onDelete: (id: string) => Promise<boolean>;
  onGenerate: () => void;
} & Omit<EntityDraftProps<Partial<WorldDoc>>, "onSave">) {
  const { active, update: setActive, select, save, protect, discard, dirty, saving, feedback } = useEntityDraft("world", docs, blankDoc, { ...draftProps, onSave });
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [draggingDocId, setDraggingDocId] = useState("");
  const [dragOverCategory, setDragOverCategory] = useState("");
  const [dragHint, setDragHint] = useState("");
  const groupedDocs = useMemo(() => groupByCategory(docs), [docs]);

  function toggleCategory(categoryKey: string) {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryKey)) next.delete(categoryKey);
      else next.add(categoryKey);
      return next;
    });
  }

  async function moveDocToCategory(category: string) {
    if (!draggingDocId) return;
    const doc = docs.find((item) => item.id === draggingDocId);
    if (!doc) return;
    if (!(await protect())) return;
    const next = { ...(active.id === doc.id ? active : doc), category };
    setActive(next);
    await save();
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
                onClick={() => void select(doc)}
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
            <button title="新建设定" onClick={() => void select({ ...blankDoc })}>
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
        <p className="draft-feedback" role="status" aria-live="polite">{saving ? "保存中…" : feedback}{dirty && !saving ? " · Ctrl+S 保存当前页" : ""}</p>
        <div className="form-actions">
          <button disabled={saving} onClick={() => void save()}>
            <Save size={16} />
            保存并加入知识库
          </button>
          {active.id && (
            <button className="danger" disabled={saving} onClick={() => void (async () => { if (await onDelete(active.id!)) { await discard(); await select(docs.find((doc) => doc.id !== active.id) || blankDoc); } })()}>
              <Trash2 size={16} />
              删除
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
