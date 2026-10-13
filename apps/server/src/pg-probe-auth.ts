import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  gmAccessCredentials,
  memberships,
  playerAccessGrants,
  sessions,
} from "@arken/db";
import { hashToken } from "./security.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type ProbeSession = {
  membershipId: string;
  campaignId: string;
  role: "GM" | "PLAYER";
  token: string;
};

/** Test-only issuance sources; no auth flag overrides or historical sessions. */
export async function seedProbeSessions(
  db: Database,
  fixtures: ProbeSession[],
) {
  for (const fixture of fixtures) {
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, fixture.membershipId))
      .limit(1);
    if (
      !membership ||
      membership.campaignId !== fixture.campaignId ||
      membership.role !== fixture.role
    ) {
      throw new Error("PROBE_SESSION_MEMBERSHIP_MISMATCH");
    }
    const common = {
      membershipId: fixture.membershipId,
      tokenHash: hashToken(fixture.token),
      expiresAt: new Date(Date.now() + 600_000),
    };
    if (fixture.role === "GM") {
      await db
        .insert(gmAccessCredentials)
        .values({
          campaignId: fixture.campaignId,
          tokenHash: hashToken(randomUUID()),
        })
        .onConflictDoNothing();
      const [credential] = await db
        .select()
        .from(gmAccessCredentials)
        .where(eq(gmAccessCredentials.campaignId, fixture.campaignId))
        .limit(1);
      if (!credential) throw new Error("PROBE_GM_CREDENTIAL_MISSING");
      await db.insert(sessions).values({
        ...common,
        authSource: "GM_LINK",
        gmCredentialCampaignId: fixture.campaignId,
        gmCredentialRevision: credential.revision,
      });
    } else {
      const [grant] = await db
        .insert(playerAccessGrants)
        .values({
          campaignId: fixture.campaignId,
          membershipId: fixture.membershipId,
          label: "PostgreSQL probe player",
          tokenHash: hashToken(randomUUID()),
        })
        .returning();
      if (!grant) throw new Error("PROBE_PLAYER_GRANT_MISSING");
      await db.insert(sessions).values({
        ...common,
        authSource: "PLAYER_GRANT",
        playerAccessGrantId: grant.id,
        playerAccessGrantRevision: grant.revision,
      });
    }
  }
}
