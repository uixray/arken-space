// @vitest-environment jsdom
import type { ComponentProps } from "react";
import type { Button, TextArea, TextInput } from "@gravity-ui/uikit";
import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
  within,
} from "../test-support/render";
import {
  gmSnapshot,
  playerSnapshot,
} from "../test-support/game-snapshot-fixtures";
import {
  CampaignActionsContext,
  type CampaignActions,
} from "../campaign-actions-context";
import type { ArkenDialog } from "../ui/ArkenDialog";
import type { TextPromptDialog } from "../ui/TextPromptDialog";
import type { ImageUploadField } from "../ui/ImageUploadField";
import type { CharacterMediaGallery } from "./CharacterMediaGallery";
import { CharacterPanel } from "./CharacterWorkspace";

// UIX-414: retain the actual parent role decision, FormTextArea wrapper,
// native focus/change/blur events and mutation runner. Only the CSS library
// controls, closed dialogs, file-upload leaf and self-fetching gallery are
// replaced. No mock receives a role or computes ownership.
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    onPointerDown,
    title,
    "aria-label": ariaLabel,
  }: ComponentProps<typeof Button>) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
  TextArea: ({
    controlRef,
    controlProps,
    defaultValue,
    value,
    disabled,
    onChange,
    onBlur,
    rows,
    name,
  }: ComponentProps<typeof TextArea>) => (
    <textarea
      {...controlProps}
      ref={controlRef}
      defaultValue={defaultValue}
      value={value}
      disabled={disabled}
      onChange={onChange}
      onBlur={onBlur}
      rows={rows}
      name={name}
    />
  ),
  TextInput: ({
    controlProps,
    controlRef,
    defaultValue,
    value,
    disabled,
    onChange,
    onBlur,
    type,
    placeholder,
  }: ComponentProps<typeof TextInput>) => (
    <input
      {...controlProps}
      ref={controlRef}
      defaultValue={defaultValue}
      value={value}
      disabled={disabled}
      onChange={onChange}
      onBlur={onBlur}
      type={type}
      placeholder={placeholder}
    />
  ),
}));
vi.mock("../ui/ArkenDialog", () => ({
  ArkenDialog: (_props: ComponentProps<typeof ArkenDialog>) => null,
}));
vi.mock("../ui/TextPromptDialog", () => ({
  TextPromptDialog: (_props: ComponentProps<typeof TextPromptDialog>) => null,
}));
vi.mock("../ui/ImageUploadField", () => ({
  ImageUploadField: (_props: ComponentProps<typeof ImageUploadField>) => null,
}));
vi.mock("./CharacterMediaGallery", () => ({
  // A prop-only sentinel, not proof of gallery interactions/server ACL. It
  // detects passing general sheet editability to the narrower media policy.
  CharacterMediaGallery: ({
    editable,
  }: ComponentProps<typeof CharacterMediaGallery>) => (
    <button type="button" disabled={!editable}>
      Gallery edit permission
    </button>
  ),
}));

const unexpectedAction = (): never => {
  throw new Error("Backstory test must not execute another campaign command");
};

