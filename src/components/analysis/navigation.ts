import type { AnalysisTab } from "../../types";
import type { AnalysisContext } from "./context";

export function useAnalysisNavigation(
  context: Pick<
    AnalysisContext,
    "networkSaver" | "onStatus" | "setTab" | "tab" | "userSelectedTab"
  >,
) {
  const { networkSaver, onStatus, setTab, tab, userSelectedTab } = context;
  async function changeAnalysisTab(next: AnalysisTab) {
    if (next === tab) return;
    if (networkSaver.current && !(await networkSaver.current.protect())) {
      onStatus("小说网草稿保护失败，请先保存后再切换。");
      return;
    }
    userSelectedTab.current = true;
    setTab(next);
  }
  return { changeAnalysisTab };
}
