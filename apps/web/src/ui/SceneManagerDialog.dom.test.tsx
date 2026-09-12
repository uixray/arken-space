// @vitest-environment jsdom
import type { AssetDto, SceneDto } from "@arken/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "@gravity-ui/uikit";
import type { ReactElement, ReactNode } from "react";
import {
  fireEvent,
  renderComponent as renderBase,
  screen,
  waitFor,
  within,
} from "../test-support/render";
import { gmSnapshot } from "../test-support/game-snapshot-fixtures";
import { SceneManagerDialog } from "./SceneManagerDialog";

// Real production provider; only the browser API missing from jsdom is shimmed.
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
});
afterEach(() => vi.unstubAllGlobals());
function renderComponent(ui: ReactElement) {
  return renderBase(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ThemeProvider theme="dark" lang="ru">
        {children}
      </ThemeProvider>
    ),
  });
}

const scene: SceneDto = {
  id: "scene-under-test",
  name: "Тестовая сцена",
  projection: "ORTHOGRAPHIC_2D",
  mapAssetId: null,
  width: 1920,
  height: 1080,
  backgroundFrame: { x: 0, y: 0, width: 1920, height: 1080 },
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

async function openEditor(
  options: { scene?: SceneDto; assets?: AssetDto[] } = {},
) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onUpload = vi.fn();
  const onView = vi.fn();
  const onPublish = vi.fn();
  renderComponent(
    <SceneManagerDialog
      open
      variant="workspace"
      snapshot={gmSnapshot({
        scenes: [options.scene ?? scene],
        assets: options.assets ?? [],
      })}
      viewedSceneId={scene.id}
      onClose={vi.fn()}
      onView={onView}
      onPublish={onPublish}
      onSave={onSave}
      onUpload={onUpload}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Настроить" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Настройка: Тестовая сцена",
  });
  return {
    dialog,
    editor: within(dialog),
    onSave,
    onUpload,
    onView,
    onPublish,
  };
}

it("explains clean save and keeps native color/units/ranges in the real scene editor", async () => {
  const { editor } = await openEditor();
  const save = editor.getByRole("button", { name: "Сохранить" });
  expect(save).toBeDisabled();
  expect(save).toHaveAccessibleDescription("Нет изменений для сохранения.");
  expect(editor.getByLabelText("Цвет сетки")).toHaveAttribute("type", "color");
  for (const [name, min, max, step] of [
    ["Ширина (px)", "320", "16384", "1"],
    ["Высота (px)", "320", "16384", "1"],
    ["Размер клетки (px)", "16", "256", "1"],
    ["Непрозрачность (0–1)", "0", "1", "any"],
    ["Позиция X рамки (px)", "-16384", "16384", "any"],
    ["Ширина рамки (px)", "16", "16384", "any"],
  ]) {
    const input = editor.getByRole("spinbutton", { name });
    expect(input).toHaveAttribute("min", min);
    expect(input).toHaveAttribute("max", max);
    expect(input).toHaveAttribute("step", step);
    expect(input).toHaveAccessibleDescription(/От/);
  }
  expect(
    editor.getByRole("checkbox", { name: "Сетка: привязка и измерение" }),
  ).toHaveAccessibleDescription(/при 0 привязка остаётся включённой/);
});

it("links invalid fields and save reason, and blocks programmatic invalid submission", async () => {
  const { dialog, editor, onSave } = await openEditor();
  const width = editor.getByRole("spinbutton", { name: "Ширина (px)" });
  const save = editor.getByRole("button", { name: "Сохранить" });
  fireEvent.change(width, { target: { value: "319" } });
  expect(width).toHaveAttribute("aria-invalid", "true");
  expect(width).toHaveAccessibleDescription(/Введите значение/);
  expect(save).toBeDisabled();
  expect(save).toHaveAccessibleDescription(
    "Исправьте отмеченные поля перед сохранением.",
  );
  fireEvent.submit(dialog.querySelector("form")!);
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.change(width, { target: { value: "1920" } });
  expect(width).not.toHaveAttribute("aria-invalid", "true");
  const name = editor.getByRole("textbox", { name: "Название" });
  fireEvent.change(name, { target: { value: "   " } });
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription(
    "Введите название от 1 до 100 символов.",
  );
  expect(save).toBeDisabled();
});

