// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { Extension } from "@tiptap/react";
import { Table } from "@tiptap/extension-table";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import Image from "@tiptap/extension-image";
import type { Editor } from "@tiptap/react";
import { isHtmlContent, contentToHtml } from "./text-utils";

export function buildRichTextIndex(editor: Editor) {
  const chars: string[] = [];
  const positions: Array<number | null> = [];
  let previousTextEnd = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    if (previousTextEnd >= 0 && pos > previousTextEnd) {
      chars.push("\n");
      positions.push(null);
    }
    for (let index = 0; index < node.text.length; index += 1) {
      chars.push(node.text[index]);
      positions.push(pos + index);
    }
    previousTextEnd = pos + node.text.length;
    return true;
  });
  return { text: chars.join(""), positions };
}

export function textOffsetFromDocPos(positions: Array<number | null>, docPos: number) {
  const offset = positions.findIndex((position) => typeof position === "number" && position >= docPos);
  return offset < 0 ? positions.length : offset;
}

export function scrollRichSelectionIntoView(editor: Editor, from: number) {
  window.requestAnimationFrame(() => {
    try {
      const shell = editor.view.dom.closest(".rich-page-shell") as HTMLElement | null;
      if (!shell) return;
      const coords = editor.view.coordsAtPos(from);
      const rect = shell.getBoundingClientRect();
      shell.scrollTop += coords.top - rect.top - shell.clientHeight * 0.4;
    } catch {
      editor.view.dom.scrollIntoView({ block: "nearest" });
    }
  });
}

export function findNextInRichEditor(editor: Editor, query: string) {
  const index = buildRichTextIndex(editor);
  const needle = query.toLowerCase();
  const haystack = index.text.toLowerCase();
  const startOffset = textOffsetFromDocPos(index.positions, editor.state.selection.to);
  let found = haystack.indexOf(needle, startOffset);
  let wrapped = false;
  if (found < 0 && startOffset > 0) {
    found = haystack.indexOf(needle, 0);
    wrapped = true;
  }
  const from = index.positions[found];
  const last = index.positions[found + query.length - 1];
  if (found < 0 || typeof from !== "number" || typeof last !== "number") return { found: false, wrapped, selectedText: "" };
  const to = last + 1;
  editor.commands.setTextSelection({ from, to });
  editor.commands.focus();
  scrollRichSelectionIntoView(editor, from);
  return { found: true, wrapped, selectedText: index.text.slice(found, found + query.length) };
}

export function replaceAllInRichEditor(editor: Editor, query: string, replacement: string) {
  const index = buildRichTextIndex(editor);
  const needle = query.toLowerCase();
  const haystack = index.text.toLowerCase();
  const matches: Array<{ from: number; to: number }> = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found < 0) break;
    const from = index.positions[found];
    const last = index.positions[found + query.length - 1];
    if (typeof from !== "number" || typeof last !== "number") {
      cursor = found + Math.max(1, query.length);
      continue;
    }
    matches.push({
      from,
      to: last + 1,
    });
    cursor = found + Math.max(1, query.length);
  }
  if (!matches.length) return 0;
  let transaction = editor.state.tr;
  for (const range of matches.slice().reverse()) {
    transaction = replacement ? transaction.insertText(replacement, range.from, range.to) : transaction.delete(range.from, range.to);
  }
  editor.view.dispatch(transaction);
  const first = matches[0];
  editor.commands.setTextSelection({ from: first.from, to: first.from + replacement.length });
  editor.commands.focus();
  scrollRichSelectionIntoView(editor, first.from);
  return matches.length;
}

export function moveCurrentTopLevelBlock(editor: Editor, direction: -1 | 1) {
  const blocks: Array<{ pos: number; node: Editor["state"]["doc"] }> = [];
  editor.state.doc.forEach((node, offset) => blocks.push({ pos: offset, node: node as Editor["state"]["doc"] }));
  const selectionPos = editor.state.selection.from;
  const currentIndex = blocks.findIndex((item) => selectionPos >= item.pos && selectionPos <= item.pos + item.node.nodeSize);
  const targetIndex = currentIndex + direction;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= blocks.length) return false;
  const firstIndex = Math.min(currentIndex, targetIndex);
  const secondIndex = Math.max(currentIndex, targetIndex);
  const first = blocks[firstIndex];
  const second = blocks[secondIndex];
  const replacement = direction < 0 ? [second.node, first.node] : [second.node, first.node];
  const transaction = editor.state.tr.replaceWith(first.pos, second.pos + second.node.nodeSize, replacement);
  const nextPos = direction < 0 ? first.pos + 1 : first.pos + second.node.nodeSize + 1;
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(transaction.doc.content.size, nextPos))));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.commands.focus();
  return true;
}

