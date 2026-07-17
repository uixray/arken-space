import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_SINCE_HOURS,
  redactDiagnosticText,
  validateSince,
} from "../scripts/collect-incident-bundle.mjs";

describe("production operations contracts", () => {
  it("bounds json-file logs for every production service", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");
    expect(compose.match(/driver: json-file/g)).toHaveLength(3);
    expect(compose.match(/max-size: "10m"/g)).toHaveLength(3);
    expect(compose.match(/max-file: "5"/g)).toHaveLength(3);
  });

  it("accepts only a short bounded incident time window", () => {
    expect(validateSince("30m")).toBe("30m");
    expect(validateSince(`${MAX_SINCE_HOURS}h`)).toBe(`${MAX_SINCE_HOURS}h`);
    expect(() => validateSince("25h")).toThrow(/no more than/);
    expect(() => validateSince("2026-07-17")).toThrow(/bounded duration/);
  });

  it("redacts common credentials from diagnostic text", () => {
    const text = redactDiagnosticText(
      "authorization: Bearer-secret cookie=abc session: xyz postgres://arken:password@postgres/arken",
    );
    expect(text).not.toContain("Bearer-secret");
    expect(text).not.toContain("cookie=abc");
    expect(text).not.toContain("password@");
    expect(text).toContain("[REDACTED]");
  });

  it("removes complete bearer and multi-value Cookie headers", () => {
    const text = redactDiagnosticText(
      "Authorization: Bearer top-secret.jwt.value\nCookie: arken_session=session-secret; theme=dark; tracking=private\nrequest complete",
    );
    expect(text).toContain("Authorization: [REDACTED]");
    expect(text).toContain("Cookie: [REDACTED]");
    expect(text).toContain("request complete");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("top-secret");
    expect(text).not.toContain("session-secret");
    expect(text).not.toContain("theme=dark");
    expect(text).not.toContain("tracking=private");
  });

  it("redacts nested JSON/Pino authorization and cookie fields", () => {
    const text = redactDiagnosticText(
      '{"level":30,"req":{"headers":{"authorization":"Bearer json-secret","cookie":"arken_session=pino-secret; theme=dark"}},"msg":"request"}',
    );
    expect(text).toContain('"authorization":"[REDACTED]"');
    expect(text).toContain('"cookie":"[REDACTED]"');
    expect(text).toContain('"msg":"request"');
    expect(text).not.toContain("Bearer json-secret");
    expect(text).not.toContain("pino-secret");
    expect(text).not.toContain("theme=dark");
  });

  it("redacts every sensitive plain-text key without consuming adjacent fields", () => {
    const secrets = [
      "bearer-value",
      "cookie-value",
      "gm-value",
      "xyz",
      "abc",
      "oops",
      "hunter2",
      "token-value",
    ];
    const text = redactDiagnosticText(
      "authorization: Bearer bearer-value cookie=cookie-value gm_access_token: gm-value " +
        "session: xyz invite_token: abc secret=oops password: hunter2 " +
        "token: token-value status=kept requestId=req-123",
    );
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(text).not.toContain("Bearer");
    expect(text).toContain("status=kept");
    expect(text).toContain("requestId=req-123");
    expect(text.match(/\[REDACTED]/g)).toHaveLength(secrets.length);
  });

  it("documents private-data exclusions and explicit retention", () => {
    const operations = readFileSync("docs/operations.md", "utf8");
    expect(operations).toContain("never includes database rows");
    expect(operations).toContain(
      "delete local and received copies within 14 days",
    );
    expect(operations).toContain("`game_events`");
    expect(operations).toContain("`chat_messages`");
    expect(operations).toContain("there is no automatic age-based deletion");
  });
});
