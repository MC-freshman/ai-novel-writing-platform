import type { MindMap, MindMapNode, MindMapRelation, MindMapSide } from "../types";

export const MIND_NODE_WIDTH = 168;
export const MIND_NODE_HEIGHT = 40;
const LEVEL_GAP = 228;
const LEAF_GAP = 62;
const PADDING = 70;

export interface LaidMindNode {
  id: string;
  node: MindMapNode;
  x: number;
  y: number;
  depth: number;
  side: MindMapSide | "center";
  childCount: number;
}
export interface LaidMindEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}
export interface MindMapLayout {
  nodes: LaidMindNode[];
  edges: LaidMindEdge[];
  width: number;
  height: number;
}
/** 关系线布局结果：d 是可直接绘制的 SVG 路径，(lx, ly) 是标签锚点。 */
export interface LaidMindRelation {
  id: string;
  sourceId: string;
  targetId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  d: string;
  lx: number;
  ly: number;
  relation: MindMapRelation;
}

/** 关系线默认三次贝塞尔控制点：与父子树边保持同一视觉风格。 */
function defaultControlPoints(x1: number, y1: number, x2: number, y2: number) {
  const middleX = (x1 + x2) / 2;
  return { c1x: middleX, c1y: y1, c2x: middleX, c2y: y2 };
}

/**
 * 把关系线的相对控制点换算成当前布局下的绝对坐标。
 * amount / x 沿「源 → 目标」方向偏移，angle / y 沿垂直于连线的方向偏移；
 * 四个值统一按连线长度缩放（都是相对量），因此折叠、重新布局或缩放后曲线形状保持一致。
 */
function resolveControlPoints(relation: MindMapRelation, x1: number, y1: number, x2: number, y2: number) {
  const fallback = defaultControlPoints(x1, y1, x2, y2);
  const rawPoints = Array.isArray(relation.controlPoints) ? relation.controlPoints : [];
  const points = rawPoints.filter((point) => point
    && Number.isFinite(point.amount) && Number.isFinite(point.angle)
    && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!points.length) return fallback;
  const deltaX = x2 - x1;
  const deltaY = y2 - y1;
  const distance = Math.hypot(deltaX, deltaY);
  const length = Number.isFinite(distance) && distance > 0 ? distance : 1;
  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  const adjust = (baseX: number, baseY: number, point: { amount: number; angle: number; x: number; y: number }) => {
    const along = (point.amount + point.x) * length * 0.25;
    const across = (point.angle + point.y) * length * 0.25;
    return {
      x: baseX + along * unitX + across * perpendicularX,
      y: baseY + along * unitY + across * perpendicularY,
    };
  };
  const first = adjust(fallback.c1x, fallback.c1y, points[0]);
  const second = points[1]
    ? adjust(fallback.c2x, fallback.c2y, points[1])
    : { x: fallback.c2x, y: fallback.c2y };
  const resolved = { c1x: first.x, c1y: first.y, c2x: second.x, c2y: second.y };
  // 仅「有限」不足以保证曲线可见：合法但极端的相对量会算出有限却飞出画布的坐标。
  // 控制点必须落在两端点包围盒（各方向外扩一个 span）内，否则整体回落默认控制点。
  const span = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
  const minX = Math.min(x1, x2) - span;
  const maxX = Math.max(x1, x2) + span;
  const minY = Math.min(y1, y2) - span;
  const maxY = Math.max(y1, y2) + span;
  const inRange = [resolved.c1x, resolved.c2x].every((value) => Number.isFinite(value) && value >= minX && value <= maxX)
    && [resolved.c1y, resolved.c2y].every((value) => Number.isFinite(value) && value >= minY && value <= maxY);
  return inRange ? resolved : fallback;
}

/**
 * 把 relations 按当前布局坐标换算成可绘制的 SVG 连线。
 * 任一端点不在 layout.nodes（被折叠 / 隐藏或数据悬空）时跳过，避免画出孤立坐标；
 * 端点取节点矩形边界交点而非中心，避免箭头被后绘制的节点矩形覆盖。
 * 本函数不改动 layoutMindMap 的主体与 LaidMindEdge，只消费其输出。
 */
