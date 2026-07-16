import { useCallback, useMemo, useReducer } from "react";
import {
  createEntityFormState,
  entityFormReducer,
  isEntityFormDirty,
} from "./entity-form-state";

export class EntityConflictError<T> extends Error {
  constructor(
    message: string,
    readonly serverValue: T,
  ) {
    super(message);
  }
}

export function useEntityForm<T extends object>(
  initialValue: T,
  save: (draft: T) => Promise<T>,
  options?: {
    onOptimisticUpdate?: (draft: T) => void;
    onRollback?: (initial: T) => void;
  },
) {
  const [state, dispatch] = useReducer(
    entityFormReducer<T>,
    initialValue,
    createEntityFormState,
  );
  const dirty = useMemo(() => isEntityFormDirty(state), [state]);

  const update = useCallback(
    (patch: Partial<T>) => dispatch({ type: "change", patch }),
    [],
  );
  const replace = useCallback(
    (value: T) => dispatch({ type: "replace", value }),
    [],
  );
  const reset = useCallback(() => {
    options?.onRollback?.(state.initial);
    dispatch({ type: "reset" });
  }, [options, state.initial]);

  const submit = useCallback(async () => {
    const optimisticValue = state.draft;
    dispatch({ type: "saving" });
    options?.onOptimisticUpdate?.(optimisticValue);
    try {
      const savedValue = await save(optimisticValue);
      dispatch({ type: "saved", value: savedValue });
      return savedValue;
    } catch (error) {
      options?.onRollback?.(state.initial);
      if (error instanceof EntityConflictError) {
        dispatch({
          type: "conflict",
          message: error.message,
          serverValue: error.serverValue,
        });
      } else {
        dispatch({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Не удалось сохранить изменения",
        });
      }
      return undefined;
    }
  }, [options, save, state.draft, state.initial]);

  return { state, dirty, update, replace, reset, submit };
}
