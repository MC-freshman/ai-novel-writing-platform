import { useCallback, useEffect, useMemo } from "react";
import type { RelationshipNode } from "../../types";
import type { AnalysisContext } from "./context";

export function useAnalysisGraph(
  context: Pick<
    AnalysisContext,
    | "graphDragStart"
    | "graphNodeDrag"
    | "graphOffset"
    | "graphScale"
    | "graphSelection"
    | "graphShellRef"
    | "onStatus"
    | "relationshipEdges"
    | "relationshipNodes"
    | "selectedGraphNodeIds"
    | "setGraphDragStart"
    | "setGraphNodeDrag"
    | "setGraphOffset"
    | "setGraphScale"
    | "setGraphSelection"
    | "setRelationshipNodes"
    | "setSelectedGraphNodeIds"
    | "tab"
  >,
) {
  const {
    graphDragStart,
    graphNodeDrag,
    graphOffset,
    graphScale,
    graphSelection,
    graphShellRef,
    onStatus,
    relationshipEdges,
    relationshipNodes,
    selectedGraphNodeIds,
    setGraphDragStart,
    setGraphNodeDrag,
    setGraphOffset,
    setGraphScale,
    setGraphSelection,
    setRelationshipNodes,
    setSelectedGraphNodeIds,
    tab,
  } = context;
  const graph = useMemo(() => {
    const width = 1240;
    const degree = new Map<string, number>();
    relationshipEdges.forEach((edge) => {
      degree.set(edge.source, (degree.get(edge.source) || 0) + edge.weight);
      degree.set(edge.target, (degree.get(edge.target) || 0) + edge.weight);
    });
    const nodes = relationshipNodes
      .slice()
      .sort(
        (a, b) =>
          (degree.get(b.id) || 0) + b.size - ((degree.get(a.id) || 0) + a.size),
      );
    const center = nodes[0];
    const others = nodes.slice(1);
    const left: RelationshipNode[] = [];
    const right: RelationshipNode[] = [];
    others.forEach((node, index) => {
      const target = index % 2 === 0 ? right : left;
      target.push(node);
    });
    const rowGap = 82;
    const height = Math.max(
      520,
      (Math.max(left.length, right.length, 1) - 1) * rowGap + 220,
    );
    const centerX = width / 2;
    const centerY = height / 2;
    const positions = new Map<
      string,
      {
        x: number;
        y: number;
        width: number;
        height: number;
        side: "center" | "left" | "right";
      }
    >();
    const measure = (name: string) =>
      Math.max(108, Math.min(190, name.length * 15 + 46));
    if (center) {
      positions.set(center.id, {
        x: centerX,
        y: centerY,
        width: measure(center.name) + 24,
        height: 48,
        side: "center",
      });
    }
    const placeSide = (items: RelationshipNode[], side: "left" | "right") => {
      const x = centerX + (side === "right" ? 330 : -330);
      const startY = centerY - ((items.length - 1) * rowGap) / 2;
      items.forEach((node, index) => {
        positions.set(node.id, {
          x,
          y: startY + index * rowGap,
          width: measure(node.name),
          height: 42,
          side,
        });
      });
    };
    placeSide(left, "left");
    placeSide(right, "right");
    nodes.forEach((node) => {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
      const current = positions.get(node.id);
      if (current)
        positions.set(node.id, {
          ...current,
          x: Number(node.x),
          y: Number(node.y),
        });
    });
    return { width, height, positions };
  }, [relationshipNodes, relationshipEdges]);

  function resetGraphView() {
    setGraphScale(1);
    setGraphOffset({ x: 0, y: 0 });
  }

  function autoLayoutGraph() {
    setRelationshipNodes((items) =>
      items.map(({ x: _x, y: _y, ...item }) => item),
    );
    setSelectedGraphNodeIds([]);
    resetGraphView();
    onStatus("关系图已重新自动布局");
  }

  const zoomGraphByWheel = useCallback(
    (deltaY: number) => {
      const factor = deltaY < 0 ? 1.12 : 0.88;
      setGraphScale((value) =>
        Math.min(3.2, Math.max(0.35, Number((value * factor).toFixed(3)))),
      );
    },
    [setGraphScale],
  );

  function zoomGraph(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    zoomGraphByWheel(event.deltaY);
  }

  function startGraphPan(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.shiftKey) {
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setGraphSelection({ startX: x, startY: y, currentX: x, currentY: y });
      return;
    }
    setGraphDragStart({
      x: event.clientX,
      y: event.clientY,
      offsetX: graphOffset.x,
      offsetY: graphOffset.y,
    });
  }

  function moveGraphPan(event: React.MouseEvent<HTMLDivElement>) {
    if (graphNodeDrag) {
      event.preventDefault();
      event.stopPropagation();
      const svg = graphShellRef.current?.querySelector("svg");
      const ratio = svg
        ? graph.width / Math.max(1, svg.getBoundingClientRect().width)
        : 1;
      const dx = ((event.clientX - graphNodeDrag.startX) * ratio) / graphScale;
      const dy = ((event.clientY - graphNodeDrag.startY) * ratio) / graphScale;
      setRelationshipNodes((items) =>
        items.map((item) => {
          const start = graphNodeDrag.positions[item.id];
          return start ? { ...item, x: start.x + dx, y: start.y + dy } : item;
        }),
      );
      return;
    }
    if (graphSelection) {
      const rect = event.currentTarget.getBoundingClientRect();
      setGraphSelection({
        ...graphSelection,
        currentX: event.clientX - rect.left,
        currentY: event.clientY - rect.top,
      });
      return;
    }
    if (!graphDragStart) return;
    event.preventDefault();
    event.stopPropagation();
    setGraphOffset({
      x: graphDragStart.offsetX + event.clientX - graphDragStart.x,
      y: graphDragStart.offsetY + event.clientY - graphDragStart.y,
    });
  }

  function stopGraphPan() {
    if (graphSelection) {
      const svg = graphShellRef.current?.querySelector("svg");
      if (svg) {
        const rect = svg.getBoundingClientRect();
        const ratioX = graph.width / Math.max(1, rect.width);
        const ratioY = graph.height / Math.max(1, rect.height);
        const left =
          (Math.min(graphSelection.startX, graphSelection.currentX) * ratioX -
            graphOffset.x) /
          graphScale;
        const right =
          (Math.max(graphSelection.startX, graphSelection.currentX) * ratioX -
            graphOffset.x) /
          graphScale;
        const top =
          (Math.min(graphSelection.startY, graphSelection.currentY) * ratioY -
            graphOffset.y) /
          graphScale;
        const bottom =
          (Math.max(graphSelection.startY, graphSelection.currentY) * ratioY -
            graphOffset.y) /
          graphScale;
        setSelectedGraphNodeIds(
          relationshipNodes
            .filter((node) => {
              const position = graph.positions.get(node.id);
              return (
                position &&
                position.x >= left &&
                position.x <= right &&
                position.y >= top &&
                position.y <= bottom
              );
            })
            .map((node) => node.id),
        );
      }
    }
    setGraphDragStart(null);
    setGraphNodeDrag(null);
    setGraphSelection(null);
  }

  function startGraphNodeDrag(
    event: React.MouseEvent<SVGGElement>,
    nodeId: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const nextSelected = selectedGraphNodeIds.includes(nodeId)
      ? selectedGraphNodeIds
      : event.ctrlKey
        ? [...selectedGraphNodeIds, nodeId]
        : [nodeId];
    setSelectedGraphNodeIds(nextSelected);
    const positions = Object.fromEntries(
      nextSelected.map((id) => {
        const position = graph.positions.get(id);
        return [id, { x: position?.x || 0, y: position?.y || 0 }];
      }),
    );
    setGraphNodeDrag({
      startX: event.clientX,
      startY: event.clientY,
      positions,
    });
  }

  useEffect(() => {
    const shell = graphShellRef.current;
    if (!shell) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zoomGraphByWheel(event.deltaY);
    };
    shell.addEventListener("wheel", handleWheel, { passive: false });
    return () => shell.removeEventListener("wheel", handleWheel);
  }, [graphShellRef, relationshipNodes.length, tab, zoomGraphByWheel]);
  return {
    graph,
    resetGraphView,
    autoLayoutGraph,
    zoomGraphByWheel,
    zoomGraph,
    startGraphPan,
    moveGraphPan,
    stopGraphPan,
    startGraphNodeDrag,
  };
}
