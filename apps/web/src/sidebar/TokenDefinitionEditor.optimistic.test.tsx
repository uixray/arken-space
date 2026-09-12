// @vitest-environment jsdom
import type {
  AssetDto,
  GameSnapshot,
  SceneDto,
  TokenDto,
} from "@arken/contracts";
import { ThemeProvider } from "@gravity-ui/uikit";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetClientEventBufferForTest } from "../api";
import {
  CampaignActionsContext,
  type CampaignActions,
} from "../campaign-actions-context";
import { OptimisticTokenMutations } from "../optimistic-token-mutations";
import {
  createOptimisticTokenPlacer,
  type OptimisticTokenPlacer,
} from "../optimistic-token-placement";
import { gmSnapshot } from "../test-support/game-snapshot-fixtures";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
  userEvent,
  waitFor,
  within,
} from "../test-support/render";
import { useLatestRef } from "../use-latest-ref";
import { useMutationRunners } from "../use-mutation-runners";
import { useTokenDefinitionActions } from "../use-token-definition-actions";
import { PalettePanel, TokenDefinitionEditor } from "./TokenPalette";

// No UI, action, adapter, coordinator or API module mocks: only the network
// boundary and the browser API absent from jsdom are controlled.
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
  resetClientEventBufferForTest();
});
afterEach(() => {
  resetClientEventBufferForTest();
  vi.unstubAllGlobals();
});

const scene: SceneDto = {
  id: "30000000-0000-4000-8000-000000000001",
  name: "Сцена проверки",
  projection: "ORTHOGRAPHIC_2D",
  mapAssetId: null,
  width: 1024,
  height: 768,
  backgroundFrame: { x: 0, y: 0, width: 1024, height: 768 },
  grid: {
    enabled: true,
    size: 64,
    offsetX: 0,
    offsetY: 0,
    color: "#c8b78b",
    opacity: 0.22,
  },
  active: true,
};
const readyAsset: AssetDto = {
  id: "40000000-0000-4000-8000-000000000001",
  kind: "TOKEN",
  name: "Guard.webp",
  mimeType: "image/webp",
  sizeBytes: 100,
  width: 256,
  height: 256,
  durationSeconds: null,
  url: "/assets/guard.webp",
  createdAt: "2026-09-08T00:00:00.000Z",
};
const player = {
  id: "20000000-0000-4000-8000-000000000002",
  role: "PLAYER" as const,
  displayName: "Игрок принятия",
  characterId: null,
};
function initialSnapshot(): GameSnapshot {
  const snapshot = gmSnapshot({ scenes: [scene], assets: [readyAsset] });
  return { ...snapshot, members: [snapshot.me, player] };
}

function unusedAction(): never {
  throw new Error("Unexpected action outside create-and-place");
}

// The production palette consumes the full context contract. Only token actions
// participate in this fixture; unrelated commands fail closed, not fake success.
const unusedCampaignActions: Omit<CampaignActions, "token"> = {
  scene: {
    onViewScene: unusedAction,
    onSaveScene: unusedAction,
    onCreateScene: unusedAction,
    onActivateScene: unusedAction,
    onAssignMap: unusedAction,
    onRenameScene: unusedAction,
  },
  worldMap: {
    onCreateWorldMap: unusedAction,
    onSetWorldMapDraftBackground: unusedAction,
    onApproveWorldMapBackground: unusedAction,
    onPublishWorldMap: unusedAction,
    onArchiveWorldMap: unusedAction,
    onArchiveCharacter: unusedAction,
    onRestoreCharacter: unusedAction,
    onLoadArchivedCharacters: unusedAction,
    onCreateWorldMapLocation: unusedAction,
    onUpdateWorldMapLocation: unusedAction,
    onLinkWorldMapLocationScene: unusedAction,
    onUnlinkWorldMapLocationScene: unusedAction,
    onSetWorldMapPartyPosition: unusedAction,
    onClearWorldMapPartyPosition: unusedAction,
  },
  chat: {
    onChat: unusedAction,
    onSticker: unusedAction,
    onCreateDirectThread: unusedAction,
    onDirectChat: unusedAction,
    onUploadChatAttachment: unusedAction,
    onActiveChatThreadChange: unusedAction,
    onMarkChatRead: unusedAction,
  },
  access: {
    onCreateInvite: unusedAction,
    onListPlayerAccess: unusedAction,
    onRotatePlayerAccess: unusedAction,
    onRevokePlayerAccess: unusedAction,
    onRenameMembership: unusedAction,
  },
  catalog: {
    onCreateCatalogEntry: unusedAction,
    onUpdateCatalogEntry: unusedAction,
    onDeleteCatalogEntry: unusedAction,
    onAssignCatalogEntry: unusedAction,
    onUpdateCharacterEntry: unusedAction,
    onDeleteCharacterEntry: unusedAction,
    onRollEntry: unusedAction,
    onRechargeEntry: unusedAction,
  },
  story: {
    onLoadMoreStoryPosts: unusedAction,
    onCreateStoryDraft: unusedAction,
    onUpdateStoryPost: unusedAction,
    onPublishStoryPost: unusedAction,
    onArchiveStoryPost: unusedAction,
  },
  playerRequest: {
    onOpenPlayerRequestCreate: unusedAction,
    onCreatePlayerRequest: unusedAction,
    onUpdatePlayerRequest: unusedAction,
    onPlayerRequestAction: unusedAction,
  },
  asset: {
    uploadAsset: unusedAction,
    getAssetUsage: unusedAction,
    deleteAsset: unusedAction,
    generateTokenImage: unusedAction,
  },
  statLayout: { onUpdateStatLayout: unusedAction },
  chatHistory: { onLoadThreadHistory: unusedAction },
};

