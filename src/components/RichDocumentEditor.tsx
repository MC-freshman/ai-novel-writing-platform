// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import type { Editor } from "@tiptap/react";
import type { EditorScrollAnchor } from "../types";
import type { InlineReviewItem } from "../lib/editor-ops";
import { contentToHtml } from "../lib/text-utils";
import { CollapsibleHeadings, inlineReviewPluginKey, InlineReviews, DocxImage, DocxTable } from "../lib/editor-ops";
import { RichEditorToolbar } from "./RichEditorToolbar";

export function RichDocumentEditor({
  documentId,
  value,
  fontSize,
  lineHeight,
  scrollAnchor,
  reviews,
  onChange,
  onSelection,
  onContextMenu,
  onReady,
  onOpenReview,
}: {
  documentId: string;
  value: string;
  fontSize: number;
  lineHeight: number;
  scrollAnchor: EditorScrollAnchor | null;
  reviews: InlineReviewItem[];
  onChange: (documentId: string, value: string) => void;
  onSelection: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onReady?: (editor: Editor | null) => void;
  onOpenReview: (review: InlineReviewItem) => void;
}) {
  const lastHtmlRef = useRef("");
  const onChangeRef = useRef(onChange);
  const [activeReviewId, setActiveReviewId] = useState("");
  const activeReview = reviews.find((item) => item.id === activeReviewId) || null;
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
        Underline,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        DocxImage.configure({ allowBase64: true, inline: false }),
        DocxTable.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        CollapsibleHeadings,
        InlineReviews,
      ],
      content: contentToHtml(value || "<p></p>"),
      editorProps: {
        attributes: {
          class: "rich-document-page",
          spellcheck: "false",
        },
        handleDOMEvents: {
          mouseup() {
            window.setTimeout(onSelection, 0);
            return false;
          },
          keyup() {
            window.setTimeout(onSelection, 0);
            return false;
          },
        },
      },
      onUpdate({ editor }) {
        const next = editor.getHTML();
        lastHtmlRef.current = next;
        onChangeRef.current(documentId, next);
      },
    },
    [],
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onReady?.(editor);
    return () => onReady?.(null);
  }, [editor, onReady]);

  useEffect(() => {
    if (!editor) return;
    const next = contentToHtml(value || "<p></p>");
    if (lastHtmlRef.current === value || editor.getHTML() === next) return;
    editor.commands.setContent(next, { emitUpdate: false });
    lastHtmlRef.current = next;
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(inlineReviewPluginKey, reviews));
    if (activeReviewId && !reviews.some((item) => item.id === activeReviewId)) setActiveReviewId("");
  }, [activeReviewId, editor, reviews]);

  useEffect(() => {
    if (!editor || !scrollAnchor) return;
    let target: HTMLElement | undefined;
    if (scrollAnchor.quote) {
      const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
      const needle = normalize(scrollAnchor.quote).slice(0, 120);
      const blocks = Array.from(editor.view.dom.querySelectorAll<HTMLElement>("p,li,td,th,blockquote,h1,h2,h3,h4,h5,h6"));
      target = blocks.find((item) => normalize(item.textContent || "").includes(needle));
    }
    if (!target && typeof scrollAnchor.headingIndex === "number") {
      target = editor.view.dom.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")[scrollAnchor.headingIndex];
    }
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    try {
      const from = editor.view.posAtDOM(target, 0);
      const length = Math.min(String(target.textContent || "").length, 160);
      editor.commands.setTextSelection({ from, to: Math.min(editor.state.doc.content.size, from + length) });
      editor.commands.focus();
    } catch {
      target.focus();
    }
  }, [editor, scrollAnchor]);

  return (
    <article
      className="rich-document-editor"
      onContextMenu={onContextMenu}
      onClick={(event) => {
        const marker = (event.target as HTMLElement).closest<HTMLElement>("[data-review-id]");
        if (marker?.dataset.reviewId) setActiveReviewId(marker.dataset.reviewId);
      }}
    >
      <RichEditorToolbar editor={editor} />
      {activeReview && <div className={`inline-review-popover ${activeReview.kind}`}><div><strong>{activeReview.kind === "revision" ? "待确认修订" : "正文批注"}</strong><span>{activeReview.status}</span><p>{activeReview.label}</p></div><button onClick={() => onOpenReview(activeReview)}>查看处理</button><button title="关闭" onClick={() => setActiveReviewId("")}><X size={14} /></button></div>}
      <div className="rich-page-shell" style={{ fontSize: `${fontSize}px`, lineHeight }}>
        <EditorContent editor={editor} />
      </div>
    </article>
  );
}
