// @vitest-environment jsdom
import type { ButtonButtonProps } from "@gravity-ui/uikit";
import type { AssetDto } from "@arken/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "./test-support/render";

// Isolate toolkit chrome, not the generator, its labels or generation payload.
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({ children, onClick, disabled, loading }: ButtonButtonProps) => (
    <button type="button" onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
}));
const { TokenImageGenerator } = await import("./TokenImageGenerator");

const source: AssetDto = {
  id: "source-image",
  kind: "IMAGE",
  name: "Neverwinter Scout.png",
  mimeType: "image/png",
  sizeBytes: 100,
  width: 512,
  height: 512,
  durationSeconds: null,
  url: "/image.png",
  createdAt: "2026-09-08T00:00:00.000Z",
};

describe("token image generator Russian copy", () => {
  it("renders translated source/action labels and preserves source identity and generation intent", async () => {
    const generated = {
      ...source,
      id: "generated-token",
      kind: "TOKEN" as const,
    };
    const onGenerate = vi.fn().mockResolvedValue(generated);
    const onGenerated = vi.fn();
    renderComponent(
      <TokenImageGenerator
        imageAssets={[source]}
        onGenerate={onGenerate}
        onGenerated={onGenerated}
      />,
    );

    expect(screen.getByText("Из изображения")).toBeVisible();
    expect(
      screen.getByRole("option", { name: "Neverwinter Scout.png" }),
    ).toHaveValue(source.id);
    expect(screen.getByLabelText("Исходное изображение")).toHaveValue(
      source.id,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Создать изображение токена" }),
    );
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(generated));
    expect(onGenerate).toHaveBeenCalledExactlyOnceWith({
      sourceAssetId: source.id,
      cropX: 0.5,
      cropY: 0.5,
      zoom: 1,
      frame: "NONE",
      name: "Neverwinter Scout",
    });
  });
});
