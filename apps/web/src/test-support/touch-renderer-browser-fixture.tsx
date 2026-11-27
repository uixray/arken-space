import { useState } from "react";
import { createRoot } from "react-dom/client";
import Konva from "konva";
import type { SceneDto, TokenDto } from "@arken/contracts";
import type { GameSocket } from "../realtime";
import { Orthographic2DRenderer } from "../renderers/Orthographic2DRenderer";
import type { MapTool } from "../renderers/map-interaction";
import "../design-system/tokens.generated.css";
import "../ui/theme-root.css";
import "../design-system/foundations.css";
import "../styles.css";

declare global {
  interface Window {
    __touchTokenPoint?: () => { x: number; y: number } | null;
    __touchRulerEvents?: string[];
    __touchDraftLines?: (stroke: string) => number;
  }
}
const scene: SceneDto = {
  id: "scene",
  name: "Synthetic",
  projection: "ORTHOGRAPHIC_2D",
  mapAssetId: null,
  width: 900,
  height: 600,
  backgroundFrame: { x: 0, y: 0, width: 900, height: 600 },
  grid: {
    enabled: false,
    size: 64,
    offsetX: 0,
    offsetY: 0,
    color: "#ffffff",
    opacity: 0.5,
  },
  active: true,
};
function Fixture() {
  const mode = new URLSearchParams(location.search).get("mode") ?? "controlled";
  const requestedTool = new URLSearchParams(location.search).get("tool");
  const tool: MapTool =
    requestedTool === "DRAW" ||
    requestedTool === "RULER" ||
    requestedTool === "FOG_BRUSH"
      ? requestedTool
      : "PAN";
  const [commits, setCommits] = useState(0);
  const [draws, setDraws] = useState(0),
    [fog, setFog] = useState(0);
  const token: TokenDto = {
    id: "token",
    definitionId: "definition",
    definitionRevision: 1,
    controllerMembershipIds: mode === "foreign" ? ["other"] : ["player"],
    sceneId: scene.id,
    characterId: null,
    ownerMembershipId: null,
    assetId: null,
    name: "Test token",
    x: 360,
    y: 250,
    z: 0,
    levelId: null,
    width: 100,
    height: 100,
    rotation: 0,
    visible: true,
    locked: mode === "locked",
    baseColor: "#ab6241",
    frameColor: null,
    layer: "PLAYER",
    conditions: [],
    revision: 1,
  };
  window.__touchTokenPoint = () => {
    for (const stage of Konva.stages) {
      const node = stage.findOne(
        (n: Konva.Node) => n.getAttr("touchTokenId") === token.id,
      );
      if (!node) continue;
      const rect = node.getClientRect(),
        container = stage.container().getBoundingClientRect();
      return {
        x: container.left + rect.x + rect.width / 2,
        y: container.top + rect.y + rect.height / 2,
      };
    }
    return null;
  };
  window.__touchRulerEvents ??= [];
  window.__touchDraftLines = (stroke) =>
    Konva.stages
      .flatMap((stage) => stage.find("Line"))
      .filter(
        (node) =>
          node.getAttr("stroke") === stroke &&
          (node.getAttr("points")?.length ?? 0) >= 4,
      ).length;
  const socket = {
    connected: true,
    on: () => {},
    off: () => {},
    emit: (event: string) => window.__touchRulerEvents?.push(event),
  } as unknown as GameSocket;
  return (
    <>
      <output data-testid="commits">{commits}</output>
      <output data-testid="draws">{draws}</output>
      <output data-testid="fog">{fog}</output>
      <main style={{ width: "min(900px, 95vw)", height: "70vh" }}>
        <Orthographic2DRenderer
          scene={scene}
          tokens={[token]}
          fogReveals={[
            {
              id: "clear",
              sceneId: scene.id,
              x: 0,
              y: 0,
              width: 900,
              height: 600,
              operation: "REVEAL",
            },
          ]}
          drawings={[]}
          assets={[]}
          role={tool === "FOG_BRUSH" ? "GM" : "PLAYER"}
          membershipId="player"
          socket={socket}
          paused={mode === "paused"}
          tool={tool}
          onToolSelect={() => {}}
          pings={[]}
          cursors={[]}
          cursorSendEnabled={false}
          cursorShared={false}
          rulers={[]}
          onFogCreate={async () => {
            setFog((n) => n + 1);
          }}
          onDrawingCreate={async () => {
            setDraws((n) => n + 1);
          }}
          onPing={() => {}}
          onBulkMove={async () => {
            setCommits((n) => n + 1);
            return { revisions: { tokens: {}, drawings: {} } };
          }}
        />
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
