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
 * assertion. Safety-critical operational copies (release script boundaries,
 * host paths and test-runner invariants) are checked below for the same reason.
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
      /содержит \*\*(\d+)\*\* прикладн(?:ую таблицу|ые таблицы|ых таблиц)/,
    );
    expect(stated).toBe(actual);
  });

  it("names every table that exists, and no table that does not", async () => {
    const schema = await read("packages/db/src/schema.ts");
    const actual = [...schema.matchAll(/pgTable\(\s*\n?\s*"([a-z_]+)"/g)]
      .map((match) => match[1]!)
      .sort();
    const document = await read("docs/architecture.md");
    const dataModel = document.match(/## Данные[\s\S]*?Ключевые отношения:/);
    expect(
      dataModel,
      "architecture.md no longer has a bounded data table",
    ).not.toBeNull();
    // Bound the scan to the data-model table. Other sections legitimately
    // contain code spans for columns, events and statuses that are not tables.
    const documented = new Set(
      [...dataModel![0].matchAll(/`([a-z_]{3,})`/g)].map((match) => match[1]!),
    );

    const missing = actual.filter((table) => !documented.has(table));
    expect(
      missing,
      "these tables exist but architecture.md does not mention them",
    ).toEqual([]);
    const extra = [...documented].filter((table) => !actual.includes(table));
    expect(
      extra,
      "architecture.md names these as tables, but schema.ts does not",
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
    const modules = (await readdir(new URL("apps/server/src/", root))).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    const sources = await Promise.all(
      modules.map((name) => read(`apps/server/src/${name}`)),
    );
    const actual = sources.reduce(
      (count, source) =>
        count +
        [...source.matchAll(/app\.(get|post|patch|put|delete)\(/g)].length,
      0,
    );
    const stated = statedNumber(
      await read("docs/architecture.md"),
      /Всего \*\*(\d+)\*\* HTTP-маршрут/,
    );
    expect(stated).toBe(actual);
  });

  it("states the actual per-thread chat snapshot limit", async () => {
    const snapshot = await read("apps/server/src/snapshot.ts");
    const limit = snapshot.match(/SNAPSHOT_MESSAGES_PER_THREAD\s*=\s*(\d+)/);
    expect(
      limit,
      "snapshot.ts no longer states a static thread limit",
    ).not.toBeNull();
    const architecture = await read("docs/architecture.md");
    expect(architecture).toContain(
      `последние ${limit![1]} сообщений каждого разрешённого chat-thread`,
    );
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

describe("operational documentation keeps its safety boundaries", () => {
  it("documents the local database port and process-environment traps", async () => {
    const compose = await read("docker-compose.yml");
    const postgresService = compose.match(
      /\r?\n {2}postgres:\r?\n([\s\S]*?)\r?\n {2}server:\r?\n/,
    );
    expect(
      postgresService,
      "docker-compose.yml no longer has postgres/server",
    ).not.toBeNull();
    expect(postgresService![1]).not.toMatch(/\r?\n {4}ports:/);

    const guide = await read("docs/development-guide.md");
    expect(guide).toMatch(/не\s+публикует порт на host/);
    expect(guide).toContain("docker-compose.override.yml");
    expect(guide).toMatch(/не\s+загружают `.env` автоматически/);
  });

  it("keeps e2e fixtures in typecheck and shared-state Playwright serial", async () => {
    const packageJson = JSON.parse(await read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.typecheck).toContain(
      "tsc -p tests/e2e/tsconfig.json",
    );

    const playwright = await read("playwright.config.ts");
    expect(playwright).toMatch(/workers:\s*1/);

    for (const path of ["docs/development-guide.md", "docs/testing.md"]) {
      const document = await read(path);
      expect(document, `${path} must document e2e typecheck`).toContain(
        "tests/e2e/tsconfig.json",
      );
      expect(document, `${path} must document serial Playwright`).toContain(
        "workers: 1",
      );
    }
  });

  it("distinguishes read-only formatting and preserves Playwright exit status", async () => {
    const packageJson = JSON.parse(await read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.format).toContain("prettier --write");
    expect(packageJson.scripts["format:check"]).toContain("prettier --check");

    const testing = await read("docs/testing.md");
    expect(testing).toContain("`pnpm format:check` ничего не меняет");
    expect(testing).toContain("Не ставьте `grep`");
    expect(testing).toContain("exit code");
  });

  it("describes what release.sh automates and what remains manual", async () => {
    const script = await read("infra/deploy/release.sh");
    for (const automated of [
      "infra/backup/backup.sh",
      "restore:rehearse",
      "infra/deploy/build-and-start.sh",
      "infra/deploy/smoke-auth.sh",
    ]) {
      expect(script, `release.sh must still automate ${automated}`).toContain(
        automated,
      );
    }
    for (const outsideScript of [
      "pnpm format:check",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm test",
      "pnpm test:e2e",
      "pnpm test:multiplayer",
    ]) {
      expect(
        script,
        `${outsideScript} unexpectedly moved into release.sh`,
      ).not.toContain(outsideScript);
    }

    const checklist = await read("docs/production-release-checklist.md");
    expect(checklist).toContain("Code quality gate (outside `release.sh`)");
    expect(checklist).toContain("does **not** run the code quality");
    expect(checklist).toContain("one image upload");
    expect(checklist).toContain("one audio upload");
    expect(checklist).toContain("docker compose restart postgres server web");
  });

  it("uses the host media path and avoids a stale migration range", async () => {
    const canonicalMediaHostPath = "/home/uixray/apps/arken-space-data/media";
    const deployment = await read("docs/deployment.md");
    const operations = await read("docs/operations.md");
    const checklist = await read("docs/production-release-checklist.md");

    expect(deployment).toContain(`MEDIA_HOST_PATH=${canonicalMediaHostPath}`);
    expect(deployment).not.toContain("MEDIA_HOST_PATH=/srv/arken-space/media");
    expect(operations).toContain(canonicalMediaHostPath);
    expect(checklist).toContain("packages/db/drizzle/meta/_journal.json");
    expect(checklist).not.toMatch(
      /`0000`[^\n]{0,40}(?:through|[-–]|до)[^\n]{0,20}`?\d{4}`?/i,
    );
  });

  it("keeps the Docker multiplayer runner bounded and privacy-safe", async () => {
    const packageJson = JSON.parse(await read("package.json")) as {
      devDependencies: Record<string, string>;
    };
    const dockerfile = await read("Dockerfile.e2e");
    expect(dockerfile).toContain(
      `mcr.microsoft.com/playwright:v${packageJson.devDependencies["@playwright/test"]}-noble`,
    );

    const dockerignore = await read(".dockerignore");
    for (const privatePath of [
      ".agenttmp",
      ".workspace",
      ".worktrees",
      ".tmp_*",
      "docs/stickers",
    ])
      expect(dockerignore, `.dockerignore must exclude ${privatePath}`).toMatch(
        new RegExp(
          `^${privatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "m",
        ),
      );

    const multiplayer = await read("playwright.multiplayer.config.ts");
    const actionTimeout = multiplayer.match(/actionTimeout:\s*(\d[\d_]*)/);
    expect(
      actionTimeout,
      "multiplayer actions need a finite timeout",
    ).not.toBeNull();
    expect(Number(actionTimeout![1]!.replaceAll("_", ""))).toBeGreaterThan(0);
    expect(Number(actionTimeout![1]!.replaceAll("_", ""))).toBeLessThanOrEqual(
      30_000,
    );
  });
});
