import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpellProgressionGraph } from "@arken/contracts";
import {
  appendSpellPackDraftVersion,
  fetchSpellPackList,
  fetchSpellPackVersion,
} from "./spell-schools-client";

const graph: SpellProgressionGraph = {
  packId: "10000000-0000-4000-8000-000000000001",
  versionId: "20000000-0000-4000-8000-000000000001",
  version: 2,
  title: "GM draft",
  lifecycle: "DRAFT",
  provenance: {
    sourceType: "GM_AUTHORED",
    sourceLabel: "Draft",
    rawSourceText: "",
  },
  schools: [],
  nodes: [],
  requirementGroups: [],
  edges: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("spell-pack editor client response contracts", () => {
  it("pins the safe campaign list summary shape and URL", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          packs: [
            {
              id: graph.packId,
              latestVersionId: graph.versionId,
              latestVersion: 2,
              lifecycle: "DRAFT",
              title: "GM draft",
              createdAt: "2026-10-09T00:00:00.000Z",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(fetchSpellPackList()).resolves.toEqual([
      {
        id: graph.packId,
        latestVersionId: graph.versionId,
        latestVersion: 2,
        lifecycle: "DRAFT",
        title: "GM draft",
        createdAt: "2026-10-09T00:00:00.000Z",
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/spell-packs",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("requests a specific immutable version and retries with the supplied action identity", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            packId: graph.packId,
            versionId: graph.versionId,
            version: graph.version,
            lifecycle: graph.lifecycle,
            graph,
            warnings: [],
            createdAt: "2026-10-09T00:00:00.000Z",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            packId: graph.packId,
            versionId: graph.versionId,
            version: graph.version,
            lifecycle: graph.lifecycle,
            graph,
            warnings: [],
            createdAt: "2026-10-09T00:00:00.000Z",
          }),
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetch);

    await fetchSpellPackVersion(graph.packId, graph.versionId);
    const actionId = "30000000-0000-4000-8000-000000000001";
    await appendSpellPackDraftVersion(graph, 1, actionId);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `/api/spell-packs/${graph.packId}/versions/${graph.versionId}`,
    );
    const submitted = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(submitted).toEqual({ actionId, expectedVersion: 1, graph });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `/api/spell-packs/${graph.packId}/versions`,
    );
  });
});
