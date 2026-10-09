import { describe, expect, it } from "vitest";
import type { WorldContentDto } from "@arken/contracts";
import {
  canonicalDraftFromEntity,
  canonicalEditPatch,
  createCanonicalEditEnvelope,
  reapplyCanonicalEditPatch,
} from "./canonical-edit-state";

const base: WorldContentDto = {
  id: "entity-id",
  slug: "silver-coast",
  type: "LOCATION",
  subtype: "Port",
  name: "Silver Coast",
  aliases: ["The Coast"],
  summary: "Old summary",
  publicText: "Public v1",
  gmOnlyText: "GM v1",
  tags: ["coast"],
  coverAssetId: null,
  provenance: {
    sourceUrl: null,
    sourceExternalId: null,
    retrievedAt: null,
    rawContentHash: null,
    attribution: null,
    rightsReviewStatus: null,
    editorialApprovalStatus: null,
  },
  lifecycle: "PUBLISHED",
  revision: 4,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("canonical edit recovery state", () => {
  it("captures only intentional fields in an immutable action/revision envelope", () => {
    const draft = {
      ...canonicalDraftFromEntity(base),
      name: "Silver Coast Revised",
      gmOnlyText: "GM v2",
    };
    const patch = canonicalEditPatch(base, draft);
    const envelope = createCanonicalEditEnvelope(base, patch, "action-one");

    expect(envelope).toMatchObject({
      entityId: base.id,
      actionId: "action-one",
      revision: 4,
      payload: { name: "Silver Coast Revised", gmOnlyText: "GM v2" },
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.payload)).toBe(true);
  });

  it("reapplies only changed keys over latest data, preserving concurrent untouched fields", () => {
    const localDraft = {
      ...canonicalDraftFromEntity(base),
      name: "Local Name",
    };
    const patch = canonicalEditPatch(base, localDraft);
    const latest: WorldContentDto = {
      ...base,
      revision: 5,
      summary: "Concurrent summary",
      gmOnlyText: "Concurrent GM text",
    };
    const merged = reapplyCanonicalEditPatch(latest, patch);

    expect(merged.name).toBe("Local Name");
    expect(merged.summary).toBe("Concurrent summary");
    expect(merged.gmOnlyText).toBe("Concurrent GM text");
  });
});
