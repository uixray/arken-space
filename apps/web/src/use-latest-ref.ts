import { useEffect, useRef, type MutableRefObject } from "react";

/**
 * UIX-398 — the indirection the ref-domains need.
 *
 * Four domains (characters, chat, tokens, player access) read live values —
 * `snapshot`, `activeScene` — inside their handlers. Depending on those in a
 * `useCallback` would rebuild the handler on every game event, which is
 * exactly when stability matters most: a chat message from another player
 * would invalidate every token handler. Reading them through a ref keeps the
 * handler's identity fixed while still seeing current data.
 *
 * The ref is updated in an effect rather than during render. Writing refs
 * while rendering is a side effect and misbehaves under React's double-render
 * in development. Effects run before any user interaction can occur, so a
 * handler invoked from an event always observes the value from the latest
 * committed render — which is what "latest" has to mean here.
 *
 * This is a deliberate trade: the ref is *not* safe to read during render (it
 * may lag by one render), only from callbacks and effects. Anything that
 * needs a value during render should keep taking it as a prop.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
