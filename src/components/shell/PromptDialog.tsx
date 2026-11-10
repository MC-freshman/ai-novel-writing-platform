import { useEffect, useRef, useState, type RefObject } from "react";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import {
  registerAppPromptHost,
  type AppPromptRequest,
} from "../../lib/app-prompt";

export function PromptDialog() {
  const [current, setCurrent] = useState<AppPromptRequest | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const currentRef = useRef<AppPromptRequest | null>(null);
  const queueRef = useRef<AppPromptRequest[]>([]);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const closeRef = useRef<(value: string | null) => void>(() => {});

  useEffect(() => {
    const queue = queueRef.current;
    const unregister = registerAppPromptHost((request) => {
      if (currentRef.current) {
        queue.push(request);
        return;
      }
      currentRef.current = request;
      setCurrent(request);
    });
    return () => {
      unregister();
      currentRef.current?.resolve(null);
      queue.splice(0).forEach((request) => request.resolve(null));
      currentRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    setValue(current.defaultValue || "");
    setError("");
    const frame = window.requestAnimationFrame(() => {
      fieldRef.current?.focus();
      if (fieldRef.current instanceof HTMLInputElement) {
        fieldRef.current.select();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [current]);

  function close(result: string | null) {
    const active = currentRef.current;
    if (!active) return;
    active.resolve(result);
    const next = queueRef.current.shift() || null;
    currentRef.current = next;
    setCurrent(next);
    if (!next) {
      setValue("");
      setError("");
    }
  }
  closeRef.current = close;

  useEffect(() => {
    if (!current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [current]);

  const dialogRef = useDialogFocus(() => close(null), Boolean(current));
  if (!current) return null;

  function submit() {
    if (!current) return;
    if (!current.allowEmpty && !value.trim()) {
      setError("请输入内容。");
      fieldRef.current?.focus();
      return;
    }
    close(value);
  }

  return (
    <div className="modal-backdrop prompt-backdrop" onClick={() => close(null)}>
      <section
        ref={dialogRef}
        className="prompt-dialog modal-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-prompt-title"
        aria-describedby="app-prompt-message"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <strong id="app-prompt-title">{current.title || "输入"}</strong>
          <button
            type="button"
            aria-label="关闭输入弹窗"
            onClick={() => close(null)}
          >
            ×
          </button>
        </header>
        <p id="app-prompt-message">{current.message}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {current.multiline ? (
            <textarea
              ref={fieldRef as RefObject<HTMLTextAreaElement>}
              rows={4}
              value={value}
              placeholder={current.placeholder}
              aria-label={current.message}
              onChange={(event) => {
                setValue(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          ) : (
            <input
              ref={fieldRef as RefObject<HTMLInputElement>}
              value={value}
              placeholder={current.placeholder}
              aria-label={current.message}
              onChange={(event) => {
                setValue(event.target.value);
                setError("");
              }}
            />
          )}
          {error && (
            <p className="prompt-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button
              type="button"
              aria-label={current.cancelText || "取消"}
              onClick={() => close(null)}
            >
              {current.cancelText || "取消"}
            </button>
            <button
              type="submit"
              className="primary"
              aria-label={current.confirmText || "确定"}
            >
              {current.confirmText || "确定"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
