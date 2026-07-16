export type EntityFormStatus =
  "idle" | "saving" | "saved" | "error" | "conflict";

export interface EntityFormState<T> {
  initial: T;
  draft: T;
  status: EntityFormStatus;
  error?: string;
  serverValue?: T;
}

export type EntityFormAction<T> =
  | { type: "replace"; value: T }
  | { type: "change"; patch: Partial<T> }
  | { type: "saving" }
  | { type: "saved"; value: T }
  | { type: "error"; message: string }
  | { type: "conflict"; message: string; serverValue: T }
  | { type: "reset" };

export function createEntityFormState<T>(value: T): EntityFormState<T> {
  return { initial: value, draft: value, status: "idle" };
}

export function entityFormReducer<T>(
  state: EntityFormState<T>,
  action: EntityFormAction<T>,
): EntityFormState<T> {
  switch (action.type) {
    case "replace":
      return createEntityFormState(action.value);
    case "change":
      return {
        ...state,
        draft: { ...state.draft, ...action.patch },
        status: "idle",
        error: undefined,
      };
    case "saving":
      return {
        ...state,
        status: "saving",
        error: undefined,
        serverValue: undefined,
      };
    case "saved":
      return { initial: action.value, draft: action.value, status: "saved" };
    case "error":
      return { ...state, status: "error", error: action.message };
    case "conflict":
      return {
        ...state,
        status: "conflict",
        error: action.message,
        serverValue: action.serverValue,
      };
    case "reset":
      return { initial: state.initial, draft: state.initial, status: "idle" };
  }
}

export function isEntityFormDirty<T>(state: EntityFormState<T>) {
  return JSON.stringify(state.initial) !== JSON.stringify(state.draft);
}
