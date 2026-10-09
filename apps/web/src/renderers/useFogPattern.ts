import { useEffect, useState } from "react";
import { createFogCloudAnimation } from "./fog-cloud-animation";

export type FogPatternState = {
  image: HTMLCanvasElement | null;
  offset: { x: number; y: number };
};

/** Owns the decorative tile lifecycle; a null tile leaves solid fog untouched. */
export function useFogPattern(): FogPatternState {
  const [state, setState] = useState<FogPatternState>({
    image: null,
    offset: { x: 0, y: 0 },
  });

  useEffect(() => {
    let animation: ReturnType<typeof createFogCloudAnimation> = null;
    try {
      animation = createFogCloudAnimation(
        (offset) => setState((current) => ({ ...current, offset })),
        () => setState((current) => ({ ...current, image: null })),
      );
      setState({ image: animation?.canvas ?? null, offset: { x: 0, y: 0 } });
    } catch {
      // Texture generation is non-authoritative. The renderer always keeps its
      // opaque solid fill and simply omits the decorative overlay on failure.
      setState((current) => ({ ...current, image: null }));
    }
    return () => animation?.dispose();
  }, []);

  return state;
}
