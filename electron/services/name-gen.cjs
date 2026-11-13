"use strict";
// 起名助手（P90）：自研字库组合规则（零依赖，公有领域常用字，不捆绑第三方版权语料）。
// seed 可复现；类型：角色/地点/功法/书名；风格：古风/玄幻/都市/通用。
// 可选 AI 批量列二期（v1 纯本地，离线可用）。

// 常用姓氏（公有领域）与名字用字（自研组合，非任何 copyrighted 名单）。
const SURNAMES = ["李", "王", "张", "刘", "陈", "杨", "赵", "黄", "周", "吴", "徐", "孙", "马", "朱", "胡", "郭", "何", "林", "罗", "郑", "梁", "谢", "宋", "唐", "许", "韩", "冯", "邓", "曹", "彭", "萧", "沈", "苏", "卢", "蒋", "蔡", "贾", "丁", "魏", "薛", "叶", "阎", "余", "潘", "杜", "戴", "夏", "钟", "汪", "田", "任", "姜", "范", "方", "石", "姚", "谭", "廖", "邹", "熊", "金", "陆", "郝", "孔", "白", "崔", "康", "毛", "邱", "秦", "江", "史", "顾", "侯", "邵", "孟", "龙", "万", "段", "雷", "钱", "汤", "尹", "黎", "易", "常", "武", "乔", "贺", "赖", "龚", "文"];
const GIVEN_CHARS = {
  古风: ["轩", "辕", "墨", "尘", "璃", "殇", "煜", "祺", "睿", "霖", "泽", "宇", "浩", "然", "博", "文", "景", "行", "止", "清", "衡", "兰", "芷", "若", "兮", "瑶", "璇", "玑", "璧", "琼", "琚", "瑶", "瑾", "瑜", "琰", "璋", "璞", "璟", "璘", "璨"],
  玄幻: ["天", "玄", "苍", "冥", "焱", "淼", "垚", "犇", "骉", "羴", "麟", "凤", "龙", "虎", "霄", "霆", "霆", "烨", "熠", "燊", "淼", "森", "鑫", "磊", "晶", "品", "众", "炎", "焱", "垚", "堃", "奎", "壁", "壂", "壑", "壤", "士", "壬", "癸", "甲"],
  都市: ["伟", "芳", "娜", "敏", "静", "丽", "强", "磊", "军", "洋", "勇", "艳", "杰", "娟", "涛", "明", "超", "秀英", "霞", "平", "刚", "桂英", "文", "华", "建", "国", "志", "宏", "峰", "岩", "松", "柏", "竹", "梅", "兰", "菊", "荷", "莲", "桂", "蓉"],
  通用: ["安", "宁", "远", "近", "高", "低", "山", "川", "河", "湖", "海", "江", "云", "风", "雨", "雪", "霜", "露", "晨", "昏", "晓", "暮", "春", "夏", "秋", "冬", "东", "西", "南", "北", "中", "正", "大", "小", "少", "老", "长", "幼", "青", "蓝"],
};
const PLACE_PREFIX = { 古风: ["青", "白", "云", "雾", "落", "寒", "沧", "碧", "紫", "玄"], 玄幻: ["九", "万", "苍", "冥", "玄", "天", "幽", "炎", "冰", "雷"], 都市: ["滨", "江", "海", "湖", "山", "河", "林", "城", "港", "湾"], 通用: ["东", "西", "南", "北", "中", "上", "下", "左", "右", "新"] };
const PLACE_SUFFIX = { 古风: ["州", "城", "镇", "渡", "关", "岭", "谷", "渊", "泽", "丘"], 玄幻: ["域", "界", "境", "天", "海", "山", "渊", "窟", "殿", "宫"], 都市: ["区", "县", "市", "镇", "乡", "村", "街", "道", "里", "坊"], 通用: ["州", "城", "镇", "村", "山", "河", "湖", "海", "岛", "原"] };
const SKILL_HEAD = { 古风: ["太", "玄", "清", "微", "紫", "霞", "凌", "波", "踏", "雪"], 玄幻: ["九", "天", "焚", "寂", "灭", "混沌", "洪荒", "太上", "无极", "造化"], 都市: ["军", "体", "拳", "意", "形", "八", "极", "崩", "炮", "横"], 通用: ["基础", "进阶", "高深", "入", "化", "通", "玄", "真", "灵", "圣"] };
const SKILL_TAIL = { 古风: ["诀", "功", "法", "经", "典", "录", "篇", "章", "式", "引"], 玄幻: ["诀", "典", "经", "录", "天功", "神法", "圣典", "真解", "秘录", "宝鉴"], 都市: ["拳", "掌", "腿", "功", "法", "术", "式", "劲", "意", "形"], 通用: ["诀", "功", "法", "经", "术", "式", "拳", "掌", "指", "剑"] };
const BOOK_PATTERNS = {
  古风: ["{place}{skill}", "{surname}氏{skill}", "{place}行", "{skill}录", "{place}旧事"],
  玄幻: ["{skill}纪", "{place}传说", "{surname}天帝", "{skill}大陆", "{place}纪元"],
  都市: ["{place}往事", "{surname}小姐", "{place}风云", "{skill}人生", "{place}故事"],
  通用: ["{place}记", "{skill}传", "{surname}家", "{place}春秋", "{skill}志"],
};

