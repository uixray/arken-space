// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { AppHeader, type AppHeaderProps } from "./AppHeader";

vi.mock("./ScenePicker", () => ({ ScenePicker: () => <div /> }));
vi.mock("./WorkspaceNav", () => ({
  WorkspaceNav: () => <nav aria-label="Разделы" />,
}));
vi.mock("./FeedbackReporter", () => ({ FeedbackReporter: () => null }));
vi.mock("./ui/AppIcon", () => ({ AppIcon: () => <span aria-hidden="true" /> }));

function createProps(overrides: Partial<AppHeaderProps> = {}): AppHeaderProps {
  const snapshot = {
    schemaVersion: 1,
    snapshotVersion: 1,
    buildVersion: "test",
    buildRevision: "1234567890",
    me: { id: "gm", displayName: "GM", role: "GM" },
    campaign: { id: "campaign", name: "Test", revision: 1 },
    scenes: [],
    assets: [],
    tokens: [],
  } as unknown as GameSnapshot;
  return {
    compact: false,
    activeScene: null,
    broadcastScene: null,
    recentlyPublishedSceneId: null,
    viewSnapshot: snapshot,
    snapshot,
    connection: "ONLINE",
    previewSnapshot: null,
    operatorFeedbackAllowed: false,
    workspace: null,
    onMusicControlsTarget: () => undefined,
    onSoundpadLauncherTarget: () => undefined,
    onOpenCompactSections: vi.fn(),
    onSelectScene: vi.fn(),
    onRequestEditScene: vi.fn(),
    onPublishScene: vi.fn(),
    onRequestCreateScene: vi.fn(),
    onSelectWorkspace: vi.fn(),
    onResync: vi.fn(),
    onOpenCampaignRename: vi.fn(),
    onOpenThemeSettings: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onExitPreview: vi.fn(),
    onOpenPlayerHandoff: vi.fn(),
    onLogout: vi.fn(),
    ...overrides,
  };
}

describe("AppHeader scene action", () => {
  it("opens the scene list instead of requesting scene creation", async () => {
    const user = userEvent.setup();
    const props = createProps();
    renderComponent(<AppHeader {...props} />);

    await user.click(screen.getByRole("button", { name: "Список сцен" }));

    expect(props.onSelectWorkspace).toHaveBeenCalledWith("scenes");
    expect(props.onRequestCreateScene).not.toHaveBeenCalled();
  });
});
