import type {
  AppState,
  BackgroundTask,
} from "../../types";
import type { AppStores } from "../../stores/app-stores";
import { useStoreField } from "../../stores/use-app-stores";
import type { CreativeWorkspaceTab } from "../story/CreativeWorkspace";
import type { StoryCenterTab } from "../story/StoryCenterModal";
import { QuickPanelModal } from "./QuickPanelModal";
import { NameGeneratorModal } from "./NameGeneratorModal";
import { ImportProjectModal } from "./ImportProjectModal";
import { FileBridgeModal } from "./FileBridgeModal";
import { ImageGenModal } from "./ImageGenModal";
import { PromptDialog } from "./PromptDialog";
import { SettingsModal } from "./SettingsModal";
import { StoryCenterModal } from "../story/StoryCenterModal";
import { TaskCenterDrawer } from "./TaskCenterDrawer";

export function AppModals({
  state,
  stores,
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
  onOpenTemplates,
  onOpenView,
  onOpenProgress,
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
  onBeforeDisableMindMap,
}: {
  state: AppState;
  stores: AppStores;
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
  onOpenTemplates: () => void;
  onOpenView: (
    view: "chapters" | "characters" | "world" | "knowledge" | "analysis",
  ) => void;
  onOpenProgress: (tool: "mindmap" | "network" | "grid") => void;
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
  onOpenStoryCenter: (tab: "facts" | "board") => void;
  onBeforeDisableMindMap?: () => Promise<boolean>;
}) {
  const [showNameGen, setShowNameGen] = useStoreField(stores.navigation, "showNameGen");
  const [showImportProject, setShowImportProject] = useStoreField(stores.navigation, "showImportProject");
  const [showFileBridge, setShowFileBridge] = useStoreField(stores.navigation, "showFileBridge");
  const [showImageGen, setShowImageGen] = useStoreField(stores.navigation, "showImageGen");
  const openModal = (setter: (value: boolean) => void) => {
    onCloseQuickPanel();
    setter(true);
  };
  return (
    <>
      {showSettings && (
        <SettingsModal
          state={state}
          selectedChapterId={selectedChapterId}
          onClose={onCloseSettings}
          onSave={onSaveSettings}
          onBeforeDisableMindMap={onBeforeDisableMindMap}
        />
      )}
      {showQuickPanel && (
        <QuickPanelModal
          state={state}
          currentView={view}
          onClose={onCloseQuickPanel}
          onOpenTemplates={onOpenTemplates}
          onOpenNameGen={() => openModal(setShowNameGen)}
          onOpenImportProject={() => openModal(setShowImportProject)}
          onOpenFileBridge={() => openModal(setShowFileBridge)}
          onOpenImageGen={() => openModal(setShowImageGen)}
          onOpenView={onOpenView}
          onOpenProgress={onOpenProgress}
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
      {showNameGen && <NameGeneratorModal onClose={() => setShowNameGen(false)} onStatus={onStatus} />}
      {showImportProject && <ImportProjectModal onClose={() => setShowImportProject(false)} onStatus={onStatus} />}
      {showFileBridge && <FileBridgeModal state={state} onClose={() => setShowFileBridge(false)} onStatus={onStatus} />}
      {showImageGen && <ImageGenModal state={state} onClose={() => setShowImageGen(false)} onStatus={onStatus} />}
      <PromptDialog />
    </>
  );
}
