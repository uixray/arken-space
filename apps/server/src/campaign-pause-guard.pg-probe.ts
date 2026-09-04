import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import {
  campaigns,
  createDatabase,
  memberships,
  scenes,
  sessions,
} from "@arken/db";
import {
  CampaignCanvasGuardError,
  runCampaignCanvasMutation,
  runCampaignCanvasRelay,
  type CampaignCanvasTransaction,
} from "./campaign-pause-guard.js";
import { registerCampaignPauseRoutes } from "./campaign-pause.js";
import { env } from "./env.js";
import { hashToken } from "./security.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for the PostgreSQL probe");

const ADVISORY_GATE = 583_000_001;
const campaignId = randomUUID();
const membershipId = randomUUID();
const sceneId = randomUUID();
const gmSecret = "uix583-gm-".padEnd(40, "g");
const campaignName = "UIX-583 PostgreSQL pause race probe";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitForEntry<T>(promise: Promise<T>, label: string) {
  return Promise.race([
    promise,
    delay(5_000).then(() => {
      throw new Error(`${label}: guard callback was not entered`);
    }),
  ]);
}

const { client, db } = createDatabase(connectionString);
let app: FastifyInstance | undefined;
type PauseTransition = NonNullable<
  Parameters<typeof registerCampaignPauseRoutes>[3]
>;
const noTransition: PauseTransition = async () => undefined;
let transitionHook: PauseTransition = noTransition;

async function transactionPid(tx: CampaignCanvasTransaction) {
  const [row] = await tx.execute<{ pid: number }>(
    sql`select pg_backend_pid()::int as pid`,
  );
  assert(row, "PostgreSQL transaction PID is missing");
  return Number(row.pid);
}

async function waitForBlockedBy(blockingPid: number, label: string) {
  const deadline = Date.now() + 5_000;
  let last: Array<{ pid: number; blockingPids: number[] }> = [];
  while (Date.now() < deadline) {
    const rows = await client<Array<{ pid: number; blocking_pids: number[] }>>`
      select pid::int as pid, pg_blocking_pids(pid)::int[] as blocking_pids
      from pg_stat_activity
      where datname = current_database()
        and cardinality(pg_blocking_pids(pid)) > 0
    `;
    last = rows.map((row) => ({
      pid: Number(row.pid),
      blockingPids: row.blocking_pids.map(Number),
    }));
    const blocked = last.find((row) => row.blockingPids.includes(blockingPid));
    if (blocked) return blocked.pid;
    await delay(20);
  }
  throw new Error(
    `${label}: no backend blocked by ${blockingPid}; waits=${JSON.stringify(last)}`,
  );
}

const authHeaders = {
  cookie: `${env.SESSION_COOKIE_NAME}=${gmSecret}`,
};

async function pause(revision = 0) {
  assert(app, "pause probe app is not ready");
  return app.inject({
    method: "POST",
    url: "/api/campaign/pause",
    headers: authHeaders,
    payload: {
      actionId: randomUUID(),
      revision,
      paused: true,
    },
  });
}

async function resetFixture() {
  await db
    .update(campaigns)
    .set({ paused: false, revision: 0 })
    .where(eq(campaigns.id, campaignId));
  await db.update(scenes).set({ revision: 0 }).where(eq(scenes.id, sceneId));
}

async function installPauseGate() {
  await client.unsafe(
    "drop trigger if exists uix583_pause_probe_gate on campaigns",
  );
  await client.unsafe("drop function if exists uix583_pause_probe_gate()");
  await client.unsafe(`
    create function uix583_pause_probe_gate()
    returns trigger
    language plpgsql
    as $probe$
    begin
      if old.paused is distinct from new.paused
         and new.paused
         and new.id = '${campaignId}'::uuid then
        perform pg_advisory_xact_lock(${ADVISORY_GATE});
      end if;
      return new;
    end;
    $probe$
  `);
  await client.unsafe(`
    create trigger uix583_pause_probe_gate
    before update of paused on campaigns
    for each row execute function uix583_pause_probe_gate()
  `);
}

async function removePauseGate() {
  await client.unsafe(
    "drop trigger if exists uix583_pause_probe_gate on campaigns",
  );
  await client.unsafe("drop function if exists uix583_pause_probe_gate()");
}

