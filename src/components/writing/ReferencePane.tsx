// 分屏参考面板（P87）：只读对照另一章，边写边查；不编辑、不影响主编辑器。
import { useEffect, useState } from "react";
import { BookOpen, X } from "lucide-react";
import type { Chapter } from "../../types";
import { contentToPlainText, getErrorMessage } from "../../lib/text-utils";

export function ReferencePane({ chapterId, chapters, onClose, onOpenChapter, onSwitch }: {
  chapterId: string;
  chapters: Chapter[];
  onClose: () => void;
  onOpenChapter: (chapterId: string) => void;
  onSwitch: (chapterId: string) => void;
}) {
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [errorText, setErrorText] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!chapterId) return;
    setLoading(true);
    setErrorText("");
    void (async () => {
      try {
        const result = await window.novelAPI.loadChapter(chapterId);
        if (!active) return;
        setContent(contentToPlainText(result.content));
        setTitle(result.chapter?.title || "");
      } catch (error) {
        if (active) setErrorText(getErrorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [chapterId]);

  return (
    <aside className="reference-pane" aria-label="参考面板">
      <div className="reference-pane-head">
        <BookOpen size={14} />
        <select value={chapterId} onChange={(event) => onSwitch(event.target.value)} title="切换参考章节" aria-label="切换参考章节">
          {chapters.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>{chapter.volume ? `${chapter.volume} / ` : ""}{chapter.title || chapter.fileName}</option>
          ))}
        </select>
        <button disabled={!chapterId} onClick={() => onOpenChapter(chapterId)} title="在主编辑器打开此章">打开</button>
        <button onClick={onClose} title="关闭参考面板"><X size={14} /></button>
      </div>
      <div className="reference-pane-body">
        {loading ? <p className="reference-pane-note">加载中…</p>
          : errorText ? <p className="reference-pane-note">读取失败：{errorText}</p>
          : <pre>{content || "（空章节）"}</pre>}
      </div>
      <p className="reference-pane-note">只读参考 · {title}</p>
    </aside>
  );
}