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
  {
    listbox = false,
    closeOnViewportChange = false,
  }: {
    /** Opt in only for a single-select listbox, never a menu of mixed controls. */
    listbox?: boolean;
    closeOnViewportChange?: boolean;
  } = {},
) {
  useEffect(() => {
    const options = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          '[role="option"]:not([disabled]):not([aria-disabled="true"])',
        ) ?? [],
      );
    const syncListbox = () => {
      const details = ref.current;
      const summary = details?.querySelector<HTMLElement>("summary");
      if (!listbox || !details || !summary) return;
      summary.setAttribute("aria-expanded", String(details.open));
      if (!details.open) return;
      const rect = summary.getBoundingClientRect();
      details.style.setProperty(
        "--details-popup-max-height",
        `${Math.max(0, window.innerHeight - rect.bottom - 12)}px`,
      );
      details.style.setProperty(
        "--details-popup-max-width",
        `${Math.max(0, window.innerWidth - rect.left - 8)}px`,
      );
      const items = options();
      const active =
        items.find((item) => item === document.activeElement) ??
        items.find((item) => item.getAttribute("aria-selected") === "true") ??
        items[0];
      for (const option of items) option.tabIndex = option === active ? 0 : -1;
    };
    const close = (returnFocus: boolean) => {
      const details = ref.current;
      if (!details?.open) return;
      details.open = false;
      syncListbox();
      onDismiss?.();
      if (returnFocus) details.querySelector<HTMLElement>("summary")?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (shouldDismissDetails(ref.current, event.target)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        if (ref.current.closest("[hidden], [inert]")) {
          close(false);
          return;
        }
        event.preventDefault();
        close(true);
      }
    };
    const onListboxKeyDown = (event: KeyboardEvent) => {
      const details = ref.current;
      const summary = details?.querySelector<HTMLElement>("summary");
      if (!listbox || !details || !summary) return;
      if (!(event.target instanceof Node) || !details.contains(event.target))
        return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = options();
      if (!items.length) return;
      event.preventDefault();
      const fromSummary = event.target === summary;
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next = items.findIndex(
        (item) => item.getAttribute("aria-selected") === "true",
      );
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else if (!fromSummary && index >= 0) {
        next =
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length;
      }
      details.open = true;
      syncListbox();
      const target = items[Math.max(0, next)];
      for (const item of items) item.tabIndex = item === target ? 0 : -1;
      target?.focus();
      target?.scrollIntoView?.({ block: "nearest" });
    };
    const onFocusIn = (event: FocusEvent) => {
      if (listbox && shouldDismissDetails(ref.current, event.target))
        close(false);
    };
    const onViewportChange = () => close(false);
    const onAncestorScroll = (event: Event) => {
      // Scrolling the option list is expected; moving its anchor invalidates placement.
      const details = ref.current;
      if (
        details &&
        event.target instanceof Node &&
        event.target !== details &&
        event.target.contains(details)
      )
        close(false);
    };
    const onToggle = (event: Event) => {
      if (event.target === ref.current) syncListbox();
    };
    syncListbox();
    // The control can mount after bootstrap without changing the ref object.
    document.addEventListener("toggle", onToggle, true);
    document.addEventListener("keydown", onListboxKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    if (closeOnViewportChange) {
      window.addEventListener("resize", onViewportChange);
      window.visualViewport?.addEventListener("resize", onViewportChange);
      document.addEventListener("scroll", onAncestorScroll, true);
    }
    return () => {
      document.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("keydown", onListboxKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      if (closeOnViewportChange) {
        window.removeEventListener("resize", onViewportChange);
        window.visualViewport?.removeEventListener("resize", onViewportChange);
        document.removeEventListener("scroll", onAncestorScroll, true);
      }
    };
  }, [onDismiss, ref, listbox, closeOnViewportChange]);
}
