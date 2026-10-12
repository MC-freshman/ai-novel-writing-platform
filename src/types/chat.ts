import type { RetrievalDiagnostics, RetrievedChunk } from "./retrieval";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  context?: RetrievedChunk[];
  retrieval?: RetrievalDiagnostics;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
