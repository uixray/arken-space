// @vitest-environment jsdom
import {
  useCallback,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import type { ButtonButtonProps } from "@gravity-ui/uikit";
import type { AssetDto, GameSnapshot, SceneDto } from "@arken/contracts";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  flushClientEventBuffer,
  resetClientEventBufferForTest,
} from "../api";
import { useAssetActions } from "../use-asset-actions";
import { useLatestRef } from "../use-latest-ref";
import { useMutationRunners } from "../use-mutation-runners";
import { useTokenDefinitionActions } from "../use-token-definition-actions";
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

// Isolate toolkit/dialog chrome only. TokenDefinitionEditor, its state and
// upload/generation actions, TokenImageGenerator, ImageUploadField and
// AssetPicker are the production implementations. In particular the source
// select, transform state and preview are never mocked or controlled by a test.
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    children,
    type,
    name,
    value,
    onClick,
    disabled,
    loading,
    "aria-label": ariaLabel,
  }: ButtonButtonProps) => (
    <button
      type={type ?? "button"}
      name={name}
      value={value}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
  Icon: () => <span aria-hidden="true" />,
}));
vi.mock("../ui/ArkenDialog", () => ({
  ArkenDialog: ({
    children,
    title,
  }: {
    children: ReactNode;
    title: string;
  }) => (
    <section role="dialog" aria-label={title}>
      {children}
    </section>
  ),
}));
vi.mock("../ui/GravityFormControls", () => ({
  FormInput: (props: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  FormSelect: ({
    children,
    emptyMessage: _emptyMessage,
    createAction: _createAction,
    ...props
  }: SelectHTMLAttributes<HTMLSelectElement> & {
    emptyMessage?: string;
    createAction?: unknown;
  }) => <select {...props}>{children}</select>,
}));

const { TokenDefinitionEditor } = await import("./TokenPalette");

const sourceA: AssetDto = {
  id: "source-a",
  kind: "IMAGE",
  name: "Old Landscape.png",
  mimeType: "image/png",
  sizeBytes: 100,
  width: 1200,
  height: 800,
  durationSeconds: null,
  url: "/api/assets/source-a/content",
  createdAt: "2026-09-08T00:00:00.000Z",
};
const sourceB: AssetDto = {
  ...sourceA,
  id: "source-b",
  name: "New Portrait.png",
  width: 800,
  height: 1200,
  url: "/api/assets/source-b/content",
};
const generated: AssetDto = {
  ...sourceB,
  id: "generated-token",
  kind: "TOKEN",
  name: "New Portrait token.webp",
  mimeType: "image/webp",
  width: 512,
  height: 512,
  url: "/api/assets/generated-token/content",
};
const ready: AssetDto = {
  ...generated,
  id: "ready-token",
  name: "Existing ready token",
  url: "/api/assets/ready-token/content",
};

const objectUrlDescriptors = {
  createObjectURL: Object.getOwnPropertyDescriptor(URL, "createObjectURL"),
  revokeObjectURL: Object.getOwnPropertyDescriptor(URL, "revokeObjectURL"),
};
beforeEach(() => {
  resetClientEventBufferForTest();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:synthetic-source-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(async () => {
  // Always unmount ImageUploadField before restoring its object-URL boundary,
  // including when the intended source-selection baseline assertion fails.
  cleanup();
  await flushClientEventBuffer();
  resetClientEventBufferForTest();
  vi.unstubAllGlobals();
  for (const key of ["createObjectURL", "revokeObjectURL"] as const) {
    const original = objectUrlDescriptors[key];
    if (original) Object.defineProperty(URL, key, original);
    else Reflect.deleteProperty(URL, key);
  }
});

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const activeScene: SceneDto = {
  id: "negative-control-scene",
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
const uploadRefused = "Сервер отклонил загрузку исходника.";
const generationRefused = "Сервер отклонил создание изображения токена.";

function setupNegativeControl(failure?: "upload" | "generation") {
  let serverAssets = [sourceB, ready];
  const requests: Array<{ path: string; method: string; body?: unknown }> = [];
  const unexpectedRequests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method ?? "GET";
      requests.push({ path, method, body: init?.body });
      if (path === "/api/assets?kind=IMAGE" && method === "POST") {
        if (failure === "upload")
          return jsonResponse(
            { error: "UPLOAD_REJECTED", message: uploadRefused },
            403,
          );
        serverAssets = [sourceA, ...serverAssets];
        return jsonResponse(sourceA, 201);
      }
      if (path === "/api/bootstrap" && method === "GET")
        return jsonResponse(
          gmSnapshot({ scenes: [activeScene], assets: serverAssets }),
        );
      if (
        (path === "/api/assets/source-a/token" ||
          path === "/api/assets/source-b/token") &&
        method === "POST"
      ) {
        if (failure === "generation")
          return jsonResponse(
            { error: "TOKEN_GENERATION_REJECTED", message: generationRefused },
            422,
          );
        serverAssets = [
          generated,
          ...serverAssets.filter((asset) => asset.id !== generated.id),
        ];
        return jsonResponse(generated, 201);
      }
      // Both success and refusal controls use the real creation API boundary.
      if (
        method === "POST" &&
        (path === "/api/token-definitions" || path === "/api/tokens")
      )
        return jsonResponse({ id: "created-token" }, 201);
      // Real api() reports an upload refusal; this is not a creation request.
      if (path === "/api/client-logs" && method === "POST")
        return jsonResponse({ accepted: true }, 202);
      unexpectedRequests.push(`${method} ${path}`);
      throw new Error(`Unexpected negative-control request: ${method} ${path}`);
    }),
  );

  function Harness() {
    const [snapshot, setSnapshot] = useState(() =>
      gmSnapshot({ scenes: [activeScene], assets: [sourceB, ready] }),
    );
    const [open, setOpen] = useState(true);
    const [sharedError, setSharedError] = useState("");
    const load = useCallback(async () => {
      setSnapshot(await api<GameSnapshot>("/api/bootstrap"));
    }, []);
    const assets = useAssetActions({ load });
    const { run } = useMutationRunners({ load, setError: setSharedError });
    const actions = useTokenDefinitionActions({
      run,
      snapshotRef: useLatestRef(snapshot),
      activeSceneRef: useLatestRef(
        snapshot.scenes.find((scene) => scene.active),
      ),
    });
    return (
      <>
        {sharedError && <div role="alert">{sharedError}</div>}
        {open ? (
          <TokenDefinitionEditor
            snapshot={snapshot}
            onUpload={assets.uploadAsset}
            onGenerateTokenImage={assets.generateTokenImage}
            onCreate={actions.onCreateTokenDefinition}
            onCreateAndPlace={actions.onCreateAndPlaceTokenDefinition}
            onCancel={() => setOpen(false)}
            onPatch={actions.onPatchTokenDefinition}
            onReplaceControllers={actions.onReplaceTokenControllers}
            onOpenCharacters={vi.fn()}
            onOpenMedia={vi.fn()}
          />
        ) : (
          <p role="status">Редактор закрыт</p>
        )}
      </>
    );
  }
  renderComponent(<Harness />);

  return {
    requests,
    async uploadLandscape() {
      await userEvent.type(
        screen.getByLabelText("Название"),
        "Страж исходника",
      );
      expect(
        screen.getByRole("button", { name: "Создать и поставить" }),
      ).toBeEnabled();
      const file = new File(
        ["synthetic landscape boundary bytes"],
        sourceA.name,
        {
          type: "image/png",
        },
      );
      await userEvent.upload(
        screen.getByLabelText("Загрузить новое изображение"),
        file,
      );
      await waitFor(() =>
        expect(
          requests.filter(
            (request) => request.path === "/api/assets?kind=IMAGE",
          ),
        ).toHaveLength(1),
      );
      const upload = requests.find(
        (request) => request.path === "/api/assets?kind=IMAGE",
      );
      if (!upload) throw new Error("Expected the landscape upload request");
      expect((upload.body as FormData).get("file")).toBe(file);
    },
    expectNoCreation() {
      for (const path of ["/api/token-definitions", "/api/tokens"])
        expect(
          requests.filter(
            (request) => request.method === "POST" && request.path === path,
          ),
        ).toEqual([]);
      expect(unexpectedRequests).toEqual([]);
    },
  };
}

async function expectUploadedLandscape() {
  await waitFor(() =>
    expect(screen.getByLabelText("Исходное изображение")).toHaveValue(
      sourceA.id,
    ),
  );
  const { width, height } = sourceA;
  if (width === null || height === null)
    throw new Error("Landscape fixture must declare width and height");
  expect(width).toBeGreaterThan(height);
  const preview = screen.getByRole("group", {
    name: /^Интерактивный предпросмотр токена/,
  });
  expect(preview.querySelector("img")).toHaveAttribute("src", sourceA.url);
  const picker = screen.getByRole("group", {
    name: "Изображение токена из файлов",
  });
  expect(
    within(picker).getByRole("button", { name: "Без изображения" }),
  ).toHaveAttribute("aria-pressed", "false");
}

async function attemptRefusedSubmit(name: string, message: string) {
  const submit = screen.getByRole("button", { name });
  await waitFor(() => expect(submit).toBeEnabled());
  await userEvent.click(submit);
  expect(await screen.findByText(message)).toBeInTheDocument();
  await waitFor(() => expect(submit).toBeEnabled());
  expect(screen.getByLabelText("Название")).toHaveValue("Страж исходника");
  expect(screen.queryByText("Редактор закрыт")).not.toBeInTheDocument();
}

describe("UIX-611 real-chain single-confirm creation controls", () => {
  const submitIntents = ["Сохранить", "Создать и поставить"];

  it.each(submitIntents)(
    "derives an uploaded landscape IMAGE and creates via one %s",
    async (submitName) => {
      const control = setupNegativeControl();
      await control.uploadLandscape();
      await expectUploadedLandscape();
      expect(
        screen.queryByRole("button", { name: "Создать изображение токена" }),
      ).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: submitName }));
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Редактор закрыт",
      );
      const creationPath =
        submitName === "Сохранить" ? "/api/token-definitions" : "/api/tokens";
      expect(
        control.requests.map(({ method, path }) => `${method} ${path}`),
      ).toEqual([
        "POST /api/assets?kind=IMAGE",
        "GET /api/bootstrap",
        "POST /api/assets/source-a/token",
        "GET /api/bootstrap",
        `POST ${creationPath}`,
        "GET /api/bootstrap",
      ]);
      const creation = control.requests.find(
        (request) => request.path === creationPath,
      );
      const body = JSON.parse(String(creation?.body));
      expect(
        body[submitName === "Сохранить" ? "defaultAssetId" : "assetId"],
      ).toBe(generated.id);
    },
  );

  it.each(submitIntents)(
    "observes a real HTTP upload refusal before refusing submit via %s",
    async (submitName) => {
      const control = setupNegativeControl("upload");
      await control.uploadLandscape();
      expect(await screen.findByText(uploadRefused)).toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: sourceA.name }),
      ).not.toBeInTheDocument();
      await attemptRefusedSubmit(submitName, uploadRefused);
      expect(
        control.requests.some((request) => request.path === "/api/bootstrap"),
      ).toBe(false);
      control.expectNoCreation();
    },
  );

  it.each(submitIntents)(
    "observes the actual generator's HTTP refusal before refusing submit via %s",
    async (submitName) => {
      const control = setupNegativeControl("generation");
      await control.uploadLandscape();
      await expectUploadedLandscape();
      await attemptRefusedSubmit(submitName, generationRefused);
      expect(
        control.requests.filter(
          (request) => request.path === "/api/assets/source-a/token",
        ),
      ).toHaveLength(1);
      expect(
        screen.queryByRole("button", { name: generated.name }),
      ).not.toBeInTheDocument();
      control.expectNoCreation();
    },
  );

  it("derives a newly selected IMAGE instead of retaining the previously selected ready TOKEN", async () => {
    const control = setupNegativeControl();
    expect(screen.getByLabelText("Исходное изображение")).toHaveValue("");
    await userEvent.type(screen.getByLabelText("Название"), "Новый исходник");
    const picker = screen.getByRole("group", {
      name: "Изображение токена из файлов",
    });
    await userEvent.click(
      within(picker).getByRole("button", { name: ready.name }),
    );
    expect(
      within(picker).getByRole("button", { name: ready.name }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.selectOptions(
      screen.getByLabelText("Исходное изображение"),
      sourceB.id,
    );
    expect(
      within(picker).getByRole("button", { name: ready.name }),
    ).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Редактор закрыт",
    );
    expect(
      control.requests.map(({ method, path }) => `${method} ${path}`),
    ).toEqual([
      "POST /api/assets/source-b/token",
      "GET /api/bootstrap",
      "POST /api/token-definitions",
      "GET /api/bootstrap",
    ]);
    const creation = control.requests.find(
      (request) => request.path === "/api/token-definitions",
    );
    expect(JSON.parse(String(creation?.body)).defaultAssetId).toBe(
      generated.id,
    );
  });

  it("cancels the uploaded-source draft before submit without creating a definition or placement", async () => {
    const control = setupNegativeControl();
    await control.uploadLandscape();
    await expectUploadedLandscape();
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Редактор закрыт",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      control.requests.map(({ method, path }) => `${method} ${path}`),
    ).toEqual(["POST /api/assets?kind=IMAGE", "GET /api/bootstrap"]);
    control.expectNoCreation();
  });
});

