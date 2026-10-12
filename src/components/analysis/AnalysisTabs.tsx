import {
  FileDown,
  FileText,
  ListTree,
  LayoutGrid,
  RefreshCcw,
  Search,
  UserRound,
} from "lucide-react";
import type { AnalysisTab } from "../../types";

const ANALYSIS_TABS: { key: AnalysisTab; label: string; Icon: typeof LayoutGrid }[] =
  [
    { key: "progress", label: "进度", Icon: LayoutGrid },
    { key: "search", label: "全局搜索", Icon: Search },
    { key: "timeline", label: "时间线", Icon: ListTree },
    { key: "relations", label: "关系网", Icon: UserRound },
    { key: "consistency", label: "一致性", Icon: RefreshCcw },
    { key: "versions", label: "版本对比", Icon: FileText },
    { key: "export", label: "导出/提取", Icon: FileDown },
  ];

export function AnalysisTabs({
  tab,
  onChange,
}: {
  tab: AnalysisTab;
  onChange: (next: AnalysisTab) => Promise<void>;
}) {
  return (
    <div className="analysis-tabs">
      {ANALYSIS_TABS.map(({ key, label, Icon }) => (
        <button
          key={key}
          className={tab === key ? "active" : ""}
          onClick={() => void onChange(key)}
        >
          <Icon size={16} />
          {label}
        </button>
      ))}
    </div>
  );
}
