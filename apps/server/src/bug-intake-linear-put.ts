import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

const ticketSchema = z.object({
  uploadUrl: z.string().url().max(16384),
  assetUrl: z.string().url().max(2048),
  headers: z.array(z.object({ key: z.string().max(128), value: z.string().max(8192) })).max(32),
}).strict();

/** Called only after approved claim and fileUpload negotiation. No credentials
 * are accepted here; signed URL/headers live only in memory. No retries.
 * Origins must be administrator-owned exact allowlists, never request inputs.
 */
export async function putBugLinearFile(
  policy: { uploadOrigins: ReadonlySet<string>; assetOrigins: ReadonlySet<string> },
  input: unknown,
  bytes: Buffer,
  expected: { sha256: string; sizeBytes: number },
) {
  const parsed = ticketSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "INVALID_UPLOAD_TICKET" };
  const ticket = parsed.data;
  const upload = new URL(ticket.uploadUrl);
  const asset = new URL(ticket.assetUrl);
  const trusted = (url: URL, origins: ReadonlySet<string>) =>
    url.protocol === "https:" && !url.username && !url.password && !url.hash &&
    !isIP(url.hostname.replace(/^\[|\]$/g, "")) && origins.has(url.origin);
  if (!trusted(upload, policy.uploadOrigins) || !trusted(asset, policy.assetOrigins) || asset.search)
    return { ok: false as const, error: "UNTRUSTED_UPLOAD_TICKET" };
  if (bytes.length <= 0 || bytes.length > 100 * 1024 * 1024 ||
      bytes.length !== expected.sizeBytes ||
      createHash("sha256").update(bytes).digest("hex") !== expected.sha256)
    return { ok: false as const, error: "UPLOAD_BYTES_MISMATCH" };
  const headers = new Headers({ "Content-Type": "application/octet-stream" });
  const seen = new Set<string>();
  for (const entry of ticket.headers) {
    const key = entry.key.toLowerCase();
    // Never forward API authorization, cookies, Host or hop-by-hop headers.
    if (!/^(content-type|cache-control|x-amz-[a-z0-9-]+|x-goog-[a-z0-9-]+)$/.test(key) ||
        /[\r\n\x00]/.test(entry.value) || seen.has(key))
      return { ok: false as const, error: "UNSAFE_UPLOAD_HEADERS" };
    if (key === "content-type" && entry.value !== "application/octet-stream")
      return { ok: false as const, error: "UPLOAD_TYPE_MISMATCH" };
    seen.add(key);
    try { headers.set(entry.key, entry.value); }
    catch { return { ok: false as const, error: "UNSAFE_UPLOAD_HEADERS" }; }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(upload, {
      method: "PUT", body: new Uint8Array(bytes), headers, redirect: "error", signal: controller.signal,
    });
    await response.body?.cancel();
    if (!response.ok) return { ok: false as const, error: "UPLOAD_RESULT_UNKNOWN" };
    return { ok: true as const, assetUrl: ticket.assetUrl };
  } catch {
    return { ok: false as const, error: "UPLOAD_RESULT_UNKNOWN" };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
