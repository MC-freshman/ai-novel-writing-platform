// Extracted from src/App.tsx by the P3 refactor (cut-paste, no logic changes).
import { useEffect, useRef } from "react";

export function useDialogFocus(
  onClose: () => void,
  enabled = true,
  shouldCloseOnEscape?: (event: KeyboardEvent) => boolean,
) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const escapeRef = useRef(shouldCloseOnEscape);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    escapeRef.current = shouldCloseOnEscape;
  }, [shouldCloseOnEscape]);
  useEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    window.requestAnimationFrame(() => dialog?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (escapeRef.current && !escapeRef.current(event)) return;
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
      ).filter((item) => item.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [enabled]);
  return dialogRef;
}
