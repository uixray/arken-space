import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolvePlayerThemeId } from "./player-themes";

export type PlayerThemeSelection = string | "system";

/** Server-owned state. `null` selectedThemeId means use the supplied default. */
export type PlayerThemePreference = Readonly<{
  selectedThemeId: string | null;
  defaultThemeId: string | null;
  revision: number;
}>;

export type SavePlayerThemePreference = (
  selection: string | null,
  options: { signal: AbortSignal },
) => Promise<PlayerThemePreference>;

export type PlayerThemePreferenceController = Readonly<{
  /** The currently previewed appearance. `system` means no theme attribute. */
  selection: PlayerThemeSelection;
  /** The last accepted server preference for this scope. */
  preference: PlayerThemePreference | null;
  pending: boolean;
  error: string | null;
  preview: (selection: PlayerThemeSelection) => void;
  apply: () => Promise<void>;
  /** Persists null; it does not change the preview until the server accepts it. */
  reset: () => Promise<void>;
  cancel: () => void;
}>;

type ControllerInput = Readonly<{
  /** Null is unauthenticated: it must never retain the previous user's preview. */
  scopeKey: string | null;
  preference: PlayerThemePreference;
  /** Explicit server-published allowlist; registry membership alone is insufficient. */
  publishedThemeIds: readonly string[];
  save: SavePlayerThemePreference;
}>;

function allowedSelection(
  value: string | null,
  publishedThemeIds: ReadonlySet<string>,
): PlayerThemeSelection {
  return resolvePlayerThemeId({ selectedThemeId: value, publishedThemeIds });
}

/**
 * Preview and persisted state share the same published-only resolver. A removed
 * explicit override is not the same as clearing it to one's default.
 */
export function resolvePublishedPlayerThemePreference(
  preference: PlayerThemePreference,
  publishedThemeIds: ReadonlySet<string>,
): PlayerThemeSelection {
  return resolvePlayerThemeId({ ...preference, publishedThemeIds });
}

function sameScopePreference(
  left: PlayerThemePreference,
  right: PlayerThemePreference,
) {
  return (
    left.revision === right.revision &&
    left.selectedThemeId === right.selectedThemeId &&
    left.defaultThemeId === right.defaultThemeId
  );
}

/**
 * UI-only preference coordinator. It deliberately owns neither identity
 * storage nor a route: callers supply the authenticated scope and save adapter.
 */
