import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { z } from "zod";
import { env } from "./env.js";
import {
  inspectLocalHost,
  requireEmptyLocalOwnerDatabase,
} from "./local-host-identity.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type SqlExecutor = Pick<Database, "execute">;
const migrationRoot = fileURLToPath(
  new URL("../../../packages/db/drizzle/", import.meta.url),
);
const migrationEntry = z.object({
  idx: z.number().int().nonnegative(),
  when: z.number().int().safe().positive(),
  tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
  version: z.string(),
  breakpoints: z.boolean(),
});
const migrationJournal = z.object({
  version: z.string(),
  dialect: z.literal("postgresql"),
  entries: z.array(migrationEntry).min(1).max(10_000),
});
export type LocalMigration = {
  index: number;
  when: number;
  tag: string;
  sha256: string;
};
export const localMaintenanceInput = z
  .object({
    operationId: z.string().uuid(),
    sourceSchemaVersion: z.number().int().nonnegative().max(10_000),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    expectedOwnerId: z.string().uuid().optional(),
    requireRevokedAccess: z.boolean().optional(),
  })
  .strict();
type Input = z.infer<typeof localMaintenanceInput>;

export async function requirePlainLocalPath(path: string) {
  if (!isAbsolute(path)) throw new Error("LOCAL_UNSAFE_PATH");
  for (let cursor = resolve(path); ; cursor = dirname(cursor)) {
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        throw new Error("LOCAL_UNSAFE_PATH");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dirname(cursor) === cursor) break;
  }
}

/** This is a privilege boundary, not an OS sandbox. The hosted path is unchanged. */
export async function assertLocalDatabaseRole(
  db: SqlExecutor,
  role: "runtime" | "owner",
) {
  if (env.DEPLOYMENT_MODE !== "LOCAL_HOST")
    throw new Error("LOCAL_HOST_REQUIRED");
  const rows = await db.execute<{
    name: string;
    elevated: boolean;
    database_owner: boolean;
    schema_create: boolean;
    owns_objects: boolean;
    extra_membership: boolean;
  }>(sql`
    select r.rolname as name,
      (r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls) as elevated,
      (d.datdba = r.oid) as database_owner,
      has_schema_privilege(current_user, 'public', 'CREATE') as schema_create,
      exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relowner=r.oid and n.nspname not like 'pg_%' and n.nspname<>'information_schema') as owns_objects,
      exists(select 1 from pg_roles other where other.rolname<>current_user
        and other.rolname<>'pg_database_owner' and pg_has_role(current_user, other.oid, 'MEMBER')) as extra_membership
    from pg_roles r cross join pg_database d where r.rolname=current_user and d.datname=current_database()`);
  const current = rows[0];
  if (
    !current ||
    current.name !== (role === "owner" ? "arken_owner" : "arken_runtime") ||
    current.elevated ||
    current.extra_membership ||
    (role === "runtime" &&
      (current.database_owner ||
        current.schema_create ||
        current.owns_objects)) ||
    (role === "owner" && !current.database_owner)
  )
    throw new Error("LOCAL_DATABASE_ROLE_REJECTED");
}

export function localMigrationFingerprint(entries: readonly LocalMigration[]) {
  return createHash("sha256")
    .update(
      entries
        .map(
          (entry) =>
            `${entry.index}:${entry.when}:${entry.tag}:${entry.sha256}\n`,
        )
        .join(""),
    )
    .digest("hex");
}

export async function readLocalMigrations(): Promise<LocalMigration[]> {
  await requirePlainLocalPath(migrationRoot);
  const journalPath = join(migrationRoot, "meta/_journal.json");
  await requirePlainLocalPath(journalPath);
  if ((await stat(journalPath)).size > 4 * 1024 * 1024)
    throw new Error("LOCAL_SCHEMA_REJECTED");
  const journal = migrationJournal.parse(
    JSON.parse(await readFile(journalPath, "utf8")),
  );
  if (journal.entries.length !== env.SCHEMA_VERSION)
    throw new Error("LOCAL_SCHEMA_REJECTED");
  const result: LocalMigration[] = [];
  for (const [index, entry] of journal.entries.entries()) {
    if (
      entry.idx !== index ||
      (index > 0 && entry.when <= journal.entries[index - 1]!.when)
    )
      throw new Error("LOCAL_SCHEMA_REJECTED");
    const path = join(migrationRoot, `${entry.tag}.sql`);
    await requirePlainLocalPath(path);
    if ((await stat(path)).size > 16 * 1024 * 1024)
      throw new Error("LOCAL_SCHEMA_REJECTED");
    // Same UTF-8/hash boundary as drizzle-orm's readMigrationFiles; no newline rewriting.
    result.push({
      index,
      when: entry.when,
      tag: entry.tag,
      sha256: createHash("sha256")
        .update(await readFile(path, "utf8"))
        .digest("hex"),
    });
  }
  return result;
}

