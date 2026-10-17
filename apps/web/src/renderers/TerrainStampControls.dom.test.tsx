// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "../test-support/render";
import {
  TerrainStampControls,
  type TerrainStampSettings,
} from "./TerrainStampControls";
import { DEFAULT_TERRAIN_STAMP_SETTINGS } from "./terrain-stamp-settings";
import { stampImageUrl } from "./stamp-image-url";

vi.mock("../api", () => ({
  api: vi.fn().mockResolvedValue({
    stamps: [
      { assetKey: "forest", title: "Лес" },
      { assetKey: "fallen-tree", title: "Поваленное дерево" },
    ],
    textures: [{ assetKey: "dug-soil", title: "Перекопанная почва" }],
  }),
  formatApiError: (reason: unknown) =>
    reason instanceof Error ? reason.message : "Операция не выполнена",
}));

const imageId = "11111111-1111-4111-8111-111111111111";
const base: TerrainStampSettings = DEFAULT_TERRAIN_STAMP_SETTINGS;

function renderControls(
  props: Partial<Parameters<typeof TerrainStampControls>[0]> = {},
) {
  const onChange = vi.fn();
  const trigger = document.createElement("button");
  renderComponent(
    <TerrainStampControls
      id="stamps"
      triggerRef={{ current: trigger }}
      value={base}
      onChange={onChange}
      onClose={() => undefined}
      onDismissOutside={() => undefined}
      {...props}
    />,
  );
  return { onChange };
}

describe("TerrainStampControls (UIX-706)", () => {
  it("reads template titles from the catalog, so new templates need no client change", async () => {
    const { onChange } = renderControls();
    await userEvent.click(
      await screen.findByRole("button", { name: "Поваленное дерево" }),
    );
    expect(onChange).toHaveBeenCalledWith({
      ...base,
      packId: "builtin-terrain-v1",
      assetKey: "fallen-tree",
    });
  });

  it("offers campaign images as GM stamps", async () => {
    const { onChange } = renderControls({
      images: [{ id: imageId, name: "Кратер" }],
    });
    await userEvent.click(screen.getByRole("button", { name: "Кратер" }));
    expect(onChange).toHaveBeenCalledWith({
      ...base,
      packId: "campaign-image",
      assetKey: imageId,
    });
  });

  it("uploads a new image and selects it as the stamp", async () => {
    const onUploadImage = vi
      .fn()
      .mockResolvedValue({ id: imageId, name: "Облако тьмы" });
    const { onChange } = renderControls({ onUploadImage });
    const file = new File(["x"], "cloud.png", { type: "image/png" });
    await userEvent.upload(
      screen.getByLabelText("Загрузить картинку для штампа"),
      file,
    );
    expect(onUploadImage).toHaveBeenCalledWith(file);
    expect(onChange).toHaveBeenCalledWith({
      ...base,
      packId: "campaign-image",
      assetKey: imageId,
    });
  });

  it("shows an upload failure instead of silently dropping it", async () => {
    const onUploadImage = vi
      .fn()
      .mockRejectedValue(new Error("Файл слишком большой"));
    renderControls({ onUploadImage });
    await userEvent.upload(
      screen.getByLabelText("Загрузить картинку для штампа"),
      new File(["x"], "big.png", { type: "image/png" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Файл слишком большой",
    );
  });

  it("switches to the texture brush and picks a catalog texture (pool 3)", async () => {
    const { onChange } = renderControls();
    await userEvent.click(
      screen.getByRole("button", { name: "Кисть текстуры" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ ...base, mode: "BRUSH" });
  });

  it("paints with catalog textures or campaign images in brush mode", async () => {
    const brush: TerrainStampSettings = { ...base, mode: "BRUSH" };
    const onUploadImage = vi
      .fn()
      .mockResolvedValue({ id: imageId, name: "Мох" });
    const { onChange } = renderControls({
      value: brush,
      images: [{ id: imageId, name: "Мох" }],
      onUploadImage,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Выберите текстуру");
    expect(
      screen.queryByRole("button", { name: "Поваленное дерево" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole("button", { name: "Перекопанная почва" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...brush,
      texture: { packId: "builtin-texture-v1", assetKey: "dug-soil" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Мох" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...brush,
      texture: { packId: "campaign-image", assetKey: imageId },
    });
    await userEvent.upload(
      screen.getByLabelText("Загрузить картинку для штампа"),
      new File(["x"], "moss.png", { type: "image/png" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...brush,
      texture: { packId: "campaign-image", assetKey: imageId },
    });
    // The stamp's own size/rotation stay untouched; the brush has its own.
    expect(screen.queryByLabelText("Поворот штампа")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ширина кисти")).toHaveValue("96");
    expect(screen.getByLabelText("Размер плитки текстуры")).toHaveValue("128");
  });

  it("routes each pack to its own ACL-checked image endpoint", () => {
    expect(stampImageUrl("builtin-texture-v1", "dug-soil")).toBe(
      "/api/terrain-stamps/textures/dug-soil",
    );
    expect(stampImageUrl("builtin-terrain-v1", "forest")).toBe(
      "/api/terrain-stamps/assets/forest",
    );
    expect(stampImageUrl("campaign-image", imageId)).toBe(
      `/api/assets/${imageId}/content`,
    );
  });
});