export function layoutRelations(map: MindMap, layout: MindMapLayout): LaidMindRelation[] {
  // 公开纯函数：layout 可能来自自定义调用方，非数组节点集合按空集合安全降级。
  const nodes = Array.isArray(layout.nodes) ? layout.nodes : [];
  const coordinates = new Map(nodes.map((item) => [item.id, { x: item.x, y: item.y }]));
  const relations = Array.isArray(map.relations) ? map.relations : [];
  const result: LaidMindRelation[] = [];
  const halfWidth = MIND_NODE_WIDTH / 2;
  const halfHeight = MIND_NODE_HEIGHT / 2;
  for (const relation of relations) {
    if (!relation || typeof relation !== "object") continue;
    const source = coordinates.get(relation.sourceId);
    const target = coordinates.get(relation.targetId);
    if (!source || !target) continue;
    if (![source.x, source.y, target.x, target.y].every(Number.isFinite)) continue;
    const deltaX = target.x - source.x;
    const deltaY = target.y - source.y;
    // 自环 / 端点重合时方向向量退化，跳过以免产出 NaN 坐标。
    if (deltaX === 0 && deltaY === 0) continue;
    // 射线与 168×40 节点矩形的交点：取沿方向向量最先触达的边界比例。
    const ratioX = deltaX === 0 ? Infinity : halfWidth / Math.abs(deltaX);
    const ratioY = deltaY === 0 ? Infinity : halfHeight / Math.abs(deltaY);
    // 上限 0.5：节点中心距过小时避免两端点越过中点交叉（自定义 layout / 重叠节点）。
    const ratio = Math.min(0.5, ratioX, ratioY);
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const x1 = source.x + deltaX * ratio;
    const y1 = source.y + deltaY * ratio;
    const x2 = target.x - deltaX * ratio;
    const y2 = target.y - deltaY * ratio;
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const shape = relation.shape ?? "curved";
    const middleX = (x1 + x2) / 2;
    const middleY = (y1 + y2) / 2;
    let d: string;
    let lx = middleX;
    let ly = middleY;
    if (shape === "straight") {
      d = `M ${x1} ${y1} L ${x2} ${y2}`;
    } else if (shape === "elbow") {
      d = `M ${x1} ${y1} L ${middleX} ${y1} L ${middleX} ${y2} L ${x2} ${y2}`;
    } else {
      const control = resolveControlPoints(relation, x1, y1, x2, y2);
      d = `M ${x1} ${y1} C ${control.c1x} ${control.c1y}, ${control.c2x} ${control.c2y}, ${x2} ${y2}`;
      // 三次贝塞尔在 t = 0.5 处的点：(P0 + 3P1 + 3P2 + P3) / 8。
      lx = (x1 + 3 * control.c1x + 3 * control.c2x + x2) / 8;
      ly = (y1 + 3 * control.c1y + 3 * control.c2y + y2) / 8;
    }
    result.push({
      id: relation.id, sourceId: relation.sourceId, targetId: relation.targetId,
      x1, y1, x2, y2, d, lx, ly, relation,
    });
  }
  return result;
}

/**
 * 把 positions 偏移叠加到布局结果上，供自由摆放使用。
 * 节点叠加自身偏移；树边的 x1/y1 与 x2/y2 按端点所属节点各自叠加
 * （LaidMindEdge.id 形如 `${parentId}>${childId}`）。
 * 不改动 layoutMindMap 主体：本函数只消费其输出。
 */
export function applyPositions(
  layout: MindMapLayout,
  positions?: Record<string, { dx: number; dy: number }>,
): MindMapLayout {
  const source = positions && typeof positions === "object" && !Array.isArray(positions) ? positions : {};
  const offsets = new Map<string, { dx: number; dy: number }>();
  for (const [key, value] of Object.entries(source)) {
    if (!Number.isFinite(value?.dx) || !Number.isFinite(value?.dy)) continue;
    offsets.set(key, { dx: value.dx, dy: value.dy });
  }
  if (!offsets.size) return layout;
  const shift = (id: string) => offsets.get(id) || { dx: 0, dy: 0 };
  const nodes = layout.nodes.map((item) => {
    const delta = shift(item.id);
    return { ...item, x: item.x + delta.dx, y: item.y + delta.dy };
  });
  const edges = layout.edges.map((edge) => {
    // 子节点 id 由 newId() 生成，不含 ">"；父节点 id 可能来自外部数据而含 ">"，
    // 因此用 lastIndexOf 从末尾切分，避免把父 id 截断（N2）。
    const rawId = String(edge.id);
    const cut = rawId.lastIndexOf(">");
    const parentId = cut > 0 ? rawId.slice(0, cut) : "";
    const childId = cut >= 0 ? rawId.slice(cut + 1) : rawId;
    const from = shift(parentId);
    const to = shift(childId);
    return {
      ...edge,
      x1: edge.x1 + from.dx, y1: edge.y1 + from.dy,
      x2: edge.x2 + to.dx, y2: edge.y2 + to.dy,
    };
  });
  return { ...layout, nodes, edges };
}