export async function inspectLocalSchema(
  db: SqlExecutor,
  catalogue: readonly LocalMigration[],
) {
  const [table] = await db.execute<{ present: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  );
  if (!table?.present) {
    await requireEmptyUnmigratedSchema(db);
    return {
      schemaVersion: 0,
      journalFingerprint: localMigrationFingerprint([]),
    };
  }
  const applied = await db.execute<{ hash: string; created_at: string }>(sql`
    select hash, created_at::text from drizzle.__drizzle_migrations order by created_at,id limit 10001`);
  if (applied.length > catalogue.length)
    throw new Error("LOCAL_SCHEMA_REJECTED");
  // The migrator creates its empty ledger outside its migration transaction.
  // An empty ledger alone is not proof that the application schema is empty.
  if (applied.length === 0) await requireEmptyUnmigratedSchema(db);
  for (const [index, row] of applied.entries()) {
    const expected = catalogue[index]!;
    if (
      row.hash !== expected.sha256 ||
      row.created_at !== String(expected.when)
    )
      throw new Error("LOCAL_SCHEMA_REJECTED");
  }
  return {
    schemaVersion: applied.length,
    journalFingerprint: localMigrationFingerprint(
      catalogue.slice(0, applied.length),
    ),
  };
}

async function requireEmptyUnmigratedSchema(db: SqlExecutor) {
  const [state] = await db.execute<{ empty: boolean }>(sql`select
    not exists(select 1 from pg_namespace where left(nspname,3)<>'pg_'
      and nspname not in ('public','drizzle','information_schema'))
    and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where left(n.nspname,3)<>'pg_' and n.nspname<>'information_schema'
      and not (n.nspname='drizzle' and ((c.relname='__drizzle_migrations' and c.relkind='r')
        or (c.relname='__drizzle_migrations_id_seq' and c.relkind='S')
        or (c.relname='__drizzle_migrations_pkey' and c.relkind='i'))))
    and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where left(n.nspname,3)<>'pg_' and n.nspname<>'information_schema')
    and not exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public') as empty`);
  if (!state?.empty) throw new Error("LOCAL_SCHEMA_REJECTED");
}

/** Closed first-install observation only. No server, seed, owner, receipt repair,
 * or migration is started here. The host decides after an explicit recovery UI. */
export async function inspectLocalProvisioning(
  db: Database,
  rawInput: unknown,
) {
  const input = localMaintenanceInput.parse(rawInput);
  if (input.operationId !== process.env.LOCAL_HOST_OPERATION_ID)
    throw new Error("LOCAL_OPERATION_MISMATCH");
  await assertLocalDatabaseRole(db, "owner");
  const catalogue = await readLocalMigrations();
  if (
    input.sourceSchemaVersion !== catalogue.length ||
    input.sourceFingerprint !== localMigrationFingerprint(catalogue)
  )
    throw new Error("LOCAL_SCHEMA_REJECTED");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`set transaction isolation level repeatable read, read only`,
    );
    const state = await inspectLocalSchema(tx, catalogue);
    if (state.schemaVersion === 0)
      return { ...state, initialized: false } as const;
    // drizzle 0.45.2 applies migration SQL and ledger inserts in one transaction.
    // A partial prefix is not silently adopted/repaired by first-run recovery.
    if (state.schemaVersion !== catalogue.length)
      throw new Error("LOCAL_RECOVERY_REQUIRED");
    const identity = await inspectLocalHost(tx, env.LOCAL_INSTANCE_ID);
    if (!identity.initialized) await requireEmptyLocalOwnerDatabase(tx);
    return { ...state, ...identity };
  });
}

const receiptSchema = z
  .object({
    format: z.literal(1),
    operationId: z.string().uuid(),
    kind: z.enum(["migrate", "revoke-access"]),
    instanceId: z.string().uuid(),
    sourceSchemaVersion: z.number().int().nonnegative(),
    sourceFingerprint: z.string(),
    targetFingerprint: z.string(),
    phase: z.enum(["INTENT", "COMPLETE"]),
  })
  .strict();

