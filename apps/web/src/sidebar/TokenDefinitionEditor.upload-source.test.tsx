// @vitest-environment jsdom
import {
  useCallback,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import type { ButtonButtonProps } from "@gravity-ui/uikit";
import type { AssetDto, GameSnapshot } from "@arken/contracts";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useAssetActions } from "../use-asset-actions";
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
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:synthetic-source-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  // Always unmount ImageUploadField before restoring its object-URL boundary,
  // including when the intended source-selection baseline assertion fails.
  cleanup();
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

describe("UIX-611 real editor uploaded-source selection", () => {
  it("automatically selects uploaded portrait B and resets A's edited crop before generating a TOKEN", async () => {
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
        if (path === "/api/assets/source-b/token" && method === "POST") {
          requests.push({ path, method, body: JSON.parse(String(init?.body)) });
          serverAssets = [generated, ...serverAssets];
          return jsonResponse(generated, 201);
        }
        throw new Error(
          `Unexpected UIX-611 boundary request: ${method} ${path}`,
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const onCreate = vi.fn().mockResolvedValue(undefined);
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
    expect(zoom).toHaveValue("2");
    expect(screen.getByRole("radio", { name: "Бронза" })).toBeChecked();
    expect(preview.querySelector("img")).toHaveStyle({
      left: "-130%",
      top: "-70%",
    });
    expect(onCreate).not.toHaveBeenCalled();
    expect(onCreateAndPlace).not.toHaveBeenCalled();

    await act(async () => resolveUpload(sourceB));
    await waitFor(() =>
      expect(screen.getByRole("option", { name: sourceB.name })).toHaveValue(
        sourceB.id,
      ),
    );
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /api/assets?kind=IMAGE",
      "GET /api/bootstrap",
    ]);
    // Intended first baseline FAIL on unchanged source: B is really available,
    // but the generator's existing effect retains A while A still exists.
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
    ).toHaveAttribute("aria-pressed", "true");
    expect(onCreate).not.toHaveBeenCalled();
    expect(onCreateAndPlace).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Создать изображение токена" }),
    );
    await waitFor(() =>
      expect(
        within(picker).getByRole("button", { name: generated.name }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
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
    ).toHaveAttribute("aria-pressed", "true");
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /api/assets?kind=IMAGE",
      "GET /api/bootstrap",
      "POST /api/assets/source-b/token",
      "GET /api/bootstrap",
      "GET /api/bootstrap",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledExactlyOnceWith({
        name: "Страж портрета",
        characterId: null,
        defaultAssetId: generated.id,
        defaultWidth: 64,
        defaultHeight: 64,
        controllerMembershipIds: [],
      }),
    );
    expect(onCreateAndPlace).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