function makeRng(seed) {
  let state = 0;
  const text = String(seed || "default");
  for (let index = 0; index < text.length; index += 1) state = (state * 31 + text.charCodeAt(index)) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0xffffffff;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function generateNames({ type = "character", style = "通用", count = 10, seed = "" } = {}) {
  const safeStyle = GIVEN_CHARS[style] ? style : "通用";
  const rng = makeRng(`${seed}|${type}|${safeStyle}`);
  const safeCount = Math.min(Math.max(1, Math.floor(Number(count) || 10)), 50);
  const names = new Set();
  let guard = 0;
  while (names.size < safeCount && guard < safeCount * 30) {
    guard += 1;
    if (type === "character") {
      const surname = pick(rng, SURNAMES);
      const givenLength = rng() > 0.5 ? 2 : 1;
      let given = "";
      for (let i = 0; i < givenLength; i += 1) given += pick(rng, GIVEN_CHARS[safeStyle]);
      names.add(surname + given);
    } else if (type === "place") {
      names.add(pick(rng, PLACE_PREFIX[safeStyle]) + pick(rng, PLACE_SUFFIX[safeStyle]));
    } else if (type === "skill") {
      names.add(pick(rng, SKILL_HEAD[safeStyle]) + pick(rng, SKILL_TAIL[safeStyle]));
    } else if (type === "book") {
      const pattern = pick(rng, BOOK_PATTERNS[safeStyle]);
      const name = pattern
        .replace("{place}", pick(rng, PLACE_PREFIX[safeStyle]) + pick(rng, PLACE_SUFFIX[safeStyle]))
        .replace("{skill}", pick(rng, SKILL_HEAD[safeStyle]) + pick(rng, SKILL_TAIL[safeStyle]))
        .replace("{surname}", pick(rng, SURNAMES));
      names.add(name);
    } else {
      throw new Error(`不支持的起名类型：${type}`);
    }
  }
  return { type, style: safeStyle, seed: String(seed || ""), names: [...names] };
}

module.exports = { SURNAMES, generateNames, makeRng, parseAiNames, generateNamesAi };

/** 从 AI 回答中提取名字数组（JSON 数组或逐行），去重去空。 */
function parseAiNames(text, count) {
  const raw = String(text || "");
  let names = [];
  const match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) names = parsed.map((item) => (typeof item === "string" ? item : String(item?.name || "")));
    } catch { /* 回退逐行 */ }
  }
  if (!names.length) {
    names = raw.split(/\r?\n/).map((line) => line.replace(/^[\d\-.、\s]+/, "").trim());
  }
  const seen = new Set();
  const result = [];
  for (const name of names) {
    const cleaned = String(name || "").trim().slice(0, 30);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
    if (result.length >= count) break;
  }
  return result;
}

/** AI 批量起名（P98）：复用聊天接口；失败由调用方降级本地。 */
async function generateNamesAi(projectPath, { type = "character", style = "通用", count = 10, theme = "" } = {}) {
  const { loadConfig } = require("./project-ops.cjs");
  const { callChatApi } = require("./ai-generate.cjs");
  const config = await loadConfig(projectPath);
  const safeCount = Math.min(Math.max(1, Math.floor(Number(count) || 10)), 50);
  const typeLabel = { character: "角色姓名", place: "地点名", skill: "功法/技能名", book: "书名" }[type] || "角色姓名";
  const systemPrompt = `你是小说起名助手。生成${safeCount}个${typeLabel}，风格：${style}${theme ? `，主题/要求：${theme}` : ""}。仅输出 JSON 字符串数组（如 ["名1","名2"]），不要解释。名字原创、符合中文语感、避免生僻字堆砌。`;
  const answer = await callChatApi(config, systemPrompt, `请生成${safeCount}个${typeLabel}。`, [], { stream: false });
  const names = parseAiNames(answer, safeCount);
  if (!names.length) throw new Error("AI 未返回有效名字，请重试或使用本地生成。");
  return { type, style, seed: `ai:${theme}`, names, source: "ai" };
}