async function withReceipt(
  db: Database,
  kind: "migrate" | "revoke-access",
  input: Input,
  work: () => Promise<void>,
) {
  const catalogue = await readLocalMigrations();
  const targetFingerprint = localMigrationFingerprint(catalogue);
  if (input.operationId !== process.env.LOCAL_HOST_OPERATION_ID)
    throw new Error("LOCAL_OPERATION_MISMATCH");
  const directory = join(env.LOCAL_DATA_ROOT, "maintenance");
  await requirePlainLocalPath(directory);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${input.operationId}-${kind}.json`);
  const receipt = {
    format: 1 as const,
    operationId: input.operationId,
    kind,
    instanceId: env.LOCAL_INSTANCE_ID,
    sourceSchemaVersion: input.sourceSchemaVersion,
    sourceFingerprint: input.sourceFingerprint,
    targetFingerprint,
    phase: "INTENT" as "INTENT" | "COMPLETE",
  };
  await requirePlainLocalPath(path);
  let existing: z.infer<typeof receiptSchema> | null = null;
  try {
    if ((await stat(path)).size > 16_384)
      throw new Error("LOCAL_RECOVERY_REQUIRED");
    existing = receiptSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing) {
    if (
      existing.phase !== "COMPLETE" ||
      JSON.stringify({ ...existing, phase: "INTENT" }) !==
        JSON.stringify(receipt)
    )
      throw new Error("LOCAL_RECOVERY_REQUIRED");
    // A receipt alone is never proof of current schema bytes.
    const state = await inspectLocalSchema(db, catalogue);
    if (state.journalFingerprint !== targetFingerprint)
      throw new Error("LOCAL_SCHEMA_REJECTED");
    return { completed: true, ...state };
  }
  const before = await inspectLocalSchema(db, catalogue);
  if (
    before.schemaVersion !== input.sourceSchemaVersion ||
    before.journalFingerprint !== input.sourceFingerprint
  )
    throw new Error("LOCAL_SCHEMA_REJECTED");
  const intent = await open(path, "wx", 0o600);
  try {
    await intent.writeFile(JSON.stringify(receipt));
    await intent.sync();
  } finally {
    await intent.close();
  }
  // Any interruption after this boundary leaves an INTENT and blocks automatic repetition.
  await work();
  const state = await inspectLocalSchema(db, catalogue);
  if (state.journalFingerprint !== targetFingerprint)
    throw new Error("LOCAL_SCHEMA_REJECTED");
  const pendingPath = `${path}.complete`;
  await requirePlainLocalPath(pendingPath);
  const pending = await open(pendingPath, "wx", 0o600);
  try {
    await pending.writeFile(JSON.stringify({ ...receipt, phase: "COMPLETE" }));
    await pending.sync();
  } finally {
    await pending.close();
  }
  await rename(pendingPath, path);
  return { completed: true, ...state };
}

export async function migrateLocalCandidate(db: Database, rawInput: unknown) {
  const input = localMaintenanceInput.parse(rawInput);
  await assertLocalDatabaseRole(db, "owner");
  return withReceipt(db, "migrate", input, async () => {
    await migrate(db, { migrationsFolder: migrationRoot });
  });
}

export async function revokeRestoredLocalAccess(
  db: Database,
  rawInput: unknown,
) {
  const input = localMaintenanceInput.parse(rawInput);
  await assertLocalDatabaseRole(db, "owner");
  if (!input.expectedOwnerId) throw new Error("LOCAL_OWNER_UNAVAILABLE");
  const identity = await inspectLocalHost(db, env.LOCAL_INSTANCE_ID);
  if (!identity.initialized || identity.ownerId !== input.expectedOwnerId)
    throw new Error("LOCAL_INSTANCE_MISMATCH");
  return withReceipt(db, "revoke-access", input, async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(677001)`);
      await tx.execute(sql`delete from sessions`);
      await tx.execute(
        sql`update account_sessions set revoked_at=now() where revoked_at is null`,
      );
      // Outbox rows cascade with their one-time credentials. Password hashes and users stay.
      await tx.execute(sql`delete from account_action_tokens`);
      await tx.execute(
        sql`update account_campaign_invites set revoked_at=now() where revoked_at is null`,
      );
      await tx.execute(
        sql`update invites set revoked_at=now() where revoked_at is null`,
      );
      await tx.execute(
        sql`update player_access_grants set revoked_at=now(),revision=revision+1,updated_at=now() where revoked_at is null`,
      );
      // LOCAL_HOST disables bearer campaign links, and restored legacy hashes are removed entirely.
      await tx.execute(sql`delete from gm_access_credentials`);
    });
  });
}

