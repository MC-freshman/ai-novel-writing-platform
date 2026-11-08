export type MindMapSide = "left" | "right";

export interface MindMapNode {
  id: string;
  parentId: string;
  text: string;
  note: string;
  color: string;
  collapsed: boolean;
  order: number;
  side: MindMapSide;
}

export interface MindMap {
  id: string;
  title: string;
  rootId: string;
  nodes: MindMapNode[];
  createdAt: string;
  updatedAt: string;
}

export interface XMindImportSheet {
  title: string;
  rootText: string;
  nodeCount: number;
  truncated: boolean;
  map: MindMap;
}

export interface XMindImportResult {
  canceled: boolean;
  error?: string;
  fileName?: string;
  sheets?: XMindImportSheet[];
}
