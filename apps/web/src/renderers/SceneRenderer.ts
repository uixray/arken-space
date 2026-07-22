import type {
  AssetDto,
  DrawingDto,
  FogRevealDto,
  MapPing,
  Role,
  SceneDto,
  TokenDto,
} from "@arken/contracts";
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
  rulers: Array<{
    sceneId: string;
    membershipId: string;
    displayName: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    distance: number;
  }>;
  onFogCreate: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<void>;
  onDrawingCreate: (drawing: {
    points: number[];
    color: string;
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
    patch: { x?: number; y?: number; color?: string },
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
  canvasEditMode?: "BACKGROUND" | "WORLD" | null;
  onCanvasEditCancel?: () => void;
  onCanvasPatch?: (patch: {
    world?: { width: number; height: number };
    backgroundFrame?: { x: number; y: number; width: number; height: number };
  }) => Promise<void>;
}

export type SceneRendererComponent = React.ComponentType<SceneRendererProps>;
