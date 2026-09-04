import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  campaignPauseCommandSchema,
  campaignPauseStateSchema,
  type CampaignPauseCommand,
  type CampaignPauseState,
} from "@arken/contracts";
import { campaigns, gameEvents } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { requireAuth } from "./auth.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type PauseDb = Database | Transaction;
type Transition = (
  campaignId: string,
  state: CampaignPauseState,
  tx: Transaction,
) => Promise<void>;
type Broadcast = (
  campaignId: string,
  state: CampaignPauseState,
) => Promise<void>;

type PauseReceiptPayload = {
  commandHash: string;
  response: CampaignPauseState;
};

type Replay =
  | { kind: "MISS" }
  | { kind: "MATCH"; response: CampaignPauseState }
  | { kind: "CONFLICT" };

type PauseResult =
  | { kind: "UPDATED"; response: CampaignPauseState }
  | { kind: "REPLAY"; response: CampaignPauseState }
  | { kind: "ACTION_ID_CONFLICT" }
  | { kind: "CAMPAIGN_NOT_FOUND" }
  | { kind: "CAMPAIGN_CONFLICT"; revision: number }
  | {
      kind: "CAMPAIGN_PAUSE_STATE_UNCHANGED";
      paused: boolean;
      revision: number;
    };

function fail(reply: FastifyReply, status: number, error: string) {
  return reply.code(status).send({ error });
}

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
};

const commandHash = (campaignId: string, body: CampaignPauseCommand) =>
  createHash("sha256")
    .update(
      canonicalJson({ type: "campaign.pause", entityId: campaignId, body }),
    )
    .digest("hex");

function receiptPayload(value: unknown): PauseReceiptPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    commandHash?: unknown;
    response?: unknown;
  };
  if (typeof candidate.commandHash !== "string") return null;
  const response = campaignPauseStateSchema.safeParse(candidate.response);
  return response.success
    ? { commandHash: candidate.commandHash, response: response.data }
    : null;
}

async function replay(
  db: PauseDb,
  auth: AuthContext,
  actionId: string,
  hash: string,
): Promise<Replay> {
  const [event] = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, auth.campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  if (!event) return { kind: "MISS" };

  const payload = receiptPayload(event.payload);
  if (
    event.membershipId !== auth.membershipId ||
    event.type !== "campaign.pause" ||
    event.entityType !== "campaign" ||
    event.entityId !== auth.campaignId ||
    payload?.commandHash !== hash
  )
    return { kind: "CONFLICT" };
  return { kind: "MATCH", response: payload.response };
}

export function isGameEventActionConflict(error: unknown): boolean {
  for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
    if (typeof candidate !== "object" || candidate === null) continue;
    if (
      !("code" in candidate) ||
      (candidate as { code?: unknown }).code !== "23505"
    )
      continue;
    const constraint =
      ("constraint_name" in candidate &&
        (candidate as { constraint_name?: unknown }).constraint_name) ||
      ("constraint" in candidate &&
        (candidate as { constraint?: unknown }).constraint);
    if (constraint === "game_events_campaign_action_idx") return true;
  }
  return false;
}

async function executePause(
  db: Database,
  auth: AuthContext,
  body: CampaignPauseCommand,
  hash: string,
  transition: Transition,
): Promise<PauseResult> {
  return db.transaction(async (tx) => {
    // Граница UIX-582/583: каждый переход паузы сериализуется на строке
    // кампании. В UIX-583 мутации канваса возьмут ту же блокировку перед
    // проверкой `paused`, чтобы не записаться следом за принятой паузой.
    const [current] = await tx
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1)
      .for("update");
    if (!current) return { kind: "CAMPAIGN_NOT_FOUND" };

    const prior = await replay(tx, auth, body.actionId, hash);
    if (prior.kind === "MATCH")
      return { kind: "REPLAY", response: prior.response };
    if (prior.kind === "CONFLICT") return { kind: "ACTION_ID_CONFLICT" };
    if (current.revision !== body.revision)
      return { kind: "CAMPAIGN_CONFLICT", revision: current.revision };
    if (current.paused === body.paused)
      return {
        kind: "CAMPAIGN_PAUSE_STATE_UNCHANGED",
        paused: current.paused,
        revision: current.revision,
      };

    const [updated] = await tx
      .update(campaigns)
      .set({
        paused: body.paused,
        revision: current.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(campaigns.id, auth.campaignId),
          eq(campaigns.revision, current.revision),
        ),
      )
      .returning({
        campaignId: campaigns.id,
        paused: campaigns.paused,
        revision: campaigns.revision,
      });
    if (!updated)
      return { kind: "CAMPAIGN_CONFLICT", revision: current.revision };

    const response = campaignPauseStateSchema.parse(updated);
    await tx.insert(gameEvents).values({
      campaignId: auth.campaignId,
      actionId: body.actionId,
      membershipId: auth.membershipId,
      type: "campaign.pause",
      entityType: "campaign",
      entityId: auth.campaignId,
      entityRevision: response.revision,
      payload: { commandHash: hash, response } satisfies PauseReceiptPayload,
    });
    // UIX-583: transition-side ephemeral cleanup stays under the same
    // campaign FOR UPDATE lock. Resume and later relays cannot overtake it.
    await transition(auth.campaignId, response, tx);
    return { kind: "UPDATED", response };
  });
}

function sendResult(reply: FastifyReply, result: PauseResult) {
  switch (result.kind) {
    case "UPDATED":
    case "REPLAY":
      return reply.code(200).send(result.response);
    case "ACTION_ID_CONFLICT":
      return fail(reply, 409, "ACTION_ID_CONFLICT");
    case "CAMPAIGN_NOT_FOUND":
      return fail(reply, 404, "CAMPAIGN_NOT_FOUND");
    case "CAMPAIGN_CONFLICT":
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: result.revision });
    case "CAMPAIGN_PAUSE_STATE_UNCHANGED":
      return reply.code(409).send({
        error: "CAMPAIGN_PAUSE_STATE_UNCHANGED",
        paused: result.paused,
        revision: result.revision,
      });
  }
}

export function registerCampaignPauseRoutes(
  app: FastifyInstance,
  db: Database,
  broadcast: Broadcast,
  transition: Transition = async () => undefined,
) {
  app.post("/api/campaign/pause", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");

    const body = campaignPauseCommandSchema.parse(request.body);
    const hash = commandHash(auth.campaignId, body);
    let result: PauseResult;
    try {
      result = await executePause(db, auth, body, hash, transition);
    } catch (error) {
      if (!isGameEventActionConflict(error)) throw error;
      const raced = await replay(db, auth, body.actionId, hash);
      result =
        raced.kind === "MATCH"
          ? { kind: "REPLAY", response: raced.response }
          : { kind: "ACTION_ID_CONFLICT" };
    }

    // Повторная рассылка на REPLAY восстанавливает клиентов, если транзакция
    // уже зафиксировалась, а первая рассылка завершилась ошибкой или частично.
    if (result.kind === "UPDATED" || result.kind === "REPLAY")
      await broadcast(auth.campaignId, result.response);
    return sendResult(reply, result);
  });
}
