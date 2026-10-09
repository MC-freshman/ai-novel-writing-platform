// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { marked } from "marked";
import { promoteMarkdownHeadingsInHtml } from "./editor-ops";

export function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}











export function countWords(text: string) {
  const clean = contentToPlainText(text);
  const cjk = clean.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const words = clean.replace(/[\u4e00-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + words;
}

export function isHtmlContent(content: string) {
  return /<\/?(h[1-6]|p|div|table|img|ul|ol|li|blockquote|section|details|summary|figure)\b/i.test(content || "");
}

export function contentToHtml(content: string) {
  const html = isHtmlContent(content) ? content : (marked.parse(content || "") as string);
  return promoteMarkdownHeadingsInHtml(html);
}

export function contentToPlainText(content: string) {
  const doc = new DOMParser().parseFromString(contentToHtml(content || ""), "text/html");
  return doc.body.textContent?.replace(/\s+/g, " ").trim() || "";
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sourceLabel(sourceType: string) {
  if (sourceType === "chapter") return "章节";
  if (sourceType === "character") return "角色";
  return "世界观";
}
export function formatDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}
export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
