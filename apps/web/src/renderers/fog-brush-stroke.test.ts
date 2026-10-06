import { describe, expect, it, vi } from "vitest";
import type Konva from "konva";
import { paintFogBrushStroke } from "./fog-brush-stroke";

describe("fog brush stroke", () => {
  it("uses the same repeating fog texture across the whole round-capped stroke", () => {
    const pattern = {} as CanvasPattern;
    const image = {} as CanvasImageSource;
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      setAttr: vi.fn(),
      stroke: vi.fn(),
      createPattern: vi.fn(() => pattern),
    };
    paintFogBrushStroke(
      context as unknown as Konva.Context,
      [
        { x: 12, y: 20 },
        { x: 40, y: 30 },
      ],
      40,
      image,
      "black",
    );
    expect(context.createPattern).toHaveBeenCalledWith(image, "repeat");
    expect(context.setAttr).toHaveBeenCalledWith("strokeStyle", pattern);
    expect(context.setAttr).toHaveBeenCalledWith("lineWidth", 80);
    expect(context.setAttr).toHaveBeenCalledWith("lineCap", "round");
    expect(context.lineTo).toHaveBeenCalledWith(40, 30);
    expect(context.stroke).toHaveBeenCalledOnce();
    expect(context.restore).toHaveBeenCalledOnce();
  });
  it("falls back safely before the texture loads", () => {
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      setAttr: vi.fn(),
      stroke: vi.fn(),
      createPattern: vi.fn(),
    };
    paintFogBrushStroke(
      context as unknown as Konva.Context,
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      8,
      null,
      "#222",
    );
    expect(context.setAttr).toHaveBeenCalledWith("strokeStyle", "#222");
    expect(context.createPattern).not.toHaveBeenCalled();
  });
});
