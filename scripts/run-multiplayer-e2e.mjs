import { spawnSync } from "node:child_process";
import process from "node:process";

const compose = [
  "compose",
  "--project-name",
  "arken-e2e",
  "--file",
  "docker-compose.e2e.yml",
  "--profile",
  "test",
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
  const up = run("docker", [
    ...compose,
    "up",
    "--detach",
    "--build",
    "--wait",
    "edge",
  ]);
  if (up !== 0) process.exitCode = up;
  else {
    const status = run("docker", [...compose, "run", "--rm", "playwright"]);
    process.exitCode = status;
  }
} finally {
  run("docker", [
    ...compose,
    "down",
    "--volumes",
    "--remove-orphans",
    "--rmi",
    "local",
  ]);
}
