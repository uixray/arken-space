import { spawnSync } from "node:child_process";
import process from "node:process";

const compose = [
  "compose",
  "--project-name",
  "arken-e2e",
  "--file",
  "docker-compose.e2e.yml",
];

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  const up = run("docker", [...compose, "up", "--detach", "--build", "--wait"]);
  if (up !== 0) process.exitCode = up;
  else {
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const status = run(pnpm, [
      "exec",
      "playwright",
      "test",
      "--config=playwright.multiplayer.config.ts",
    ]);
    process.exitCode = status;
  }
} finally {
  run("docker", [...compose, "down", "--volumes", "--remove-orphans"]);
}
