import type { MindMap, MindMapNode, MindMapRelation } from "../types";
import type { MindMapLayout } from "./mind-map";

/** 撤销/重做历史栈深度（用户锁定默认值）。 */
export const HISTORY_LIMIT = 50;

function relationsOf(map: MindMap): MindMapRelation[] {
  return Array.isArray(map.relations) ? map.relations : [];
}

function positionsOf(map: MindMap): Record<string, { dx: number; dy: number }> {
  return map.positions && typeof map.positions === "object" && !Array.isArray(map.positions) ? map.positions : {};
}

/** 深拷贝可编辑数据，避免历史栈与当前草稿共享引用。 */
export function snapshotMindMap(map: MindMap): MindMap {
  const positions: Record<string, { dx: number; dy: number }> = {};
  for (const [key, value] of Object.entries(positionsOf(map))) {
    positions[key] = {
      dx: Number.isFinite(value?.dx) ? value.dx : 0,
      dy: Number.isFinite(value?.dy) ? value.dy : 0,
    };
  }
  return {
    ...map,
    nodes: map.nodes.map((node) => ({ ...node })),
    relations: relationsOf(map).map((item) => ({
      ...item,
      controlPoints: Array.isArray(item.controlPoints)
        ? item.controlPoints.map((point) => ({ ...point }))
        : [],
    })),
    positions,
  };
}

/** 收集某节点及其全部子树 id（按 parentId 树，带环保护）。 */
export function subtreeIds(map: MindMap, rootId: string): string[] {
  const byParent = new Map<string, string[]>();
  for (const node of map.nodes) {
    const list = byParent.get(node.parentId) || [];
    list.push(node.id);
    byParent.set(node.parentId, list);
  }
  const result: string[] = [];
  const seen = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    result.push(id);
    for (const child of byParent.get(id) || []) {
      if (seen.has(child)) continue;
      seen.add(child);
      stack.push(child);
    }
  }
  return result;
}

export interface MindMapClipboard {
  nodes: MindMapNode[];
  relations: MindMapRelation[];
}

/** 复制选中节点及其子树：生成新 id、重映射 parentId，仅保留两端都在复制集合内的关系线。 */
export function cloneMindMapSubtree(
  map: MindMap,
  rootIds: string[],
  makeId: () => string,
): MindMapClipboard {
  const existing = new Set(map.nodes.map((node) => node.id));
  const picked = new Set<string>();
  for (const rootId of rootIds) {
    for (const id of subtreeIds(map, rootId)) {
      if (existing.has(id)) picked.add(id);
    }
  }
  const idMap = new Map<string, string>();
  for (const id of picked) idMap.set(id, makeId());
  const nodes = map.nodes.filter((node) => picked.has(node.id)).map((node) => ({
    ...node,
    id: idMap.get(node.id) as string,
    parentId: picked.has(node.parentId) ? (idMap.get(node.parentId) as string) : "",
  }));
  const relations = relationsOf(map)
    .filter((item) => picked.has(item.sourceId) && picked.has(item.targetId))
    .map((item) => ({
      ...item,
      id: makeId(),
      sourceId: idMap.get(item.sourceId) as string,
      targetId: idMap.get(item.targetId) as string,
      controlPoints: Array.isArray(item.controlPoints)
        ? item.controlPoints.map((point) => ({ ...point }))
        : [],
    }));
  return { nodes, relations };
}

/** 把剪贴板内容挂到 parentId 下，全部生成新 id 避免与现有节点冲突。 */
export function pasteMindMapClipboard(
  map: MindMap,
  clipboard: MindMapClipboard,
  parentId: string,
  makeId: () => string,
): MindMap {
  const parent = map.nodes.find((node) => node.id === parentId)
    || map.nodes.find((node) => node.id === map.rootId);
  if (!parent || !clipboard.nodes.length) return map;
  const idMap = new Map<string, string>();
  for (const node of clipboard.nodes) idMap.set(node.id, makeId());
  const innerParents = new Set(clipboard.nodes.map((node) => node.parentId));
  const nodes = clipboard.nodes.map((node) => ({
    ...node,
    id: idMap.get(node.id) as string,
    parentId: idMap.has(node.parentId) ? (idMap.get(node.parentId) as string) : parent.id,
    side: innerParents.has(node.id) ? node.side : parent.side,
  }));
  const relations = clipboard.relations.map((item) => ({
    ...item,
    id: makeId(),
    sourceId: idMap.get(item.sourceId) || item.sourceId,
    targetId: idMap.get(item.targetId) || item.targetId,
    controlPoints: Array.isArray(item.controlPoints)
      ? item.controlPoints.map((point) => ({ ...point }))
      : [],
  }));
  return {
    ...map,
    nodes: [...map.nodes, ...nodes],
    relations: [...relationsOf(map), ...relations],
  };
}

/** 批量删除节点（含子树）并级联删除关联关系线；根节点不可删除。 */
export function removeMindMapNodes(map: MindMap, ids: string[]): MindMap {
  const removed = new Set<string>();
  for (const id of ids) {
    // 根节点不可删除，也不能作为「展开子树」的起点（全选删除不应清空整棵树）。
    if (id === map.rootId) continue;
    for (const child of subtreeIds(map, id)) {
      if (child !== map.rootId) removed.add(child);
    }
  }
  if (!removed.size) return map;
  return {
    ...map,
    nodes: map.nodes.filter((node) => !removed.has(node.id)),
    relations: relationsOf(map).filter((item) => !removed.has(item.sourceId) && !removed.has(item.targetId)),
  };
}

/** 框选：返回与矩形相交的可见节点 id（世界坐标）。 */
export function nodesInRect(
  layout: MindMapLayout,
  rect: { x1: number; y1: number; x2: number; y2: number },
  halfWidth: number,
  halfHeight: number,
): string[] {
  const left = Math.min(rect.x1, rect.x2);
  const right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2);
  const bottom = Math.max(rect.y1, rect.y2);
  return layout.nodes
    .filter((item) => item.x + halfWidth >= left && item.x - halfWidth <= right
      && item.y + halfHeight >= top && item.y - halfHeight <= bottom)
    .map((item) => item.id);
}

/** 合并已落盘位置与拖拽中的临时偏移，供 applyPositions 使用。 */
export function mergePositions(
  stored: Record<string, { dx: number; dy: number }> | undefined,
  dragging: Record<string, { dx: number; dy: number }> | null,
): Record<string, { dx: number; dy: number }> {
  const base = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  return dragging ? { ...base, ...dragging } : { ...base };
}
