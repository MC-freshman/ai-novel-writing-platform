const PERMISSIONS = ["只读分析", "可创建规划", "可生成修订候选"];
const SCOPE_TYPES = ["chapter", "volume", "book"];
const SCOPE_LABELS = { chapter: "当前章节", volume: "当前分卷", book: "全书" };

const TOOL_DEFINITIONS = {
  read_adjacent_chapters: { label: "读取相邻章节", reason: "核对当前章节与前后章节的直接承接", permission: "只读分析" },
  character_state_lookup: { label: "查询角色状态", reason: "读取人物地点、身心、能力、目标、阻碍与物品快照", permission: "只读分析" },
  recent_appearance_lookup: { label: "查询角色最近出场", reason: "确认相关人物上次出场章节与原文位置", permission: "只读分析" },
  knowledge_scope_lookup: { label: "查询人物知情范围", reason: "核对人物已知信息及其来源，避免越权知情", permission: "只读分析" },
  world_rule_lookup: { label: "查询世界观规则", reason: "读取本次问题涉及的世界规则、地点、势力与物品", permission: "只读分析" },
  open_foreshadow_lookup: { label: "查询未回收伏笔", reason: "读取待强化、待回收线索及多阶段证据", permission: "只读分析" },
  timeline_lookup: { label: "查询时间线", reason: "读取已保存的真实剧情事件顺序", permission: "只读分析" },
  chapter_transition_check: { label: "检查章节衔接", reason: "比较相邻章节结尾与开头的行动、地点和信息", permission: "只读分析" },
  setting_conflict_check: { label: "检查设定冲突", reason: "读取尚未解决的一致性问题和设定证据", permission: "只读分析" },
  outline_goal_lookup: { label: "查询大纲目标", reason: "查找当前章节或分卷对应的大纲目标", permission: "只读分析" },
  knowledge_coverage_check: { label: "检查知识库覆盖", reason: "确认所选范围内哪些资料已读取、未读取或证据不足", permission: "只读分析" },
  chapter_health_check: { label: "检查章节健康", reason: "检查章节目标、冲突、转折、信息、行动和结尾钩子", permission: "只读分析" },
  chapter_planner: { label: "章节规划器", reason: "整理下一章目标、场景承接、冲突与结尾落点", permission: "只读分析" },
  plot_causality_advisor: { label: "剧情因果参谋", reason: "核对事件原因、角色选择、代价与后果是否连贯", permission: "只读分析" },
  character_development_advisor: { label: "人物发展参谋", reason: "检查人物目标、认知、关系和成长变化", permission: "只读分析" },
  foreshadow_manager: { label: "伏笔管理器", reason: "查找待埋设、待强化和待回收的线索", permission: "只读分析" },
  pacing_analyzer: { label: "节奏分析器", reason: "检查场景密度、对话叙述比例和章节推进速度", permission: "只读分析" },
  continuity_checker: { label: "连续性检查器", reason: "核对时间、地点、人物状态和已有一致性问题", permission: "只读分析" },
  setting_verifier: { label: "设定核验器", reason: "核对世界规则、地点、势力、物品与能力限制", permission: "只读分析" },
  safe_revision_proposer: { label: "安全修订候选", reason: "对作者选中的原文生成待确认版本，不直接覆盖正文", permission: "可生成修订候选" },
};

function normalizePermission(value) {
  return PERMISSIONS.includes(value) ? value : "只读分析";
}

function permissionRank(value) {
  return PERMISSIONS.indexOf(normalizePermission(value));
}

function canUseTool(permission, tool) {
  return permissionRank(permission) >= permissionRank(TOOL_DEFINITIONS[tool]?.permission || "只读分析");
}

function normalizeScopeType(value) {
  return SCOPE_TYPES.includes(String(value || "")) ? String(value) : "chapter";
}

function recommendScopeType(objective, mode = "next") {
  const text = String(objective || "");
  if (/(全书|全文|整体|所有章节|跨卷|长篇|全局).*(检查|分析|梳理|节奏|一致性|伏笔|人物|设定)|检查.*(全书|全文|整体|所有)/.test(text)) return "book";
  if (/(本卷|当前卷|这一卷|分卷|卷内|阶段).*(检查|分析|梳理|节奏|剧情|伏笔|人物)|跨章/.test(text)) return "volume";
  if (mode === "foreshadow" && /(长期|主线|跨章|回收链)/.test(text)) return "volume";
  return "chapter";
}

