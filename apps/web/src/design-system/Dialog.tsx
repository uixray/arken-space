import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { CloseIcon as X } from "../ui/icons";
import { Button } from "./Button";
import "./Dialog.css";

export type DialogSize = "s" | "m" | "l" | "xl";

interface DialogContextValue {
  onClose?: () => void;
  titleId: string;
  danger?: boolean;
  size?: DialogSize;
}

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error(
      "Dialog compound components must be rendered inside <Dialog>",
    );
  }
  return context;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

/* ==========================================================================
   Dialog Header
   ========================================================================== */

export interface DialogHeaderProps {
  caption?: ReactNode;
  children?: ReactNode;
  hideClose?: boolean;
  className?: string;
}

export const DialogHeader = forwardRef<HTMLDivElement, DialogHeaderProps>(
  function DialogHeader(
    { caption, children, hideClose = false, className },
    ref,
  ) {
    const { onClose, titleId } = useDialogContext();
    const titleContent = caption ?? children;

    return (
      <header
        ref={ref}
        className={cx("arken-dialog__header", "g-dialog-header", className)}
      >
        <BaseDialog.Title
          id={titleId}
          className="arken-dialog__title g-dialog-header__caption"
        >
          {titleContent}
        </BaseDialog.Title>
        {!hideClose && (
          <button
            type="button"
            className="arken-dialog__close g-dialog-btn-close__btn"
            onClick={onClose}
            aria-label="Закрыть диалоговое окно"
            title="Закрыть диалоговое окно"
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </header>
    );
  },
);

/* ==========================================================================
   Dialog Body
   ========================================================================== */

export interface DialogBodyProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export const DialogBody = forwardRef<HTMLDivElement, DialogBodyProps>(
  function DialogBody({ children, className, style }, ref) {
    return (
      <div
        ref={ref}
        className={cx("arken-dialog__body", "g-dialog__body", className)}
        style={style}
      >
        {children}
      </div>
    );
  },
);

/* ==========================================================================
   Dialog Footer
   ========================================================================== */

export interface DialogFooterProps {
  preset?: "default" | "danger";
  textButtonApply?: string;
  textButtonCancel?: string;
  onClickButtonApply?: () => void;
  onClickButtonCancel?: () => void;
  loading?: boolean;
  errorText?: string;
  showError?: boolean;
  children?: ReactNode;
  className?: string;
}

export const DialogFooter = forwardRef<HTMLDivElement, DialogFooterProps>(
  function DialogFooter(
    {
      preset = "default",
      textButtonApply = "Сохранить",
      textButtonCancel = "Отмена",
      onClickButtonApply,
      onClickButtonCancel,
      loading = false,
      errorText,
      showError = false,
      children,
      className,
    },
    ref,
  ) {
    const { onClose, danger: contextDanger } = useDialogContext();
    const isDanger = preset === "danger" || contextDanger;

    return (
      <footer
        ref={ref}
        className={cx("arken-dialog__footer", "g-dialog-footer", className)}
      >
        {showError && errorText && (
          <div role="alert" className="arken-dialog__error">
            {errorText}
          </div>
        )}
        {children ?? (
          <div className="arken-dialog__footer-actions">
            <Button
              type="button"
              view="flat"
              size="m"
              onClick={onClickButtonCancel ?? onClose}
              disabled={loading}
            >
              {textButtonCancel}
            </Button>
            {onClickButtonApply && (
              <Button
                type="button"
                view={isDanger ? "danger" : "action"}
                size="m"
                onClick={onClickButtonApply}
                loading={loading}
                disabled={loading}
              >
                {loading ? "…" : textButtonApply}
              </Button>
            )}
          </div>
        )}
      </footer>
    );
  },
);

/* ==========================================================================
   Dialog Root Component
   ========================================================================== */

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  onOpenChange?: (open: boolean) => void;
  size?: DialogSize;
  className?: string;
  style?: CSSProperties;
  title?: string;
  children?: ReactNode;
  danger?: boolean;
  initialFocus?: unknown;
  contentOverflow?: unknown;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  qa?: string;
}

export function DialogComponent({
  open,
  onClose,
  onOpenChange,
  size = "m",
  className,
  style,
  title,
  children,
  danger,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledByProp,
  "aria-describedby": ariaDescribedBy,
  qa,
}: DialogProps) {
  const titleId = useId();

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange?.(nextOpen);
    if (!nextOpen) {
      onClose();
    }
  };

  const contextValue: DialogContextValue = {
    onClose,
    titleId,
    danger,
    size,
  };

  return (
    <DialogContext.Provider value={contextValue}>
      <BaseDialog.Root open={open} onOpenChange={handleOpenChange} modal>
        <BaseDialog.Portal>
          <BaseDialog.Backdrop className="arken-dialog__backdrop g-modal__backdrop" />
          <div className="arken-dialog__viewport">
            <BaseDialog.Popup
              className={cx(
                "arken-dialog__popup",
                "arken-dialog",
                "g-dialog",
                `arken-dialog--${size}`,
                `g-dialog_size_${size}`,
                className,
              )}
              style={style}
              aria-label={ariaLabel}
              aria-labelledby={
                ariaLabelledByProp ?? (title ? titleId : undefined)
              }
              aria-describedby={ariaDescribedBy}
              data-qa={qa}
            >
              {title ? (
                <>
                  <DialogHeader caption={title} />
                  <DialogBody>{children}</DialogBody>
                </>
              ) : (
                children
              )}
            </BaseDialog.Popup>
          </div>
        </BaseDialog.Portal>
      </BaseDialog.Root>
    </DialogContext.Provider>
  );
}

export const Dialog = Object.assign(DialogComponent, {
  Header: DialogHeader,
  Body: DialogBody,
  Footer: DialogFooter,
});
