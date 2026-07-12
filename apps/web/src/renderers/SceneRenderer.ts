import type {
  AssetDto,
  FogRevealDto,
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
  tool: "PAN" | "FOG";
  onFogCreate: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<void>;
}

export type SceneRendererComponent = React.ComponentType<SceneRendererProps>;
