// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { useEffect, useRef, useState } from "react";
import { Activity, Bot, Copy, Maximize2, Minimize2, MessageSquarePlus, Send, Sparkles, Square, Trash2, TriangleAlert } from "lucide-react";
import type { AppState, ChatMessage, ChatSession, RetrievalMode, RetrievalDiagnostics } from "../types";
import { sourceLabel, formatDateTime, getErrorMessage } from "../lib/text-utils";
import { QUICK_PROMPTS, RETRIEVAL_MODE_OPTIONS } from "../lib/chat-utils";
import { SidebarCreativeAdvisor } from "./SidebarCreativeAdvisor";

export function ChatPanel({
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
  chatOpenRequest,
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
  progress: { phase: string; stopped?: boolean; streamedChars: number; retrieval?: RetrievalDiagnostics } | null;
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
  chatOpenRequest: number;
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

  useEffect(() => {
    if (chatOpenRequest > 0) setAssistantTab("chat");
  }, [chatOpenRequest]);

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

          {progress && (generating || progress.stopped) && (
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

          {state.vectorStats?.embeddingFallback?.active && (
            <div className="embedding-warning" title={state.vectorStats.embeddingFallback.message}>
              <TriangleAlert size={14} />
              <span>向量接口降级：嵌入请求失败，正在用本地哈希向量代替，检索质量会明显下降。请在“设置 → 模型接口”检查向量接口配置。</span>
            </div>
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
