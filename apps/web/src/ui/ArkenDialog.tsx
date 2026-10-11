import { useEffect, useId, useRef, type ReactNode } from "react";
import { Dialog } from "@gravity-ui/uikit";
import { useWorkspaceWindow } from "./useWorkspaceWindow";
import { OverlayOwnerContext } from "./overlay-owner";
import { AppIcon } from "./AppIcon";
import { CloseIcon, ResetWindowIcon } from "./icons";

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
  /** Full-canvas workspaces are fixed; floating utility windows stay draggable. */
  workspaceDraggable?: boolean;
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
  workspaceDraggable = true,
  className,
  onApply,
  onClose,
}: ArkenDialogProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);
  // Firefox can leave `:open` true after the native popup consumed Escape.
  // Track per-select Escape ownership so stale :open state cannot trap later
  // Escape at the workspace boundary after the native interaction ends.
  const nativeSelectEscapeState = useRef(
    new WeakMap<HTMLSelectElement, "yielded" | "closed">(),
  );
  const {
    setWindowElement,
    position,
    zIndex,
    bringToFront,
    onDragStart,
    onDragMove,
    stopDragging,
    resetLayout,
  } = useWorkspaceWindow(open && variant === "workspace" && workspaceDraggable);

  useEffect(() => {
    if (!open || variant !== "workspace") return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previousFocus.current?.focus();
  }, [open, variant]);

  useEffect(() => {
    const justClosed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!justClosed || variant !== "modal") return;
    const frame = requestAnimationFrame(() => {
      const modals = document.querySelectorAll<HTMLElement>(".g-modal_open");
      const owner = modals[modals.length - 1];
      if (!owner || owner.contains(document.activeElement)) return;
      owner
        .querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
        )
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, variant]);

  if (variant === "workspace") {
    if (!open) return null;
    return (
      <OverlayOwnerContext.Provider value="workspace">
        <section
          ref={setWindowElement}
          className={["arken-workspace-window", className]
            .filter(Boolean)
            .join(" ")}
          role="dialog"
          aria-labelledby={titleId}
          data-positioned={position ? "true" : "false"}
          style={{
            ...(position ?? {}),
            zIndex,
          }}
          onPointerDown={bringToFront}
          onPointerDownCapture={(event) => {
            const target = event.target;
            if (
              target instanceof HTMLSelectElement &&
              target.closest('[role="dialog"]') === event.currentTarget
            )
              nativeSelectEscapeState.current.delete(target);
          }}
          onBlurCapture={(event) => {
            const target = event.target;
            if (
              target instanceof HTMLSelectElement &&
              target.closest('[role="dialog"]') === event.currentTarget
            )
              nativeSelectEscapeState.current.set(target, "closed");
          }}
          onChangeCapture={(event) => {
            const target = event.target;
            if (
              target instanceof HTMLSelectElement &&
              target.closest('[role="dialog"]') === event.currentTarget
            )
              // A value change does not guarantee the native list closed.
              // Re-check its live state rather than treating change as blur.
              nativeSelectEscapeState.current.delete(target);
          }}
          onKeyDownCapture={(event) => {
            if (event.key === "Escape") return;
            const target = event.target;
            const opensNativeSelect =
              event.key === "ArrowDown" ||
              event.key === "ArrowUp" ||
              event.key === " " ||
              event.key === "Enter" ||
              event.key === "F4";
            if (
              opensNativeSelect &&
              target instanceof HTMLSelectElement &&
              target.closest('[role="dialog"]') === event.currentTarget
            )
              nativeSelectEscapeState.current.delete(target);
          }}
          onFocusCapture={bringToFront}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;

            const target = event.target;
            // React events from portalled children (Select popups, nested
            // dialogs) still bubble through this component even though their
            // DOM belongs to another overlay. That child owns its Escape.
            if (
              !(target instanceof Node) ||
              !event.currentTarget.contains(target)
            )
              return;

            // Let an open Select consume the first Escape. Its handler runs
            // before this ancestor and closes the list; the next Escape, with
            // aria-expanded=false, remains the workspace's close command.
            const targetElement =
              target instanceof Element ? target : target.parentElement;
            if (
              targetElement?.closest('[role="dialog"]') !== event.currentTarget
            )
              return;
            if (
              targetElement?.closest('[role="combobox"][aria-expanded="true"]')
            )
              return;

            // Native popups do not expose aria-expanded. In Firefox the
            // Escape bubbles while :open may still be true. Yield the first
            // Escape to the browser without cancelling its default behavior;
            // then route the next non-repeat Escape to this workspace even if
            // Firefox continues to report stale :open state.
            if (targetElement instanceof HTMLSelectElement) {
              const state = nativeSelectEscapeState.current.get(targetElement);
              // A held key is one gesture. If this is the first event we saw
              // while a native popup is open, remember that Escape was yielded
              // so the next physical press still belongs to the workspace.
              if (event.nativeEvent.repeat) {
                if (state === undefined) {
                  try {
                    if (targetElement.matches(":open"))
                      nativeSelectEscapeState.current.set(
                        targetElement,
                        "yielded",
                      );
                  } catch {
                    // Unsupported :open keeps ordinary closed-select behavior.
                  }
                }
                return;
              }
              if (state === "yielded") {
                nativeSelectEscapeState.current.delete(targetElement);
                onClose();
                return;
              }
              if (state === "closed") {
                // Blur closed the native interaction. Ignore stale
                // Firefox :open until a new pointer/key opening gesture.
                nativeSelectEscapeState.current.delete(targetElement);
                onClose();
                return;
              }
              try {
                if (targetElement.matches(":open")) {
                  nativeSelectEscapeState.current.set(targetElement, "yielded");
                  return;
                }
              } catch {
                // Older engines may not support :open. Keep ordinary closed
                // control Escape behavior rather than trapping every select.
              }
            }

            onClose();
          }}
        >
          <header className="arken-workspace-window__header">
            <div
              className="arken-workspace-window__drag-handle"
              role="group"
              data-draggable={workspaceDraggable ? "true" : "false"}
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
                <AppIcon icon={ResetWindowIcon} />
              </button>
            ) : null}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Закрыть окно"
            >
              <AppIcon icon={CloseIcon} />
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
      </OverlayOwnerContext.Provider>
    );
  }

  return (
    <OverlayOwnerContext.Provider value="modal">
      <Dialog
        className="arken-dialog"
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
    </OverlayOwnerContext.Provider>
  );
}