/** Real production chain; state plumbing replaces only App's surrounding shell. */
function Harness({
  onClose,
  sessionId = "campaign-under-test",
  initialError = "",
  palette = false,
}: {
  onClose: () => void;
  sessionId?: string;
  initialError?: string;
  palette?: boolean;
}) {
  const [storedSnapshot, setSnapshot] = useState(initialSnapshot);
  const snapshot = useMemo(
    () => ({
      ...storedSnapshot,
      campaign: { ...storedSnapshot.campaign, id: sessionId },
    }),
    [storedSnapshot, sessionId],
  );
  const [editorOpen, setEditorOpen] = useState(true);
  const [sharedError, setSharedError] = useState(initialError);
  const snapshotRef = useLatestRef<GameSnapshot | null>(snapshot);
  const [tokenMutations] = useState(
    // Like App, the constructor stores these callbacks without reading refs.
    // eslint-disable-next-line react-hooks/refs
    () =>
      new OptimisticTokenMutations({
        readToken: (id) =>
          snapshotRef.current?.tokens.find((token) => token.id === id),
        acceptToken: (updated) =>
          setSnapshot((current) => {
            if (!current.scenes.some((item) => item.id === updated.sceneId))
              return current;
            const existing = current.tokens.find(
              (token) => token.id === updated.id,
            );
            if (existing && existing.revision > updated.revision)
              return current;
            return {
              ...current,
              tokens: existing
                ? current.tokens.map((token) =>
                    token.id === updated.id ? updated : token,
                  )
                : [...current.tokens, updated],
            };
          }),
        sendConditions: unusedAction,
        reloadToken: unusedAction,
        onError: (reason) =>
          setSharedError(
            reason instanceof Error ? reason.message : "Операция не выполнена",
          ),
      }),
  );
  useSyncExternalStore(tokenMutations.subscribe, tokenMutations.getVersion);
  useEffect(() => {
    tokenMutations.reset();
    return () => tokenMutations.reset();
  }, [tokenMutations, snapshot.campaign.id, snapshot.me.id]);
  const placeOptimistically = useCallback<OptimisticTokenPlacer>(
    (request, options) =>
      createOptimisticTokenPlacer({
        readSnapshot: () => snapshotRef.current,
        tokenMutations,
        clearError: () => setSharedError(""),
      })(request, options),
    [snapshotRef, tokenMutations],
  );
  const activeSceneRef = useLatestRef(
    snapshot.scenes.find((item) => item.active),
  );
  const load = useCallback(async () => {}, []);
  const { run } = useMutationRunners({ load, setError: setSharedError });
  const actions = useTokenDefinitionActions({
    run,
    snapshotRef,
    activeSceneRef,
    placeOptimistically,
  });
  const campaignActions = useMemo(
    () => ({ ...unusedCampaignActions, token: actions }),
    [actions],
  );

  return (
    <>
      <output data-testid="projected-tokens">
        {JSON.stringify(tokenMutations.project(snapshot.tokens))}
      </output>
      <output data-testid="shared-error">{sharedError}</output>
      {palette ? (
        <CampaignActionsContext.Provider value={campaignActions}>
          <PalettePanel
            snapshot={snapshot}
            socket={null}
            presence={[]}
            onReplaceCharacterControllers={unusedAction}
            onPatchCharacter={unusedAction}
            storyPosts={[]}
            storyNextCursor={null}
            onRoll={unusedAction}
            onCreateCharacter={unusedAction}
            viewedSceneId={scene.id}
            sceneDialogRequest={0}
            selectedTokenIds={[]}
            onUpdateInitiative={unusedAction}
            onSetOwnInitiative={unusedAction}
            onRollInitiative={unusedAction}
            onPreviewPlayer={unusedAction}
            onUpdateCounters={unusedAction}
            onCampaignClock={unusedAction}
            requestedChatMessageId={null}
            onRequestedChatMessageHandled={unusedAction}
            onChatVisibilityChange={unusedAction}
            collapsed={false}
            onCollapsedChange={unusedAction}
            onResizeHandleDown={unusedAction}
            onResizeHandleMove={unusedAction}
            onResizeHandleUp={unusedAction}
            workspace="tokens"
            operatorFeedbackAllowed={false}
            onWorkspaceChange={unusedAction}
          />
        </CampaignActionsContext.Provider>
      ) : (
        editorOpen && (
          <TokenDefinitionEditor
            key={sessionId}
            snapshot={snapshot}
            onUpload={unusedAction}
            onGenerateTokenImage={unusedAction}
            onCancel={() => {
              setEditorOpen(false);
              onClose();
            }}
            onCreate={actions.onCreateTokenDefinition}
            onCreateAndPlace={actions.onCreateAndPlaceTokenDefinition}
            onPatch={actions.onPatchTokenDefinition}
            onReplaceControllers={actions.onReplaceTokenControllers}
            onOpenCharacters={unusedAction}
            onOpenMedia={unusedAction}
          />
        )
      )}
    </>
  );
}

