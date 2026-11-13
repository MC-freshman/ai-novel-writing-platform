import {
  BarChart3,
  FileDown,
  FileText,
  ListTree,
  LayoutGrid,
  RefreshCcw,
  Search,
  ShieldCheck,
  Waves,
} from "lucide-react";
import type { AnalysisTab } from "../../types";

const ANALYSIS_TABS: { key: AnalysisTab; label: string; Icon: typeof LayoutGrid }[] =
  [
    { key: "progress", label: "规划与进度", Icon: LayoutGrid },
    { key: "search", label: "全局搜索", Icon: Search },
    { key: "timeline", label: "时间线", Icon: ListTree },
    { key: "consistency", label: "一致性", Icon: RefreshCcw },
    { key: "versions", label: "版本对比", Icon: FileText },
    { key: "export", label: "导出/提取", Icon: FileDown },
    { key: "writing", label: "写作统计", Icon: BarChart3 },
    { key: "sensitive", label: "敏感词自查", Icon: ShieldCheck },
    { key: "style", label: "文风自查", Icon: Waves },
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
