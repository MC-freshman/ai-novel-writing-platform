import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Save, Trash2, UserRound, Wand2 } from "lucide-react";
import type { CharacterCard } from "../types";
import { DEFAULT_CATEGORY_LABEL, groupByCategory, splitCategoryPath, type CategoryGroup } from "../lib/categories";
import { useEntityDraft, type EntityDraftProps } from "../hooks/useEntityDraft";

const blankCard: Partial<CharacterCard> = { name: "", category: DEFAULT_CATEGORY_LABEL, appearance: "", personality: "", background: "", relationships: "", notes: "" };

export function CharacterManager({
  cards,
  onSave,
  onDelete,
  onGenerate,
  ...draftProps
}: {
  cards: CharacterCard[];
  onSave: (card: Partial<CharacterCard>) => Promise<Partial<CharacterCard> | null>;
  onDelete: (id: string) => Promise<boolean>;
  onGenerate: () => void;
} & Omit<EntityDraftProps<Partial<CharacterCard>>, "onSave">) {
  const { active, update: setActive, select, save, protect, discard, dirty, saving, feedback } = useEntityDraft("character", cards, blankCard, { ...draftProps, onSave });
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [draggingCardId, setDraggingCardId] = useState("");
  const [dragOverCategory, setDragOverCategory] = useState("");
  const [dragHint, setDragHint] = useState("");
  const groupedCards = useMemo(() => groupByCategory(cards), [cards]);

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

  async function moveCardToCategory(category: string) {
    if (!draggingCardId) return;
    const card = cards.find((item) => item.id === draggingCardId);
    if (!card) return;
    if (!(await protect())) return;
    const next = { ...(active.id === card.id ? active : card), category };
    setActive(next);
    await save();
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
                onClick={() => void select(card)}
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
            <button title="新建角色" onClick={() => void select({ ...blankCard })}>
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
        <p className="draft-feedback" role="status" aria-live="polite">{saving ? "保存中…" : feedback}{dirty && !saving ? " · Ctrl+S 保存当前页" : ""}</p>
        <div className="form-actions">
          <button disabled={saving} onClick={() => void save()}>
            <Save size={16} />
            保存并加入知识库
          </button>
          {active.id && (
            <button className="danger" disabled={saving} onClick={() => void (async () => { if (await onDelete(active.id!)) { await discard(); await select(cards.find((card) => card.id !== active.id) || blankCard); } })()}>
              <Trash2 size={16} />
              删除
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
