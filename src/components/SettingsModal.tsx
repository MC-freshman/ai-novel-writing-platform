// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { useState } from "react";
import { Settings } from "lucide-react";
import type { AppState, AgentPermissionLevel, Provider } from "../types";
import { clampNumber, getErrorMessage } from "../lib/text-utils";
import { PROVIDER_DEFAULTS, MAX_CHAT_TOKENS, MAX_RETRIEVAL_TOP_K, MAX_RETRIEVAL_SCAN_K } from "../lib/chat-utils";
import { useDialogFocus } from "../hooks/useDialogFocus";

export function SettingsModal({
  state,
  selectedChapterId,
  onClose,
  onSave,
}: {
  state: AppState;
  selectedChapterId?: string;
  onClose: () => void;
  onSave: (state: AppState) => void;
}) {
  const dialogRef = useDialogFocus(onClose);
  const [draft, setDraft] = useState(state.config);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [securityStatus, setSecurityStatus] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<Awaited<ReturnType<typeof window.novelAPI.checkForUpdate>> | null>(null);
  const provider = draft.api.provider;

  function updateApi<K extends keyof typeof draft.api>(key: K, value: (typeof draft.api)[K]) {
    setDraft((config) => ({ ...config, api: { ...config.api, [key]: value } }));
  }

  function updateUi<K extends keyof typeof draft.ui>(key: K, value: (typeof draft.ui)[K]) {
    setDraft((config) => ({ ...config, ui: { ...config.ui, [key]: value } }));
  }

  function updateAgent<K extends keyof typeof draft.agent>(key: K, value: (typeof draft.agent)[K]) {
    setDraft((config) => ({ ...config, agent: { ...config.agent, [key]: value } }));
  }

  async function save() {
    setSaving(true);
    setErrorText("");
    const normalized = {
      ...draft,
      api: {
        ...draft.api,
        temperature: clampNumber(Number(draft.api.temperature), 0, 2, 0.7),
        maxTokens: Math.floor(clampNumber(Number(draft.api.maxTokens), 1, MAX_CHAT_TOKENS, 8000)),
        topK: Math.floor(clampNumber(Number(draft.api.topK), 1, MAX_RETRIEVAL_TOP_K, 5)),
        scanK: Math.floor(clampNumber(Number(draft.api.scanK), Number(draft.api.topK) || 1, MAX_RETRIEVAL_SCAN_K, 5000)),
      },
    };
    try {
      const next = await window.novelAPI.saveProjectSettings({ ...normalized, selectedChapterId });
      onSave(next);
    } catch (error) {
      setErrorText(`保存设置失败：${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function checkUpdate() {
    setSecurityBusy(true);
    setSecurityStatus("正在检查 GitHub 发布版本...");
    try {
      const result = await window.novelAPI.checkForUpdate();
      setUpdateInfo(result);
      setSecurityStatus(result.updateAvailable ? `发现新版本 ${result.latestVersion}` : `当前 ${result.currentVersion} 已是最新公开版本`);
    } catch (error) {
      setSecurityStatus(`检查更新失败：${getErrorMessage(error)}`);
    } finally {
      setSecurityBusy(false);
    }
  }

  async function downloadUpdate() {
    if (!updateInfo?.downloadUrl) return;
    if (!window.confirm(`确认下载 ${updateInfo.releaseName} 吗？下载完成后仍会再次询问是否打开更新程序。`)) return;
    setSecurityBusy(true);
    try {
      const result = await window.novelAPI.downloadUpdate({ url: updateInfo.downloadUrl, assetName: updateInfo.assetName });
      if (!result.canceled) setSecurityStatus(`更新已下载：${result.filePath}`);
    } catch (error) {
      setSecurityStatus(`下载更新失败：${getErrorMessage(error)}`);
    } finally {
      setSecurityBusy(false);
    }
  }

  async function scanPrivacy() {
    setSecurityBusy(true);
    setSecurityStatus("正在扫描发布输入文件...");
    try {
      const report = await window.novelAPI.scanReleasePrivacy();
      setSecurityStatus(report.ok ? `隐私扫描通过：已检查 ${report.scannedFiles} 个发布输入文件` : `发现 ${report.findings.length} 个风险项：${report.findings.slice(0, 3).map((item) => `${item.file}:${item.line} ${item.label}`).join("；")}`);
    } catch (error) {
      setSecurityStatus(`隐私扫描失败：${getErrorMessage(error)}`);
    } finally {
      setSecurityBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section ref={dialogRef} className="settings-modal" role="dialog" aria-modal="true" aria-label="设置" tabIndex={-1}>
        <header>
          <div>
            <Settings size={20} />
            <strong>设置</strong>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>

        <div className="settings-grid">
          <label>
            小说名称
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label>
            作者
            <input value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })} />
          </label>
          <label>
            接口提供商
            <select
              value={provider}
              onChange={(event) => {
                const nextProvider = event.target.value as Provider;
                const defaults = PROVIDER_DEFAULTS[nextProvider];
                setDraft({
                  ...draft,
                  api: {
                    ...draft.api,
                    provider: nextProvider,
                    baseUrl: defaults.baseUrl,
                    chatModel: defaults.model,
                  },
                });
              }}
            >
              {(Object.keys(PROVIDER_DEFAULTS) as Provider[]).map((item) => (
                <option value={item} key={item}>
                  {PROVIDER_DEFAULTS[item].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            接口密钥
            <input type="password" autoComplete="off" placeholder={draft.api.apiKeyConfigured ? "已配置；留空保留，输入新值替换" : "输入接口密钥"} value={draft.api.apiKey} onChange={(event) => updateApi("apiKey", event.target.value)} />
            <span><input type="checkbox" checked={draft.api.clearApiKey === true} onChange={(event) => updateApi("clearApiKey", event.target.checked)} /> 清除已保存的聊天密钥</span>
          </label>
          <label>
            接口地址
            <input value={draft.api.baseUrl} onChange={(event) => updateApi("baseUrl", event.target.value)} />
          </label>
          <label>
            聊天模型
            <input value={draft.api.chatModel} onChange={(event) => updateApi("chatModel", event.target.value)} />
          </label>
          <label>
            创造性
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={draft.api.temperature}
              onChange={(event) => updateApi("temperature", clampNumber(Number(event.target.value), 0, 2, 0.7))}
            />
          </label>
          <label>
            最大输出 Token 数
            <input
              type="number"
              min="1"
              max={MAX_CHAT_TOKENS}
              value={draft.api.maxTokens}
              onChange={(event) => updateApi("maxTokens", Math.floor(clampNumber(Number(event.target.value), 1, MAX_CHAT_TOKENS, 8000)))}
            />
          </label>
          <label>
            发送片段上限（最高 1000）
            <input
              type="number"
              min="1"
              max={MAX_RETRIEVAL_TOP_K}
              value={draft.api.topK}
              onChange={(event) => updateApi("topK", Math.floor(clampNumber(Number(event.target.value), 1, MAX_RETRIEVAL_TOP_K, 5)))}
            />
          </label>
          <label>
            候选扫描上限（最高 50000）
            <input
              type="number"
              min={Math.max(1, Number(draft.api.topK) || 1)}
              max={MAX_RETRIEVAL_SCAN_K}
              value={draft.api.scanK}
              onChange={(event) => updateApi("scanK", Math.floor(clampNumber(Number(event.target.value), Math.max(1, Number(draft.api.topK) || 1), MAX_RETRIEVAL_SCAN_K, 5000)))}
            />
          </label>
          <label>
            向量接口地址
            <input value={draft.api.embeddingBaseUrl} onChange={(event) => updateApi("embeddingBaseUrl", event.target.value)} />
          </label>
          <label>
            向量接口密钥
            <input type="password" autoComplete="off" placeholder={draft.api.embeddingApiKeyConfigured ? "已配置；留空保留，输入新值替换" : "输入向量接口密钥"} value={draft.api.embeddingApiKey} onChange={(event) => updateApi("embeddingApiKey", event.target.value)} />
            <span><input type="checkbox" checked={draft.api.clearEmbeddingApiKey === true} onChange={(event) => updateApi("clearEmbeddingApiKey", event.target.checked)} /> 清除已保存的向量密钥</span>
          </label>
          <label>
            向量模型
            <input value={draft.api.embeddingModel} onChange={(event) => updateApi("embeddingModel", event.target.value)} />
          </label>
          <label>
            字号
            <input type="number" min="13" max="28" value={draft.ui.fontSize} onChange={(event) => updateUi("fontSize", Number(event.target.value))} />
          </label>
          <label>
            行距
            <input
              type="number"
              min="1.3"
              max="2.4"
              step="0.05"
              value={draft.ui.lineHeight}
              onChange={(event) => updateUi("lineHeight", Number(event.target.value))}
            />
          </label>
          <label>
            自动保存毫秒
            <input type="number" min="600" value={draft.ui.autosaveMs} onChange={(event) => updateUi("autosaveMs", Number(event.target.value))} />
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={draft.ui.backupOnSave} onChange={(event) => updateUi("backupOnSave", event.target.checked)} />
            每次保存后自动备份
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={draft.ui.recoveryEnabled !== false} onChange={(event) => updateUi("recoveryEnabled", event.target.checked)} />
            保留异常退出恢复草稿和窗口状态
          </label>
        </div>

        <details className="settings-agent-panel">
          <summary>创作 Agent 与数据保护</summary>
          <div>
            <label>
              默认执行权限
              <select value={draft.agent.permissionLevel} onChange={(event) => updateAgent("permissionLevel", event.target.value as AgentPermissionLevel)}>
                <option value="只读分析">只读分析</option>
                <option value="可创建规划">可创建规划和素材</option>
                <option value="可生成修订候选">可生成待确认修订</option>
              </select>
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={draft.agent.autoLocalAnalysis} onChange={(event) => updateAgent("autoLocalAnalysis", event.target.checked)} />
              保存后自动更新本地剧情事实与角色状态
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={draft.agent.autoDeepAnalysis} onChange={(event) => updateAgent("autoDeepAnalysis", event.target.checked)} />
              章节停止修改 45 秒后自动加入 AI 深度分析
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={draft.agent.snapshotBeforeBulkChanges} onChange={(event) => updateAgent("snapshotBeforeBulkChanges", event.target.checked)} />
              批量导入或 AI 批量写入前自动创建项目快照
            </label>
          </div>
        </details>

        <details className="settings-agent-panel settings-security-panel">
          <summary>发布、密钥与软件更新</summary>
          <div>
            <p>接口密钥：{draft.api.credentialStorage === "windows" ? "保存在 Windows 凭据管理器" : draft.api.credentialStorage === "legacy" ? "当前环境使用兼容存储" : "尚未保存"}{draft.api.credentialError ? `；凭据管理器提示：${draft.api.credentialError}` : ""}</p>
            <div className="settings-security-actions"><button disabled={securityBusy} onClick={() => void checkUpdate()}>检查更新</button>{updateInfo?.updateAvailable && updateInfo.downloadUrl && <button className="primary" disabled={securityBusy} onClick={() => void downloadUpdate()}>下载 {updateInfo.latestVersion}</button>}<button disabled={securityBusy} onClick={() => void scanPrivacy()}>运行发布隐私扫描</button></div>
            {securityStatus && <p className="settings-security-status">{securityStatus}</p>}
            {updateInfo?.notes && <details><summary>版本说明</summary><pre>{updateInfo.notes}</pre></details>}
          </div>
        </details>

        <div className="settings-help">
          <strong>接口说明</strong>
          <p>DeepSeek 推荐：接口地址 https://api.deepseek.com/v1，聊天模型 deepseek-chat。通义千问推荐：接口地址 https://dashscope.aliyuncs.com/compatible-mode/v1，聊天模型 qwen-plus。候选扫描上限表示本地最多先看多少片段，发送片段上限表示最多交给 AI 多少片段。长篇项目建议候选扫描 5000-20000，发送片段日常 80-180，全书分析再临时提高。聊天问答会流式显示，默认不再因本地等待超时而中断；如果网络在生成中断开，已收到的内容会保留下来。DeepSeek、通义千问、OpenAI、Kimi、Ollama 和大多数中转接口使用 /chat/completions；Claude 使用 /v1/messages。向量接口使用 /embeddings。若不填向量接口密钥，软件会使用本地哈希向量作为临时索引。</p>
        </div>

        <footer>
          {errorText && <span className="settings-error">{errorText}</span>}
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "保存中..." : "保存设置"}
          </button>
        </footer>
      </section>
    </div>
  );
}
