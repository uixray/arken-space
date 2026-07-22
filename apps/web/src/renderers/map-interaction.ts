export type Point = Readonly<{ x: number; y: number }>;

export type MapObjectKind = "token" | "drawing";
export type MapObjectRef = Readonly<{
  kind: MapObjectKind;
  objectId: string;
  revision: number;
}>;

declare const validatedMapObjectRef: unique symbol;
export type ValidatedMapObjectRef = MapObjectRef & {
  readonly [validatedMapObjectRef]: true;
};

export function createValidatedMapObjectRef(
  ref: MapObjectRef,
): ValidatedMapObjectRef | null {
  if (
    (ref.kind !== "token" && ref.kind !== "drawing") ||
    ref.objectId.trim().length === 0 ||
    ref.objectId.length > 256 ||
    !Number.isSafeInteger(ref.revision) ||
    ref.revision < 0
  )
    return null;
  return ref as ValidatedMapObjectRef;
}

const isFinitePoint = (point: Point) =>
  Number.isFinite(point.x) && Number.isFinite(point.y);
const MAX_ZOOM_FACTOR = 16;
const sameRef = (left: MapObjectRef | null, right: MapObjectRef) =>
  left !== null &&
  left.kind === right.kind &&
  left.objectId === right.objectId &&
  left.revision === right.revision;

export type ViewportIntent =
  | Readonly<{ type: "pan"; delta: Point }>
  | Readonly<{ type: "zoom"; factor: number; anchor: Point }>
  | Readonly<{ type: "fit" }>;

export type MapInteractionCommand =
  | Readonly<{ id: number; type: "viewport"; intent: ViewportIntent }>
  | Readonly<{ id: number; type: "delete-object"; ref: ValidatedMapObjectRef }>;

type PendingMapInteractionCommand =
  | Readonly<{ type: "viewport"; intent: ViewportIntent }>
  | Readonly<{ type: "delete-object"; ref: ValidatedMapObjectRef }>;

export interface ObjectMenuState {
  ref: MapObjectRef;
  position: Point;
}

export interface MapInteractionState {
  focused: boolean;
  selectedObject: MapObjectRef | null;
  objectListOpen: boolean;
  objectMenu: ObjectMenuState | null;
  deleteRequestedFor: ValidatedMapObjectRef | null;
  commands: readonly MapInteractionCommand[];
  nextCommandId: number;
}

export type MapInteractionAction =
  | Readonly<{ type: "focus" }>
  | Readonly<{ type: "blur" }>
  | Readonly<{ type: "pan"; delta: Point }>
  | Readonly<{ type: "zoom"; factor: number; anchor: Point }>
  | Readonly<{ type: "fit" }>
  | Readonly<{ type: "select"; ref: MapObjectRef }>
  | Readonly<{ type: "clear-selection" }>
  | Readonly<{ type: "open-object-list" }>
  | Readonly<{ type: "close-object-list" }>
  | Readonly<{ type: "toggle-object-list" }>
  | Readonly<{ type: "open-object-menu"; ref: MapObjectRef; position: Point }>
  | Readonly<{ type: "close-object-menu" }>
  | Readonly<{ type: "request-delete"; ref: ValidatedMapObjectRef }>
  | Readonly<{ type: "cancel-delete" }>
  | Readonly<{ type: "confirm-delete" }>
  | Readonly<{ type: "escape" }>
  | Readonly<{ type: "consume-command"; id: number }>;

export const createInitialMapInteractionState = (): MapInteractionState => ({
  focused: false,
  selectedObject: null,
  objectListOpen: false,
  objectMenu: null,
  deleteRequestedFor: null,
  commands: [],
  nextCommandId: 1,
});

function enqueue(
  state: MapInteractionState,
  command: PendingMapInteractionCommand,
): MapInteractionState {
  return {
    ...state,
    commands: [
      ...state.commands,
      { ...command, id: state.nextCommandId } as MapInteractionCommand,
    ],
    nextCommandId: state.nextCommandId + 1,
  };
}

/**
 * Pure interaction state machine. Commands describe work for the renderer to
 * perform; the reducer itself never touches Konva, the DOM, or persistence.
 */
export function mapInteractionReducer(
  state: MapInteractionState,
  action: MapInteractionAction,
): MapInteractionState {
  switch (action.type) {
    case "focus":
      return state.focused ? state : { ...state, focused: true };
    case "blur":
      return state.focused ? { ...state, focused: false } : state;
    case "pan":
      if (!isFinitePoint(action.delta)) return state;
      return enqueue(state, {
        type: "viewport",
        intent: { type: "pan", delta: action.delta },
      });
    case "zoom":
      if (
        !Number.isFinite(action.factor) ||
        action.factor <= 0 ||
        action.factor > MAX_ZOOM_FACTOR ||
        !isFinitePoint(action.anchor)
      )
        return state;
      return enqueue(state, {
        type: "viewport",
        intent: { type: "zoom", factor: action.factor, anchor: action.anchor },
      });
    case "fit":
      return enqueue(state, { type: "viewport", intent: { type: "fit" } });
    case "select":
      return { ...state, selectedObject: action.ref, objectMenu: null };
    case "clear-selection":
      return { ...state, selectedObject: null, objectMenu: null };
    case "open-object-list":
      return { ...state, objectListOpen: true, objectMenu: null };
    case "close-object-list":
      return { ...state, objectListOpen: false };
    case "toggle-object-list":
      return {
        ...state,
        objectListOpen: !state.objectListOpen,
        objectMenu: null,
      };
    case "open-object-menu":
      return {
        ...state,
        selectedObject: action.ref,
        objectListOpen: false,
        objectMenu: { ref: action.ref, position: action.position },
      };
    case "close-object-menu":
      return { ...state, objectMenu: null };
    case "request-delete":
      return {
        ...state,
        selectedObject: action.ref,
        objectMenu: null,
        deleteRequestedFor: action.ref,
      };
    case "cancel-delete":
      return { ...state, deleteRequestedFor: null };
    case "confirm-delete": {
      if (state.deleteRequestedFor === null) return state;
      const ref = state.deleteRequestedFor;
      return enqueue(
        {
          ...state,
          deleteRequestedFor: null,
          selectedObject: sameRef(state.selectedObject, ref)
            ? null
            : state.selectedObject,
        },
        { type: "delete-object", ref },
      );
    }
    case "escape":
      if (state.deleteRequestedFor !== null)
        return { ...state, deleteRequestedFor: null };
      if (state.objectMenu !== null) return { ...state, objectMenu: null };
      if (state.objectListOpen) return { ...state, objectListOpen: false };
      if (state.selectedObject !== null)
        return { ...state, selectedObject: null };
      return state;
    case "consume-command":
      return {
        ...state,
        commands: state.commands.filter((command) => command.id !== action.id),
      };
  }
}
