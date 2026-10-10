export interface MigrationIdentity {
  count: number;
  journalSha256: string;
  manifestSha256: string;
  migrationHashes: string[];
}

export interface MigrationPreflightSnapshot {
  source: MigrationIdentity;
  ledgerHashes: readonly string[];
  membershipColumns: readonly string[];
  roleLabels: readonly string[];
}

export const requiredMembershipColumns: readonly string[];
export const requiredRoleLabels: readonly string[];

export class ProbePreflightError extends Error {
  constructor(category: string);
}

export class ProbeAssertionError extends Error {
  constructor(message: string);
}

export function deriveMigrationIdentity(
  directory: string | URL,
): MigrationIdentity;
export function validateMigrationPreflight(
  expected: MigrationIdentity,
  actual: MigrationPreflightSnapshot,
): void;
export function isSafeApiErrorCode(code: unknown): code is string;
export function classifyProbeDiagnostic(error: unknown): string;
