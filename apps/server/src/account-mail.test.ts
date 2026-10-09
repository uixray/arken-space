import { describe, expect, it } from "vitest";
import { createTestMailOutbox, unconfiguredMailAdapter } from "./account-mail.js";

describe("mail adapter boundary", () => {
  it("captures test deliveries in memory without printing message contents", async () => {
    const outbox = createTestMailOutbox();
    await outbox.adapter.send({
      to: "test@example.invalid",
      subject: "Verify account",
      text: "https://local.invalid/verify?token=opaque-test-token",
    });
    expect(outbox.read()).toEqual([
      expect.objectContaining({ to: "test@example.invalid", text: expect.stringContaining("opaque-test-token") }),
    ]);
    outbox.clear();
    expect(outbox.read()).toEqual([]);
  });

  it("fails closed instead of treating an absent provider as successful delivery", async () => {
    await expect(unconfiguredMailAdapter.send({
      to: "test@example.invalid", subject: "Verify", text: "opaque token",
    })).rejects.toThrow("MAIL_ADAPTER_NOT_CONFIGURED");
  });
});
