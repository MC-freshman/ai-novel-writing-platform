import type { AppState, GlobalSearchResult } from "../../types";
import type { PageSaveHandle, PageSaveKind } from "../../hooks/useEntityDraft";

export type AnalysisPanelProps = {
  state: AppState;
  onRegisterSave: (kind: PageSaveKind, handle: PageSaveHandle | null) => void;
  networkOpenRequest: number;
  selectedChapterId: string;
  onSelectChapter: (chapterId: string) => void;
  onOpenSource: (result: GlobalSearchResult) => void;
  onExportBook: () => void;
  onExportBookWithOptions: (options: {
    includeOutline?: boolean;
    includeMaterials?: boolean;
    includeCharacters?: boolean;
    includeWorld?: boolean;
  }) => void;
  onApplyState: (state: AppState) => void;
  onStatus: (message: string) => void;
};
