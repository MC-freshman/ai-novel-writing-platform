import type { Editor } from "@tiptap/react";
import type {
  AppState,
  Chapter,
  EditorScrollAnchor,
  RecoveryDraft,
} from "../types";
import type { InlineReviewItem } from "../lib/editor-ops";
import type { AppStores } from "../stores/app-stores";
import {
  Eye,
  EyeOff,
  FileText,
  Maximize2,
  RefreshCcw,
  Search,
} from "lucide-react";
import { ChapterProgressStrip } from "./ProgressBoard";
import { RichDocumentEditor } from "./RichDocumentEditor";
import { countWords, formatDateTime } from "../lib/text-utils";

export function EditorPanel({
  selectedChapter,
  chapterTitle,
  chapterVolume,
  chapterContent,
  chapterRevision,
  preview,
  showFindReplace,
  findText,
  replaceText,
  selectedText,
  activeRecoveryDraft,
  editorRef,
  editorReviews,
  scrollAnchor,
  fontSize,
  lineHeight,
  stores,
  onTitleChange,
  onVolumeChange,
  onContentChange,
  onDirty,
  onTogglePreview,
  onToggleFindReplace,
  onToggleFocus,
  onFindTextChange,
  onReplaceTextChange,
  onFindNext,
  onReplaceAll,
  onOpenOriginal,
  onRefreshFromOriginal,
  onDiscardDraft,
  onRestoreDraft,
  onCaptureSelection,
  onAskSelectionMenu,
  onRichAskSelectionMenu,
  onEditorReady,
  onOpenReview,
  onApplyState,
  onStatus,
}: {
  selectedChapter: Chapter | null;
  chapterTitle: string;
  chapterVolume: string;
  chapterContent: string;
  chapterRevision: string;
  preview: boolean;
  showFindReplace: boolean;
  findText: string;
  replaceText: string;
  selectedText: string;
  activeRecoveryDraft: RecoveryDraft | null;
  editorRef: React.RefObject<HTMLTextAreaElement>;
  editorReviews: InlineReviewItem[];
  scrollAnchor: EditorScrollAnchor | null;
  fontSize: number;
  lineHeight: number;
  stores: AppStores;
  onTitleChange: (value: string) => void;
  onVolumeChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onDirty: () => void;
  onTogglePreview: () => void;
  onToggleFindReplace: () => void;
  onToggleFocus: () => void;
  onFindTextChange: (value: string) => void;
  onReplaceTextChange: (value: string) => void;
  onFindNext: () => void;
  onReplaceAll: () => void;
  onOpenOriginal: () => void;
  onRefreshFromOriginal: () => void;
  onDiscardDraft: (draft: RecoveryDraft) => void;
  onRestoreDraft: (draft: RecoveryDraft) => void;
  onCaptureSelection: () => void;
  onAskSelectionMenu: (event: React.MouseEvent<HTMLTextAreaElement>) => void;
  onRichAskSelectionMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onEditorReady: (editor: Editor | null) => void;
  onOpenReview: (review: InlineReviewItem) => void;
  onApplyState: (state: AppState) => void;
  onStatus: (message: string) => void;
}) {
  return (
    <section
      key={selectedChapter?.id || "empty-document"}
      className="editor-panel"
    >
      <div className="editor-header">
        <input
          className="title-input"
          aria-label="章节标题"
          value={chapterTitle}
          onChange={(event) => {
            onTitleChange(event.target.value);
            onDirty();
          }}
        />
        <input
          className="volume-input"
          aria-label="所属分卷"
          value={chapterVolume}
          onChange={(event) => {
            onVolumeChange(event.target.value);
            onDirty();
          }}
        />
        <div className="editor-tools">
          {(selectedChapter?.originalDocxFile || selectedChapter?.importedFrom) && (
            <button
              title="打开导入时保留的 Word 原文"
              onClick={onOpenOriginal}
            >
              <FileText size={17} />
            </button>
          )}
          {(selectedChapter?.originalDocxFile || selectedChapter?.importedFrom) && (
            <button
              title="从 Word 原文恢复表格和富文档格式"
              onClick={onRefreshFromOriginal}
            >
              <RefreshCcw size={17} />
            </button>
          )}
          <button
            title={preview ? "返回富文档编辑" : "查看源码"}
            className={preview ? "active" : ""}
            onClick={onTogglePreview}
          >
            {preview ? <Eye size={17} /> : <EyeOff size={17} />}
          </button>
          <button
            title="查找替换"
            className={showFindReplace ? "active" : ""}
            onClick={onToggleFindReplace}
          >
            <Search size={17} />
          </button>
          <button title="全屏专注" onClick={onToggleFocus}>
            <Maximize2 size={17} />
          </button>
        </div>
      </div>
      {activeRecoveryDraft && (
        <div className="draft-recovery-bar">
          <div>
            <strong>发现未保存草稿</strong>
            <span>
              {formatDateTime(activeRecoveryDraft.updatedAt)} /{" "}
              {activeRecoveryDraft.wordCount.toLocaleString()} 字
              {activeRecoveryDraft.baseRevision !== chapterRevision
                ? " / 原章节已变化"
                : ""}
            </span>
          </div>
          <button onClick={() => onDiscardDraft(activeRecoveryDraft)}>
            放弃
          </button>
          <button
            className="primary"
            onClick={() => onRestoreDraft(activeRecoveryDraft)}
          >
            恢复草稿
          </button>
        </div>
      )}
      {showFindReplace && (
        <div className="find-replace-bar">
          <input
            value={findText}
            onChange={(event) => onFindTextChange(event.target.value)}
            placeholder="查找"
          />
          <input
            value={replaceText}
            onChange={(event) => onReplaceTextChange(event.target.value)}
            placeholder="替换为"
          />
          <button onClick={onFindNext}>查找</button>
          <button onClick={onReplaceAll}>全部替换</button>
          <span>
            选中：
            {selectedText ? `${countWords(selectedText)} 字` : "0 字"}
          </span>
        </div>
      )}
      <div className="editor-body">
        {preview ? (
          <textarea
            ref={editorRef}
            value={chapterContent}
            onChange={(event) => {
              onContentChange(event.target.value);
              onDirty();
            }}
            onMouseUp={onCaptureSelection}
            onKeyUp={onCaptureSelection}
            onContextMenu={onAskSelectionMenu}
            spellCheck={false}
            style={{
              fontSize: `${fontSize}px`,
              lineHeight,
            }}
          />
        ) : (
          <RichDocumentEditor
            key={selectedChapter?.id || "empty-document"}
            documentId={selectedChapter?.id || ""}
            value={chapterContent}
            fontSize={fontSize}
            lineHeight={lineHeight}
            scrollAnchor={scrollAnchor}
            reviews={editorReviews}
            onChange={(documentId, next) => {
              if (
                !documentId ||
                (stores.project.store.getState().selectedChapter?.id ||
                  "") !== documentId
              )
                return;
              onContentChange(next);
              onDirty();
            }}
            onSelection={onCaptureSelection}
            onContextMenu={onRichAskSelectionMenu}
            onReady={onEditorReady}
            onOpenReview={onOpenReview}
          />
        )}
      </div>
      {selectedChapter && (
        <ChapterProgressStrip
          chapter={selectedChapter}
          onApplyState={onApplyState}
          onStatus={onStatus}
        />
      )}
    </section>
  );
}
