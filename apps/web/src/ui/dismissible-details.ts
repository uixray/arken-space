import type { RefObject } from "react";
import { useEffect } from "react";

export function shouldDismissDetails(
  details: HTMLDetailsElement | null,
  target: EventTarget | null,
) {
  return Boolean(
    details?.open &&
    typeof Node !== "undefined" &&
    target instanceof Node &&
    !details.contains(target),
  );
}

export function useDismissibleDetails(
  ref: RefObject<HTMLDetailsElement | null>,
  onDismiss?: () => void,
) {
  useEffect(() => {
    const close = (returnFocus: boolean) => {
      const details = ref.current;
      if (!details?.open) return;
      details.open = false;
      onDismiss?.();
      if (returnFocus) details.querySelector<HTMLElement>("summary")?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (shouldDismissDetails(ref.current, event.target)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onDismiss, ref]);
}
