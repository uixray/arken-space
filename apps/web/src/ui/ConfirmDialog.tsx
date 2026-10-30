import { ArkenDialog } from "./ArkenDialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Удалить",
  loading = false,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <ArkenDialog
      open={open}
      title={title}
      applyLabel={confirmLabel}
      danger
      loading={loading}
      error={error}
      onApply={onConfirm}
      onClose={onClose}
    >
      <p className="arken-dialog-message">{message}</p>
    </ArkenDialog>
  );
}
