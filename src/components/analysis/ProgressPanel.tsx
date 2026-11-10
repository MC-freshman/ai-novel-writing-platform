import { ProgressWorkspace } from "../../components/ProgressWorkspace";
import type { AnalysisContext } from "./context";

export function ProgressPanel(
  context: Pick<
    AnalysisContext,
    | "networkOpenRequest"
    | "progressOpenMode"
    | "progressOpenRequest"
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
    progressOpenMode,
    progressOpenRequest,
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
      progressOpenRequest={progressOpenRequest}
      progressOpenMode={progressOpenMode}
      selectedChapterId={selectedChapter?.id || ""}
      onSelectChapter={onSelectChapter}
      onApplyState={onApplyState}
      onStatus={onStatus}
    />
  );
}
