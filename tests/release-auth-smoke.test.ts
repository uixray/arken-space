import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AuthSmokeValidationError,
  requireSmokeConfig,
  validateDiagnostics,
  validateLoggedOutDiagnostics,
  validateLogout,
  validateSessionCookieHeaders,
} from "../infra/deploy/auth-smoke-core.mjs";

const revision = "a".repeat(40);
const appRoot = "/home/uixray/apps/arken-space";
const domain = "https://arken-khar.space";
const environment = {
  EXPECTED_BUILD_REVISION: revision,
  EXPECTED_SCHEMA_VERSION: "2",
  SESSION_COOKIE_NAME: "arken_session",
};
const config = requireSmokeConfig(environment);
const cookie =
  "Set-Cookie: arken_session=value; Path=/; HttpOnly; Secure; SameSite=Strict\r\n";

describe("ядро smoke-проверки авторизации", () => {
  it.each(["EXPECTED_BUILD_REVISION", "EXPECTED_SCHEMA_VERSION"] as const)(
    "требует %s",
    (key) => {
      expect(() =>
        requireSmokeConfig({ ...environment, [key]: undefined }),
      ).toThrow(`${key} обязателен`);
    },
  );

  it.each([
    ["HttpOnly", cookie.replace("; HttpOnly", "")],
    ["Secure", cookie.replace("; Secure", "")],
    ["SameSite=Strict", cookie.replace("; SameSite=Strict", "")],
  ])("отвергает cookie без %s", (_flag, headers) => {
    expect(() =>
      validateSessionCookieHeaders(headers, environment.SESSION_COOKIE_NAME),
    ).toThrow(AuthSmokeValidationError);
  });

  it("не принимает флаги cookie с похожим именем за флаги сессии", () => {
    const headers =
      "Set-Cookie: arken_session=value; Path=/\r\n" +
      "Set-Cookie: arken_session_backup=decoy; HttpOnly; Secure; SameSite=Strict\r\n";
    expect(() =>
      validateSessionCookieHeaders(headers, environment.SESSION_COOKIE_NAME),
    ).toThrow("cookie сессии не содержит HttpOnly");
  });

  it("принимает только точное имя cookie и все флаги на одной строке", () => {
    expect(
      validateSessionCookieHeaders(cookie, environment.SESSION_COOKIE_NAME),
    ).toEqual({ httpOnly: true, secure: true, sameSite: "Strict" });
  });

  it.each([
    [
      "неверный статус",
      { status: "error", buildRevision: revision, schemaVersion: 2 },
    ],
    ["нет статуса", { buildRevision: revision, schemaVersion: 2 }],
    [
      "неверная ревизия",
      { status: "ok", buildRevision: "b".repeat(40), schemaVersion: 2 },
    ],
    ["нет ревизии", { status: "ok", schemaVersion: 2 }],
    [
      "неверная схема",
      { status: "ok", buildRevision: revision, schemaVersion: 3 },
    ],
    ["нет схемы", { status: "ok", buildRevision: revision }],
  ])("отвергает диагностику: %s", (_case, body) => {
    expect(() => validateDiagnostics(JSON.stringify(body), config)).toThrow(
      AuthSmokeValidationError,
    );
  });

  it("отвергает malformed JSON диагностики без отражения содержимого в ошибке", () => {
    const secret = "super-secret-gm-token";
    let message = "";
    try {
      validateDiagnostics(`{${secret}`, config);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("некорректный JSON");
    expect(message).not.toContain(secret);
  });

  it("сверяет статус, ревизию и схему диагностики точно", () => {
    expect(
      validateDiagnostics(
        JSON.stringify({
          status: "ok",
          buildRevision: revision,
          schemaVersion: 2,
          requestId: "не выводится",
        }),
        config,
      ),
    ).toEqual({ status: "ok", buildRevision: revision, schemaVersion: 2 });
  });

  it("требует подтверждённый JSON-ответ logout", () => {
    expect(validateLogout('{"ok":true}')).toEqual({ ok: true });
    expect(() => validateLogout('{"ok":false}')).toThrow(
      "выход не подтверждён сервером",
    );
    expect(() => validateLogout("not-json")).toThrow(
      "выход вернул некорректный JSON",
    );
  });

  it("доказывает, что старая cookie после logout больше не авторизована", () => {
    expect(
      validateLoggedOutDiagnostics(
        '{"error":"AUTH_REQUIRED","message":"Войдите по приглашению"}',
      ),
    ).toEqual({ error: "AUTH_REQUIRED" });
    expect(() =>
      validateLoggedOutDiagnostics(
        JSON.stringify({
          status: "ok",
          buildRevision: revision,
          schemaVersion: 2,
        }),
      ),
    ).toThrow("всё ещё имеет доступ");
  });
});

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("CLI и shell-контракт smoke-проверки", () => {
  const corePath = path.join(process.cwd(), "infra/deploy/auth-smoke-core.mjs");
  const releaseCorePath = path.join(
    process.cwd(),
    "infra/deploy/release-core.mjs",
  );
  const shell = readFileSync(
    path.join(process.cwd(), "infra/deploy/smoke-auth.sh"),
    "utf8",
  );

  function artifact(contents: string) {
    const directory = mkdtempSync(
      path.join(tmpdir(), "arken-auth-smoke-test-"),
    );
    temporaryDirectories.push(directory);
    const artifactPath = path.join(directory, "artifact");
    writeFileSync(artifactPath, contents, "utf8");
    return artifactPath;
  }

  function productionEnv(secret: string) {
    return [
      "APP_VERSION=0.2.0",
      `WEB_ORIGIN=${domain}`,
      `PUBLIC_URL=${domain}`,
      "POSTGRES_PASSWORD=database-secret-must-not-leak",
      `GM_ACCESS_TOKEN=${secret}`,
      `MEDIA_HOST_PATH=${appRoot}-data/media`,
      "MEDIA_QUOTA_BYTES=2147483648",
      "MIN_FREE_DISK_BYTES=2147483648",
      "MAX_IMAGE_BYTES=20971520",
      "MAX_AUDIO_BYTES=104857600",
      "",
    ].join("\n");
  }

  it("пишет токен только в payload-файл и ничего не раскрывает в выводе", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "arken-auth-smoke-test-"),
    );
    temporaryDirectories.push(directory);
    const payloadPath = path.join(directory, "payload.json");
    const secret = "test-secret-token-that-must-not-leak";
    const envPath = artifact(productionEnv(secret));
    const result = spawnSync(
      process.execPath,
      [
        releaseCorePath,
        "write-auth-payload",
        envPath,
        payloadPath,
        appRoot,
        domain,
      ],
      {
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(JSON.parse(readFileSync(payloadPath, "utf8"))).toEqual({
      token: secret,
    });
  });

  it("не отражает секрет даже при ошибке CLI", () => {
    const secret = "malformed-secret-that-must-not-leak";
    const result = spawnSync(process.execPath, [corePath, "unknown", secret], {
      encoding: "utf8",
      env: { ...process.env, ...environment },
    });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(secret);
  });

  it("использует приватный временный каталог и payload вместо argv curl", () => {
    for (const key of [
      "APP_ROOT",
      "DOMAIN",
      "EXPECTED_BUILD_REVISION",
      "EXPECTED_SCHEMA_VERSION",
    ])
      expect(shell).toContain(`: "\${${key}:?`);
    expect(shell).toContain("umask 077");
    expect(shell).toContain(
      'mktemp -d "${TMPDIR:-/tmp}/arken-auth-smoke.XXXXXX"',
    );
    expect(shell).toContain('--data-binary "@$PAYLOAD"');
    expect(shell).not.toContain('--data "$GM_ACCESS_TOKEN"');
    expect(shell).not.toContain('PAYLOAD="$(printf');
  });

  it("фиксирует production root и origin и не исполняет .env как shell", () => {
    const rootGuard = shell.indexOf('[ "$APP_ROOT" = "$PRODUCTION_APP_ROOT" ]');
    const domainGuard = shell.indexOf('[ "$DOMAIN" = "$PRODUCTION_DOMAIN" ]');
    const payloadWrite = shell.indexOf(
      'node "$RELEASE_CORE" write-auth-payload',
    );
    for (const index of [rootGuard, domainGuard, payloadWrite])
      expect(index).toBeGreaterThanOrEqual(0);
    expect(shell).toContain(
      "PRODUCTION_APP_ROOT=/home/uixray/apps/arken-space",
    );
    expect(shell).toContain("PRODUCTION_DOMAIN=https://arken-khar.space");
    expect(rootGuard).toBeLessThan(payloadWrite);
    expect(domainGuard).toBeLessThan(payloadWrite);
    expect(shell).not.toContain(". ./.env");
    expect(shell).not.toContain("set -a");
    expect(shell).not.toContain("https://*)");
  });

  it("вызывает все fail-closed валидаторы из shell", () => {
    expect(shell).toContain(
      'node "$AUTH_CORE" validate-login-headers "$HEADERS"',
    );
    expect(shell).toContain('node "$AUTH_CORE" validate-diagnostics "$BODY"');
    expect(shell).toContain('node "$AUTH_CORE" validate-logout "$BODY"');
    expect(shell).toContain(
      'node "$AUTH_CORE" validate-logged-out-diagnostics "$BODY"',
    );
  });

  it("CLI падает без Secure и при неверной diagnostics revision", () => {
    const cliEnvironment = { ...process.env, ...environment };
    const validHeaders = artifact(cookie);
    const invalidHeaders = artifact(cookie.replace("; Secure", ""));
    const validDiagnostics = artifact(
      JSON.stringify({
        status: "ok",
        buildRevision: revision,
        schemaVersion: 2,
      }),
    );
    const invalidDiagnostics = artifact(
      JSON.stringify({
        status: "ok",
        buildRevision: "b".repeat(40),
        schemaVersion: 2,
      }),
    );

    const validCookieResult = spawnSync(
      process.execPath,
      [corePath, "validate-login-headers", validHeaders],
      { encoding: "utf8", env: cliEnvironment },
    );
    const invalidCookieResult = spawnSync(
      process.execPath,
      [corePath, "validate-login-headers", invalidHeaders],
      { encoding: "utf8", env: cliEnvironment },
    );
    const validDiagnosticsResult = spawnSync(
      process.execPath,
      [corePath, "validate-diagnostics", validDiagnostics],
      { encoding: "utf8", env: cliEnvironment },
    );
    const invalidDiagnosticsResult = spawnSync(
      process.execPath,
      [corePath, "validate-diagnostics", invalidDiagnostics],
      { encoding: "utf8", env: cliEnvironment },
    );

    expect(validCookieResult.status).toBe(0);
    expect(invalidCookieResult.status).toBe(1);
    expect(invalidCookieResult.stderr).toContain("Secure");
    expect(validDiagnosticsResult.status).toBe(0);
    expect(invalidDiagnosticsResult.status).toBe(1);
    expect(invalidDiagnosticsResult.stderr).toContain("ревизия диагностики");
  });

  it("делает обязательный logout и повторяет его best-effort при провале", () => {
    expect(shell.match(/\/api\/auth\/logout/g)).toHaveLength(2);
    expect(shell).toContain('if [ "$LOGOUT_STATUS" != "200" ]');
    expect(shell).toContain('node "$AUTH_CORE" validate-logout "$BODY"');
    const logoutValidation = shell.indexOf(
      'node "$AUTH_CORE" validate-logout "$BODY"',
    );
    const invalidationRequest = shell.indexOf(
      'POST_LOGOUT_DIAGNOSTICS_STATUS="$(curl',
    );
    const invalidationValidation = shell.indexOf(
      'node "$AUTH_CORE" validate-logged-out-diagnostics "$BODY"',
    );
    const sessionInactive = shell.lastIndexOf("SESSION_ACTIVE=0");
    for (const index of [
      logoutValidation,
      invalidationRequest,
      invalidationValidation,
      sessionInactive,
    ])
      expect(index).toBeGreaterThanOrEqual(0);
    expect(logoutValidation).toBeLessThan(invalidationRequest);
    expect(invalidationRequest).toBeLessThan(invalidationValidation);
    expect(invalidationValidation).toBeLessThan(sessionInactive);
    expect(shell).toContain('[ "$POST_LOGOUT_DIAGNOSTICS_STATUS" != "401" ]');
    expect(shell).toContain('if [ "$SESSION_ACTIVE" = "1" ]');
    expect(shell).toContain(">/dev/null 2>&1 || :");
  });

  it("не превращает прерванный signal smoke в exit 0", () => {
    expect(shell).toContain("status=$1");
    expect(shell).toContain("trap 'cleanup $?' EXIT");
    expect(shell).toContain("trap 'exit 129' HUP");
    expect(shell).toContain("trap 'exit 130' INT");
    expect(shell).toContain("trap 'exit 143' TERM");
    expect(shell).not.toContain("trap cleanup EXIT HUP INT TERM");
  });

  it("печатает только allowlist доказательств, но не тела ответов", () => {
    expect(shell).not.toMatch(/cat\s+"\$BODY"/);
    expect(shell).not.toMatch(/echo\s+"\$DEPLOYED"/);
    expect(shell).toContain("login-status=%s");
    expect(shell).toContain("diagnostics-http-status=%s");
    expect(shell).toContain("logout-status=%s");
    expect(shell).toContain("post-logout-diagnostics-http-status=%s");
  });
});
