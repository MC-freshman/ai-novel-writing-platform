export type MindMapSide = "left" | "right";

/** 关系线的路径形状：曲线 / 直线 / 折线。 */
export type MindMapRelationShape = "curved" | "straight" | "elbow";
/** 关系线的线型：实线 / 虚线 / 点线。 */
export type MindMapRelationLinePattern = "solid" | "dash" | "dot";
/** 关系线两端的三角箭头配置。 */
export type MindMapRelationArrow = "none" | "triangle";
/** 关系线标签的字形。 */
export type MindMapRelationFontStyle = "normal" | "italic";

/**
 * 自定义弯曲控制点。四个值都是相对量：渲染时统一按「两端点连线长度」缩放
 * （见 layoutRelations 的 resolveControlPoints），布局变化后曲线形状保持一致。
 */
export interface MindMapRelationControlPoint {
  amount: number;
  angle: number;
  x: number;
  y: number;
}

/**
 * 独立于 parentId 树的任意两节点关系线（箭头联系）。
 * 五个核心字段必填，视觉样式字段全部可选，读取时用 ?? 兜底默认值。
 */
export interface MindMapRelation {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  note: string;
  shape?: MindMapRelationShape;
  linePattern?: MindMapRelationLinePattern;
  lineColor?: string;
  lineWidth?: number;
  arrowBegin?: MindMapRelationArrow;
  arrowEnd?: MindMapRelationArrow;
  labelFontStyle?: MindMapRelationFontStyle;
  labelColor?: string;
  controlPoints?: MindMapRelationControlPoint[];
}

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
  /** 任意两节点关系线集合；旧数据缺失时按 [] 处理。 */
  relations?: MindMapRelation[];
  /** 节点自由摆放偏移；key 必须是现存节点 id，值为相对自动布局的偏移量。 */
  positions?: Record<string, { dx: number; dy: number }>;
}

export interface XMindImportSheet {
  title: string;
  rootText: string;
  nodeCount: number;
  truncated: boolean;
  map: MindMap;
  /** 本画布导入的关系线数量（可选，旧调用方不受影响）。 */
  relationCount?: number;
  /** 关系线导入口径说明（K4：绝对像素不导入；新版格式暂不导入）。 */
  relationNote?: string;
}

export interface XMindImportResult {
  canceled: boolean;
  error?: string;
  fileName?: string;
  sheets?: XMindImportSheet[];
}
