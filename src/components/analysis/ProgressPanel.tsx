import { ProgressWorkspace } from "../../components/ProgressWorkspace";
import type { AnalysisContext } from "./context";

export function ProgressPanel(
  context: Pick<
    AnalysisContext,
    | "networkOpenRequest"
    | "onApplyState"
    | "onRegisterSave"
    | "onSelectChapter"
    | "onStatus"
    | "registerNetworkSave"
    | "selectedChapter"
    | "selectedChapterId"
    | "state"
  >,
) {
  const {
    networkOpenRequest,
    onApplyState,
    onSelectChapter,
    onStatus,
    registerNetworkSave,
    selectedChapter,
    state,
  } = context;

  return (
    <ProgressWorkspace
      state={state}
      onRegisterSave={registerNetworkSave}
      networkOpenRequest={networkOpenRequest}
      selectedChapterId={selectedChapter?.id || ""}
      onSelectChapter={onSelectChapter}
      onApplyState={onApplyState}
      onStatus={onStatus}
    />
  );
}
