// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { entryRollRequestSchema, type CharacterDto } from "@arken/contracts";
import {
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "../test-support/render";
import { QuickRollPanel } from "./QuickRollPanel";

vi.mock("../use-panel-resize", () => ({
  usePanelResize: () => ({ height: null, handleProps: {} }),
}));

beforeEach(() => window.localStorage.clear());

for (const kind of ["ABILITY", "SKILL"] as const) {
  for (const executable of [false, true]) {
    it(`${kind} ${executable ? "executes its roll" : "shares without an invalid execute request"}`, async () => {
      const entry = {
        id: "entry",
        kind,
        name: "Теневой шаг",
        description: "Описание",
        sourceCatalogEntryId: null,
        revision: 3,
        data: {
          rollActions: executable
            ? [
                {
                  id: "strike",
                  kind: "HIT",
                  label: "Удар",
                  dice: "1d20",
                  modifiers: [],
                },
              ]
            : [],
        },
      };
      const onEntryAction = vi.fn().mockResolvedValue(undefined);
      renderComponent(
        <QuickRollPanel
          rollCharacter={
            {
              stats: {},
              skills: [],
              entries: [entry],
            } as unknown as CharacterDto
          }
          campaignId="campaign"
          membershipId="member"
          rows={[]}
          quickRollPending={false}
          gmOnly={false}
          onQuickRoll={() => {}}
          onEntryAction={onEntryAction}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: "Способности" }));
      fireEvent.click(screen.getByRole("button", { name: "Теневой шаг" }));
      await waitFor(() => expect(onEntryAction).toHaveBeenCalledOnce());
      const [, mode, rollActionId] = onEntryAction.mock.calls[0]!;
      expect(mode).toBe(executable ? "EXECUTE" : "SHARE");
      expect(rollActionId).toBe(executable ? "strike" : undefined);
      expect(
        entryRollRequestSchema.safeParse({
          actionId: "11111111-1111-4111-8111-111111111111",
          entryRevision: entry.revision,
          mode,
          rollActionId,
          visibility: "PUBLIC",
        }).success,
      ).toBe(true);
    });
  }
}
