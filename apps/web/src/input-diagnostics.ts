export type SafeInputDiagnostic = {
  at: string;
  event: "keydown" | "beforeinput" | "compositionstart" | "compositionend" | "focusin" | "focusout";
  key?: string;
  code?: string;
  inputType?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  composing?: boolean;
  target?: string;
};

const MAX_EVENTS = 100;

type ClosestTarget = EventTarget & { closest: (selector: string) => Element | null };

function supportsClosest(target: EventTarget | null): target is ClosestTarget {
  return Boolean(target && typeof (target as Partial<ClosestTarget>).closest === "function");
}

export function diagnosticKey(key: string) {
  return key.length > 1 ? key : "printable";
}

export function isEditableEventTarget(target: EventTarget | null) {
  if (!supportsClosest(target)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
    ),
  );
}

function describeTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return undefined;
  const role = target.getAttribute("role");
  return [target.tagName.toLowerCase(), role ? `[role=${role}]` : ""]
    .filter(Boolean)
    .join("");
}

export function installInputDiagnostics(locationSearch = window.location.search) {
  if (!new URLSearchParams(locationSearch).has("input-diagnostics")) return () => undefined;

  const events: SafeInputDiagnostic[] = [];
  const remember = (event: SafeInputDiagnostic) => {
    events.push(event);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  };
  const base = (event: Event) => ({
    at: new Date().toISOString(),
    target: describeTarget(event.target),
  });
  const onKeyDown = (event: KeyboardEvent) =>
    remember({
      ...base(event),
      event: "keydown",
      key: diagnosticKey(event.key),
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      composing: event.isComposing,
    });
  const onBeforeInput = (event: InputEvent) =>
    remember({
      ...base(event),
      event: "beforeinput",
      inputType: event.inputType,
      composing: event.isComposing,
    });
  const onComposition = (event: CompositionEvent) =>
    remember({
      ...base(event),
      event: event.type as "compositionstart" | "compositionend",
      composing: event.type === "compositionstart",
    });
  const onFocus = (event: FocusEvent) =>
    remember({
      ...base(event),
      event: event.type as "focusin" | "focusout",
    });

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("beforeinput", onBeforeInput as EventListener, true);
  window.addEventListener("compositionstart", onComposition, true);
  window.addEventListener("compositionend", onComposition, true);
  window.addEventListener("focusin", onFocus, true);
  window.addEventListener("focusout", onFocus, true);
  Object.defineProperty(window, "__arkenInputDiagnostics", {
    configurable: true,
    value: () => events.map((event) => ({ ...event })),
  });

  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("beforeinput", onBeforeInput as EventListener, true);
    window.removeEventListener("compositionstart", onComposition, true);
    window.removeEventListener("compositionend", onComposition, true);
    window.removeEventListener("focusin", onFocus, true);
    window.removeEventListener("focusout", onFocus, true);
    delete (window as Window & { __arkenInputDiagnostics?: unknown })
      .__arkenInputDiagnostics;
  };
}
