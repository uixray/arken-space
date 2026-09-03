import console from "node:console";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

export const RELEASE_DISK_RESERVE_BYTES = 5n * 1024n * 1024n * 1024n;

export const REQUIRED_PRODUCTION_ENV_KEYS = Object.freeze([
  "APP_VERSION",
  "WEB_ORIGIN",
  "PUBLIC_URL",
  "POSTGRES_PASSWORD",
  "GM_ACCESS_TOKEN",
  "MEDIA_HOST_PATH",
  "MEDIA_QUOTA_BYTES",
  "MIN_FREE_DISK_BYTES",
  "MAX_IMAGE_BYTES",
  "MAX_AUDIO_BYTES",
]);

export const NUMERIC_PRODUCTION_ENV_KEYS = Object.freeze([
  "MEDIA_QUOTA_BYTES",
  "MIN_FREE_DISK_BYTES",
  "MAX_IMAGE_BYTES",
  "MAX_AUDIO_BYTES",
]);

const SAFE_ENV_VALUE_KEYS = new Set(["MEDIA_HOST_PATH", "MIN_FREE_DISK_BYTES"]);
const RELEASE_SERVICES = new Set(["server", "web"]);
const REVISION_PATTERN = /^[0-9a-f]{40}$/;
const IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ROLLBACK_TAG_PATTERN =
  /^arken-space-rollback-(server|web):([0-9a-f]{40})$/;

export class ReleaseContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseContractError";
  }
}

function fail(message) {
  throw new ReleaseContractError(message);
}

function decodeEnvValue(rawValue, lineNumber, key) {
  const value = rawValue.trim();
  if (!value.startsWith('"') && !value.startsWith("'")) return value;

  const quote = value[0];
  if (value.length < 2 || value.at(-1) !== quote)
    fail(`Некорректные кавычки для ${key} в строке ${lineNumber}`);

  const inner = value.slice(1, -1);
  if (quote === "'") return inner;

  return inner.replace(/\\([\\"nrt])/g, (_match, escaped) => {
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === "t") return "\t";
    return escaped;
  });
}

/**
 * Parse only assignment syntax needed by the production Compose environment.
 * Error messages deliberately identify a key or line, never the source text.
 */
export function parseEnvText(source) {
  if (typeof source !== "string") fail("Содержимое .env должно быть строкой");

  const values = new Map();
  const lines = source.replace(/^\uFEFF/, "").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].replace(/\r$/, "");
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!assignment) fail(`Некорректная строка .env: ${lineNumber}`);

    const [, key, rawValue] = assignment;
    if (values.has(key)) fail(`Переменная ${key} объявлена больше одного раза`);
    values.set(key, decodeEnvValue(rawValue, lineNumber, key));
  }

  return values;
}

function requireNonBlank(values, key) {
  if (!values.has(key)) fail(`В production .env отсутствует ${key}`);
  const value = values.get(key);
  if (value.trim() === "") fail(`В production .env пустое значение ${key}`);
  return value;
}

function parseUnsignedInteger(value, label, { positive }) {
  const normalized =
    typeof value === "bigint" ? value.toString() : String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(normalized))
    fail(`${label} должно быть целым числом байт`);

  const result = BigInt(normalized);
  if (positive && result === 0n) fail(`${label} должно быть больше нуля`);
  return result;
}

function canonicalProductionOrigin(rawOrigin) {
  let url;
  try {
    url = new URL(rawOrigin);
  } catch {
    fail("DOMAIN должен быть точным HTTPS origin");
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.origin !== rawOrigin
  )
    fail(
      "DOMAIN должен быть точным HTTPS origin без пути и завершающего слеша",
    );

  return url.origin;
}

function canonicalAppRoot(rawAppRoot) {
  if (typeof rawAppRoot !== "string" || !path.posix.isAbsolute(rawAppRoot))
    fail("APP_ROOT должен быть абсолютным POSIX-путём");
  const normalized = path.posix.normalize(rawAppRoot);
  if (normalized !== rawAppRoot || rawAppRoot === "/")
    fail("APP_ROOT должен быть каноническим POSIX-путём");
  return normalized;
}

