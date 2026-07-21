import { useEffect, useId, useRef, type ReactNode } from "react";
import { Dialog } from "@gravity-ui/uikit";
import { useWorkspaceWindow } from "./useWorkspaceWindow";

export interface ArkenDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  applyLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  error?: string;
  footer?: boolean;
  /** A workspace window keeps the map available; confirmations stay modal. */
  variant?: "modal" | "workspace";
  className?: string;
  onApply?: () => void;
  onClose: () => void;
}

export function ArkenDialog({
  open,
  title,
  children,
  applyLabel = "Сохранить",
  cancelLabel = "Отмена",
  danger = false,
  loading = false,
  error,
  footer = true,
  variant = "modal",
  className,
  onApply,
  onClose,
}: ArkenDialogProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const {
    setWindowElement,
    position,
    zIndex,
    bringToFront,
    onDragStart,
    onDragMove,
    stopDragging,
    resetLayout,
  } = useWorkspaceWindow(open && variant === "workspace");

  useEffect(() => {
    if (!open || variant !== "workspace") return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previousFocus.current?.focus();
  }, [open, variant]);

  if (variant === "workspace") {
    if (!open) return null;
    return (
      <section
        ref={setWindowElement}
        className={["arken-workspace-window", className]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-labelledby={titleId}
        style={{
          ...(position ?? {}),
          zIndex,
        }}
        onPointerDown={bringToFront}
        onFocusCapture={bringToFront}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header className="arken-workspace-window__header">
          <div
            className="arken-workspace-window__drag-handle"
            role="group"
            aria-label={`Перетащить окно: ${title}`}
            title="Перетащить окно"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
          >
            <h2 id={titleId}>{title}</h2>
          </div>
          {position ? (
            <button
              type="button"
              className="arken-workspace-window__reset"
              onClick={resetLayout}
              aria-label="Сбросить расположение окна"
              title="Сбросить расположение окна"
            >
              ↺
            </button>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно"
          >
            ×
          </button>
        </header>
        <div className="arken-workspace-window__body">{children}</div>
        {footer ? (
          <div className="arken-workspace-window__footer">
            {error ? <div role="alert">{error}</div> : null}
            <button type="button" onClick={onClose} disabled={loading}>
              {cancelLabel}
            </button>
            {onApply ? (
              <button type="button" onClick={onApply} disabled={loading}>
                {loading ? "…" : applyLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      size="m"
      initialFocus="cancel"
      contentOverflow="auto"
      aria-label={title}
    >
      <Dialog.Header caption={title} />
      <Dialog.Body>{children}</Dialog.Body>
      {footer ? (
        <Dialog.Footer
          preset={danger ? "danger" : "default"}
          textButtonApply={applyLabel}
          textButtonCancel={cancelLabel}
          onClickButtonApply={onApply}
          onClickButtonCancel={onClose}
          loading={loading}
          errorText={error}
          showError={Boolean(error)}
        />
      ) : null}
    </Dialog>
  );
}
