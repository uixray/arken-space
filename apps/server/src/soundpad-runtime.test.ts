import { describe, expect, it } from "vitest";
import { createSoundpadRuntime, soundpadEventRoom, soundpadGenerationIsCurrent } from "./soundpad-runtime.js";

describe("ephemeral soundpad abuse guard", () => {
  it("deduplicates concurrent action retries and rejects changed payload reuse", async () => {
    let now = 10_000;
    const runtime = createSoundpadRuntime(() => now);
    const command = { campaignId: "campaign", membershipId: "gm", soundId: "laugh", actionId: "action" };
    const results = await Promise.all(Array.from({ length: 12 }, () => runtime.accept(command)));
    expect(results.filter((item) => item.status === "ACCEPTED")).toHaveLength(1);
    expect(results.filter((item) => item.status === "DUPLICATE")).toHaveLength(11);
    expect(await runtime.accept({ ...command, soundId: "surprise" })).toEqual({ status: "CONFLICT" });
    now += 60_001;
    expect((await runtime.accept({ ...command, soundId: "surprise" })).status).toBe("ACCEPTED");
  });

  it("applies campaign ceiling and per-member cooldown while stop generation is monotonic", async () => {
    let now = 20_000;
    const runtime = createSoundpadRuntime(() => now);
    const requests = Array.from({ length: 5 }, (_, index) => runtime.accept({
      campaignId: "c", membershipId: `member-${index}`, soundId: "s", actionId: `a-${index}`,
    }));
    const results = await Promise.all(requests);
    expect(results.filter((item) => item.status === "ACCEPTED")).toHaveLength(4);
    expect(results.filter((item) => item.status === "RATE_LIMIT")).toHaveLength(1);
    expect((await runtime.accept({ campaignId: "c", membershipId: "member-0", soundId: "other", actionId: "next" })).status).toBe("COOLDOWN");
    now += 2_001;
    expect((await runtime.accept({ campaignId: "c", membershipId: "member-0", soundId: "other", actionId: "next" })).status).toBe("ACCEPTED");
    expect(runtime.stop("c")).toBe(1);
    expect(runtime.stop("c")).toBe(2);
    expect(runtime.generation("c")).toBe(2);
  });

  it("routes private catalogue events only to the GM room", () => {
    expect(soundpadEventRoom("c", "GM_ONLY")).toBe("campaign:c:gm");
    expect(soundpadEventRoom("c", "ALL_MEMBERS")).toBe("campaign:c");
  });

  it("fences a database-paused trigger across stop while allowing a later trigger", () => {
    const runtime = createSoundpadRuntime();
    const pausedTriggerGeneration = runtime.generation("c");
    runtime.stop("c");
    expect(soundpadGenerationIsCurrent(runtime.generation("c"), pausedTriggerGeneration)).toBe(false);
    const laterTriggerGeneration = runtime.generation("c");
    expect(soundpadGenerationIsCurrent(runtime.generation("c"), laterTriggerGeneration)).toBe(true);
  });
});
