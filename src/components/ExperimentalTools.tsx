// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import type { AppearanceStat, MaterialItem, WorldMapEdge, WorldMapNode } from "../types";

export function ExperimentalTools({
  appearanceStats,
  worldMapNodes,
  worldMapEdges,
  materials,
  materialDraft,
  onLoadAppearance,
  onLoadWorldMap,
  onLoadMaterials,
  onMaterialDraft,
  onSaveMaterial,
  onDeleteMaterial,
}: {
  appearanceStats: AppearanceStat[];
  worldMapNodes: WorldMapNode[];
  worldMapEdges: WorldMapEdge[];
  materials: MaterialItem[];
  materialDraft: Partial<MaterialItem>;
  onLoadAppearance: () => void;
  onLoadWorldMap: () => void;
  onLoadMaterials: () => void;
  onMaterialDraft: (draft: Partial<MaterialItem>) => void;
  onSaveMaterial: () => void;
  onDeleteMaterial: (id: string) => void;
}) {
  return (
    <div className="experimental-grid">
      <section>
        <header>
          <strong>人物出场统计</strong>
          <button onClick={onLoadAppearance}>统计</button>
        </header>
        <div className="compact-list">
          {appearanceStats.slice(0, 12).map((item) => (
            <div key={item.id}>
              <span>{item.name}</span>
              <small>{item.total} 次 / {item.chapters.length} 章</small>
            </div>
          ))}
          {!appearanceStats.length && <p>统计角色在各章节出现次数。</p>}
        </div>
      </section>
      <section>
        <header>
          <strong>地点/势力版图</strong>
          <button onClick={onLoadWorldMap}>整理</button>
        </header>
        <div className="compact-list">
          {worldMapNodes.slice(0, 16).map((node) => (
            <div key={node.id}>
              <span>{node.title}</span>
              <small>{node.type} / {node.category}</small>
            </div>
          ))}
          {!worldMapNodes.length && <p>从世界观条目整理地点、势力、物品节点。</p>}
          {!!worldMapEdges.length && <p>{worldMapEdges.length} 条文本关联。</p>}
        </div>
      </section>
      <section>
        <header>
          <strong>素材库</strong>
          <button onClick={onLoadMaterials}>刷新</button>
        </header>
        <div className="material-form">
          <input value={materialDraft.title || ""} onChange={(event) => onMaterialDraft({ ...materialDraft, title: event.target.value })} placeholder="素材标题" />
          <input value={materialDraft.category || ""} onChange={(event) => onMaterialDraft({ ...materialDraft, category: event.target.value })} placeholder="分类" />
          <textarea value={materialDraft.content || ""} onChange={(event) => onMaterialDraft({ ...materialDraft, content: event.target.value })} placeholder="灵感、桥段、句子或设定碎片" />
          <button onClick={onSaveMaterial}>保存素材</button>
        </div>
        <div className="compact-list">
          {materials.slice(0, 8).map((item) => (
            <div key={item.id}>
              <span>{item.title}</span>
              <small>{item.category}</small>
              <button onClick={() => onDeleteMaterial(item.id)}>删除</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