/**
 * 画布显示边界：把节点矩形、树边端点、关系线端点、标签底板与箭头余量全部纳入，四周再留 padding。
 * 组件把返回的 x/y 同时用作 SVG 的 left/top 与 viewBox 的 x/y，保持 1:1 坐标映射：
 * 所有节点与连线坐标数值不变，只是渲染范围随内容动态扩大，避免超界连线被裁剪。
 */
export function mindMapCanvasBounds(
  layout: MindMapLayout,
  relations: LaidMindRelation[],
  padding = 160,
): { x: number; y: number; width: number; height: number } {
  const xs = [0, layout.width];
  const ys = [0, layout.height];
  const nodes = Array.isArray(layout.nodes) ? layout.nodes : [];
  const edges = Array.isArray(layout.edges) ? layout.edges : [];
  const links = Array.isArray(relations) ? relations : [];
  for (const node of nodes) {
    xs.push(node.x - MIND_NODE_WIDTH / 2, node.x + MIND_NODE_WIDTH / 2);
    ys.push(node.y - MIND_NODE_HEIGHT / 2, node.y + MIND_NODE_HEIGHT / 2);
  }
  for (const edge of edges) { xs.push(edge.x1, edge.x2); ys.push(edge.y1, edge.y2); }
  for (const item of links) {
    // 标签底板最宽 280、位于连线上方约 44px；箭头 marker 再外扩 16px。
    xs.push(item.x1, item.x2, item.lx - 150, item.lx + 150);
    ys.push(item.y1, item.y2, item.ly - 70, item.ly + 20);
  }
  const minX = xs.reduce((value, item) => Math.min(value, item), Infinity) - padding;
  const minY = ys.reduce((value, item) => Math.min(value, item), Infinity) - padding;
  const maxX = xs.reduce((value, item) => Math.max(value, item), -Infinity) + padding;
  const maxY = ys.reduce((value, item) => Math.max(value, item), -Infinity) + padding;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createMindMap(): MindMap {
  const now = new Date().toISOString();
  const id = newId("mind");
  const rootId = `${id}_root`;
  return {
    id,
    title: "未命名思维导图",
    rootId,
    createdAt: now,
    updatedAt: now,
    nodes: [{
      id: rootId, parentId: "", text: "中心主题", note: "", color: "",
      collapsed: false, order: 0, side: "right",
    }],
  };
}

export function createMindMapNode(parent: MindMapNode, side: MindMapSide, order: number): MindMapNode {
  return {
    id: newId("node"), parentId: parent.id, text: "新主题", note: "", color: "",
    collapsed: false, order, side,
  };
}

export function descendants(map: MindMap, nodeId: string): string[] {
  const byParent = new Map<string, string[]>();
  for (const node of map.nodes) byParent.set(node.parentId, [...(byParent.get(node.parentId) || []), node.id]);
  const result: string[] = [];
  const seen = new Set<string>([nodeId]);
  const stack = [...(byParent.get(nodeId) || [])];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    stack.push(...(byParent.get(id) || []));
  }
  return result;
}

