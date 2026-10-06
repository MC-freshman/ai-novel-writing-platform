import { useCallback, useEffect, useRef, useState } from "react";

export interface PageSaveHandle {
  save: () => Promise<boolean>;
  protect: () => Promise<boolean>;
}

type Entity = { id?: string; name?: string; title?: string; category?: string };
const entityKey = (value: Entity) => value.id || "new";
export interface EntityDraftProps<T> {
  projectPath: string;
  recoveryEnabled: boolean;
  onSave: (value: T) => Promise<T | null>;
  onRegisterSave: (kind: "character" | "world", handle: PageSaveHandle | null) => void;
}

export function useEntityDraft<T extends Entity>(kind: "character" | "world", items: T[], blank: T, props: EntityDraftProps<T>) {
  const { onRegisterSave, projectPath, recoveryEnabled } = props;
  const [active, setActive] = useState<T>(items[0] || blank);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("已保存");
  const current = useRef({ value: active, dirty: false, version: 0 });
  const options = useRef(props);
  options.current = props;
  const drafts = useRef(new Map<string, { value: T; draftId?: string }>());
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const savingPromise = useRef<Promise<boolean> | null>(null);

  const persist = useCallback(async () => {
    const snapshot = current.current;
    if (!snapshot.dirty) return true;
    const value = snapshot.value;
    const task = writes.current.catch(() => null).then(async () => {
      const result = await window.novelAPI.saveRecoveryDraft({
        kind, entityId: value.id || "", chapterId: "", chapterTitle: value.name || value.title || "未命名草稿",
        volume: value.category || "", content: JSON.stringify(value), baseRevision: "", wordCount: 0,
      });
      if ("disabled" in result) throw new Error("草稿恢复已关闭，请先保存当前条目。");
      drafts.current.set(entityKey(value), { value, draftId: result.chapterId });
    });
    writes.current = task;
    try { await task; setFeedback("草稿已保护，尚未提交"); return true; }
    catch (error) { setFeedback(`草稿保护失败：${error instanceof Error ? error.message : String(error)}`); return false; }
  }, [kind]);

  const save = useCallback(() => {
    if (savingPromise.current) return savingPromise.current;
    if (!current.current.dirty) return Promise.resolve(true);
    const snapshot = { ...current.current };
    const operation = (async () => {
      setSaving(true);
      setFeedback("保存中…");
      try {
        if (options.current.recoveryEnabled && !(await persist())) return false;
        const saved = await options.current.onSave(snapshot.value);
        if (!saved) { setFeedback("保存失败，草稿仍保留"); return false; }
        if (snapshot.version !== current.current.version) {
          if (!snapshot.value.id && saved.id) {
            current.current.value = { ...current.current.value, id: saved.id };
            setActive(current.current.value);
          }
          setFeedback("此前版本已保存，当前还有新改动");
          if (options.current.recoveryEnabled) await persist();
          if (!snapshot.value.id && saved.id) {
            const oldDraft = drafts.current.get("new");
            if (oldDraft?.draftId) await window.novelAPI.clearRecoveryDraft(oldDraft.draftId);
            drafts.current.delete("new");
          }
          return false;
        }
        const draft = drafts.current.get(entityKey(snapshot.value));
        await writes.current.catch(() => null);
        if (draft?.draftId) await window.novelAPI.clearRecoveryDraft(draft.draftId);
        if (snapshot.version !== current.current.version) {
          if (!snapshot.value.id && saved.id) {
            current.current.value = { ...current.current.value, id: saved.id };
            setActive(current.current.value);
          }
          if (options.current.recoveryEnabled) await persist();
          if (!snapshot.value.id && saved.id) drafts.current.delete("new");
          setFeedback("此前版本已保存，当前还有新改动");
          return false;
        }
        drafts.current.delete(entityKey(snapshot.value));
        current.current = { value: saved, dirty: false, version: snapshot.version + 1 };
        setActive(saved); setDirty(false); setFeedback("已保存并加入知识库");
        return true;
      } catch (error) { setFeedback(`保存失败：${error instanceof Error ? error.message : String(error)}`); return false; }
      finally { setSaving(false); savingPromise.current = null; }
    })();
    savingPromise.current = operation;
    return operation;
  }, [persist]);

  const protect = useCallback(async () => {
    if (savingPromise.current && !(await savingPromise.current)) return false;
    return options.current.recoveryEnabled ? persist() : save();
  }, [persist, save]);

  function update(value: T | ((value: T) => T)) {
    const next = typeof value === "function" ? value(current.current.value) : value;
    current.current = { value: next, dirty: true, version: current.current.version + 1 };
    const previous = drafts.current.get(entityKey(next));
    drafts.current.set(entityKey(next), { ...previous, value: next });
    setActive(next); setDirty(true); setFeedback("有未保存修改");
  }

  async function select(value: T) {
    if (savingPromise.current && !(await savingPromise.current)) return false;
    if (!(await protect())) return false;
    const draft = drafts.current.get(entityKey(value));
    const next = draft?.value || value;
    current.current = { value: next, dirty: Boolean(draft), version: current.current.version + 1 };
    setActive(next); setDirty(Boolean(draft)); setFeedback(draft ? "已恢复未保存草稿" : "已保存");
    return true;
  }

  async function discard() {
    const oldKey = entityKey(current.current.value);
    current.current = { value: blank, dirty: false, version: current.current.version + 1 };
    setActive(blank); setDirty(false);
    await writes.current.catch(() => null);
    const draft = drafts.current.get(oldKey);
    if (draft?.draftId) await window.novelAPI.clearRecoveryDraft(draft.draftId);
    drafts.current.delete(oldKey);
  }

  useEffect(() => {
    onRegisterSave(kind, { save, protect });
    return () => onRegisterSave(kind, null);
  }, [kind, onRegisterSave, protect, save]);

  useEffect(() => {
    if (current.current.dirty) return;
    const next = items.find((item) => item.id && item.id === current.current.value.id) || items[0] || blank;
    current.current = { ...current.current, value: next };
    setActive(next);
  }, [blank, items]);

  useEffect(() => {
    let cancelled = false;
    void window.novelAPI.getRecoveryStatus().then((recovery) => {
      if (cancelled) return;
      for (const draft of recovery.drafts.filter((item) => item.kind === kind)) {
        try {
          const value = JSON.parse(draft.content) as T;
          if (!value || typeof value !== "object") continue;
          if (!drafts.current.has(entityKey(value))) drafts.current.set(entityKey(value), { value, draftId: draft.chapterId });
        } catch { setFeedback("存在无法读取的草稿，请在恢复中心检查"); }
      }
      const latest = recovery.drafts.find((item) => item.kind === kind);
      const draft = drafts.current.get(entityKey(current.current.value)) || (latest ? drafts.current.get(latest.entityId || "new") : null);
      if (draft && !current.current.dirty) {
        current.current = { value: draft.value, dirty: true, version: current.current.version + 1 };
        setActive(draft.value); setDirty(true); setFeedback("已恢复未保存草稿");
      }
    }).catch(() => { if (!cancelled) setFeedback("草稿读取失败，请先检查恢复中心"); });
    return () => { cancelled = true; };
  }, [kind, projectPath]);

  useEffect(() => {
    if (!dirty || !recoveryEnabled) return;
    const timer = window.setTimeout(() => { void persist(); }, 650);
    return () => window.clearTimeout(timer);
  }, [active, dirty, persist, recoveryEnabled]);

  return { active, update, select, save, protect, discard, dirty, saving, feedback };
}