export function changeHeadingLevel(content: string, headingLineOrIndex: number, nextLevel: number) {
  const level = Math.min(6, Math.max(1, Math.floor(nextLevel)));
  if (isHtmlContent(content)) {
    const doc = new DOMParser().parseFromString(contentToHtml(content || ""), "text/html");
    const headings = Array.from(doc.body.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    const target = headings[headingLineOrIndex] as HTMLElement | undefined;
    if (!target) return content;
    const replacement = doc.createElement(`h${level}`);
    replacement.innerHTML = target.innerHTML;
    Array.from(target.attributes).forEach((attribute) => {
      if (attribute.name === "class" || attribute.name.startsWith("data-")) return;
      replacement.setAttribute(attribute.name, attribute.value);
    });
    target.replaceWith(replacement);
    return doc.body.innerHTML;
  }

  const lines = content.split(/\r?\n/);
  const line = lines[headingLineOrIndex];
  const match = line?.match(/^(#{1,6})(\s+)(.+?)\s*$/);
  if (!match) return content;
  lines[headingLineOrIndex] = `${"#".repeat(level)} ${match[3].trim()}`;
  return lines.join("\n");
}

export function promoteMarkdownHeadingsInHtml(html: string) {
  const doc = new DOMParser().parseFromString(html || "<p></p>", "text/html");
  doc.body.querySelectorAll("p,div").forEach((element) => {
    if (element.querySelector("img,table,ul,ol,blockquote")) return;
    const text = element.textContent?.replace(/\s+/g, " ").trim() || "";
    const match = text.match(/^(#{1,6})\s+(.+)$/);
    if (!match) return;
    const heading = doc.createElement(`h${match[1].length}`);
    heading.textContent = match[2].trim();
    element.replaceWith(heading);
  });
  return doc.body.innerHTML;
}

export function makeHeadingFoldKey(level: number, title: string, index: number) {
  return `${level}:${index}:${title.replace(/\s+/g, " ").trim().slice(0, 120)}`;
}

export const CollapsibleHeadings = Extension.create<Record<string, never>, { folded: Set<string> }>({
  name: "collapsibleHeadings",

  addStorage() {
    return {
      folded: new Set<string>(),
    };
  },

  addProseMirrorPlugins() {
    const extension = this;
    return [
      new Plugin({
        key: new PluginKey("collapsibleHeadings"),
        props: {
          decorations(state) {
            const headings: Array<{ pos: number; size: number; level: number; key: string }> = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "heading") return true;
              const level = Number(node.attrs.level || 1);
              const key = makeHeadingFoldKey(level, node.textContent || "", headings.length);
              headings.push({ pos, size: node.nodeSize, level, key });
              return false;
            });

            if (!headings.length) return DecorationSet.empty;

            const ranges: Array<{ from: number; to: number; key: string }> = [];
            headings.forEach((heading, index) => {
              if (!extension.storage.folded.has(heading.key)) return;
              const nextPeer = headings.slice(index + 1).find((item) => item.level <= heading.level);
              const from = heading.pos + heading.size;
              const to = nextPeer ? nextPeer.pos : state.doc.content.size;
              if (to > from) ranges.push({ from, to, key: heading.key });
            });

            const isHidden = (pos: number) => ranges.some((range) => pos >= range.from && pos < range.to);
            const decorations = headings.flatMap((heading) => {
              if (isHidden(heading.pos)) return [];
              const folded = extension.storage.folded.has(heading.key);
              const button = Decoration.widget(
                heading.pos + 1,
                () => {
                  const element = document.createElement("button");
                  element.type = "button";
                  element.className = `heading-fold-button ${folded ? "folded" : ""}`;
                  element.dataset.foldKey = heading.key;
                  element.contentEditable = "false";
                  element.title = folded ? "展开这一节" : "折叠这一节";
                  element.textContent = folded ? "▸" : "▾";
                  return element;
                },
                { key: `fold-${heading.key}-${folded ? "closed" : "open"}`, side: -1 },
              );
              const stateClass = folded ? Decoration.node(heading.pos, heading.pos + heading.size, { class: "is-folded-heading" }) : null;
              return stateClass ? [stateClass, button] : [button];
            });

            state.doc.descendants((node, pos, parent) => {
              if (parent !== state.doc || !isHidden(pos)) return true;
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "is-folded-block" }, { key: `hidden-${pos}` }));
              return false;
            });

            return DecorationSet.create(state.doc, decorations);
          },
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;
              const button = target?.closest(".heading-fold-button") as HTMLButtonElement | null;
              if (!button) return false;
              event.preventDefault();
              const key = button.dataset.foldKey;
              if (!key) return true;
              if (extension.storage.folded.has(key)) {
                extension.storage.folded.delete(key);
              } else {
                extension.storage.folded.add(key);
              }
              view.dispatch(view.state.tr.setMeta("collapsibleHeadings", Date.now()));
              return true;
            },
          },
        },
      }),
    ];
  },
});