export function usePlayerThemePreference({
  scopeKey,
  preference: incomingPreference,
  publishedThemeIds,
  save,
}: ControllerInput): PlayerThemePreferenceController {
  const published = useMemo(
    () => new Set(publishedThemeIds),
    [publishedThemeIds],
  );
  const initial = resolvePublishedPlayerThemePreference(
    incomingPreference,
    published,
  );
  const [canonical, setCanonical] = useState(incomingPreference);
  const [stateScopeKey, setStateScopeKey] = useState(scopeKey);
  const [selection, setSelection] = useState<PlayerThemeSelection>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canonicalRef = useRef(canonical);
  const selectionRef = useRef(selection);
  const scopeRef = useRef<string | null>(scopeKey);
  const generationRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const dirtyRef = useRef(false);

  // A scope boundary also protects an A → B → A return: every prior request
  // carries its generation, even if the string happens to become A again.
  useLayoutEffect(() => {
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    scopeRef.current = scopeKey;
    dirtyRef.current = false;
    const nextSelection =
      scopeKey === null
        ? "system"
        : resolvePublishedPlayerThemePreference(incomingPreference, published);
    canonicalRef.current = incomingPreference;
    selectionRef.current = nextSelection;
    setStateScopeKey(scopeKey);
    setPending(false);
    setError(null);
    setCanonical(incomingPreference);
    setSelection(nextSelection);
    return () => {
      generationRef.current += 1;
      requestRef.current?.abort();
      requestRef.current = null;
    };
    // Scope changes deliberately reset local state; incoming same-scope updates
    // are handled below without discarding an unsaved preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    if (scopeKey === null) return;
    const current = canonicalRef.current;
    // Equal revisions are only harmless if they are literally the same
    // preference. A contradictory bootstrap must not undo an accepted write.
    if (incomingPreference.revision <= current.revision) return;
    if (sameScopePreference(incomingPreference, current)) return;
    canonicalRef.current = incomingPreference;
    setCanonical(incomingPreference);
    if (!dirtyRef.current) {
      const nextSelection = resolvePublishedPlayerThemePreference(
        incomingPreference,
        published,
      );
      selectionRef.current = nextSelection;
      setSelection(nextSelection);
    }
  }, [incomingPreference, published, scopeKey]);

  const preview = useCallback(
    (next: PlayerThemeSelection) => {
      if (scopeRef.current === null || requestRef.current) return;
      const safe = allowedSelection(
        next === "system" ? "system" : next,
        published,
      );
      dirtyRef.current =
        safe !==
        resolvePublishedPlayerThemePreference(canonicalRef.current, published);
      selectionRef.current = safe;
      setError(null);
      setSelection(safe);
    },
    [published],
  );

  const persist = useCallback(
    async (next: string | null, changePreviewOnSuccess: boolean) => {
      const requestScope = scopeRef.current;
      if (requestScope === null || requestRef.current) return;
      // The catalogue can change between preview and click; never persist an
      // unpublished id captured by an earlier render.
      const safeNext =
        next === null || next === "system" || published.has(next)
          ? next
          : "system";
      const controller = new AbortController();
      requestRef.current = controller;
      const generation = generationRef.current;
      setPending(true);
      setError(null);
      try {
        const saved = await save(safeNext, { signal: controller.signal });
        if (
          controller.signal.aborted ||
          generation !== generationRef.current ||
          requestScope !== scopeRef.current
        )
          return;
        // Bootstrap and save are both server-authoritative, but an old response
        // must not roll the accepted revision (or a newer preview) backwards.
        if (
          saved.revision < canonicalRef.current.revision ||
          (saved.revision === canonicalRef.current.revision &&
            !sameScopePreference(saved, canonicalRef.current))
        )
          return;
        canonicalRef.current = saved;
        dirtyRef.current = false;
        setCanonical(saved);
        if (changePreviewOnSuccess) {
          const resolved = resolvePublishedPlayerThemePreference(
            saved,
            published,
          );
          selectionRef.current = resolved;
          setSelection(resolved);
        }
      } catch (reason) {
        if (
          controller.signal.aborted ||
          generation !== generationRef.current ||
          requestScope !== scopeRef.current
        )
          return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось сохранить тему",
        );
      } finally {
        if (
          generation === generationRef.current &&
          requestScope === scopeRef.current &&
          requestRef.current === controller
        ) {
          requestRef.current = null;
          setPending(false);
        }
      }
    },
    [published, save],
  );

  const apply = useCallback(
    () => persist(allowedSelection(selectionRef.current, published), true),
    [persist, published],
  );
  const reset = useCallback(() => persist(null, true), [persist]);
  const cancel = useCallback(() => {
    if (scopeRef.current === null || requestRef.current) return;
    dirtyRef.current = false;
    setError(null);
    const resolved = resolvePublishedPlayerThemePreference(
      canonicalRef.current,
      published,
    );
    selectionRef.current = resolved;
    setSelection(resolved);
  }, [published]);

  // Auth loss must be observable in this render, before the effect cleanup.
  const scopeChanged = stateScopeKey !== scopeKey;
  if (scopeKey === null)
    return {
      selection: "system",
      preference: null,
      pending: false,
      error: null,
      preview,
      apply,
      reset,
      cancel,
    };

  if (scopeChanged)
    return {
      selection: resolvePublishedPlayerThemePreference(
        incomingPreference,
        published,
      ),
      preference: incomingPreference,
      pending: false,
      error: null,
      preview,
      apply,
      reset,
      cancel,
    };

  return {
    selection: allowedSelection(selection, published),
    preference: canonical,
    pending,
    error,
    preview,
    apply,
    reset,
    cancel,
  };
}
