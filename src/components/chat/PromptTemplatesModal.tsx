// 自定义 AI 指令模板库（P82）：选择模板→变量替换→填入输入框（不自动发送）；管理/导入/导出。
import { useCallback, useEffect, useRef, useState } from "react";
import { FileDown, Pencil, Plus, Trash2, Upload } from "lucide-react";
import type { AppState, PromptTemplate } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { InlineFeedback } from "../ui/InlineFeedback";

const VARIABLES = ["{{书名}}", "{{章节标题}}", "{{分卷}}", "{{选区文本}}"];

export function PromptTemplatesModal({
  state,
  selectedChapterId,
  selectedText,
  onApply,
  onClose,
  onStatus,
}: {
  state: AppState;
  selectedChapterId: string;
  selectedText: string;
  onApply: (text: string) => void;
  onClose: () => void;
  onStatus: (message: string) => void;
}) {
  const dialogRef = useDialogFocus(onClose);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id?: string; title: string; body: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "warning" | "info"; message: string } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await window.novelAPI.listPromptTemplates();
      setTemplates(data.templates);
    } catch (error) {
      setFeedback({ tone: "error", message: `读取模板失败：${getErrorMessage(error)}` });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function fillVariables(body: string): string {
    const chapter = state.chapters.find((item) => item.id === selectedChapterId);
    return body
      .split("{{书名}}").join(state.config.title || "")
      .split("{{章节标题}}").join(chapter?.title || "")
      .split("{{分卷}}").join(chapter?.volume || "")
      .split("{{选区文本}}").join(selectedText || "");
  }

  async function saveEditing() {
    if (!editing) return;
    setBusy(true);
    setFeedback(null);
    try {
      const data = await window.novelAPI.savePromptTemplate({ id: editing.id, title: editing.title, body: editing.body });
      setTemplates(data.templates);
      setEditing(null);
      onStatus("指令模板已保存");
    } catch (error) {
      setFeedback({ tone: "error", message: `保存失败：${getErrorMessage(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function removeTemplate(templateId: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const data = await window.novelAPI.deletePromptTemplate(templateId);
      setTemplates(data.templates);
      setConfirmDeleteId("");
      onStatus("指令模板已删除");
    } catch (error) {
      setFeedback({ tone: "error", message: `删除失败：${getErrorMessage(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function exportTemplates() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await window.novelAPI.exportPromptTemplates();
      if (!result.canceled) setFeedback({ tone: "info", message: `已导出 ${result.count} 条模板：${result.filePath}` });
    } catch (error) {
      setFeedback({ tone: "error", message: `导出失败：${getErrorMessage(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function importTemplates() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await window.novelAPI.importPromptTemplates();
      if (!result.canceled) {
        await load();
        setFeedback({ tone: "info", message: `导入完成：新增 ${result.added} 条，跳过重复 ${result.skipped} 条。` });
      }
    } catch (error) {
      setFeedback({ tone: "error", message: `导入失败：${getErrorMessage(error)}` });
    } finally {
      setBusy(false);
    }
  }

  function insertVariable(variable: string) {
    if (!editing) return;
    const area = bodyRef.current;
    const start = area?.selectionStart ?? editing.body.length;
    const end = area?.selectionEnd ?? start;
    const next = editing.body.slice(0, start) + variable + editing.body.slice(end);
    setEditing({ ...editing, body: next });
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + variable.length, start + variable.length);
    });
  }

  const visible = templates.filter((item) => !query.trim() || item.title.includes(query.trim()) || item.body.includes(query.trim()));

  return (
    <div className="modal-backdrop">
      <section ref={dialogRef} className="prompt-templates-modal modal-surface" role="dialog" aria-modal="true" aria-label="指令模板" tabIndex={-1}>
        <header>
          <div>
            <strong>指令模板</strong>
            <span className="prompt-templates-hint">点击模板填入输入框（不自动发送）；变量在填入时替换。</span>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>
        {feedback && <InlineFeedback tone={feedback.tone} message={feedback.message} />}
        {editing ? (
          <div className="prompt-template-form">
            <label>
              标题
              <input value={editing.title} maxLength={80} onChange={(event) => setEditing({ ...editing, title: event.target.value })} placeholder="例如：章节节奏分析" />
            </label>
            <label>
              正文
              <textarea ref={bodyRef} value={editing.body} maxLength={8000} rows={8} onChange={(event) => setEditing({ ...editing, body: event.target.value })} placeholder="写下指令，可插入变量占位符" />
            </label>
            <div className="prompt-template-variables">
              {VARIABLES.map((variable) => (
                <button key={variable} disabled={busy} onClick={() => insertVariable(variable)} title={`在光标处插入 ${variable}`}>{variable}</button>
              ))}
            </div>
            <div className="prompt-template-form-actions">
              <button className="primary" disabled={busy || !editing.title.trim() || !editing.body.trim()} onClick={() => void saveEditing()}>{busy ? "保存中..." : "保存模板"}</button>
              <button disabled={busy} onClick={() => setEditing(null)}>取消</button>
            </div>
          </div>
        ) : (
          <>
            <div className="prompt-templates-toolbar">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模板…" aria-label="搜索模板" />
              <button disabled={busy} onClick={() => setEditing({ title: "", body: "" })}><Plus size={14} /> 新建模板</button>
              <button disabled={busy} onClick={() => void importTemplates()}><Upload size={14} /> 导入</button>
              <button disabled={busy || templates.length === 0} onClick={() => void exportTemplates()}><FileDown size={14} /> 导出模板</button>
            </div>
            {visible.length === 0 ? (
              <p className="prompt-templates-empty">{templates.length === 0 ? "还没有自定义模板。点击「新建模板」把常用提问存下来，支持 {{书名}}、{{章节标题}}、{{分卷}}、{{选区文本}} 变量。" : "没有匹配的模板。"}</p>
            ) : (
              <ul className="prompt-templates-list">
                {visible.map((item) => (
                  <li key={item.id}>
                    <button className="prompt-template-apply" disabled={busy} onClick={() => { onApply(fillVariables(item.body)); onClose(); }} title="替换变量并填入输入框">
                      <strong>{item.title}</strong>
                      <span>{item.body.length > 90 ? item.body.slice(0, 90) + "…" : item.body}</span>
                    </button>
                    <button disabled={busy} title="编辑模板" onClick={() => setEditing({ id: item.id, title: item.title, body: item.body })}><Pencil size={14} /></button>
                    {confirmDeleteId === item.id ? (
                      <button className="prompt-template-delete-confirm" disabled={busy} onClick={() => void removeTemplate(item.id)}>确认删除模板</button>
                    ) : (
                      <button disabled={busy} title="删除模板" onClick={() => setConfirmDeleteId(item.id)}><Trash2 size={14} /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}