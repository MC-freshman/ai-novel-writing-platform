import type {
  AppState,
  BackgroundTask,
} from "../types";
import type { CreativeWorkspaceTab } from "./CreativeWorkspace";
import type { StoryCenterTab } from "./StoryCenterModal";
import { QuickPanelModal } from "./QuickPanelModal";
import { SettingsModal } from "./SettingsModal";
import { StoryCenterModal } from "./StoryCenterModal";
import { TaskCenterDrawer } from "./TaskCenterDrawer";

export function AppModals({
  state,
  selectedChapterId,
  selectedText,
  chapterRevision,
  view,
  showSettings,
  showQuickPanel,
  showStoryCenter,
  showTaskCenter,
  storyCenterInitialTab,
  workspaceInitialTab,
  backgroundTasks,
  onCloseSettings,
  onSaveSettings,
  onCloseQuickPanel,
  onOpenView,
  onImportDocument,
  onExportChapterDocx,
  onExportBook,
  onBackup,
  onRebuildIndex,
  onOpenSettings,
  onCloseStoryCenter,
  onOpenChapter,
  onOpenEvidence,
  onApplyState,
  onTaskCreated,
  onStatus,
  onCloseTaskCenter,
  onChangeTasks,
  onOpenStoryCenter,
}: {
  state: AppState;
  selectedChapterId: string;
  selectedText: string;
  chapterRevision: string;
  view: "chapters" | "characters" | "world" | "knowledge" | "analysis";
  showSettings: boolean;
  showQuickPanel: boolean;
  showStoryCenter: boolean;
  showTaskCenter: boolean;
  storyCenterInitialTab: StoryCenterTab;
  workspaceInitialTab: CreativeWorkspaceTab;
  backgroundTasks: BackgroundTask[];
  onCloseSettings: () => void;
  onSaveSettings: (state: AppState) => void;
  onCloseQuickPanel: () => void;
  onOpenView: (
    view: "chapters" | "characters" | "world" | "knowledge" | "analysis",
  ) => void;
  onImportDocument: () => void;
  onExportChapterDocx: () => void;
  onExportBook: () => void;
  onBackup: () => void;
  onRebuildIndex: () => void;
  onOpenSettings: () => void;
  onCloseStoryCenter: () => void;
  onOpenChapter: (chapterId: string) => void;
  onOpenEvidence: (chapterId: string, quote: string) => void;
  onApplyState: (state: AppState) => void;
  onTaskCreated: (task: BackgroundTask) => void;
  onStatus: (message: string) => void;
  onCloseTaskCenter: () => void;
  onChangeTasks: (tasks: BackgroundTask[]) => void;
  onOpenStoryCenter: () => void;
}) {
  return (
    <>
      {showSettings && (
        <SettingsModal
          state={state}
          selectedChapterId={selectedChapterId}
          onClose={onCloseSettings}
          onSave={onSaveSettings}
        />
      )}
      {showQuickPanel && (
        <QuickPanelModal
          state={state}
          currentView={view}
          onClose={onCloseQuickPanel}
          onOpenView={onOpenView}
          onImport={onImportDocument}
          onExportChapter={onExportChapterDocx}
          onExportBook={onExportBook}
          onBackup={onBackup}
          onRebuildIndex={onRebuildIndex}
          onSettings={onOpenSettings}
        />
      )}
      {showStoryCenter && (
        <StoryCenterModal
          state={state}
          selectedChapterId={selectedChapterId}
          selectedText={selectedText}
          chapterRevision={chapterRevision}
          initialTab={storyCenterInitialTab}
          workspaceInitialTab={workspaceInitialTab}
          onClose={onCloseStoryCenter}
          onOpenChapter={onOpenChapter}
          onOpenEvidence={onOpenEvidence}
          onApplyState={onApplyState}
          onTaskCreated={onTaskCreated}
          onStatus={onStatus}
        />
      )}
      {showTaskCenter && (
        <TaskCenterDrawer
          tasks={backgroundTasks}
          onClose={onCloseTaskCenter}
          onChange={onChangeTasks}
          onOpenStoryCenter={onOpenStoryCenter}
          onStatus={onStatus}
        />
      )}
    </>
  );
}
