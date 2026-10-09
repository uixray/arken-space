import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 131_072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const MAX_MEMORY_BYTES = 256 * 1024 * 1024;
const HASH_PREFIX = "$scrypt$N=131072,r=8,p=1$";
const HASH_PATTERN = /^\$scrypt\$N=131072,r=8,p=1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/;
const MAX_ACTIVE_DERIVATIONS = 1;
const MAX_QUEUED_DERIVATIONS = 8;
let activeDerivations = 0;
const derivationQueue: Array<() => void> = [];

export class PasswordPolicyError extends Error {
  constructor() {
    super("PASSWORD_POLICY_REJECTED");
    this.name = "PasswordPolicyError";
  }
}

/** Accept 12..128 Unicode code points, without trimming or normalization. */
export function assertPasswordPolicy(password: string): void {
  const codePoints = Array.from(password).length;
  const bytes = Buffer.byteLength(password, "utf8");
  if (codePoints < 12 || codePoints > 128 || bytes > 512)
    throw new PasswordPolicyError();
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return acquireDerivation().then(
    (release) =>
      new Promise<Buffer>((resolve, reject) => {
        try {
          scryptCallback(
            password,
            salt,
            KEY_BYTES,
            { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEMORY_BYTES },
            (error, key) => {
              release();
              if (error) reject(error);
              else resolve(key as Buffer);
            },
          );
        } catch (error) {
          release();
          reject(error);
        }
      }),
  );
}

function acquireDerivation(): Promise<() => void> {
  if (activeDerivations < MAX_ACTIVE_DERIVATIONS) {
    activeDerivations += 1;
    return Promise.resolve(releaseDerivation);
  }
  if (derivationQueue.length >= MAX_QUEUED_DERIVATIONS)
    return Promise.reject(new Error("PASSWORD_WORK_CAPACITY_EXCEEDED"));
  return new Promise((resolve) => derivationQueue.push(() => resolve(releaseDerivation)));
}

function releaseDerivation(): void {
  const next = derivationQueue.shift();
  if (next) next();
  else activeDerivations = 0;
}

/** Encoded, versioned scrypt verifier. Never log either argument or result. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return `${HASH_PREFIX}${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Malformed/unknown encodings fail closed; accepted hashes use fixed-size constant-time comparison. */
export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  try {
    assertPasswordPolicy(password);
  } catch {
    return false;
  }
  const match = HASH_PATTERN.exec(encodedHash);
  if (!match) return false;
  const salt = Buffer.from(match[1]!, "base64url");
  const expected = Buffer.from(match[2]!, "base64url");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}
