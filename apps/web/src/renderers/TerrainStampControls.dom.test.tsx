// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "../test-support/render";
import {
  TerrainStampControls,
  type TerrainStampSettings,
} from "./TerrainStampControls";
import { stampImageUrl } from "./stamp-image-url";

vi.mock("../api", () => ({
  api: vi.fn().mockResolvedValue({
    stamps: [
      { assetKey: "forest", title: "Лес" },
      { assetKey: "fallen-tree", title: "Поваленное дерево" },
    ],
  }),
  formatApiError: (reason: unknown) =>
    reason instanceof Error ? reason.message : "Операция не выполнена",
}));

const imageId = "11111111-1111-4111-8111-111111111111";
const base: TerrainStampSettings = {
  packId: "builtin-terrain-v1",
  assetKey: "forest",
  size: 160,
  rotation: 0,
  layer: "PUBLIC",
};

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

  it("routes each pack to its own ACL-checked image endpoint", () => {
    expect(stampImageUrl("builtin-terrain-v1", "forest")).toBe(
      "/api/terrain-stamps/assets/forest",
    );
    expect(stampImageUrl("campaign-image", imageId)).toBe(
      `/api/assets/${imageId}/content`,
    );
  });
});
