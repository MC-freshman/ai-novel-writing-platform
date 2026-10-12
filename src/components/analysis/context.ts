import type * as React from "react";
import type {
  RelationshipEdge,
  AnalysisSnapshot,
  AnalysisTab,
} from "../../types";
import type { AnalysisBindings } from "./bindings";
import type { AnalysisPanelProps } from "./props";

export type AnalysisContext = AnalysisBindings &
  AnalysisPanelProps & {
    changeAnalysisTab: (next: AnalysisTab) => Promise<void>;
    saveAnalysisDraft: (patch: Partial<AnalysisSnapshot>) => void;
    runSearch: () => Promise<void>;
    loadTimeline: () => Promise<void>;
    moveTimelineEvent: (targetId: string) => void;
    loadRelationships: () => Promise<void>;
    toggleRelationName: (name: string) => void;
    addRelationType: () => void;
    saveRelationshipEdge: (edge: RelationshipEdge) => Promise<void>;
    selectVisibleRelationCards: () => void;
    runConsistencyCheck: () => Promise<void>;
    updateIssueStatus: (
      issueId: string,
      status: "待处理" | "已确认" | "已忽略" | "已修复" | undefined,
    ) => Promise<void>;
    toggleConsistencyChapter: (chapterId: string) => void;
    toggleConsistencySource: (sourceId: string) => void;
    loadVersions: () => Promise<void>;
    compareVersion: () => Promise<void>;
    restoreVersion: () => Promise<void>;
    prepareWorldCandidates: () => Promise<void>;
    saveSelectedCandidates: () => Promise<void>;
    loadAppearanceStats: () => Promise<void>;
    loadWorldMap: () => Promise<void>;
    loadMaterials: () => Promise<void>;
    saveMaterialDraft: () => Promise<void>;
    deleteMaterialItem: (materialId: string) => Promise<void>;
    graph: {
      width: number;
      height: number;
      positions: Map<
        string,
        {
          x: number;
          y: number;
          width: number;
          height: number;
          side: "center" | "left" | "right";
        }
      >;
    };
    resetGraphView: () => void;
    autoLayoutGraph: () => void;
    zoomGraphByWheel: (deltaY: number) => void;
    zoomGraph: (event: React.WheelEvent<HTMLDivElement>) => void;
    startGraphPan: (
      event: React.MouseEvent<HTMLDivElement>,
    ) => void;
    moveGraphPan: (event: React.MouseEvent<HTMLDivElement>) => void;
    stopGraphPan: () => void;
    startGraphNodeDrag: (
      event: React.MouseEvent<SVGGElement>,
      nodeId: string,
    ) => void;
  };
