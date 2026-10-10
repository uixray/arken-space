import { Rect } from "react-konva";
import { useFogPattern } from "./useFogPattern";

/** The only per-frame React subtree: a single decorative fill, never mask geometry. */
export function FogPatternOverlay({ width, height }: { width: number; height: number }) {
  const { image, offset } = useFogPattern();
  if (!image) return null;

  return (
    <Rect
      width={width}
      height={height}
      // Konva's prop is typed narrowly as HTMLImageElement, while Canvas2D
      // accepts HTMLCanvasElement as a repeating pattern source.
      fillPatternImage={image as unknown as HTMLImageElement}
      fillPatternRepeat="repeat"
      fillPatternScaleX={4}
      fillPatternScaleY={4}
      fillPatternOffsetX={offset.x}
      fillPatternOffsetY={offset.y}
      globalCompositeOperation="source-atop"
      listening={false}
    />
  );
}
