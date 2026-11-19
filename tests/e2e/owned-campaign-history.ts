import { randomUUID } from "node:crypto";

export type HistoryOwner = Readonly<{
  campaignId: string;
  membershipId: string;
}>;

/** A local address is necessary, not proof that its database is disposable.
 * The caller must still provision a dedicated QA database, never a live tunnel. */
export function assertCampaignFixtureDatabaseUrl(value: string) {
  const fail = () => {
    throw new Error(
      "Campaign fixture requires an isolated loopback PostgreSQL database",
    );
  };
  if (typeof value !== "string" || !value || /[\0\r\n]/.test(value))
    return fail();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail();
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()) ||
    url.pathname.length < 2 ||
    url.hash
  )
    return fail();
  // postgres clients can interpret query options as connection overrides.
  // Only the ordinary local TLS mode is accepted; no host/socket/service options.
  for (const [key, option] of url.searchParams) {
    if (
      key !== "sslmode" ||
      ![
        "disable",
        "allow",
        "prefer",
        "require",
        "verify-ca",
        "verify-full",
      ].includes(option)
    )
      return fail();
  }
}

export function assertHistoryCount(count: number) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100)
    throw new Error("Invalid history count");
}

/** Worker-local ownership, shared by the real Playwright campaign fixture and
 * driver tests. This is test setup, not an application authorization substitute. */
export function createOwnedCampaignHistory(options: {
  databaseUrl: string;
  createCampaign: (name: string, token: string) => Promise<HistoryOwner>;
  insertHistory: (owner: HistoryOwner, count: number) => Promise<unknown>;
  newToken?: () => string;
}) {
  assertCampaignFixtureDatabaseUrl(options.databaseUrl);
  const owned = new Map<string, HistoryOwner>();
  const issued = new Set<string>();
  const newToken =
    options.newToken ?? (() => `e2e-${randomUUID()}-${randomUUID()}`);
  return {
    async create(name: string) {
      const token = newToken();
      if (!token || issued.has(token))
        throw new Error("Campaign fixture token collision");
      // Reserve before awaiting SQL: concurrent creates cannot reuse a token.
      issued.add(token);
      const owner = await options.createCampaign(name, token);
      if (
        typeof owner?.campaignId !== "string" ||
        !owner.campaignId ||
        typeof owner.membershipId !== "string" ||
        !owner.membershipId
      )
        throw new Error("Campaign fixture did not return its owner");
      owned.set(token, {
        campaignId: owner.campaignId,
        membershipId: owner.membershipId,
      });
      return token;
    },
    async seed(token: string, count: number) {
      const owner = owned.get(token);
      if (!owner)
        throw new Error(
          "Cannot seed history outside this worker owned campaigns",
        );
      assertHistoryCount(count);
      // A callback cannot mutate the registry used by later requests.
      await options.insertHistory({ ...owner }, count);
    },
  };
}

/** Validate before opening the database, then close only this worker's resource
 * even if setup, the consumer, or cleanup fails. Never deletes campaign data. */
export async function withOwnedCampaignHistory(
  databaseUrl: string,
  open: () => Promise<
    Omit<Parameters<typeof createOwnedCampaignHistory>[0], "databaseUrl"> & {
      close: () => Promise<unknown>;
    }
  >,
  provide: (
    history: ReturnType<typeof createOwnedCampaignHistory>,
  ) => Promise<unknown>,
) {
  assertCampaignFixtureDatabaseUrl(databaseUrl);
  const resource = await open();
  let failed = false;
  let failure: unknown;
  try {
    await provide(createOwnedCampaignHistory({ ...resource, databaseUrl }));
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    try {
      await resource.close();
    } catch (cleanupError) {
      if (failed)
        throw new AggregateError(
          [failure, cleanupError],
          "Campaign fixture and cleanup failed",
        );
      throw cleanupError;
    }
  }
}
