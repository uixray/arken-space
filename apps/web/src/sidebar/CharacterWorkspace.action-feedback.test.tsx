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
import { CharacterPanel, CharacterWorkspace } from "./CharacterWorkspace";

type PanelProps = ComponentProps<typeof CharacterPanel>;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

// Real CharacterPanel, Gravity buttons, file input and gallery. Only the
// gallery's unrelated read-only network boundary and absent browser APIs are
// supplied here; mutation callbacks are observed at their owning controls.
beforeEach(() => {
  installMatchMediaMock();
  // jsdom has no layout scrolling. This suite checks the real sheet reducer
  // and accessible descriptions, not browser scroll geometry.
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
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
        /^\/api\/characters\/character-[a-d]\/media$/.test(String(input)) &&
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
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

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
      replaceAsset: unexpectedAction,
      refreshAssets: unexpectedAction,
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
  if (!screen.queryByLabelText("Загрузить портрет для персонажа")) {
    fireEvent.click(screen.getByRole("button", { name: /^Изменить портрет:/ }));
  }
  fireEvent.change(screen.getByLabelText("Загрузить портрет для персонажа"), {
    target: { files: [file] },
  });
  return file;
}

describe("character action feedback", () => {
  it("moves initiative and reaction to a keyboard-operable vital tab", async () => {
    renderComponent(
      view(snapshot([character({ stats: { initiative: 2, reaction: 3 } })])),
    );
    await galleryLoaded();
    const tabs = screen.getByRole("tablist", {
      name: "Ключевые показатели персонажа",
    });
    const resourcesTab = within(tabs).getByRole("tab", { name: "Ресурсы" });
    const initiativeTab = within(tabs).getByRole("tab", {
      name: "Показатели",
    });
    expect(resourcesTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(resourcesTab, { key: "ArrowRight" });
    expect(initiativeTab).toHaveAttribute("aria-selected", "true");
    expect(initiativeTab).toHaveFocus();
    const panel = screen.getByRole("tabpanel", {
      name: "Показатели",
    });
    expect(
      within(panel).getByRole("spinbutton", { name: "Инициатива" }),
    ).toHaveValue(2);
    expect(
      within(panel).getByRole("spinbutton", { name: "Реакция" }),
    ).toHaveValue(3);
  });
  it("keeps regen beside resources, not among rollable combat rows", async () => {
    const update = vi.fn(async () => undefined);
    const state = snapshot([
      character({
        stats: { enduranceRegen: 3, manaRegen: 2 },
        resources: {
          physicalPower: { current: 5, maximum: 10 },
          magicPower: { current: 4, maximum: 8 },
        },
      }),
    ]);
    renderComponent(view(state, { onUpdateCounters: update }));
    await galleryLoaded();
    const vitals = screen.getByLabelText("Ключевые показатели");
    expect(
      within(vitals).getByRole("spinbutton", { name: "Реген Выносливости" }),
    ).toHaveValue(3);
    expect(
      within(vitals).getByRole("spinbutton", { name: "Реген Маны" }),
    ).toHaveValue(2);
    expect(
      screen.queryByRole("button", { name: "Реген Выносливости" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(vitals).getByRole("button", { name: "Увеличить Выносливость" }),
    );
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        state.characters[0]!.id,
        state.characters[0]!.revision,
        {
          resources: {
            ...state.characters[0]!.resources,
            physicalPower: { current: 6, maximum: 10 },
          },
        },
        expect.any(Object),
      ),
    );
  });
  it("shows custom resources in the single resources tab", async () => {
    const save = vi.fn(async () => {});
    renderComponent(
      view(
        snapshot([
          character({ resources: { Ярость: { current: 3, maximum: 5 } } }),
        ]),
        { onUpdateCounters: save },
      ),
    );
    await galleryLoaded();
    expect(
      screen.getByRole("progressbar", { name: "Уровень: Ярость" }),
    ).toHaveAttribute("aria-valuenow", "3");
    fireEvent.click(screen.getByRole("button", { name: "Настроить" }));
    const input = screen.getByRole("spinbutton", { name: "Текущее" });
    expect(input).toHaveValue(3);
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.blur(input);
    await waitFor(() => expect(save).toHaveBeenCalled());
  });
  it("shows inventory and notes in their own tab", async () => {
    renderComponent(view(snapshot()));
    await galleryLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Инвентарь" }));
    expect(screen.getByRole("tabpanel", { name: "Инвентарь" })).toBeVisible();
  });
  it("edits coins in the vital wallet and saves on blur or Enter", async () => {
    const update = vi.fn(async () => undefined);
    const state = snapshot([
      character({ wallet: { gold: 2, silver: 3, copper: 4, sp: 5 } }),
    ]);
    const rendered = renderComponent(view(state, { onUpdateCounters: update }));
    await galleryLoaded();
    const gold = screen.getByRole("spinbutton", { name: "Кошелёк: золото" });
    const silver = screen.getByRole("spinbutton", { name: "Кошелёк: серебро" });
    const copper = screen.getByRole("spinbutton", { name: "Кошелёк: медь" });
    expect(gold).toHaveValue(2);
    expect(silver).toHaveValue(3);
    expect(copper).toHaveValue(4);
    fireEvent.change(gold, { target: { value: "25" } });
    fireEvent.blur(gold);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        state.characters[0]!.id,
        state.characters[0]!.revision,
        { wallet: { gold: 25, silver: 3, copper: 4, sp: 5 } },
        undefined,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Сохраняем…")).not.toBeInTheDocument(),
    );
    const savedState = snapshot([
      character({
        revision: 8,
        wallet: { gold: 25, silver: 3, copper: 4, sp: 5 },
      }),
    ]);
    rendered.rerender(view(savedState, { onUpdateCounters: update }));
    copper.focus();
    fireEvent.change(copper, { target: { value: "-1" } });
    fireEvent.keyDown(copper, { key: "Enter" });
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        savedState.characters[0]!.id,
        savedState.characters[0]!.revision,
        { wallet: { gold: 25, silver: 3, copper: 0, sp: 5 } },
        undefined,
      ),
    );
  });

  it("explains empty players and unchanged access", async () => {
    renderComponent(view(gmSnapshot({ characters: [character()] })));
    await galleryLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Личность" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "Личность" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "Личность" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "Личность" }));
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
    fireEvent.click(
      screen.getByRole("button", { name: "Изменить портрет: Персонаж A" }),
    );
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
    fireEvent.click(first.getByRole("tab", { name: "Личность" }));
    fireEvent.click(second.getByRole("tab", { name: "Личность" }));
    const firstAccessDescription = first
      .getByRole("button", { name: "Сохранить доступ" })
      .getAttribute("aria-describedby");
    const secondAccessDescription = second
      .getByRole("button", { name: "Сохранить доступ" })
      .getAttribute("aria-describedby");
    fireEvent.click(
      first.getByRole("button", { name: "Изменить портрет: Персонаж A" }),
    );
    const firstPortrait = within(
      screen.getByRole("dialog", { name: "Портрет: Персонаж A" }),
    );
    const firstUpload = firstPortrait.getByRole("button", {
      name: "Загрузить и назначить",
    });
    const firstDescription = firstUpload.getAttribute("aria-describedby");
    const firstFile = new File(["a"], "a.png", { type: "image/png" });
    const secondFile = new File(["b"], "b.png", { type: "image/png" });
    fireEvent.change(
      firstPortrait.getByLabelText("Загрузить портрет для персонажа"),
      {
        target: { files: [firstFile] },
      },
    );
    fireEvent.click(firstUpload);
    fireEvent.click(
      firstPortrait.getByRole("button", { name: /закрыть|close/i }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Портрет: Персонаж A" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(
      second.getByRole("button", { name: "Изменить портрет: Персонаж B" }),
    );
    const secondPortrait = within(
      screen.getByRole("dialog", { name: "Портрет: Персонаж B" }),
    );
    const secondUpload = secondPortrait.getByRole("button", {
      name: "Загрузить и назначить",
    });
    const descriptions = [
      firstDescription,
      secondUpload.getAttribute("aria-describedby"),
      firstAccessDescription,
      secondAccessDescription,
    ];
    expect(descriptions.every(Boolean)).toBe(true);
    expect(new Set(descriptions).size).toBe(4);
    expect(secondUpload).toHaveAccessibleDescription(
      "Сначала выберите изображение портрета.",
    );
    expect(
      secondPortrait.getByLabelText("Загрузить портрет для персонажа"),
    ).toBeEnabled();
    fireEvent.change(
      secondPortrait.getByLabelText("Загрузить портрет для персонажа"),
      {
        target: { files: [secondFile] },
      },
    );
    expect(secondUpload).toBeEnabled();
    await act(async () => uploading.resolve(portrait));
    expect(upload).toHaveBeenCalledExactlyOnceWith(firstFile, "PORTRAIT");
    expect(patch).toHaveBeenCalledExactlyOnceWith("character-a", {
      portraitAssetId: "portrait-new",
      revision: 7,
    });
    expect(secondUpload).toBeEnabled();
    expect(
      secondPortrait.getByRole("button", { name: "Удалить b.png" }),
    ).toBeEnabled();
    expect(secondUpload).toHaveAccessibleDescription(
      "Файл выбран. Загрузите его, чтобы назначить портрет.",
    );
  });
  it("keeps a new character upload locked when the old epoch settles", async () => {
    const first = deferred<AssetDto>();
    const second = deferred<AssetDto>();
    const upload = vi
      .fn<CampaignActions["asset"]["uploadAsset"]>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const patch = vi.fn<PanelProps["onPatch"]>().mockResolvedValue(undefined);
    const commands = actions(upload);
    const rendered = renderComponent(
      view(snapshot(), { onPatch: patch }, commands),
    );
    await galleryLoaded();
    selectPortrait(new File(["a"], "a.png", { type: "image/png" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Загрузить и назначить" }),
    );
    expect(upload).toHaveBeenCalledTimes(1);

    rendered.rerender(
      view(
        snapshot([character({ id: "character-b", revision: 12 })]),
        { onPatch: patch },
        commands,
      ),
    );
    await galleryLoaded();
    expect(
      screen.getByRole("button", { name: "Загрузить и назначить" }),
    ).toHaveAttribute("aria-busy", "false");
    const file = selectPortrait(
      new File(["b"], "b.png", { type: "image/png" }),
    );
    const button = screen.getByRole("button", {
      name: "Загрузить и назначить",
    });
    act(() => {
      button.click();
      button.click();
    });
    expect(upload).toHaveBeenCalledTimes(2);
    await act(async () => first.resolve(portrait));
    expect(patch).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByLabelText("Загрузить портрет для персонажа"),
    ).toBeDisabled();
    await act(async () => second.resolve(portrait));
    expect(patch).toHaveBeenCalledExactlyOnceWith("character-b", {
      portraitAssetId: portrait.id,
      revision: 12,
    });
    expect(upload).toHaveBeenNthCalledWith(2, file, "PORTRAIT");
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button).toBeDisabled();
  });

  it("names the locked backstory and explains why resources cannot be added", async () => {
    const state = snapshot();
    const readOnly = {
      ...state,
      me: {
        ...state.me,
        id: "player-guest",
        role: "PLAYER" as const,
        characterId: null,
      },
    };
    renderComponent(view(readOnly));
    await galleryLoaded();

    fireEvent.click(screen.getByText("Предыстория", { selector: "summary" }));
    const backstory = screen.getByRole("textbox", { name: "Предыстория" });
    expect(backstory).toBeDisabled();
    expect(backstory).toHaveAccessibleDescription(
      "Редактирование доступно мастеру, владельцу листа и назначенным контроллерам.",
    );
    const resourceName = screen.getByRole("textbox", {
      name: "Название нового ресурса",
    });
    const add = screen.getByRole("button", { name: "Добавить" });
    expect(add).toBeDisabled();
    expect(resourceName).toHaveAccessibleDescription(
      "У вас нет права добавлять дополнительные ресурсы.",
    );
    expect(add).toHaveAccessibleDescription(
      "У вас нет права добавлять дополнительные ресурсы.",
    );
  });

  it("explains empty and duplicate resource names without a ready-state hint", async () => {
    renderComponent(
      view(
        snapshot([
          character({
            resources: {
              Запас: { current: 1, maximum: 2, recoverable: true },
            },
          }),
        ]),
      ),
    );
    await galleryLoaded();

    const resourceName = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Название нового ресурса",
    });
    const add = screen.getByRole("button", { name: "Добавить" });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription("Введите название ресурса.");

    fireEvent.change(resourceName, { target: { value: "Удача" } });
    expect(add).toBeEnabled();
    expect(add).not.toHaveAttribute("aria-describedby");
    expect(resourceName).not.toHaveAttribute("aria-invalid");

    fireEvent.change(resourceName, { target: { value: "Запас" } });
    expect(add).toBeDisabled();
    expect(resourceName).toHaveAttribute("aria-invalid", "true");
    expect(resourceName).toHaveAccessibleDescription(
      "Ресурс «Запас» уже существует.",
    );
    expect(add).toHaveAccessibleDescription("Ресурс «Запас» уже существует.");
  });

  it("explains the sheet limit in the rail and removes it after a sheet closes", async () => {
    const state = snapshot([
      character({ id: "character-a", name: "Персонаж A" }),
      character({ id: "character-b", name: "Персонаж B" }),
      character({ id: "character-c", name: "Персонаж C" }),
      character({ id: "character-d", name: "Персонаж D" }),
    ]);
    const workspaceProps: ComponentProps<typeof CharacterWorkspace> = {
      snapshot: state,
      onClose: unexpectedAction,
      socket: null,
      presence: [],
      onReplaceCharacterControllers: unexpectedAction,
      onPatchCharacter: unexpectedAction,
      storyPosts: [],
      storyNextCursor: null,
      onRoll: unexpectedAction,
      onCreateCharacter: unexpectedAction,
      viewedSceneId: null,
      sceneDialogRequest: 0,
      selectedTokenIds: [],
      onUpdateInitiative: unexpectedAction,
      onSetOwnInitiative: unexpectedAction,
      onRollInitiative: unexpectedAction,
      onPreviewPlayer: unexpectedAction,
      onUpdateCounters: unexpectedAction,
      onCampaignClock: vi.fn(async () => {}),
      requestedChatMessageId: null,
      onRequestedChatMessageHandled: unexpectedAction,
      onChatVisibilityChange: unexpectedAction,
      collapsed: false,
      onCollapsedChange: unexpectedAction,
      onResizeHandleDown: unexpectedAction,
      onResizeHandleMove: unexpectedAction,
      onResizeHandleUp: unexpectedAction,
      workspace: "characters",
      operatorFeedbackAllowed: false,
      onWorkspaceChange: unexpectedAction,
    };
    renderComponent(
      <ThemeProvider theme="dark" lang="ru">
        <CampaignActionsContext.Provider value={actions()}>
          <CharacterWorkspace {...workspaceProps} />
        </CampaignActionsContext.Provider>
      </ThemeProvider>,
    );
    await galleryLoaded();

    const characterNav = screen.getByRole("navigation", {
      name: "Персонажи кампании",
    });
    const navActions = characterNav.querySelector(".character-rail__actions");
    expect(navActions).toBe(characterNav.lastElementChild);
    expect(
      within(characterNav).getByRole("button", { name: "Создать персонажа" }),
    ).toBeVisible();
    expect(
      within(characterNav).getByRole("button", { name: "Архив персонажей" }),
    ).toBeVisible();
    expect(
      document.querySelector(
        ".character-workspace__header .character-workspace__create",
      ),
    ).toBeNull();

    const railToggle = screen.getByRole("button", {
      name: "Свернуть список персонажей",
    });
    expect(railToggle.closest("header")?.querySelector("button")).toBe(
      railToggle,
    );
    fireEvent.click(railToggle);
    expect(
      screen.getAllByRole("button", { name: /^Архивировать персонажа/ }),
    ).toHaveLength(1);
    expect(
      screen
        .getByRole("navigation", { name: "Персонажи кампании" })
        .querySelector(".character-rail__archive"),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Развернуть список персонажей" }),
    );
    const day = screen.getByRole("button", {
      name: `День ${state.campaign.day}`,
    });
    fireEvent.click(day);
    await waitFor(() =>
      expect(workspaceProps.onCampaignClock).toHaveBeenCalledExactlyOnceWith(
        "ADVANCE_DAY",
        state.campaign.revision,
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Следующий день" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Время кампании" }),
    ).not.toBeInTheDocument();
    const rail = screen.getByRole("navigation", {
      name: "Персонажи кампании",
    });
    fireEvent.click(
      within(rail).getByText("Персонаж B", { selector: "strong" })
        .parentElement!,
    );
    fireEvent.click(
      within(rail).getByText("Персонаж C", { selector: "strong" })
        .parentElement!,
    );
    await galleryLoaded();

    const next = within(rail).getByText("Персонаж D", {
      selector: "strong",
    }).parentElement!;
    expect(next).toBeDisabled();
    expect(next).toHaveAccessibleDescription(
      "Закройте один из открытых листов, чтобы открыть другой.",
    );
    expect(
      within(rail).getByText(
        "Закройте один из открытых листов, чтобы открыть другой.",
      ),
    ).toBeVisible();

    fireEvent.click(
      within(rail).getByRole("button", {
        name: "Закрыть лист Персонаж B",
      }),
    );
    expect(next).toBeEnabled();
    expect(next).not.toHaveAttribute("aria-describedby");
    expect(
      within(rail).queryByText(
        "Закройте один из открытых листов, чтобы открыть другой.",
      ),
    ).not.toBeInTheDocument();
  });
});