function projectedTokens(): TokenDto[] {
  return JSON.parse(screen.getByTestId("projected-tokens").textContent ?? "[]");
}

function networkBoundary() {
  const tokenRequests: Record<string, unknown>[] = [];
  const responses: ((response: Response) => void)[] = [];
  const telemetryRequests: string[] = [];
  const unexpectedRequests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/tokens" && init?.method === "POST") {
        tokenRequests.push(JSON.parse(String(init.body)));
        return new Promise<Response>((resolve) => {
          responses.push(resolve);
        });
      }
      if (path === "/api/client-logs" && init?.method === "POST") {
        telemetryRequests.push(path);
        return Promise.resolve(new Response(null, { status: 202 }));
      }
      unexpectedRequests.push(`${init?.method ?? "GET"} ${path}`);
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  return {
    tokenRequests,
    telemetryRequests,
    unexpectedRequests,
    async complete(index: number, status: 201 | 403) {
      const request = tokenRequests[index];
      expect(request).toBeDefined();
      await act(async () => {
        responses[index]!(
          new Response(
            JSON.stringify(
              status === 403
                ? { error: "FORBIDDEN", message: "Сцена недоступна" }
                : {
                    id: request!.placementId,
                    definitionId: `definition-${index}`,
                    revision: 1,
                  },
            ),
            { status, headers: { "Content-Type": "application/json" } },
          ),
        );
      });
    },
  };
}