/** 单棵树的左右双向布局；坐标原点在中心主题，返回已平移到非负坐标的结果。 */
function layoutTree(root: MindMapNode, byParent: Map<string, MindMapNode[]>): MindMapLayout {
  const children = new Map<string, MindMapNode[]>();
  const seen = new Set<string>();
  const build = (node: MindMapNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const kids = node.collapsed ? [] : (byParent.get(node.id) || []).filter((kid) => kid.id !== node.id && !seen.has(kid.id));
    children.set(node.id, kids);
    kids.forEach(build);
  };
  build(root);

  const leaves = (node: MindMapNode): number => {
    const kids = children.get(node.id) || [];
    return kids.length ? kids.reduce((sum, kid) => sum + leaves(kid), 0) : 1;
  };
  const placed: LaidMindNode[] = [];
  const edges: LaidMindEdge[] = [];
  const pushEdge = (parent: LaidMindNode, child: LaidMindNode, side: MindMapSide) => {
    const half = MIND_NODE_WIDTH / 2;
    edges.push({
      id: `${parent.id}>${child.id}`,
      x1: parent.x + (side === "left" ? -half : half), y1: parent.y,
      x2: child.x + (side === "left" ? half : -half), y2: child.y,
      color: child.node.color || "",
    });
  };
  const place = (node: MindMapNode, x: number, top: number, depth: number, side: MindMapSide) => {
    const height = leaves(node);
    const item: LaidMindNode = {
      id: node.id, node, x, y: top + (height * LEAF_GAP) / 2, depth, side,
      childCount: (byParent.get(node.id) || []).length,
    };
    placed.push(item);
    let cursor = top;
    for (const kid of children.get(node.id) || []) {
      const kidHeight = leaves(kid);
      const child = place(kid, x + (side === "left" ? -LEVEL_GAP : LEVEL_GAP), cursor, depth + 1, side);
      pushEdge(item, child, side);
      cursor += kidHeight * LEAF_GAP;
    }
    return item;
  };

  const rootItem: LaidMindNode = {
    id: root.id, node: root, x: 0, y: 0, depth: 0, side: "center",
    childCount: (byParent.get(root.id) || []).length,
  };
  placed.push(rootItem);
  const firstLevel = children.get(root.id) || [];
  const left = firstLevel.filter((node) => node.side === "left");
  const right = firstLevel.filter((node) => node.side !== "left");
  const leftLeaves = left.reduce((sum, node) => sum + leaves(node), 0);
  const rightLeaves = right.reduce((sum, node) => sum + leaves(node), 0);
  for (const [group, side, total] of [[left, "left", leftLeaves], [right, "right", rightLeaves]] as Array<[MindMapNode[], MindMapSide, number]>) {
    let cursor = -(total * LEAF_GAP) / 2;
    for (const node of group) {
      const child = place(node, side === "left" ? -LEVEL_GAP : LEVEL_GAP, cursor, 1, side);
      pushEdge({ ...rootItem, side }, child, side);
      cursor += leaves(node) * LEAF_GAP;
    }
  }

  const leftExtent = Math.abs(Math.min(0, ...placed.map((item) => item.x - MIND_NODE_WIDTH / 2)));
  const rightExtent = Math.abs(Math.max(0, ...placed.map((item) => item.x + MIND_NODE_WIDTH / 2)));
  const topExtent = Math.abs(Math.min(0, ...placed.map((item) => item.y - MIND_NODE_HEIGHT / 2)));
  const bottomExtent = Math.abs(Math.max(0, ...placed.map((item) => item.y + MIND_NODE_HEIGHT / 2)));
  // 左右、上下使用对称边界，中心主题始终落在画布正中，不会因为只有单侧分支而贴边。
  const extentX = Math.max(leftExtent, rightExtent, LEVEL_GAP + MIND_NODE_WIDTH / 2) + PADDING;
  const extentY = Math.max(topExtent, bottomExtent, LEAF_GAP) + PADDING;
  return {
    nodes: placed.map((item) => ({ ...item, x: item.x + extentX, y: item.y + extentY })),
    edges: edges.map((edge) => ({ ...edge, x1: edge.x1 + extentX, x2: edge.x2 + extentX, y1: edge.y1 + extentY, y2: edge.y2 + extentY })),
    width: extentX * 2,
    height: extentY * 2,
  };
}

/**
 * 计算 XMind 风格的左右双向树布局。
 * 单根时走原逻辑，输出与历史版本完全一致；存在多个 parentId 为空的独立中心时，
 * 每棵树单独布局后垂直堆叠，块与块之间不生成树边，也不会互相连线。
 */
export function layoutMindMap(map: MindMap): MindMapLayout {
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const byParent = new Map<string, MindMapNode[]>();
  for (const node of map.nodes) {
    byParent.set(node.parentId, [...(byParent.get(node.parentId) || []), node]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const root = byId.get(map.rootId) || map.nodes[0];
  if (!root) return { nodes: [], edges: [], width: 900, height: 520 };

  // parentId 指向不存在 id 的脏节点仍按历史语义忽略，不误判为独立中心。
  const roots = map.nodes.filter((node) => !node.parentId || node.parentId === node.id);
  roots.sort((a, b) => (a.id === root.id ? -1 : b.id === root.id ? 1 : a.order - b.order || a.id.localeCompare(b.id)));
  if (!roots.length) roots.push(root);
  if (!roots.some((item) => item.id === root.id)) roots.unshift(root);
  if (roots.length === 1) return layoutTree(roots[0], byParent);

  const blocks = roots.map((item) => layoutTree(item, byParent));
  const maxWidth = Math.max(...blocks.map((block) => block.width));
  const gap = 72;
  const nodes: LaidMindNode[] = [];
  const edges: LaidMindEdge[] = [];
  let cursorY = PADDING;
  for (const block of blocks) {
    const tx = PADDING + (maxWidth - block.width) / 2;
    const ty = cursorY;
    for (const item of block.nodes) nodes.push({ ...item, x: item.x + tx, y: item.y + ty });
    for (const edge of block.edges) edges.push({ ...edge, x1: edge.x1 + tx, x2: edge.x2 + tx, y1: edge.y1 + ty, y2: edge.y2 + ty });
    cursorY += block.height + gap;
  }
  return { nodes, edges, width: maxWidth + PADDING * 2, height: cursorY - gap + PADDING };
}
