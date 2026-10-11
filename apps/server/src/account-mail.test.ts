import { describe, expect, it } from "vitest";
import { createTestMailKeyring, decryptMailEnvelope, encryptMailEnvelope, parseMailKeyringConfig } from "./account-mail.js";

describe("encrypted account mail envelopes", () => {
  const context = { messageId: "9ba6ed8b-44c7-42fa-b663-66ee098baf17", actionTokenId: "f730fdda-320d-4d19-8ce8-4e083a3f5e66", purpose: "VERIFY_EMAIL" as const, formatVersion: 1, keyId: "test-v1" };
  const message = { to: "person@example.invalid", subject: "verify", text: "https://example.invalid#token=secret-bearer" };
  it("authenticates envelope context and ciphertext; no fallback on unknown keys", () => {
    const keys = createTestMailKeyring();
    const rotatedKeys = { ...keys, keys: new Map([...keys.keys.entries(), ["test-v2", Buffer.alloc(32, 2)]]) };
    const encrypted = encryptMailEnvelope(keys, context, message);
    expect(JSON.stringify(encrypted)).not.toContain(message.to);
    expect(JSON.stringify(encrypted)).not.toContain("secret-bearer");
    expect(decryptMailEnvelope(keys, context, encrypted)).toEqual(message);
    expect(() => decryptMailEnvelope(keys, { ...context, actionTokenId: "a123" }, encrypted)).toThrow("MAIL_DECRYPTION_FAILED");
    expect(() => decryptMailEnvelope(keys, { ...context, keyId: "unknown" }, encrypted)).toThrow("MAIL_DECRYPTION_FAILED");
    expect(() => decryptMailEnvelope(keys, context, { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -2) + "aa" })).toThrow("MAIL_DECRYPTION_FAILED");
    expect(() => decryptMailEnvelope(keys, context, { ...encrypted, authTag: encrypted.authTag.slice(0, -4) })).toThrow("MAIL_DECRYPTION_FAILED");
    expect(() => decryptMailEnvelope(keys, context, { ...encrypted, nonce: encrypted.nonce.slice(2) })).toThrow("MAIL_DECRYPTION_FAILED");
    expect(() => decryptMailEnvelope(keys, context, { ...encrypted, ciphertext: "%%%" })).toThrow("MAIL_DECRYPTION_FAILED");
    for (const tagBytes of [4, 8, 12, 15]) {
      const shortTag = Buffer.alloc(tagBytes).toString("base64url");
      expect(() => decryptMailEnvelope(keys, context, { ...encrypted, authTag: shortTag })).toThrow("MAIL_DECRYPTION_FAILED");
    }
    for (const altered of [
      { ...context, messageId: "8aa6ed8b-44c7-42fa-b663-66ee098baf17" },
      { ...context, actionTokenId: "e730fdda-320d-4d19-8ce8-4e083a3f5e66" },
      { ...context, purpose: "RESET_PASSWORD" as const },
      { ...context, formatVersion: 2 },
    ]) expect(() => decryptMailEnvelope(keys, altered, encrypted)).toThrow("MAIL_DECRYPTION_FAILED");
    expect(() => decryptMailEnvelope(rotatedKeys, { ...context, keyId: "test-v2" }, { ...encrypted, keyId: "test-v2" })).toThrow("MAIL_DECRYPTION_FAILED");
    expect(() => decryptMailEnvelope(keys, context, { ...encrypted, ciphertext: "A".repeat(40_000) })).toThrow("MAIL_DECRYPTION_FAILED");
  });
  it("strictly validates key ids, exact AES-256 length and active-key presence", () => {
    const value = Buffer.alloc(32, 9).toString("base64url");
    expect(parseMailKeyringConfig("k1", `k1=${value}`)?.keys.get("k1")?.length).toBe(32);
    expect(() => parseMailKeyringConfig("k2", `k1=${value}`)).toThrow("MAIL_KEYRING_INVALID");
    expect(() => parseMailKeyringConfig("k1", "k1=short")).toThrow("MAIL_KEYRING_INVALID");
  });
  it("retains old decryption keys across active-key rotation", () => {
    const oldKey = createTestMailKeyring();
    const sealed = encryptMailEnvelope(oldKey, context, message);
    const newKey = Buffer.alloc(32, 4);
    const rotated = { activeKeyId: "new-v2", keys: new Map([["test-v1", oldKey.keys.get("test-v1")!], ["new-v2", newKey]]) };
    expect(decryptMailEnvelope(rotated, context, sealed)).toEqual(message);
    const newest = encryptMailEnvelope(rotated, { ...context, keyId: "new-v2" }, message);
    expect(newest.keyId).toBe("new-v2");
  });
});
