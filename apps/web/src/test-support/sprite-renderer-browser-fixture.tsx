import { useState } from "react";
import { createRoot } from "react-dom/client";
import Konva from "konva";
import type { AssetDto, SceneDto, TokenDto } from "@arken/contracts";
import { Orthographic2DRenderer } from "../renderers/Orthographic2DRenderer";
import "../design-system/tokens.generated.css";
import "../ui/theme-root.css";
import "../design-system/foundations.css";
import "../styles.css";
import "../mobile-foundation.css";
declare global {
  interface Window {
    __spriteImages?: () => string[];
    __spriteCoin?: () => boolean;
  }
}
const scene: SceneDto = {
  id: "scene",
  name: "QA",
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
    opacity: 0.2,
  },
  active: true,
};
const frames = [
  { pose: "IDLE" as const, direction: "FRONT" as const, assetId: "front" },
  { pose: "IDLE" as const, direction: "RIGHT" as const, assetId: "right" },
  { pose: "PRONE" as const, direction: "FRONT" as const, assetId: "prone" },
];
const assets: AssetDto[] = frames.map((f) => ({
  id: f.assetId,
  kind: "TOKEN",
  name: f.assetId,
  mimeType: "image/webp",
  sizeBytes: 32,
  width: 512,
  height: 512,
  durationSeconds: null,
  url: `/synthetic-sprite/${f.assetId}.webp`,
  createdAt: new Date(0).toISOString(),
}));
function Fixture() {
  const [facing, setFacing] = useState<"FRONT" | "RIGHT">("FRONT"),
    [prone, setProne] = useState(false);
  const token: TokenDto = {
    id: "token",
    definitionId: "definition",
    definitionRevision: 1,
    controllerMembershipIds: ["player"],
    sceneId: scene.id,
    characterId: null,
    ownerMembershipId: null,
    assetId: null,
    name: "QA token",
    x: 360,
    y: 250,
    z: 0,
    levelId: null,
    width: 100,
    height: 100,
    rotation: 0,
    visible: true,
    locked: false,
    baseColor: "#ab6241",
    frameColor: null,
    layer: "PLAYER",
    conditions: prone ? ["PRONE"] : [],
    revision: 1,
    facing,
    spriteSet: { version: 1, pivot: { x: 0.5, y: 1 }, frames },
  };
  window.__spriteImages = () =>
    Konva.stages
      .flatMap((stage) => stage.find("Image"))
      .flatMap((node) => {
        if (!(node instanceof Konva.Image)) return [];
        const image = node.image();
        return image instanceof HTMLImageElement
          ? [new URL(image.src).pathname]
          : [];
      });
  window.__spriteCoin = () =>
    Konva.stages.some((stage) =>
      stage
        .find("Circle")
        .some(
          (node) => node instanceof Konva.Circle && node.fill() === "#ab6241",
        ),
    );
  return (
    <>
      <button onClick={() => setFacing("RIGHT")}>Направо</button>
      <button onClick={() => setProne(true)}>Лежать</button>
      <main style={{ width: "min(900px,95vw)", height: "70vh" }}>
        <Orthographic2DRenderer
          scene={scene}
          tokens={[token]}
          fogReveals={[]}
          drawings={[]}
          assets={assets}
          role="GM"
          membershipId="player"
          socket={null}
          tool="PAN"
          onToolSelect={() => {}}
          pings={[]}
          cursors={[]}
          cursorSendEnabled={false}
          cursorShared={false}
          rulers={[]}
          onFogCreate={async () => {}}
          onDrawingCreate={async () => {}}
          onPing={() => {}}
        />
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