it("keeps the real editor and all input after delayed optimistic create-and-place rejection", async () => {
  const network = networkBoundary();
  const { tokenRequests, telemetryRequests, unexpectedRequests } = network;
  const onClose = vi.fn();
  renderComponent(
    <ThemeProvider theme="dark" lang="ru">
      <Harness onClose={onClose} />
    </ThemeProvider>,
  );
  const user = userEvent.setup();
  const editor = within(screen.getByRole("dialog", { name: "Новый токен" }));
  await user.type(editor.getByLabelText("Название"), "Страж проверки");
  await user.click(editor.getByRole("button", { name: readyAsset.name }));
  fireEvent.change(editor.getByLabelText("Ширина, клетки"), {
    target: { value: "2" },
  });
  await user.click(
    editor.getByRole("checkbox", { name: "Сохранять пропорции" }),
  );
  fireEvent.change(editor.getByLabelText("Высота, клетки"), {
    target: { value: "1" },
  });
  await user.click(editor.getByRole("checkbox", { name: player.displayName }));
  await user.click(editor.getByRole("button", { name: "Создать и поставить" }));

  await waitFor(() => expect(tokenRequests).toHaveLength(1));
  expect(tokenRequests[0]).toMatchObject({
    sceneId: scene.id,
    characterId: null,
    assetId: readyAsset.id,
    name: "Страж проверки",
    x: 448,
    y: 352,
    width: 128,
    height: 64,
    controllerMembershipIds: [player.id],
  });
  expect(tokenRequests[0]?.placementId).toBe(tokenRequests[0]?.actionId);
  // The real coordinator paints before HTTP settles, even in the failing baseline.
  expect(projectedTokens()).toEqual([
    expect.objectContaining({
      id: `pending:${tokenRequests[0]?.actionId}`,
      assetId: readyAsset.id,
      width: 128,
      height: 64,
      controllerMembershipIds: [player.id],
    }),
  ]);

  await network.complete(0, 403);
  await waitFor(() => expect(projectedTokens()).toEqual([]));
  await waitFor(() => expect(telemetryRequests).toEqual(["/api/client-logs"]));
  expect(unexpectedRequests).toEqual([]);
  // The pre-fix baseline failed here after real API failure and rollback,
  // not on a direct rejecting onCreateAndPlace callback. Keep this oracle.
  const retainedEditor = within(
    screen.getByRole("dialog", { name: "Новый токен" }),
  );
  expect(retainedEditor.getByText("Сцена недоступна")).toBeVisible();
  expect(retainedEditor.getByLabelText("Название")).toHaveValue(
    "Страж проверки",
  );
  expect(retainedEditor.getByLabelText("Ширина, клетки")).toHaveValue(2);
  expect(retainedEditor.getByLabelText("Высота, клетки")).toHaveValue(1);
  expect(
    retainedEditor.getByRole("checkbox", { name: "Сохранять пропорции" }),
  ).not.toBeChecked();
  expect(
    retainedEditor.getByRole("button", { name: readyAsset.name }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    retainedEditor.getByRole("checkbox", { name: player.displayName }),
  ).toBeChecked();
  expect(
    retainedEditor.getByRole("button", { name: "Создать и поставить" }),
  ).toBeEnabled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByTestId("shared-error")).toBeEmptyDOMElement();
  expect(tokenRequests).toHaveLength(1);

  await user.click(
    retainedEditor.getByRole("button", { name: "Создать и поставить" }),
  );
  await waitFor(() => expect(tokenRequests).toHaveLength(2));
  expect(tokenRequests[1]).toMatchObject({
    sceneId: scene.id,
    assetId: readyAsset.id,
    name: "Страж проверки",
    width: 128,
    height: 64,
    controllerMembershipIds: [player.id],
  });
  expect(tokenRequests[1]?.actionId).not.toBe(tokenRequests[0]?.actionId);
  expect(tokenRequests[1]?.placementId).toBe(tokenRequests[1]?.actionId);
  expect(onClose).not.toHaveBeenCalled();
  expect(projectedTokens()).toEqual([
    expect.objectContaining({ id: `pending:${tokenRequests[1]?.actionId}` }),
  ]);
  await network.complete(1, 201);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(
    screen.queryByRole("dialog", { name: "Новый токен" }),
  ).not.toBeInTheDocument();
  expect(projectedTokens()).toEqual([
    expect.objectContaining({ id: tokenRequests[1]?.placementId, revision: 1 }),
  ]);
  expect(unexpectedRequests).toEqual([]);
});

