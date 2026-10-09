import { describe, expect, it } from "vitest";
import {
  assertPasswordPolicy,
  hashPassword,
  PasswordPolicyError,
  verifyPassword,
} from "./password-security.js";

describe("account password primitives", () => {
  it("hashes with a random salt and verifies only the matching password", async () => {
    const first = await hashPassword("long-enough pass🔐phrase");
    const second = await hashPassword("long-enough pass🔐phrase");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^\$scrypt\$N=131072,r=8,p=1\$/);
    await expect(verifyPassword("long-enough pass🔐phrase", first)).resolves.toBe(true);
    await expect(verifyPassword("different password", first)).resolves.toBe(false);
  });

  it("rejects malformed or unsupported stored verifiers", async () => {
    await expect(verifyPassword("long-enough pass phrase", "plaintext-secret"))
      .resolves.toBe(false);
    await expect(verifyPassword("long-enough pass phrase", "$scrypt$N=999999,r=8,p=1$abc$def"))
      .resolves.toBe(false);
  });

  it("enforces bounded Unicode length without trimming or truncation", () => {
    expect(() => assertPasswordPolicy("123456789012")).not.toThrow();
    expect(() => assertPasswordPolicy("            ")).not.toThrow();
    expect(() => assertPasswordPolicy("short")).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy("😀".repeat(129))).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy("😀".repeat(128))).not.toThrow();
  });
});
