import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface OutboundMail { to: string; subject: string; text: string }
export interface MailAdapter { readonly ready: boolean; send(message: OutboundMail, options?: { messageId: string; signal?: AbortSignal }): Promise<void> }
export const unconfiguredMailAdapter: MailAdapter = { ready: false, async send() { throw new Error("MAIL_ADAPTER_NOT_CONFIGURED"); } };
/** Test-only sink. It is deliberately never wired into the server runtime. */
export function createTestMailOutbox() {
  const deliveries: OutboundMail[] = [];
  const adapter: MailAdapter = { ready: true, async send(message) { deliveries.push({ ...message }); } };
  return { adapter, read: () => deliveries.map((item) => ({ ...item })), clear: () => { deliveries.length = 0; } };
}

export type MailKeyring = { activeKeyId: string; keys: ReadonlyMap<string, Buffer> };
const keyIdPattern = /^[A-Za-z0-9_-]{1,32}$/;
export function parseMailKeyringConfig(activeKeyId: string, serialized: string): MailKeyring | null {
  if (!activeKeyId && !serialized) return null;
  if (!keyIdPattern.test(activeKeyId) || !serialized || serialized.length > 4096) throw new Error("MAIL_KEYRING_INVALID");
  const keys = new Map<string, Buffer>();
  for (const item of serialized.split(",")) {
    const at = item.indexOf("=");
    if (at < 1) throw new Error("MAIL_KEYRING_INVALID");
    const id = item.slice(0, at), encoded = item.slice(at + 1);
    if (!keyIdPattern.test(id) || !encoded || keys.has(id) || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("MAIL_KEYRING_INVALID");
    const key = Buffer.from(encoded, "base64url");
    if (key.length !== 32 || key.toString("base64url") !== encoded) throw new Error("MAIL_KEYRING_INVALID");
    keys.set(id, key);
  }
  if (!keys.has(activeKeyId)) throw new Error("MAIL_KEYRING_INVALID");
  return { activeKeyId, keys };
}
export function createTestMailKeyring(): MailKeyring { return { activeKeyId: "test-v1", keys: new Map([["test-v1", randomBytes(32)]]) }; }

export type MailEnvelopeContext = { messageId: string; actionTokenId: string; purpose: "VERIFY_EMAIL" | "RESET_PASSWORD"; formatVersion: number; keyId: string };
export type EncryptedMail = { keyId: string; nonce: string; ciphertext: string; authTag: string };
function aad(context: MailEnvelopeContext) { return Buffer.from(JSON.stringify(["arken-account-mail", context.formatVersion, context.messageId, context.actionTokenId, context.purpose, context.keyId])); }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function decodeCanonical(value: string, expectedLength?: number, maxLength = 16_384) {
  if (!value || value.length > Math.ceil(maxLength * 4 / 3) + 4 || (expectedLength !== undefined && value.length > Math.ceil(expectedLength * 4 / 3) + 4) || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("MAIL_DECRYPTION_FAILED");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || bytes.length > maxLength || (expectedLength !== undefined && bytes.length !== expectedLength)) throw new Error("MAIL_DECRYPTION_FAILED");
  return bytes;
}
export function encryptMailEnvelope(keyring: MailKeyring, context: MailEnvelopeContext, mail: OutboundMail): EncryptedMail {
  if (context.formatVersion !== 1 || context.keyId !== keyring.activeKeyId || !uuidPattern.test(context.messageId) || !uuidPattern.test(context.actionTokenId) || !["VERIFY_EMAIL", "RESET_PASSWORD"].includes(context.purpose) || mail.to.length > 320 || mail.subject.length > 200 || mail.text.length > 8192) throw new Error("MAIL_ENVELOPE_INVALID");
  const key = keyring.keys.get(context.keyId); if (!key || key.length !== 32) throw new Error("MAIL_KEY_UNAVAILABLE");
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(context));
  const plaintext = Buffer.from(JSON.stringify(mail), "utf8");
  if (plaintext.length > 16_384) throw new Error("MAIL_ENVELOPE_INVALID");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { keyId: context.keyId, nonce: nonce.toString("base64url"), ciphertext: ciphertext.toString("base64url"), authTag: cipher.getAuthTag().toString("base64url") };
}
export function decryptMailEnvelope(keyring: MailKeyring, context: MailEnvelopeContext, encrypted: EncryptedMail): OutboundMail {
  const key = keyring.keys.get(encrypted.keyId);
  if (!key || key.length !== 32 || context.keyId !== encrypted.keyId || context.formatVersion !== 1 || !uuidPattern.test(context.messageId) || !uuidPattern.test(context.actionTokenId) || !["VERIFY_EMAIL", "RESET_PASSWORD"].includes(context.purpose)) throw new Error("MAIL_DECRYPTION_FAILED");
  try {
    const nonce = decodeCanonical(encrypted.nonce, 12), tag = decodeCanonical(encrypted.authTag, 16), ciphertext = decodeCanonical(encrypted.ciphertext, undefined, 16_384);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(aad(context)); decipher.setAuthTag(tag);
    const raw = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const mail = JSON.parse(raw) as Partial<OutboundMail>;
    if (typeof mail.to !== "string" || typeof mail.subject !== "string" || typeof mail.text !== "string") throw new Error("MAIL_DECRYPTION_FAILED");
    return { to: mail.to, subject: mail.subject, text: mail.text };
  } catch { throw new Error("MAIL_DECRYPTION_FAILED"); }
}
