import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8");
const serverDockerfile = readFileSync(path.join(root, "Dockerfile.server"), "utf8");
const webDockerfile = readFileSync(path.join(root, "Dockerfile.web"), "utf8");

describe("release container configuration", () => {
  it("passes account/mail controls with safe policy defaults", () => {
    const defaults = {
      ACCOUNT_AUTH_ENABLED: "true",
      LEGACY_DEV_AUTH_ENABLED: "false",
      ACCOUNT_REGISTRATION_ENABLED: "false",
      ACCOUNT_REGISTRATION_POLICY_APPROVED: "false",
      ACCOUNT_SESSION_COOKIE_NAME: "arken_account",
      ACCOUNT_CSRF_COOKIE_NAME: "arken_account_csrf",
      ACCOUNT_CAMPAIGN_CREATION_ENABLED: "false",
      ACCOUNT_CAMPAIGN_CREATION_LIMIT: "3",
      ACCOUNT_CAMPAIGN_CREATION_POLICY_APPROVED: "false",
      CAMPAIGN_LINK_ACCESS_ENABLED: "true",
      ACCOUNT_MAIL_RUNTIME_ENABLED: "false",
      ACCOUNT_MAIL_ACTIVE_KEY_ID: "",
      ACCOUNT_MAIL_KEYRING: "",
      ACCOUNT_MAIL_SMTP_HOST: "",
      ACCOUNT_MAIL_SMTP_PORT: "",
      ACCOUNT_MAIL_SMTP_USERNAME: "",
      ACCOUNT_MAIL_SMTP_PASSWORD: "",
      ACCOUNT_MAIL_SMTP_FROM: "",
      ACCOUNT_MAIL_SMTP_CONNECT_TIMEOUT_MS: "",
      ACCOUNT_MAIL_SMTP_GREETING_TIMEOUT_MS: "",
      ACCOUNT_MAIL_SMTP_SOCKET_TIMEOUT_MS: "",
    } as const;
    for (const [key, value] of Object.entries(defaults)) {
      const expected = ["$", "{", key, ":-", value, "}"].join("");
      expect(compose).toContain(`${key}: ${expected}`);
    }
  });

  it("compiles and validates runtime env before migration with sanitized failure output", () => {
    expect(serverDockerfile).toContain("tsup src/index.ts src/env.ts --format esm --clean --sourcemap");
    const commandLine = serverDockerfile.split(/\r?\n/).find((line) => line.startsWith("CMD "));
    expect(commandLine).toBeDefined();
    const [shell, flag, command] = JSON.parse(commandLine!.slice(4)) as string[];
    expect([shell, flag]).toEqual(["sh", "-c"]);
    const validate = command.indexOf("apps/server/dist/env.js");
    const migration = command.indexOf("pnpm db:migrate");
    const server = command.indexOf("exec node apps/server/dist/index.js");
    expect(validate).toBeGreaterThan(-1);
    expect(migration).toBeGreaterThan(validate);
    expect(server).toBeGreaterThan(migration);
    expect(command).toContain("Invalid runtime configuration; aborting before migration.");
    expect(command).not.toContain("console.error(error)");
    expect(command).not.toContain("|| true");
  });

  it("copies and runs the exact private-font source/dist preflight after the web build", () => {
    const webBuild = webDockerfile.indexOf("pnpm --filter @arken/web build");
    const fontCheck = webDockerfile.indexOf("pnpm release:font:preflight");
    expect(webDockerfile).toContain("COPY scripts/font-release-preflight.mjs scripts/font-release-preflight.mjs");
    expect(existsSync(path.join(root, "scripts/font-release-preflight.mjs"))).toBe(true);
    expect(webBuild).toBeGreaterThan(-1);
    expect(fontCheck).toBeGreaterThan(webBuild);
  });
});
