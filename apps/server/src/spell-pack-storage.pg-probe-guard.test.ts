import { describe, expect, it } from "vitest";
import {
  classifyProbeDiagnostic,
  deriveMigrationIdentity,
  ProbeAssertionError,
  requiredMembershipColumns,
  requiredRoleLabels,
  validateMigrationPreflight,
} from "../../../packages/db/src/multiplayer-migration-preflight.mjs";

const migrationDirectory = new URL(
  "../../../packages/db/drizzle/",
  import.meta.url,
);
const currentIdentity = deriveMigrationIdentity(migrationDirectory);

function validSnapshot() {
  return {
    source: currentIdentity,
    ledgerHashes: currentIdentity.migrationHashes,
    membershipColumns: requiredMembershipColumns,
    roleLabels: requiredRoleLabels,
  };
}

describe("spell-pack PostgreSQL probe preflight diagnostics", () => {
  it("derives identity from the actual journal and SQL files", () => {
    expect(currentIdentity.count).toBeGreaterThan(0);
    expect(currentIdentity.migrationHashes).toHaveLength(currentIdentity.count);
    expect(currentIdentity.journalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(currentIdentity.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      validateMigrationPreflight(currentIdentity, validSnapshot()),
    ).not.toThrow();
  });

  it("fails closed when image migration identity is stale or modified", () => {
    const staleImage = validSnapshot();
    staleImage.source = {
      ...currentIdentity,
      count: currentIdentity.count - 11,
      migrationHashes: currentIdentity.migrationHashes.slice(0, -11),
    };
    expect(() =>
      validateMigrationPreflight(currentIdentity, staleImage),
    ).toThrow("SPELL_PROBE_PREFLIGHT:SOURCE_MISMATCH");

    const modifiedSource = validSnapshot();
    modifiedSource.source = {
      ...currentIdentity,
      manifestSha256: "0".repeat(64),
    };
    expect(() =>
      validateMigrationPreflight(currentIdentity, modifiedSource),
    ).toThrow("SPELL_PROBE_PREFLIGHT:SOURCE_MISMATCH");
  });

  it("rejects ledger drift before fixtures", () => {
    const staleLedger = validSnapshot();
    staleLedger.ledgerHashes = currentIdentity.migrationHashes.slice(0, -11);
    expect(() =>
      validateMigrationPreflight(currentIdentity, staleLedger),
    ).toThrow("SPELL_PROBE_PREFLIGHT:LEDGER_MISMATCH");
  });

  it("rejects missing fixture columns and role labels", () => {
    const missingUserId = validSnapshot();
    missingUserId.membershipColumns = requiredMembershipColumns.filter(
      (column) => column !== "user_id",
    );
    expect(() =>
      validateMigrationPreflight(currentIdentity, missingUserId),
    ).toThrow("SPELL_PROBE_PREFLIGHT:MEMBERSHIP_COLUMNS");

    const missingRole = validSnapshot();
    missingRole.roleLabels = ["GM"];
    expect(() =>
      validateMigrationPreflight(currentIdentity, missingRole),
    ).toThrow("SPELL_PROBE_PREFLIGHT:ROLE_ENUM");
  });

  it("reports only safe API codes and allowlisted SQLSTATEs", () => {
    expect(
      classifyProbeDiagnostic(
        new Error("SPELL_PROBE_API_CREATE:500:SPELL_PACK_CONFLICT"),
      ),
    ).toBe("SPELL_PROBE_DIAGNOSTIC:API_CREATE:500:SPELL_PACK_CONFLICT");
    expect(
      classifyProbeDiagnostic(
        new Error("SPELL_PROBE_API_CREATE:500:SECRET_TOKEN"),
      ),
    ).toBe("SPELL_PROBE_DIAGNOSTIC:API_CREATE:500:UNRECOGNIZED");

    const cause = new Error("private SQL and DSN");
    cause.name = "PostgresError";
    Object.assign(cause, { code: "42703" });
    const wrapped = new Error("private response body", { cause });
    wrapped.name = "DrizzleQueryError";
    const diagnostic = classifyProbeDiagnostic(wrapped);
    expect(diagnostic).toContain("CAUSE:PostgresError:42703");
    expect(diagnostic).not.toContain("private");

    const unlistedCause = new Error("private SQL");
    unlistedCause.name = "PostgresError";
    Object.assign(unlistedCause, { code: "ABCDE" });
    const unlisted = new Error("private body", { cause: unlistedCause });
    unlisted.name = "DrizzleQueryError";
    expect(classifyProbeDiagnostic(unlisted)).toContain(
      "CAUSE:PostgresError:UNRECOGNIZED",
    );
    expect(
      classifyProbeDiagnostic(new ProbeAssertionError("fixed assertion")),
    ).toBe("SPELL_PROBE_DIAGNOSTIC:ASSERTION:fixed assertion");
  });
});
