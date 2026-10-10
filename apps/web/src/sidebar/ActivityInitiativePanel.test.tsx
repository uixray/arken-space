// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  EncounterDto,
  GameSnapshot,
  InitiativeParticipantDto,
} from "@arken/contracts";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "../test-support/render";
import {
  gmSnapshot,
  playerSnapshot,
} from "../test-support/game-snapshot-fixtures";
import { ActivityInitiativePanel } from "./ActivityInitiativePanel";

const ids = {
  campaign: "00000000-0000-4000-8000-000000000001",
  foreignCampaign: "00000000-0000-4000-8000-000000000002",
  scene: "00000000-0000-4000-8000-000000000003",
  otherScene: "00000000-0000-4000-8000-000000000004",
  region: "00000000-0000-4000-8000-000000000005",
  location: "00000000-0000-4000-8000-000000000006",
  encounter: "00000000-0000-4000-8000-000000000007",
};

function encounter(overrides: Partial<EncounterDto> = {}): EncounterDto {
  return {
    id: ids.encounter,
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
    startedAt: "2026-10-10T10:00:00.000Z",
    endedAt: null,
    endedByMembershipId: null,
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z",
    ...overrides,
  };
}

function participant(
  overrides: Partial<InitiativeParticipantDto> = {},
): InitiativeParticipantDto {
  return {
    id: "participant-self",
    tokenId: "token-self",
    name: "Участник",
    ownName: null,
    initiative: 7,
    initiativeBonus: 2,
    canEdit: true,
    pinned: false,
    ...overrides,
  };
}