async function proveMutationFirst() {
  const entered = deferred<number>();
  const release = deferred<void>();
  let mutationFinished = false;
  const mutation = runCampaignCanvasMutation(db, campaignId, async (tx) => {
    entered.resolve(await transactionPid(tx));
    await release.promise;
    const [updated] = await tx
      .update(scenes)
      .set({ revision: 1 })
      .where(eq(scenes.id, sceneId))
      .returning({ revision: scenes.revision });
    assert(updated?.revision === 1, "mutation-first Canvas write failed");
    mutationFinished = true;
  });

  let mutationPid: number;
  try {
    mutationPid = await waitForEntry(entered.promise, "mutation-first");
  } catch (error) {
    release.resolve();
    await Promise.allSettled([mutation]);
    throw error;
  }
  const pauseRequest = pause();
  try {
    await waitForBlockedBy(
      mutationPid,
      "mutation-first pause did not wait for the Canvas transaction",
    );
    assert(!mutationFinished, "mutation-first barrier released unexpectedly");
  } catch (error) {
    release.resolve();
    await Promise.allSettled([mutation, pauseRequest]);
    throw error;
  }
  release.resolve();

  await mutation;
  const response = await pauseRequest;
  assert(response.statusCode === 200, "mutation-first pause did not commit");
  assert(
    response.json().paused === true,
    "mutation-first pause returned the wrong state",
  );
  const [scene] = await db
    .select({ revision: scenes.revision })
    .from(scenes)
    .where(eq(scenes.id, sceneId));
  assert(scene?.revision === 1, "pause discarded the earlier Canvas mutation");
}

