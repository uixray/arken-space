import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

export class AuthSmokeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthSmokeValidationError";
  }
}

function fail(message) {
  throw new AuthSmokeValidationError(message);
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    fail(`${name} обязателен`);
  return value.trim();
}

export function requireSmokeConfig(source) {
  const expectedBuildRevision = requiredString(
    source.EXPECTED_BUILD_REVISION,
    "EXPECTED_BUILD_REVISION",
  );
  if (!/^[0-9a-f]{40}$/.test(expectedBuildRevision))
    fail("EXPECTED_BUILD_REVISION должен быть полным git SHA");

  const expectedSchemaText = requiredString(
    source.EXPECTED_SCHEMA_VERSION,
    "EXPECTED_SCHEMA_VERSION",
  );
  if (!/^[1-9][0-9]*$/.test(expectedSchemaText))
    fail("EXPECTED_SCHEMA_VERSION должен быть положительным целым числом");
  const expectedSchemaVersion = Number(expectedSchemaText);
  if (!Number.isSafeInteger(expectedSchemaVersion))
    fail("EXPECTED_SCHEMA_VERSION выходит за безопасный диапазон");

  const sessionCookieName = requiredString(
    source.SESSION_COOKIE_NAME,
    "SESSION_COOKIE_NAME",
  );
  if (!/^[A-Za-z0-9_]+$/.test(sessionCookieName))
    fail("SESSION_COOKIE_NAME содержит недопустимые символы");

  return {
    expectedBuildRevision,
    expectedSchemaVersion,
    sessionCookieName,
  };
}

export function validateSessionCookieHeaders(rawHeaders, expectedCookieName) {
  const cookieName = requiredString(expectedCookieName, "SESSION_COOKIE_NAME");
  const matchingCookies = rawHeaders
    .split(/\r?\n/)
    .filter((line) => /^set-cookie\s*:/i.test(line))
    .map((line) => line.replace(/^set-cookie\s*:\s*/i, ""))
    .filter((line) => {
      const pair = line.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      return separator > 0 && pair.slice(0, separator).trim() === cookieName;
    });

  if (matchingCookies.length !== 1)
    fail("ответ входа должен установить ровно одну ожидаемую cookie сессии");

  const attributes = matchingCookies[0]
    .split(";")
    .slice(1)
    .map((part) => part.trim())
    .filter(Boolean);
  const bareAttributes = new Set(
    attributes
      .filter((part) => !part.includes("="))
      .map((part) => part.toLowerCase()),
  );
  const valuedAttributes = new Map(
    attributes
      .filter((part) => part.includes("="))
      .map((part) => {
        const separator = part.indexOf("=");
        return [
          part.slice(0, separator).trim().toLowerCase(),
          part
            .slice(separator + 1)
            .trim()
            .toLowerCase(),
        ];
      }),
  );

  if (!bareAttributes.has("httponly"))
    fail("cookie сессии не содержит HttpOnly");
  if (!bareAttributes.has("secure")) fail("cookie сессии не содержит Secure");
  if (valuedAttributes.get("samesite") !== "strict")
    fail("cookie сессии не содержит SameSite=Strict");

  return { httpOnly: true, secure: true, sameSite: "Strict" };
}

export function validateDiagnostics(rawBody, expected) {
  let diagnostics;
  try {
    diagnostics = JSON.parse(rawBody);
  } catch {
    fail("диагностика вернула некорректный JSON");
  }
  if (
    diagnostics === null ||
    typeof diagnostics !== "object" ||
    Array.isArray(diagnostics)
  )
    fail("диагностика вернула некорректный объект");
  if (diagnostics.status !== "ok") fail("статус диагностики не ok");
  if (diagnostics.buildRevision !== expected.expectedBuildRevision)
    fail("ревизия диагностики не совпадает с ожидаемой");
  if (diagnostics.schemaVersion !== expected.expectedSchemaVersion)
    fail("версия схемы диагностики не совпадает с ожидаемой");

  return {
    status: "ok",
    buildRevision: diagnostics.buildRevision,
    schemaVersion: diagnostics.schemaVersion,
  };
}

export function validateLogout(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    fail("выход вернул некорректный JSON");
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.ok !== true
  )
    fail("выход не подтверждён сервером");
  return { ok: true };
}

export function validateLoggedOutDiagnostics(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    fail("проверка завершённой сессии вернула некорректный JSON");
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.error !== "AUTH_REQUIRED"
  )
    fail("завершённая сессия всё ещё имеет доступ к diagnostics");
  return { error: "AUTH_REQUIRED" };
}

function requiredPath(value) {
  if (typeof value !== "string" || value === "")
    fail("путь к артефакту обязателен");
  return value;
}

export function runCli(argv, environment = process.env) {
  const [command, artifactPath] = argv;
  const path = requiredPath(artifactPath);

  const config = requireSmokeConfig(environment);
  if (command === "validate-login-headers") {
    validateSessionCookieHeaders(
      readFileSync(path, "utf8"),
      config.sessionCookieName,
    );
    process.stdout.write(
      "cookie-http-only=yes\ncookie-secure=yes\ncookie-samesite-strict=yes\n",
    );
    return;
  }
  if (command === "validate-diagnostics") {
    const result = validateDiagnostics(readFileSync(path, "utf8"), config);
    process.stdout.write(
      `diagnostics-status=${result.status}\n` +
        `diagnostics-build-revision=${result.buildRevision}\n` +
        `diagnostics-schema-version=${result.schemaVersion}\n`,
    );
    return;
  }
  if (command === "validate-logout") {
    validateLogout(readFileSync(path, "utf8"));
    process.stdout.write("logout-body=ok\n");
    return;
  }
  if (command === "validate-logged-out-diagnostics") {
    validateLoggedOutDiagnostics(readFileSync(path, "utf8"));
    process.stdout.write("post-logout-session=invalidated\n");
    return;
  }
  fail("неизвестная команда auth smoke");
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
if (invokedPath === import.meta.url) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    const message =
      error instanceof AuthSmokeValidationError
        ? error.message
        : "внутренняя ошибка проверки";
    process.stderr.write(`auth-smoke-error=${message}\n`);
    process.exitCode = 1;
  }
}
