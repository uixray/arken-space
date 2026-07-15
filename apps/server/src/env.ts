import { z } from "zod";

const bytes = z.coerce.number().int().positive();

export const env = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_VERSION: z.string().default("0.2.0-dev"),
    BUILD_REVISION: z.string().trim().min(1).max(64).default("development"),
    SCHEMA_VERSION: z.coerce.number().int().positive().default(2),
    PORT: z.coerce.number().int().min(1).max(65535).default(4100),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    PUBLIC_URL: z.string().url().default("http://localhost:5173"),
    DATABASE_URL: z
      .string()
      .min(1)
      .default("postgres://arken:arken@localhost:5432/arken"),
    SESSION_COOKIE_NAME: z.string().default("arken_session"),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    RATE_LIMIT_MAX: z.coerce.number().int().min(60).max(10_000).default(600),
    GM_ACCESS_TOKEN: z
      .string()
      .min(32)
      .default("development-master-token-change-me-now"),
    MEDIA_ROOT: z.string().default("./media"),
    MEDIA_QUOTA_BYTES: bytes.default(5 * 1024 ** 3),
    MIN_FREE_DISK_BYTES: bytes.default(5 * 1024 ** 3),
    MAX_IMAGE_BYTES: bytes.default(20 * 1024 ** 2),
    MAX_AUDIO_BYTES: bytes.default(100 * 1024 ** 2),
  })
  .parse(process.env);
