import process from "node:process";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
const require = createRequire(import.meta.url);
const [mode, ...targets] = process.argv.slice(2);
const scopes = {
  web: "apps/web/tsconfig.json",
  server: "apps/server/tsconfig.json",
  contracts: "packages/contracts/tsconfig.json",
  db: "packages/db/tsconfig.json",
  system: "packages/system/tsconfig.json",
  e2e: "tests/e2e/tsconfig.json",
  configs: "tsconfig.configs.json",
};
if (!targets.length || !["lint", "types", "test"].includes(mode)) {
  throw new Error(
    "Explicit pool required: dev-check.mjs lint <files> | types <scopes> | test <test files>",
  );
}
const bin = (pkg, name) => {
  const path = require.resolve(`${pkg}/package.json`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  return resolve(
    dirname(path),
    typeof data.bin === "string" ? data.bin : data.bin[name],
  );
};
const commands = [];
if (mode === "types") {
  for (const scope of targets) {
    if (!Object.hasOwn(scopes, scope))
      throw new Error(`Unknown scope: ${scope}`);
    commands.push([
      require.resolve("typescript/bin/tsc"),
      "--noEmit",
      "-p",
      scopes[scope],
    ]);
  }
} else {
  for (const target of targets) {
    if (
      target.startsWith("-") ||
      !existsSync(target) ||
      !statSync(target).isFile()
    )
      throw new Error(`Expected existing explicit file: ${target}`);
    if (mode === "test" && !/\.test\.tsx?$/.test(target))
      throw new Error(`Expected unit test file: ${target}`);
  }
  commands.push(
    mode === "lint"
      ? [
          bin("eslint", "eslint"),
          "--cache",
          ...targets.map((target) => resolve(target)),
        ]
      : [
          bin("vitest", "vitest"),
          "run",
          ...targets.map((target) => resolve(target)),
        ],
  );
}
for (const args of commands) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
