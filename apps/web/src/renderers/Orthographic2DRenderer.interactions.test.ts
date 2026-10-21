import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rendererSource = readFileSync(
  new URL("./Orthographic2DRenderer.tsx", import.meta.url),
  "utf8",
);

describe("Orthographic2DRenderer persisted drawing interactions", () => {
  it("shows token names only while hovered or selected, not just movable", () => {
    const nameBlock = rendererSource.slice(
      rendererSource.indexOf("const nameText ="),
      rendererSource.indexOf(
        "{hoveredTokenId === token.id && token.conditions",
      ),
    );
    expect(nameBlock).toMatch(
      /visible=\{\s*hoveredTokenId === token.id \|\|\s*selectedTokenIds.includes\(token.id\)/,
    );
    expect(nameBlock).not.toMatch(/\|\| canMove|\|\| isStackRepresentative/);
  });

  it("keeps the GM layer available without a redundant map-scale control", () => {
    const scaleBlock = rendererSource.slice(
      rendererSource.indexOf('<div className="map-scale">'),
    );
    expect(rendererSource).toContain("const showGmLayer = true;");
    expect(scaleBlock).not.toContain("setShowGmLayer((visible) => !visible)");
    expect(scaleBlock).not.toContain("Показывать скрытый слой мастера");
    expect(scaleBlock).not.toContain("checked={showGmLayer}");
  });

  it("keeps the ACL-gated drawing group hittable through its foreground stroke", () => {
    const drawingBlock = rendererSource.slice(
      rendererSource.indexOf(
        "{texturesFirst(props.drawings).map((drawing) => {",
      ),
      rendererSource.indexOf(
        "{pendingDrawings",
        rendererSource.indexOf(
          "{texturesFirst(props.drawings).map((drawing) => {",
        ),
      ),
    );

    expect(drawingBlock).toMatch(
      /const listening\s*=\s*[\s\S]*?drawing\.authorMembershipId/,
    );
    expect(drawingBlock).toMatch(
      /<Group[\s\S]*?listening=\{listening\}[\s\S]*?<\/Group>/,
    );
    expect(drawingBlock).toMatch(
      /stroke=\{visual\.color\.selectionOutline\}[\s\S]*?listening=\{false\}/,
    );
    expect(drawingBlock).toMatch(/stroke=\{drawing\.color\}[\s\S]*?listening/);
    expect(drawingBlock).toMatch(
      /stroke=\{drawing\.color\}[\s\S]*?hitStrokeWidth=/,
    );
  });

  it("keeps cached fog geometry separate from the animated pattern overlay", () => {
    expect(rendererSource).toMatch(
      /mask\.cache\([\s\S]*?\n\s*\}, \[orderedFogReveals, worldDraft\.width, worldDraft\.height\]\);/,
    );
    expect(rendererSource).toContain(
      "<FogPatternOverlay width={worldDraft.width} height={worldDraft.height} />",
    );
  });
});
