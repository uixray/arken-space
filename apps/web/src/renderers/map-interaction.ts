import { RULER_MAX_POINTS, type Role } from "@arken/contracts";
import {
  MAP_TOOL_SHORTCUTS,
  type MapTool as MapToolId,
} from "./map-tool-shortcuts";

/**
 * UIX-311/313: selectable map tools include the shortcut-backed drawing/fog
 * tools and the GM-only SCENE_REGION drag mode. The type lives beside the
 * shortcut manifest so the manifest never has to import this runtime module.
 */
export type MapTool = MapToolId;

export type Point = Readonly<{ x: number; y: number }>;

export function resolveTokenMoveKey(input: {
  key: string;
  repeat: boolean;
  tool: MapTool;
  hasSelectedToken: boolean;
  gridEnabled: boolean;
  gridSize: number;
  shiftKey: boolean;
}): { delta: Point | null } | null {
  const key = input.key.toLowerCase();
  if (
    input.tool !== "PAN" ||
    !input.hasSelectedToken ||
    !["w", "a", "s", "d"].includes(key)
  )
    return null;
  if (input.repeat) return { delta: null };
  const step =
    (input.gridEnabled ? input.gridSize : 8) * (input.shiftKey ? 5 : 1);
  return {
    delta: {
      x: key === "a" ? -step : key === "d" ? step : 0,
      y: key === "w" ? -step : key === "s" ? step : 0,
    },
  };
}

export function shouldSuppressCtrlPing(input: {
  tool: MapTool;
  ctrlKey: boolean;
  waypointCommitted: boolean;
}) {
  return input.tool === "RULER" && input.ctrlKey && input.waypointCommitted;
}

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
      /**
       * UIX-470: рисунок удаляется сразу, без вопроса.
       *
       * Рисуют на карте быстро и много — стрелку, круг, зачёркивание, — и
       * каждый лишний диалог стоит дороже редкого промаха. Промах при этом не
       * теряется: `DELETE /api/drawings/:id` пишет в `action_journal`, то есть
       * `Ctrl+Z` возвращает рисунок. Именно поэтому размен считается честным, а
       * не «рисуем быстро и терпим потери».
       *
       * У токена подтверждение остаётся: он несёт персонажа, права и владельца,
       * и его удаление — не штрих, а изменение расстановки.
       */
      if (action.ref.kind === "drawing")
        return enqueue(
          {
            ...state,
            objectMenu: null,
            deleteRequestedFor: null,
            selectedObject: sameRef(state.selectedObject, action.ref)
              ? null
              : state.selectedObject,
          },
          { type: "delete-object", ref: action.ref },
        );
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

/**
 * UIX-463: список клавиш переехал в `map-tool-shortcuts.ts` — оттуда его берут
 * и разбор нажатия, и подсказки на кнопках панели, и шпаргалка. Здесь остался
 * только разбор.
 *
 * Экспорт сохранён: по нему шпаргалка проверяется на полноту, а не только на
 * правильность — инструмент, получивший клавишу и нигде не описанный, такой же
 * дефект, как описанный неверно.
 */
export const TOOL_SHORTCUTS: Readonly<Record<string, MapTool>> =
  Object.fromEntries(
    MAP_TOOL_SHORTCUTS.filter((entry) => !entry.gmOnly).map((entry) => [
      entry.key,
      entry.tool,
    ]),
  );

/** Resolves only renderer-scoped tool shortcuts and applies the GM permission gate. */
export function resolveMapToolShortcut(
  key: string,
  shiftKey: boolean,
  role: Role,
): MapTool | null {
  if (key.length !== 1) return null;
  const normalized = key.toLowerCase();
  const entry = MAP_TOOL_SHORTCUTS.find((item) => item.key === normalized);
  if (!entry) return null;
  // Мастерский инструмент игроку не открывается ни с Shift, ни без него.
  if (entry.gmOnly && role !== "GM") return null;
  if (shiftKey) return entry.shiftTool ?? null;
  return entry.tool;
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