export async function verifyLocalCandidate(db: Database, rawInput: unknown) {
  const input = localMaintenanceInput.parse(rawInput);
  if (input.operationId !== process.env.LOCAL_HOST_OPERATION_ID)
    throw new Error("LOCAL_OPERATION_MISMATCH");
  await assertLocalDatabaseRole(db, "owner");
  const catalogue = await readLocalMigrations();
  const state = await inspectLocalSchema(db, catalogue);
  if (
    state.schemaVersion !== catalogue.length ||
    state.journalFingerprint !== localMigrationFingerprint(catalogue) ||
    state.schemaVersion !== input.sourceSchemaVersion ||
    state.journalFingerprint !== input.sourceFingerprint
  )
    throw new Error("LOCAL_SCHEMA_REJECTED");
  const identity = await inspectLocalHost(db, env.LOCAL_INSTANCE_ID);
  if (
    !identity.initialized ||
    (input.expectedOwnerId && identity.ownerId !== input.expectedOwnerId)
  )
    throw new Error("LOCAL_INSTANCE_MISMATCH");
  if (input.requireRevokedAccess) {
    if (!input.expectedOwnerId) throw new Error("LOCAL_OWNER_UNAVAILABLE");
    const [access] = await db.execute<{ remaining: string }>(sql`
      select ((select count(*) from sessions) +
        (select count(*) from account_sessions where revoked_at is null) +
        (select count(*) from account_action_tokens) +
        (select count(*) from account_campaign_invites where revoked_at is null) +
        (select count(*) from invites where revoked_at is null) +
        (select count(*) from player_access_grants where revoked_at is null) +
        (select count(*) from gm_access_credentials))::text as remaining`);
    if (access?.remaining !== "0") throw new Error("LOCAL_ACCESS_NOT_REVOKED");
  }
  const [foreignUsers] = await db.execute<{
    count: string;
  }>(sql`select count(*)::text as count from users
    where identity_kind<>'LOCAL' or local_instance_id is distinct from ${env.LOCAL_INSTANCE_ID}::uuid`);
  if (foreignUsers?.count !== "0") throw new Error("LOCAL_INSTANCE_MISMATCH");
  // Telegram intake uses a different private store, not MEDIA_ROOT. Never silently omit it.
  const [privateFiles] = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from bug_intake_files where storage_key is not null`,
  );
  if (privateFiles?.count !== "0")
    throw new Error("LOCAL_ARCHIVE_LAYOUT_UNSUPPORTED");
  const media = await db.execute<{
    storage_key: string;
    size_bytes: number;
  }>(sql`
    select storage_key,size_bytes from (
      select storage_key,size_bytes from assets
      union all select poster_storage_key,poster_size_bytes from assets where poster_storage_key is not null
      union all select storage_key,size_bytes from feedback_attachments
      union all select storage_key,size_bytes from sticker_media
      union all select storage_key,size_bytes from global_sticker_media
      union all select storage_key,size_bytes from chat_attachment_uploads where status='CLAIMED'
      union all select storage_key,size_bytes from chat_attachment_uploads where status='STAGED' and expires_at>now()
      union all select storage_key,size_bytes from audio_clip_candidates where status='READY' and expires_at>now()
    ) files limit 100001`);
  if (media.length > 100_000) throw new Error("LOCAL_ARCHIVE_LIMIT");
  const seen = new Map<string, { name: string; size: number }>();
  await requirePlainLocalPath(env.MEDIA_ROOT);
  for (const file of media) {
    if (
      !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,254}$/.test(file.storage_key ?? "") ||
      !Number.isSafeInteger(file.size_bytes) ||
      file.size_bytes < 0
    )
      throw new Error("LOCAL_MEDIA_MISMATCH");
    const key = file.storage_key.toLowerCase();
    const previous = seen.get(key);
    if (
      previous &&
      (previous.size !== file.size_bytes || previous.name !== file.storage_key)
    )
      throw new Error("LOCAL_MEDIA_MISMATCH");
    seen.set(key, { name: file.storage_key, size: file.size_bytes });
    const path = join(env.MEDIA_ROOT, file.storage_key);
    await requirePlainLocalPath(path);
    const info = await stat(path);
    if (!info.isFile() || info.size !== file.size_bytes)
      throw new Error("LOCAL_MEDIA_MISMATCH");
  }
  return {
    verified: true,
    instanceId: env.LOCAL_INSTANCE_ID,
    ownerId: identity.ownerId,
    revision: env.BUILD_REVISION,
    ...state,
    referencedMediaFiles: seen.size,
    ...(input.requireRevokedAccess ? { accessRevoked: true } : {}),
  };
}
