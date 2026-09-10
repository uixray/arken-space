// @vitest-environment jsdom
import type { ComponentProps } from "react";
import type { AssetDto, CharacterDto, GameSnapshot } from "@arken/contracts";
import { ThemeProvider } from "@gravity-ui/uikit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CampaignActionsContext,
  type CampaignActions,
} from "../campaign-actions-context";
import { gmSnapshot } from "../test-support/game-snapshot-fixtures";
import { installMatchMediaMock } from "../test-support/dom-mocks";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
  waitFor,
  within,
} from "../test-support/render";
import { CharacterPanel } from "./CharacterWorkspace";

type PanelProps = ComponentProps<typeof CharacterPanel>;

// Real CharacterPanel, Gravity buttons, file input and gallery. Only the
// gallery's unrelated read-only network boundary and absent browser APIs are
// supplied here; mutation callbacks are observed at their owning controls.
beforeEach(() => {
  installMatchMediaMock();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:portrait-preview");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (
        /^\/api\/characters\/character-[ab]\/media$/.test(String(input)) &&
        init?.method === "GET"
      ) {
        return new Response("[]", {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected network request: ${String(input)}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const unexpectedAction = (): never => {
  throw new Error("Unexpected campaign action in character feedback test");
};

function actions(
  uploadAsset: CampaignActions["asset"]["uploadAsset"] = unexpectedAction,
): CampaignActions {
  return {
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
      uploadAsset,
      getAssetUsage: unexpectedAction,
      deleteAsset: unexpectedAction,
      generateTokenImage: unexpectedAction,
    },
    statLayout: { onUpdateStatLayout: unexpectedAction },
    chatHistory: { onLoadThreadHistory: unexpectedAction },
  };
}

function character(overrides: Partial<CharacterDto> = {}): CharacterDto {
  return {
    id: "character-a",
    name: "Персонаж A",
    ownerMembershipId: "player-owner",
    controllerMembershipIds: ["player-owner"],
    portraitAssetId: null,
    stats: {},
    skills: [],
    spells: [],
    notes: "",
    backstory: "",
    inventory: [],
    resources: {},
    wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
    entries: [],
    revision: 7,
    lifecycle: "ACTIVE",
    archivedAt: null,
    archivedByMembershipId: null,
    ...overrides,
  };
}

function snapshot(characters = [character()]): GameSnapshot {
  const base = gmSnapshot({ characters });
  return {
    ...base,
    members: [
      ...base.members,
      {
        id: "player-owner",
        displayName: "Владелец листа",
        role: "PLAYER",
        characterId: characters[0]?.id ?? null,
      },
      {
        id: "player-guest",
        displayName: "Другой игрок",
        role: "PLAYER",
        characterId: null,
      },
    ],
  };
}

function panel(state: GameSnapshot, overrides: Partial<PanelProps> = {}) {
  return (
    <CharacterPanel
      snapshot={state}
      character={state.characters[0]}
      selectedId={state.characters[0]?.id ?? ""}
      setSelectedId={unexpectedAction}
      showCharacterPicker={false}
      onPatch={unexpectedAction}
      onReplaceControllers={unexpectedAction}
      onRoll={unexpectedAction}
      onUpdateCounters={unexpectedAction}
      {...overrides}
    />
  );
}

function view(
  state: GameSnapshot,
  overrides: Partial<PanelProps> = {},
  commands = actions(),
) {
  return (
    <ThemeProvider theme="dark" lang="ru">
      <CampaignActionsContext.Provider value={commands}>
        {panel(state, overrides)}
      </CampaignActionsContext.Provider>
    </ThemeProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const portrait: AssetDto = {
  id: "portrait-new",
  kind: "PORTRAIT",
  name: "portrait.png",
  mimeType: "image/png",
  sizeBytes: 8,
  width: 1,
  height: 1,
  durationSeconds: null,
  url: "/api/assets/portrait-new/content",
  createdAt: new Date(0).toISOString(),
};

async function galleryLoaded() {
  await waitFor(() =>
    expect(screen.queryAllByText("Загрузка галереи…")).toHaveLength(0),
  );
}

function selectPortrait(
  file = new File(["portrait"], "portrait.png", { type: "image/png" }),
) {
  fireEvent.change(screen.getByLabelText("Загрузить портрет для персонажа"), {
    target: { files: [file] },
  });
  return file;
}

describe("character action feedback", () => {
  it("explains empty players and unchanged access", async () => {
    renderComponent(view(gmSnapshot({ characters: [character()] })));
    await galleryLoaded();
    const access = within(
      screen.getByRole("group", { name: "Доступ к персонажу" }),
    );
    expect(access.getByText("В кампании пока нет игроков.")).toBeVisible();
    expect(access.queryAllByRole("checkbox")).toHaveLength(0);
    const save = access.getByRole("button", { name: "Сохранить доступ" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Изменений доступа нет.");
    expect(access.getAllByRole("button")).toHaveLength(1);
  });

  it("describes unchanged, dirty and pending access", async () => {
    const pending = deferred<void>();
    const save = vi.fn<PanelProps["onReplaceControllers"]>(
      () => pending.promise,
    );
    const state = snapshot();
    const rendered = renderComponent(
      view(state, { onReplaceControllers: save }),
    );
    await galleryLoaded();
    const button = screen.getByRole("button", { name: "Сохранить доступ" });
    const descriptionId = button.getAttribute("aria-describedby");
    expect(button).toHaveAccessibleDescription("Изменений доступа нет.");
    expect(
      screen.getByRole("checkbox", { name: /Владелец листа/ }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Другой игрок" }));
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleDescription(
      "Изменения доступа ещё не сохранены.",
    );
    act(() => {
      button.click();
      button.click();
    });
    expect(save).toHaveBeenCalledExactlyOnceWith("character-a", 7, [
      "player-owner",
      "player-guest",
    ]);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAccessibleDescription("Сохраняем доступ к персонажу…");
    expect(
      screen.getByRole("checkbox", { name: "Другой игрок" }),
    ).toBeDisabled();
    await act(async () => pending.resolve(undefined));
    rendered.rerender(
      view(
        snapshot([
          character({
            revision: 8,
            controllerMembershipIds: ["player-owner", "player-guest"],
          }),
        ]),
        { onReplaceControllers: save },
      ),
    );
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button).toHaveAttribute("aria-describedby", descriptionId);
    expect(button).toHaveAccessibleDescription("Изменений доступа нет.");
  });

  it("retains access rejection and re-enables save", async () => {
    const pending = deferred<void>();
    const save = vi.fn<PanelProps["onReplaceControllers"]>(
      () => pending.promise,
    );
    renderComponent(view(snapshot(), { onReplaceControllers: save }));
    await galleryLoaded();
    fireEvent.click(screen.getByRole("checkbox", { name: "Другой игрок" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить доступ" }));
    await act(async () => pending.reject(new Error("conflict")));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Не удалось сохранить доступ. Данные обновлены — проверьте список и повторите попытку.",
    );
    const button = screen.getByRole("button", { name: "Сохранить доступ" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button).toHaveAccessibleDescription(
      "Изменения доступа ещё не сохранены.",
    );
  });

  it("releases the access guard when the callback throws synchronously", async () => {
    const save = vi
      .fn<PanelProps["onReplaceControllers"]>()
      .mockImplementationOnce(() => {
        throw new Error("synchronous failure");
      })
      .mockResolvedValue(undefined);
    renderComponent(view(snapshot(), { onReplaceControllers: save }));
    await galleryLoaded();
    fireEvent.click(screen.getByRole("checkbox", { name: "Другой игрок" }));
    const button = screen.getByRole("button", { name: "Сохранить доступ" });
    fireEvent.click(button);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Не удалось сохранить доступ. Данные обновлены — проверьте список и повторите попытку.",
    );
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "false"));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("character-a", 7, [
      "player-owner",
      "player-guest",
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("describes portrait selection and removal on the upload button", async () => {
    renderComponent(view(snapshot()));
    await galleryLoaded();
    const button = screen.getByRole("button", {
      name: "Загрузить и назначить",
    });
    const descriptionId = button.getAttribute("aria-describedby");
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "Сначала выберите изображение портрета.",
    );
    selectPortrait();
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleDescription(
      "Файл выбран. Загрузите его, чтобы назначить портрет.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Удалить portrait.png" }),
    );
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-describedby", descriptionId);
    expect(button).toHaveAccessibleDescription(
      "Сначала выберите изображение портрета.",
    );
  });

  it("keeps upload and assignment pending without duplicate requests", async () => {
    const uploading = deferred<AssetDto>();
    const assigning = deferred<void>();
    const upload = vi.fn<CampaignActions["asset"]["uploadAsset"]>(
      () => uploading.promise,
    );
    const patch = vi.fn<PanelProps["onPatch"]>(() => assigning.promise);
    renderComponent(view(snapshot(), { onPatch: patch }, actions(upload)));
    await galleryLoaded();
    const file = selectPortrait();
    const button = screen.getByRole("button", {
      name: "Загрузить и назначить",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(upload).toHaveBeenCalledExactlyOnceWith(file, "PORTRAIT");
    expect(patch).not.toHaveBeenCalled();
    expect(button).toHaveAccessibleName("Загрузка…");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAccessibleDescription(
      "Загружаем и назначаем портрет…",
    );
    expect(button).toBeDisabled();
    expect(
      screen.getByLabelText("Загрузить портрет для персонажа"),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Удалить portrait.png" }),
    ).toBeDisabled();
    await act(async () => uploading.resolve(portrait));
    expect(patch).toHaveBeenCalledExactlyOnceWith("character-a", {
      portraitAssetId: "portrait-new",
      revision: 7,
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(upload).toHaveBeenCalledTimes(1);
    await act(async () => assigning.resolve(undefined));
    expect(button).toHaveAccessibleName("Загрузить и назначить");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button).toHaveAccessibleDescription(
      "Сначала выберите изображение портрета.",
    );
    expect(
      screen.getByLabelText("Загрузить портрет для персонажа"),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Удалить portrait.png" }),
    ).not.toBeInTheDocument();
  });

  it.each(["upload", "assignment"] as const)(
    "preserves file and error after %s rejection, then allows retry",
    async (failure) => {
      const upload = vi
        .fn<CampaignActions["asset"]["uploadAsset"]>()
        .mockResolvedValue(portrait);
      const patch = vi.fn<PanelProps["onPatch"]>().mockResolvedValue(undefined);
      if (failure === "upload")
        upload.mockRejectedValueOnce(new Error("upload failed"));
      else patch.mockRejectedValueOnce(new Error("assignment failed"));
      renderComponent(view(snapshot(), { onPatch: patch }, actions(upload)));
      await galleryLoaded();
      const file = selectPortrait();
      fireEvent.click(
        screen.getByRole("button", { name: "Загрузить и назначить" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Не удалось сохранить изменения персонажа. Повторите попытку.",
      );
      const button = screen.getByRole("button", {
        name: "Загрузить и назначить",
      });
      expect(button).toBeEnabled();
      expect(button).toHaveAttribute("aria-busy", "false");
      expect(button).toHaveAccessibleDescription(
        "Файл выбран. Загрузите его, чтобы назначить портрет.",
      );
      expect(
        screen.getByRole("button", { name: "Удалить portrait.png" }),
      ).toBeEnabled();
      if (failure === "upload") expect(patch).not.toHaveBeenCalled();
      fireEvent.click(button);
      await waitFor(() => expect(button).toHaveAttribute("aria-busy", "false"));
      expect(upload).toHaveBeenNthCalledWith(2, file, "PORTRAIT");
      expect(patch).toHaveBeenLastCalledWith("character-a", {
        portraitAssetId: "portrait-new",
        revision: 7,
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(button).toBeDisabled();
    },
  );

  it("isolates descriptions and upload state between open sheets", async () => {
    const uploading = deferred<AssetDto>();
    const upload = vi.fn<CampaignActions["asset"]["uploadAsset"]>(
      () => uploading.promise,
    );
    const patch = vi.fn<PanelProps["onPatch"]>().mockResolvedValue(undefined);
    const state = snapshot([
      character(),
      character({ id: "character-b", name: "Персонаж B", revision: 12 }),
    ]);
    renderComponent(
      <ThemeProvider theme="dark" lang="ru">
        <CampaignActionsContext.Provider value={actions(upload)}>
          {state.characters.map((item) => (
            <article key={item.id} aria-label={item.name}>
              {panel(state, {
                character: item,
                selectedId: item.id,
                onPatch: patch,
              })}
            </article>
          ))}
        </CampaignActionsContext.Provider>
      </ThemeProvider>,
    );
    await galleryLoaded();
    const first = within(screen.getByRole("article", { name: "Персонаж A" }));
    const second = within(screen.getByRole("article", { name: "Персонаж B" }));
    const firstUpload = first.getByRole("button", {
      name: "Загрузить и назначить",
    });
    const secondUpload = second.getByRole("button", {
      name: "Загрузить и назначить",
    });
    const descriptions = [
      firstUpload,
      secondUpload,
      first.getByRole("button", { name: "Сохранить доступ" }),
      second.getByRole("button", { name: "Сохранить доступ" }),
    ].map((button) => button.getAttribute("aria-describedby"));
    expect(descriptions.every(Boolean)).toBe(true);
    expect(new Set(descriptions).size).toBe(4);
    const firstFile = new File(["a"], "a.png", { type: "image/png" });
    const secondFile = new File(["b"], "b.png", { type: "image/png" });
    fireEvent.change(first.getByLabelText("Загрузить портрет для персонажа"), {
      target: { files: [firstFile] },
    });
    fireEvent.click(firstUpload);
    expect(secondUpload).toHaveAccessibleDescription(
      "Сначала выберите изображение портрета.",
    );
    expect(
      second.getByLabelText("Загрузить портрет для персонажа"),
    ).toBeEnabled();
    fireEvent.change(second.getByLabelText("Загрузить портрет для персонажа"), {
      target: { files: [secondFile] },
    });
    expect(secondUpload).toBeEnabled();
    await act(async () => uploading.resolve(portrait));
    expect(upload).toHaveBeenCalledExactlyOnceWith(firstFile, "PORTRAIT");
    expect(patch).toHaveBeenCalledExactlyOnceWith("character-a", {
      portraitAssetId: "portrait-new",
      revision: 7,
    });
    expect(firstUpload).toBeDisabled();
    expect(firstUpload).toHaveAccessibleDescription(
      "Сначала выберите изображение портрета.",
    );
    expect(secondUpload).toBeEnabled();
    expect(second.getByRole("button", { name: "Удалить b.png" })).toBeEnabled();
    expect(secondUpload).toHaveAccessibleDescription(
      "Файл выбран. Загрузите его, чтобы назначить портрет.",
    );
  });
});
