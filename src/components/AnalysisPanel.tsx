import type { AnalysisPanelProps } from "./analysis/props";
import { useAnalysisContext } from "./analysis/context";
import { AnalysisTabs } from "./analysis/AnalysisTabs";
import { ProgressPanel } from "./analysis/ProgressPanel";
import { SearchPanel } from "./analysis/SearchPanel";
import { TimelinePanel } from "./analysis/TimelinePanel";
import { RelationsPanel } from "./analysis/RelationsPanel";
import { ConsistencyPanel } from "./analysis/ConsistencyPanel";
import { VersionsPanel } from "./analysis/VersionsPanel";
import { ExportPanel } from "./analysis/ExportPanel";

export function AnalysisPanel(props: AnalysisPanelProps) {
  const context = useAnalysisContext(props);
  const { changeAnalysisTab, tab } = context;
  return (
    <section
      className={`analysis-panel ${tab === "progress" ? "progress-active" : ""}`}
    >
      <AnalysisTabs tab={tab} onChange={changeAnalysisTab} />
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