function view(
  snapshot: GameSnapshot,
  overrides: Partial<ComponentProps<typeof ActivityInitiativePanel>> = {},
) {
  return (
    <ActivityInitiativePanel
      snapshot={snapshot}
      selectedTokenIds={[]}
      onUpdateInitiative={vi.fn(async () => undefined)}
      onSetOwnInitiative={vi.fn(async () => undefined)}
      onRollInitiative={vi.fn(async () => undefined)}
      {...overrides}
    />
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Activity initiative visibility and lifecycle", () => {
  it("keeps initiative available to a GM for preparation without encounters", () => {
    const snapshot = gmSnapshot({
      campaign: {
        ...gmSnapshot().campaign,
        id: ids.campaign,
        initiative: [],
        battleActive: false,
      },
      encounters: [],
    });
    renderComponent(view(snapshot, { selectedTokenIds: ["token-prep"] }));
    expect(screen.getByText("Очередь ходов")).toBeInTheDocument();
    expect(screen.getByText("Ввести в бой · 1")).toBeInTheDocument();
  });

  it.each([
    ["missing encounter", []],
    [
      "ended encounter",
      [encounter({ status: "ENDED", endedAt: "2026-10-10T11:00:00.000Z" })],
    ],
    [
      "foreign-campaign encounter",
      [encounter({ campaignId: ids.foreignCampaign })],
    ],
  ])("hides player initiative for %s", (_label, encounters) => {
    const snapshot = playerSnapshot({
      campaign: {
        ...playerSnapshot().campaign,
        id: ids.campaign,
        battleActive: true,
        initiative: [participant()],
      },
      encounters: encounters as EncounterDto[],
    });
    renderComponent(view(snapshot));
    expect(screen.queryByText("Очередь ходов")).not.toBeInTheDocument();
  });

  it("shows an active campaign encounter with an empty roster even when battleActive is false", () => {
    const snapshot = playerSnapshot({
      campaign: {
        ...playerSnapshot().campaign,
        id: ids.campaign,
        battleActive: false,
        initiative: [],
      },
      encounters: [encounter()],
    });
    renderComponent(view(snapshot));
    expect(screen.getByText("Очередь ходов")).toBeInTheDocument();
    expect(
      screen.getByText("Мастер ещё не собрал очередь."),
    ).toBeInTheDocument();
  });

  it("retains the panel for active region and linked-scene encounters", () => {
    const snapshot = playerSnapshot({
      campaign: {
        ...playerSnapshot().campaign,
        id: ids.campaign,
        battleActive: true,
      },
      encounters: [encounter()],
    });
    const rendered = renderComponent(view(snapshot));
    expect(screen.getByText("Очередь ходов")).toBeInTheDocument();

    const linked = encounter({
      mode: "LINKED_SCENE",
      sourceSceneId: ids.scene,
      targetSceneId: ids.otherScene,
      focusRegion: null,
      locationId: ids.location,
      revision: 2,
    });
    rendered.rerender(
      view({
        ...snapshot,
        campaign: { ...snapshot.campaign, battleActive: false },
        encounters: [linked],
      }),
    );
    expect(screen.getByText("Очередь ходов")).toBeInTheDocument();
  });

  it("shows server-authorized edit controls only for the player's own row", () => {
    const snapshot = playerSnapshot({
      campaign: {
        ...playerSnapshot().campaign,
        id: ids.campaign,
        initiative: [
          participant(),
          participant({
            id: "participant-other",
            tokenId: "token-other",
            name: "Чужая строка",
            canEdit: false,
          }),
        ],
      },
      encounters: [encounter()],
    });
    renderComponent(view(snapshot));
    expect(screen.getByLabelText("Инициатива «Участник»")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Инициатива «Чужая строка»"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Ввести в бой")).not.toBeInTheDocument();
  });

  it("forwards the current campaign revision with the server-owned player edit", async () => {
    const snapshot = playerSnapshot({
      campaign: {
        ...playerSnapshot().campaign,
        id: ids.campaign,
        revision: 42,
        initiative: [participant()],
      },
      encounters: [encounter()],
    });
    const save = vi.fn(async () => undefined);
    renderComponent(view(snapshot, { onSetOwnInitiative: save }));
    const input = screen.getByLabelText("Инициатива «Участник»");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith("participant-self", 9, 42);
  });

  it("skips a queued callback when its member scope changes before dispatch", async () => {
    const snapshot = playerSnapshot({
      campaign: {
        ...playerSnapshot().campaign,
        id: ids.campaign,
        initiative: [participant()],
      },
      encounters: [encounter()],
    });
    const save = vi.fn(async () => undefined);
    const rendered = renderComponent(
      view(snapshot, { onSetOwnInitiative: save }),
    );
    const next = { ...snapshot, me: { ...snapshot.me, id: "next-member" } };
    const input = screen.getByLabelText("Инициатива «Участник»");

    await act(async () => {
      fireEvent.change(input, { target: { value: "9" } });
      fireEvent.blur(input);
      rendered.rerender(view(next, { onSetOwnInitiative: save }));
      await Promise.resolve();
    });

    expect(save).not.toHaveBeenCalled();
  });

  it("does not optimistically change the roster, blocks duplicate requests, and reports rejection", async () => {
    const snapshot = gmSnapshot({
      campaign: {
        ...gmSnapshot().campaign,
        id: ids.campaign,
        initiative: [participant()],
      },
      encounters: [],
    });
    const save = vi.fn(() => pending.promise);
    const pending = deferred<void>();
    renderComponent(view(snapshot, { onUpdateInitiative: save }));
    const remove = screen.getByLabelText("Вывести «Участник» из боя");
    fireEvent.click(remove);
    fireEvent.click(remove);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(
      expect.any(Array),
      snapshot.campaign.revision,
    );
    expect(remove).toBeDisabled();
    expect(screen.getByText("Участник")).toBeInTheDocument();
    await act(async () => pending.reject(new Error("Не удалось сохранить")));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось сохранить",
    );
    expect(screen.getByText("Участник")).toBeInTheDocument();
  });

  it.each(["campaign", "member", "encounter"] as const)(
    "ignores a stale rejection after the %s scope changes",
    async (changedScope) => {
      const initial = playerSnapshot({
        campaign: {
          ...playerSnapshot().campaign,
          id: ids.campaign,
          initiative: [participant()],
        },
        encounters: [encounter()],
      });
      const pending = deferred<void>();
      const save = vi.fn(() => pending.promise);
      const rendered = renderComponent(
        view(initial, { onSetOwnInitiative: save }),
      );
      const input = screen.getByLabelText("Инициатива «Участник»");
      fireEvent.change(input, { target: { value: "9" } });
      fireEvent.blur(input);
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

      let next: typeof initial;
      if (changedScope === "campaign") {
        next = {
          ...initial,
          campaign: { ...initial.campaign, id: ids.foreignCampaign },
        };
      } else if (changedScope === "member") {
        next = { ...initial, me: { ...initial.me, id: "next-member" } };
      } else {
        next = {
          ...initial,
          encounters: [
            encounter({ revision: 2, sourceSceneId: ids.otherScene }),
          ],
        };
      }
      rendered.rerender(view(next, { onSetOwnInitiative: save }));
      await act(async () => pending.reject(new Error("stale rejection")));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("remounts and rerenders for ACTIVE then hides after ENDED", () => {
    const active = playerSnapshot({
      campaign: { ...playerSnapshot().campaign, id: ids.campaign },
      encounters: [encounter()],
    });
    const rendered = renderComponent(view(active));
    expect(screen.getByText("Очередь ходов")).toBeInTheDocument();
    const ended = { ...active, encounters: [encounter({ status: "ENDED" })] };
    rendered.rerender(view(ended));
    expect(screen.queryByText("Очередь ходов")).not.toBeInTheDocument();
    rendered.unmount();
    renderComponent(view(active));
    expect(screen.getByText("Очередь ходов")).toBeInTheDocument();
  });
});
