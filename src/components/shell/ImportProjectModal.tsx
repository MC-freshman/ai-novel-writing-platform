// 外部项目导入弹窗（P91）：Obsidian 库 / novelWriter .nwx，预览确认后导入。
import { useState } from "react";
import { FolderInput, Upload } from "lucide-react";
import type { ImportPreview, ImportRunResult } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { InlineFeedback } from "../ui/InlineFeedback";

export function ImportProjectModal({ onClose, onStatus }: { onClose: () => void; onStatus: (message: string) => void }) {
  const dialogRef = useDialogFocus(onClose);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "warning" | "info"; message: string } | null>(null);

  async function pick(kind: "vault" | "nwx" | "scriv") {
    setBusy(true);
    setFeedback(null);
    setResult(null);
    setPreview(null);
    try {
      const next = kind === "vault" ? await window.novelAPI.previewVaultImport()
        : kind === "nwx" ? await window.novelAPI.previewNwxImport()
        : await window.novelAPI.previewScrivImport();
      if (!next.canceled) setPreview(next);
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!preview) return;
    setBusy(true);
    setFeedback(null);
    try {
      const next = preview.kind === "vault"
        ? await window.novelAPI.runVaultImport({ directory: preview.directory || "" })
        : preview.kind === "nwx"
          ? await window.novelAPI.runNwxImport({ filePath: preview.filePath || "" })
          : await window.novelAPI.runScrivImport({ filePath: preview.filePath || "" });
      setResult(next);
      setPreview(null);
      onStatus(`外部项目导入完成：${next.imported} 篇`);
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section ref={dialogRef} className="import-project-modal modal-surface" role="dialog" aria-modal="true" aria-label="导入外部项目" tabIndex={-1}>
        <header>
          <div><FolderInput size={16} /><strong>导入外部项目</strong></div>
          <button onClick={onClose}>关闭</button>
        </header>
        <p className="import-project-note">Obsidian 库：递归导入 markdown，子目录映射为分卷，wiki 链接按原文保留。novelWriter：导入 .nwx 备份中的文档（nwd 元数据剥离）。Scrivener：.scriv 内 RTF 纯文本提取（有损，格式/图片不保留）。原文件不改写；导入由项目事务保护。</p>
        <div className="settings-security-actions">
          <button disabled={busy} onClick={() => void pick("vault")}><Upload size={14} /> 选择 Obsidian 库目录</button>
          <button disabled={busy} onClick={() => void pick("nwx")}><Upload size={14} /> 选择 .nwx 备份</button>
          <button disabled={busy} onClick={() => void pick("scriv")}><Upload size={14} /> 选择 .scriv 项目</button>
        </div>
        {feedback && <InlineFeedback tone={feedback.tone} message={feedback.message} />}
        {preview && !preview.canceled && (
          <div className="import-project-preview">
            <InlineFeedback tone="info" message={`预览：${preview.files?.length || 0} 个文档${preview.warnings?.length ? `。注意：${preview.warnings.join("；")}` : ""}`} />
            <ul className="import-project-files">
              {(preview.files || []).slice(0, 100).map((file) => (
                <li key={file.relPath}>
                  <strong>{file.title}</strong>
                  <span>{file.volume} · {file.relPath}</span>
                </li>
              ))}
            </ul>
            <button className="primary" disabled={busy} onClick={() => void runImport()}>{busy ? "导入中..." : `确认导入 ${preview.files?.length || 0} 篇`}</button>
          </div>
        )}
        {result && (
          <InlineFeedback
            tone={result.skipped ? "warning" : "info"}
            message={`导入完成：成功 ${result.imported} 篇，跳过 ${result.skipped} 篇${result.failures.length ? `。失败示例：${result.failures.slice(0, 3).join("；")}` : ""}`}
          />
        )}
      </section>
    </div>
  );
}