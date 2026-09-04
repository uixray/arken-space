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
    manager.place({ ...token, id: "pending:first" }, () => first.promise);
    manager.place({ ...token, id: "pending:second" }, () => second.promise);
    expect(manager.project([]).map((item) => item.id)).toEqual([
      "pending:first",
      "pending:second",
    ]);
    first.reject(new Error("forbidden"));
    await settle();
    expect(manager.project([]).map((item) => item.id)).toEqual([
      "pending:second",
    ]);
    expect(onError).toHaveBeenCalledOnce();
    second.resolve({ ...token, id: "saved" });
    await settle();
    expect(manager.project([])).toEqual([]);
  });

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
