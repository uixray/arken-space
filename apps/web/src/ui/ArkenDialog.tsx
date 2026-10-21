import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "../design-system/Button";
import { useWorkspaceWindow } from "./useWorkspaceWindow";
import { OverlayOwnerContext } from "./overlay-owner";
import { AppIcon } from "./AppIcon";
import { CloseIcon, ResetWindowIcon } from "./icons";
import "./modal-dialog.css";

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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
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

  // Base UI returns focus only to a Dialog.Trigger, and ArkenDialog has none:
  // remember who had focus when the modal opened and hand it back on close,
  // as Gravity's Modal did.
  const modalOpener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open || variant !== "modal") return;
    const active = document.activeElement;
    modalOpener.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open, variant]);

  useEffect(() => {
    const justClosed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!justClosed || variant !== "modal") return;
    const frame = requestAnimationFrame(() => {
      const modals =
        document.querySelectorAll<HTMLElement>(".arken-modal--open");
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

  // UIX-709: the former Gravity Dialog markup on Base UI. Only a press on
  // this dialog's own veil closes it, as before: presses in toasts or other
  // portals are not "outside" this dialog.
  return (
    <OverlayOwnerContext.Provider value="modal">
      <Dialog.Root
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onClose();
        }}
        disablePointerDismissal
      >
        <Dialog.Portal>
          <div
            className="arken-modal arken-modal--open arken-dialog__modal"
            data-floating-ui-status="open"
            onPointerDown={(event) => {
              const target = event.target;
              if (
                target instanceof Node &&
                event.currentTarget.contains(target) &&
                !popupRef.current?.contains(target)
              )
                onClose();
            }}
          >
            <div className="arken-modal__content-aligner">
              <div className="arken-modal__content-wrapper">
                <Dialog.Popup
                  ref={popupRef}
                  className="arken-modal__content arken-modal__content--has-scroll"
                  aria-label={title}
                  initialFocus={() => cancelRef.current ?? popupRef.current}
                  finalFocus={() => {
                    const opener = modalOpener.current;
                    return opener?.isConnected ? opener : true;
                  }}
                >
                  <div
                    className={[
                      "arken-modal-dialog arken-modal-dialog--size-m arken-modal-dialog--has-close arken-modal-dialog--has-scroll arken-dialog",
                      className,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="arken-modal-dialog-btn-close">
                      <Button
                        view="flat"
                        size="l"
                        className="arken-modal-dialog-btn-close__btn"
                        onClick={onClose}
                        aria-label="Закрыть диалоговое окно"
                      >
                        {/* An icon slot, not text: the 44px target leaves no
                            room for size-l text padding around the glyph. */}
                        <span className="arken-button__icon" aria-hidden="true">
                          <span className="arken-button__icon-inner">
                            <AppIcon icon={CloseIcon} size={20} />
                          </span>
                        </span>
                      </Button>
                    </div>
                    <div className="arken-modal-dialog-header">
                      <div className="arken-modal-dialog-header__caption">
                        {title}
                      </div>
                    </div>
                    <div className="arken-modal-dialog-body">{children}</div>
                    {footer ? (
                      <div className="arken-modal-dialog-footer">
                        <div className="arken-modal-dialog-footer__bts-wrapper">
                          <div className="arken-modal-dialog-footer__button arken-modal-dialog-footer__button--action-cancel">
                            <Button
                              ref={cancelRef}
                              view="flat"
                              size="l"
                              width="max"
                              onClick={onClose}
                              disabled={loading}
                            >
                              {cancelLabel}
                            </Button>
                          </div>
                          <div className="arken-modal-dialog-footer__button arken-modal-dialog-footer__button--action-apply">
                            <Button
                              type="submit"
                              view="action"
                              size="l"
                              width="max"
                              onClick={onApply}
                              loading={loading}
                              className={`arken-modal-dialog-footer__button-apply arken-modal-dialog-footer__button-apply--preset-${danger ? "danger" : "default"}`}
                            >
                              {applyLabel}
                            </Button>
                            {error ? (
                              <div
                                className="arken-modal-dialog-footer__error-popup"
                                role="alert"
                              >
                                <div className="arken-modal-dialog-footer__error">
                                  {error}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </Dialog.Popup>
              </div>
            </div>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    </OverlayOwnerContext.Provider>
  );
}
