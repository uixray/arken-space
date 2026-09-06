import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./Orthographic2DRenderer.tsx", import.meta.url)),
  "utf8",
);

describe("UIX-470 brush preview contract", () => {
  it("uses the world pointer and the same radius as the persisted brush", () => {
    expect(source).toMatch(
      /if \(isBrushTool && props\.role === "GM"\)\s+setBrushHover\(pointerInWorld\(\)\)/,
    );
    expect(source).toMatch(
      /<Circle\s+x=\{brushHover\.x\}\s+y=\{brushHover\.y\}\s+radius=\{brushRadius\}/,
    );
    expect(source).toMatch(/type: "BRUSH",\s+points,\s+radius: brushRadius/);
  });

  it("removes the preview on pointer leave and after changing tools", () => {
    expect(source).toContain("onPointerLeave={() => setBrushHover(null)}");
    expect(source).toMatch(
      /if \(props\.tool !== "FOG_BRUSH" && props\.tool !== "COVER_BRUSH"\)\s+setBrushHover\(null\)/,
    );
  });
});