it("saves transparent enabled grid and fractional offsets without changing their semantics", async () => {
  const { editor, onSave } = await openEditor();
  fireEvent.change(editor.getByLabelText("Цвет сетки"), {
    target: { value: "#112233" },
  });
  fireEvent.change(
    editor.getByRole("spinbutton", { name: "Непрозрачность (0–1)" }),
    { target: { value: "0" } },
  );
  fireEvent.change(
    editor.getByRole("spinbutton", { name: "Смещение X (px)" }),
    { target: { value: "-0.5" } },
  );
  const save = editor.getByRole("button", { name: "Сохранить" });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenCalledWith(
    scene,
    expect.objectContaining({
      gridEnabled: true,
      gridOpacity: 0,
      gridOffsetX: -0.5,
      gridColor: "#112233",
    }),
  );
});

it("rejects blank/fractional cell input and discards canceled edits", async () => {
  const { editor, onSave } = await openEditor();
  const cell = editor.getByRole("spinbutton", { name: "Размер клетки (px)" });
  for (const value of ["", "64.5", "257"]) {
    fireEvent.change(cell, { target: { value } });
    expect(cell).toHaveAttribute("aria-invalid", "true");
    expect(editor.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  }
  fireEvent.click(editor.getByRole("button", { name: "Отмена" }));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Настроить" }));
  const reopened = within(
    await screen.findByRole("dialog", { name: "Настройка: Тестовая сцена" }),
  );
  expect(
    reopened.getByRole("spinbutton", { name: "Размер клетки (px)" }),
  ).toHaveValue(64);
});

it("UIX-421 A2 projects live draft geometry and invisible snapping without side effects", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { editor, onSave, onUpload, onView, onPublish } = await openEditor();
  const preview = editor.getByRole("img", {
    name: "Карта и сетка — черновик сцены",
  });
  const change = (name: string, value: string) =>
    fireEvent.change(editor.getByRole("spinbutton", { name }), {
      target: { value },
    });
  change("Ширина (px)", "1600");
  change("Высота (px)", "960");
  change("Размер клетки (px)", "80");
  change("Смещение X (px)", "-10.5");
  change("Смещение Y (px)", "18.25");
  fireEvent.change(editor.getByLabelText("Цвет сетки"), {
    target: { value: "#123456" },
  });
  change("Непрозрачность (0–1)", "0.75");
  expect(preview).toHaveAttribute("viewBox", "0 0 1600 960");
  const pattern = preview.querySelector("pattern")!;
  expect(pattern).toHaveAttribute("width", "80");
  expect(pattern).toHaveAttribute("height", "80");
  expect(pattern).toHaveAttribute("x", "-10.5");
  expect(pattern).toHaveAttribute("y", "18.25");
  expect(pattern.querySelector("path")).toHaveAttribute("d", "M 80 0 H 0 V 80");
  expect(pattern.querySelector("path")).toHaveAttribute("stroke", "#123456");
  expect(preview.querySelector(".scene-grid-preview__grid")).toHaveAttribute(
    "opacity",
    "0.75",
  );
  change("Непрозрачность (0–1)", "0");
  expect(preview.querySelector(".scene-grid-preview__grid")).toHaveAttribute(
    "opacity",
    "0",
  );
  expect(editor.getByText("Линии невидимы; привязка включена.")).toBeVisible();
  const enabled = editor.getByRole("checkbox", {
    name: "Сетка: привязка и измерение",
  });
  fireEvent.click(enabled);
  expect(preview.querySelector(".scene-grid-preview__grid")).toBeNull();
  expect(editor.getByText("Сетка выключена.")).toBeVisible();
  fireEvent.click(enabled);
  expect(preview.querySelector(".scene-grid-preview__grid")).toHaveAttribute(
    "opacity",
    "0",
  );
  expect(fetch).not.toHaveBeenCalled();
  for (const callback of [onSave, onUpload, onView, onPublish])
    expect(callback).not.toHaveBeenCalled();
  expect(scene.grid).toEqual({
    enabled: true,
    size: 64,
    offsetX: 0,
    offsetY: 0,
    color: "#c8b78b",
    opacity: 0.22,
  });
});

