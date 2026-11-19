import { describe, expect, it, vi } from "vitest";
import {
  assertCampaignFixtureDatabaseUrl,
  createOwnedCampaignHistory,
  withOwnedCampaignHistory,
} from "./e2e/owned-campaign-history.js";

const local = "postgres://synthetic:unused@127.0.0.1:5432/disposable_qa";
function setup() {
  let sequence = 0;
  const createCampaign = vi.fn(async () => ({
    campaignId: "campaign-a",
    membershipId: "gm-a",
  }));
  const insertHistory = vi.fn(
    async (
      _owner: { campaignId: string; membershipId: string },
      _count: number,
    ) => {},
  );
  return {
    createCampaign,
    insertHistory,
    newToken: () => `token-${sequence++}`,
    databaseUrl: local,
  };
}

describe("worker-owned campaign/chat setup", () => {
  it.each([
    local,
    "postgresql://localhost/qa?sslmode=disable",
    "postgres://[::1]/qa",
    "postgres://LOCALHOST/qa",
  ])("accepts a loopback PostgreSQL URL: %s", (url) => {
    expect(() => assertCampaignFixtureDatabaseUrl(url)).not.toThrow();
  });
  it.each([
    "",
    "bad",
    "https://localhost/qa",
    "postgres://remote.example/qa",
    "postgres://localhost@remote.example/qa",
    "postgres://localhost/",
    "postgres://localhost/qa?host=remote.example",
    "postgres://localhost/qa?%68ost=/tmp/socket",
    "postgres://localhost/qa?service=live",
    "postgres://localhost/qa#remote",
    "postgres://localhost/qa\n",
  ])("rejects unsafe connection before callbacks: %s", (databaseUrl) => {
    const options = setup();
    expect(() =>
      createOwnedCampaignHistory({ ...options, databaseUrl }),
    ).toThrow("isolated loopback");
    expect(options.createCampaign).not.toHaveBeenCalled();
    expect(options.insertHistory).not.toHaveBeenCalled();
  });
  it("does not expose credentials in invalid-URL errors", () => {
    try {
      assertCampaignFixtureDatabaseUrl(
        "postgres://secret-person:secret-password@remote.example/qa",
      );
    } catch (error) {
      expect(String(error)).not.toMatch(
        /secret-person|secret-password|remote\.example/,
      );
      return;
    }
    throw new Error("Expected rejection");
  });
  it("keeps workers separate and validates counts before writes", async () => {
    const options = setup(),
      own = createOwnedCampaignHistory(options);
    const foreign = createOwnedCampaignHistory({
      ...setup(),
      newToken: () => "foreign-token",
    });
    const token = await own.create("own"),
      other = await foreign.create("foreign");
    expect(options.createCampaign).toHaveBeenCalledWith("own", token);
    await expect(own.seed(other, 40)).rejects.toThrow("owned campaigns");
    await expect(own.seed("unknown", 40)).rejects.toThrow("owned campaigns");
    for (const count of [0, -1, 1.5, NaN, Infinity, 101])
      await expect(own.seed(token, count)).rejects.toThrow(
        "Invalid history count",
      );
    expect(options.insertHistory).not.toHaveBeenCalled();
    await own.seed(token, 40);
    expect(options.insertHistory).toHaveBeenCalledExactlyOnceWith(
      { campaignId: "campaign-a", membershipId: "gm-a" },
      40,
    );
  });
  it("reserves pending tokens and never owns failed creates", async () => {
    let resolve!: (owner: { campaignId: string; membershipId: string }) => void;
    const options = setup();
    const own = createOwnedCampaignHistory({
      ...options,
      newToken: () => "reserved",
      createCampaign: () =>
        new Promise<{ campaignId: string; membershipId: string }>((r) => {
          resolve = r;
        }),
    });
    const pending = own.create("first");
    await expect(own.seed("reserved", 1)).rejects.toThrow("owned campaigns");
    await expect(own.create("second")).rejects.toThrow("collision");
    resolve({ campaignId: "a", membershipId: "gm" });
    await expect(pending).resolves.toBe("reserved");
    const failed = createOwnedCampaignHistory({
      ...options,
      createCampaign: async () => {
        throw new Error("creation failed");
      },
    });
    await expect(failed.create("failed")).rejects.toThrow("creation failed");
    await expect(failed.seed("token-0", 1)).rejects.toThrow("owned campaigns");
  });
  it("copies owner data and does not retry a rejected insert", async () => {
    const owner = { campaignId: "a", membershipId: "gm" },
      seen: string[] = [];
    const own = createOwnedCampaignHistory({
      ...setup(),
      createCampaign: async () => owner,
      insertHistory: async (received) => {
        seen.push(received.campaignId);
        (received as { campaignId: string }).campaignId = "mutated";
        throw new Error("insert failed");
      },
    });
    const token = await own.create("own");
    owner.campaignId = "changed outside";
    await expect(own.seed(token, 1)).rejects.toThrow("insert failed");
    await expect(own.seed(token, 1)).rejects.toThrow("insert failed");
    expect(seen).toEqual(["a", "a"]);
  });
  it("uses unique ordinary E2E tokens by default", async () => {
    const options = setup();
    const own = createOwnedCampaignHistory({
      databaseUrl: local,
      createCampaign: options.createCampaign,
      insertHistory: options.insertHistory,
    });
    const a = await own.create("a"),
      b = await own.create("b");
    expect(a).toMatch(/^e2e-[a-f0-9-]{36}-[a-f0-9-]{36}$/);
    expect(b).not.toBe(a);
  });
  it("rejects before opening a database and always closes its own resource", async () => {
    const close = vi.fn(async () => {}),
      open = vi.fn(async () => ({ ...setup(), close }));
    const provide = vi.fn(async () => {});
    await expect(
      withOwnedCampaignHistory("postgres://remote.example/qa", open, provide),
    ).rejects.toThrow("isolated loopback");
    expect(open).not.toHaveBeenCalled();
    expect(provide).not.toHaveBeenCalled();
    await withOwnedCampaignHistory(local, open, provide);
    expect(close).toHaveBeenCalledOnce();
    close.mockClear();
    const failure = new Error("consumer failed");
    await expect(
      withOwnedCampaignHistory(local, open, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });
  it("preserves both consumer and cleanup failures and does not reopen a failed resource", async () => {
    const first = new Error("consumer"),
      cleanup = new Error("cleanup");
    const close = vi.fn(async () => {
      throw cleanup;
    });
    const result = withOwnedCampaignHistory(
      local,
      async () => ({ ...setup(), close }),
      async () => {
        throw first;
      },
    );
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await expect(result).rejects.toMatchObject({ errors: [first, cleanup] });
    expect(close).toHaveBeenCalledOnce();
    const open = vi.fn(async () => {
      throw new Error("open failed");
    });
    await expect(
      withOwnedCampaignHistory(local, open, async () => {}),
    ).rejects.toThrow("open failed");
    expect(open).toHaveBeenCalledOnce();
  });
});
