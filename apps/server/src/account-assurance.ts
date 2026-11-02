import { and, eq, isNotNull } from "drizzle-orm";
import { users } from "@arken/db";

/** Email assurance is never fabricated for an offline installation. The host's
 * approval is valid only in that local instance, never in the public service. */
export function accountAssuranceWhere(localInstanceId?: string) {
  return localInstanceId
    ? and(eq(users.identityKind, "LOCAL"), eq(users.localInstanceId, localInstanceId), isNotNull(users.localApprovedAt))
    : and(eq(users.identityKind, "EMAIL"), isNotNull(users.verifiedAt));
}
export function hasAccountAssurance(user: {
  identityKind?: string; verifiedAt: Date | null;
  localInstanceId?: string | null; localApprovedAt?: Date | null;
}, localInstanceId?: string) {
  return localInstanceId
    ? user.identityKind === "LOCAL" && user.localInstanceId === localInstanceId && Boolean(user.localApprovedAt)
    : (user.identityKind ?? "EMAIL") === "EMAIL" && Boolean(user.verifiedAt);
}
export function accountIdentityDto(user: { identityKind?: string; emailDisplay: string | null; localLogin?: string | null }) {
  return user.identityKind === "LOCAL"
    ? { email: null, identityKind: "LOCAL" as const, login: user.localLogin, verified: false }
    : { email: user.emailDisplay, verified: true };
}
