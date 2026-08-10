/**
 * UIX-397: minimal, non-content state snapshot for error reports.
 *
 * The global error handlers are installed at module init (before React
 * mounts, before auth), so they cannot read component state directly. App.tsx
 * keeps this side channel updated as the active scene / tool / role change;
 * none of these values are user-authored content.
 */

export type ErrorReportContext = {
  sceneId?: string;
  tool?: string;
  role?: string;
  buildRevision?: string;
};

let current: ErrorReportContext = {};

export function setErrorReportContext(next: ErrorReportContext): void {
  current = next;
}

export function getErrorReportContext(): ErrorReportContext {
  return current;
}

export function resetErrorReportContextForTest(): void {
  current = {};
}
