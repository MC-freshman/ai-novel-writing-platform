// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import type { AppState, AgentPermissionLevel, AgentScopeType, CreativeAdviceItem, CreativeAdviceMode, CreativeAdviceResult, CreativeAgentRun, StoryOverview } from "../types";
import { countWords, formatDateTime, getErrorMessage } from "../lib/text-utils";
import { CREATIVE_ADVICE_MODES } from "../lib/chat-utils";

export function SidebarCreativeAdvisor({
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
