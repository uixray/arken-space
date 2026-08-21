import { describe, expect, it } from "vitest";
import { resolveMapToolShortcut } from "./renderers/map-interaction";
import { MAP_TOOL_SHORTCUTS } from "./renderers/map-tool-shortcuts";
import { getSlashCommandSuggestions } from "./chat-composer";
import { decideComposerKeydown } from "./composer-keyboard-intent";
import {
  canvasSections,
  chatCommands,
  chatSection,
} from "./landing-guide-content";
import { statLabelsFromLayout } from "./stat-keys";
import { starterStatLayout } from "@arken/system";
import {
  ROLL_MODIFIER_HINT,
  ROLL_MODIFIER_SHORTCUTS,
} from "./roll-modifier-keys";

/**
 * A guide that promises a shortcut the app does not have is worse than no
 * guide: the reader presses the key, nothing happens, and the rest of the page
 * stops being believable. These assert the page against the code it describes,
 * so a renamed tool or a dropped command breaks the build instead of quietly
 * turning the landing page into fiction.
 *
 * Only the mechanical claims are checked. Prose about what the app is for
 * cannot be, and is not attempted.
 */
const shortcutsFor = (title: string) =>
  canvasSections.find((section) => section.title === title)!.shortcuts;

describe("the landing guide describes shortcuts that exist", () => {
  it("lists tool keys the canvas actually resolves", () => {
    const tools = shortcutsFor("Инструменты")
      .map((shortcut) => shortcut.keys[0]!)
      // Esc and the object list are handled directly in the key handler
      // rather than through the tool table.
      .filter((key) => !["Esc", "O"].includes(key));

    for (const key of tools)
      expect(
        resolveMapToolShortcut(key, false, "PLAYER"),
        `the guide offers "${key}" but no tool answers to it`,
      ).not.toBeNull();
  });

  it("marks every GM-only shortcut, and marks nothing else", () => {
    for (const section of canvasSections)
      for (const shortcut of section.shortcuts) {
        const key = shortcut.keys.at(-1)!;
        if (key.length !== 1) continue;
        const shift = shortcut.keys.includes("Shift");
        const forPlayer = resolveMapToolShortcut(key, shift, "PLAYER");
        const forGm = resolveMapToolShortcut(key, shift, "GM");
        // A key a GM can use and a player cannot is exactly what the badge
        // means. Anything else must not carry it.
        const isGmOnly = forGm !== null && forPlayer === null;
        expect(
          Boolean(shortcut.gmOnly),
          `"${shortcut.keys.join("+")}" is marked ${
            shortcut.gmOnly ? "GM-only" : "available to everyone"
          }, the code says otherwise`,
        ).toBe(isGmOnly);
      }
  });

  /**
   * The checks above prove nothing the guide says is false. This one proves
   * nothing true is missing — the other half, and the half that let Ctrl+Z
   * and Ctrl+Shift+Z ship undocumented: they exist, they work, and the guide
   * simply never mentioned them.
   *
   * Only the tool table is covered. Keys handled inline in the canvas key
   * handler (arrows, zoom, Enter, Delete) have no list to compare against;
   * closing that gap properly means giving them one.
   */
  it("documents every tool shortcut the canvas defines", () => {
    const documented = new Set(
      canvasSections
        .flatMap((section) => section.shortcuts)
        .map((shortcut) => shortcut.keys.at(-1)!.toLowerCase()),
    );

    const missing = MAP_TOOL_SHORTCUTS.filter(
      (shortcut) => !documented.has(shortcut.key),
    ).map((shortcut) => shortcut.key);
    expect(
      missing,
      "these tools have a shortcut the guide never mentions",
    ).toEqual([]);
  });

  it("does not offer a player a fog tool", () => {
    for (const shortcut of shortcutsFor("Туман войны")) {
      const key = shortcut.keys.at(-1)!;
      const shift = shortcut.keys.includes("Shift");
      expect(resolveMapToolShortcut(key, shift, "PLAYER")).toBeNull();
      expect(resolveMapToolShortcut(key, shift, "GM")).not.toBeNull();
    }
  });

  it("describes the same roll modifiers as button tooltips", () => {
    const promised = new Map(
      shortcutsFor("Модификаторы броска").map((shortcut) => [
        shortcut.keys.join("+"),
        shortcut.action,
      ]),
    );

    for (const { key, effect } of ROLL_MODIFIER_SHORTCUTS)
      expect(promised.get(key)).toBe(`Бросок ${effect}`);
    expect(ROLL_MODIFIER_HINT).toBe(
      ROLL_MODIFIER_SHORTCUTS.map(
        ({ key, effect }) => `${key} — ${effect}`,
      ).join(", "),
    );
  });
});

describe("the landing guide describes chat behaviour that exists", () => {
  it("describes what Enter actually does", () => {
    const intent = (keys: string[]) =>
      decideComposerKeydown({
        key: "Enter",
        ctrlKey: keys.includes("Ctrl"),
        shiftKey: keys.includes("Shift"),
        isComposing: false,
      });

    const promised = new Map(
      chatSection.shortcuts.map((shortcut) => [
        shortcut.keys.join("+"),
        shortcut.action,
      ]),
    );
    expect(promised.get("Enter")).toContain("всем");
    expect(intent(["Enter"])).toBe("SEND_PUBLIC");
    expect(promised.get("Shift+Enter")).toContain("строки");
    expect(intent(["Shift"])).toBe("NEWLINE");
    expect(promised.get("Ctrl+Enter")).toContain("мастеру");
    expect(intent(["Ctrl"])).toBe("SEND_GM_ONLY");
  });

  it("offers only slash commands the composer suggests", () => {
    const stats = { agility: 3, strength: 2 };
    // Подписи — из настоящей стартовой раскладки: композер больше не носит
    // собственный список характеристик.
    const labels = statLabelsFromLayout(starterStatLayout);
    for (const { command } of chatCommands) {
      // The last entry is a bare formula, not a command — it is a real
      // feature, but not one the suggestion list knows about.
      if (!command.startsWith("/")) continue;
      const name = command.split(" ")[0]!;
      const suggestions = getSlashCommandSuggestions(name, stats, labels).map(
        (item) => item.command,
      );
      expect(
        suggestions,
        `the guide offers "${name}" but the composer never suggests it`,
      ).toContain(name);
    }
  });
});
