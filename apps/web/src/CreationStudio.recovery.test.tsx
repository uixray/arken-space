// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { CREATION_SLOTS } from "@arken/contracts";
import { renderComponent, screen, userEvent } from "./test-support/render";
const fixtures = vi.hoisted(() => ({ items: [] as any[], licences: [] as any[] }));
vi.mock("./use-creation-session", () => ({ useCreationPage: (_s: unknown, path: string) => ({ data: { items: path?.includes("templates") ? fixtures.items : fixtures.licences }, loading: false, error: "", hasPrevious: false, next: vi.fn(), first: vi.fn() }) }));
vi.mock("./CreationParts", async importOriginal => ({ ...await importOriginal<typeof import("./CreationParts")>(), Evaluation: () => null }));
const { CreationStudio } = await import("./CreationStudio");
it("uses the confirmed version on the next save after recovery", async () => {
  fixtures.licences = [];
  const design = { name: "Черновик", lore: "", appearance: "", selections: [{ componentId: "test", parameters: {} }], adjustments: { power: 0, priceCopper: 0, craftSp: 0, usageCost: 0 }, adjustmentReason: "" };
  const evaluation = { valid: true };
  fixtures.items = [{ id: "template", kind: "SKILL", authorMembershipId: "member", revision: 1, review: null,
    latestVersion: { id: "old", templateId: "template", number: 1, ruleVersionId: "rule", versionHash: "hash", design, evaluation } }];
  const ranges = Object.fromEntries(["power", "priceCopper", "craftSp", "usageCost"].map(k => [k, { min: 0, max: 0 }]));
  const packs = [{ id: "pack", kind: "SKILL", enabled: true, name: "Rules", activeVersion: { id: "rule", number: 1, source: { components: [], slots: CREATION_SLOTS.SKILL.map(slot => ({ slot, min: 0, max: 1 })), manualAdjustment: ranges } } }];
  const submit = vi.fn().mockResolvedValue(undefined);
  const session = { context: { campaignId: "c", membershipId: "member" }, busy: false, locked: false, submit, completed: null };
  const props = { packs: packs as never, gm: false, characterId: "", active: true };
  const view = renderComponent(<CreationStudio session={session as never} {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Черновик" }));
  const receipt = { revision: 2, versionId: "new", number: 2, versionHash: "newhash", evaluation };
  const body = { templateId: "template", expectedRevision: 1, previousVersionId: "old", ruleVersionId: "rule", design };
  view.rerender(<CreationStudio session={{ ...session, completed: { path: "templates/versions", body, receipt } } as never} {...props} />);
  await user.click(screen.getByRole("button", { name: "Сохранить новую версию" }));
  expect(submit).toHaveBeenCalledWith("templates/versions", expect.objectContaining({ expectedRevision: 2, previousVersionId: "new" }), expect.any(String));
});
