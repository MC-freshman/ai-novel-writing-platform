import { Search } from "lucide-react";
import { sourceLabel } from "../../lib/text-utils";
import type { AnalysisContext } from "./context";

export function SearchPanel(
  context: Pick<
    AnalysisContext,
    | "busy"
    | "onOpenSource"
    | "query"
    | "runSearch"
    | "searchResults"
    | "setQuery"
  >,
) {
  const { busy, onOpenSource, query, runSearch, searchResults, setQuery } =
    context;

  return (
    <div className="analysis-section">
      <form
        className="analysis-search"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch();
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索章节、角色、世界观"
        />
        <button disabled={busy === "search"}>
          <Search size={16} />
          搜索
        </button>
      </form>
      <div className="search-results">
        {searchResults.map((result) => (
          <button
            key={result.id}
            className="search-result"
            onClick={() => onOpenSource(result)}
          >
            <strong>{result.title}</strong>
            <span>
              {sourceLabel(result.sourceType)}
              {result.volume
                ? ` / ${result.volume}`
                : result.category
                  ? ` / ${result.category}`
                  : ""}
            </span>
            <p>{result.snippet || "匹配标题或分类"}</p>
          </button>
        ))}
        {!searchResults.length && (
          <div className="analysis-empty">
            输入关键词后可搜索章节正文、角色卡片和世界观条目。
          </div>
        )}
      </div>
    </div>
  );
}
