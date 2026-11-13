// 多格式导出卡片（P79）：EPUB/PDF/TXT 选择与导出，结果与警告反馈。
import { useEffect, useState } from "react";
import { FileDown } from "lucide-react";
import type { ExportFormatInfo, FormatExportResult } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import { InlineFeedback } from "../ui/InlineFeedback";

export function MultiFormatExport({ onStatus }: { onStatus: (message: string) => void }) {
  const [formats, setFormats] = useState<ExportFormatInfo[]>([]);
  const [format, setFormat] = useState("epub");
  const [byVolume, setByVolume] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FormatExportResult | null>(null);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await window.novelAPI.listExportFormats();
        if (active) setFormats(data.formats);
      } catch (error) {
        if (active) setErrorText(getErrorMessage(error));
      }
    })();
    return () => { active = false; };
  }, []);

  async function runExport() {
    setBusy(true);
    setErrorText("");
    setResult(null);
    try {
      const next = await window.novelAPI.runFormatExport({ format, options: { byVolume } });
      if (next.canceled) return;
      setResult(next);
      onStatus(`已导出 ${next.files.length} 个文件（${(next.format || format).toUpperCase()}）`);
    } catch (error) {
      setErrorText(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const selected = formats.find((item) => item.id === format);
  return (
    <details className="experimental-card" open>
      <summary>电子书与印刷格式（EPUB / PDF / TXT）</summary>
      <div className="multi-format-export">
        <p className="multi-format-note">Word 逐篇导出保持原有入口不变；这里导出整书电子书/印刷格式。EPUB 适合自出版与阅读，PDF 适合投稿打印，TXT 按章拆分适合平台上传。</p>
        <div className="multi-format-row">
          <label>
            格式
            <select value={format} onChange={(event) => setFormat(event.target.value)}>
              {formats.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {selected?.mode === "directory" && (
            <label className="checkbox-line">
              <input type="checkbox" checked={byVolume} onChange={(event) => setByVolume(event.target.checked)} />
              按分卷建子目录
            </label>
          )}
          <button className="primary" disabled={busy || formats.length === 0} onClick={() => void runExport()}>
            <FileDown size={14} />
            {busy ? "导出中..." : `导出 ${selected?.label || ""}`}
          </button>
        </div>
        {errorText && <InlineFeedback tone="error" message={`导出失败：${errorText}`} />}
        {result && !result.canceled && (
          <InlineFeedback
            tone={result.warnings.length ? "warning" : "info"}
            message={`已导出 ${result.files.length} 个文件到 ${result.directoryPath}${result.warnings.length ? `。注意：${result.warnings.join(" ")}` : ""}`}
          />
        )}
      </div>
    </details>
  );
}