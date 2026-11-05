import { z } from "zod";
import { isAbsolute } from "node:path";

const bytes = z.coerce.number().int().positive();
const uuidList = z.string().refine(
  (value) =>
    value.trim() === "" ||
    value
      .split(",")
      .map((item) => item.trim())
      .every((item) => z.string().uuid().safeParse(item).success),
  "Must be a comma-separated list of membership UUIDs",
);

export const env = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_VERSION: z.string().default("0.2.0-dev"),
    BUILD_REVISION: z.string().trim().min(1).max(64).default("development"),
    SCHEMA_VERSION: z.coerce.number().int().positive().default(2),
    DEPLOYMENT_MODE: z.enum(["HOSTED", "LOCAL_HOST"]).default("HOSTED"),
    LOCAL_INSTANCE_ID: z.string().default(""),
    LOCAL_DATA_ROOT: z.string().default(""),
    LOCAL_WEB_ROOT: z.string().default(""),
    PORT: z.coerce.number().int().min(1).max(65535).default(4100),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    PUBLIC_URL: z.string().url().default("http://localhost:5173"),
    DATABASE_URL: z
      .string()
      .min(1)
      .default("postgres://arken:arken@localhost:5432/arken"),
    DEV_DATABASE_DRIVER: z.enum(["postgres", "pglite"]).default("postgres"),
    SESSION_COOKIE_NAME: z.string().default("arken_session"),
    ACCOUNT_SESSION_COOKIE_NAME: z.string().default("arken_account"),
    ACCOUNT_CSRF_COOKIE_NAME: z.string().default("arken_account_csrf"),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    ACCOUNT_AUTH_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ACCOUNT_REGISTRATION_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ACCOUNT_REGISTRATION_POLICY_APPROVED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    LEGACY_DEV_AUTH_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ACCOUNT_CAMPAIGN_CREATION_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ACCOUNT_CAMPAIGN_CREATION_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3),
    ACCOUNT_CAMPAIGN_CREATION_POLICY_APPROVED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    CAMPAIGN_LINK_ACCESS_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ACCOUNT_MAIL_ACTIVE_KEY_ID: z.string().default(""),
    ACCOUNT_MAIL_KEYRING: z.string().default(""),
    ACCOUNT_MAIL_RUNTIME_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ACCOUNT_MAIL_SMTP_HOST: z.string().default(""),
    ACCOUNT_MAIL_SMTP_PORT: z.string().default(""),
    ACCOUNT_MAIL_SMTP_USERNAME: z.string().default(""),
    ACCOUNT_MAIL_SMTP_PASSWORD: z.string().default(""),
    ACCOUNT_MAIL_SMTP_FROM: z.string().default(""),
    ACCOUNT_MAIL_SMTP_CONNECT_TIMEOUT_MS: z.string().default(""),
    ACCOUNT_MAIL_SMTP_GREETING_TIMEOUT_MS: z.string().default(""),
    ACCOUNT_MAIL_SMTP_SOCKET_TIMEOUT_MS: z.string().default(""),
    RATE_LIMIT_MAX: z.coerce.number().int().min(60).max(10_000).default(600),
    GM_ACCESS_TOKEN: z
      .string()
      .min(32)
      .default("development-master-token-change-me-now"),
    PERFORMANCE_LOG_DIR: z.string().default(""),
    PERFORMANCE_MIN_FREE_DISK_BYTES: bytes.default(3 * 1024 * 1024 * 1024),
    MEDIA_ROOT: z.string().default("./media"),
    // Local review UI/API only; never starts a Telegram adapter or sender.
    BUG_INTAKE_ENABLED: z.enum(["true", "false"]).default("false"),
    BUG_INTAKE_ROOT: z.string().trim().default(""),
    BUG_INTAKE_ASSET_ORIGINS: z.string().trim().max(4096).default(""),
    BUG_INTAKE_MAX_FILE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024)
      .default(20 * 1024 * 1024),
    GLOBAL_STICKERS_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    MEDIA_QUOTA_BYTES: bytes.default(5 * 1024 ** 3),
    MIN_FREE_DISK_BYTES: bytes.default(5 * 1024 ** 3),
    MAX_IMAGE_BYTES: bytes.default(20 * 1024 ** 2),
    MAX_AUDIO_BYTES: bytes.default(100 * 1024 ** 2),
    OPERATOR_MEMBERSHIP_IDS: uuidList.default(""),
    GEOMETRIC_DICE_MEMBERSHIP_IDS: uuidList.default(""),
    GEOMETRIC_DICE_USER_IDS: uuidList.default(""),
    OPERATOR_FEEDBACK_RATE_LIMIT_MAX: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(120),
  })
  /*
   * UIX-519 follow-up: дефолты выше существуют ради разработки и тестов —
   * интеграционные наборы импортируют этот модуль, а он разбирает
   * `process.env` прямо на импорте, поэтому обязательными их сделать нельзя.
   *
   * Но в production молчаливый дефолт опаснее отсутствия значения: сервер
   * поднимется на чужой базе или с общеизвестным токеном мастера вместо того,
   * чтобы честно не стартовать. Отсутствие переменной там — ошибка
   * конфигурации, а не повод угадывать.
   */
  .superRefine((value, ctx) => {
    if (value.DEPLOYMENT_MODE === "LOCAL_HOST") {
      const issue = (path: string, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      if (
        value.NODE_ENV !== "production" ||
        value.DEV_DATABASE_DRIVER !== "postgres"
      )
        issue(
          "DEPLOYMENT_MODE",
          "Local host requires production settings and PostgreSQL",
        );
      if (!z.string().uuid().safeParse(value.LOCAL_INSTANCE_ID).success)
        issue("LOCAL_INSTANCE_ID", "A local instance UUID is required");
      for (const key of [
        "LOCAL_DATA_ROOT",
        "LOCAL_WEB_ROOT",
        "MEDIA_ROOT",
        "PERFORMANCE_LOG_DIR",
      ] as const)
        if (!isAbsolute(value[key]))
          issue(key, "Local host requires an explicit absolute path");
      const origin = `http://localhost:${value.PORT}`;
      if (value.WEB_ORIGIN !== origin || value.PUBLIC_URL !== origin)
        issue(
          "WEB_ORIGIN",
          "This local pool permits loopback only; LAN requires a separate transport policy",
        );
      if (
        value.ACCOUNT_REGISTRATION_ENABLED ||
        value.ACCOUNT_MAIL_RUNTIME_ENABLED ||
        value.LEGACY_DEV_AUTH_ENABLED ||
        value.CAMPAIGN_LINK_ACCESS_ENABLED
      )
        issue(
          "DEPLOYMENT_MODE",
          "Public email, legacy login and secret-link access must remain disabled locally",
        );
      try {
        const database = new URL(value.DATABASE_URL);
        if (
          !["127.0.0.1", "localhost"].includes(database.hostname) ||
          database.pathname !== "/arken"
        )
          issue(
            "DATABASE_URL",
            "Local host may only connect to its own loopback arken database",
          );
      } catch {
        issue("DATABASE_URL", "Invalid local database URL");
      }
    }
    if (
      value.DEV_DATABASE_DRIVER === "pglite" &&
      value.NODE_ENV !== "development"
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEV_DATABASE_DRIVER"],
        message: "DEV_DATABASE_DRIVER=pglite разрешён только в development",
      });
    if (value.NODE_ENV !== "production") return;
    if (!value.ACCOUNT_AUTH_ENABLED)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ACCOUNT_AUTH_ENABLED"],
        message:
          "ACCOUNT_AUTH_ENABLED=true обязателен в production; legacy alias-login отключается только в account mode",
      });
    if (
      value.ACCOUNT_REGISTRATION_ENABLED &&
      !value.ACCOUNT_REGISTRATION_POLICY_APPROVED
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ACCOUNT_REGISTRATION_POLICY_APPROVED"],
        message: "Public registration requires an explicitly approved policy",
      });
    if (
      value.ACCOUNT_CAMPAIGN_CREATION_ENABLED &&
      !value.ACCOUNT_CAMPAIGN_CREATION_POLICY_APPROVED
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ACCOUNT_CAMPAIGN_CREATION_POLICY_APPROVED"],
        message:
          "Public campaign creation requires an explicitly approved policy",
      });
    if (value.CAMPAIGN_LINK_ACCESS_ENABLED && !value.ACCOUNT_AUTH_ENABLED)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CAMPAIGN_LINK_ACCESS_ENABLED"],
        message: "Campaign links can only run alongside account auth",
      });
    for (const key of ["DATABASE_URL", "GM_ACCESS_TOKEN"] as const)
      if (!process.env[key]?.trim())
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} обязателен в production: значение по умолчанию там не применяется`,
        });
    if (
      Boolean(value.ACCOUNT_MAIL_ACTIVE_KEY_ID) !==
      Boolean(value.ACCOUNT_MAIL_KEYRING)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ACCOUNT_MAIL_KEYRING"],
        message: "Mail keyring requires both an active key id and keyring",
      });
    if (value.ACCOUNT_MAIL_ACTIVE_KEY_ID || value.ACCOUNT_MAIL_KEYRING) {
      const ids = new Set<string>();
      let valid =
        /^[A-Za-z0-9_-]{1,32}$/.test(value.ACCOUNT_MAIL_ACTIVE_KEY_ID) &&
        value.ACCOUNT_MAIL_KEYRING.length <= 4096;
      for (const entry of value.ACCOUNT_MAIL_KEYRING.split(",")) {
        const [id, encoded, ...extra] = entry.split("=");
        const bytes =
          encoded && /^[A-Za-z0-9_-]+$/.test(encoded)
            ? Buffer.from(encoded, "base64url")
            : Buffer.alloc(0);
        if (
          !id ||
          !/^[A-Za-z0-9_-]{1,32}$/.test(id) ||
          !encoded ||
          extra.length ||
          bytes.length !== 32 ||
          bytes.toString("base64url") !== encoded ||
          ids.has(id)
        )
          valid = false;
        if (id) ids.add(id);
      }
      if (!ids.has(value.ACCOUNT_MAIL_ACTIVE_KEY_ID)) valid = false;
      if (!valid)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ACCOUNT_MAIL_KEYRING"],
          message:
            "Account mail keyring is invalid; no key material is reported",
        });
    }
  })
  .parse(process.env);
