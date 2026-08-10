import type { ReactElement } from "react";
import { afterEach } from "vitest";
import {
  cleanup,
  render as rtlRender,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
// Extends Vitest's `expect` with DOM matchers (`toBeInTheDocument`,
// `toHaveFocus`, ...) used throughout this repo's component tests.
import "@testing-library/jest-dom/vitest";

// UIX-383: component tests need real DOM behavior (React Testing Library),
// which only works under a DOM-capable Vitest environment. Every test file
// that imports this module must start with the docblock
//   // @vitest-environment jsdom
// as its very first line (before any other statement) -- the root
// `vitest.config.ts` intentionally keeps `environment: "node"` as the
// default so the many pure-logic/server/PGlite suites keep their current,
// faster, DOM-free runtime. See docs/testing.md for the full rationale.

// RTL's automatic-cleanup-after-each-test behavior is opt-in for test
// runners it doesn't auto-detect; Vitest is one of them when the test file
// uses explicit `describe/it/expect` imports (no `globals: true` in this
// repo's config). Import this module once per test file to register it.
afterEach(() => {
  cleanup();
});

/**
 * Thin wrapper around RTL's `render` for @arken/web component tests.
 *
 * There is currently no app-level React context (theme, router, query
 * client, ...) that a component test needs to fake: `App.tsx` threads
 * `GameSnapshot` -- including `me.role` -- down to components as plain
 * props, not through context, so most components render correctly with
 * nothing more than the props they declare (see
 * `game-snapshot-fixtures.ts` for building those props).
 *
 * This function is the single seam to add a real provider later if the app
 * grows one that tests genuinely need (e.g. a router). Do not use it to add
 * a relaxed/mocked provider that changes what a component receives at
 * runtime compared to production -- that would undermine the authorization
 * honesty guarantee documented in `game-snapshot-fixtures.ts`.
 */
// The explicit `RenderResult` annotation is required rather than inferred:
// under pnpm's nested store the inferred type would reference
// `.pnpm/@testing-library+dom@.../queries`, a path TypeScript cannot name
// portably (TS2742).
export function renderComponent(
  ui: ReactElement,
  options?: RenderOptions,
): RenderResult {
  return rtlRender(ui, options);
}

export { screen, within, waitFor } from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
