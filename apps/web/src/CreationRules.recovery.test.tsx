// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
vi.mock("./use-creation-session", () => ({ useCreationPage: () => ({ data: { items: [] }, loading: false, error: "", hasPrevious: false, next: vi.fn(), first: vi.fn() }) }));
vi.mock("./CreationVersionHistory", () => ({ CreationVersionHistory: () => null }));
const { CreationRules } = await import("./CreationRules");
it("reconciles only a matching recovered rule availability change", async () => {
  const ranges = Object.fromEntries(["power", "priceCopper", "craftSp", "usageCost"].map(k => [k, { min: 0, max: 0 }]));
  const source = { format: 1, name: "Test", kind: "SKILL", components: [], slots: [], compatibility: [], limits: ranges, manualAdjustment: ranges };
  const pack = { id: "one", name: "Test", enabled: true, revision: 2, latestVersion: { source } };
  const session = { locked: false, completed: null };
  const view = renderComponent(<CreationRules session={session as never} packs={[pack] as never} active />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Test" }));
  expect(screen.getByText("Навыки · ревизия 2")).toBeInTheDocument();
  const completed = { path: "rules/enabled", body: { packId: "another", expectedRevision: 2, enabled: false }, receipt: { revision: 3 } };
  view.rerender(<CreationRules session={{ ...session, completed } as never} packs={[pack] as never} active />);
  expect(screen.getByText("Навыки · ревизия 2")).toBeInTheDocument();
  view.rerender(<CreationRules session={{ ...session, completed: { ...completed, body: { ...completed.body, packId: "one" } } } as never} packs={[pack] as never} active />);
  expect(await screen.findByText("Навыки · ревизия 3")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Включить опубликованный набор" })).toBeInTheDocument();
});
