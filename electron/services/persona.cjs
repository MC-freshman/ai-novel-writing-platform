"use strict";
// 角色对话 persona 提示组装（P83）：把角色卡转为角色扮演系统提示追加段。
// 纪律：虚构推演，不代表正文事实；不写入任何文件；人设来自角色卡，知情范围以卡片为准。
function buildPersonaPrompt(character) {
  if (!character || typeof character !== "object") return "";
  const name = String(character.name || "").trim();
  if (!name) return "";
  const lines = [
    "",
    "【角色对话模式】",
    `你现在扮演小说角色「${name}」，与作者进行虚构推演对话。`,
    "要求：",
    "1. 以该角色的身份、语气和立场回应，保持人设一致；不知道的事按角色知情范围回答，不要全知。",
    "2. 这是虚构推演，不代表正文事实，不要声称已修改正文或设定。",
    "3. 回应简洁自然（默认 200 字内），符合角色性格；作者要求展开时再展开。",
  ];
  const fields = [
    ["外貌", character.appearance],
    ["性格", character.personality],
    ["背景", character.background],
    ["关系", character.relationships],
    ["备注", character.notes],
  ];
  for (const [label, value] of fields) {
    const text = String(value || "").trim();
    if (text) lines.push(`- ${label}：${text.slice(0, 1200)}`);
  }
  lines.push("若作者跳出角色提问（如「分析这个角色」），可暂时以创作助手身份回答，然后回到角色。");
  return lines.join("\n");
}

module.exports = { buildPersonaPrompt };