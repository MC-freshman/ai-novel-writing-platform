import { useAppBindings } from "./bindings";
import { useAppRefs } from "./refs";
import { useAppLifecycle } from "./lifecycle";
import { useAppSaving } from "./saving";
import { useAppLayout } from "./layout";
import { useAppRecovery } from "./recovery";
import { useAppChapters } from "./chapters";
import { useAppProjects } from "./projects";
import { useAppEntities } from "./entities";
import { useAppChat } from "./chat";
import { useAppEditor } from "./editor";
import { useAppEffects } from "./effects";

/**
 * Composes the app domain hooks in dependency order and returns the merged
 * controller surface. App.tsx consumes this as its single state source; the
 * ordering below is load-bearing and must not be reordered.
 */
export function useAppController() {
  const bindings = useAppBindings();
  const refs = useAppRefs();
  const lifecycle = useAppLifecycle({ ...bindings, ...refs });
  const savingController = useAppSaving({ ...bindings, ...refs, ...lifecycle });
  const layout = useAppLayout({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
  });
  const recovery = useAppRecovery({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
  });
  const chapters = useAppChapters({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
  });
  const projects = useAppProjects({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
    ...chapters,
  });
  const entities = useAppEntities({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
    ...chapters,
    ...projects,
  });
  const chat = useAppChat({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
    ...chapters,
    ...projects,
    ...entities,
  });
  const editor = useAppEditor({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
    ...chapters,
    ...projects,
    ...entities,
    ...chat,
  });
  useAppEffects({
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
    ...chapters,
    ...projects,
    ...entities,
    ...chat,
    ...editor,
  });
  return {
    ...bindings,
    ...refs,
    ...lifecycle,
    ...savingController,
    ...layout,
    ...recovery,
    ...chapters,
    ...projects,
    ...entities,
    ...chat,
    ...editor,
  };
}
