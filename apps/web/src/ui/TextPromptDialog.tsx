import { useEffect, useMemo } from "react";
import { TextInput } from "@gravity-ui/uikit";
import { ArkenDialog } from "./ArkenDialog";
import { ApiError } from "../api";
import { EntityConflictError, useEntityForm } from "./useEntityForm";

type Props = {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  applyLabel?: string;
  loading?: boolean;
  error?: string;
  onApply: (value: string) => void | Promise<void>;
  onClose: () => void;
};

export function TextPromptDialog({
  open,
  title,
  label,
  initialValue = "",
  applyLabel,
  loading,
  error,
  onApply,
  onClose,
}: Props) {
  const initial = useMemo(() => ({ value: initialValue }), [initialValue]);
  const {
    state,
    update,
    replace,
    submit: save,
  } = useEntityForm(initial, async (draft) => {
    try {
      await onApply(draft.value.trim());
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409)
        throw new EntityConflictError(
          "Данные уже изменены в другой сессии. Закройте окно, проверьте актуальное значение и повторите действие.",
          initial,
        );
      throw reason;
    }
    return { value: draft.value.trim() };
  });

  useEffect(() => {
    if (open) replace(initial);
  }, [initial, open, replace]);

  const submit = () => {
    if (state.draft.value.trim()) void save();
  };

  return (
    <ArkenDialog
      open={open}
      title={title}
      applyLabel={applyLabel}
      loading={loading || state.status === "saving"}
      error={error || state.error}
      onApply={submit}
      onClose={onClose}
    >
      <TextInput
        autoFocus
        value={state.draft.value}
        onUpdate={(value) => update({ value })}
        placeholder={label}
        aria-label={label}
        validationState={state.draft.value.trim() ? undefined : "invalid"}
        errorMessage={state.draft.value.trim() ? undefined : "Введите значение"}
        onKeyDown={(event) => {
          if (event.key === "Enter" && state.draft.value.trim()) submit();
        }}
      />
    </ArkenDialog>
  );
}
