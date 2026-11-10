export function InlineFeedback({
  title,
  message,
  actionLabel,
  onAction,
  tone = "error",
  className = "",
}: {
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "error" | "warning" | "info";
  className?: string;
}) {
  return (
    <div
      className={`inline-feedback ${className}`.trim()}
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
    >
      {title && <strong>{title}</strong>}
      <span>{message}</span>
      {actionLabel && onAction && <button onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}