async function provePauseFirstMutation() {
  const gate = await client.reserve();
  try {
    const [holder] = await gate<Array<{ pid: number }>>`
      select pg_backend_pid()::int as pid
    `;
    assert(holder, "pause-first advisory holder PID is missing");
    await gate`select pg_advisory_lock(${ADVISORY_GATE})`;

    const pauseRequest = pause();
    const pausePid = await waitForBlockedBy(
      Number(holder.pid),
      "pause-first transition did not reach the advisory gate",
    );
    let callbackCalled = false;
    const mutation = runCampaignCanvasMutation(db, campaignId, async (tx) => {
      callbackCalled = true;
      await tx
        .update(scenes)
        .set({ revision: 2 })
        .where(eq(scenes.id, sceneId));
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await waitForBlockedBy(
      pausePid,
      "pause-first Canvas mutation did not wait for the pause transaction",
    );

    await gate`select pg_advisory_unlock(${ADVISORY_GATE})`;
    const response = await pauseRequest;
    const outcome = await mutation;
    assert(
      response.statusCode === 200,
      "pause-first transition did not commit",
    );
    assert(!outcome.ok, "Canvas mutation committed behind an accepted pause");
    assert(
      outcome.error instanceof CampaignCanvasGuardError &&
        outcome.error.code === "CAMPAIGN_PAUSED",
      "pause-first Canvas mutation did not fail with CAMPAIGN_PAUSED",
    );
    assert(!callbackCalled, "paused Canvas mutation callback was invoked");
    const [scene] = await db
      .select({ revision: scenes.revision })
      .from(scenes)
      .where(eq(scenes.id, sceneId));
    assert(
      scene?.revision === 0,
      "paused Canvas mutation changed durable state",
    );
  } finally {
    await gate`select pg_advisory_unlock(${ADVISORY_GATE})`;
    await gate.release();
  }
}

async function proveRelayFirst() {
  const entered = deferred<number>();
  const release = deferred<void>();
  let emitted = false;
  const relay = runCampaignCanvasRelay(db, campaignId, async (tx) => {
    entered.resolve(await transactionPid(tx));
    await release.promise;
    emitted = true;
    return "emitted";
  });

  let relayPid: number;
  try {
    relayPid = await waitForEntry(entered.promise, "relay-first");
  } catch (error) {
    release.resolve();
    await Promise.allSettled([relay]);
    throw error;
  }
  const pauseRequest = pause();
  try {
    await waitForBlockedBy(
      relayPid,
      "relay-first pause did not wait for the shared campaign lock",
    );
    assert(!emitted, "relay-first barrier released unexpectedly");
  } catch (error) {
    release.resolve();
    await Promise.allSettled([relay, pauseRequest]);
    throw error;
  }
  release.resolve();

  const relayResult = await relay;
  const response = await pauseRequest;
  assert(
    relayResult.kind === "RELAYED" && relayResult.value === "emitted",
    "relay-first ephemeral event was not completed before pause",
  );
  assert(response.statusCode === 200, "relay-first pause did not commit");
}

async function proveCleanupHoldsPauseLock() {
  const entered = deferred<number>();
  const release = deferred<void>();
  transitionHook = async (_campaignId, state, tx) => {
    if (!state.paused) return;
    entered.resolve(await transactionPid(tx));
    await release.promise;
  };
  const pauseRequest = pause();
  let pausePid: number;
  try {
    pausePid = await Promise.race([
      entered.promise,
      delay(5_000).then(() => {
        throw new Error("pause cleanup did not enter its transaction hook");
      }),
    ]);
  } catch (error) {
    release.resolve();
    await Promise.allSettled([pauseRequest]);
    transitionHook = noTransition;
    throw error;
  }

  let callbackCalled = false;
  const relay = runCampaignCanvasRelay(db, campaignId, async () => {
    callbackCalled = true;
    return "unexpected";
  });
  try {
    await waitForBlockedBy(
      pausePid,
      "ephemeral relay did not wait for pause cleanup",
    );
  } catch (error) {
    release.resolve();
    await Promise.allSettled([pauseRequest, relay]);
    transitionHook = noTransition;
    throw error;
  }
  release.resolve();
  const response = await pauseRequest;
  const relayResult = await relay;
  transitionHook = noTransition;
  assert(
    response.statusCode === 200,
    "pause cleanup transition did not commit",
  );
  assert(
    relayResult.kind === "BLOCKED" && relayResult.reason === "CAMPAIGN_PAUSED",
    "ephemeral relay escaped the in-transaction pause cleanup",
  );
  assert(!callbackCalled, "relay callback ran during pause cleanup");
}

async function provePauseFirstRelay() {
  const gate = await client.reserve();
  try {
    const [holder] = await gate<Array<{ pid: number }>>`
      select pg_backend_pid()::int as pid
    `;
    assert(holder, "pause-first relay holder PID is missing");
    await gate`select pg_advisory_lock(${ADVISORY_GATE})`;

    const pauseRequest = pause();
    const pausePid = await waitForBlockedBy(
      Number(holder.pid),
      "pause-first relay transition did not reach the advisory gate",
    );
    let callbackCalled = false;
    const relay = runCampaignCanvasRelay(db, campaignId, async () => {
      callbackCalled = true;
      return "unexpected";
    });
    await waitForBlockedBy(
      pausePid,
      "pause-first relay did not wait for the pause transaction",
    );

    await gate`select pg_advisory_unlock(${ADVISORY_GATE})`;
    const response = await pauseRequest;
    const relayResult = await relay;
    assert(
      response.statusCode === 200,
      "pause-first relay pause did not commit",
    );
    assert(
      relayResult.kind === "BLOCKED" &&
        relayResult.reason === "CAMPAIGN_PAUSED",
      "ephemeral relay escaped behind an accepted pause",
    );
    assert(!callbackCalled, "paused ephemeral relay callback was invoked");
  } finally {
    await gate`select pg_advisory_unlock(${ADVISORY_GATE})`;
    await gate.release();
  }
}

try {
  await removePauseGate();
  await db.insert(campaigns).values({
    id: campaignId,
    name: campaignName,
  });
  await db.insert(memberships).values({
    id: membershipId,
    campaignId,
    role: "GM",
    displayName: "UIX-583 probe GM",
  });
  await db.insert(sessions).values({
    membershipId,
    tokenHash: hashToken(gmSecret),
    expiresAt: new Date(Date.now() + 600_000),
  });
  await db.insert(scenes).values({
    id: sceneId,
    campaignId,
    name: "UIX-583 probe scene",
    grid: {
      enabled: false,
      size: 50,
      offsetX: 0,
      offsetY: 0,
      color: "#ffffff",
      opacity: 0.25,
    },
  });

  app = Fastify();
  await app.register(cookie);
  registerCampaignPauseRoutes(
    app,
    db,
    async () => {},
    (...args) => transitionHook(...args),
  );
  await app.ready();

  await proveMutationFirst();
  await resetFixture();

  await installPauseGate();
  await provePauseFirstMutation();
  await resetFixture();

  await proveCleanupHoldsPauseLock();
  await resetFixture();

  await proveRelayFirst();
  await resetFixture();

  await provePauseFirstRelay();

  console.log(
    "[campaign-pause-guard-probe] PostgreSQL lock ordering and relay serialization passed",
  );
} finally {
  if (app) await app.close();
  await removePauseGate();
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  await client.end();
}
