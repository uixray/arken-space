import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: apiMock,
}));

import { fetchCanonicalLocationsForMap } from "./world-map-canonical-location-client";

describe("map canonical location client", () => {
  it("loads only role-authorized canonical LOCATION options", async () => {
    apiMock.mockResolvedValueOnce([{ id: "location-id", name: "Harbor" }]);
    await expect(fetchCanonicalLocationsForMap()).resolves.toEqual([
      { id: "location-id", name: "Harbor" },
    ]);
    expect(apiMock).toHaveBeenCalledWith("/api/world-content?type=LOCATION");
  });
});