it("UIX-421 A2 renders no SVG geometry for invalid draft numbers and recovers from correction", async () => {
  const { editor, onSave } = await openEditor();
  const cell = editor.getByRole("spinbutton", { name: "Размер клетки (px)" });
  for (const value of ["", "64.5", "0", "257", "1e309"]) {
    fireEvent.change(cell, { target: { value } });
    expect(
      editor.queryByRole("img", { name: "Карта и сетка — черновик сцены" }),
    ).toBeNull();
    expect(
      editor.getByText("Предпросмотр недоступен: Размер клетки (px)"),
    ).toBeVisible();
    expect(editor.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  }
  fireEvent.change(cell, { target: { value: "96" } });
  expect(
    editor
      .getByRole("img", { name: "Карта и сетка — черновик сцены" })
      .querySelector("pattern"),
  ).toHaveAttribute("width", "96");
  expect(editor.queryByText(/Предпросмотр недоступен/)).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
});

for (const dismiss of ["cancel", "escape", "close"] as const) {
  it(`UIX-421 A2 ${dismiss} discards preview draft before reopening authoritative scene`, async () => {
    const { editor, onSave } = await openEditor();
    fireEvent.change(
      editor.getByRole("spinbutton", { name: "Размер клетки (px)" }),
      { target: { value: "128" } },
    );
    expect(
      editor
        .getByRole("img", { name: "Карта и сетка — черновик сцены" })
        .querySelector("pattern"),
    ).toHaveAttribute("width", "128");
    if (dismiss === "escape")
      fireEvent.keyDown(
        editor.getByRole("spinbutton", { name: "Размер клетки (px)" }),
        { key: "Escape", code: "Escape" },
      );
    else
      fireEvent.click(
        editor.getByRole("button", {
          name: dismiss === "cancel" ? "Отмена" : "Закрыть диалоговое окно",
        }),
      );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Настройка: Тестовая сцена" }),
      ).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Настроить" }));
    const reopened = within(
      await screen.findByRole("dialog", { name: "Настройка: Тестовая сцена" }),
    );
    expect(
      reopened
        .getByRole("img", { name: "Карта и сетка — черновик сцены" })
        .querySelector("pattern"),
    ).toHaveAttribute("width", "64");
    expect(onSave).not.toHaveBeenCalled();
  });
}

it("UIX-421 A2 keeps draft preview after failed save and retries through the existing save path", async () => {
  const { editor, onSave } = await openEditor();
  onSave.mockRejectedValueOnce(new Error("Сохранение недоступно"));
  fireEvent.change(
    editor.getByRole("spinbutton", { name: "Размер клетки (px)" }),
    { target: { value: "96" } },
  );
  fireEvent.click(editor.getByRole("button", { name: "Сохранить" }));
  expect(await editor.findByText("Сохранение недоступно")).toBeVisible();
  expect(editor.getByRole("alert")).toHaveTextContent("Сохранение недоступно");
  expect(
    editor
      .getByRole("img", { name: "Карта и сетка — черновик сцены" })
      .querySelector("pattern"),
  ).toHaveAttribute("width", "96");
  expect(
    editor.getByRole("spinbutton", { name: "Размер клетки (px)" }),
  ).toHaveValue(96);
  fireEvent.click(editor.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave.mock.calls[0]).toEqual(onSave.mock.calls[1]);
  expect(onSave).toHaveBeenLastCalledWith(
    scene,
    expect.objectContaining({ gridSize: 96 }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Настройка: Тестовая сцена" }),
    ).toBeNull(),
  );
});

const map: AssetDto = {
  id: "map-under-test",
  kind: "MAP",
  name: "Карта проверки",
  mimeType: "image/png",
  sizeBytes: 42,
  width: 800,
  height: 600,
  durationSeconds: null,
  url: "/api/assets/map-under-test/content",
  createdAt: "2026-09-07T00:00:00.000Z",
};

