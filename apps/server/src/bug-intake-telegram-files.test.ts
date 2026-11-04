import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramBugFileSource } from "./bug-intake-telegram-files.js";

afterEach(() => vi.unstubAllGlobals());

describe("Telegram file error sanitization", () => {
  it("does not expose a token-bearing fetch error", async () => {
    const syntheticToken = "123456:synthetic-token";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new Error(
            `request failed https://api.telegram.org/bot${syntheticToken}/getFile`,
          ),
        ),
    );
    try {
      await createTelegramBugFileSource(syntheticToken, 1024)("synthetic-file");
      expect.fail("Expected the download to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const failure = error as Error;
      expect(failure.message).toBe("TELEGRAM_DOWNLOAD_FAILED");
      expect(failure.cause).toBeUndefined();
      expect(failure.stack).not.toContain(syntheticToken);
    }
  });

  it("keeps the size-limit error without exposing the token", async () => {
    const syntheticToken = "123456:synthetic-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              file_id: "synthetic-file",
              file_path: "a.png",
              file_size: 2048,
            },
          }),
        ),
      ),
    );
    try {
      await createTelegramBugFileSource(syntheticToken, 1024)("synthetic-file");
      expect.fail("Expected the size limit to reject the file");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const failure = error as Error;
      expect(failure.message).toBe("BUG_FILE_TOO_LARGE");
      expect(failure.cause).toBeUndefined();
      expect(failure.stack).not.toContain(syntheticToken);
    }
  });

  it("sanitizes errors that occur while streaming the attachment", async () => {
    const syntheticToken = "123456:synthetic-token";
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(
          new Error(
            `fetch failed for https://example.test/bot${syntheticToken}/file`,
          ),
        );
      },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ok: true,
              result: { file_id: "synthetic-file", file_path: "a.png" },
            }),
          ),
        )
        .mockResolvedValueOnce(new Response(stream)),
    );
    const source = await createTelegramBugFileSource(
      syntheticToken,
      1024,
    )("synthetic-file");
    try {
      for await (const _chunk of source.chunks) {
        /* consume the failed stream */
      }
      expect.fail("Expected the download to fail");
    } catch (error) {
      const failure = error as Error;
      expect(failure.message).toBe("TELEGRAM_DOWNLOAD_FAILED");
      expect(failure.cause).toBeUndefined();
      expect(failure.stack).not.toContain(syntheticToken);
    } finally {
      await source.close();
    }
  });
});
