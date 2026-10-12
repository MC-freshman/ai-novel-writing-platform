import {
  BookOpen,
  Download,
  FileDown,
  FilePlus2,
  FolderOpen,
  Leaf,
  ListTree,
  MessageSquarePlus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Save,
  Settings,
  Sun,
  Upload,
} from "lucide-react";

export type TopBarLayout = "writing" | "materials" | "chat";

const LAYOUT_OPTIONS: { key: TopBarLayout; label: string }[] = [
  { key: "writing", label: "写作布局" },
  { key: "materials", label: "资料布局" },
  { key: "chat", label: "对话布局" },
];

export function TopBar({
  title,
  theme,
  focusMode,
  onCreateProject,
  onOpenProject,
  onImportDocument,
  onExportBook,
  onSave,
  onKnowledge,
  onExportChapterDocx,
  onBackup,
  onRebuildIndex,
  onSelectLayout,
  onShowAiChat,
  onOpenQuickPanel,
  onOpenSettings,
  onToggleTheme,
  onToggleFocus,
}: {
  title: string;
  theme: "light" | "dark";
  focusMode: boolean;
  onCreateProject: () => void;
  onOpenProject: () => void;
  onImportDocument: () => void;
  onExportBook: () => void;
  onSave: () => void;
  onKnowledge: () => void;
  onExportChapterDocx: () => void;
  onBackup: () => void;
  onRebuildIndex: () => void;
  onSelectLayout: (layout: TopBarLayout) => void;
  onShowAiChat: () => void;
  onOpenQuickPanel: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onToggleFocus: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Leaf size={21} />
        </span>
        <div className="brand-copy">
          <span>{title}</span>
          <small>
            {focusMode ? "专注写作 · Esc 返回" : "让故事慢慢生长"}
          </small>
        </div>
      </div>
      <nav className="menu">
        <button onClick={onCreateProject} title="新建小说项目">
          <FilePlus2 size={16} />
          新建
        </button>
        <button onClick={onOpenProject} title="打开小说项目">
          <FolderOpen size={16} />
          打开
        </button>
        <button
          onClick={onImportDocument}
          title="导入文档（.docx、.txt、.md）"
        >
          <Upload size={16} />
          导入文档
        </button>
        <button onClick={onExportBook} title="每篇正文分别导出为一个 Word 文档">
          <BookOpen size={16} />
          导出正文
        </button>
        <button
          className="save-action"
          onClick={onSave}
          title="保存当前页面，快捷键 Ctrl+S"
        >
          <Save size={16} />
          保存
        </button>
        <details className="top-more-actions">
          <summary title="更多项目功能">
            <ListTree size={16} />
            更多
          </summary>
          <div className="top-more-menu">
            <span className="menu-group-label">项目与知识库</span>
            <button onClick={onKnowledge} title="整理文档在知识库中的归属">
              <ListTree size={16} />
              知识库整理
            </button>
            <button
              onClick={onExportChapterDocx}
              title="导出当前章节为 Word 文档"
            >
              <FileDown size={16} />
              导出当前DOCX
            </button>
            <button onClick={onBackup} title="导出压缩备份">
              <Download size={16} />
              备份项目
            </button>
            <button onClick={onRebuildIndex} title="重建知识库索引">
              <RefreshCcw size={16} />
              重建索引
            </button>
            <span className="menu-group-label">侧栏布局</span>
            {LAYOUT_OPTIONS.map(({ key, label }) => (
              <button key={key} onClick={() => onSelectLayout(key)}>
                {label}
              </button>
            ))}
          </div>
        </details>
      </nav>
      <div className="top-actions">
        <button
          className="ai-chat-shortcut"
          onClick={onShowAiChat}
          title="显示 AI 对话"
        >
          <MessageSquarePlus size={18} />
          <span>AI 对话</span>
        </button>
        <button onClick={onOpenQuickPanel} title="功能面板 Ctrl+K">
          <ListTree size={18} />
        </button>
        <button onClick={onOpenSettings} title="模型和项目设置">
          <Settings size={18} />
        </button>
        <button onClick={onToggleTheme} title="切换主题">
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          className="focus-toggle"
          aria-label={focusMode ? "退出专注模式" : "进入专注模式"}
          aria-pressed={focusMode}
          onClick={onToggleFocus}
          title="专注模式"
        >
          {focusMode ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
          <span>{focusMode ? "退出专注" : "专注写作"}</span>
        </button>
      </div>
    </header>
  );
}