function isForbiddenBackupKey(key) {
  return (
    key.startsWith("RESTIC_") ||
    key.startsWith("AWS_") ||
    key.startsWith("BACKUP_") ||
    key === "PRODUCTION_COMPOSE_PROJECT"
  );
}

/**
 * Validate production application settings without returning secret values.
 */
export function validateProductionEnv(source, { appRoot, domain }) {
  const values = parseEnvText(source);

  for (const key of values.keys())
    if (isForbiddenBackupKey(key))
      fail(`Ключ backup-контура ${key} запрещён в production .env приложения`);

  for (const key of REQUIRED_PRODUCTION_ENV_KEYS) requireNonBlank(values, key);

  if (
    values.has("COMPOSE_PROJECT_NAME") &&
    values.get("COMPOSE_PROJECT_NAME") !== "arken-space"
  )
    fail("COMPOSE_PROJECT_NAME должен быть arken-space");

  const expectedOrigin = canonicalProductionOrigin(domain);
  for (const key of ["WEB_ORIGIN", "PUBLIC_URL"])
    if (values.get(key) !== expectedOrigin)
      fail(`${key} должен точно совпадать с production DOMAIN`);

  const normalizedAppRoot = canonicalAppRoot(appRoot);
  const expectedMediaPath = `${normalizedAppRoot}-data/media`;
  if (values.get("MEDIA_HOST_PATH") !== expectedMediaPath)
    fail(
      "MEDIA_HOST_PATH должен быть абсолютным каноническим production-путём",
    );

  const numericValues = new Map();
  for (const key of NUMERIC_PRODUCTION_ENV_KEYS)
    numericValues.set(
      key,
      parseUnsignedInteger(values.get(key), key, { positive: true }),
    );

  if (values.get("GM_ACCESS_TOKEN").length < 32)
    fail("GM_ACCESS_TOKEN должен содержать не меньше 32 символов");

  const minFreeDiskBytes = numericValues.get("MIN_FREE_DISK_BYTES");
  return Object.freeze({
    checkedFieldCount: REQUIRED_PRODUCTION_ENV_KEYS.length,
    mediaHostPath: expectedMediaPath,
    minFreeDiskBytes: minFreeDiskBytes.toString(),
    requiredDiskBytes: requiredDiskBytes(minFreeDiskBytes).toString(),
  });
}

export function envValue(source, key) {
  if (!SAFE_ENV_VALUE_KEYS.has(key))
    fail(`Чтение ${key || "неизвестного ключа"} через release CLI запрещено`);
  return requireNonBlank(parseEnvText(source), key);
}

export function writeAuthPayload(source, outputPath, { appRoot, domain }) {
  validateProductionEnv(source, { appRoot, domain });
  const token = requireNonBlank(parseEnvText(source), "GM_ACCESS_TOKEN");
  try {
    writeFileSync(outputPath, JSON.stringify({ token }), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch {
    fail("Приватный auth payload не удалось создать");
  }
  return Object.freeze({ written: true });
}

export function requiredDiskBytes(minFreeDiskBytes) {
  return (
    parseUnsignedInteger(minFreeDiskBytes, "MIN_FREE_DISK_BYTES", {
      positive: true,
    }) + RELEASE_DISK_RESERVE_BYTES
  );
}

export function checkDiskBytes(availableBytes, minFreeDiskBytes, label) {
  const available = parseUnsignedInteger(availableBytes, "Доступное место", {
    positive: false,
  });
  const required = requiredDiskBytes(minFreeDiskBytes);
  const safeLabel = String(label);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(safeLabel))
    fail("Метка disk gate должна быть коротким kebab-case значением");
  if (available < required)
    fail(
      `Disk gate ${safeLabel}: доступно ${available} байт, требуется ${required} байт`,
    );
  return Object.freeze({
    label: safeLabel,
    availableBytes: available,
    requiredBytes: required,
  });
}

export function checkDiskKiB(availableKiB, minFreeDiskBytes, label) {
  const kib = parseUnsignedInteger(availableKiB, "Доступное место в KiB", {
    positive: false,
  });
  return checkDiskBytes(kib * 1024n, minFreeDiskBytes, label);
}

export function exactRevision(rawRevision) {
  const revision = String(rawRevision);
  if (!REVISION_PATTERN.test(revision))
    fail(
      "Ревизия должна содержать ровно 40 строчных шестнадцатеричных символов",
    );
  return revision;
}

export function productionRevision(rawBody) {
  let body;
  try {
    body = JSON.parse(String(rawBody));
  } catch {
    fail("Production health вернул некорректный JSON");
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.status !== "ok" ||
    body.database !== "ok"
  )
    fail("Production health не подтверждает готовность приложения и базы");
  return exactRevision(body.buildRevision);
}

export function assertProductionRevision(rawBody, expectedRevision, label) {
  const actual = productionRevision(rawBody);
  const expected = exactRevision(expectedRevision);
  const safeLabel = String(label);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(safeLabel))
    fail("Метка production revision должна быть коротким kebab-case значением");
  if (actual !== expected)
    fail(`Production revision изменилась во время release: ${safeLabel}`);
  return Object.freeze({ label: safeLabel, revision: actual });
}

