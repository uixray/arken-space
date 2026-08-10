import { vi } from "vitest";

/**
 * Centralized, opt-in browser API mocks for component tests running under
 * `// @vitest-environment jsdom`.
 *
 * jsdom deliberately does not implement every browser API (it isn't a
 * browser). Call the installer a test file actually needs -- do not import
 * this module "just in case"; an unused installer is dead weight the same
 * way an untested mock is a false safety net.
 *
 * Audited against this codebase (UIX-383), not invented speculatively:
 *
 * - `ResizeObserver` -- confirmed missing from jsdom (`typeof
 *   window.ResizeObserver === "undefined"`). Real call site:
 *   `Orthographic2DRenderer.tsx`. That renderer is Konva/canvas-driven and
 *   explicitly out of scope for component testing here (see
 *   docs/testing.md) -- this installer exists for the day a
 *   non-canvas component that happens to mount near it (or a future
 *   extracted piece of it) needs a DOM test.
 * - `matchMedia` -- confirmed missing from jsdom. Not yet called by any
 *   component today (`cursor-broadcast.ts`'s `prefersReducedMotion` is
 *   currently a plain boolean parameter, not wired to a live
 *   `matchMedia` call), but the AC for this ticket calls it out by name for
 *   the upcoming cursor `prefers-reduced-motion` work, so the installer is
 *   included now rather than re-discovered under time pressure later.
 * - `localStorage` -- NOT mocked here: jsdom implements it natively once a
 *   real (non-opaque) origin is set, which Vitest's jsdom environment does
 *   by default. No installer needed.
 * - Pointer capture (`setPointerCapture`/`releasePointerCapture`/
 *   `hasPointerCapture`) -- confirmed missing from jsdom and used outside
 *   the canvas renderer too (`App.tsx`, `sidebar/DiceTrayPanel.tsx`,
 *   `ui/useWorkspaceWindow.ts`, `TokenImageGenerator.tsx`). No installer
 *   yet: neither component covered by this ticket's two component tests
 *   touches it. Add a same-shaped `installPointerCaptureMock()` here first,
 *   rather than inlining a one-off mock in a test file, when a test needs
 *   it.
 * - Konva/`react-konva` canvas rendering is out of scope entirely (see
 *   docs/testing.md) -- canvas behavior stays covered by extracted pure
 *   logic (`camera-fit.ts`, `fog.ts`, `map-interaction.ts`) plus manual
 *   browser QA, not jsdom.
 */

/** Installs a no-op `ResizeObserver` global. Call once, e.g. at the top of a test file or in `beforeEach`. */
export function installResizeObserverMock() {
  class MockResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
}

/**
 * Installs a `window.matchMedia` stub that always reports `matches`
 * (default `false`), with the listener methods real code defensively calls.
 */
export function installMatchMediaMock(matches = false) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated, still called by some libraries
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}
