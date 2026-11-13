import type { Editor } from "@tiptap/react";
import type {
  AppState,
  Chapter,
  EditorScrollAnchor,
  RecoveryDraft,
} from "../../types";
import { memo, useEffect, useState } from "react";
import type { InlineReviewItem } from "../../lib/editor-ops";
import type { AppStores } from "../../stores/app-stores";
import { TtsPlayer } from "./TtsPlayer";
import { ReferencePane } from "./ReferencePane";
import "../../modules/tts/slot";
import { isModuleEnabled } from "../../lib/modules";
import { useStoreField } from "../../stores/use-app-stores";
import {
  Eye,
  EyeOff,
  FileText,
  Maximize2,
  PanelRight,
  RefreshCcw,
  Search,
  ShieldAlert,
  Volume2,
} from "lucide-react";
import { ChapterProgressStrip } from "../planning/ProgressBoard";
import { RichDocumentEditor } from "./RichDocumentEditor";
import { countWords, contentToPlainText, formatDateTime } from "../../lib/text-utils";

function EditorPanelComponent({
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
  onOpenChapter,
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
  onOpenChapter: (chapterId: string) => void;
}) {
  const [showTts, setShowTts] = useState(false);
  const ttsEnabled = isModuleEnabled(stores.project.store.getState().state?.config, "tts");
  const [referenceChapterId, setReferenceChapterId] = useStoreField(stores.layout, "referenceChapterId");
  const [referenceChapterIds, setReferenceChapterIds] = useStoreField(stores.layout, "referenceChapterIds");
  const [focusMode] = useStoreField(stores.layout, "focusMode");
  const referenceChapters = stores.project.store.getState().state?.chapters || [];
  const referencePanels = referenceChapterIds.length ? referenceChapterIds : (referenceChapterId ? [referenceChapterId] : []);
  function addReferencePanel() {
    const candidate = selectedChapter?.id || referenceChapters[0]?.id || "";
    if (!candidate) return;
    const next = referencePanels.length ? [...referencePanels] : [];
    if (next.length >= 4) {
      onStatus("参考面板最多 4 个，请先关闭一个。");
      return;
    }
    next.push(candidate);
    setReferenceChapterIds(next);
    setReferenceChapterId(next[0] || "");
  }
  function removeReferencePanel(index: number) {
    const next = referencePanels.filter((_, itemIndex) => itemIndex !== index);
    setReferenceChapterIds(next);
    setReferenceChapterId(next[0] || "");
  }
  function switchReferencePanel(index: number, chapterId: string) {
    const next = referencePanels.map((item, itemIndex) => (itemIndex === index ? chapterId : item));
    setReferenceChapterIds(next);
    setReferenceChapterId(next[0] || "");
  }
  const [sensitiveHighlight, setSensitiveHighlight] = useState(false);
  const [sensitiveMarks, setSensitiveMarks] = useState<InlineReviewItem[]>([]);
  useEffect(() => {
    if (!sensitiveHighlight || !selectedChapter?.id) {
      setSensitiveMarks([]);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const report = await window.novelAPI.scanSensitive({ chapterIds: [selectedChapter.id] });
        if (!active) return;
        const chapterResult = report.results.find((item) => item.chapterId === selectedChapter.id);
        const seen = new Set<string>();
        const marks: InlineReviewItem[] = [];
        for (const hit of chapterResult?.hits || []) {
          if (seen.has(hit.word)) continue;
          seen.add(hit.word);
          marks.push({ id: `sens_${hit.word}`, kind: "sensitive", quote: hit.word, label: `敏感词提示：${hit.word}`, status: "敏感词" });
        }
        setSensitiveMarks(marks);
      } catch {
        if (active) setSensitiveMarks([]);
      }
    })();
    return () => { active = false; };
  }, [sensitiveHighlight, selectedChapter?.id]);
  const mergedReviews = sensitiveMarks.length ? [...editorReviews, ...sensitiveMarks] : editorReviews;
  const debugWindow = window as Window & {
    __NOVEL_RENDER_DEBUG__?: boolean;
    __editorRenderCount?: number;
  };
  if (debugWindow.__NOVEL_RENDER_DEBUG__) {
    debugWindow.__editorRenderCount = (debugWindow.__editorRenderCount || 0) + 1;
  }
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
          {ttsEnabled && (
            <button
              title="朗读校对（系统语音，离线）"
              className={showTts ? "active" : ""}
              onClick={() => setShowTts((value) => !value)}
            >
              <Volume2 size={17} />
            </button>
          )}
          <button
            title="分屏参考（只读对照，最多 4 个面板）"
            className={referencePanels.length ? "active" : ""}
            onClick={addReferencePanel}
          >
            <PanelRight size={17} />
          </button>
          <button
            title="敏感词高亮（只读提示，不改正文）"
            className={sensitiveHighlight ? "active" : ""}
            onClick={() => setSensitiveHighlight((value) => !value)}
          >
            <ShieldAlert size={17} />
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
      <div className={`editor-split${referencePanels.length > 1 ? " multi-reference" : ""}`}>
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
            reviews={mergedReviews}
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
      {referencePanels.length > 0 && !focusMode && referencePanels.map((chapterId, index) => (
        <ReferencePane
          key={`${chapterId}-${index}`}
          chapterId={chapterId}
          chapters={referenceChapters}
          onClose={() => removeReferencePanel(index)}
          onOpenChapter={onOpenChapter}
          onSwitch={(nextChapterId) => switchReferencePanel(index, nextChapterId)}
        />
      ))}
      </div>
      {showTts && ttsEnabled && (
        <TtsPlayer text={contentToPlainText(chapterContent)} title={chapterTitle} onClose={() => setShowTts(false)} />
      )}
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

export const EditorPanel = memo(EditorPanelComponent);