function releaseService(rawService) {
  const service = String(rawService);
  if (!RELEASE_SERVICES.has(service))
    fail("Release service должен быть server или web");
  return service;
}

export function rollbackTag(service, revision) {
  return `arken-space-rollback-${releaseService(service)}:${exactRevision(revision)}`;
}

export function imageId(rawImageId) {
  const normalized = String(rawImageId).trim();
  if (!IMAGE_ID_PATTERN.test(normalized))
    fail("Image ID должен быть полным sha256:<64 строчных hex-символа>");
  return normalized;
}

function checkedRollbackTag(service, tag) {
  const normalizedService = releaseService(service);
  const match = ROLLBACK_TAG_PATTERN.exec(String(tag));
  if (!match || match[1] !== normalizedService)
    fail(`Rollback tag не соответствует service ${normalizedService}`);
  return String(tag);
}

/**
 * Decide whether an immutable rollback tag can be created or safely reused.
 */
export function rollbackTagIntent({
  service,
  tag,
  expectedImageId,
  existingImageId,
}) {
  const checkedTag = checkedRollbackTag(service, tag);
  const expected = imageId(expectedImageId);
  if (existingImageId == null || String(existingImageId).trim() === "")
    return Object.freeze({
      action: "create",
      service,
      tag: checkedTag,
      imageId: expected,
    });

  const existing = imageId(existingImageId);
  if (existing !== expected)
    fail(
      `Immutable rollback tag ${checkedTag} уже указывает на другой image ID`,
    );
  return Object.freeze({
    action: "reuse",
    service,
    tag: checkedTag,
    imageId: expected,
  });
}

/**
 * Post-deploy verification is fail-closed: absence is not a create request.
 */
export function assertRollbackTag({
  service,
  tag,
  expectedImageId,
  actualImageId,
}) {
  const checkedTag = checkedRollbackTag(service, tag);
  const expected = imageId(expectedImageId);
  if (actualImageId == null || String(actualImageId).trim() === "")
    fail(`Rollback tag ${checkedTag} отсутствует после выкладки`);
  const actual = imageId(actualImageId);
  if (actual !== expected)
    fail(
      `Rollback tag ${checkedTag} после выкладки указывает на другой image ID`,
    );
  return Object.freeze({ service, tag: checkedTag, imageId: expected });
}

export function imageEvidence({
  service,
  tag,
  rollbackImageId,
  deployedImageId,
}) {
  const checkedTag = checkedRollbackTag(service, tag);
  const rollbackImage = imageId(rollbackImageId);
  const deployedImage = imageId(deployedImageId);
  return `${service} rollback_tag=${checkedTag} rollback_image_id=${rollbackImage} deployed_image_id=${deployedImage}`;
}

function readEnvFile(envPath) {
  try {
    return readFileSync(envPath, "utf8");
  } catch {
    fail("Production .env не удалось прочитать");
  }
}

