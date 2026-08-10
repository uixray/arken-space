import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Documentation drifts because nothing makes it fail. `architecture.md` sat on
 * a revision from three weeks and a hundred commits back, claiming 21 tables
 * against the schema's 51 and migrations ending at 0015 against 0035 — and
 * every check in the repository stayed green.
 *
 * So the claims that *can* be checked, are. Not the prose: nobody can assert
 * that an explanation is still true. But a count, a table name, a migration
 * range and an event name are facts with one source, and a document repeating
 * them is a copy that can rot. This turns each of those copies into an
 * assertion.
 *
 * **When this fails, the document is wrong, not the test.** Fix the document.
 * The counts are deliberately exact rather than "at least", because a table
 * that disappears is as much a documentation defect as one that appears.
 *
 * The regexes are matched against the doc, so changing how a figure is worded
 * breaks the test loudly instead of silently disabling it — a doc that no
 * longer states its numbers should not be able to pass by omission.
 */
const root = new URL("../", import.meta.url);

async function read(path: string) {
  return readFile(new URL(path, root), "utf8");
}

/** The single number a phrase like "содержит **51** прикладную таблицу" states. */
function statedNumber(document: string, pattern: RegExp): number {
  const match = document.match(pattern);
  expect(
    match,
    `architecture.md no longer states this figure (pattern: ${pattern}). ` +
      `If the wording changed, update the pattern; if the claim was dropped, ` +
      `this check should be dropped with it.`,
  ).not.toBeNull();
  return Number(match![1]);
}

describe("architecture.md still describes the code it documents", () => {
  it("states the actual number of database tables", async () => {
    const schema = await read("packages/db/src/schema.ts");
    const actual = [...schema.matchAll(/pgTable\(\s*\n?\s*"([a-z_]+)"/g)]
      .length;
    const stated = statedNumber(
      await read("docs/architecture.md"),
      /содержит \*\*(\d+)\*\* прикладную таблицу/,
    );
    expect(stated).toBe(actual);
  });

  it("names every table that exists, and no table that does not", async () => {
    const schema = await read("packages/db/src/schema.ts");
    const actual = [...schema.matchAll(/pgTable\(\s*\n?\s*"([a-z_]+)"/g)]
      .map((match) => match[1]!)
      .sort();
    const document = await read("docs/architecture.md");
    // The tables are listed as `code spans` inside the data-model table.
    const documented = new Set(
      [...document.matchAll(/`([a-z_]{3,})`/g)].map((match) => match[1]!),
    );

    const missing = actual.filter((table) => !documented.has(table));
    expect(
      missing,
      "these tables exist but architecture.md does not mention them",
    ).toEqual([]);
  });

  it("states the actual migration range", async () => {
    const files = (await readdir(new URL("packages/db/drizzle/", root)))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const last = files.at(-1)!.slice(0, 4);
    const document = await read("docs/architecture.md");
    const match = document.match(/Миграции `0000`–`(\d{4})`/);
    expect(
      match,
      "architecture.md no longer states the migration range",
    ).not.toBeNull();
    expect(match![1]).toBe(last);
  });

  it("states the actual number of HTTP routes", async () => {
    const routes = await read("apps/server/src/routes.ts");
    const actual = [...routes.matchAll(/app\.(get|post|patch|put|delete)\(/g)]
      .length;
    const stated = statedNumber(
      await read("docs/architecture.md"),
      /Всего \*\*(\d+)\*\* HTTP-маршрутов/,
    );
    expect(stated).toBe(actual);
  });

  it("names every realtime event the server handles or emits", async () => {
    const realtime = await read("apps/server/src/realtime.ts");
    const received = [...realtime.matchAll(/socket\.on\("([a-z:]+)"/g)]
      .map((match) => match[1]!)
      // Socket.IO's own lifecycle event is not part of the game protocol.
      .filter((event) => event !== "disconnect");
    const emitted = [...realtime.matchAll(/emit\("([a-z:]+)"/g)].map(
      (match) => match[1]!,
    );
    const document = await read("docs/architecture.md");

    const undocumented = [...new Set([...received, ...emitted])].filter(
      (event) => !document.includes(`\`${event}\``),
    );
    expect(
      undocumented,
      "these realtime events exist but architecture.md does not mention them",
    ).toEqual([]);
  });
});

describe("the documentation index covers the documents it claims to", () => {
  it("links every document it calls maintained", async () => {
    const index = await read("docs/README.md");
    const linked = [...index.matchAll(/\]\(\.\/([\w.-]+\.md)\)/g)].map(
      (match) => match[1]!,
    );
    const present = new Set(await readdir(new URL("docs/", root)));

    const dangling = linked.filter((name) => !present.has(name));
    expect(dangling, "docs/README.md links files that do not exist").toEqual(
      [],
    );
  });
});
