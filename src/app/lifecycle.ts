import { useCallback } from "react";
import { applyProjectState } from "../stores/app-stores";
import type { AppState } from "../types";
import type { AppContext } from "./context";

export function useAppLifecycle(
  context: Pick<
    AppContext,
    | "chapterLoadRequestRef"
    | "savePromiseRef"
    | "setDirty"
    | "setStatus"
    | "stores"
  >,
) {
  const { chapterLoadRequestRef, savePromiseRef, setDirty, setStatus, stores } =
    context;
  const applyAppState = useCallback(
    (nextState: AppState) => {
      chapterLoadRequestRef.current += 1;
      const oldRequest = stores.chat.store.getState().activeAiRequestId;
      if (
        stores.project.store.getState().state?.projectPath !==
        nextState.projectPath
      ) {
        savePromiseRef.current = null;
        if (oldRequest)
          void window.novelAPI.cancelAI(oldRequest).catch(() => null);
      }
      applyProjectState(stores, nextState);
      document.documentElement.dataset.theme = nextState.config.ui.theme;
      setDirty(false);
      setStatus(`已打开：${nextState.config.title}`);
    },
    [chapterLoadRequestRef, savePromiseRef, setDirty, setStatus, stores],
  );

  return { applyAppState };
}
