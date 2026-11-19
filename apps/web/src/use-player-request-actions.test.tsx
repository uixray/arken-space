// @vitest-environment jsdom
import type { GameSnapshot, PlayerRequestDto } from "@arken/contracts";
import { expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { act, renderComponent } from "./test-support/render";
import { playerSnapshot } from "./test-support/game-snapshot-fixtures";
import {
  usePlayerRequestActions,
  type PlayerRequestActions,
} from "./use-player-request-actions";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api,
}));

it("keeps actions stable, projects successful revisions and reloads only on conflict", async () => {
  const initial = playerSnapshot();
  let snapshot: GameSnapshot | null = initial;
  const setSnapshot = vi.fn(
    (update: React.SetStateAction<GameSnapshot | null>) => {
      snapshot = typeof update === "function" ? update(snapshot) : update;
    },
  );
  const load = vi.fn(async () => {});
  const openPlayerRequests = vi.fn();
  const seen: PlayerRequestActions[] = [];
  function Harness({ epoch }: { epoch: number }) {
    seen.push(
      usePlayerRequestActions({ setSnapshot, load, openPlayerRequests }),
    );
    return <output>{epoch}</output>;
  }
  const { rerender } = renderComponent(<Harness epoch={0} />);
  rerender(<Harness epoch={1} />);
  const actions = seen[0]!;
  expect(seen[1]).toBe(actions);
  for (const key of Object.keys(actions) as Array<keyof PlayerRequestActions>) {
    expect(typeof seen[1]![key]).toBe("function");
    expect(seen[1]![key]).toBe(actions[key]);
  }
  actions.onOpenPlayerRequestCreate();
  expect(openPlayerRequests).toHaveBeenCalledOnce();
  const input = {
    title: "Open gate",
    body: "Ask the keeper",
    horizon: "NOW",
    audience: "PUBLIC",
    characterId: null,
  } as const;
  const created: PlayerRequestDto = {
    ...input,
    id: "request",
    campaignId: initial.campaign.id,
    authorMembershipId: initial.me.id,
    authorDisplayName: "Synthetic",
    characterName: null,
    status: "SUBMITTED",
    resolutionNote: null,
    resolvedByMembershipId: null,
    resolvedByDisplayName: null,
    revision: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const edit = { title: "Open north gate", body: "Ask the night keeper" };
  const updated = { ...created, ...edit, revision: 2 };
  const conflict = new ApiError(409, "SYNTHETIC_CONFLICT", "Conflict");
  const offline = new Error("Synthetic network failure");
  api
    .mockResolvedValueOnce(created)
    .mockResolvedValueOnce(updated)
    .mockRejectedValueOnce(conflict)
    .mockRejectedValueOnce(offline);
  await act(async () => {
    await actions.onCreatePlayerRequest(input);
    await actions.onUpdatePlayerRequest(created, edit);
    await expect(
      actions.onPlayerRequestAction(updated, "RESOLVE", "Keeper agreed"),
    ).rejects.toBe(conflict);
    await expect(
      actions.onPlayerRequestAction(updated, "CANCEL", ""),
    ).rejects.toBe(offline);
  });
  expect(snapshot?.playerRequests).toEqual([updated]);
  expect(setSnapshot).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenCalledOnce();
  const ids = new Set<string>();
  expect(
    api.mock.calls.map(([path, request]) => {
      const { actionId, ...body } = JSON.parse(request.body);
      expect(actionId).toMatch(/^[0-9a-f-]{36}$/i);
      ids.add(actionId);
      return [path, request.method, body];
    }),
  ).toEqual([
    ["/api/player-requests", "POST", input],
    ["/api/player-requests/request", "PATCH", { ...edit, revision: 1 }],
    [
      "/api/player-requests/request/actions",
      "POST",
      { revision: 2, action: "RESOLVE", resolutionNote: "Keeper agreed" },
    ],
    [
      "/api/player-requests/request/actions",
      "POST",
      { revision: 2, action: "CANCEL" },
    ],
  ]);
  expect(ids.size).toBe(4);
});