it("UIX-421 A2 maps the selected image into the current draft frame with world clipping", async () => {
  const { editor, onSave } = await openEditor({
    scene: { ...scene, mapAssetId: map.id },
    assets: [map],
  });
  fireEvent.click(
    editor.getByRole("checkbox", { name: "Сохранять пропорции" }),
  );
  for (const [name, value] of [
    ["Позиция X рамки (px)", "-40.5"],
    ["Позиция Y рамки (px)", "22.25"],
    ["Ширина рамки (px)", "640"],
    ["Высота рамки (px)", "480"],
  ] as const) {
    fireEvent.change(editor.getByRole("spinbutton", { name }), {
      target: { value },
    });
  }
  const image = editor
    .getByRole("img", { name: "Карта и сетка — черновик сцены" })
    .querySelector("image")!;
  expect(image).toHaveAttribute("href", map.url);
  for (const [name, value] of [
    ["x", "-40.5"],
    ["y", "22.25"],
    ["width", "640"],
    ["height", "480"],
    ["preserveAspectRatio", "none"],
  ] as const)
    expect(image).toHaveAttribute(name, value);
  expect(image.parentElement).toHaveAttribute("overflow", "hidden");
  expect(image.parentElement).toHaveAttribute("width", "1920");
  expect(onSave).not.toHaveBeenCalled();
});

it("UIX-421 A2 omits an unsafe map URL without hiding the safe grid preview", async () => {
  const { editor } = await openEditor({
    scene: { ...scene, mapAssetId: map.id },
    assets: [{ ...map, url: "javascript:alert(1)" }],
  });
  expect(
    editor
      .getByRole("img", { name: "Карта и сетка — черновик сцены" })
      .querySelector("image"),
  ).toBeNull();
  expect(
    editor.getByText("Карта недоступна для безопасного предпросмотра."),
  ).toBeVisible();
});

it("UIX-421 A2 hides stale map preview while a replacement file is pending without uploading or saving", async () => {
  const NativeURL = URL;
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL = vi.fn(() => "blob:pending-map-thumbnail");
      static revokeObjectURL = vi.fn();
    },
  );
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { editor, onSave, onUpload } = await openEditor({
    scene: { ...scene, mapAssetId: map.id },
    assets: [map],
  });
  const previewName = "Карта и сетка — черновик сцены";
  expect(
    editor.getByRole("img", { name: previewName }).querySelector("image"),
  ).toHaveAttribute("href", map.url);
  const replacement = new File(
    [new Uint8Array([137, 80, 78, 71])],
    "replacement.png",
    { type: "image/png" },
  );
  const chooseFile = () =>
    fireEvent.change(editor.getByLabelText("Загрузить новую карту"), {
      target: { files: [replacement] },
    });
  chooseFile();
  expect(editor.queryByRole("img", { name: previewName })).toBeNull();
  expect(
    editor.getByText(
      "Предпросмотр недоступен: Новая карта ещё не сохранена. Сохраните сцену или удалите выбранный файл, чтобы увидеть карту и сетку.",
    ),
  ).toBeVisible();
  expect(editor.getByRole("button", { name: "Сохранить" })).toBeEnabled();
  expect(onSave).not.toHaveBeenCalled();
  expect(onUpload).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(
    editor.getByRole("button", { name: "Удалить replacement.png" }),
  );
  expect(
    editor.getByRole("img", { name: previewName }).querySelector("image"),
  ).toHaveAttribute("href", map.url);
  expect(
    editor.getByRole("img", { name: previewName }).querySelector("pattern"),
  ).toHaveAttribute("width", "64");
  chooseFile();
  expect(editor.queryByRole("img", { name: previewName })).toBeNull();
  fireEvent.click(editor.getByRole("button", { name: "Отмена" }));
  fireEvent.click(screen.getByRole("button", { name: "Настроить" }));
  const reopened = within(
    await screen.findByRole("dialog", { name: "Настройка: Тестовая сцена" }),
  );
  expect(
    reopened.getByRole("img", { name: previewName }).querySelector("image"),
  ).toHaveAttribute("href", map.url);
  expect(
    reopened.getByRole("img", { name: previewName }).querySelector("pattern"),
  ).toHaveAttribute("width", "64");
  expect(reopened.queryByText(/Новая карта ещё не сохранена/)).toBeNull();
  expect(
    reopened.queryByRole("button", { name: "Удалить replacement.png" }),
  ).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
  expect(onUpload).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
