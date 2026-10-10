import { describe, expect, it } from "vitest";
import { spellActivationDraftError, SPELL_ACTIVATION_KINDS } from "./spell-node-activation";

describe("spell activation draft validation", () => {
  it("supports passive, active and hybrid forms and all trigger kinds", () => {
    expect(spellActivationDraftError({ passive: true, triggers: [] })).toBeNull();
    expect(spellActivationDraftError({ passive: false, triggers: [{ kind: "ACTION" }] })).toBeNull();
    expect(spellActivationDraftError({ passive: true, triggers: [{ kind: "REACTION" }] })).toBeNull();
    expect(SPELL_ACTIVATION_KINDS).toEqual(["ACTION", "BONUS_ACTION", "REACTION", "RITUAL", "OTHER"]);
    expect(spellActivationDraftError({ passive: false, triggers: [{ kind: "OTHER", label: "Особое" }] })).toBeNull();
    expect(spellActivationDraftError({ passive: false, triggers: [{ kind: "OTHER", rawText: "Как указано в источнике" }] })).toBeNull();
  });
  it("rejects empty active and OTHER rows and enforces the 20-row cap", () => {
    expect(spellActivationDraftError({ passive: false, triggers: [] })).toContain("пассивным");
    expect(spellActivationDraftError({ passive: false, triggers: [{ kind: "OTHER" }] })).toContain("Другое");
    expect(spellActivationDraftError({ passive: true, triggers: Array.from({ length: 21 }, () => ({ kind: "ACTION" as const })) })).toContain("20");
  });
  it("reports text limits separately from trigger count", () => {
    expect(spellActivationDraftError({ passive: true, triggers: [{ kind: "ACTION", label: "x".repeat(241) }] })).toContain("240");
    expect(spellActivationDraftError({ passive: true, triggers: [{ kind: "ACTION", rawText: "x".repeat(2001) }] })).toContain("2000");
  });});

