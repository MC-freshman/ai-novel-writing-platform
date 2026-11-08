import type { MindMap, MindMapNode, MindMapSide } from "../types";

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

/** 计算 XMind 风格的左右双向树布局；只保留从根可达的节点，避免脏数据成环。 */
export function layoutMindMap(map: MindMap): MindMapLayout {
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const byParent = new Map<string, MindMapNode[]>();
  for (const node of map.nodes) {
    byParent.set(node.parentId, [...(byParent.get(node.parentId) || []), node]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const root = byId.get(map.rootId) || map.nodes[0];
  if (!root) return { nodes: [], edges: [], width: 900, height: 520 };

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
