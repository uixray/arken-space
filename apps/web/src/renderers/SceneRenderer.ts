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

export interface SceneRendererProps {
  scene: SceneDto;
  tokens: TokenDto[];
  fogReveals: FogRevealDto[];
  drawings: DrawingDto[];
  assets: AssetDto[];
  role: Role;
  membershipId: string;
  socket: GameSocket | null;
  tool: "PAN" | "FOG" | "COVER" | "DRAW" | "RULER" | "PING";
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
  gmFogOpacity?: number;
  gmFogVisible?: boolean;
  canvasEditMode?: "BACKGROUND" | "WORLD" | null;
  onCanvasEditCancel?: () => void;
  onCanvasPatch?: (patch: {
    world?: { width: number; height: number };
    backgroundFrame?: { x: number; y: number; width: number; height: number };
  }) => Promise<void>;
}

export type SceneRendererComponent = React.ComponentType<SceneRendererProps>;
