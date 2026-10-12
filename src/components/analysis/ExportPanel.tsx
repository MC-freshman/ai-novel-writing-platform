import { FileDown, Wand2 } from "lucide-react";
import { contentToPlainText } from "../../lib/text-utils";
import { ExperimentalTools } from ".././ExperimentalTools";
import type { AnalysisContext } from "./context";

export function ExportPanel(
  context: Pick<
    AnalysisContext,
    | "appearanceStats"
    | "busy"
    | "deleteMaterialItem"
    | "exportOptions"
    | "extractScope"
    | "loadAppearanceStats"
    | "loadMaterials"
    | "loadWorldMap"
    | "materialDraft"
    | "materials"
    | "onExportBook"
    | "onExportBookWithOptions"
    | "prepareWorldCandidates"
    | "saveMaterialDraft"
    | "saveSelectedCandidates"
    | "setExportOptions"
    | "setExtractScope"
    | "setMaterialDraft"
    | "setWorldCandidates"
    | "worldCandidates"
    | "worldMapEdges"
    | "worldMapNodes"
  >,
) {
  const {
    appearanceStats,
    busy,
    deleteMaterialItem,
    exportOptions,
    extractScope,
    loadAppearanceStats,
    loadMaterials,
    loadWorldMap,
    materialDraft,
    materials,
    onExportBook,
    onExportBookWithOptions,
    prepareWorldCandidates,
    saveMaterialDraft,
    saveSelectedCandidates,
    setExportOptions,
    setExtractScope,
    setMaterialDraft,
    setWorldCandidates,
    worldCandidates,
    worldMapEdges,
    worldMapNodes,
  } = context;

  return (
    <div className="analysis-section export-lab">
      <div className="tool-grid">
        <div className="tool-card">
          <FileDown size={22} />
          <strong>按文档批量导出 DOCX</strong>
          <label>
            <input
              type="checkbox"
              checked={exportOptions.includeOutline}
              onChange={(event) =>
                setExportOptions((value) => ({
                  ...value,
                  includeOutline: event.target.checked,
                }))
              }
            />
            带大纲
          </label>
          <label>
            <input
              type="checkbox"
              checked={exportOptions.includeMaterials}
              onChange={(event) =>
                setExportOptions((value) => ({
                  ...value,
                  includeMaterials: event.target.checked,
                }))
              }
            />
            带补充材料
          </label>
          <label>
            <input
              type="checkbox"
              checked={exportOptions.includeCharacters}
              onChange={(event) =>
                setExportOptions((value) => ({
                  ...value,
                  includeCharacters: event.target.checked,
                }))
              }
            />
            带角色卡
          </label>
          <label>
            <input
              type="checkbox"
              checked={exportOptions.includeWorld}
              onChange={(event) =>
                setExportOptions((value) => ({
                  ...value,
                  includeWorld: event.target.checked,
                }))
              }
            />
            带世界观资料
          </label>
          <button onClick={() => onExportBookWithOptions(exportOptions)}>
            按选项逐篇导出
          </button>
          <button onClick={() => onExportBook()}>只导出正文</button>
        </div>
        <div className="tool-card">
          <Wand2 size={22} />
          <strong>提取地点/势力/物品候选</strong>
          <select
            value={extractScope}
            onChange={(event) =>
              setExtractScope(event.target.value as "book" | "chapter")
            }
          >
            <option value="book">从全书提取</option>
            <option value="chapter">仅从当前文档提取</option>
          </select>
          <button
            onClick={() => void prepareWorldCandidates()}
            disabled={busy === "extract"}
          >
            生成候选
          </button>
          <span>候选会先显示在下方，勾选后才写入世界观。</span>
        </div>
      </div>
      {!!worldCandidates.length && (
        <div className="candidate-list">
          <div className="analysis-actions">
            <button
              onClick={() =>
                setWorldCandidates((items) =>
                  items.map((item) => ({ ...item, selected: true })),
                )
              }
            >
              全选
            </button>
            <button
              onClick={() =>
                setWorldCandidates((items) =>
                  items.map((item) => ({ ...item, selected: false })),
                )
              }
            >
              全不选
            </button>
            <button
              onClick={() => void saveSelectedCandidates()}
              disabled={busy === "save-candidates"}
            >
              写入选中条目
            </button>
          </div>
          {worldCandidates.map((candidate) => (
            <article key={candidate.id} className="candidate-card">
              <label>
                <input
                  type="checkbox"
                  checked={candidate.selected}
                  onChange={(event) =>
                    setWorldCandidates((items) =>
                      items.map((item) =>
                        item.id === candidate.id
                          ? { ...item, selected: event.target.checked }
                          : item,
                      ),
                    )
                  }
                />
                <strong>{candidate.title}</strong>
              </label>
              <span>
                {candidate.category} /{" "}
                {candidate.action === "merge"
                  ? `合并到：${candidate.matchedTitle}`
                  : "新建条目"}
              </span>
              <p>{contentToPlainText(candidate.content).slice(0, 180)}</p>
            </article>
          ))}
        </div>
      )}
      <details className="experimental-card">
        <summary>试验功能</summary>
        <ExperimentalTools
          appearanceStats={appearanceStats}
          worldMapNodes={worldMapNodes}
          worldMapEdges={worldMapEdges}
          materials={materials}
          materialDraft={materialDraft}
          onLoadAppearance={() => void loadAppearanceStats()}
          onLoadWorldMap={() => void loadWorldMap()}
          onLoadMaterials={() => void loadMaterials()}
          onMaterialDraft={setMaterialDraft}
          onSaveMaterial={() => void saveMaterialDraft()}
          onDeleteMaterial={(id) => void deleteMaterialItem(id)}
        />
      </details>
    </div>
  );
}