describe("UIX-589 atomic definition edit recovery", () => {
  it("replays a committed PATCH after refresh failure, while a changed failed edit gets a new id", async () => {
    const definition = {
      id: "definition-under-edit",
      name: "Старый страж",
      ownName: "Старый страж",
      characterId: null,
      defaultAssetId: ready.id,
      defaultWidth: 64,
      defaultHeight: 64,
      controllerMembershipIds: [],
      revision: 7,
    };
    const requests: Array<{ path: string; method: string; body?: unknown }> =
      [];
    let patchAttempts = 0;
    let bootstrapAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const method = init?.method ?? "GET";
        if (
          path === `/api/token-definitions/${definition.id}` &&
          method === "PATCH"
        ) {
          requests.push({ path, method, body: JSON.parse(String(init?.body)) });
          patchAttempts += 1;
          if (patchAttempts === 1)
            return jsonResponse(
              { error: "PATCH_REJECTED", message: "PATCH отклонён" },
              503,
            );
          // Attempt two commits; the same-key retry receives the real replay shape.
          return jsonResponse(
            patchAttempts === 2
              ? { ...definition, revision: 8 }
              : { duplicate: true },
          );
        }
        if (path === "/api/bootstrap" && method === "GET") {
          requests.push({ path, method });
          bootstrapAttempts += 1;
          if (bootstrapAttempts === 1)
            return jsonResponse(
              { error: "BOOTSTRAP_FAILED", message: "Снимок недоступен" },
              503,
            );
          return jsonResponse(
            gmSnapshot({
              scenes: [activeScene],
              assets: [ready],
              tokenDefinitions: [{ ...definition, revision: 8 }],
            }),
          );
        }
        if (path === "/api/client-logs" && method === "POST")
          return jsonResponse({ accepted: true }, 202);
        throw new Error(`Unexpected edit recovery request: ${method} ${path}`);
      }),
    );

    function Harness() {
      const [snapshot, setSnapshot] = useState(() =>
        gmSnapshot({
          scenes: [activeScene],
          assets: [ready],
          tokenDefinitions: [definition],
        }),
      );
      const [open, setOpen] = useState(true);
      const [sharedError, setSharedError] = useState("");
      const load = useCallback(async () => {
        setSnapshot(await api<GameSnapshot>("/api/bootstrap"));
      }, []);
      const { run } = useMutationRunners({ load, setError: setSharedError });
      const actions = useTokenDefinitionActions({
        run,
        snapshotRef: useLatestRef(snapshot),
        activeSceneRef: useLatestRef(activeScene),
      });
      return (
        <>
          <output data-testid="edit-shared-error">{sharedError}</output>
          {open ? (
            <TokenDefinitionEditor
              snapshot={snapshot}
              definition={definition}
              onUpload={async () => {
                throw new Error("Unexpected upload");
              }}
              onGenerateTokenImage={async () => {
                throw new Error("Unexpected generation");
              }}
              onCreate={async () => {
                throw new Error("Unexpected create");
              }}
              onCreateAndPlace={async () => {
                throw new Error("Unexpected create-and-place");
              }}
              onCancel={() => setOpen(false)}
              onPatch={actions.onPatchTokenDefinition}
              onOpenCharacters={vi.fn()}
              onOpenMedia={vi.fn()}
            />
          ) : (
            <p role="status">Редактор закрыт</p>
          )}
        </>
      );
    }

    renderComponent(<Harness />);
    const name = screen.getByLabelText("Название");
    await userEvent.clear(name);
    await userEvent.type(name, "После отказа");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PATCH отклонён",
    );
    expect(
      requests.filter((request) => request.method === "PATCH"),
    ).toHaveLength(1);
    expect(
      requests.filter((request) => request.path === "/api/bootstrap"),
    ).toEqual([]);

    await userEvent.clear(name);
    await userEvent.type(name, "После commit");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Снимок недоступен",
    );
    expect(screen.getByTestId("edit-shared-error")).toHaveTextContent(
      "Снимок недоступен",
    );
    const patches = requests.filter((request) => request.method === "PATCH");
    expect(patches).toHaveLength(2);
    const failedBody = patches[0]?.body as { actionId: string; name: string };
    const committedBody = patches[1]?.body as {
      actionId: string;
      name: string;
    };
    expect(committedBody.name).toBe("После commit");
    expect(committedBody.actionId).not.toBe(failedBody.actionId);

    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Редактор закрыт")).toBeInTheDocument();
    const replayed = requests.filter((request) => request.method === "PATCH");
    expect(replayed).toHaveLength(3);
    expect(replayed[2]?.body).toEqual(committedBody);
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `PATCH /api/token-definitions/${definition.id}`,
      `PATCH /api/token-definitions/${definition.id}`,
      "GET /api/bootstrap",
      `PATCH /api/token-definitions/${definition.id}`,
      "GET /api/bootstrap",
    ]);
  });
});

