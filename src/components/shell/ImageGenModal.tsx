// 图像生成弹窗（P88）：OpenAI 兼容图像接口（BYOK），生成入素材库。
import { useCallback, useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import type { AppState } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { InlineFeedback } from "../ui/InlineFeedback";

export function ImageGenModal({ state, onClose, onStatus }: { state: AppState; onClose: () => void; onStatus: (message: string) => void }) {
  const dialogRef = useDialogFocus(onClose);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [size, setSize] = useState("1024x1024");
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<Array<{ path: string; dataUrl: string }>>([]);
  const [avatarTarget, setAvatarTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "warning" | "info"; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const config = await window.novelAPI.getImageGenConfig();
      setBaseUrl(config.settings.baseUrl);
      setModel(config.settings.model);
      setSize(config.settings.size);
      setHasKey(config.hasKey);
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveConfig() {
    setBusy(true);
    setFeedback(null);
    try {
      const config = await window.novelAPI.saveImageGenConfig({ baseUrl, model, size, ...(apiKey ? { apiKey } : {}) });
      setHasKey(config.hasKey);
      setApiKey("");
      onStatus("图像生成设置已保存");
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await window.novelAPI.generateImage({ prompt, size, n: 1 });
      setImages(result.files);
      setFeedback({ tone: "info", message: `已生成 ${result.files.length} 张并存入素材库（图像分类）。费用与内容政策由所选服务决定。` });
      onStatus("图像已生成并存入素材库");
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function enqueueBackground() {
    setBusy(true);
    setFeedback(null);
    try {
      await window.novelAPI.enqueueTask({ type: "image-gen", title: `图像生成 · ${prompt.slice(0, 30)}`, options: { prompt, size, n: 1 } });
      setFeedback({ tone: "info", message: "已放入后台任务中心生成，完成后图片自动入素材库。" });
      onStatus("图像生成已加入后台任务");
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function setAvatar(imagePath: string) {
    const card = state.characters.find((item) => item.id === avatarTarget);
    if (!card) {
      setFeedback({ tone: "warning", message: "请先选择要设置头像的角色。" });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const relative = imagePath.replace(/\\/g, "/").split("/materials/")[1];
      if (!relative) throw new Error("无法解析图片相对路径。");
      await window.novelAPI.saveCharacter({ ...card, avatar: relative });
      setFeedback({ tone: "info", message: `已设为「${card.name}」的头像。` });
      onStatus(`角色头像已更新：${card.name}`);
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section ref={dialogRef} className="image-gen-modal modal-surface" role="dialog" aria-modal="true" aria-label="图像生成" tabIndex={-1}>
        <header>
          <div><ImagePlus size={16} /><strong>图像生成（立绘/封面/场景）</strong></div>
          <button onClick={onClose}>关闭</button>
        </header>
        <p className="image-gen-note">OpenAI 兼容 /images/generations 接口（自带密钥，如火山方舟/中转）；图片存入项目素材库。按张计费，生成前请确认额度；内容政策由服务商决定。</p>
        <div className="image-gen-config">
          <label>
            接口地址
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://ark.cn-beijing.volces.com/api/v3" />
          </label>
          <label>
            模型
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="doubao-seedream-5-0-lite" />
          </label>
          <label>
            密钥
            <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasKey ? "已保存；留空保留" : "输入密钥（存凭据管理器）"} />
          </label>
          <label>
            尺寸
            <select value={size} onChange={(event) => setSize(event.target.value)}>
              <option value="1024x1024">1024×1024</option>
              <option value="1536x1024">1536×1024（横）</option>
              <option value="1024x1536">1024×1536（竖）</option>
            </select>
          </label>
          <button disabled={busy} onClick={() => void saveConfig()}>保存设置</button>
        </div>
        <label>
          图像描述
          <textarea value={prompt} rows={4} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：雨夜路灯下撑伞的少年，冷色调，电影感，国风插画" />
        </label>
        <div className="settings-security-actions">
          <button className="primary" disabled={busy || !prompt.trim() || !hasKey} onClick={() => void generate()}>{busy ? "生成中..." : "生成图像"}</button>
          <button disabled={busy || !prompt.trim() || !hasKey} onClick={() => void enqueueBackground()} title="放入后台任务中心生成">后台生成</button>
        </div>
        {feedback && <InlineFeedback tone={feedback.tone} message={feedback.message} />}
        {images.length > 0 && (
          <div className="image-gen-results">
            {images.map((image) => (
              <div key={image.path} className="image-gen-item">
                <img src={image.dataUrl} alt="生成图像" className="image-gen-thumb" />
                <div className="image-gen-item-actions">
                  <select value={avatarTarget} onChange={(event) => setAvatarTarget(event.target.value)} aria-label="选择角色">
                    <option value="">设为角色头像…</option>
                    {state.characters.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
                  </select>
                  <button disabled={busy || !avatarTarget} onClick={() => void setAvatar(image.path)}>设为头像</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}