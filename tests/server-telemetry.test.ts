import { describe, expect, it } from "vitest";
import {
  clientEventSchema,
  publicUploadError,
  requestActionId,
  safeClientMessage,
  sanitizeClientContext,
} from "../apps/server/src/telemetry.js";

describe("server telemetry safety", () => {
  it("accepts only known browser events", () => {
    expect(
      clientEventSchema.safeParse({
        level: "error",
        event: "app.render_failed",
        context: { code: "UI-2025B9F3", errorName: "TypeError" },
      }).success,
    ).toBe(true);
    expect(
      clientEventSchema.safeParse({ level: "error", event: "window.error" })
        .success,
    ).toBe(true);
    expect(
      clientEventSchema.safeParse({ level: "error", event: "attacker.event" })
        .success,
    ).toBe(false);
  });

  it("allowlists context and never persists private gameplay text", () => {
    const privateText =
      "Эльрис: заметка о прошлом; ОГЛУШАЮЩИЙ УДАР — секретное описание";
    expect(
      sanitizeClientContext({
        operation: "wallet.update",
        status: 409,
        token: "secret",
        code: privateText,
        arbitrary: { nested: "data" },
      }),
    ).toEqual({
      operation: "wallet.update",
      status: 409,
    });
    const parsed = clientEventSchema.parse({
      level: "error",
      event: "window.error",
      message: privateText,
    });
    const loggedMessage = safeClientMessage(parsed.event);
    expect(loggedMessage).toBe("Browser runtime error");
    expect(loggedMessage).not.toContain("Эльрис");
    expect(loggedMessage).not.toContain("заметка");
    expect(loggedMessage).not.toContain("ОГЛУШАЮЩИЙ УДАР");
  });

  it("uses a generic log message for render failures", () => {
    const parsed = clientEventSchema.parse({
      level: "error",
      event: "app.render_failed",
      context: {
        code: "UI-2025B9F3",
        errorName: "TypeError",
      },
    });
    expect(safeClientMessage(parsed.event)).toBe(
      "Application interface render failed",
    );
    expect(sanitizeClientContext(parsed.context)).toEqual({
      code: "UI-2025B9F3",
      errorName: "TypeError",
    });
    expect(
      sanitizeClientContext({ errorName: "Custom error with private details" }),
    ).toEqual({});
    for (const unsafe of [
      {
        level: "error",
        event: "app.render_failed",
        message: "private",
        context: { code: "UI-2025B9F3", errorName: "TypeError" },
      },
      {
        level: "error",
        event: "app.render_failed",
        context: {
          code: "UI-2025B9F3",
          errorName: "TypeError",
          componentStack: "private",
        },
      },
      {
        level: "error",
        event: "app.render_failed",
        context: { code: "bad", errorName: "TypeError" },
      },
      {
        level: "error",
        event: "app.render_failed",
        context: { code: "UI-2025B9F3", errorName: "PrivateError" },
      },
    ])
      expect(clientEventSchema.safeParse(unsafe).success).toBe(false);
  });

  it("only correlates valid action IDs", () => {
    const actionId = crypto.randomUUID();
    expect(requestActionId(actionId)).toBe(actionId);
    expect(requestActionId("not-an-id")).toBeUndefined();
  });

  it("does not expose unexpected upload internals", () => {
    expect(publicUploadError(new Error("UNSUPPORTED_IMAGE_TYPE"))).toBe(
      "UNSUPPORTED_IMAGE_TYPE",
    );
    expect(publicUploadError(new Error("ENOENT /private/media/path"))).toBe(
      "UPLOAD_FAILED",
    );
  });
});
