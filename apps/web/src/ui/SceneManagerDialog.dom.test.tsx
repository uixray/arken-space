// @vitest-environment jsdom
import type { SceneDto } from "@arken/contracts";
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

async function openEditor() {
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderComponent(
    <SceneManagerDialog
      open
      variant="workspace"
      snapshot={gmSnapshot({ scenes: [scene] })}
      viewedSceneId={scene.id}
      onClose={vi.fn()}
      onView={vi.fn()}
      onPublish={vi.fn()}
      onSave={onSave}
      onUpload={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Настроить" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Настройка: Тестовая сцена",
  });
  return { dialog, editor: within(dialog), onSave };
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
