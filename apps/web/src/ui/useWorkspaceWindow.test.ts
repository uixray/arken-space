import { describe, expect, it } from "vitest";
import { clampWorkspaceWindowPosition } from "./useWorkspaceWindow";

describe("workspace window position", () => {
  it("keeps a dragged window inside every viewport edge", () => {
    expect(
      clampWorkspaceWindowPosition(
        { left: -120, top: 900 },
        { width: 720, height: 500 },
        { width: 1280, height: 800 },
      ),
    ).toEqual({ left: 16, top: 284 });
  });

  it("uses a reachable gutter when a transient viewport is smaller than the window", () => {
    expect(
      clampWorkspaceWindowPosition(
        { left: 300, top: 300 },
        { width: 720, height: 760 },
        { width: 600, height: 500 },
      ),
    ).toEqual({ left: 16, top: 16 });
  });
});
