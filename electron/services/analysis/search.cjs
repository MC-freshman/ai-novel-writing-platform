"use strict";
const { loadProjectSources } = require("./dependencies.cjs");

function queryTokens(query) {
  const normalized = String(query || "")
    .toLowerCase()
    .trim();
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.includes(normalized)) tokens.unshift(normalized);
  return [...new Set(tokens)].slice(0, 8);
}

function makeSearchSnippet(text, tokens) {
  const content = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!content) return "";
  const lower = content.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token);
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) index = 0;
  const start = Math.max(0, index - 70);
  const end = Math.min(content.length, index + 150);
  return `${start > 0 ? "..." : ""}${content.slice(start, end)}${end < content.length ? "..." : ""}`;
}

async function globalSearch(projectPath, query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return { query: "", results: [] };
  const { sources } = await loadProjectSources(projectPath);
  const results = sources
    .map((source) => {
      const haystack =
        `${source.title}\n${source.category || ""}\n${source.text}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        let index = haystack.indexOf(token);
        while (index >= 0) {
          score += token.length >= 4 ? 4 : 2;
          index = haystack.indexOf(token, index + token.length);
        }
        if (
          String(source.title || "")
            .toLowerCase()
            .includes(token)
        )
          score += 12;
        if (
          String(source.category || "")
            .toLowerCase()
            .includes(token)
        )
          score += 6;
      }
      return {
        id: `${source.sourceType}_${source.id}`,
        sourceId: source.id,
        sourceType: source.sourceType,
        title: source.title,
        volume: source.volume || "",
        category: source.category || "",
        updatedAt: source.updatedAt || "",
        score,
        snippet: makeSearchSnippet(source.text, tokens),
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(a.title).localeCompare(String(b.title), "zh-CN"),
    )
    .slice(0, 80);
  return { query, results };
}

module.exports = { queryTokens, makeSearchSnippet, globalSearch };
