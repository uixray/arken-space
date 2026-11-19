// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { renderComponent } from "./test-support/render";
import { useAccessActions, type AccessActions } from "./use-access-actions";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", () => ({ api }));

it("keeps the access domain stable across rerenders and keeps each command's current arguments", async () => {
  const run = vi.fn(async (command: () => Promise<unknown>) => {
    await command();
  });
  const seen: AccessActions[] = [];
  function Harness({ revision }: { revision: number }) {
    seen.push(useAccessActions({ run }));
    return <output>{revision}</output>;
  }

  const { rerender } = renderComponent(<Harness revision={1} />);
  rerender(<Harness revision={2} />);
  expect(seen).toHaveLength(2);
  expect(seen[1]).toBe(seen[0]);
  for (const key of Object.keys(seen[0]!) as Array<keyof AccessActions>) {
    expect(typeof seen[1]![key]).toBe("function");
    expect(seen[1]![key]).toBe(seen[0]![key]);
  }

  const invite = { id: "grant", secret: "synthetic-invite" };
  const rotated = { id: "grant", secret: "synthetic-rotation" };
  api
    .mockResolvedValueOnce(invite)
    .mockResolvedValueOnce([invite])
    .mockResolvedValueOnce(rotated)
    .mockResolvedValue(undefined);
  const access = seen[1]!;
  expect(await access.onCreateInvite("current-sheet", "  Player label  ")).toBe(
    invite,
  );
  expect(await access.onListPlayerAccess()).toEqual([invite]);
  expect(await access.onRotatePlayerAccess("current-grant", 9)).toBe(rotated);
  expect(run).not.toHaveBeenCalled();

  await access.onRevokePlayerAccess("current-grant");
  await access.onRenameMembership("current-member", 11, "New label");
  expect(run).toHaveBeenCalledTimes(2);

  const ids = new Set();
  const trace = api.mock.calls.map(([path, request]) => {
    if (!request) return { path };
    const { actionId, ...body } = JSON.parse(request.body);
    expect(actionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    ids.add(actionId);
    return { path, method: request.method, body };
  });
  expect(ids.size).toBe(4);
  expect(trace).toEqual([
    {
      path: "/api/invites",
      method: "POST",
      body: {
        characterId: "current-sheet",
        label: "  Player label  ",
        expiresInHours: 168,
      },
    },
    { path: "/api/player-access" },
    {
      path: "/api/player-access/current-grant/rotate",
      method: "POST",
      body: { revision: 9 },
    },
    {
      path: "/api/player-access/current-grant/revoke",
      method: "POST",
      body: {},
    },
    {
      path: "/api/memberships/current-member/name",
      method: "PATCH",
      body: { revision: 11, name: "New label" },
    },
  ]);
});
