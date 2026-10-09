// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, Italic, List, ListOrdered, Minus, Quote, Redo2, Table2, Underline as UnderlineIcon, Undo2 } from "lucide-react";
import type { Editor } from "@tiptap/react";
import type { Chapter } from "../types";
import { scrollRichSelectionIntoView, moveCurrentTopLevelBlock } from "../lib/editor-ops";

export function RichEditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="rich-editor-toolbar" />;
  const activeEditor: Editor = editor;
  const headingValue = activeEditor.isActive("heading", { level: 1 })
    ? "h1"
    : activeEditor.isActive("heading", { level: 2 })
      ? "h2"
      : activeEditor.isActive("heading", { level: 3 })
        ? "h3"
        : activeEditor.isActive("heading", { level: 4 })
          ? "h4"
          : activeEditor.isActive("heading", { level: 5 })
            ? "h5"
            : activeEditor.isActive("heading", { level: 6 })
              ? "h6"
              : "paragraph";
  const headings: Array<{ pos: number; label: string }> = [];
  activeEditor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") headings.push({ pos, label: `${"　".repeat(Math.max(0, Number(node.attrs.level || 1) - 1))}${node.textContent || "未命名标题"}` });
    return true;
  });

  function run(command: () => void) {
    return (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      command();
    };
  }

  function applyBlock(value: string) {
    if (value === "paragraph") {
      activeEditor.chain().focus().setParagraph().run();
      return;
    }
    const level = Number(value.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
    activeEditor.chain().focus().toggleHeading({ level }).run();
  }

  return (
    <div className="rich-editor-toolbar" contentEditable={false}>
      <select title="段落样式" value={headingValue} onChange={(event) => applyBlock(event.target.value)}>
        <option value="paragraph">正文</option>
        <option value="h1">标题 1</option>
        <option value="h2">标题 2</option>
        <option value="h3">标题 3</option>
        <option value="h4">标题 4</option>
        <option value="h5">标题 5</option>
        <option value="h6">标题 6</option>
      </select>
      <select title="跳转到文档标题" value="" onChange={(event) => { const pos = Number(event.target.value); if (!Number.isFinite(pos)) return; activeEditor.commands.setTextSelection(pos + 1); activeEditor.commands.focus(); scrollRichSelectionIntoView(activeEditor, pos + 1); }}>
        <option value="">章节导航</option>
        {headings.map((item) => <option key={`${item.pos}-${item.label}`} value={item.pos}>{item.label}</option>)}
      </select>
      <button title="粗体" className={activeEditor.isActive("bold") ? "active" : ""} onClick={run(() => activeEditor.chain().focus().toggleBold().run())}>
        <Bold size={17} />
      </button>
      <button title="斜体" className={activeEditor.isActive("italic") ? "active" : ""} onClick={run(() => activeEditor.chain().focus().toggleItalic().run())}>
        <Italic size={17} />
      </button>
      <button title="下划线" className={activeEditor.isActive("underline") ? "active" : ""} onClick={run(() => activeEditor.chain().focus().toggleUnderline().run())}>
        <UnderlineIcon size={17} />
      </button>
      <details className="rich-toolbar-more"><summary onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); const details = event.currentTarget.parentElement as HTMLDetailsElement; details.open = !details.open; } }}>排版</summary><div aria-label="更多排版工具">
      <button title="引用" className={activeEditor.isActive("blockquote") ? "active" : ""} onClick={run(() => activeEditor.chain().focus().toggleBlockquote().run())}>
        <Quote size={17} />
      </button>
      <span className="toolbar-divider" />
      <button title="项目列表" className={activeEditor.isActive("bulletList") ? "active" : ""} onClick={run(() => activeEditor.chain().focus().toggleBulletList().run())}>
        <List size={17} />
      </button>
      <button title="编号列表" className={activeEditor.isActive("orderedList") ? "active" : ""} onClick={run(() => activeEditor.chain().focus().toggleOrderedList().run())}>
        <ListOrdered size={17} />
      </button>
      <button title="插入场景分隔线" onClick={run(() => activeEditor.chain().focus().setHorizontalRule().run())}>
        <Minus size={17} />
      </button>
      <button title="当前段落上移" onClick={run(() => { moveCurrentTopLevelBlock(activeEditor, -1); })}>
        <ArrowUp size={17} />
      </button>
      <button title="当前段落下移" onClick={run(() => { moveCurrentTopLevelBlock(activeEditor, 1); })}>
        <ArrowDown size={17} />
      </button>
      <button title="左对齐" className={activeEditor.isActive({ textAlign: "left" }) ? "active" : ""} onClick={run(() => activeEditor.chain().focus().setTextAlign("left").run())}>
        <AlignLeft size={17} />
      </button>
      <button title="居中" className={activeEditor.isActive({ textAlign: "center" }) ? "active" : ""} onClick={run(() => activeEditor.chain().focus().setTextAlign("center").run())}>
        <AlignCenter size={17} />
      </button>
      <button title="右对齐" className={activeEditor.isActive({ textAlign: "right" }) ? "active" : ""} onClick={run(() => activeEditor.chain().focus().setTextAlign("right").run())}>
        <AlignRight size={17} />
      </button>
      <span className="toolbar-divider" />
      <button title="插入表格" onClick={run(() => activeEditor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>
        <Table2 size={17} />
      </button>
      {activeEditor.isActive("table") && (
        <>
          <button title="增加一行" onClick={run(() => activeEditor.chain().focus().addRowAfter().run())}>
            行+
          </button>
          <button title="增加一列" onClick={run(() => activeEditor.chain().focus().addColumnAfter().run())}>
            列+
          </button>
          <button title="删除表格" onClick={run(() => activeEditor.chain().focus().deleteTable().run())}>
            删表
          </button>
        </>
      )}
      </div></details>
      <span className="toolbar-divider" />
      <button title="撤销" disabled={!activeEditor.can().chain().focus().undo().run()} onClick={run(() => activeEditor.chain().focus().undo().run())}>
        <Undo2 size={17} />
      </button>
      <button title="重做" disabled={!activeEditor.can().chain().focus().redo().run()} onClick={run(() => activeEditor.chain().focus().redo().run())}>
        <Redo2 size={17} />
      </button>
    </div>
  );
}
