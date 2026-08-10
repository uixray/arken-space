import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/**/*.test.ts",
      "apps/**/src/**/*.test.ts",
      "apps/**/src/**/*.test.tsx",
    ],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    /*
     * Several suites spin up their own in-process PGlite database and apply
     * all 36 migrations in a `beforeEach`. Run enough of those concurrently
     * and they start timing out in hooks -- not because any individual test
     * is slow, but because they contend for the same machine. It has been
     * reproducible enough that runs were routinely being passed
     * `--maxWorkers=2` by hand, which makes a real failure look like the
     * usual flake and invites ignoring it.
     *
     * Capped here so the default `pnpm test` is deterministic without anyone
     * having to remember the flag. This is a mitigation, not a diagnosis:
     * the underlying contention has not been root-caused, and lifting the cap
     * should wait until it is (see docs/system-review-2026-08-10.md, D2).
     */
    maxWorkers: 2,
    coverage: { reporter: ["text", "json-summary"] },
  },
});
