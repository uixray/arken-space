import { describe, expect, it } from "vitest";
import { mapDeleteScope, type MapDeleteRequest } from "./map-delete";
const request: MapDeleteRequest = {
  sceneId: "scene",
  targets: [
    { targetType: "TOKEN", targetId: "token", revision: 0 },
    { targetType: "DRAWING", targetId: "drawing", revision: 1 },
  ],
};
const key = (value = request) => mapDeleteScope(value, "PLAYER", "member");
describe("destructive group confirmation scope", () => {
  it("does not invalidate merely reordered targets", () => {
    expect(key({ ...request, targets: [...request.targets].reverse() })).toBe(
      key(),
    );
  });
  it.each(["revision", "removed", "replaced", "scene"])(
    "invalidates %s",
    (change) => {
      const changed = structuredClone(request);
      const first = changed.targets[0];
      if (!first) throw new Error("Missing fixture token");
      if (change === "revision") first.revision++;
      if (change === "removed") changed.targets.pop();
      if (change === "replaced") first.targetId = "other";
      if (change === "scene") changed.sceneId = "other";
      expect(key(changed)).not.toBe(key());
    },
  );
  it("binds the confirming actor and role", () => {
    expect(mapDeleteScope(request, "GM", "member")).not.toBe(key());
    expect(mapDeleteScope(request, "PLAYER", "other")).not.toBe(key());
  });
});
