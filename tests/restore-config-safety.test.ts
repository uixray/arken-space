import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applicationCountTableNames,
  describeDatabaseCountCoverage,
} from "../scripts/restore-rehearsal-core.mjs";

const root = process.cwd();

describe("restore recovery account and table safety", () => {
  it("covers current account, invite, idempotency and encrypted outbox schema tables", () => {
    const schema = readFileSync(
      path.join(root, "packages/db/src/schema.ts"),
      "utf8",
    );
    const expected = [...schema.matchAll(/pgTable\(\s*"([^"]+)"/g)]
      .map((match) => match[1])
      .sort();
    const sql = readFileSync(
      path.join(root, "infra/backup/database-counts.sql"),
      "utf8",
    );
    const sqlTables = [...sql.matchAll(/^\s+\('([^']+)'\),?$/gm)]
      .map((match) => match[1])
      .sort();
    expect([...applicationCountTableNames].sort()).toEqual(expected);
    expect(sqlTables).toEqual(expected);
    const coverage = describeDatabaseCountCoverage(
      Object.fromEntries(expected.map((table) => [table, 0])),
    );
    expect(coverage).toMatchObject({
      mode: "full",
      missingTables: [],
      knownPersistedTables: expected.length,
    });
    for (const table of [
      "users",
      "account_sessions",
      "account_action_tokens",
      "account_campaign_creations",
      "account_campaign_invites",
      "account_mail_outbox",
    ])
      expect(sqlTables).toContain(table);
  });

  it("runs restore in production account mode while all public expansion flags remain explicitly off", () => {
    const compose = readFileSync(
      path.join(root, "docker-compose.restore.yml"),
      "utf8",
    );
    for (const entry of [
      'ACCOUNT_AUTH_ENABLED: "true"',
      'ACCOUNT_REGISTRATION_ENABLED: "false"',
      'ACCOUNT_REGISTRATION_POLICY_APPROVED: "false"',
      'LEGACY_DEV_AUTH_ENABLED: "false"',
      'ACCOUNT_CAMPAIGN_CREATION_ENABLED: "false"',
      'ACCOUNT_CAMPAIGN_CREATION_POLICY_APPROVED: "false"',
      'CAMPAIGN_LINK_ACCESS_ENABLED: "false"',
      'ACCOUNT_MAIL_RUNTIME_ENABLED: "false"',
    ])
      expect(compose).toContain(entry);
  });
});
