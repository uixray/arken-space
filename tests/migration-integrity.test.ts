import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the Drizzle migration metadata at commit time.
 *
 * Two production-adjacent incidents motivated this file, and both were only
 * caught much later — one by the deploy-time restore rehearsal, one by
 * reading generated SQL by hand:
 *
 *   1. `0028_drawing_stroke_width.sql` existed but had no entry in
 *      `_journal.json`. Drizzle's migrator silently skipped it, so the
 *      column was missing in production while every local check passed.
 *   2. The `meta/` snapshots had gone stale (latest was `0013` while 31
 *      migrations had been applied). `drizzle-kit generate` therefore
 *      diffed against the wrong baseline and emitted a migration that
 *      re-created ~30 existing tables, which had to be hand-trimmed.
 *
 * Both classes fail here instead, before the commit lands.
 */

const migrationsDirectory = path.join(
  process.cwd(),
  "packages",
  "db",
  "drizzle",
);
const metaDirectory = path.join(migrationsDirectory, "meta");

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

function readJournal(): JournalEntry[] {
  const journal = JSON.parse(
    readFileSync(path.join(metaDirectory, "_journal.json"), "utf8"),
  ) as { dialect: string; entries: JournalEntry[] };
  expect(journal.dialect).toBe("postgresql");
  return journal.entries;
}

function migrationTags(): string[] {
  return readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.replace(/\.sql$/, ""))
    .sort();
}

function snapshotIndices(): number[] {
  return readdirSync(metaDirectory)
    .filter((file) => /^\d{4}_snapshot\.json$/.test(file))
    .map((file) => Number(file.slice(0, 4)))
    .sort((left, right) => left - right);
}

describe("drizzle migration metadata integrity", () => {
  it("registers every migration file in the journal, and vice versa", () => {
    // Incident 1: a .sql file without a journal entry is silently skipped by
    // the migrator, so it must never reach a commit. The reverse (an entry
    // with no file) is just as bad — `readExpectedMigrationLedger` reads
    // every tag's file and would throw at release-gate time.
    const tags = migrationTags();
    const journalTags = readJournal()
      .map((entry) => entry.tag)
      .sort();

    expect(journalTags).toEqual(tags);
  });

  it("keeps journal indices contiguous and in file order", () => {
    const entries = readJournal();
    entries.forEach((entry, index) => {
      expect(entry.idx).toBe(index);
      // The tag's numeric prefix must agree with its position, otherwise the
      // apply order on a fresh database differs from the recorded order.
      expect(Number(entry.tag.slice(0, 4))).toBe(index);
      expect(Number.isSafeInteger(entry.when)).toBe(true);
    });
  });

  it("keeps a snapshot for the newest migration, so the generator diffs from the real baseline", () => {
    // Incident 2: `drizzle-kit generate` diffs against the newest snapshot.
    // If that is missing or stale, it re-emits already-applied DDL.
    const entries = readJournal();
    const newest = entries.at(-1);
    expect(newest).toBeDefined();
    expect(snapshotIndices()).toContain(newest!.idx);
  });

  it("keeps the newest snapshot's tables in sync with schema.ts", () => {
    // The strongest freshness signal available without running the generator:
    // a stale baseline shows up immediately as a table-set mismatch. (When
    // incident 2 happened, the newest snapshot described 19 tables while the
    // schema had 51.)
    const schema = readFileSync(
      path.join(process.cwd(), "packages", "db", "src", "schema.ts"),
      "utf8",
    );
    const declared = new Set(
      [...schema.matchAll(/pgTable\(\s*"([^"]+)"/g)].map((match) => match[1]!),
    );

    const newestIndex = readJournal().at(-1)!.idx;
    const snapshot = JSON.parse(
      readFileSync(
        path.join(
          metaDirectory,
          `${String(newestIndex).padStart(4, "0")}_snapshot.json`,
        ),
        "utf8",
      ),
    ) as { tables: Record<string, unknown> };
    const snapshotTables = new Set(
      Object.keys(snapshot.tables).map((key) => key.split(".").at(-1)!),
    );

    expect([...snapshotTables].sort()).toEqual([...declared].sort());
  });

  it("documents the historical snapshot gap without treating it as a regression", () => {
    // Snapshots 0014-0031 were never committed. That is pre-existing debt,
    // harmless today because only the newest snapshot is used as a diff
    // baseline — but it does mean `drizzle-kit`'s history cannot be replayed
    // from an arbitrary point. Pinned so the gap can't silently widen: any
    // NEW missing snapshot at or after 0032 is a real regression.
    const present = new Set(snapshotIndices());
    const newestIndex = readJournal().at(-1)!.idx;
    const missingSinceRepair: number[] = [];
    for (let index = 32; index <= newestIndex; index++)
      if (!present.has(index)) missingSinceRepair.push(index);

    expect(missingSinceRepair).toEqual([]);
  });
});