function resolveScope(config = {}, chapter = null, requested = "auto", objective = "", mode = "next") {
  const type = requested === "auto" || !SCOPE_TYPES.includes(String(requested || ""))
    ? recommendScopeType(objective, mode)
    : normalizeScopeType(requested);
  const chapters = Array.isArray(config.chapters) ? config.chapters.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0)) : [];
  const volume = chapter?.volume || "未分卷";
  const scoped = type === "book" ? chapters : type === "volume" ? chapters.filter((item) => (item.volume || "未分卷") === volume) : chapters.filter((item) => item.id === chapter?.id);
  return {
    type,
    ids: scoped.map((item) => String(item.id)),
    label: type === "book" ? `全书（${scoped.length} 份文档）` : type === "volume" ? `${volume}（${scoped.length} 份文档）` : `当前章节：${chapter?.title || "未选择"}`,
    recommended: requested === "auto" || !SCOPE_TYPES.includes(String(requested || "")),
  };
}

function selectTools(objective, mode = "next", permission = "只读分析", selectedText = "") {
  const text = String(objective || "");
  const broad = /(全面|整体|综合|全书|都检查|所有)/.test(text);
  const selected = new Set();
  const add = (...tools) => tools.forEach((tool) => selected.add(tool));
  add("knowledge_coverage_check");
  if (mode === "next" || /(下一章|章节|衔接|接下来|开头|结尾)/.test(text)) add("read_adjacent_chapters", "chapter_transition_check", "outline_goal_lookup", "chapter_health_check");
  if (broad || /(人物|角色|成长|弧光|关系|性格|动机|塑造|知情|出场)/.test(text)) add("character_state_lookup", "recent_appearance_lookup", "knowledge_scope_lookup");
  if (mode === "foreshadow" || broad || /(伏笔|线索|悬念|回收|铺垫|预兆)/.test(text)) add("open_foreshadow_lookup");
  if (broad || /(时间|顺序|日期|前后|时间线)/.test(text)) add("timeline_lookup");
  if (broad || /(设定|世界观|规则|地点|势力|物品|能力|力量|矛盾|冲突)/.test(text)) add("world_rule_lookup", "setting_conflict_check");
  if (mode === "next" || /(下一章|章节|场景|接下来|怎么写|事件)/.test(text)) add("chapter_planner");
  if (mode === "plot" || broad || /(剧情|因果|动机|合理|冲突|选择|推进|转折)/.test(text)) add("plot_causality_advisor");
  if (broad || /(人物|角色|成长|弧光|关系|性格|动机|塑造)/.test(text)) add("character_development_advisor");
  if (mode === "foreshadow" || broad || /(伏笔|线索|悬念|回收|铺垫|预兆)/.test(text)) add("foreshadow_manager");
  if (broad || /(节奏|拖沓|过快|高潮|张力|对话|描写)/.test(text)) add("pacing_analyzer");
  if (broad || /(一致|连续|矛盾|漏洞|时间|地点|状态|检查)/.test(text)) add("continuity_checker");
  if (broad || /(设定|世界观|规则|地点|势力|物品|能力|力量)/.test(text)) add("setting_verifier");
  if (selectedText && /(润色|改写|扩写|精简|修订|修改文字)/.test(text)) add("safe_revision_proposer");
  if (!selected.size) add("chapter_planner", "plot_causality_advisor", "character_development_advisor", "pacing_analyzer");
  return [...selected].map((tool) => ({
    tool,
    ...TOOL_DEFINITIONS[tool],
    allowed: canUseTool(permission, tool),
    skipReason: canUseTool(permission, tool) ? "" : `当前权限为“${normalizePermission(permission)}”`,
  }));
}

function initialToolStates(tools = []) {
  return tools.map((item) => ({
    tool: item.tool,
    label: item.label,
    status: item.allowed ? "等待中" : "已跳过",
    detail: item.allowed ? item.reason : item.skipReason,
    partialOutput: "",
    error: "",
  }));
}

module.exports = {
  PERMISSIONS,
  SCOPE_LABELS,
  SCOPE_TYPES,
  TOOL_DEFINITIONS,
  canUseTool,
  initialToolStates,
  normalizePermission,
  normalizeScopeType,
  permissionRank,
  recommendScopeType,
  resolveScope,
  selectTools,
};
