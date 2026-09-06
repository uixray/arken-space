import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

// Matches mobile-foundation.css; 1024 is the first measured two-column fit.
export const COMPACT_LAYOUT_QUERY = "(max-width: 1023px)";
export type CompactSurface = "map" | "journal" | "character";
const roots: Record<CompactSurface, string> = {
  map: "main-content",
  journal: "activity-sidebar",
  character: "character-workspace",
};
const subscribe = (changed: () => void) => {
  const query = window.matchMedia(COMPACT_LAYOUT_QUERY);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
};
const getCompact = () => window.matchMedia(COMPACT_LAYOUT_QUERY).matches;

export function useCompactNavigation(
  scopeKey: string | null,
  workspace: string | null,
) {
  const compact = useSyncExternalStore(subscribe, getCompact, () => false);
  const [state, setState] = useState({
    scopeKey,
    surface: "map" as CompactSurface,
    previous: "map" as Exclude<CompactSurface, "character">,
    characterVisited: false,
  });
  const current =
    state.scopeKey === scopeKey
      ? state
      : {
          scopeKey,
          surface: "map" as const,
          previous: "map" as const,
          characterVisited: false,
        };
  const surface: CompactSurface =
    workspace === "characters"
      ? "character"
      : workspace
        ? "journal"
        : current.surface === "character"
          ? current.previous
          : current.surface;
  const focusMemory = useRef<Partial<Record<CompactSurface, HTMLElement>>>({});
  const scopeRef = useRef(scopeKey);
  const frameRef = useRef<number | null>(null);
  const previousCompact = useRef(compact);

  useEffect(() => {
    if (scopeRef.current !== scopeKey) {
      focusMemory.current = {};
      scopeRef.current = scopeKey;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    }
  }, [scopeKey]);
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // Remember the last control before pointer or Tab moves focus onto navigation.
  useEffect(() => {
    const rememberFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      for (const name of Object.keys(roots) as CompactSurface[]) {
        if (document.getElementById(roots[name])?.contains(target)) {
          focusMemory.current[name] = target;
          break;
        }
      }
    };
    document.addEventListener("focusin", rememberFocus);
    return () => document.removeEventListener("focusin", rememberFocus);
  }, []);

  // Presentation geometry only: never resize the canvas state or auth session.
  // visualViewport shrinks above a virtual keyboard; dvh remains the CSS fallback.
  useEffect(() => {
    if (!compact) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const update = () => {
      root.style.setProperty(
        "--compact-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      root.style.setProperty(
        "--compact-viewport-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.style.removeProperty("--compact-viewport-height");
      root.style.removeProperty("--compact-viewport-top");
    };
  }, [compact]);

  const selectSurface = useCallback(
    (next: CompactSurface, restoreFocus = true) => {
      // Capture before activation effects focus a newly shown workspace heading.
      const remembered = focusMemory.current[next];
      if (compact) {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          document.getElementById(roots[surface])?.contains(active)
        ) {
          focusMemory.current[surface] = active;
        }
        // Move focus out before the previous surface becomes inert/hidden.
        document
          .getElementById(`compact-nav-${next}`)
          ?.focus({ preventScroll: true });
      }
      setState((old) => {
        const sameIdentity = old.scopeKey === scopeKey;
        return {
          scopeKey,
          surface: next,
          previous:
            surface === "character"
              ? sameIdentity
                ? old.previous
                : "map"
              : surface,
          characterVisited:
            next === "character" ||
            surface === "character" ||
            (sameIdentity && old.characterVisited),
        };
      });
      if (compact && restoreFocus) {
        frameRef.current = requestAnimationFrame(() => {
          const root = document.getElementById(roots[next]);
          if (
            remembered?.isConnected &&
            root?.contains(remembered) &&
            remembered.getClientRects().length
          ) {
            remembered.focus({ preventScroll: true });
          } else {
            // Do not open a keyboard merely because the user visited Journal.
            root?.focus({ preventScroll: true });
          }
        });
      }
    },
    [compact, scopeKey, surface],
  );

  useEffect(() => {
    if (previousCompact.current === compact) return;
    previousCompact.current = compact;
    const active = document.activeElement as HTMLElement | null;
    if (
      active &&
      (active.closest("[hidden], [inert]") || !active.getClientRects().length)
    ) {
      const target = compact
        ? document.getElementById(`compact-nav-${surface}`)
        : document.querySelector<HTMLElement>(".workspace-nav__item");
      target?.focus({ preventScroll: true });
    }
  }, [compact, surface]);

  return {
    compact,
    surface,
    selectSurface,
    previousSurface: current.previous,
    characterVisited: current.characterVisited || workspace === "characters",
  };
}
