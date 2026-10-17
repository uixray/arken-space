import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  EncounterDto,
  GameSnapshot,
  InitiativeParticipantDto,
} from "@arken/contracts";
import { ActivityInitiativePanel } from "../src/sidebar/ActivityInitiativePanel";
import {
  gmSnapshot,
  playerSnapshot,
} from "../src/test-support/game-snapshot-fixtures";
// Match production's `main.tsx` import order: feature/component CSS (including
// Input.css) is loaded before the global token/foundation/styles layers.
import "../src/design-system/tokens.generated.css";
import "../src/ui/theme-root.css";
import "../src/design-system/foundations.css";
import "../src/ui/gravity-foundation.css";
import "../src/styles.css";
import "../src/mobile-foundation.css";

const ids = {
  campaign: "00000000-0000-4000-8000-000000000001",
  foreignCampaign: "00000000-0000-4000-8000-000000000002",
  scene: "00000000-0000-4000-8000-000000000003",
  linkedScene: "00000000-0000-4000-8000-000000000004",
  region: "00000000-0000-4000-8000-000000000005",
};

function activeEncounter(overrides: Partial<EncounterDto> = {}): EncounterDto {
  return {
    id: "00000000-0000-4000-8000-000000000006",
    campaignId: ids.campaign,
    sequence: 1,
    status: "ACTIVE",
    mode: "SCENE_REGION",
    sourceSceneId: ids.scene,
    targetSceneId: ids.scene,
    focusRegion: { x: 1, y: 2, width: 30, height: 40 },
    locationId: null,
    sourceSceneRevision: 1,
    initiatorMembershipId: "member-under-test",
    revision: 1,
    startedAt: "2026-10-11T10:00:00.000Z",
    endedAt: null,
    endedByMembershipId: null,
    createdAt: "2026-10-11T10:00:00.000Z",
    updatedAt: "2026-10-11T10:00:00.000Z",
    ...overrides,
  };
}

const playerRow: InitiativeParticipantDto = {
  id: "participant-self",
  tokenId: "token-self",
  name: "Игрок",
  ownName: null,
  initiative: 7,
  initiativeBonus: 2,
  canEdit: true,
  pinned: false,
};

function snapshotFor(scenario: string): GameSnapshot {
  if (scenario === "gm-prep")
    return gmSnapshot({
      campaign: {
        ...gmSnapshot().campaign,
        id: ids.campaign,
        battleActive: false,
        initiative: [],
      },
      encounters: [],
    });
  if (scenario === "player-inactive")
    return playerSnapshot({
      campaign: {
        ...playerSnapshot().campaign,
        id: ids.campaign,
        battleActive: true,
        initiative: [playerRow],
      },
      encounters: [],
    });
  if (scenario === "player-active")
    return playerSnapshot({
      campaign: {
        ...playerSnapshot().campaign,
        id: ids.campaign,
        // Encounter state is authoritative even if this older flag disagrees.
        battleActive: false,
        initiative: [playerRow],
      },
      encounters: [activeEncounter()],
    });
  if (scenario === "player-linked-scene")
    return playerSnapshot({
      campaign: {
        ...playerSnapshot().campaign,
        id: ids.campaign,
        battleActive: false,
        initiative: [playerRow],
      },
      encounters: [
        activeEncounter({
          mode: "LINKED_SCENE",
          sourceSceneId: ids.scene,
          targetSceneId: ids.linkedScene,
          focusRegion: null,
          revision: 2,
        }),
      ],
      scenes: [
        { id: ids.scene, name: "Сцена A" },
        { id: ids.linkedScene, name: "Сцена B" },
      ] as GameSnapshot["scenes"],
    });
  if (scenario === "player-foreign-encounter")
    return playerSnapshot({
      campaign: {
        ...playerSnapshot().campaign,
        id: ids.campaign,
        battleActive: true,
        initiative: [playerRow],
      },
      encounters: [activeEncounter({ campaignId: ids.foreignCampaign })],
    });
  if (scenario === "player-ended")
    return playerSnapshot({
      campaign: {
        ...playerSnapshot().campaign,
        id: ids.campaign,
        battleActive: true,
        initiative: [playerRow],
      },
      encounters: [
        activeEncounter({
          status: "ENDED",
          endedAt: "2026-10-11T11:00:00.000Z",
        }),
      ],
    });
  throw new Error(`Unknown synthetic scenario: ${scenario}`);
}

function InitiativeBrowserHarness() {
  const [snapshot, setSnapshot] = useState(() => snapshotFor("gm-prep"));
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => {
    const onSnapshot = (event: Event) => {
      const scenario = (event as CustomEvent<string>).detail;
      setSnapshot(snapshotFor(scenario));
    };
    const onRemount = () => setMountKey((key) => key + 1);
    window.addEventListener("uix505:authoritative-snapshot", onSnapshot);
    window.addEventListener("uix505:remount", onRemount);
    return () => {
      window.removeEventListener("uix505:authoritative-snapshot", onSnapshot);
      window.removeEventListener("uix505:remount", onRemount);
    };
  }, []);

  const isGm = snapshot.me.role === "GM";
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
      <h1>UIX-505 isolated initiative lifecycle browser gate</h1>
      <p>
        Synthetic snapshots only — no API, login, campaign data or network
        reconnect.
      </p>
      <button type="button" data-testid="focus-sentinel">
        Scene control focus sentinel
      </button>
      <output data-testid="snapshot-state">
        {snapshot.me.role}:{snapshot.encounters?.[0]?.status ?? "NO_ENCOUNTER"}:
        {snapshot.encounters?.[0]?.targetSceneId ?? "NO_TARGET"}
      </output>
      <h2 id="chat-tab-activity">События</h2>
      <section
        className="chat-panel activity-feed"
        data-testid="activity-chat-context"
        role={isGm ? "region" : "tabpanel"}
        id="chat-panel-activity"
        aria-label={isGm ? "События" : undefined}
        aria-labelledby={isGm ? undefined : "chat-tab-activity"}
      >
        <div data-testid="initiative-slot">
          <ActivityInitiativePanel
            key={mountKey}
            snapshot={snapshot}
            selectedTokenIds={isGm ? ["token-prep"] : []}
            onUpdateInitiative={async () => undefined}
            onSetOwnInitiative={async () => undefined}
            onRollInitiative={async () => undefined}
          />
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <InitiativeBrowserHarness />,
);
