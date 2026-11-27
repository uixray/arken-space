import { createRoot } from "react-dom/client";
import Konva from "konva";
import type { GameSnapshot, SceneDto, TokenDto } from "@arken/contracts";
import { AbilityAreaPanel } from "../AbilityAreaPanel";
import { useAbilityArea } from "../use-ability-area";
import { Orthographic2DRenderer } from "../renderers/Orthographic2DRenderer";
import "../design-system/tokens.generated.css";
import "../ui/theme-root.css";
import "../design-system/foundations.css";
import "../styles.css";
import "../mobile-foundation.css";
declare global {
  interface Window {
    __areaCircles?: () => Array<{ radius: number; x: number; y: number }>;
  }
}
const ids = {
  campaign: "00000000-0000-4000-8000-000000000001",
  member: "00000000-0000-4000-8000-000000000002",
  character: "00000000-0000-4000-8000-000000000003",
  scene: "00000000-0000-4000-8000-000000000004",
  token: "00000000-0000-4000-8000-000000000005",
  entry: "00000000-0000-4000-8000-000000000006",
};
const scene: SceneDto = {
  id: ids.scene,
  name: "QA",
  projection: "ORTHOGRAPHIC_2D",
  mapAssetId: null,
  width: 900,
  height: 600,
  backgroundFrame: { x: 0, y: 0, width: 900, height: 600 },
  grid: {
    enabled: true,
    size: 20,
    offsetX: 0,
    offsetY: 0,
    color: "#ffffff",
    opacity: 0.2,
    metersPerCell: 1,
  },
  active: true,
};
const token: TokenDto = {
  id: ids.token,
  definitionId: ids.token,
  definitionRevision: 0,
  controllerMembershipIds: [ids.member],
  sceneId: ids.scene,
  characterId: ids.character,
  ownerMembershipId: ids.member,
  assetId: null,
  name: "Герой",
  x: 400,
  y: 250,
  z: 0,
  levelId: null,
  width: 40,
  height: 40,
  rotation: 0,
  visible: true,
  locked: false,
  baseColor: "#ab6241",
  frameColor: null,
  layer: "PLAYER",
  conditions: [],
  revision: 0,
};
const snapshot = {
  campaign: { id: ids.campaign, paused: false },
  me: { id: ids.member, role: "PLAYER" },
  tokens: [token],
  characters: [
    {
      id: ids.character,
      name: "Герой",
      lifecycle: "ACTIVE",
      ownerMembershipId: ids.member,
      controllerMembershipIds: [],
      entries: [
        {
          id: ids.entry,
          name: "Лучезарный",
          kind: "ABILITY",
          revision: 0,
          data: {
            areaEffect: {
              kind: "RESTORE_MANA",
              radiusMeters: 15,
              origin: "CASTER",
              targets: "PLAYER_CHARACTERS",
              dice: "1d6",
              includeCaster: true,
            },
          },
        },
      ],
    },
  ],
} as unknown as GameSnapshot;
function Fixture() {
  const area = useAbilityArea({
    snapshot,
    scene,
    previewing: false,
    editingGrid: false,
    load: async () => {},
    setError: () => {},
    onOpen: () => {},
  });
  window.__areaCircles = () =>
    Konva.stages
      .flatMap((stage) => stage.find("Circle"))
      .filter(
        (node): node is Konva.Circle =>
          node instanceof Konva.Circle && node.stroke() === "#65c8ff",
      )
      .map((node) => ({ radius: node.radius(), x: node.x(), y: node.y() }));
  return (
    <>
      <button onClick={() => area.prepare(ids.character, ids.entry, 0)}>
        Показать область
      </button>
      <AbilityAreaPanel area={area} isGm={false} recoveryOnly />
      <AbilityAreaPanel area={area} isGm={false} />
      <main style={{ width: "min(900px,95vw)", height: "60vh" }}>
        <Orthographic2DRenderer
          scene={scene}
          tokens={[token]}
          fogReveals={[]}
          drawings={[]}
          assets={[]}
          role="PLAYER"
          membershipId={ids.member}
          socket={null}
          tool="PAN"
          onToolSelect={() => {}}
          pings={[]}
          cursors={[]}
          cursorSendEnabled={false}
          cursorShared={false}
          rulers={[]}
          abilityAreaPreview={area.preview}
          onFogCreate={async () => {}}
          onDrawingCreate={async () => {}}
          onPing={() => {}}
        />
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