function readHealthFile(healthPath) {
  try {
    return readFileSync(healthPath, "utf8");
  } catch {
    fail("Production health artifact не удалось прочитать");
  }
}

function requireArgs(args, count) {
  if (args.length !== count) fail("Неверное число аргументов release-core CLI");
}

function cli(argv) {
  const [command, ...args] = argv;
  if (!command) fail("Не указана команда release-core CLI");

  switch (command) {
    case "validate-env": {
      requireArgs(args, 3);
      const [envPath, appRoot, domain] = args;
      const evidence = validateProductionEnv(readEnvFile(envPath), {
        appRoot,
        domain,
      });
      console.log(
        `production-env valid fields=${evidence.checkedFieldCount} media_path=${evidence.mediaHostPath} min_free_disk_bytes=${evidence.minFreeDiskBytes} required_disk_bytes=${evidence.requiredDiskBytes}`,
      );
      return;
    }
    case "env-value": {
      requireArgs(args, 4);
      const [envPath, key, appRoot, domain] = args;
      const source = readEnvFile(envPath);
      validateProductionEnv(source, { appRoot, domain });
      console.log(envValue(source, key));
      return;
    }
    case "write-auth-payload": {
      requireArgs(args, 4);
      const [envPath, outputPath, appRoot, domain] = args;
      writeAuthPayload(readEnvFile(envPath), outputPath, { appRoot, domain });
      console.log("auth-payload written");
      return;
    }
    case "check-disk-kib": {
      requireArgs(args, 3);
      const [availableKiB, minFreeDiskBytes, label] = args;
      const evidence = checkDiskKiB(availableKiB, minFreeDiskBytes, label);
      console.log(
        `disk-gate ${evidence.label} available_bytes=${evidence.availableBytes} required_bytes=${evidence.requiredBytes}`,
      );
      return;
    }
    case "health-revision": {
      requireArgs(args, 1);
      console.log(productionRevision(readHealthFile(args[0])));
      return;
    }
    case "assert-health-revision": {
      requireArgs(args, 3);
      const evidence = assertProductionRevision(
        readHealthFile(args[0]),
        args[1],
        args[2],
      );
      console.log(`production-revision ${evidence.label}=${evidence.revision}`);
      return;
    }
    case "rollback-tag": {
      requireArgs(args, 2);
      console.log(rollbackTag(args[0], args[1]));
      return;
    }
    case "image-id": {
      requireArgs(args, 1);
      console.log(imageId(args[0]));
      return;
    }
    case "rollback-tag-intent": {
      requireArgs(args, 4);
      const [service, tag, expectedImageId, existingImageId] = args;
      const intent = rollbackTagIntent({
        service,
        tag,
        expectedImageId,
        existingImageId: existingImageId === "-" ? null : existingImageId,
      });
      console.log(intent.action);
      return;
    }
    case "assert-rollback-tag": {
      requireArgs(args, 4);
      const [service, tag, expectedImageId, actualImageId] = args;
      const evidence = assertRollbackTag({
        service,
        tag,
        expectedImageId,
        actualImageId: actualImageId === "-" ? null : actualImageId,
      });
      console.log(
        `rollback-tag ${evidence.service} verified tag=${evidence.tag} image_id=${evidence.imageId}`,
      );
      return;
    }
    case "image-evidence": {
      requireArgs(args, 4);
      const [service, tag, rollbackImageId, deployedImageId] = args;
      console.log(
        imageEvidence({ service, tag, rollbackImageId, deployedImageId }),
      );
      return;
    }
    default:
      fail("Неизвестная команда release-core CLI");
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  try {
    cli(process.argv.slice(2));
  } catch (error) {
    const message =
      error instanceof ReleaseContractError
        ? error.message
        : "Неожиданная ошибка release-core CLI";
    console.error(`release-core: ${message}`);
    process.exitCode = 1;
  }
}

// This makes the module path convenient to inspect in a shell without adding
// platform-specific path handling to release.sh.
export const RELEASE_CORE_PATH = fileURLToPath(import.meta.url);
