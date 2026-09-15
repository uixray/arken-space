// @vitest-environment jsdom
import { useState } from "react";
import type { ButtonButtonProps } from "@gravity-ui/uikit";
import type { AssetDto } from "@arken/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  act,
  renderComponent,
  fireEvent,
  screen,
  userEvent,
  waitFor,
} from "./test-support/render";

// Isolate toolkit chrome, not the generator, its labels or generation payload.
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    loading,
    "aria-label": ariaLabel,
  }: ButtonButtonProps) => (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled || loading}
    >
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

const landscape: AssetDto = {
  ...source,
  id: "landscape-image",
  name: "Wide Scout.png",
  width: 1200,
  height: 800,
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

  it("keeps an embedded crop empty until its controlled parent selects a source", async () => {
    const onDraftChange = vi.fn();
    function ControlledHarness() {
      const [selectedSourceId, setSelectedSourceId] = useState("");
      return (
        <TokenImageGenerator
          imageAssets={[source]}
          embedded
          selectedSourceId={selectedSourceId}
          onDraftChange={(draft) => {
            onDraftChange(draft);
            setSelectedSourceId(draft?.sourceAssetId ?? "");
          }}
        />
      );
    }
    renderComponent(<ControlledHarness />);

    expect(
      screen.queryByRole("button", { name: "Создать изображение токена" }),
    ).not.toBeInTheDocument();
    const sourceSelect = screen.getByLabelText("Исходное изображение");
    const preview = screen.getByRole("group", {
      name: /^Интерактивный предпросмотр токена/,
    });
    expect(sourceSelect).toBeEnabled();
    expect(sourceSelect).toHaveValue("");
    expect(preview).toHaveAttribute("aria-disabled", "true");
    expect(preview).toHaveAttribute("tabindex", "-1");
    expect(
      screen.getByRole("slider", { name: "Масштаб изображения токена" }),
    ).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Бронза" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Сбросить" })).toBeDisabled();
    fireEvent.keyDown(preview, { key: "ArrowRight" });
    fireEvent.pointerDown(preview, { pointerId: 1, clientX: 20, clientY: 20 });
    expect(onDraftChange).not.toHaveBeenCalled();

    await userEvent.selectOptions(sourceSelect, source.id);
    expect(onDraftChange).toHaveBeenCalledWith({
      sourceAssetId: source.id,
      cropX: 0.5,
      cropY: 0.5,
      zoom: 1,
      frame: "NONE",
      name: "Neverwinter Scout",
    });
    expect(preview).not.toHaveAttribute("aria-disabled");
    expect(preview).toHaveAttribute("tabindex", "0");
    expect(
      screen.getByRole("slider", { name: "Масштаб изображения токена" }),
    ).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Бронза" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Сбросить" })).toBeEnabled();
    expect(preview.querySelector("img")).toHaveAttribute("src", source.url);

    await userEvent.selectOptions(sourceSelect, "");
    expect(sourceSelect).toBeEnabled();
    expect(sourceSelect).toHaveValue("");
    expect(onDraftChange).toHaveBeenLastCalledWith(null);
    expect(preview).toHaveAttribute("aria-disabled", "true");
    expect(preview).toHaveAttribute("tabindex", "-1");
    expect(
      screen.getByRole("slider", { name: "Масштаб изображения токена" }),
    ).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Бронза" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Сбросить" })).toBeDisabled();
    const callsAfterClear = onDraftChange.mock.calls.length;
    fireEvent.keyDown(preview, { key: "ArrowRight" });
    fireEvent.pointerDown(preview, { pointerId: 2, clientX: 20, clientY: 20 });
    expect(onDraftChange).toHaveBeenCalledTimes(callsAfterClear);
  });

  it("keeps crop motion and zoom controls on the canonical aspect-aware transform", async () => {
    const onDraftChange = vi.fn();
    renderComponent(
      <TokenImageGenerator
        imageAssets={[landscape]}
        embedded
        selectedSourceId={landscape.id}
        onDraftChange={onDraftChange}
      />,
    );
    const preview = screen.getByRole("group", {
      name: /^Интерактивный предпросмотр токена/,
    }) as HTMLDivElement;
    Object.defineProperty(preview, "getBoundingClientRect", {
      value: () => ({ width: 100, height: 100 }),
    });
    Object.defineProperty(preview, "setPointerCapture", { value: vi.fn() });
    fireEvent.pointerDown(preview, {
      pointerId: 1,
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    fireEvent.pointerMove(preview, { pointerId: 1, clientX: 70, clientY: 50 });
    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ cropX: 0.5 - (0.2 * 800) / 1200, cropY: 0.5 }),
    );
    fireEvent.pointerCancel(preview, { pointerId: 1 });
    const callsAfterCancel = onDraftChange.mock.calls.length;
    fireEvent.pointerMove(preview, { pointerId: 1, clientX: 90, clientY: 50 });
    expect(onDraftChange).toHaveBeenCalledTimes(callsAfterCancel);

    const numeric = screen.getByLabelText(
      "Масштаб изображения токена, проценты",
    );
    await userEvent.clear(numeric);
    expect(numeric).toHaveValue(null);
    await userEvent.type(numeric, "150");
    await userEvent.tab();
    expect(
      screen.getByRole("slider", { name: "Масштаб изображения токена" }),
    ).toHaveValue("1.5");
    await userEvent.click(
      screen.getByRole("button", { name: "Уменьшить масштаб" }),
    );
    expect(numeric).toHaveValue(140);
    await userEvent.clear(numeric);
    expect(numeric).toHaveValue(null);
    await userEvent.tab();
    expect(numeric).toHaveValue(140);
    await userEvent.clear(numeric);
    await userEvent.type(numeric, "255");
    await userEvent.tab();
    expect(numeric).toHaveValue(260);
    expect(
      screen.getByRole("slider", { name: "Масштаб изображения токена" }),
    ).toHaveValue("2.6");
    await userEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    expect(numeric).toHaveValue(100);
    expect(
      screen.getByRole("button", { name: "Уменьшить масштаб" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Увеличить масштаб" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Увеличить масштаб" }),
    );
    expect(numeric).toHaveValue(120);
    expect(
      screen.getByRole("slider", { name: "Масштаб изображения токена" }),
    ).toHaveValue("1.2");
  });

  it("keeps the full pointer displacement when React batches multiple moves", () => {
    const onDraftChange = vi.fn();
    renderComponent(
      <TokenImageGenerator
        imageAssets={[landscape]}
        embedded
        selectedSourceId={landscape.id}
        onDraftChange={onDraftChange}
      />,
    );
    const preview = screen.getByRole("group", {
      name: /^Интерактивный предпросмотр токена/,
    }) as HTMLDivElement;
    Object.defineProperty(preview, "getBoundingClientRect", {
      value: () => ({ width: 100, height: 100 }),
    });
    Object.defineProperty(preview, "setPointerCapture", { value: vi.fn() });
    act(() => {
      fireEvent.pointerDown(preview, {
        pointerId: 1,
        button: 0,
        clientX: 50,
        clientY: 50,
      });
      fireEvent.pointerMove(preview, {
        pointerId: 1,
        clientX: 60,
        clientY: 50,
      });
      fireEvent.pointerMove(preview, {
        pointerId: 1,
        clientX: 70,
        clientY: 50,
      });
    });
    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ cropX: 0.5 - (0.2 * 800) / 1200, cropY: 0.5 }),
    );
  });
});
