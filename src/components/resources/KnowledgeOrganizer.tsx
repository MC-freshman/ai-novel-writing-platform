// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageSaveHandle, PageSaveKind } from "../../hooks/useEntityDraft";
import { Activity, ListTree, RefreshCcw, Save } from "lucide-react";
import type { AppState, MaintenanceDiagnostics, KnowledgeItem, KnowledgeRole, KnowledgeSyncStatus, ProjectHealthReport } from "../../types";
import { formatDateTime, getErrorMessage } from "../../lib/text-utils";
import { InlineFeedback } from "../ui/InlineFeedback";

export function KnowledgeOrganizer({
  state,
  onApplyState,
  onStatus,
  onRegisterSave,
}: {
  state: AppState;
  onApplyState: (state: AppState) => void;
  onStatus: (message: string) => void;
  onRegisterSave: (kind: PageSaveKind, handle: PageSaveHandle | null) => void;
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
  const [groupVolumes, setGroupVolumes] = useState(() => new Map(items.map((item) => [item.id, item.volume || "未分卷"])));
  const [filter, setFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<KnowledgeRole | "全部">("全部");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState("已保存");
  const [saveError, setSaveError] = useState(false);
  const draftRef = useRef({ items, dirty: false, version: 0 });
  const savingPromise = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(false);
  const dirty = draftRef.current.dirty;
  const [syncStatus, setSyncStatus] = useState<KnowledgeSyncStatus | null>(null);
  const [healthReport, setHealthReport] = useState<ProjectHealthReport | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceDiagnostics | null>(null);
  const [checking, setChecking] = useState(false);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [diagnosticErrors, setDiagnosticErrors] = useState<string[]>([]);
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
    for (const item of visibleItems) {
      const volume = groupVolumes.get(item.id) || item.volume || "未分卷";
      map.set(volume, [...(map.get(volume) || []), item]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
  }, [groupVolumes, visibleItems]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const loadKnowledge = useCallback(async () => {
    const version = draftRef.current.version;
    setLoadingItems(true);
    setLoadError("");
    setDiagnosticErrors([]);
    try {
      const result = await window.novelAPI.listKnowledgeItems();
      if (!mounted.current) return;
      if (!draftRef.current.dirty && draftRef.current.version === version) {
        draftRef.current.items = result.items;
        setItems(result.items);
        setGroupVolumes(new Map(result.items.map((item) => [item.id, item.volume || "未分卷"])));
      }
    } catch (error) {
      if (mounted.current) setLoadError(getErrorMessage(error));
    } finally {
      if (mounted.current) setLoadingItems(false);
    }
    const [statusResult, healthResult, maintenanceResult] = await Promise.allSettled([
      window.novelAPI.getKnowledgeStatus(),
      window.novelAPI.getProjectHealth(),
      window.novelAPI.getMaintenanceDiagnostics(),
    ]);
    if (!mounted.current) return;
    const errors: string[] = [];
    if (statusResult.status === "fulfilled") setSyncStatus(statusResult.value);
    else errors.push(`同步状态：${getErrorMessage(statusResult.reason)}`);
    if (healthResult.status === "fulfilled") setHealthReport(healthResult.value);
    else errors.push(`章节健康：${getErrorMessage(healthResult.reason)}`);
    if (maintenanceResult.status === "fulfilled") setMaintenance(maintenanceResult.value);
    else errors.push(`检索维护：${getErrorMessage(maintenanceResult.reason)}`);
    setDiagnosticErrors(errors);
  }, []);

  useEffect(() => {
    void loadKnowledge();
  }, [loadKnowledge, state.projectPath]);

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
      if (!mounted.current) return;
      setSyncStatus(result.status);
      onApplyState(result.state);
      const updated = (await window.novelAPI.listKnowledgeItems()).items;
      if (!mounted.current) return;
      draftRef.current = { items: updated, dirty: false, version: draftRef.current.version + 1 };
      setItems(updated);
      setGroupVolumes(new Map(updated.map((item) => [item.id, item.volume || "未分卷"])));
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

  function updateDraft(update: (current: KnowledgeItem[]) => KnowledgeItem[]) {
    const next = update(draftRef.current.items);
    draftRef.current = { items: next, dirty: true, version: draftRef.current.version + 1 };
    setItems(next);
    setSaveState("有未保存修改");
    setSaveError(false);
  }

  function updateItem(id: string, patch: Partial<KnowledgeItem>) {
    updateDraft((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function applyRoleToVisible(role: KnowledgeRole) {
    const ids = new Set(visibleItems.map((item) => item.id));
    updateDraft((current) => current.map((item) => (ids.has(item.id) ? { ...item, knowledgeRole: role } : item)));
  }

  const saveKnowledgeItems = useCallback((): Promise<boolean> => {
    if (savingPromise.current) return savingPromise.current;
    if (!draftRef.current.dirty) return Promise.resolve(true);
    const snapshot = draftRef.current;
    const operation = (async () => {
      setSaving(true);
      setSaveState("保存中…");
      setSaveError(false);
      onStatus("正在保存知识库分类...");
      try {
        const result = await window.novelAPI.updateKnowledgeItems({ items: snapshot.items });
        if (!mounted.current) return false;
        onApplyState(result.state);
        let warning = "";
        try {
          const status = await window.novelAPI.getKnowledgeStatus();
          if (mounted.current) setSyncStatus(status);
        } catch (error) {
          warning = `；同步状态读取失败：${getErrorMessage(error)}，请重新检查`;
        }
        if (!mounted.current) return false;
        const unchanged = snapshot.version === draftRef.current.version;
        if (unchanged) {
          draftRef.current = { items: result.items, dirty: false, version: snapshot.version + 1 };
          setItems(result.items);
          setGroupVolumes(new Map(result.items.map((item) => [item.id, item.volume || "未分卷"])));
        }
        setSaveState((unchanged ? "已保存" : "此前版本已保存，当前还有新改动待保存") + warning);
        onStatus((unchanged ? `知识库整理完成：${result.items.length} 个文档已同步到目录树` : "此前分类已保存，当前还有新改动待保存") + warning);
        return unchanged;
      } catch (error) {
        if (mounted.current) {
          const message = `保存知识库分类失败：${getErrorMessage(error)}`;
          setSaveState(message);
          setSaveError(true);
          onStatus(message);
        }
        return false;
      } finally {
        savingPromise.current = null;
        if (mounted.current) setSaving(false);
      }
    })();
    savingPromise.current = operation;
    return operation;
  }, [onApplyState, onStatus]);

  const protect = useCallback(async () => {
    if (savingPromise.current && !(await savingPromise.current)) return false;
    if (!draftRef.current.dirty) return true;
    if (!window.confirm("知识库分类有未保存修改。确定保存后继续吗？取消将保留当前页面和修改。")) return false;
    return saveKnowledgeItems();
  }, [saveKnowledgeItems]);

  useEffect(() => {
    onRegisterSave("knowledge", { save: saveKnowledgeItems, protect });
    return () => onRegisterSave("knowledge", null);
  }, [onRegisterSave, protect, saveKnowledgeItems]);

  return (
    <section className="knowledge-panel">
      <header className="knowledge-header">
        <div>
          <ListTree size={20} />
          <strong>知识库整理</strong>
        </div>
        <button className="primary" onClick={() => void saveKnowledgeItems()} disabled={saving || checking || !dirty}>
          <Save size={16} />
          {saving ? "保存中…" : "保存整理"}
        </button>
        <p className="knowledge-save-state draft-feedback" data-error={saveError} role={saveError ? "alert" : "status"} aria-live="polite">{saving ? "保存中…" : saveState}{dirty && !saving ? " · Ctrl+S 保存当前页" : ""}</p>
        {loadError && <InlineFeedback className="knowledge-feedback" title="知识库列表读取失败" message={loadError} actionLabel="重试读取" onAction={() => void loadKnowledge()} />}
        {!loadError && diagnosticErrors.length > 0 && <InlineFeedback className="knowledge-feedback" tone="warning" title="部分诊断未读取" message={diagnosticErrors.join("；")} actionLabel="重试诊断" onAction={() => void loadKnowledge()} />}
      </header>
      <details className="knowledge-status-panel">
        <summary>
          <span className="knowledge-sync-primary">
            <span className={`sync-dot ${syncStatus?.counts.errors ? "error" : syncStatus?.counts.pending ? "pending" : "ok"}`} />
            <strong>{syncStatus ? `知识库 ${syncStatus.counts.synced}/${syncStatus.counts.total} 已同步` : diagnosticErrors.length ? "知识库状态未读取" : "正在读取知识库状态"}</strong>
          </span>
          {syncStatus && <span className="knowledge-status-meta">文档摘要 {syncStatus.hierarchy.sourceSummaries} / 分组摘要 {syncStatus.hierarchy.volumeSummaries} / 全书摘要 {syncStatus.hierarchy.hasBookSummary ? "可用" : "待建立"}</span>}
          {healthReport && <span className="knowledge-status-meta">章节健康：{healthReport.healthy ? "正常" : `${healthReport.issues.length} 项待确认`}</span>}
          {maintenance && <span className="knowledge-status-meta">检索维护：{maintenance.healthy ? "正常" : `${maintenance.issues.length} 项提示`}</span>}
        </summary>
        <div className="knowledge-status-actions">
          <button onClick={() => void checkKnowledge()} disabled={checking}><RefreshCcw size={14} />重新检查</button>
          <button onClick={() => void repairKnowledge()} disabled={checking || saving || dirty || !syncStatus?.counts.pending}>补齐未同步资料</button>
          <button onClick={() => void repairHealth()} disabled={checking || saving || dirty || !healthReport?.issues.some((item) => item.repairable)}>修复可恢复问题</button>
          <button onClick={() => void repairMaintenance()} disabled={checking || saving || dirty}><Activity size={14} />修复索引与缓存</button>
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
            <button disabled={checking || !visibleItems.length} onClick={() => applyRoleToVisible("大纲")}>设为大纲</button>
            <button disabled={checking || !visibleItems.length} onClick={() => applyRoleToVisible("正文")}>设为正文</button>
            <button disabled={checking || !visibleItems.length} onClick={() => applyRoleToVisible("补充材料")}>设为补充材料</button>
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
                  <select disabled={checking} value={item.knowledgeRole} onChange={(event) => updateItem(item.id, { knowledgeRole: event.target.value as KnowledgeRole })}>
                    <option value="大纲">大纲</option>
                    <option value="正文">正文</option>
                    <option value="补充材料">补充材料</option>
                  </select>
                </label>
                <label>
                  所属目录
                  <input disabled={checking} list="knowledge-volumes" value={item.volume} onChange={(event) => updateItem(item.id, { volume: event.target.value })} />
                </label>
              </article>
            ))}
          </section>
        ))}
        {loadingItems && !groupedItems.length && <div className="analysis-empty">正在读取知识库文档…</div>}
        {!loadingItems && !loadError && !groupedItems.length && <div className="analysis-empty">{filter.trim() || roleFilter !== "全部" ? "没有匹配的文档。" : "项目中还没有文档。"}</div>}
      </div>
      <datalist id="knowledge-volumes">
        {volumes.map((volume) => (
          <option key={volume} value={volume} />
        ))}
      </datalist>
    </section>
  );
}
