// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { BookOpen, Boxes, Download, FileDown, ListTree, RefreshCcw, Search, Settings, Upload, UserRound } from "lucide-react";
import type { AppState } from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";

export function QuickPanelModal({
  state,
  currentView,
  onClose,
  onOpenView,
  onImport,
  onExportChapter,
  onExportBook,
  onBackup,
  onRebuildIndex,
  onSettings,
}: {
  state: AppState;
  currentView: "chapters" | "characters" | "world" | "knowledge" | "analysis";
  onClose: () => void;
  onOpenView: (view: "chapters" | "characters" | "world" | "knowledge" | "analysis") => void;
  onImport: () => void;
  onExportChapter: () => void;
  onExportBook: () => void;
  onBackup: () => void;
  onRebuildIndex: () => void;
  onSettings: () => void;
}) {
  const dialogRef = useDialogFocus(onClose);
  const views = [
    { id: "chapters" as const, label: "章节", icon: <BookOpen size={18} />, count: state.chapters.length },
    { id: "characters" as const, label: "角色", icon: <UserRound size={18} />, count: state.characters.length },
    { id: "world" as const, label: "世界", icon: <Boxes size={18} />, count: state.worldDocs.length },
    { id: "knowledge" as const, label: "知识库", icon: <ListTree size={18} />, count: state.chapters.length },
    { id: "analysis" as const, label: "分析", icon: <Search size={18} />, count: state.vectorStats.chunks },
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section ref={dialogRef} className="quick-panel-modal" role="dialog" aria-modal="true" aria-label="功能面板" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <ListTree size={18} />
            <strong>功能面板</strong>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>
        <div className="quick-panel-grid">
          {views.map((item) => (
            <button key={item.id} className={currentView === item.id ? "active" : ""} onClick={() => onOpenView(item.id)}>
              {item.icon}
              <span>{item.label}</span>
              <small>{item.count.toLocaleString()}</small>
            </button>
          ))}
        </div>
        <div className="quick-panel-actions">
          <button onClick={onImport}>
            <Upload size={17} />
            导入文档
          </button>
          <button onClick={onExportChapter}>
            <FileDown size={17} />
            导出当前 DOCX
          </button>
          <button onClick={onExportBook}>
            <BookOpen size={17} />
            导出正文
          </button>
          <button onClick={onBackup}>
            <Download size={17} />
            备份
          </button>
          <button onClick={onRebuildIndex}>
            <RefreshCcw size={17} />
            重建索引
          </button>
          <button onClick={onSettings}>
            <Settings size={17} />
            设置
          </button>
        </div>
      </section>
    </div>
  );
}
