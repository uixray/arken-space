import { createRoot } from "react-dom/client";
import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import type { CampaignActions } from "../src/campaign-actions-context";
import { CampaignActionsContext } from "../src/campaign-actions-context";
import { CharacterPanel } from "../src/sidebar/CharacterWorkspace";
import { playerSnapshot } from "../src/test-support/game-snapshot-fixtures";
// Mirror main.tsx production cascade/order after the component graph is loaded.
import "../src/design-system/tokens.generated.css";
import "../src/ui/theme-root.css";
import "../src/design-system/foundations.css";
import "../src/ui/gravity-foundation.css";
import "../src/styles.css";
import "../src/mobile-foundation.css";

const memberId = "member-under-test";
const layout = playerSnapshot().campaign.statLayout;
const character = {
  id: "character-layout-browser",
  name: "Проверка раскладки",
  ownerMembershipId: memberId,
  controllerMembershipIds: [],
  portraitAssetId: null,
  stats: {
    strength: 3,
    dexterity: 2,
    constitution: 4,
    intelligence: 1,
    wisdom: 2,
    charisma: 3,
    health: 12,
    armor: 2,
    initiative: 1,
    reaction: 1,
  },
  skills: [
    { key: "athletics", name: "Атлетика", rank: 2, formula: "strength" },
    { key: "awareness", name: "Внимательность", rank: 2, formula: "wisdom" },
    { key: "survival", name: "Выживание", rank: 1, formula: "constitution" },
  ],
  spells: [
    {
      key: "test-spell",
      name: "Искра",
      description: "Проверка реальной карточки способности.",
      formula: "intelligence",
    },
  ],
  notes: "",
  backstory: "",
  inventory: [],
  resources: {},
  wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
  entries: [],
  revision: 1,
  lifecycle: "ACTIVE",
  archivedAt: null,
  archivedByMembershipId: null,
  statLayout: layout,
} as unknown as CharacterDto;
const snapshot = playerSnapshot({ characters: [character] }) as GameSnapshot;
// Fail-closed typed context: rendering may inspect any action group, but this
// geometry-only harness must never contact an API or issue a campaign command.
const noAction = new Proxy(() => undefined, {
  get: (_target, property) => (property === "then" ? undefined : noAction),
}) as unknown as CampaignActions;

function Harness() {
  return (
    <main id="qa-frame" data-testid="qa-frame">
      <CharacterPanel
        snapshot={snapshot}
        character={character}
        selectedId={character.id}
        setSelectedId={() => {}}
        showCharacterPicker={false}
        onPatch={async () => undefined}
        onReplaceControllers={async () => undefined}
        onRoll={async () => undefined}
        onUpdateCounters={async () => undefined}
      />
    </main>
  );
}

const style = document.createElement("style");
style.textContent = `
  html, body, #root { margin: 0; min-height: 100%; }
  body { padding: 0; }
  #qa-frame { box-sizing: border-box; width: calc(100vw - 32px); max-width: 900px; margin: 16px auto; }
  @media (max-width: 1100px) and (min-width: 541px) { #qa-frame { max-width: 728px; } }
  @media (max-width: 540px) { #qa-frame { width: calc(100vw - 32px); } }
`;
document.head.append(style);
createRoot(document.getElementById("root")!).render(
  <CampaignActionsContext.Provider value={noAction}>
    <Harness />
  </CampaignActionsContext.Provider>,
);
