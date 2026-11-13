// 外部软件文件桥弹窗（P74）：导出副本→外部编辑→检查变化→预览确认回导。
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCcw } from "lucide-react";
import type { AppState, CreativeWorkspaceState } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { InlineFeedback } from "../ui/InlineFeedback";

interface ChangedFile { kind: string; sourceId: string; sourceTitle: string; filePath: string; lossy?: string }

export function FileBridgeModal({ state, onClose, onStatus }: { state: AppState; onClose: () => void; onStatus: (message: string) => void }) {
  const dialogRef = useDialogFocus(onClose);
  const [kind, setKind] = useState<"mindmap" | "chapter">("mindmap");
  const [itemId, setItemId] = useState("");
  const [maps, setMaps] = useState<CreativeWorkspaceState["mindMaps"]>([]);
  const [changed, setChanged] = useState<ChangedFile[]>([]);
  const [previewInfo, setPreviewInfo] = useState<{ file: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "warning" | "info"; message: string } | null>(null);

  const loadMaps = useCallback(async () => {
    try {
      const workspace = await window.novelAPI.getCreativeWorkspace();
      setMaps(workspace.mindMaps || []);
    } catch { /* 导图模块停用时忽略 */ }
  }, []);

  useEffect(() => {
    void loadMaps();
  }, [loadMaps]);

  const items = kind === "mindmap"
    ? maps.map((map) => ({ id: map.id, label: map.title }))
    : state.chapters.map((chapter) => ({ id: chapter.id, label: `${chapter.volume ? chapter.volume + " / " : ""}${chapter.title}` }));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function exportAndOpen() {
    if (!itemId) return;
    await run(async () => {
      const result = await window.novelAPI.exportForBridge({ kind, id: itemId });
      await window.novelAPI.openBridgeFile({ filePath: result.primary });
      setFeedback({ tone: "info", message: `已导出并用外部程序打开：${result.primary}。编辑保存后点「检查外部修改」。导图全保真回导请用同名 .json。` });
    });
  }

  async function checkChanges() {
    await run(async () => {
      const result = await window.novelAPI.checkBridgeChanges();
      setChanged(result.changed);
      setPreviewInfo(null);
      if (!result.changed.length) setFeedback({ tone: "info", message: "没有检测到外部修改。" });
    });
  }

  async function previewReimport(file: string) {
    await run(async () => {
      const preview = await window.novelAPI.previewBridgeReimport({ bridgeFile: file });
      const text = preview.kind === "chapter"
        ? (preview.conflict ? "⚠ 章节在导出后被平台内修改，回导将被拒绝。请先合并。" : `章节预览：${preview.preview || ""}`)
        : preview.kind === "mindmap"
          ? `XMind 画布：${(preview.sheets || []).map((sheet) => `${sheet.title}（${sheet.nodeCount} 节点）`).join("、")}${preview.lossy ? `。${preview.lossy}` : ""}`
          : `JSON 导图：${preview.nodeCount} 节点（全保真）`;
      setPreviewInfo({ file, text });
    });
  }

  async function confirmReimport(file: string) {
    await run(async () => {
      const result = await window.novelAPI.confirmBridgeReimport({ bridgeFile: file });
      setPreviewInfo(null);
      setChanged((list) => list.filter((item) => item.filePath !== file));
      setFeedback({ tone: "info", message: `回导完成：${result.kind === "chapter" ? `章节已更新（${result.wordCount ?? "?"} 字）` : `导图已更新（${result.nodeCount ?? "?"} 节点）`}` });
      onStatus("外部修改已回导");
      void loadMaps();
    });
  }

  return (
    <div className="modal-backdrop">
      <section ref={dialogRef} className="file-bridge-modal modal-surface" role="dialog" aria-modal="true" aria-label="外部编辑文件桥" tabIndex={-1}>
        <header>
          <div><ExternalLink size={16} /><strong>外部编辑文件桥</strong></div>
          <button onClick={onClose}>关闭</button>
        </header>
        <p className="file-bridge-note">导出副本到项目 bridge/ 目录，用外部程序（XMind/Word/自研工具）编辑；检查变化后预览确认回导。回导前校验版本，冲突即停；不修改原始导出以外的项目文件。</p>
        <div className="file-bridge-export">
          <label>
            类型
            <select value={kind} onChange={(event) => { setKind(event.target.value as "mindmap" | "chapter"); setItemId(""); }}>
              <option value="mindmap">思维导图（.xmind + .json）</option>
              <option value="chapter">章节正文</option>
            </select>
          </label>
          <label>
            对象
            <select value={itemId} onChange={(event) => setItemId(event.target.value)}>
              <option value="">请选择…</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <button className="primary" disabled={busy || !itemId} onClick={() => void exportAndOpen()}>导出并打开</button>
          <button disabled={busy} onClick={() => void checkChanges()}><RefreshCcw size={14} /> 检查外部修改</button>
        </div>
        {feedback && <InlineFeedback tone={feedback.tone} message={feedback.message} />}
        {changed.length > 0 && (
          <ul className="file-bridge-list">
            {changed.map((item) => (
              <li key={item.filePath}>
                <span className="file-bridge-name" title={item.filePath}>{item.sourceTitle || item.filePath}（{item.kind}）</span>
                <button disabled={busy} onClick={() => void previewReimport(item.filePath)}>预览回导</button>
              </li>
            ))}
          </ul>
        )}
        {previewInfo && (
          <div className="file-bridge-preview">
            <p className="file-bridge-note">{previewInfo.text}</p>
            <div className="settings-security-actions">
              <button className="primary" disabled={busy} onClick={() => void confirmReimport(previewInfo.file)}>确认回导</button>
              <button disabled={busy} onClick={() => setPreviewInfo(null)}>取消</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}