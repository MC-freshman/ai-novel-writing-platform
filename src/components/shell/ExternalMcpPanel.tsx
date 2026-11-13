// 外部 MCP 接入面板（P81）：发现/校验外部 MCP 服务目录，生成客户端配置，只读连接自检。
// 设置保存在应用级偏好（app-preferences.json），与项目设置相互独立。
import { useEffect, useState } from "react";
import type { McpClientConfig, McpIntegrationStatus, McpRuntimeKind, McpSelfTestReport } from "../../types";
import { getErrorMessage } from "../../lib/text-utils";
import { InlineFeedback } from "../ui/InlineFeedback";

type BusyKind = "" | "load" | "pick" | "save" | "config" | "test";

export function ExternalMcpPanel() {
  const [status, setStatus] = useState<McpIntegrationStatus | null>(null);
  const [directory, setDirectory] = useState("");
  const [runtimeKind, setRuntimeKind] = useState<McpRuntimeKind>("auto");
  const [xmindImportRoot, setXmindImportRoot] = useState("");
  const [busy, setBusy] = useState<BusyKind>("load");
  const [feedback, setFeedback] = useState<{ tone: "error" | "warning" | "info"; message: string } | null>(null);
  const [clientConfig, setClientConfig] = useState<McpClientConfig | null>(null);
  const [testReport, setTestReport] = useState<McpSelfTestReport | null>(null);
  const [copyHint, setCopyHint] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.novelAPI.getMcpIntegrationStatus();
        if (!active) return;
        setStatus(next);
        setDirectory(next.settings.mcpDirectory);
        setRuntimeKind(next.settings.runtimeKind);
        setXmindImportRoot(next.settings.xmindImportRoot);
      } catch (error) {
        if (active) setFeedback({ tone: "error", message: `读取外部接入状态失败：${getErrorMessage(error)}` });
      } finally {
        if (active) setBusy("");
      }
    })();
    return () => { active = false; };
  }, []);

  const savedDirectory = status?.settings.mcpDirectory || "";
  const dirty = directory !== savedDirectory || runtimeKind !== (status?.settings.runtimeKind || "auto") || xmindImportRoot !== (status?.settings.xmindImportRoot || "");

  async function pickDirectory() {
    setBusy("pick");
    setFeedback(null);
    try {
      const picked = await window.novelAPI.pickMcpServerDirectory();
      if (picked.canceled || !picked.directory) return;
      setDirectory(picked.directory);
      setFeedback(picked.server?.ok
        ? { tone: "info", message: `已识别：${picked.server.displayName} ${picked.server.version}（保存设置后生效）` }
        : { tone: "error", message: picked.server?.error || "目录校验失败" });
    } catch (error) {
      setFeedback({ tone: "error", message: `选择目录失败：${getErrorMessage(error)}` });
    } finally {
      setBusy("");
    }
  }

  async function saveSettings() {
    setBusy("save");
    setFeedback(null);
    try {
      const next = await window.novelAPI.saveMcpSettings({ mcpDirectory: directory, runtimeKind, xmindImportRoot });
      setStatus(next);
      setClientConfig(null);
      setTestReport(null);
      setFeedback({ tone: "info", message: "外部接入设置已保存。" });
    } catch (error) {
      setFeedback({ tone: "error", message: `保存失败：${getErrorMessage(error)}` });
    } finally {
      setBusy("");
    }
  }

  async function buildConfig() {
    setBusy("config");
    setFeedback(null);
    setCopyHint("");
    try {
      const next = await window.novelAPI.buildMcpClientConfig();
      setClientConfig(next);
    } catch (error) {
      setFeedback({ tone: "error", message: `生成配置失败：${getErrorMessage(error)}` });
    } finally {
      setBusy("");
    }
  }

  async function copyConfig() {
    if (!clientConfig) return;
    try {
      await navigator.clipboard.writeText(clientConfig.configJson);
      setCopyHint("已复制，可粘贴到 Claude Desktop / Qoder 等客户端的 MCP 配置中。");
    } catch {
      setCopyHint("自动复制不可用：请手动全选下方文本后按 Ctrl+C。");
    }
  }

  async function runSelfTest() {
    setBusy("test");
    setFeedback(null);
    setTestReport(null);
    try {
      const report = await window.novelAPI.selfTestMcp();
      setTestReport(report);
      if (!report.ok) setFeedback({ tone: "warning", message: "自检未全部通过，请查看下方步骤明细。" });
    } catch (error) {
      setFeedback({ tone: "error", message: `自检失败：${getErrorMessage(error)}` });
    } finally {
      setBusy("");
    }
  }

  const server = status?.server;
  return (
    <div className="mcp-panel">
      <p>把自研或外部 MCP 服务接入本小说项目：平台只负责发现目录、生成客户端配置与只读自检，不复制也不修改外部服务。外部客户端将能读取当前项目内容；其写入工具需两步确认。桌面端与外部客户端同时使用时，请把项目视为单写者，外部写入后在规划页点「刷新规划数据」。本页设置独立于项目设置保存。</p>
      <label>
        MCP 服务目录（软件库根目录或版本目录）
        <span className="mcp-dir-row">
          <input readOnly value={directory} placeholder="例如包含 current.json 的软件库目录，或含 manifest.json 的版本目录" />
          <button disabled={busy !== ""} onClick={() => void pickDirectory()}>选择目录…</button>
        </span>
      </label>
      {directory && server && (server.ok
        ? <p className="settings-security-status">已识别：{server.displayName} {server.version} · 入口 {server.entryPath}</p>
        : <InlineFeedback tone="error" message={server.error || "目录校验失败"} />)}
      <label>
        运行时
        <select value={runtimeKind} onChange={(event) => setRuntimeKind(event.target.value as McpRuntimeKind)}>
          <option value="auto">自动（优先系统 Node）</option>
          <option value="node">系统 Node</option>
          <option value="electron">应用自带运行时（ELECTRON_RUN_AS_NODE）</option>
        </select>
        {status && <span className="mcp-meta">当前探测：{status.runtime.kind === "node" ? `系统 Node ${status.runtime.version}` : `应用运行时 Node ${status.runtime.version}`}</span>}
      </label>
      <label>
        XMind 导入限制目录（可选）
        <input value={xmindImportRoot} onChange={(event) => setXmindImportRoot(event.target.value)} placeholder="留空则不限制；填写后外部导入只能读取该目录内的 .xmind" />
      </label>
      <div className="settings-security-actions">
        <button className="primary" disabled={busy !== "" || !dirty} onClick={() => void saveSettings()}>{busy === "save" ? "保存中..." : "保存设置"}</button>
        <button disabled={busy !== "" || !savedDirectory} onClick={() => void buildConfig()}>生成客户端配置</button>
        <button disabled={busy !== "" || !savedDirectory} onClick={() => void runSelfTest()}>{busy === "test" ? "自检中..." : "连接自检（只读）"}</button>
      </div>
      {feedback && <InlineFeedback tone={feedback.tone} message={feedback.message} />}
      {dirty && savedDirectory && <p className="mcp-meta">提示：「生成客户端配置」与「连接自检」使用已保存的设置；修改后请先保存。</p>}
      {clientConfig && (
        <div className="mcp-config-block">
          <textarea className="mcp-config-textarea" readOnly value={clientConfig.configJson} aria-label="MCP 客户端配置 JSON" onFocus={(event) => event.currentTarget.select()} />
          <div className="settings-security-actions">
            <button onClick={() => void copyConfig()}>复制配置</button>
            {copyHint && <span className="settings-security-status">{copyHint}</span>}
          </div>
          <ul className="mcp-notes">{clientConfig.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </div>
      )}
      {testReport && (
        <ul className="mcp-steps" aria-label="连接自检结果">
          {testReport.steps.map((step) => (
            <li key={step.name} data-ok={step.ok ? "true" : "false"}>
              <strong>{step.ok ? "通过" : "未通过"} · {step.name}</strong>
              {step.detail && <span>{step.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {status && (
        <p className="mcp-meta">当前项目：{status.projectPath || "未打开"} · 应用根目录：{status.appRoot} · {status.packaged ? "打包版（配置将附带 electron 占位模块路径）" : "源码版"}</p>
      )}
    </div>
  );
}