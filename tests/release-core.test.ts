import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  RELEASE_DISK_RESERVE_BYTES,
  assertProductionRevision,
  assertRollbackTag,
  checkDiskBytes,
  checkDiskKiB,
  envValue,
  exactRevision,
  imageEvidence,
  imageId,
  parseEnvText,
  productionRevision,
  requiredDiskBytes,
  rollbackTag,
  rollbackTagIntent,
  validateProductionEnv,
} from "../infra/deploy/release-core.mjs";

const APP_ROOT = "/home/uixray/apps/arken-space";
const DOMAIN = "https://arken-khar.space";
const REVISION = "a".repeat(40);
const SERVER_IMAGE_ID = `sha256:${"1".repeat(64)}`;
const WEB_IMAGE_ID = `sha256:${"2".repeat(64)}`;
const OTHER_IMAGE_ID = `sha256:${"3".repeat(64)}`;
const corePath = fileURLToPath(
  new URL("../infra/deploy/release-core.mjs", import.meta.url),
);

function productionEnv(overrides: Record<string, string | null> = {}) {
  const values: Record<string, string> = {
    COMPOSE_PROJECT_NAME: "arken-space",
    APP_VERSION: "0.2.0",
    WEB_ORIGIN: DOMAIN,
    PUBLIC_URL: DOMAIN,
    POSTGRES_PASSWORD: "database-secret-must-not-leak",
    GM_ACCESS_TOKEN: "g".repeat(32),
    MEDIA_HOST_PATH: `${APP_ROOT}-data/media`,
    MEDIA_QUOTA_BYTES: "2147483648",
    MIN_FREE_DISK_BYTES: "2147483648",
    MAX_IMAGE_BYTES: "20971520",
    MAX_AUDIO_BYTES: "104857600",
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete values[key];
    else values[key] = value;
  }

  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

const temporaryDirectories: string[] = [];

function temporaryEnv(contents: string) {
  const directory = mkdtempSync(path.join(tmpdir(), "arken-release-core-"));
  temporaryDirectories.push(directory);
  const envPath = path.join(directory, ".env");
  writeFileSync(envPath, contents, { encoding: "utf8", mode: 0o600 });
  return envPath;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("production .env contract", () => {
  it("принимает полный production env и возвращает только безопасные evidence", () => {
    const source = productionEnv();
    const result = validateProductionEnv(source, {
      appRoot: APP_ROOT,
      domain: DOMAIN,
    });

    expect(result).toEqual({
      checkedFieldCount: 10,
      mediaHostPath: `${APP_ROOT}-data/media`,
      minFreeDiskBytes: "2147483648",
      requiredDiskBytes: "7516192768",
    });
    expect(JSON.stringify(result)).not.toContain(
      "database-secret-must-not-leak",
    );
    expect(JSON.stringify(result)).not.toContain("g".repeat(32));
  });

  it("отличает отсутствующее поле от пустого", () => {
    expect(() =>
      validateProductionEnv(productionEnv({ POSTGRES_PASSWORD: null }), {
        appRoot: APP_ROOT,
        domain: DOMAIN,
      }),
    ).toThrow("отсутствует POSTGRES_PASSWORD");
    expect(() =>
      validateProductionEnv(productionEnv({ GM_ACCESS_TOKEN: "  " }), {
        appRoot: APP_ROOT,
        domain: DOMAIN,
      }),
    ).toThrow("пустое значение GM_ACCESS_TOKEN");
  });

  it("не допускает повторное объявление даже с тем же значением", () => {
    const source = `${productionEnv()}POSTGRES_PASSWORD=database-secret-must-not-leak\n`;
    let message = "";
    try {
      parseEnvText(source);
    } catch (error) {
      message = String(error);
    }

    expect(message).toContain("POSTGRES_PASSWORD");
    expect(message).not.toContain("database-secret-must-not-leak");
  });

  it.each(["WEB_ORIGIN", "PUBLIC_URL"])(
    "требует точного production origin в %s",
    (key) => {
      expect(() =>
        validateProductionEnv(productionEnv({ [key]: `${DOMAIN}/` }), {
          appRoot: APP_ROOT,
          domain: DOMAIN,
        }),
      ).toThrow(`${key} должен точно совпадать`);
    },
  );

  it.each([
    "relative/media",
    `${APP_ROOT}/../arken-space-data/media`,
    `${APP_ROOT}-data/media/`,
    "/srv/arken-space/media",
  ])("отвергает неканонический media path: %s", (mediaPath) => {
    expect(() =>
      validateProductionEnv(productionEnv({ MEDIA_HOST_PATH: mediaPath }), {
        appRoot: APP_ROOT,
        domain: DOMAIN,
      }),
    ).toThrow("MEDIA_HOST_PATH");
  });

  it.each([
    ["MEDIA_QUOTA_BYTES", "0"],
    ["MIN_FREE_DISK_BYTES", "-1"],
    ["MAX_IMAGE_BYTES", "1.5"],
    ["MAX_AUDIO_BYTES", "10MiB"],
  ])("проверяет положительное целое значение %s", (key, value) => {
    expect(() =>
      validateProductionEnv(productionEnv({ [key]: value }), {
        appRoot: APP_ROOT,
        domain: DOMAIN,
      }),
    ).toThrow(key);
  });

  it.each(["RESTIC_PASSWORD", "RESTIC_REPOSITORY", "AWS_SECRET_ACCESS_KEY"])(
    "запрещает ключ backup-контура %s",
    (key) => {
      expect(() =>
        validateProductionEnv(productionEnv({ [key]: "secret-value" }), {
          appRoot: APP_ROOT,
          domain: DOMAIN,
        }),
      ).toThrow(`backup-контура ${key}`);
    },
  );

  it("не принимает неиспользуемый MEDIA_ROOT за backup-секрет", () => {
    expect(
      validateProductionEnv(productionEnv({ MEDIA_ROOT: "./media" }), {
        appRoot: APP_ROOT,
        domain: DOMAIN,
      }),
    ).toMatchObject({ mediaHostPath: `${APP_ROOT}-data/media` });
  });

  it("не требует production Compose project от общего application env", () => {
    expect(
      validateProductionEnv(productionEnv({ COMPOSE_PROJECT_NAME: null }), {
        appRoot: APP_ROOT,
        domain: DOMAIN,
      }),
    ).toMatchObject({ mediaHostPath: `${APP_ROOT}-data/media` });
    expect(() =>
      validateProductionEnv(
        productionEnv({ COMPOSE_PROJECT_NAME: "other-project" }),
        { appRoot: APP_ROOT, domain: DOMAIN },
      ),
    ).toThrow("COMPOSE_PROJECT_NAME должен быть arken-space");
  });

  it("разрешает CLI читать только безопасные значения", () => {
    const source = productionEnv();
    expect(envValue(source, "MEDIA_HOST_PATH")).toBe(`${APP_ROOT}-data/media`);
    expect(envValue(source, "MIN_FREE_DISK_BYTES")).toBe("2147483648");
    expect(() => envValue(source, "POSTGRES_PASSWORD")).toThrow(
      "через release CLI запрещено",
    );
  });
});

describe("byte-accurate disk gate", () => {
  it("добавляет к MIN_FREE_DISK_BYTES ровно 5 GiB", () => {
    expect(RELEASE_DISK_RESERVE_BYTES).toBe(5n * 1024n ** 3n);
    expect(requiredDiskBytes(1025n)).toBe(RELEASE_DISK_RESERVE_BYTES + 1025n);
  });

  it("принимает точное равенство и отвергает нехватку одного байта", () => {
    const required = requiredDiskBytes(1025n);
    expect(checkDiskBytes(required, 1025n, "before-build")).toMatchObject({
      availableBytes: required,
      requiredBytes: required,
    });
    expect(() => checkDiskBytes(required - 1n, 1025n, "before-build")).toThrow(
      `доступно ${required - 1n} байт, требуется ${required} байт`,
    );
  });

  it("не теряет однобайтовую границу при входе df в KiB", () => {
    const availableKiB = RELEASE_DISK_RESERVE_BYTES / 1024n + 1n;
    expect(() => checkDiskKiB(availableKiB, 1025n, "after-build")).toThrow(
      `доступно ${RELEASE_DISK_RESERVE_BYTES + 1024n} байт, требуется ${RELEASE_DISK_RESERVE_BYTES + 1025n} байт`,
    );
  });
});

describe("production health revision", () => {
  it("принимает только authoritative health с точной ревизией", () => {
    expect(
      productionRevision(
        JSON.stringify({
          status: "ok",
          database: "ok",
          buildRevision: REVISION,
        }),
      ),
    ).toBe(REVISION);
    expect(() =>
      productionRevision(
        JSON.stringify({
          status: "error",
          database: "ok",
          buildRevision: REVISION,
        }),
      ),
    ).toThrow("не подтверждает готовность");
    expect(() =>
      productionRevision(JSON.stringify({ status: "ok", database: "ok" })),
    ).toThrow("ровно 40");
  });

  it("останавливается при смене revision вокруг image capture", () => {
    const body = JSON.stringify({
      status: "ok",
      database: "ok",
      buildRevision: REVISION,
    });
    expect(
      assertProductionRevision(body, REVISION, "before-image-capture"),
    ).toMatchObject({ revision: REVISION });
    expect(() =>
      assertProductionRevision(body, "b".repeat(40), "after-image-capture"),
    ).toThrow("Production revision изменилась");
  });
});

describe("rollback image contract", () => {
  it("принимает только точную 40-символьную ревизию", () => {
    expect(exactRevision(REVISION)).toBe(REVISION);
    expect(() => exactRevision(REVISION.slice(1))).toThrow("ровно 40");
    expect(() => exactRevision(REVISION.toUpperCase())).toThrow("ровно 40");
    expect(() => exactRevision(` ${REVISION}`)).toThrow("ровно 40");
  });

  it.each([
    ["server", `arken-space-rollback-server:${REVISION}`],
    ["web", `arken-space-rollback-web:${REVISION}`],
  ])("строит immutable tag для %s", (service, expected) => {
    expect(rollbackTag(service, REVISION)).toBe(expected);
  });

  it("принимает только полный sha256 image ID", () => {
    expect(imageId(SERVER_IMAGE_ID)).toBe(SERVER_IMAGE_ID);
    expect(() => imageId(`sha256:${"1".repeat(63)}`)).toThrow("полным sha256");
    expect(() => imageId(`sha256:${"A".repeat(64)}`)).toThrow("полным sha256");
    expect(() => imageId(`arken/server@${SERVER_IMAGE_ID}`)).toThrow(
      "полным sha256",
    );
  });

  it("создаёт отсутствующий tag и переиспользует совпадающий", () => {
    const tag = rollbackTag("server", REVISION);
    expect(
      rollbackTagIntent({
        service: "server",
        tag,
        expectedImageId: SERVER_IMAGE_ID,
        existingImageId: null,
      }).action,
    ).toBe("create");
    expect(
      rollbackTagIntent({
        service: "server",
        tag,
        expectedImageId: SERVER_IMAGE_ID,
        existingImageId: SERVER_IMAGE_ID,
      }).action,
    ).toBe("reuse");
  });

  it("останавливается при коллизии immutable tag", () => {
    const tag = rollbackTag("server", REVISION);
    expect(() =>
      rollbackTagIntent({
        service: "server",
        tag,
        expectedImageId: SERVER_IMAGE_ID,
        existingImageId: OTHER_IMAGE_ID,
      }),
    ).toThrow(`Immutable rollback tag ${tag}`);
  });

  it("post-deploy проверка fail-closed для missing tag", () => {
    const tag = rollbackTag("web", REVISION);
    expect(() =>
      assertRollbackTag({
        service: "web",
        tag,
        expectedImageId: WEB_IMAGE_ID,
        actualImageId: null,
      }),
    ).toThrow("отсутствует после выкладки");
  });

  it("post-deploy проверка отвергает несовпавший image ID", () => {
    const tag = rollbackTag("web", REVISION);
    expect(() =>
      assertRollbackTag({
        service: "web",
        tag,
        expectedImageId: WEB_IMAGE_ID,
        actualImageId: OTHER_IMAGE_ID,
      }),
    ).toThrow("указывает на другой image ID");
  });

  it("печатает полные rollback и deployed IDs в release evidence", () => {
    const tag = rollbackTag("web", REVISION);
    const evidence = imageEvidence({
      service: "web",
      tag,
      rollbackImageId: WEB_IMAGE_ID,
      deployedImageId: OTHER_IMAGE_ID,
    });

    expect(evidence).toBe(
      `web rollback_tag=${tag} rollback_image_id=${WEB_IMAGE_ID} deployed_image_id=${OTHER_IMAGE_ID}`,
    );
    expect(evidence).toHaveLength(
      "web rollback_tag=".length +
        tag.length +
        " rollback_image_id=".length +
        WEB_IMAGE_ID.length +
        " deployed_image_id=".length +
        OTHER_IMAGE_ID.length,
    );
  });
});

describe("release-core CLI", () => {
  it("validate-env не печатает секреты ни при успехе, ни при отказе", () => {
    const validEnvPath = temporaryEnv(productionEnv());
    const success = spawnSync(
      process.execPath,
      [corePath, "validate-env", validEnvPath, APP_ROOT, DOMAIN],
      { encoding: "utf8" },
    );
    expect(success.status).toBe(0);
    expect(success.stdout).toContain("production-env valid");
    expect(`${success.stdout}${success.stderr}`).not.toContain(
      "database-secret-must-not-leak",
    );

    const mediaValue = spawnSync(
      process.execPath,
      [
        corePath,
        "env-value",
        validEnvPath,
        "MEDIA_HOST_PATH",
        APP_ROOT,
        DOMAIN,
      ],
      { encoding: "utf8" },
    );
    expect(mediaValue.status).toBe(0);
    expect(mediaValue.stdout.trim()).toBe(`${APP_ROOT}-data/media`);

    const secretValue = spawnSync(
      process.execPath,
      [
        corePath,
        "env-value",
        validEnvPath,
        "POSTGRES_PASSWORD",
        APP_ROOT,
        DOMAIN,
      ],
      { encoding: "utf8" },
    );
    expect(secretValue.status).toBe(1);
    expect(`${secretValue.stdout}${secretValue.stderr}`).not.toContain(
      "database-secret-must-not-leak",
    );

    const invalidEnvPath = temporaryEnv(
      `${productionEnv()}POSTGRES_PASSWORD=second-secret-must-not-leak\n`,
    );
    const failure = spawnSync(
      process.execPath,
      [corePath, "validate-env", invalidEnvPath, APP_ROOT, DOMAIN],
      { encoding: "utf8" },
    );
    expect(failure.status).toBe(1);
    expect(failure.stderr).toContain("POSTGRES_PASSWORD");
    expect(`${failure.stdout}${failure.stderr}`).not.toContain(
      "second-secret-must-not-leak",
    );
  });

  it("даёт POSIX shell однозначные create и verified результаты", () => {
    const tag = rollbackTag("server", REVISION);
    const intent = spawnSync(
      process.execPath,
      [corePath, "rollback-tag-intent", "server", tag, SERVER_IMAGE_ID, "-"],
      { encoding: "utf8" },
    );
    expect(intent.status).toBe(0);
    expect(intent.stdout.trim()).toBe("create");

    const verified = spawnSync(
      process.execPath,
      [
        corePath,
        "assert-rollback-tag",
        "server",
        tag,
        SERVER_IMAGE_ID,
        SERVER_IMAGE_ID,
      ],
      { encoding: "utf8" },
    );
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain(SERVER_IMAGE_ID);
  });

  it("исполняет disk, health и полный rollback dispatch fail-closed", () => {
    const healthPath = temporaryEnv(
      JSON.stringify({
        status: "ok",
        database: "ok",
        buildRevision: REVISION,
      }),
    );
    const tag = rollbackTag("server", REVISION);
    const cases: Array<{
      args: string[];
      status: number;
      output?: string;
    }> = [
      {
        args: ["check-disk-kib", "5242881", "1024", "before-build"],
        status: 0,
        output: "disk-gate before-build",
      },
      {
        args: ["health-revision", healthPath],
        status: 0,
        output: REVISION,
      },
      {
        args: ["rollback-tag", "server", REVISION],
        status: 0,
        output: tag,
      },
      {
        args: ["image-id", SERVER_IMAGE_ID],
        status: 0,
        output: SERVER_IMAGE_ID,
      },
      {
        args: [
          "rollback-tag-intent",
          "server",
          tag,
          SERVER_IMAGE_ID,
          OTHER_IMAGE_ID,
        ],
        status: 1,
      },
      {
        args: [
          "assert-rollback-tag",
          "server",
          tag,
          SERVER_IMAGE_ID,
          OTHER_IMAGE_ID,
        ],
        status: 1,
      },
      {
        args: [
          "image-evidence",
          "server",
          tag,
          SERVER_IMAGE_ID,
          OTHER_IMAGE_ID,
        ],
        status: 0,
        output: `server rollback_tag=${tag}`,
      },
    ];

    for (const testCase of cases) {
      const result = spawnSync(process.execPath, [corePath, ...testCase.args], {
        encoding: "utf8",
      });
      expect(result.status, testCase.args[0]).toBe(testCase.status);
      if (testCase.output)
        expect(result.stdout, testCase.args[0]).toContain(testCase.output);
    }

    const wrongHealthPath = temporaryEnv(
      JSON.stringify({
        status: "ok",
        database: "ok",
        buildRevision: "b".repeat(40),
      }),
    );
    const wrongHealth = spawnSync(
      process.execPath,
      [
        corePath,
        "assert-health-revision",
        wrongHealthPath,
        REVISION,
        "after-image-capture",
      ],
      { encoding: "utf8" },
    );
    expect(wrongHealth.status).toBe(1);
    expect(wrongHealth.stderr).toContain("Production revision изменилась");
  });
});
