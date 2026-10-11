// @vitest-environment jsdom
import type { ComponentProps } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { ThemeProvider } from "@gravity-ui/uikit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CampaignActionsContext,
  type CampaignActions,
} from "../campaign-actions-context";
import {
  gmSnapshot,
  playerSnapshot,
} from "../test-support/game-snapshot-fixtures";
import { installMatchMediaMock } from "../test-support/dom-mocks";
import { renderComponent, screen, waitFor } from "../test-support/render";
import { ActivityPanel } from "./ChatPanels";

const activeEncounter = {
  id: "00000000-0000-4000-8000-000000000007",
  campaignId: "campaign-under-test",
  sequence: 1,
  status: "ACTIVE" as const,
  mode: "LINKED_SCENE" as const,
  sourceSceneId: "00000000-0000-4000-8000-000000000003",
  targetSceneId: "00000000-0000-4000-8000-000000000004",
  focusRegion: null,
  locationId: "00000000-0000-4000-8000-000000000006",
  sourceSceneRevision: 1,
  initiatorMembershipId: "member-under-test",
  revision: 1,
  startedAt: "2026-10-10T10:00:00.000Z",
  endedAt: null,
  endedByMembershipId: null,
  createdAt: "2026-10-10T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z",
};

const campaignActions = {
  catalog: { onRollEntry: async () => undefined },
} as unknown as CampaignActions;

function mount(
  snapshot: GameSnapshot,
  overrides: Partial<ComponentProps<typeof ActivityPanel>> = {},
) {
  const props: ComponentProps<typeof ActivityPanel> = {
    snapshot,
    storyPosts: [],
    activityFilters: new Set(["ROLLS", "STORY", "REFERENCE"]),
    onActivityFiltersChange: () => undefined,
    onChat: async () => undefined,
    onSticker: async () => undefined,
    onRoll: async () => undefined,
    focusedMessageId: null,
    onMessageFocused: () => undefined,
    onOpenPlayerRequestCreate: () => undefined,
    onUpdateCounters: async () => undefined,
    selectedTokenIds: [],
    onUpdateInitiative: async () => undefined,
    onSetOwnInitiative: async () => undefined,
    onRollInitiative: async () => undefined,
    ...overrides,
  };
  return renderComponent(
    <ThemeProvider theme="dark" lang="ru">
      <CampaignActionsContext.Provider value={campaignActions}>
        <ActivityPanel {...props} />
      </CampaignActionsContext.Provider>
    </ThemeProvider>,
  );
}

beforeEach(() => installMatchMediaMock());

describe("ActivityPanel initiative integration", () => {
  it("places an active-encounter initiative panel before quick activity controls", () => {
    const snapshot = playerSnapshot({
      campaign: {
        ...playerSnapshot().campaign,
        initiative: [],
        battleActive: false,
      },
      encounters: [activeEncounter],
    });
    mount(snapshot);
    const panel = screen
      .getByText("Очередь ходов")
      .closest(".activity-initiative-panel");
    const quickControls = screen.getByRole("region", {
      name: "Быстрые броски и ресурсы",
    });
    expect(panel).not.toBeNull();
    expect(
      panel!.compareDocumentPosition(quickControls) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps GM preparation initiative and recruit callback in Activity without an encounter", async () => {
    const snapshot = gmSnapshot({
      campaign: {
        ...gmSnapshot().campaign,
        initiative: [],
        battleActive: false,
      },
      encounters: [],
    });
    const recruit = vi.fn();
    mount(snapshot, { onRecruitFromBattleZone: recruit });
    expect(screen.getByText("Очередь ходов")).toBeInTheDocument();
    expect(
      screen.getByText("Обведите зону боя на карте или выделите рамкой тех, кто вступает в бой."),
    ).toBeInTheDocument();
    screen.getByRole("button", { name: "Обновить по зоне" }).click();
    await waitFor(() => expect(recruit).toHaveBeenCalledTimes(1));
  });
});
