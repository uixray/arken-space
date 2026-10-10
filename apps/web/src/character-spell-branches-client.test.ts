import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSchoolAssignmentEnvelope,
  loadAssignableSchools,
  loadCharacterSchoolBranches,
  submitSchoolAssignment,
} from "./character-spell-branches-client";

const versionId = "10000000-0000-4000-8000-000000000001";
const secondVersionId = "10000000-0000-4000-8000-000000000002";
const packId = "20000000-0000-4000-8000-000000000001";
const schoolId = "30000000-0000-4000-8000-000000000001";
const characterId = "40000000-0000-4000-8000-000000000001";

afterEach(() => vi.unstubAllGlobals());

describe("character spell-branch API client", () => {
  it("builds a stable SCHOOL-only command envelope from a selected active school", () => {
    const envelope = createSchoolAssignmentEnvelope({
      packId,
      packVersionId: versionId,
      packVersion: 7,
      packTitle: "Custom pack",
      schoolId,
      schoolName: "Custom school",
      visibilityPolicy: "ASSIGNED_ONLY",
    });

    expect(envelope).toMatchObject({
      expectedVersion: 0,
      packId,
      packVersionId: versionId,
      target: { kind: "SCHOOL", schoolId },
    });
    expect(envelope.actionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(envelope.assignmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(envelope.assignmentVersionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      new Set([
        envelope.actionId,
        envelope.assignmentId,
        envelope.assignmentVersionId,
      ]).size,
    ).toBe(3);
  });

  it("follows explicit version and assignment cursors without dropping later pages", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schools: [
              {
                packId,
                packVersionId: versionId,
                packVersion: 1,
                packTitle: "Custom pack",
                schoolId,
                schoolName: "Zero-node custom school",
                visibilityPolicy: "PUBLIC",
              },
            ],
            nextCursor: versionId,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schools: [],
            nextCursor: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            branches: [
              {
                packId,
                packVersionId: versionId,
                packVersion: 1,
                schoolId,
                schoolName: "Zero-node custom school",
              },
            ],
            nextCursor: secondVersionId,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ branches: [], nextCursor: null }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(loadAssignableSchools()).resolves.toHaveLength(1);
    await expect(loadCharacterSchoolBranches(characterId)).resolves.toEqual([
      {
        packId,
        packVersionId: versionId,
        packVersion: 1,
        schoolId,
        schoolName: "Zero-node custom school",
      },
    ]);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/spell-assignable-schools",
      `/api/spell-assignable-schools?afterVersionId=${versionId}`,
      `/api/characters/${characterId}/spell-branches`,
      `/api/characters/${characterId}/spell-branches?afterAssignmentId=${secondVersionId}`,
    ]);
  });

  it("sends a supplied envelope unchanged for exact retry", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          assignmentId: "50000000-0000-4000-8000-000000000001",
          assignmentVersionId: "50000000-0000-4000-8000-000000000002",
          version: 1,
          characterId,
          packId,
          packVersionId: versionId,
          kind: "SCHOOL",
          schoolId,
          nodeId: null,
          rank: null,
          snapshot: {},
          overrideReason: null,
          assignedByMembershipId: "60000000-0000-4000-8000-000000000001",
          createdAt: "2026-10-09T00:00:00.000Z",
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const command = createSchoolAssignmentEnvelope({
      packId,
      packVersionId: versionId,
      packVersion: 1,
      packTitle: "Pack",
      schoolId,
      schoolName: "School",
      visibilityPolicy: "PUBLIC",
    });

    await submitSchoolAssignment(characterId, command);
    expect(fetch).toHaveBeenCalledWith(
      `/api/characters/${characterId}/spell-assignments`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(command),
      }),
    );
  });
});
