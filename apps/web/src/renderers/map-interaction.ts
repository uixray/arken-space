import { RULER_MAX_POINTS, type Role } from "@arken/contracts";

export type MapTool =
  | "PAN"
  | "FOG"
  | "COVER"
  | "DRAW"
  | "RULER"
  | "PING"
  /**
   * UIX-311: GM drags a rectangle to pick the camera-focus hint for a
   * SCENE_REGION encounter. Same pointerdown/move/up draft-rect pattern as
   * FOG/COVER, GM-only.
   */
  | "SCENE_REGION"
  /**
   * UIX-313: continuous round-brush fog stroke, sampled locally into a
   * draft on pointer move and committed as a single BRUSH geometry POST on
   * pointer-up (same local-draft-then-commit pattern as FOG/COVER).
   * GM-only.
   */
  | "FOG_BRUSH"
  | "COVER_BRUSH"
  /**
   * UIX-313: click-to-add-vertex polygon fog tool, completed with
   * Enter/double-click (>=3 points) or cancelled with Escape/right-click.
   * GM-only.
   */
  | "FOG_POLYGON"
  | "COVER_POLYGON";

export type Point = Readonly<{ x: number; y: number }>;

export function shouldBeginMapPan(
  button: number,
  tool: MapTool,
  targetIsCanvas: boolean,
): boolean {
  return (
    button === 1 ||
    (button === 2 && targetIsCanvas) ||
    (button === 0 && tool === "PAN" && targetIsCanvas)
  );
}

/**
 * UIX-381: multi-segment ruler drag state. `waypoints` are already-committed
 * points (the drag start is always `waypoints[0]`); `live` is the pointer's
 * current, not-yet-committed position. `null` means no ruler drag is in
 * progress -- both the pointerdown that starts a measurement and the reset
 * on Escape/tool-change/pointer-cancel go through this single state shape so
 * every cleanup path is the same "set it back to null" operation.
 */
export type RulerDraft = Readonly<{
  waypoints: readonly Point[];
  live: Point;
}>;

export function startRulerDraft(point: Point): RulerDraft {
  return { waypoints: [point], live: point };
}

export function moveRulerDraft(draft: RulerDraft, point: Point): RulerDraft {
  return { ...draft, live: point };
}

/**
 * Commits the draft's current live point as a waypoint, so the next segment
 * continues from there. A no-op (returns the same reference) when there is
 * nothing new to commit (the live point already equals the last waypoint --
 * e.g. Ctrl pressed before any pointer movement) or when committing would
 * push the polyline past the server's `RULER_MAX_POINTS` cap -- one slot is
 * always reserved for the still-uncommitted live segment so
 * `rulerDraftPoints` never itself exceeds the cap.
 */
export function appendRulerWaypoint(draft: RulerDraft): RulerDraft {
  const last = draft.waypoints[draft.waypoints.length - 1];
  if (last && last.x === draft.live.x && last.y === draft.live.y) return draft;
  if (draft.waypoints.length >= RULER_MAX_POINTS - 1) return draft;
  return { waypoints: [...draft.waypoints, draft.live], live: draft.live };
}

/** Committed waypoints plus the live in-progress segment, ready to send/render. */
export function rulerDraftPoints(draft: RulerDraft): Point[] {
  const last = draft.waypoints[draft.waypoints.length - 1];
  if (last && last.x === draft.live.x && last.y === draft.live.y)
    return [...draft.waypoints];
  return [...draft.waypoints, draft.live];
}

export function resolveMapWheelGesture(input: {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
}):
  | Readonly<{ type: "pan"; delta: Point }>
  | Readonly<{ type: "zoom"; direction: "in" | "out" }> {
  if (input.ctrlKey || input.metaKey)
    return { type: "zoom", direction: input.deltaY > 0 ? "out" : "in" };
  return {
    type: "pan",
    delta: { x: -input.deltaX, y: -input.deltaY },
  };
}

export function canMoveMapToken(input: {
  tool: MapTool;
  role: Role;
  locked: boolean;
  membershipId: string;
  controllerMembershipIds: readonly string[];
}): boolean {
  return (
    input.tool === "PAN" &&
    !input.locked &&
    (input.role === "GM" ||
      input.controllerMembershipIds.includes(input.membershipId))
  );
}

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
  | Readonly<{ type: "fit" }>
  | Readonly<{ type: "select-tool"; tool: MapTool }>;

export type MapInteractionCommand =
  | Readonly<{ id: number; type: "viewport"; intent: ViewportIntent }>
  | Readonly<{ id: number; type: "delete-object"; ref: ValidatedMapObjectRef }>
  | Readonly<{ id: number; type: "select-tool"; tool: MapTool }>;

type PendingMapInteractionCommand =
  | Readonly<{ type: "viewport"; intent: ViewportIntent }>
  | Readonly<{ type: "delete-object"; ref: ValidatedMapObjectRef }>
  | Readonly<{ type: "select-tool"; tool: MapTool }>;

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
  | Readonly<{ type: "select-tool"; tool: MapTool }>
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
    case "select-tool":
      return enqueue(state, { type: "select-tool", tool: action.tool });
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

const TOOL_SHORTCUTS: Readonly<Record<string, MapTool>> = {
  v: "PAN",
  d: "DRAW",
  r: "RULER",
  p: "PING",
};

/** Resolves only renderer-scoped tool shortcuts and applies the GM permission gate. */
export function resolveMapToolShortcut(
  key: string,
  shiftKey: boolean,
  role: Role,
): MapTool | null {
  if (key.length !== 1) return null;
  const normalized = key.toLowerCase();
  if (normalized === "g") {
    if (role !== "GM") return null;
    return shiftKey ? "COVER" : "FOG";
  }
  if (normalized === "b") {
    if (role !== "GM") return null;
    return shiftKey ? "COVER_BRUSH" : "FOG_BRUSH";
  }
  if (normalized === "l") {
    if (role !== "GM") return null;
    return shiftKey ? "COVER_POLYGON" : "FOG_POLYGON";
  }
  if (shiftKey) return null;
  return TOOL_SHORTCUTS[normalized] ?? null;
}

export type TokenResizeDraft = {
  width: number;
  height: number;
  revision: number;
};

export function clearSettledTokenResizeDraft(
  drafts: Readonly<Record<string, TokenResizeDraft>>,
  tokenId: string,
  expected: TokenResizeDraft,
): Record<string, TokenResizeDraft> {
  const current = drafts[tokenId];
  if (
    !current ||
    current.revision !== expected.revision ||
    current.width !== expected.width ||
    current.height !== expected.height
  )
    return drafts;
  const next = { ...drafts };
  delete next[tokenId];
  return next;
}
