import { afterEach, describe, expect, it, vi } from "vitest";
import {
  diagnosticKey,
  installInputDiagnostics,
  isEditableEventTarget,
  shouldIgnoreGlobalShortcut,
} from "./input-diagnostics";

type DiagnosticsWindow = EventTarget & {
  location: { search: string };
  __arkenInputDiagnostics?: () => Array<Record<string, unknown>>;
};

function fakeWindow(search = "?input-diagnostics") {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const value = {
    location: { search },
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const group = listeners.get(type) ?? new Set();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: Event) {
      for (const listener of listeners.get(event.type) ?? []) {
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
      return true;
    },
  } as unknown as DiagnosticsWindow;
  vi.stubGlobal("window", value);
  return value;
}

function dispatch(target: EventTarget, type: string, fields: Record<string, unknown> = {}) {
  const event = new Event(type);
  for (const [key, value] of Object.entries(fields)) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  target.dispatchEvent(event);
}

afterEach(() => vi.unstubAllGlobals());

describe("input diagnostics", () => {
  it("recognizes editable targets through their closest form control", () => {
    const editable = {
      closest: (selector: string) => selector.includes("textarea") ? ({} as Element) : null,
    } as unknown as EventTarget;

    expect(isEditableEventTarget(editable)).toBe(true);
    expect(isEditableEventTarget({} as EventTarget)).toBe(false);
    expect(isEditableEventTarget(null)).toBe(false);
  });

  it("redacts every non-whitelisted key, including multi-code-unit graphemes", () => {
    for (const key of ["ф", "f", "\u{1F600}", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}", "e\u0301", "SecretKey", "\ud83d"]) {
      expect(diagnosticKey(key)).toBe("printable");
    }
    expect(diagnosticKey("Escape")).toBe("Escape");
    expect(diagnosticKey("ArrowLeft")).toBe("ArrowLeft");
    expect(diagnosticKey("F24")).toBe("F24");
    expect(diagnosticKey("F25")).toBe("printable");
  });

  it("identifies editable and composing global shortcut events", () => {
    const editable = {
      closest: () => ({} as Element),
    } as unknown as EventTarget;
    expect(shouldIgnoreGlobalShortcut({ isComposing: true, target: {} as EventTarget })).toBe(true);
    expect(shouldIgnoreGlobalShortcut({ isComposing: false, target: editable })).toBe(true);
    expect(shouldIgnoreGlobalShortcut({ isComposing: false, target: {} as EventTarget })).toBe(false);
  });

  it("does nothing unless the diagnostics query flag is present", () => {
    const window = fakeWindow("?other=1");
    const cleanup = installInputDiagnostics(window.location.search);
    dispatch(window, "keydown", { key: "Escape", code: "Escape" });
    expect(window.__arkenInputDiagnostics).toBeUndefined();
    cleanup();
  });

  it("captures safe event metadata without InputEvent data or values", () => {
    const window = fakeWindow();
    const cleanup = installInputDiagnostics(window.location.search);

    dispatch(window, "keydown", {
      key: "\u{1F600}", code: "KeyA", ctrlKey: false, altKey: false,
      shiftKey: true, metaKey: false, isComposing: false, value: "password",
    });
    dispatch(window, "beforeinput", {
      inputType: "insertText", isComposing: true, data: "private text", value: "password",
    });
    dispatch(window, "compositionstart", { data: "ф" });
    dispatch(window, "compositionend", { data: "ф" });
    dispatch(window, "focusin");
    dispatch(window, "focusout");

    const events = window.__arkenInputDiagnostics?.() ?? [];
    expect(events.map((event) => event.event)).toEqual([
      "keydown", "beforeinput", "compositionstart", "compositionend", "focusin", "focusout",
    ]);
    expect(events[0]).toMatchObject({ key: "printable", code: "KeyA", shiftKey: true });
    expect(events[1]).toMatchObject({ inputType: "insertText", composing: true });
    expect(JSON.stringify(events)).not.toContain("private text");
    expect(JSON.stringify(events)).not.toContain("password");
    expect(JSON.stringify(events)).not.toContain("ф");
    cleanup();
  });

  it("caps the ring at 100 and returns cloned snapshots", () => {
    const window = fakeWindow();
    const cleanup = installInputDiagnostics(window.location.search);
    for (let index = 0; index < 105; index += 1) {
      dispatch(window, "keydown", { key: "Escape", code: `Code${index}` });
    }

    const first = window.__arkenInputDiagnostics?.() ?? [];
    expect(first).toHaveLength(100);
    expect(first[0]?.code).toBe("Code5");
    first[0]!.code = "mutated";
    expect(window.__arkenInputDiagnostics?.()[0]?.code).toBe("Code5");
    cleanup();
  });

  it("removes listeners and the snapshot accessor during cleanup", () => {
    const window = fakeWindow();
    const cleanup = installInputDiagnostics(window.location.search);
    const snapshot = window.__arkenInputDiagnostics!;
    dispatch(window, "keydown", { key: "Escape", code: "before-cleanup" });
    expect(snapshot()).toHaveLength(1);
    cleanup();
    dispatch(window, "keydown", { key: "Escape", code: "after-cleanup" });
    expect(window.__arkenInputDiagnostics).toBeUndefined();
    expect(snapshot()).toHaveLength(1);
  });
});
