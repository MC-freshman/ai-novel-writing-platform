import { useCallback, useRef } from "react";
import { type Editor } from "@tiptap/react";
import type { PageSaveHandle, PageSaveKind } from "../hooks/useEntityDraft";

export function useAppRefs() {
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const richEditorRef = useRef<Editor | null>(null);

  const workspaceRef = useRef<HTMLElement | null>(null);

  const chapterLoadRequestRef = useRef(0);

  const savePromiseRef = useRef<Promise<boolean> | null>(null);

  const closingRef = useRef(false);

  const pageSaversRef = useRef(new Map<PageSaveKind, PageSaveHandle>());

  const registerPageSave = useCallback(
    (kind: PageSaveKind, handle: PageSaveHandle | null) => {
      if (handle) pageSaversRef.current.set(kind, handle);
      else pageSaversRef.current.delete(kind);
    },
    [],
  );

  const handleRichEditorReady = useCallback((editor: Editor | null) => {
    richEditorRef.current = editor;
  }, []);

  return {
    editorRef,
    richEditorRef,
    workspaceRef,
    chapterLoadRequestRef,
    savePromiseRef,
    closingRef,
    pageSaversRef,
    registerPageSave,
    handleRichEditorReady,
  };
}

export type AppRefs = ReturnType<typeof useAppRefs>;
