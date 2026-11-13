import type { AnalysisPanelProps } from "./props";
import { useAnalysisContext } from "./context";
import { AnalysisTabs } from "./AnalysisTabs";
import { ProgressPanel } from "./ProgressPanel";
import { SearchPanel } from "./SearchPanel";
import { TimelinePanel } from "./TimelinePanel";
import { ConsistencyPanel } from "./ConsistencyPanel";
import { VersionsPanel } from "./VersionsPanel";
import { ExportPanel } from "./ExportPanel";
import { WritingStatsPanel } from "./WritingStatsPanel";
import { SensitivePanel } from "./SensitivePanel";
import { StylePanel } from "./StylePanel";

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
      {tab === "consistency" && <ConsistencyPanel {...context} />}
      {tab === "versions" && <VersionsPanel {...context} />}
      {tab === "export" && <ExportPanel {...context} />}
      {tab === "writing" && <WritingStatsPanel {...context} />}
      {tab === "sensitive" && <SensitivePanel {...context} />}
      {tab === "style" && <StylePanel {...context} />}
    </section>
  );
}
