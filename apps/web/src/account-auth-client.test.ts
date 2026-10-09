import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import {
  changeAccountPassword, confirmPasswordReset, confirmVerification,
  consumeActionToken, loginAccount, logoutAccount, registerAccount,
  requestPasswordReset, requestVerification,
} from "./account-auth-client";

vi.mock("./api", () => ({ api: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe("account auth client", () => {
  it("uses only the frozen account endpoints and sends credentials in POST bodies", async () => {
    vi.mocked(api).mockResolvedValue({ ok: true });
    await registerAccount("user@example.test", "a strong password");
    expect(api).toHaveBeenLastCalledWith("/api/account/register", {
      method: "POST", body: JSON.stringify({ email: "user@example.test", password: "a strong password" }),
    });
    await loginAccount("user@example.test", "a strong password");
    expect(api).toHaveBeenLastCalledWith("/api/account/login", {
      method: "POST", body: JSON.stringify({ email: "user@example.test", password: "a strong password" }),
    });
  });

  it("posts verification/reset tokens in the body, never in a request URL", async () => {
    vi.mocked(api).mockResolvedValue({ ok: true });
    await confirmVerification("synthetic-verify-token-123456789012345678901234");
    expect(api).toHaveBeenLastCalledWith("/api/account/verification/confirm", expect.objectContaining({ method: "POST" }));
    expect(vi.mocked(api).mock.lastCall?.[0]).not.toContain("synthetic");
    await confirmPasswordReset("synthetic-reset-token-12345678901234567890123", "a strong password");
    expect(vi.mocked(api).mock.lastCall?.[0]).toBe("/api/account/password/reset/confirm");
  });

  it("uses session-bound CSRF for password change and logout", async () => {
    vi.mocked(api).mockResolvedValue({ ok: true });
    await changeAccountPassword("old password", "new password", "synthetic-csrf-token-12345678901234567890");
    expect(api).toHaveBeenLastCalledWith("/api/account/password/change", expect.objectContaining({
      method: "POST", headers: { "x-csrf-token": "synthetic-csrf-token-12345678901234567890" },
    }));
    await logoutAccount("synthetic-csrf-token-12345678901234567890");
    expect(api).toHaveBeenLastCalledWith("/api/account/logout", expect.objectContaining({ method: "POST", headers: expect.any(Object) }));
    await requestVerification("user@example.test"); await requestPasswordReset("user@example.test");
  });

  it("clears verification/reset fragments before returning one-use tokens", () => {
    const replace = vi.fn();
    const verifyLocation = { pathname: "/account/verify", search: "?safe=1", hash: "#token=synthetic-verification-token" } as Location;
    expect(consumeActionToken(verifyLocation, replace)).toBe("synthetic-verification-token");
    expect(replace).toHaveBeenCalledExactlyOnceWith("/account/verify?safe=1");
    expect(consumeActionToken({ ...verifyLocation, hash: "#not-token=x" } as Location, replace)).toBeNull();
  });
});
