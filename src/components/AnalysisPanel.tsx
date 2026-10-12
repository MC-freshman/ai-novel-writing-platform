import {
  FileDown,
  FileText,
  ListTree,
  LayoutGrid,
  RefreshCcw,
  Search,
  UserRound,
} from "lucide-react";
import type { AnalysisPanelProps } from "./analysis/props";
import { useAnalysisBindings } from "./analysis/bindings";
import { useAnalysisNavigation } from "./analysis/navigation";
import { useAnalysisPersistence } from "./analysis/persistence";
import { useAnalysisSearch } from "./analysis/search";
import { useAnalysisTimeline } from "./analysis/timeline";
import { useAnalysisRelations } from "./analysis/relations";
import { useAnalysisConsistency } from "./analysis/consistency";
import { useAnalysisVersions } from "./analysis/versions";
import { useAnalysisExtraction } from "./analysis/extraction";
import { useAnalysisExperiments } from "./analysis/experiments";
import { useAnalysisGraph } from "./analysis/graph";
import { useAnalysisEffects } from "./analysis/effects";
import { ProgressPanel } from "./analysis/ProgressPanel";
import { SearchPanel } from "./analysis/SearchPanel";
import { TimelinePanel } from "./analysis/TimelinePanel";
import { RelationsPanel } from "./analysis/RelationsPanel";
import { ConsistencyPanel } from "./analysis/ConsistencyPanel";
import { VersionsPanel } from "./analysis/VersionsPanel";
import { ExportPanel } from "./analysis/ExportPanel";

export function AnalysisPanel(props: AnalysisPanelProps) {
  const bindings = useAnalysisBindings({ ...props });
  const navigation = useAnalysisNavigation({ ...props, ...bindings });
  const persistence = useAnalysisPersistence();
  const search = useAnalysisSearch({
    ...props,
    ...bindings,
    ...navigation,
    ...persistence,
  });
  const timeline = useAnalysisTimeline({
    ...props,
    ...bindings,
    ...navigation,
    ...persistence,
    ...search,
  });
  const relations = useAnalysisRelations({
    ...props,
    ...bindings,
    ...navigation,
    ...persistence,
    ...search,
    ...timeline,
  });
  const consistency = useAnalysisConsistency({
    ...props,
    ...bindings,
    ...navigation,
    ...persistence,
    ...search,
    ...timeline,
    ...relations,
  });
  const versions = useAnalysisVersions({
    ...props,
    ...bindings,
    ...navigation,
    ...persistence,
    ...search,
    ...timeline,
    ...relations,
    ...consistency,
  });
  const extraction = useAnalysisExtraction({
    ...props,
    ...bindings,
    ...navigation,
    ...persistence,
    ...search,
    ...timeline,
    ...relations,
    ...consistency,
    ...versions,
  });
  const experiments = useAnalysisExperiments({
    ...props,
    ...bindings,
    ...navigation,
    ...persistence,
    ...search,
    ...timeline,
    ...relations,
    ...consistency,
    ...versions,
    ...extraction,
  });
  const graph = useAnalysisGraph({
    ...props,
    ...bindings,
    ...navigation,
    ...persistence,
    ...search,
    ...timeline,
    ...relations,
    ...consistency,
    ...versions,
    ...extraction,
    ...experiments,
  });
  useAnalysisEffects({
    ...props,
    ...bindings,
    ...navigation,
    ...persistence,
    ...search,
    ...timeline,
    ...relations,
    ...consistency,
    ...versions,
    ...extraction,
    ...experiments,
    ...graph,
  });
  const context = {
    ...props,
    ...bindings,
    ...navigation,
    ...persistence,
    ...search,
    ...timeline,
    ...relations,
    ...consistency,
    ...versions,
    ...extraction,
    ...experiments,
    ...graph,
  };
  const { changeAnalysisTab, tab } = context;
  return (
    <section
      className={`analysis-panel ${tab === "progress" ? "progress-active" : ""}`}
    >
      <div className="analysis-tabs">
        <button
          className={tab === "progress" ? "active" : ""}
          onClick={() => void changeAnalysisTab("progress")}
        >
          <LayoutGrid size={16} />
          进度
        </button>
        <button
          className={tab === "search" ? "active" : ""}
          onClick={() => void changeAnalysisTab("search")}
        >
          <Search size={16} />
          全局搜索
        </button>
        <button
          className={tab === "timeline" ? "active" : ""}
          onClick={() => void changeAnalysisTab("timeline")}
        >
          <ListTree size={16} />
          时间线
        </button>
        <button
          className={tab === "relations" ? "active" : ""}
          onClick={() => void changeAnalysisTab("relations")}
        >
          <UserRound size={16} />
          关系网
        </button>
        <button
          className={tab === "consistency" ? "active" : ""}
          onClick={() => void changeAnalysisTab("consistency")}
        >
          <RefreshCcw size={16} />
          一致性
        </button>
        <button
          className={tab === "versions" ? "active" : ""}
          onClick={() => void changeAnalysisTab("versions")}
        >
          <FileText size={16} />
          版本对比
        </button>
        <button
          className={tab === "export" ? "active" : ""}
          onClick={() => void changeAnalysisTab("export")}
        >
          <FileDown size={16} />
          导出/提取
        </button>
      </div>

      {tab === "progress" && <ProgressPanel {...context} />}

      {tab === "search" && <SearchPanel {...context} />}

      {tab === "timeline" && <TimelinePanel {...context} />}

      {tab === "relations" && <RelationsPanel {...context} />}

      {tab === "consistency" && <ConsistencyPanel {...context} />}

      {tab === "versions" && <VersionsPanel {...context} />}

      {tab === "export" && <ExportPanel {...context} />}
    </section>
  );
}
