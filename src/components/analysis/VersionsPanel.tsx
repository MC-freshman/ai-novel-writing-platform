import { RefreshCcw } from "lucide-react";
import { formatDateTime } from "../../lib/text-utils";
import type { AnalysisContext } from "./context";

export function VersionsPanel(
  context: Pick<
    AnalysisContext,
    | "busy"
    | "compareVersion"
    | "loadVersions"
    | "restoreVersion"
    | "selectedChapter"
    | "selectedChapterId"
    | "selectedVersionId"
    | "setSelectedVersionId"
    | "versionCompare"
    | "versions"
  >,
) {
  const {
    busy,
    compareVersion,
    loadVersions,
    restoreVersion,
    selectedChapter,
    selectedChapterId,
    selectedVersionId,
    setSelectedVersionId,
    versionCompare,
    versions,
  } = context;

  return (
    <div className="analysis-section">
      <div className="analysis-actions">
        <button
          onClick={() => void loadVersions()}
          disabled={!selectedChapterId || busy === "versions"}
        >
          <RefreshCcw size={16} />
          读取版本
        </button>
        <span>
          {selectedChapter
            ? `当前章节：${selectedChapter.title}`
            : "请选择一个章节"}
        </span>
      </div>
      <div className="version-tools">
        <select
          value={selectedVersionId}
          onChange={(event) => setSelectedVersionId(event.target.value)}
          disabled={!versions.length}
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {formatDateTime(version.createdAt)} / {version.wordCount} 字
            </option>
          ))}
        </select>
        <button
          onClick={() => void compareVersion()}
          disabled={!selectedVersionId || busy === "compare"}
        >
          对比当前版本
        </button>
        <button
          onClick={() => void restoreVersion()}
          disabled={!selectedVersionId || busy === "restore-version"}
        >
          恢复此版本
        </button>
      </div>
      {versionCompare ? (
        <div className="diff-view">
          <div className="diff-summary">
            <strong>
              {formatDateTime(versionCompare.version.createdAt)} 对比当前
            </strong>
            <span>
              新增 {versionCompare.added} 行 / 删除 {versionCompare.removed} 行
              {versionCompare.truncated ? " / 已截断显示" : ""}
            </span>
          </div>
          {versionCompare.diff.map((line, index) => (
            <p
              key={`${line.type}_${index}`}
              className={`diff-line ${line.type}`}
            >
              <span>
                {line.type === "added"
                  ? "+"
                  : line.type === "removed"
                    ? "-"
                    : " "}
              </span>
              {line.text}
            </p>
          ))}
        </div>
      ) : (
        <div className="analysis-empty">
          修改并保存章节后，软件会自动保留保存前版本；这里可以和当前内容对比。
        </div>
      )}
    </div>
  );
}
