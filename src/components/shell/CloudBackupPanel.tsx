// 云备份设置面板（P80）：WebDAV/本地网盘目录，归档式上传/列表/恢复。
import { useCallback, useEffect, useState } from "react";
import { CloudUpload, RefreshCcw } from "lucide-react";
import type { AppState } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import { InlineFeedback } from "../ui/InlineFeedback";

interface CloudSettings {
  targetType: "local" | "webdav";
  localDir: string;
  webdavUrl: string;
  webdavDir: string;
  username: string;
}

interface BackupItem { name: string; size: number; lastmod: string }

export function CloudBackupPanel({ state, onApplyState, onStatus }: { state: AppState; onApplyState: (next: AppState) => void; onStatus: (message: string) => void }) {
  const [settings, setSettings] = useState<CloudSettings>({ targetType: "local", localDir: "", webdavUrl: "", webdavDir: "/novel-backups", username: "" });
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "warning" | "info"; message: string } | null>(null);
  const [restoreToken, setRestoreToken] = useState("");
  const [restoreConflicts, setRestoreConflicts] = useState<string[]>([]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [intervalHours, setIntervalHours] = useState(24);
  const [scheduleInfo, setScheduleInfo] = useState<{ lastRunAt: string; lastError: string; lastFile: string }>({ lastRunAt: "", lastError: "", lastFile: "" });

  const load = useCallback(async () => {
    try {
      const status = await window.novelAPI.getCloudBackupStatus();
      setSettings(status.settings);
      setHasPassword(status.hasPassword);
      setScheduleEnabled(status.schedule.enabled);
      setIntervalHours(status.schedule.intervalHours);
      setScheduleInfo({ lastRunAt: status.schedule.lastRunAt, lastError: status.schedule.lastError, lastFile: status.schedule.lastFile });
    } catch (error) {
      setFeedback({ tone: "error", message: getErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, state.projectPath]);

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

  async function save() {
    await run(async () => {
      const status = await window.novelAPI.saveCloudBackupSettings({ ...settings, ...(password ? { password } : {}) });
      setSettings(status.settings);
      setHasPassword(status.hasPassword);
      setPassword("");
      onStatus("云备份设置已保存");
    });
  }

  async function upload() {
    await run(async () => {
      const result = await window.novelAPI.uploadCloudBackup();
      setFeedback({ tone: "info", message: `已上传备份：${result.fileName}（${(result.size / 1024 / 1024).toFixed(2)} MB）→ ${result.target}` });
      const listed = await window.novelAPI.listCloudBackups();
      setBackups(listed.backups);
    });
  }

  async function refreshList() {
    await run(async () => {
      const listed = await window.novelAPI.listCloudBackups();
      setBackups(listed.backups);
    });
  }

  async function restore(name: string) {
    await run(async () => {
      const result = await window.novelAPI.restoreCloudBackupPreview({ name });
      setRestoreToken(result.token);
      const conflicts = result.preview?.conflicts;
      setRestoreConflicts([
        ...(conflicts?.chapters || []),
        ...(conflicts?.characters || []),
        ...(conflicts?.worldDocs || []),
      ]);
      setFeedback({ tone: "warning", message: "备份已下载并预览。确认后将合并导入（重名内容作为副本），导入前自动创建安全快照。" });
    });
  }

  async function confirmRestore() {
    await run(async () => {
      const result = await window.novelAPI.importProjectExchange({ token: restoreToken });
      onApplyState(result.state);
      setRestoreToken("");
      setRestoreConflicts([]);
      setFeedback({ tone: "info", message: `恢复完成：导入 ${result.imported.chapters} 章、${result.imported.characters} 角色、${result.imported.worldDocs} 设定。` });
      onStatus("云备份恢复完成");
    });
  }

  async function saveSchedule() {
    await run(async () => {
      const schedule = await window.novelAPI.saveCloudBackupSchedule({ enabled: scheduleEnabled, intervalHours });
      setScheduleEnabled(schedule.enabled);
      setIntervalHours(schedule.intervalHours);
      setScheduleInfo({ lastRunAt: schedule.lastRunAt, lastError: schedule.lastError, lastFile: schedule.lastFile });
      setFeedback({ tone: "info", message: schedule.enabled ? `定时备份已启用（每 ${schedule.intervalHours} 小时）。` : "定时备份已关闭。" });
    });
  }

  return (
    <div className="cloud-backup-panel">
      <p className="cloud-backup-note">归档式云备份：把项目交换包（不含密钥/向量库）上传到你的 WebDAV 或网盘同步目录；单写者原则，不做实时同步。恢复=下载→预览→合并导入（自动快照）。</p>
      <label>
        目标类型
        <select value={settings.targetType} onChange={(event) => setSettings({ ...settings, targetType: event.target.value as CloudSettings["targetType"] })}>
          <option value="local">本地目录（网盘同步盘）</option>
          <option value="webdav">WebDAV（坚果云等）</option>
        </select>
      </label>
      {settings.targetType === "local" ? (
        <label>
          备份目录
          <input value={settings.localDir} onChange={(event) => setSettings({ ...settings, localDir: event.target.value })} placeholder="例如 OneDrive/坚果云同步盘下的目录" />
        </label>
      ) : (
        <>
          <label>
            WebDAV 地址
            <input value={settings.webdavUrl} onChange={(event) => setSettings({ ...settings, webdavUrl: event.target.value })} placeholder="https://dav.jianguoyun.com/dav" />
          </label>
          <label>
            远程目录
            <input value={settings.webdavDir} onChange={(event) => setSettings({ ...settings, webdavDir: event.target.value })} />
          </label>
          <label>
            用户名
            <input value={settings.username} onChange={(event) => setSettings({ ...settings, username: event.target.value })} />
          </label>
          <label>
            应用密码
            <input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={hasPassword ? "已保存；留空保留，输入新值替换" : "输入应用密码（保存到凭据管理器）"} />
          </label>
        </>
      )}
      <div className="settings-security-actions">
        <button disabled={busy} onClick={() => void save()}>保存设置</button>
        <button className="primary" disabled={busy} onClick={() => void upload()}><CloudUpload size={14} /> {busy ? "处理中..." : "立即备份"}</button>
        <button disabled={busy} onClick={() => void refreshList()}><RefreshCcw size={14} /> 刷新列表</button>
      </div>
      {feedback && <InlineFeedback tone={feedback.tone} message={feedback.message} />}
      <div className="cloud-backup-schedule">
        <label className="checkbox-line">
          <input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} />
          定时自动备份
        </label>
        <label className="cloud-backup-interval">
          间隔（小时）
          <input type="number" min="1" max="168" value={intervalHours} onChange={(event) => setIntervalHours(Math.min(168, Math.max(1, Number(event.target.value) || 24)))} />
        </label>
        <button disabled={busy} onClick={() => void saveSchedule()}>保存定时设置</button>
        {scheduleInfo.lastRunAt && (
          <span className="cloud-backup-note">上次：{new Date(scheduleInfo.lastRunAt).toLocaleString()}{scheduleInfo.lastError ? ` · 失败：${scheduleInfo.lastError}` : scheduleInfo.lastFile ? ` · ${scheduleInfo.lastFile}` : ""}</span>
        )}
      </div>
      {restoreToken && (
        <div className="settings-security-actions">
          <span className="cloud-backup-note">冲突项（将作为副本导入）：{restoreConflicts.length ? restoreConflicts.slice(0, 8).join("、") : "无"}</span>
          <button className="primary" disabled={busy} onClick={() => void confirmRestore()}>确认恢复导入</button>
          <button disabled={busy} onClick={() => { setRestoreToken(""); setRestoreConflicts([]); }}>取消</button>
        </div>
      )}
      {backups.length > 0 && (
        <ul className="cloud-backup-list">
          {backups.map((backup) => (
            <li key={backup.name}>
              <span className="cloud-backup-name" title={backup.name}>{backup.name}</span>
              <span className="cloud-backup-meta">{(backup.size / 1024 / 1024).toFixed(2)} MB · {backup.lastmod ? new Date(backup.lastmod).toLocaleString() : ""}</span>
              <button disabled={busy || !!restoreToken} onClick={() => void restore(backup.name)}>恢复</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}