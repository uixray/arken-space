import type { ReactNode } from "react";
import { Dialog } from "@gravity-ui/uikit";

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
  onApply,
  onClose,
}: ArkenDialogProps) {
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
