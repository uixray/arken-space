import { eq, sql } from "drizzle-orm";
import { assets, campaigns, localHostInstances, memberships, users } from "@arken/db";
import { localLoginNameSchema } from "@arken/contracts";
import { z } from "zod";
import { hashPassword } from "./password-security.js";
type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type IdentityReader = Pick<Database, "select">;
export const localOwnerSetupSchema = z.object({ login: localLoginNameSchema, password: z.string().max(512) }).strict();

export async function inspectLocalHost(db: IdentityReader, instanceId: string) {
  const instances = await db.select().from(localHostInstances).limit(2);
  if (instances.length > 1) throw new Error("LOCAL_INSTANCE_MISMATCH");
  const instance = instances[0];
  if (!instance) return { initialized: false } as const;
  if (instance.id !== instanceId) throw new Error("LOCAL_INSTANCE_MISMATCH");
  const [owner] = await db.select().from(users).where(eq(users.id, instance.ownerUserId)).limit(1);
  if (!owner || owner.identityKind !== "LOCAL" || owner.localInstanceId !== instanceId || !owner.localApprovedAt || owner.disabledAt)
    throw new Error("LOCAL_OWNER_UNAVAILABLE");
  return { initialized: true, ownerId: owner.id } as const;
}

export async function requireEmptyLocalOwnerDatabase(db: IdentityReader) {
  const [person] = await db.select({ id: users.id }).from(users).limit(1);
  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).limit(1);
  const [member] = await db.select({ id: memberships.id }).from(memberships).limit(1);
  const [asset] = await db.select({ id: assets.id }).from(assets).limit(1);
  if (person || campaign || member || asset) throw new Error("LOCAL_DATABASE_NOT_EMPTY");
}

/** Called only through inherited private stdio, never HTTP. Existing data is
 * never claimed; host approval is distinct from email verification. */
export async function initializeLocalOwner(db: Database, instanceId: string, input: unknown) {
  z.string().uuid().parse(instanceId);
  const command = localOwnerSetupSchema.parse(input);
  const passwordHash = await hashPassword(command.password);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(677001)`);
    if ((await tx.select({ id: localHostInstances.id }).from(localHostInstances).limit(1)).length)
      throw new Error("LOCAL_ALREADY_INITIALIZED");
    await requireEmptyLocalOwnerDatabase(tx);
    const [owner] = await tx.insert(users).values({ identityKind: "LOCAL", emailNormalized: null,
      emailDisplay: null, verifiedAt: null, localInstanceId: instanceId, localLogin: command.login,
      localApprovedAt: new Date(), passwordHash }).returning({ id: users.id });
    if (!owner) throw new Error("LOCAL_SETUP_FAILED");
    await tx.insert(localHostInstances).values({ id: instanceId, ownerUserId: owner.id });
  });
  return { initialized: true } as const;
}
