import { api } from "./api";
import type { AccountCapabilities, AccountSession } from "@arken/contracts";

export type AccountSessionResponse = AccountSession | { authenticated: false };
export type AccountActionResponse = { accepted: true } | { ok: true };
export const getAccountCapabilities = () =>
  api<AccountCapabilities>("/api/account/capabilities");

export const getAccountSession = () =>
  api<AccountSessionResponse>("/api/account/session");

export const registerAccount = (email: string, password: string) =>
  api<AccountActionResponse>("/api/account/register", {
    method: "POST", body: JSON.stringify({ email, password }),
  });

export const loginAccount = (email: string, password: string) =>
  api<AccountSession>("/api/account/login", {
    method: "POST", body: JSON.stringify({ email, password }),
  });

export const requestVerification = (email: string) =>
  api<AccountActionResponse>("/api/account/verification/request", {
    method: "POST", body: JSON.stringify({ email }),
  });

export const confirmVerification = (token: string) =>
  api<{ ok: true }>("/api/account/verification/confirm", {
    method: "POST", body: JSON.stringify({ token }),
  });

export const requestPasswordReset = (email: string) =>
  api<AccountActionResponse>("/api/account/password/reset/request", {
    method: "POST", body: JSON.stringify({ email }),
  });

export const confirmPasswordReset = (token: string, password: string) =>
  api<{ ok: true }>("/api/account/password/reset/confirm", {
    method: "POST", body: JSON.stringify({ token, password }),
  });

export const changeAccountPassword = (currentPassword: string, newPassword: string, csrfToken: string) =>
  api<{ ok: true; revokedSessions: number }>("/api/account/password/change", {
    method: "POST", headers: { "x-csrf-token": csrfToken }, body: JSON.stringify({ currentPassword, newPassword }),
  });

export const logoutAccount = (csrfToken?: string) =>
  api<{ ok: true }>("/api/account/logout", { method: "POST", ...(csrfToken ? { headers: { "x-csrf-token": csrfToken } } : {}) });

/** Authenticate through an explicitly issued legacy campaign link. Tokens are POST-body-only. */
export const authenticateCampaignLink = (kind: "gm" | "join", token: string, displayName?: string) =>
  api<{ ok: true }>(kind === "gm" ? "/api/auth/gm" : "/api/auth/invite", {
    method: "POST",
    body: JSON.stringify(kind === "gm" ? { token } : { token, ...(displayName?.trim() ? { displayName: displayName.trim() } : {}) }),
  });

/** Consume fragment credentials without ever forwarding them in a URL. */
export function consumeActionToken(location: Location, replace: (url: string) => void) {
  const params = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
  const token = params.get("token");
  if (token) replace(`${location.pathname}${location.search}`);
  return token;
}
