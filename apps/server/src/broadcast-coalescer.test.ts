import { describe, expect, it } from "vitest";
import { createBroadcastCoalescer } from "./broadcast-coalescer.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("broadcast coalescer", () => {
  it("runs a burst as one running plus one shared follow-up broadcast", async () => {
    const coalesce = createBroadcastCoalescer();
    const gates = [deferred(), deferred()];
    let runs = 0;
    const run = () => gates[runs++]!.promise;
    const first = coalesce("campaign", run);
    const joined = [1, 2, 3, 4].map(() => coalesce("campaign", run));
    expect(runs).toBe(1);
    expect(new Set(joined).size).toBe(1);
    gates[0]!.resolve();
    await first;
    await Promise.resolve();
    expect(runs).toBe(2);
    gates[1]!.resolve();
    await Promise.all(joined);
    expect(runs).toBe(2);
  });

  it("starts the follow-up only after the running broadcast settles", async () => {
    const coalesce = createBroadcastCoalescer();
    const order: string[] = [];
    const gate = deferred();
    void coalesce("c", async () => {
      await gate.promise;
      order.push("first");
    });
    const second = coalesce("c", async () => {
      order.push("second");
    });
    gate.resolve();
    await second;
    expect(order).toEqual(["first", "second"]);
  });

  it("isolates keys and recovers after a failed broadcast", async () => {
    const coalesce = createBroadcastCoalescer();
    let other = 0;
    const failing = coalesce("a", () => Promise.reject(new Error("db down")));
    const independent = coalesce("b", async () => {
      other += 1;
    });
    const followUp = coalesce("a", async () => undefined);
    await expect(failing).rejects.toThrow("db down");
    await expect(followUp).resolves.toBeUndefined();
    await independent;
    expect(other).toBe(1);
    let later = 0;
    await coalesce("a", async () => {
      later += 1;
    });
    expect(later).toBe(1);
  });
});
