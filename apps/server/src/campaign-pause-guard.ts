import { eq } from "drizzle-orm";
import { campaigns } from "@arken/db";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
export type CampaignCanvasTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type CampaignCanvasDb = Database | CampaignCanvasTransaction;

export type CampaignCanvasGuardReason =
  "CAMPAIGN_PAUSED" | "CAMPAIGN_NOT_FOUND";

export class CampaignCanvasGuardError extends Error {
  readonly code: CampaignCanvasGuardReason;
  readonly statusCode: 404 | 409;

  constructor(code: CampaignCanvasGuardReason) {
    super(code);
    this.name = "CampaignCanvasGuardError";
    this.code = code;
    this.statusCode = code === "CAMPAIGN_PAUSED" ? 409 : 404;
  }
}

export function isCampaignCanvasGuardError(
  error: unknown,
): error is CampaignCanvasGuardError {
  return error instanceof CampaignCanvasGuardError;
}

async function lockCampaignCanvasState(
  tx: CampaignCanvasTransaction,
  campaignId: string,
  lock: "update" | "share",
) {
  const [campaign] = await tx
    .select({ paused: campaigns.paused })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1)
    .for(lock);
  if (!campaign) return { kind: "CAMPAIGN_NOT_FOUND" } as const;
  if (campaign.paused) return { kind: "CAMPAIGN_PAUSED" } as const;
  return { kind: "ALLOWED" } as const;
}

/**
 * Serializes a durable Canvas write with pause/resume on the campaign row.
 * The callback must contain every write and take any narrower locks only after
 * this wrapper has acquired the campaign lock.
 */
export async function runCampaignCanvasMutation<T>(
  db: Database,
  campaignId: string,
  mutate: (tx: CampaignCanvasTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const guard = await lockCampaignCanvasState(tx, campaignId, "update");
    if (guard.kind !== "ALLOWED")
      throw new CampaignCanvasGuardError(guard.kind);
    return mutate(tx);
  });
}

/**
 * Transaction-shaped facade for large existing route handlers. Keeping the
 * familiar `.transaction(callback)` form avoids reindenting their bodies while
 * still routing every write through the shared campaign lock above.
 */
export function campaignCanvasDatabase(db: Database, campaignId: string) {
  return {
    transaction: <T>(mutate: (tx: CampaignCanvasTransaction) => Promise<T>) =>
      runCampaignCanvasMutation(db, campaignId, mutate),
  };
}

export type CampaignCanvasRelayResult<T> =
  | { kind: "RELAYED"; value: T }
  | {
      kind: "BLOCKED";
      reason: CampaignCanvasGuardReason;
    };

/**
 * Keeps a shared campaign-row lock through the final ephemeral emit. That
 * closes the SELECT/emit gap: pause either follows this relay and cleans it up,
 * or commits first and makes the relay return BLOCKED.
 */
export async function runCampaignCanvasRelay<T>(
  db: Database,
  campaignId: string,
  relay: (tx: CampaignCanvasTransaction) => Promise<T>,
): Promise<CampaignCanvasRelayResult<T>> {
  return db.transaction(async (tx) => {
    const guard = await lockCampaignCanvasState(tx, campaignId, "share");
    if (guard.kind !== "ALLOWED")
      return { kind: "BLOCKED", reason: guard.kind };
    return { kind: "RELAYED", value: await relay(tx) };
  });
}
