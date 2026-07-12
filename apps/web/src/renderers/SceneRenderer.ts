import type {
  AssetDto,
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
  assets: AssetDto[];
  role: Role;
  membershipId: string;
  socket: GameSocket | null;
  tool: "PAN" | "FOG" | "PING";
  pings: MapPing[];
  onFogCreate: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<void>;
  onPing: (point: { x: number; y: number }) => void;
}

export type SceneRendererComponent = React.ComponentType<SceneRendererProps>;
