// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import type { ChatMessage, ChatSession, CreativeAdviceMode, Provider, RetrievalMode } from "../types";

export const PROVIDER_DEFAULTS: Record<Provider, { baseUrl: string; model: string; label: string }> = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  qwen: { label: "通义千问 / Qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  kimi: { label: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  claude: { label: "Claude", baseUrl: "https://api.anthropic.com", model: "claude-3-5-sonnet-latest" },
  ollama: { label: "Ollama 本地", baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b" },
  custom: { label: "自定义兼容接口", baseUrl: "https://api.example.com/v1", model: "model-name" },
};

export const QUICK_PROMPTS = [
  "分析当前章节节奏，并指出哪里需要放慢或加速。",
  "检查已有内容里可能存在的时间线矛盾。",
  "根据当前剧情给出三条下一章续写建议。",
  "总结主要角色目前的目标、秘密和冲突。",
];

export const MAX_CHAT_TOKENS = 393216;
export const MAX_RETRIEVAL_TOP_K = 1000;
export const MAX_RETRIEVAL_SCAN_K = 50000;
export const RETRIEVAL_MODE_OPTIONS: Array<{ value: RetrievalMode; label: string }> = [
  { value: "auto", label: "自动判断" },
  { value: "inventory", label: "资料盘点" },
  { value: "chapter", label: "指定章节" },
  { value: "entity", label: "角色/设定" },
  { value: "book", label: "全书分析" },
  { value: "current", label: "当前文档" },
  { value: "normal", label: "普通问答" },
];

export const CREATIVE_ADVICE_MODES: Array<{ value: CreativeAdviceMode; label: string }> = [
  { value: "next", label: "下一章建议" },
  { value: "plot", label: "剧情推进" },
  { value: "foreshadow", label: "伏笔建议" },
];
export function makeMessageId() {
  return `${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

export function makeChatSession(title = "新会话", messages: ChatMessage[] = []): ChatSession {
  const now = new Date().toISOString();
  return {
    id: `chat_${makeMessageId()}`,
    title,
    messages,
    createdAt: now,
    updatedAt: now,
  };
}

export function titleFromMessages(messages: ChatMessage[], fallback = "新会话") {
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim());
  const title = (firstUser?.content || fallback).replace(/\s+/g, " ").trim();
  return title.length > 18 ? `${title.slice(0, 18)}...` : title || fallback;
}

export function compactChatMessages(messages: ChatMessage[]) {
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

export function keepRecentChatSessions(sessions: ChatSession[], activeId: string) {
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
