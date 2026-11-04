import { z } from "zod";

// Fetch errors may contain the bot token in their URL. Never preserve them as
// error causes or return them to callers, including in debug output.
function sanitizedTelegramDownloadError(error: unknown): Error {
  return new Error(
    error instanceof Error && error.message === "BUG_FILE_TOO_LARGE"
      ? "BUG_FILE_TOO_LARGE"
      : "TELEGRAM_DOWNLOAD_FAILED",
  );
}

async function readSmallJson(response: Response, maxBytes: number) {
  if (!response.body) throw new Error("TELEGRAM_RESPONSE_INVALID");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maxBytes) throw new Error("TELEGRAM_RESPONSE_TOO_LARGE");
      parts.push(item.value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Creates a lazy source opener, performs NO request until explicitly invoked.
 * Never instantiate with another project's token without owner activation.
 * Reference: https://core.telegram.org/bots/api#getfile */
export function createTelegramBugFileSource(token: string, maxBytes: number) {
  if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(token))
    throw new Error("INVALID_BOT_CREDENTIAL");
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > 20 * 1024 * 1024
  )
    throw new Error("INVALID_TELEGRAM_FILE_LIMIT");
  return async (fileId: string) => {
    if (!fileId || fileId.length > 256)
      throw new Error("INVALID_SOURCE_FILE_ID");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const close = async () => {
      clearTimeout(timer);
      controller.abort();
      await reader?.cancel().catch(() => {});
    };
    try {
      const metadata = await fetch(
        `https://api.telegram.org/bot${token}/getFile`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_id: fileId }),
          signal: controller.signal,
          redirect: "error",
        },
      );
      if (!metadata.ok) {
        await metadata.body?.cancel();
        throw new Error("TELEGRAM_FILE_UNAVAILABLE");
      }
      const parsed = z
        .object({
          ok: z.literal(true),
          result: z.object({
            file_id: z.string(),
            file_path: z.string().min(1).max(1024),
            file_size: z.number().int().safe().nonnegative().optional(),
          }),
        })
        .parse(await readSmallJson(metadata, 65536));
      if (parsed.result.file_id !== fileId)
        throw new Error("TELEGRAM_FILE_MISMATCH");
      if (
        parsed.result.file_size !== undefined &&
        parsed.result.file_size > maxBytes
      )
        throw new Error("BUG_FILE_TOO_LARGE");
      const segments = parsed.result.file_path.split("/");
      if (
        segments.some(
          (segment) =>
            !segment ||
            segment === "." ||
            segment === ".." ||
            !/^[A-Za-z0-9_.-]+$/.test(segment),
        )
      )
        throw new Error("TELEGRAM_PATH_INVALID");
      const response = await fetch(
        `https://api.telegram.org/file/bot${token}/${segments.join("/")}`,
        { signal: controller.signal, redirect: "error" },
      );
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error("TELEGRAM_FILE_UNAVAILABLE");
      }
      reader = response.body.getReader();
      const bodyReader = reader;
      async function* chunks() {
        let size = 0;
        try {
          while (true) {
            const item = await bodyReader.read();
            if (item.done) break;
            size += item.value.byteLength;
            if (size > maxBytes) throw new Error("BUG_FILE_TOO_LARGE");
            yield item.value;
          }
          if (
            parsed.result.file_size !== undefined &&
            size !== parsed.result.file_size
          )
            throw new Error("TELEGRAM_FILE_INCOMPLETE");
        } catch (error) {
          // Strip fetch errors: they may embed secret-bearing request URLs.
          throw sanitizedTelegramDownloadError(error);
        } finally {
          await close();
          bodyReader.releaseLock();
        }
      }
      return { chunks: chunks(), close };
    } catch (error) {
      await close();
      throw sanitizedTelegramDownloadError(error);
    }
  };
}