describe("UIX-611 real editor uploaded-source selection", () => {
  it("awaits held upload B on Save and preserves a later deliberate source crop across reload", async () => {
    let resolveUpload!: (asset: AssetDto) => void;
    const uploadResult = new Promise<AssetDto>((resolve) => {
      resolveUpload = resolve;
    });
    let serverAssets = [sourceA, ready];
    const requests: Array<{ path: string; method: string; body?: unknown }> =
      [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const method = init?.method ?? "GET";
        if (path === "/api/assets?kind=IMAGE" && method === "POST") {
          requests.push({ path, method, body: init?.body });
          const asset = await uploadResult;
          serverAssets = [asset, ...serverAssets];
          return jsonResponse(asset, 201);
        }
        if (path === "/api/bootstrap" && method === "GET") {
          requests.push({ path, method });
          return jsonResponse(gmSnapshot({ assets: serverAssets }));
        }
        if (
          (path === "/api/assets/source-b/token" ||
            path === "/api/assets/source-a/token") &&
          method === "POST"
        ) {
          requests.push({ path, method, body: JSON.parse(String(init?.body)) });
          serverAssets = [
            generated,
            ...serverAssets.filter((asset) => asset.id !== generated.id),
          ];
          return jsonResponse(generated, 201);
        }
        throw new Error(
          `Unexpected UIX-611 boundary request: ${method} ${path}`,
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    // A definition refusal leaves the real editor open for the subsequent
    // deliberate source change and authoritative snapshot reload.
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error("Повторите сохранение определения."))
      .mockResolvedValue(undefined);
    const onCreateAndPlace = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    function Harness() {
      const [snapshot, setSnapshot] = useState(() =>
        gmSnapshot({ assets: [sourceA, ready] }),
      );
      // Actual useAssetActions awaits this authoritative reload before exposing
      // the uploaded DTO to the editor, just as App's load boundary does.
      const load = useCallback(async () => {
        setSnapshot(await api<GameSnapshot>("/api/bootstrap"));
      }, []);
      const assets = useAssetActions({ load });
      return (
        <>
          <button onClick={() => void load()}>Обновить снимок</button>
          <TokenDefinitionEditor
            snapshot={snapshot}
            onUpload={assets.uploadAsset}
            onGenerateTokenImage={assets.generateTokenImage}
            onCreate={onCreate}
            onCreateAndPlace={onCreateAndPlace}
            onCancel={onCancel}
            onPatch={vi.fn()}
            onReplaceControllers={vi.fn()}
            onOpenCharacters={vi.fn()}
            onOpenMedia={vi.fn()}
          />
        </>
      );
    }
    renderComponent(<Harness />);
    const selector = screen.getByLabelText("Исходное изображение");
    expect(selector).toHaveValue("");
    await userEvent.selectOptions(selector, sourceA.id);
    expect(selector).toHaveValue(sourceA.id);
    await userEvent.type(screen.getByLabelText("Название"), "Страж портрета");
    const zoom = screen.getByRole("slider", {
      name: "Масштаб изображения токена",
    });
    fireEvent.change(zoom, { target: { value: "2" } });
    const preview = screen.getByRole("group", {
      name: /^Интерактивный предпросмотр токена/,
    });
    fireEvent.keyDown(preview, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(preview, { key: "ArrowDown", shiftKey: true });
    await userEvent.click(screen.getByRole("radio", { name: "Бронза" }));
    expect(zoom).toHaveValue("2");
    expect(screen.getByRole("radio", { name: "Бронза" })).toBeChecked();
    expect(preview.querySelector("img")).toHaveStyle({
      left: "-130%",
      top: "-70%",
    });

    // File/pixel decoding is outside this component contract. The controlled
    // HTTP boundary supplies authoritative portrait dimensions; the real
    // ImageUploadField still validates MIME and forwards the exact File.
    const file = new File(["synthetic upload boundary bytes"], sourceB.name, {
      type: "image/png",
    });
    await userEvent.upload(
      screen.getByLabelText("Загрузить новое изображение"),
      file,
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    const uploadRequest = requests[0];
    if (!uploadRequest) throw new Error("Expected an image upload request");
    expect(uploadRequest.path).toBe("/api/assets?kind=IMAGE");
    expect((uploadRequest.body as FormData).get("file")).toBe(file);
    expect(selector).toHaveValue(sourceA.id);
    expect(selector).toBeDisabled();
    expect(zoom).toHaveValue("2");
    expect(zoom).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Бронза" })).toBeChecked();
    expect(preview.querySelector("img")).toHaveStyle({
      left: "-130%",
      top: "-70%",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Загрузка исходного изображения…",
    );
    expect(onCreate).not.toHaveBeenCalled();
    expect(onCreateAndPlace).not.toHaveBeenCalled();

    const save = screen.getByRole("button", { name: "Сохранить" });
    await userEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(
      requests.filter((request) => request.path.endsWith("/token")),
    ).toEqual([]);
    expect(onCreate).not.toHaveBeenCalled();

    await act(async () => resolveUpload(sourceB));
    expect(
      await screen.findByText("Повторите сохранение определения."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("option", { name: sourceB.name })).toHaveValue(
        sourceB.id,
      ),
    );
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /api/assets?kind=IMAGE",
      "GET /api/bootstrap",
      "POST /api/assets/source-b/token",
      "GET /api/bootstrap",
    ]);
    expect(selector).toHaveValue(sourceB.id);
    expect(zoom).toHaveValue("1");
    expect(screen.getByRole("radio", { name: "Без рамки" })).toBeChecked();
    expect(preview.querySelector("img")).toHaveAttribute("src", sourceB.url);
    expect(preview.querySelector("img")).toHaveStyle({
      left: "0%",
      top: "-25%",
    });
    expect(screen.getByLabelText("Название")).toHaveValue("Страж портрета");
    const picker = screen.getByRole("group", {
      name: "Изображение токена из файлов",
    });
    expect(
      within(picker).queryByRole("button", { name: sourceB.name }),
    ).not.toBeInTheDocument();
    expect(
      within(picker).getByRole("button", { name: "Без изображения" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Страж портрета",
        defaultAssetId: generated.id,
      }),
    );
    expect(onCreateAndPlace).not.toHaveBeenCalled();

    expect(requests.find((request) => request.path.endsWith("/token"))).toEqual(
      {
        path: "/api/assets/source-b/token",
        method: "POST",
        body: {
          cropX: 0.5,
          cropY: 0.5,
          zoom: 1,
          frame: "NONE",
          name: "New Portrait",
        },
      },
    );

    // Upload intent is not a permanent controlled selection. A deliberate
    // return to A and its edited crop must survive an unrelated real reload.
    await userEvent.selectOptions(selector, sourceA.id);
    fireEvent.change(zoom, { target: { value: "2" } });
    fireEvent.keyDown(preview, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(preview, { key: "ArrowDown", shiftKey: true });
    await userEvent.click(screen.getByRole("radio", { name: "Серебро" }));
    expect(selector).toHaveValue(sourceA.id);
    expect(zoom).toHaveValue("2");
    expect(screen.getByRole("radio", { name: "Серебро" })).toBeChecked();
    expect(preview.querySelector("img")).toHaveAttribute("src", sourceA.url);
    expect(preview.querySelector("img")).toHaveStyle({
      left: "-130%",
      top: "-70%",
    });
    const unrelatedSource: AssetDto = {
      ...sourceA,
      id: "unrelated-source",
      name: "Unrelated Update.png",
      url: "/api/assets/unrelated-source/content",
    };
    serverAssets = [unrelatedSource, generated, sourceB, ready, sourceA];
    await userEvent.click(
      screen.getByRole("button", { name: "Обновить снимок" }),
    );
    // A newly rendered option proves the changed snapshot has been applied,
    // not merely that the refresh request was dispatched.
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: unrelatedSource.name }),
      ).toHaveValue(unrelatedSource.id),
    );
    expect(selector).toHaveValue(sourceA.id);
    expect(zoom).toHaveValue("2");
    expect(screen.getByRole("radio", { name: "Серебро" })).toBeChecked();
    expect(preview.querySelector("img")).toHaveAttribute("src", sourceA.url);
    expect(preview.querySelector("img")).toHaveStyle({
      left: "-130%",
      top: "-70%",
    });
    expect(
      within(picker).getByRole("button", { name: generated.name }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /api/assets?kind=IMAGE",
      "GET /api/bootstrap",
      "POST /api/assets/source-b/token",
      "GET /api/bootstrap",
      "GET /api/bootstrap",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(onCreate).toHaveBeenLastCalledWith({
        name: "Страж портрета",
        characterId: null,
        defaultAssetId: generated.id,
        defaultWidth: 64,
        defaultHeight: 64,
        controllerMembershipIds: [],
      }),
    );
    expect(
      requests
        .filter((request) => request.path.endsWith("/token"))
        .map((request) => request.path),
    ).toEqual(["/api/assets/source-b/token", "/api/assets/source-a/token"]);
    expect(onCreateAndPlace).not.toHaveBeenCalled();
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  });
});