// Keep the real context/provider and its complete typed contract. The form's
// onPatch is observed separately; every unrelated command fails closed.
const actions: CampaignActions = {
  scene: {
    onViewScene: unexpectedAction,
    onSaveScene: unexpectedAction,
    onCreateScene: unexpectedAction,
    onActivateScene: unexpectedAction,
    onAssignMap: unexpectedAction,
    onRenameScene: unexpectedAction,
  },
  worldMap: {
    onCreateWorldMap: unexpectedAction,
    onSetWorldMapDraftBackground: unexpectedAction,
    onApproveWorldMapBackground: unexpectedAction,
    onPublishWorldMap: unexpectedAction,
    onArchiveWorldMap: unexpectedAction,
    onArchiveCharacter: unexpectedAction,
    onRestoreCharacter: unexpectedAction,
    onLoadArchivedCharacters: unexpectedAction,
    onCreateWorldMapLocation: unexpectedAction,
    onUpdateWorldMapLocation: unexpectedAction,
    onLinkWorldMapLocationScene: unexpectedAction,
    onUnlinkWorldMapLocationScene: unexpectedAction,
    onSetWorldMapPartyPosition: unexpectedAction,
    onClearWorldMapPartyPosition: unexpectedAction,
  },
  token: {
    onPlaceTokenDefinition: unexpectedAction,
    onDeleteTokenDefinition: unexpectedAction,
    onPatchTokenDefinition: unexpectedAction,
    onCreateTokenDefinition: unexpectedAction,
    onCreateAndPlaceTokenDefinition: unexpectedAction,
    onReplaceTokenControllers: unexpectedAction,
    onCreateToken: unexpectedAction,
  },
  chat: {
    onChat: unexpectedAction,
    onSticker: unexpectedAction,
    onCreateDirectThread: unexpectedAction,
    onDirectChat: unexpectedAction,
    onUploadChatAttachment: unexpectedAction,
    onActiveChatThreadChange: unexpectedAction,
    onMarkChatRead: unexpectedAction,
  },
  access: {
    onCreateInvite: unexpectedAction,
    onListPlayerAccess: unexpectedAction,
    onRotatePlayerAccess: unexpectedAction,
    onRevokePlayerAccess: unexpectedAction,
    onRenameMembership: unexpectedAction,
  },
  catalog: {
    onCreateCatalogEntry: unexpectedAction,
    onUpdateCatalogEntry: unexpectedAction,
    onDeleteCatalogEntry: unexpectedAction,
    onAssignCatalogEntry: unexpectedAction,
    onUpdateCharacterEntry: unexpectedAction,
    onDeleteCharacterEntry: unexpectedAction,
    onRollEntry: unexpectedAction,
    onRechargeEntry: unexpectedAction,
  },
  story: {
    onLoadMoreStoryPosts: unexpectedAction,
    onCreateStoryDraft: unexpectedAction,
    onUpdateStoryPost: unexpectedAction,
    onPublishStoryPost: unexpectedAction,
    onArchiveStoryPost: unexpectedAction,
  },
  playerRequest: {
    onOpenPlayerRequestCreate: unexpectedAction,
    onCreatePlayerRequest: unexpectedAction,
    onUpdatePlayerRequest: unexpectedAction,
    onPlayerRequestAction: unexpectedAction,
  },
  asset: {
    uploadAsset: unexpectedAction,
    getAssetUsage: unexpectedAction,
    deleteAsset: unexpectedAction,
    generateTokenImage: unexpectedAction,
  },
  statLayout: { onUpdateStatLayout: unexpectedAction },
  chatHistory: { onLoadThreadHistory: unexpectedAction },
};

function makeCharacter(overrides: Partial<CharacterDto> = {}): CharacterDto {
  return {
    id: "character-being-edited",
    name: "Персонаж формы",
    ownerMembershipId: "another-owner",
    controllerMembershipIds: ["another-controller"],
    portraitAssetId: null,
    stats: { strength: 3 },
    skills: [],
    spells: [],
    notes: "Отдельные заметки",
    backstory: "Начальная предыстория",
    inventory: ["Компас"],
    resources: {},
    wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
    entries: [],
    revision: 17,
    lifecycle: "ACTIVE",
    archivedAt: null,
    archivedByMembershipId: null,
    ...overrides,
  };
}

type PanelProps = ComponentProps<typeof CharacterPanel>;

function renderPanel(snapshot: GameSnapshot, character: CharacterDto) {
  const onPatch = vi.fn<PanelProps["onPatch"]>().mockResolvedValue(undefined);
  const onUpdateCounters =
    vi.fn<PanelProps["onUpdateCounters"]>(unexpectedAction);
  const onReplaceControllers =
    vi.fn<PanelProps["onReplaceControllers"]>(unexpectedAction);
  const onRoll = vi.fn<PanelProps["onRoll"]>(unexpectedAction);
  const decoy = makeCharacter({
    id: "another-character",
    name: "Не редактируется",
    revision: 91,
  });
  renderComponent(
    <CampaignActionsContext.Provider value={actions}>
      <CharacterPanel
        snapshot={{ ...snapshot, characters: [decoy, character] }}
        character={character}
        selectedId={decoy.id}
        setSelectedId={unexpectedAction}
        showCharacterPicker={false}
        onPatch={onPatch}
        onReplaceControllers={onReplaceControllers}
        onRoll={onRoll}
        onUpdateCounters={onUpdateCounters}
      />
    </CampaignActionsContext.Provider>,
  );
  return { onPatch, onUpdateCounters, onReplaceControllers, onRoll };
}