export interface InlineReviewItem {
  id: string;
  kind: "annotation" | "revision";
  quote: string;
  label: string;
  status: string;
}

export const inlineReviewPluginKey = new PluginKey<{ items: InlineReviewItem[]; decorations: DecorationSet }>("inlineReviews");
export function buildReviewTextIndex(doc: Editor["state"]["doc"]) {
  const chars: string[] = [];
  const positions: Array<number | null> = [];
  let previousEnd = -1;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    if (previousEnd >= 0 && pos > previousEnd) {
      chars.push("\n");
      positions.push(null);
    }
    for (let index = 0; index < node.text.length; index += 1) {
      chars.push(node.text[index]);
      positions.push(pos + index);
    }
    previousEnd = pos + node.text.length;
    return true;
  });
  const normalized: string[] = [];
  const normalizedPositions: Array<number | null> = [];
  let inWhitespace = false;
  chars.forEach((char, index) => {
    if (/\s/.test(char)) {
      if (!inWhitespace && normalized.length) {
        normalized.push(" ");
        normalizedPositions.push(positions[index]);
      }
      inWhitespace = true;
      return;
    }
    inWhitespace = false;
    normalized.push(char);
    normalizedPositions.push(positions[index]);
  });
  return { text: normalized.join("").trim(), positions: normalizedPositions };
}

export function buildInlineReviewDecorations(doc: Editor["state"]["doc"], items: InlineReviewItem[]) {
  if (!items.length) return DecorationSet.empty;
  const index = buildReviewTextIndex(doc);
  const decorations: Decoration[] = [];
  items.forEach((item) => {
    const quote = item.quote.replace(/\s+/g, " ").trim();
    if (!quote) return;
    const offset = index.text.indexOf(quote);
    if (offset < 0) return;
    const from = index.positions[offset];
    const last = index.positions[offset + quote.length - 1];
    if (typeof from !== "number" || typeof last !== "number" || last < from) return;
    decorations.push(Decoration.inline(from, last + 1, {
      class: `inline-review inline-review-${item.kind}`,
      "data-review-id": item.id,
      title: `${item.status}：${item.label}`,
    }));
  });
  return DecorationSet.create(doc, decorations);
}

export const InlineReviews = Extension.create({
  name: "inlineReviews",
  addProseMirrorPlugins() {
    return [new Plugin<{ items: InlineReviewItem[]; decorations: DecorationSet }>({
      key: inlineReviewPluginKey,
      state: {
        init: () => ({ items: [] as InlineReviewItem[], decorations: DecorationSet.empty }),
        apply(transaction, current, _oldState, nextState) {
          const nextItems = transaction.getMeta(inlineReviewPluginKey) as InlineReviewItem[] | undefined;
          const items = nextItems || current.items;
          if (!transaction.docChanged && !nextItems) return current;
          return { items, decorations: buildInlineReviewDecorations(nextState.doc, items) };
        },
      },
      props: {
        decorations(state) {
          return inlineReviewPluginKey.getState(state)?.decorations || DecorationSet.empty;
        },
      },
    })];
  },
});

export const DocxImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: (element) => element.getAttribute("data-docx-width") || element.getAttribute("width"), renderHTML: (attributes) => attributes.width ? { width: attributes.width, "data-docx-width": attributes.width } : {} },
      height: { default: null, parseHTML: (element) => element.getAttribute("data-docx-height") || element.getAttribute("height"), renderHTML: (attributes) => attributes.height ? { height: attributes.height, "data-docx-height": attributes.height } : {} },
      docxPosition: { default: "inline", parseHTML: (element) => element.getAttribute("data-docx-position") || "inline", renderHTML: (attributes) => ({ "data-docx-position": attributes.docxPosition || "inline" }) },
      docxAlign: { default: "center", parseHTML: (element) => element.getAttribute("data-docx-align") || "center", renderHTML: (attributes) => ({ "data-docx-align": attributes.docxAlign || "center" }) },
    };
  },
});

export const DocxTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      docxWidth: { default: 100, parseHTML: (element) => Number(element.getAttribute("data-docx-width") || 100), renderHTML: (attributes) => ({ "data-docx-width": attributes.docxWidth || 100, style: `width:${attributes.docxWidth || 100}%` }) },
    };
  },
});
