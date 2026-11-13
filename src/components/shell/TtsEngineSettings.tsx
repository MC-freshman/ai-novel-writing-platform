// TTS 引擎设置（P94）：系统语音 / 外部本地 HTTP 引擎。
import { useEffect, useState } from "react";
import { getErrorMessage } from "../../lib/text-utils";
import { InlineFeedback } from "../ui/InlineFeedback";

export function TtsEngineSettings() {
  const [engine, setEngine] = useState<"system" | "external">("system");
  const [externalUrl, setExternalUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "info"; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const config = await window.novelAPI.getTtsConfig();
        if (!active) return;
        setEngine(config.engine);
        setExternalUrl(config.externalUrl);
      } catch { /* 默认系统 */ }
    })();
    return () => { active = false; };
  }, []);

  async function save() {
    setBusy(true);
    setFeedback(null);
    try {
      const config = await window.novelAPI.saveTtsConfig({ engine, externalUrl });
      setEngine(config.engine);
      setExternalUrl(config.externalUrl);
      setFeedback({ tone: "info", message: "朗读引擎设置已保存。" });
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tts-engine-settings">
      <label>
        朗读引擎
        <select value={engine} onChange={(event) => setEngine(event.target.value as "system" | "external")}>
          <option value="system">系统语音（离线）</option>
          <option value="external">外部本地引擎（HTTP）</option>
        </select>
      </label>
      {engine === "external" && (
        <label>
          引擎地址（仅本机）
          <input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="http://127.0.0.1:5000/tts" />
        </label>
      )}
      <button disabled={busy} onClick={() => void save()}>保存朗读设置</button>
      {engine === "external" && <p className="cloud-backup-note">外部引擎契约：POST 地址，body {"{text, rate}"}，返回音频字节（wav/mpeg/ogg）。需自行在本机运行 TTS 服务；平台不捆绑。</p>}
      {feedback && <InlineFeedback tone={feedback.tone} message={feedback.message} />}
    </div>
  );
}