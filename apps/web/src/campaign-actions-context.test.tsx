// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
import {
  CampaignActionsContext,
  CAMPAIGN_ACTION_DOMAIN_KEYS,
  useCampaignActions,
  useCampaignActionsValue,
  type CampaignActions,
} from "./campaign-actions-context";

/**
 * The context is only safe because its value never changes. Context has no
 * selective subscription, so a changing value re-renders every consumer —
 * putting `snapshot` or any live value in here would silently turn the fix
 * into the exact problem it was meant to solve. These tests make that failure
 * loud instead.
 */
const noop = () => undefined;

function makeActions(overrides: Record<string, unknown> = {}): CampaignActions {
  const domain = () =>
    new Proxy({ testCommand: noop } as Record<string, unknown>, {
      get: (target, key) =>
        typeof key === "string" ? (target[key] ?? noop) : noop,
    }) as never;
  return {
    scene: domain(),
    worldMap: domain(),
    token: domain(),
    chat: domain(),
    access: domain(),
    catalog: domain(),
    story: domain(),
    playerRequest: domain(),
    asset: domain(),
    statLayout: domain(),
    chatHistory: domain(),
    character: domain(),
    initiative: domain(),
    dice: domain(),
    campaign: domain(),
    player: domain(),
    sidebar: domain(),
    ...overrides,
  } as CampaignActions;
}

/** Walks the value and reports anything that is not a function. */
function nonFunctionEntries(actions: CampaignActions): string[] {
  const offenders: string[] = [];
  for (const [domainName, domain] of Object.entries(actions)) {
    if (typeof domain !== "object" || domain === null) {
      offenders.push(domainName);
      continue;
    }
    for (const [key, value] of Object.entries(domain))
      if (typeof value !== "function") offenders.push(`${domainName}.${key}`);
  }
  return offenders;
}

describe("campaign actions invariant", () => {
  it("accepts a value made only of functions", () => {
    expect(nonFunctionEntries(makeActions())).toEqual([]);
  });

  it("rejects a live value smuggled into the context", () => {
    // The realistic mistake: reaching for the context to pass state along
    // because it is already threaded everywhere.
    const withState = makeActions({
      scene: { onViewScene: noop, snapshot: { characters: [] } },
    });
    expect(nonFunctionEntries(withState)).toEqual(["scene.snapshot"]);
  });
});

describe("useCampaignActions", () => {
  it("keeps the actual assembled context value stable across state rerenders", async () => {
    const seen: CampaignActions[] = [];
    function AppAssemblyHarness() {
      const [snapshotRevision, setSnapshotRevision] = useState(1);
      // Mirrors App: groups are rebuilt on render, while callback members are
      // stable. This exercises production assembly for the complete contract.
      const value = useCampaignActionsValue(makeActions());
      seen.push(value);
      return (
        <CampaignActionsContext.Provider value={value}>
          <span>revision {snapshotRevision}</span>
          <button
            type="button"
            onClick={() => setSnapshotRevision((revision) => revision + 1)}
          >
            receive snapshot
          </button>
        </CampaignActionsContext.Provider>
      );
    }

    renderComponent(<AppAssemblyHarness />);
    await userEvent.click(
      screen.getByRole("button", { name: "receive snapshot" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "receive snapshot" }),
    );

    expect(seen).toHaveLength(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
    expect(nonFunctionEntries(seen[2]!)).toEqual([]);
    expect(Object.keys(seen[2]!)).toEqual(CAMPAIGN_ACTION_DOMAIN_KEYS);
  });

  it.each([
    ["scene", "onViewScene"],
    ["worldMap", "onCreateWorldMap"],
    ["token", "onPlaceTokenDefinition"],
    ["chat", "onChat"],
    ["access", "onCreateInvite"],
    ["catalog", "onCreateCatalogEntry"],
    ["story", "onLoadMoreStoryPosts"],
    ["playerRequest", "onOpenPlayerRequestCreate"],
    ["asset", "replaceAsset"],
    ["statLayout", "onUpdateStatLayout"],
    ["chatHistory", "onLoadThreadHistory"],
    ["character", "patchCharacter"],
    ["initiative", "onUpdateInitiative"],
    ["dice", "onRoll"],
    ["campaign", "onCampaignClock"],
    ["player", "onPreviewPlayer"],
    ["sidebar", "onWorkspaceChange"],
  ] as const)(
    "updates a changed real command in %s without hiding it behind container identity",
    async (domain, command) => {
      const seen: CampaignActions[] = [];
      const changedCommand = () => undefined;
      function ChangedCommandHarness() {
        const [changed, setChanged] = useState(false);
        const group = new Proxy(
          { [command]: changed ? changedCommand : noop } as Record<
            string,
            unknown
          >,
          {
            get: (target, key) =>
              typeof key === "string" ? (target[key] ?? noop) : noop,
          },
        );
        const value = useCampaignActionsValue(makeActions({ [domain]: group }));
        seen.push(value);
        return (
          <button type="button" onClick={() => setChanged(true)}>
            change command
          </button>
        );
      }
      renderComponent(<ChangedCommandHarness />);
      await userEvent.click(
        screen.getByRole("button", { name: "change command" }),
      );
      expect(seen[1]).not.toBe(seen[0]);
      expect(
        (seen[1]![domain] as unknown as Record<string, unknown>)[command],
      ).toBe(changedCommand);
      expect(Object.keys(seen[1]!)).toEqual(CAMPAIGN_ACTION_DOMAIN_KEYS);
      expect(nonFunctionEntries(seen[1]!)).toEqual([]);
    },
  );

  it("hands every consumer the identical value across re-renders", async () => {
    // This identity is the whole basis for using context here: it is what
    // lets React.memo hold further down the tree. If the provider were given
    // a freshly built object each render — the easy mistake once App starts
    // assembling this inline — memo below would break everywhere at once,
    // and nothing else would look wrong.
    const seen: CampaignActions[] = [];
    const actions = makeActions();

    function Consumer() {
      seen.push(useCampaignActions());
      return <span>consumer</span>;
    }

    function Parent() {
      const [tick, setTick] = useState(0);
      return (
        <CampaignActionsContext.Provider value={actions}>
          <button type="button" onClick={() => setTick(tick + 1)}>
            rerender {tick}
          </button>
          <Consumer />
        </CampaignActionsContext.Provider>
      );
    }

    renderComponent(<Parent />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByRole("button"));

    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const value of seen.slice(1)) expect(value).toBe(seen[0]);
  });

  it("fails loudly when the provider is missing", () => {
    function Orphan() {
      useCampaignActions();
      return null;
    }
    expect(() => renderComponent(<Orphan />)).toThrow(
      /requires the campaign actions provider/,
    );
  });
});
