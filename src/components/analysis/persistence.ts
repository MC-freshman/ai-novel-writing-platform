import type { AnalysisSnapshot } from "../../types";
import { useCallback } from "react";

export function useAnalysisPersistence() {
  const saveAnalysisDraft = useCallback((patch: Partial<AnalysisSnapshot>) => {
    void window.novelAPI.saveAnalysisState(patch).catch(() => null);
  }, []);
  return { saveAnalysisDraft };
}
