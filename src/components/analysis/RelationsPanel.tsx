import { RefreshCcw, X } from "lucide-react";
import type { CharacterCard, RelationshipEdge } from "../../types";
import type { CategoryGroup } from "../../lib/categories";
import type { AnalysisContext } from "./context";

export function RelationsPanel(
  context: Pick<
    AnalysisContext,
    | "addRelationType"
    | "autoLayoutGraph"
    | "busy"
    | "editingRelationEdgeId"
    | "graph"
    | "graphDragStart"
    | "graphNodeDrag"
    | "graphOffset"
    | "graphScale"
    | "graphSelection"
    | "graphShellRef"
    | "loadRelationships"
    | "moveGraphPan"
    | "newRelationType"
    | "relationCategories"
    | "relationCategoryFilter"
    | "relationGroupedCards"
    | "relationSearch"
    | "relationTypes"
    | "relationshipEdges"
    | "relationshipNodes"
    | "resetGraphView"
    | "saveRelationshipEdge"
    | "selectVisibleRelationCards"
    | "selectedGraphNodeIds"
    | "selectedRelationNames"
    | "setEditingRelationEdgeId"
    | "setNewRelationType"
    | "setRelationCategoryFilter"
    | "setRelationSearch"
    | "setRelationTypes"
    | "setRelationshipEdges"
    | "setSelectedRelationNames"
    | "startGraphNodeDrag"
    | "startGraphPan"
    | "stopGraphPan"
    | "toggleRelationName"
    | "zoomGraph"
  >,
) {
  const {
    addRelationType,
    autoLayoutGraph,
    busy,
    editingRelationEdgeId,
    graph,
    graphDragStart,
    graphNodeDrag,
    graphOffset,
    graphScale,
    graphSelection,
    graphShellRef,
    loadRelationships,
    moveGraphPan,
    newRelationType,
    relationCategories,
    relationCategoryFilter,
    relationGroupedCards,
    relationSearch,
    relationTypes,
    relationshipEdges,
    relationshipNodes,
    resetGraphView,
    saveRelationshipEdge,
    selectVisibleRelationCards,
    selectedGraphNodeIds,
    selectedRelationNames,
    setEditingRelationEdgeId,
    setNewRelationType,
    setRelationCategoryFilter,
    setRelationSearch,
    setRelationTypes,
    setRelationshipEdges,
    setSelectedRelationNames,
    startGraphNodeDrag,
    startGraphPan,
    stopGraphPan,
    toggleRelationName,
    zoomGraph,
  } = context;
  function renderRelationGroup(group: CategoryGroup<CharacterCard>, depth = 0) {
    return (
      <div className="relation-category-group" key={group.key}>
        <div
          className="relation-category-title"
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <span>{group.category}</span>
          <small>{group.count}</small>
        </div>
        {group.children.map((child) => renderRelationGroup(child, depth + 1))}
        {group.items.map((card) => (
          <label key={card.id} style={{ paddingLeft: 24 + depth * 14 }}>
            <input
              type="checkbox"
              checked={selectedRelationNames.includes(card.name)}
              onChange={() => toggleRelationName(card.name)}
            />
            <span>{card.name}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <div className="analysis-section">
      <div className="relation-controls">
        <details>
          <summary>选择角色卡</summary>
          <div className="relation-filter-row">
            <input
              value={relationSearch}
              onChange={(event) => setRelationSearch(event.target.value)}
              placeholder="搜索角色、分类或关系"
            />
            <select
              value={relationCategoryFilter}
              onChange={(event) =>
                setRelationCategoryFilter(event.target.value)
              }
            >
              <option value="">全部分类</option>
              {relationCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
          <div className="relation-tree-select">
            {relationGroupedCards.map((group) => renderRelationGroup(group))}
            {!relationGroupedCards.length && <p>没有匹配的角色卡。</p>}
          </div>
          <div className="relation-filter-actions">
            <button onClick={selectVisibleRelationCards}>勾选当前筛选</button>
            <button onClick={() => setSelectedRelationNames([])}>
              显示全部角色
            </button>
          </div>
        </details>
        <details>
          <summary>关系类型</summary>
          <div className="chip-list">
            {relationTypes.map((type) => (
              <button
                key={type}
                onClick={() =>
                  setRelationTypes((items) =>
                    items.filter((item) => item !== type),
                  )
                }
                title="点击移除"
              >
                {type}
              </button>
            ))}
          </div>
          <div className="inline-form">
            <input
              value={newRelationType}
              onChange={(event) => setNewRelationType(event.target.value)}
              placeholder="新增关系类型"
            />
            <button onClick={addRelationType}>添加</button>
          </div>
        </details>
      </div>
      <div className="analysis-actions">
        <button
          onClick={() => void loadRelationships()}
          disabled={busy === "relations"}
        >
          <RefreshCcw size={16} />
          刷新关系网
        </button>
      </div>
      {relationshipNodes.length ? (
        <>
          <div
            ref={graphShellRef}
            className={`relationship-graph-shell ${graphDragStart || graphNodeDrag ? "dragging" : ""}`}
            onWheel={zoomGraph}
            onMouseDown={startGraphPan}
            onMouseMove={moveGraphPan}
            onMouseUp={stopGraphPan}
            onMouseLeave={stopGraphPan}
          >
            <div className="relationship-graph-tools">
              <span>{Math.round(graphScale * 100)}%</span>
              <button
                onMouseDown={(event) => event.stopPropagation()}
                onClick={resetGraphView}
              >
                重置视图
              </button>
              <button
                onMouseDown={(event) => event.stopPropagation()}
                onClick={autoLayoutGraph}
              >
                自动布局
              </button>
            </div>
            <svg
              className="relationship-graph"
              viewBox={`0 0 ${graph.width} ${graph.height}`}
              role="img"
            >
              <defs>
                <marker
                  id="relationship-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
              <g
                transform={`translate(${graphOffset.x} ${graphOffset.y}) scale(${graphScale})`}
              >
                {relationshipEdges.map((edge) => {
                  const source = graph.positions.get(edge.source);
                  const target = graph.positions.get(edge.target);
                  if (!source || !target) return null;
                  const sourceAnchorX =
                    source.x +
                    (target.x >= source.x
                      ? source.width / 2
                      : -source.width / 2);
                  const targetAnchorX =
                    target.x +
                    (target.x >= source.x
                      ? -target.width / 2
                      : target.width / 2);
                  const curve = Math.max(
                    80,
                    Math.abs(targetAnchorX - sourceAnchorX) * 0.42,
                  );
                  const labelX = edge.labelX ?? (source.x + target.x) / 2;
                  const labelY = edge.labelY ?? (source.y + target.y) / 2;
                  return (
                    <g key={edge.id}>
                      <path
                        className="relationship-branch"
                        d={`M ${sourceAnchorX} ${source.y} C ${sourceAnchorX + (target.x >= source.x ? curve : -curve)} ${source.y}, ${targetAnchorX + (target.x >= source.x ? -curve : curve)} ${target.y}, ${targetAnchorX} ${target.y}`}
                        strokeWidth={Math.max(1.6, edge.weight / 2)}
                        stroke={edge.color || undefined}
                        markerEnd={
                          ["forward", "both"].includes(edge.direction || "none")
                            ? "url(#relationship-arrow)"
                            : undefined
                        }
                        markerStart={
                          ["backward", "both"].includes(
                            edge.direction || "none",
                          )
                            ? "url(#relationship-arrow)"
                            : undefined
                        }
                      />
                      <text
                        className="relationship-edge-label"
                        x={labelX}
                        y={labelY - 6}
                        textAnchor="middle"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={() => setEditingRelationEdgeId(edge.id)}
                      >
                        {edge.label || "关系"}
                      </text>
                      <title>
                        {edge.evidence[0] || "来自角色关系或正文同场统计"}
                      </title>
                    </g>
                  );
                })}
                {relationshipNodes.map((node) => {
                  const position = graph.positions.get(node.id);
                  if (!position) return null;
                  return (
                    <g
                      key={node.id}
                      className={`relationship-node ${position.side} ${selectedGraphNodeIds.includes(node.id) ? "selected" : ""}`}
                      onMouseDown={(event) =>
                        startGraphNodeDrag(event, node.id)
                      }
                    >
                      <rect
                        x={position.x - position.width / 2}
                        y={position.y - position.height / 2}
                        width={position.width}
                        height={position.height}
                        rx={8}
                        style={node.color ? { fill: node.color } : undefined}
                      />
                      <text
                        x={position.x}
                        y={position.y + 5}
                        textAnchor="middle"
                      >
                        {node.name}
                      </text>
                      <title>{node.category}</title>
                    </g>
                  );
                })}
              </g>
            </svg>
            {graphSelection && (
              <div
                className="graph-selection-box"
                style={{
                  left: Math.min(
                    graphSelection.startX,
                    graphSelection.currentX,
                  ),
                  top: Math.min(graphSelection.startY, graphSelection.currentY),
                  width: Math.abs(
                    graphSelection.currentX - graphSelection.startX,
                  ),
                  height: Math.abs(
                    graphSelection.currentY - graphSelection.startY,
                  ),
                }}
              />
            )}
            {editingRelationEdgeId &&
              (() => {
                const edge = relationshipEdges.find(
                  (item) => item.id === editingRelationEdgeId,
                );
                if (!edge) return null;
                return (
                  <div
                    className="graph-edge-editor"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <strong>
                      {edge.source} / {edge.target}
                    </strong>
                    <input
                      value={edge.label}
                      onChange={(event) =>
                        setRelationshipEdges((items) =>
                          items.map((item) =>
                            item.id === edge.id
                              ? { ...item, label: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="关系类型"
                    />
                    <input
                      type="color"
                      title="连线颜色"
                      value={edge.color || "#64748b"}
                      onChange={(event) =>
                        setRelationshipEdges((items) =>
                          items.map((item) =>
                            item.id === edge.id
                              ? { ...item, color: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <select
                      value={edge.direction || "none"}
                      onChange={(event) =>
                        setRelationshipEdges((items) =>
                          items.map((item) =>
                            item.id === edge.id
                              ? {
                                  ...item,
                                  direction: event.target
                                    .value as RelationshipEdge["direction"],
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="none">无方向</option>
                      <option value="forward">正向</option>
                      <option value="backward">反向</option>
                      <option value="both">双向</option>
                    </select>
                    <button
                      onClick={() =>
                        void saveRelationshipEdge(
                          relationshipEdges.find(
                            (item) => item.id === edge.id,
                          ) || edge,
                        )
                      }
                    >
                      保存并同步
                    </button>
                    <button
                      title="关闭"
                      onClick={() => setEditingRelationEdgeId("")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })()}
          </div>
          <div className="relationship-edges">
            {relationshipEdges.slice(0, 24).map((edge) => (
              <div key={edge.id}>
                <strong>
                  {edge.source} - {edge.target}
                </strong>
                <span>
                  {edge.label} / 强度 {edge.weight}
                </span>
                <p>{edge.evidence[0] || "来自角色关系或正文同场统计"}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="analysis-empty">
          角色卡片越完整，关系网越清晰。正文中同场出现也会形成关系线。
        </div>
      )}
    </div>
  );
}
