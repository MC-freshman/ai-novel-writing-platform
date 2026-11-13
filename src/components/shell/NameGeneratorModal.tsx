// 起名助手弹窗（P90）：本地生成候选名，复制/写入角色卡。
import { useState } from "react";
import { Shuffle, UserPlus } from "lucide-react";
import type { CharacterCard } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { InlineFeedback } from "../ui/InlineFeedback";

const TYPES = [
  { id: "character", label: "角色名" },
  { id: "place", label: "地点名" },
  { id: "skill", label: "功法名" },
  { id: "book", label: "书名" },
];
const STYLES = ["通用", "古风", "玄幻", "都市"];

export function NameGeneratorModal({ onClose, onStatus }: { onClose: () => void; onStatus: (message: string) => void }) {
  const dialogRef = useDialogFocus(onClose);
  const [type, setType] = useState("character");
  const [style, setStyle] = useState("通用");
  const [count, setCount] = useState(12);
  const [seed, setSeed] = useState("");
  const [theme, setTheme] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [source, setSource] = useState<"local" | "ai">("local");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "warning" | "info"; message: string } | null>(null);

  async function generate() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await window.novelAPI.generateNames({ type, style, count, seed });
      setNames(result.names);
      setSource("local");
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function generateAi() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await window.novelAPI.generateNamesAi({ type, style, count, theme });
      setNames(result.names);
      setSource("ai");
    } catch (error) {
      setFeedback({ tone: "warning", message: `AI 起名失败（${getErrorMessage(error)}），已降级本地生成。` });
      try {
        const fallback = await window.novelAPI.generateNames({ type, style, count, seed });
        setNames(fallback.names);
        setSource("local");
      } catch { /* 本地也失败则保留错误提示 */ }
    } finally {
      setBusy(false);
    }
  }

  async function copyName(name: string) {
    try {
      await navigator.clipboard.writeText(name);
      onStatus(`已复制：${name}`);
    } catch {
      setFeedback({ tone: "info", message: `自动复制不可用，请手动复制：${name}` });
    }
  }

  async function addToCharacters(name: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const card: Partial<CharacterCard> = { name, category: "未分类" };
      const created = await window.novelAPI.saveCharacter(card);
      if (created) onStatus(`已创建角色卡：${name}`);
      setFeedback({ tone: "info", message: `已写入角色卡「${name}」，可在「角色」中完善。` });
    } catch (error) {
      setFeedback({ tone: "error", message: `写入角色卡失败：${getErrorMessage(error)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section ref={dialogRef} className="name-gen-modal modal-surface" role="dialog" aria-modal="true" aria-label="起名助手" tabIndex={-1}>
        <header>
          <div><Shuffle size={16} /><strong>起名助手</strong></div>
          <button onClick={onClose}>关闭</button>
        </header>
        <p className="name-gen-note">本地字库组合生成（离线可用，不捆绑第三方语料）；同一种子可复现。候选仅供参考，写入前请核对。</p>
        <div className="name-gen-form">
          <label>
            类型
            <select value={type} onChange={(event) => setType(event.target.value)}>
              {TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>
            风格
            <select value={style} onChange={(event) => setStyle(event.target.value)}>
              {STYLES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            数量
            <input type="number" min="1" max="50" value={count} onChange={(event) => setCount(Math.min(50, Math.max(1, Number(event.target.value) || 1)))} />
          </label>
          <label>
            种子（可选）
            <input value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="留空随机" />
          </label>
          <label>
            AI 主题（可选）
            <input value={theme} onChange={(event) => setTheme(event.target.value)} placeholder="如：边塞军人、冷峻" />
          </label>
          <button className="primary" disabled={busy} onClick={() => void generate()}>{busy ? "生成中..." : "本地生成"}</button>
          <button disabled={busy} onClick={() => void generateAi()} title="使用已配置的聊天接口生成（失败自动降级本地）">AI 生成</button>
        </div>
        {feedback && <InlineFeedback tone={feedback.tone} message={feedback.message} />}
        {names.length > 0 && (
          <div className="name-gen-candidates">
            <span className="name-gen-source">{source === "ai" ? "AI 生成" : "本地生成"}</span>
            {names.map((name) => (
              <span key={name} className="name-gen-chip">
                <button disabled={busy} title="复制" onClick={() => void copyName(name)}>{name}</button>
                {type === "character" && (
                  <button disabled={busy} title="写入角色卡" onClick={() => void addToCharacters(name)}><UserPlus size={13} /></button>
                )}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}