it("waits for real HTTP success before closing, keeping unrelated shared errors intact", async () => {
  const network = networkBoundary();
  const onClose = vi.fn();
  renderComponent(
    <ThemeProvider theme="dark" lang="ru">
      <Harness onClose={onClose} initialError="Другая ошибка" />
    </ThemeProvider>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Название"), "Страж подтверждения");
  await user.click(screen.getByRole("button", { name: readyAsset.name }));
  await user.click(screen.getByRole("button", { name: "Создать и поставить" }));
  await waitFor(() => expect(network.tokenRequests).toHaveLength(1));
  expect(screen.getByRole("dialog", { name: "Новый токен" })).toBeVisible();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByTestId("shared-error")).toHaveTextContent("Другая ошибка");
  expect(projectedTokens()).toEqual([
    expect.objectContaining({
      id: `pending:${network.tokenRequests[0]?.actionId}`,
    }),
  ]);
  await network.complete(0, 201);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(
    screen.queryByRole("dialog", { name: "Новый токен" }),
  ).not.toBeInTheDocument();
  expect(projectedTokens()).toEqual([
    expect.objectContaining({ id: network.tokenRequests[0]?.placementId }),
  ]);
  expect(screen.getByTestId("shared-error")).toHaveTextContent("Другая ошибка");
  expect(network.telemetryRequests).toEqual([]);
  expect(network.unexpectedRequests).toEqual([]);
});

