// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { useEffect, useMemo, useState } from "react";
import { Activity, ListTree, RefreshCcw, Save } from "lucide-react";
import type { AppState, MaintenanceDiagnostics, KnowledgeItem, KnowledgeRole, KnowledgeSyncStatus, ProjectHealthReport } from "../types";
import { formatDateTime, getErrorMessage } from "../lib/text-utils";

export function KnowledgeOrganizer({
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
  }, [onStatus, state.projectPath]);

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
