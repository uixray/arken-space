import { describe, expect, it, vi } from "vitest";
import type { TokenDto } from "@arken/contracts";
import { OptimisticTokenMutations } from "./optimistic-token-mutations";

const token = { id: "one", revision: 3, conditions: [] } as unknown as TokenDto;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setup(
  sendConditions = vi
    .fn()
    .mockResolvedValue({ revision: 4, conditions: ["POISONED"] }),
) {
  let canonical = token;
  const onError = vi.fn();
  const reloadToken = vi.fn(async () => canonical);
  const acceptToken = vi.fn((next: TokenDto) => {
    canonical = next;
  });
  const manager = new OptimisticTokenMutations({
    readToken: () => canonical,
    acceptToken,
    sendConditions,
    reloadToken,
    onError,
  });
  return {
    manager,
    acceptToken,
    reloadToken,
    onError,
    canonical: () => canonical,
  };
}

describe("optimistic token intents", () => {
  it("reconciles snapshot before HTTP ack by exact placement ID, not coordinates", async () => {
    const response = deferred<TokenDto>();
    const { manager } = setup();
    manager.place({ ...token, id: "pending:created" }, () => response.promise);
    manager.place(
      { ...token, id: "pending:another" },
      () => new Promise(() => undefined),
    );
    const broadcast = { ...token, id: "created", revision: 1 };
    expect(manager.project([broadcast]).map((item) => item.id)).toEqual([
      "created",
      "pending:another",
    ]);
    response.resolve(broadcast);
    await settle();
    expect(manager.project([broadcast]).map((item) => item.id)).toEqual([
      "created",
      "pending:another",
    ]);
    manager.reset();
  });
  it("ignores in-flight replies after a session reset", async () => {
    const placement = deferred<TokenDto>();
    const conditions = deferred<TokenDto>();
    const { manager, acceptToken, onError } = setup(
      vi.fn().mockReturnValue(conditions.promise),
    );
    manager.place({ ...token, id: "pending:old" }, () => placement.promise);
    manager.setConditions("one", ["POISONED"]);
    await settle();
    manager.reset();
    placement.resolve({ ...token, id: "old-session" });
    conditions.resolve({ ...token, revision: 4, conditions: ["POISONED"] });
    await settle();
    expect(acceptToken).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(manager.project([token])).toEqual([token]);
  });
  it("paints every placement before either delayed request resolves and rolls back only the rejected one", async () => {
    const first = deferred<TokenDto>();
    const second = deferred<TokenDto>();
    const { manager, onError } = setup();
    const firstOutcome = manager.place(
      { ...token, id: "pending:first" },
      () => first.promise,
    );
    const secondOutcome = manager.place(
      { ...token, id: "pending:second" },
      () => second.promise,
    );
    expect(manager.project([]).map((item) => item.id)).toEqual([
      "pending:first",
      "pending:second",
    ]);
    const reason = new Error("forbidden");
    first.reject(reason);
    await expect(firstOutcome).resolves.toEqual({ status: "failed", reason });
    expect(manager.project([]).map((item) => item.id)).toEqual([
      "pending:second",
    ]);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(reason);
    second.resolve({ ...token, id: "saved" });
    await expect(secondOutcome).resolves.toEqual({ status: "accepted" });
    expect(manager.project([])).toEqual([]);
  });

  it("returns the original rejection only to its awaiting owner without a duplicate shared error", async () => {
    const response = deferred<TokenDto>();
    const { manager, onError, acceptToken } = setup();
    const outcome = manager.place(
      { ...token, id: "pending:owned" },
      () => response.promise,
      { errorOwner: "caller" },
    );
    expect(manager.project([])).toHaveLength(1);
    const reason = new Error("offline");
    response.reject(reason);
    await expect(outcome).resolves.toEqual({ status: "failed", reason });
    expect(manager.project([])).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
    expect(acceptToken).not.toHaveBeenCalled();
  });

  it("cancels a reset placement before its send microtask without reporting success", async () => {
    const { manager, onError, acceptToken } = setup();
    const send = vi.fn().mockResolvedValue(token);
    const outcome = manager.place({ ...token, id: "pending:old" }, send);
    manager.reset();
    await expect(outcome).resolves.toEqual({ status: "cancelled" });
    expect(send).not.toHaveBeenCalled();
    expect(acceptToken).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(["accepted", "failed"] as const)(
    "makes a stale %s reply inert without removing a new session's placement",
    async (reply) => {
      const old = deferred<TokenDto>();
      const fresh = deferred<TokenDto>();
      const { manager, acceptToken, onError } = setup();
      const oldOutcome = manager.place(
        { ...token, id: "pending:reused" },
        () => old.promise,
      );
      await settle();
      manager.reset();
      const freshOutcome = manager.place(
        { ...token, id: "pending:reused", name: "New session" },
        () => fresh.promise,
      );
      if (reply === "accepted") old.resolve({ ...token, id: "stale" });
      else old.reject(new Error("stale rejection"));
      await expect(oldOutcome).resolves.toEqual({ status: "cancelled" });
      expect(acceptToken).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(manager.project([])).toEqual([
        expect.objectContaining({ id: "pending:reused", name: "New session" }),
      ]);
      fresh.resolve({ ...token, id: "fresh" });
      await expect(freshOutcome).resolves.toEqual({ status: "accepted" });
      expect(acceptToken).toHaveBeenCalledOnce();
      expect(acceptToken).toHaveBeenCalledWith(
        expect.objectContaining({ id: "fresh" }),
      );
    },
  );

  it("shows rapid condition changes immediately, serializes only that token and rebases the next write", async () => {
    const first = deferred<{
      revision: number;
      conditions: TokenDto["conditions"];
    }>();
    const send = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        revision: 5,
        conditions: ["POISONED", "RESTRAINED"],
      });
    const { manager, canonical } = setup(send);
    manager.setConditions("one", ["POISONED"]);
    manager.setConditions("one", ["POISONED", "RESTRAINED"]);
    expect(manager.project([token])[0]?.conditions).toEqual([
      "POISONED",
      "RESTRAINED",
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    first.resolve({ revision: 4, conditions: ["POISONED"] });
    await settle();
    expect(send.mock.calls[1]?.[0].revision).toBe(4);
    expect(send.mock.calls[1]?.[1]).toEqual(["POISONED", "RESTRAINED"]);
    expect(canonical().conditions).toEqual(["POISONED", "RESTRAINED"]);
  });

  it("rebases a conflict without erasing another writer's unrelated condition", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce({ status: 409 })
      .mockResolvedValueOnce({
        revision: 10,
        conditions: ["RESTRAINED", "POISONED"],
      });
    const { manager, reloadToken } = setup(send);
    reloadToken.mockResolvedValue({
      ...token,
      revision: 9,
      conditions: ["RESTRAINED"],
    });
    manager.setConditions("one", ["POISONED"]);
    await settle();
    expect(send.mock.calls[1]?.[0].revision).toBe(9);
    expect(send.mock.calls[1]?.[1]).toEqual(["RESTRAINED", "POISONED"]);
  });

  it("rolls rejected conditions back to confirmed state", async () => {
    const { manager, onError } = setup(
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    manager.setConditions("one", ["POISONED"]);
    expect(manager.project([token])[0]?.conditions).toEqual(["POISONED"]);
    await settle();
    expect(manager.project([token])[0]?.conditions).toEqual([]);
    expect(onError).toHaveBeenCalledOnce();
  });
});