it("keeps reopened PalettePanel editor B after header-close of pending A and A's late HTTP success", async () => {
  const network = networkBoundary();
  renderComponent(
    <ThemeProvider theme="dark" lang="ru">
      <Harness onClose={unusedAction} palette />
    </ThemeProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Создать токен" }));
  const firstEditor = within(
    screen.getByRole("dialog", { name: "Новый токен" }),
  );
  await user.type(firstEditor.getByLabelText("Название"), "Токен A");
  await user.click(firstEditor.getByRole("button", { name: readyAsset.name }));
  await user.click(
    firstEditor.getByRole("button", { name: "Создать и поставить" }),
  );
  await waitFor(() => expect(network.tokenRequests).toHaveLength(1));
  expect(network.tokenRequests[0]).toMatchObject({
    name: "Токен A",
    assetId: readyAsset.id,
  });
  expect(projectedTokens()).toEqual([
    expect.objectContaining({
      id: `pending:${network.tokenRequests[0]?.actionId}`,
    }),
  ]);

  // Real Gravity header close stays available while the submit request is held.
  await user.click(
    firstEditor.getByRole("button", { name: "Закрыть диалоговое окно" }),
  );
  expect(
    screen.queryByRole("dialog", { name: "Новый токен" }),
  ).not.toBeInTheDocument();
  expect(projectedTokens()).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Создать токен" }));
  await user.type(screen.getByLabelText("Название"), "Несохранённый токен B");
  await user.click(screen.getByRole("button", { name: readyAsset.name }));
  expect(screen.getByLabelText("Название")).toHaveValue(
    "Несохранённый токен B",
  );

  await network.complete(0, 201);
  expect(projectedTokens()).toEqual([
    expect.objectContaining({
      id: network.tokenRequests[0]?.placementId,
      name: "Токен A",
    }),
  ]);
  // The pre-fix baseline failed here: A's old onCancel closed B through the shared setter.
  const retainedEditor = within(
    screen.getByRole("dialog", { name: "Новый токен" }),
  );
  expect(retainedEditor.getByLabelText("Название")).toHaveValue(
    "Несохранённый токен B",
  );
  expect(
    retainedEditor.getByRole("button", { name: readyAsset.name }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    retainedEditor.getByRole("button", { name: "Создать и поставить" }),
  ).toBeEnabled();
  expect(network.tokenRequests).toHaveLength(1);
  expect(network.telemetryRequests).toEqual([]);
  expect(network.unexpectedRequests).toEqual([]);
});

it("keeps reopened PalettePanel editor B clean after Escape from pending A and A's late HTTP refusal", async () => {
  const network = networkBoundary();
  renderComponent(
    <ThemeProvider theme="dark" lang="ru">
      <Harness onClose={unusedAction} palette />
    </ThemeProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Создать токен" }));
  await user.type(screen.getByLabelText("Название"), "Токен A с отказом");
  await user.click(screen.getByRole("button", { name: "Создать и поставить" }));
  await waitFor(() => expect(network.tokenRequests).toHaveLength(1));
  expect(projectedTokens()).toHaveLength(1);
  // Closing is still permitted; this does not cancel the transaction already sent.
  await user.keyboard("{Escape}");
  expect(
    screen.queryByRole("dialog", { name: "Новый токен" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Создать токен" }));
  await user.type(screen.getByLabelText("Название"), "Сохранить черновик B");
  await network.complete(0, 403);
  await waitFor(() => expect(projectedTokens()).toEqual([]));
  const retainedEditor = within(
    screen.getByRole("dialog", { name: "Новый токен" }),
  );
  expect(retainedEditor.getByLabelText("Название")).toHaveValue(
    "Сохранить черновик B",
  );
  expect(
    retainedEditor.queryByText("Сцена недоступна"),
  ).not.toBeInTheDocument();
  expect(
    retainedEditor.getByRole("button", { name: "Создать и поставить" }),
  ).toBeEnabled();
  expect(screen.getByTestId("shared-error")).toBeEmptyDOMElement();
  expect(network.telemetryRequests).toEqual(["/api/client-logs"]);
  expect(network.tokenRequests).toHaveLength(1);
  expect(network.unexpectedRequests).toEqual([]);
  await user.click(retainedEditor.getByRole("button", { name: "Отмена" }));
  expect(
    screen.queryByRole("dialog", { name: "Новый токен" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Создать токен" })).toBeEnabled();
});

it.each([201, 403] as const)(
  "does not close the new session's editor or accept stale HTTP %s after reset",
  async (status) => {
    const network = networkBoundary();
    const onClose = vi.fn();
    const view = (sessionId: string) => (
      <ThemeProvider theme="dark" lang="ru">
        <Harness onClose={onClose} sessionId={sessionId} />
      </ThemeProvider>
    );
    const { rerender } = renderComponent(view("old-session"));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Название"), "Старый токен");
    await user.click(
      screen.getByRole("button", { name: "Создать и поставить" }),
    );
    await waitFor(() => expect(network.tokenRequests).toHaveLength(1));
    expect(projectedTokens()).toHaveLength(1);

    // Same coordinator, new campaign identity + editor key, like App's session boundary.
    rerender(view("new-session"));
    expect(projectedTokens()).toEqual([]);
    expect(screen.getByLabelText("Название")).toHaveValue("");
    await user.type(screen.getByLabelText("Название"), "Новый токен сессии");
    await user.click(
      screen.getByRole("button", { name: "Создать и поставить" }),
    );
    await waitFor(() => expect(network.tokenRequests).toHaveLength(2));
    await network.complete(0, status);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Новый токен" })).toBeVisible();
    expect(screen.getByLabelText("Название")).toHaveValue("Новый токен сессии");
    expect(screen.queryByText("Сцена недоступна")).not.toBeInTheDocument();
    expect(screen.getByTestId("shared-error")).toBeEmptyDOMElement();
    expect(projectedTokens()).toEqual([
      expect.objectContaining({
        id: `pending:${network.tokenRequests[1]?.actionId}`,
      }),
    ]);
    await network.complete(1, 201);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(projectedTokens()).toEqual([
      expect.objectContaining({ id: network.tokenRequests[1]?.placementId }),
    ]);
    expect(network.unexpectedRequests).toEqual([]);
  },
);

it.each(["not-ready", "paused", "missing-scene"] as const)(
  "returns skipped %s without a write or clearing an unrelated shared error",
  async (reason) => {
    const network = networkBoundary();
    const snapshot = initialSnapshot();
    if (reason === "paused") snapshot.campaign.paused = true;
    if (reason === "missing-scene") snapshot.scenes = [];
    const clearError = vi.fn();
    const onError = vi.fn();
    const tokenMutations = new OptimisticTokenMutations({
      readToken: () => undefined,
      acceptToken: unusedAction,
      sendConditions: unusedAction,
      reloadToken: unusedAction,
      onError,
    });
    const place = createOptimisticTokenPlacer({
      readSnapshot: () => (reason === "not-ready" ? null : snapshot),
      tokenMutations,
      clearError,
    });
    await expect(
      place(
        {
          path: "/api/tokens",
          body: { sceneId: scene.id, actionId: crypto.randomUUID() },
        },
        { errorOwner: "caller" },
      ),
    ).resolves.toEqual({ status: "skipped", reason });
    expect(tokenMutations.project([])).toEqual([]);
    expect(clearError).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(network.tokenRequests).toEqual([]);
    expect(network.telemetryRequests).toEqual([]);
    expect(network.unexpectedRequests).toEqual([]);
  },
);
