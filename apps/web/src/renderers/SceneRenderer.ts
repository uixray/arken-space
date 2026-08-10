import type {
  AssetDto,
  DrawingDto,
  EncounterDto,
  FogGeometry,
  FogRevealDto,
  MapPing,
  Role,
  SceneDto,
  TokenDto,
} from "@arken/contracts";
import type { CursorPresence } from "./cursor-presence";
import type { GameSocket } from "../realtime";
import type { MapMoveAck, MapMoveTarget } from "./map-move-queue";
import type { MapTool } from "./map-interaction";

export interface SceneRendererProps {
  scene: SceneDto;
  tokens: TokenDto[];
  fogReveals: FogRevealDto[];
  drawings: DrawingDto[];
  assets: AssetDto[];
  role: Role;
  membershipId: string;
  socket: GameSocket | null;
  tool: MapTool;
  onToolSelect: (tool: MapTool) => void;
  pings: MapPing[];
  /** UIX-392: already filtered to the active scene and the receive opt-out. */
  cursors: CursorPresence[];
  /** UIX-392: local opt-out — when false, this client's own pointer never emits `cursor:move`. */
  cursorSendEnabled: boolean;
  /** UIX-381: ordered polyline waypoints (>=2 points); a single segment is just a 2-point polyline. */
  rulers: Array<{
    sceneId: string;
    membershipId: string;
    displayName: string;
    points: Array<{ x: number; y: number }>;
    distance: number;
  }>;
  onFogCreate: (
    payload:
      | { x: number; y: number; width: number; height: number }
      | { geometry: FogGeometry },
  ) => Promise<void>;
  /**
   * UIX-311: encounter lifecycle for the active scene. SCENE_REGION cameras
   * fit to `focusRegion` while such an encounter is ACTIVE, and reset to
   * the whole-scene fit once it ENDs. Optional/absent until Stage 4 wires a
   * GM-facing start-encounter entry point.
   */
  encounters?: EncounterDto[];
  /**
   * Fires when the GM commits a SCENE_REGION draft rectangle (SCENE_REGION
   * tool, pointerdown -> move -> up). Stage 4 owns turning this into a real
   * "start encounter" confirmation UI; this renderer only reports the
   * selected world-coordinate rect.
   */
  onEncounterRegionSelect?: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onDrawingCreate: (drawing: {
    points: number[];
    color: string;
    strokeWidth?: number;
  }) => Promise<DrawingDto | void>;
  onPing: (point: { x: number; y: number }) => void;
  onPlaceTokenDefinition?: (
    definitionId: string,
    point?: { x: number; y: number },
  ) => Promise<void>;
  onTokenLayerChange?: (
    tokenId: string,
    revision: number,
    layer: TokenDto["layer"],
  ) => Promise<void>;
  onTokenDelete?: (tokenId: string, revision: number) => Promise<void>;
  onOpenCharacter?: (characterId: string) => void;
  onTokenResize?: (
    tokenId: string,
    revision: number,
    size: { width: number; height: number },
  ) => Promise<void>;
  onTokenAppearanceChange?: (
    tokenId: string,
    revision: number,
    appearance: { baseColor: string; frameColor: string | null },
  ) => Promise<void>;
  onDrawingUpdate?: (
    drawingId: string,
    revision: number,
    patch: { x?: number; y?: number; color?: string; strokeWidth?: number },
  ) => Promise<void>;
  onDrawingDelete?: (drawingId: string, revision: number) => Promise<void>;
  onDrawingCopy?: (drawingId: string, revision: number) => Promise<void>;
  onBulkMove?: (
    targets: MapMoveTarget[],
    delta: { x: number; y: number },
  ) => Promise<MapMoveAck>;
  onBulkDelete?: (selection: {
    tokenIds: string[];
    drawingIds: string[];
  }) => Promise<void>;
  gmFogOpacity?: number;
  gmFogVisible?: boolean;
  gmGridVisible?: boolean;
  /**
   * UIX-313: world-unit radius for the circular fog brush tool
   * (FOG_BRUSH/COVER_BRUSH). Defaults to a sane value if omitted.
   */
  fogBrushRadius?: number;
  canvasEditMode?: "BACKGROUND" | "WORLD" | null;
  onCanvasEditCancel?: () => void;
  onCanvasPatch?: (patch: {
    world?: { width: number; height: number };
    backgroundFrame?: { x: number; y: number; width: number; height: number };
  }) => Promise<void>;
}

export type SceneRendererComponent = React.ComponentType<SceneRendererProps>;