async function openBackstory(user: ReturnType<typeof userEvent.setup>) {
  // The existing textarea has no label: use the visible disclosure text,
  // then an accessible textbox query scoped to that actual native details.
  // Do not add an artificial aria-label in a mock to conceal that boundary.
  const summary = screen.getByText("Предыстория", { exact: true });
  const details = summary.parentElement;
  if (summary.tagName !== "SUMMARY" || details?.tagName !== "DETAILS") {
    throw new Error("Expected the actual backstory disclosure");
  }
  await user.click(summary);
  return within(details).getByRole("textbox");
}

async function expectAllowedBackstory(
  snapshot: GameSnapshot,
  character: CharacterDto,
  mediaEditable: boolean,
  actor: "GM" | "OWNER" | "CONTROLLER",
) {
  const calls = renderPanel(snapshot, character);
  const user = userEvent.setup();
  const field = await openBackstory(user);
  expect(field, `UIX414_${actor}_EDITABLE`).toBeEnabled();
  expect(field).toHaveValue(character.backstory);
  const next = "Новая предыстория персонажа";
  await user.clear(field);
  await user.type(field, next);
  expect(calls.onPatch).not.toHaveBeenCalled();
  await user.tab();
  await waitFor(() => expect(calls.onPatch).toHaveBeenCalledTimes(1));
  expect(
    calls.onPatch,
    `UIX414_${actor}_PATCH_TARGET_PAYLOAD`,
  ).toHaveBeenCalledWith(character.id, {
    backstory: next,
    revision: character.revision,
  });
  expect(calls.onUpdateCounters).not.toHaveBeenCalled();
  expect(calls.onReplaceControllers).not.toHaveBeenCalled();
  expect(calls.onRoll).not.toHaveBeenCalled();
  const media = screen.getByRole("button", { name: "Gallery edit permission" });
  if (mediaEditable) expect(media).toBeEnabled();
  else expect(media).toBeDisabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
}

describe("CharacterPanel backstory role and mutation wiring", () => {
  it("lets GM edit another owner's backstory with the rendered character target", async () => {
    await expectAllowedBackstory(gmSnapshot(), makeCharacter(), true, "GM");
  });

  it("lets an owning PLAYER edit backstory and retains owner media access", async () => {
    const snapshot = playerSnapshot();
    const character = makeCharacter({
      ownerMembershipId: snapshot.me.id,
      controllerMembershipIds: [],
    });
    await expectAllowedBackstory(snapshot, character, true, "OWNER");
  });

  it("lets a delegated PLAYER edit backstory without granting media access", async () => {
    const snapshot = playerSnapshot();
    const character = makeCharacter({
      controllerMembershipIds: [snapshot.me.id],
    });
    await expectAllowedBackstory(snapshot, character, false, "CONTROLLER");
  });

  it("blocks an unrelated PLAYER's backstory interaction without mutation", async () => {
    // Defensive panel boundary, not evidence the server exposes this DTO to
    // an unrelated player. Workspace filtering and server ACL stay separate.
    const character = makeCharacter();
    const calls = renderPanel(playerSnapshot(), character);
    const user = userEvent.setup();
    const field = await openBackstory(user);
    expect(field, "UIX414_UNRELATED_READ_ONLY").toBeDisabled();
    await user.type(field, "Не должно сохраниться");
    await user.tab();
    expect(field).toHaveValue(character.backstory);
    expect(calls.onPatch).not.toHaveBeenCalled();
    expect(calls.onUpdateCounters).not.toHaveBeenCalled();
    expect(calls.onReplaceControllers).not.toHaveBeenCalled();
    expect(calls.onRoll).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Gallery edit permission" }),
    ).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
