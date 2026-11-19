import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  isCanonicalRepositoryPath,
  UIX694_IMPACT_MAP,
  UIX694_REVIEWED_PATHS,
  selectImpact,
  validateImpactMap,
} from "../scripts/qa/impact-map.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const readText = (path: string) => {
  const absolute = resolve(repositoryRoot, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
};
const select = (map: unknown, paths: string[]) =>
  selectImpact(map, paths, { readText });
const cloneMap = () => structuredClone(UIX694_IMPACT_MAP);

function expectInvalidSelection(
  map: unknown,
  path = "tests/e2e/mocked-chat-app.ts",
) {
  const result = select(map, [path]);
  expect(result.reviewRequired).toBe(true);
  expect(result.unmatchedPaths).toEqual([path]);
  expect(result.journeys).toEqual([]);
  expect(result.validationErrors.length).toBeGreaterThan(0);
}

describe("UIX-694 advisory impact map", () => {
  it("keeps shared campaign setup manual even when narrow checks are mapped", () => {
    const result = select(UIX694_IMPACT_MAP, [
      "tests/e2e/owned-campaign-history.ts",
      "tests/e2e/campaign-fixture.ts",
    ]);
    expect(result.validationErrors).toEqual([]);
    expect(result.unmatchedPaths).toEqual([]);
    expect(result.reviewRequired).toBe(true);
    expect(result.matchedRules).toEqual([
      expect.objectContaining({
        id: "owned-campaign-history",
        manualReview: true,
      }),
    ]);
    expect(result.journeys.map((j) => j.spec)).toEqual([
      "tests/owned-campaign-history.test.ts",
      "tests/chat-history-fixture.test.ts",
    ]);
    for (const value of [false, "yes", undefined]) {
      const candidate = cloneMap();
      const rule = candidate.rules.find(
        (r) => r.id === "owned-campaign-history",
      )!;
      if (value === undefined) delete rule.manualReview;
      else (rule as unknown as { manualReview: unknown }).manualReview = value;
      expect(validateImpactMap(candidate, { readText }).valid).toBe(false);
    }
  });
  it("does not treat label DOM checks as complete browser paint acceptance", () => {
    const result = select(UIX694_IMPACT_MAP, [
      "apps/web/src/cartographic-label-placement.css",
    ]);
    expect(result.validationErrors).toEqual([]);
    expect(result.unmatchedPaths).toEqual([]);
    expect(result.reviewRequired).toBe(true);
    expect(result.matchedRules[0].manualReview).toBe(true);
  });
  it("suggests bounded label checks but leaves shared styles and map ownership for review", () => {
    const result = select(UIX694_IMPACT_MAP, [
      "apps/web/src/cartographic-label-placement.css",
      "apps/web/src/CartographicLabelFields.tsx",
      "apps/web/src/styles.css",
      "apps/web/src/WorldMapsWorkspace.tsx",
    ]);
    expect(result.matchedRules.map(({ id }) => id)).toEqual([
      "cartographic-label-presentation",
    ]);
    expect(result.journeys.map(({ spec }) => spec)).toEqual([
      "apps/web/src/PositionedCartographicLabel.test.tsx",
      "apps/web/src/CartographicLabelFields.test.tsx",
    ]);
    expect(result.unmatchedPaths).toEqual([
      "apps/web/src/styles.css",
      "apps/web/src/WorldMapsWorkspace.tsx",
    ]);
    expect(result.reviewRequired).toBe(true);
    expect(result.advisoryOnly).toBe(true);
  });

  it("validates its exact reviewed paths and every source-backed full journey", () => {
    expect(validateImpactMap(UIX694_IMPACT_MAP, { readText })).toEqual({
      valid: true,
      errors: [],
    });
    expect(UIX694_IMPACT_MAP.reviewedPaths).toEqual(UIX694_REVIEWED_PATHS);
    expect(isCanonicalRepositoryPath("tests/e2e/spec.ts")).toBe(true);
    expect(isCanonicalRepositoryPath("tests\\e2e\\spec.ts")).toBe(false);
    expect(isCanonicalRepositoryPath("C:relative.ts")).toBe(false);
    expect(isCanonicalRepositoryPath("https://example.test/spec.ts")).toBe(
      false,
    );
  });

  it("maps a transport change to complete consumers and the strict API contract", () => {
    const result = select(UIX694_IMPACT_MAP, [
      "tests/e2e/mocked-chat-app.ts",
      "tests/e2e/uix289-bundled-motion.spec.ts",
      "tests/e2e/chat-icon-states.spec.ts",
      "tests/mocked-chat-app.test.ts",
    ]);
    expect(result.advisoryOnly).toBe(true);
    expect(result.reviewRequired).toBe(false);
    expect(result.unmatchedPaths).toEqual([]);
    expect(result.validationErrors).toEqual([]);
    expect(result.journeys.map((journey) => journey.spec)).toEqual([
      "tests/e2e/uix289-bundled-motion.spec.ts",
      "tests/e2e/chat-icon-states.spec.ts",
      "tests/mocked-chat-app.test.ts",
      "tests/mock-api-contract.test.ts",
    ]);
  });

  it("keeps unknown-only and mixed changes visible for human review", () => {
    const unknown = select(UIX694_IMPACT_MAP, ["apps/server/src/chat.ts"]);
    expect(unknown.journeys).toEqual([]);
    expect(unknown.unmatchedPaths).toEqual(["apps/server/src/chat.ts"]);
    expect(unknown.reviewRequired).toBe(true);

    const mixed = select(UIX694_IMPACT_MAP, [
      "tests/e2e/mocked-chat-app.ts",
      "packages/db/src/schema.ts",
    ]);
    expect(mixed.journeys.length).toBeGreaterThan(0);
    expect(mixed.unmatchedPaths).toEqual(["packages/db/src/schema.ts"]);
    expect(mixed.reviewRequired).toBe(true);
  });

  it("deduplicates paths and journeys deterministically", () => {
    const result = select(UIX694_IMPACT_MAP, [
      "tests/qa-impact-map.test.ts",
      "scripts/qa/impact-map.mjs",
      "tests/qa-impact-map.test.ts",
    ]);
    expect(result.journeys.map((journey) => journey.spec)).toEqual([
      "tests/qa-impact-map.test.ts",
    ]);
    expect(result.reviewRequired).toBe(false);

    const duplicate = cloneMap();
    duplicate.rules[1].journeys.push({ ...duplicate.rules[1].journeys[0] });
    expect(
      select(duplicate, ["scripts/qa/impact-map.mjs"]).journeys,
    ).toHaveLength(1);
  });

  it("maps realtime changes to all three local journeys and keeps shared contracts for review", () => {
    const result = select(UIX694_IMPACT_MAP, [
      "apps/server/src/realtime.ts",
      "apps/server/src/preview-snapshot.ts",
      "apps/server/src/account-link-realtime.integration.test.ts",
      "packages/contracts/src/index.ts",
    ]);
    expect(result.validationErrors).toEqual([]);
    expect(result.matchedRules.map(({ id }) => id)).toEqual([
      "realtime-campaign-boundary",
    ]);
    expect(result.journeys.map(({ spec }) => spec)).toEqual([
      "tests/realtime.test.ts",
      "apps/server/src/account-link-realtime.integration.test.ts",
      "apps/server/src/account-realtime-auth.integration.test.ts",
    ]);
    expect(result.journeys.every((journey) => journey.fullFile)).toBe(true);
    expect(result.unmatchedPaths).toEqual(["packages/contracts/src/index.ts"]);
    expect(result.reviewRequired).toBe(true);
    expect(result.advisoryOnly).toBe(true);
  });

  it("fails selection closed for invalid version, forbidden fields, unreviewed paths, and empty journeys", () => {
    const badVersion = cloneMap();
    badVersion.version = 2;
    expectInvalidSelection(badVersion);

    const forbidden = cloneMap();
    Object.assign(forbidden, { bypassGate: true });
    expectInvalidSelection(forbidden);

    const unreviewed = cloneMap();
    unreviewed.rules[0].paths[0] = "apps/server/src/chat.ts";
    expectInvalidSelection(unreviewed);

    const emptyJourneys = cloneMap();
    emptyJourneys.rules[0].journeys = [];
    expectInvalidSelection(emptyJourneys);
  });

  it("rejects noncanonical journey paths before invoking caller I/O", () => {
    const unsafePaths = [
      "../outside.ts",
      "tests/../../outside.ts",
      "tests\\..\\outside.ts",
      "C:/outside.ts",
      "C:relative.ts",
      "https://example.test/spec.ts",
      "/outside.ts",
      "tests//outside.ts",
      "tests/./outside.ts",
      "tests/\u0000bad.ts",
    ];
    for (const unsafePath of unsafePaths) {
      const candidate = cloneMap();
      candidate.rules[0].journeys[0].spec = unsafePath;
      const reader = vi.fn(readText);
      const result = validateImpactMap(candidate, { readText: reader });
      expect(result.valid).toBe(false);
      expect(reader).not.toHaveBeenCalledWith(unsafePath);
    }

    for (const code of [
      ...Array.from({ length: 32 }, (_, index) => index),
      127,
    ]) {
      const unsafePath = `tests/${String.fromCharCode(code)}bad.ts`;
      const candidate = cloneMap();
      candidate.rules[0].journeys[0].spec = unsafePath;
      const reader = vi.fn(readText);
      const result = validateImpactMap(candidate, { readText: reader });

      expect(isCanonicalRepositoryPath(unsafePath)).toBe(false);
      expect(result.valid).toBe(false);
      expect(reader).not.toHaveBeenCalledWith(unsafePath);
    }

    expect(isCanonicalRepositoryPath("tests/space 32/tilde~126/spec.ts")).toBe(
      true,
    );

    const invalidReader = validateImpactMap(UIX694_IMPACT_MAP, {
      readText: null,
    });
    expect(invalidReader.valid).toBe(false);
    expect(invalidReader.errors).toContain("readText callback is required");

    const throwingReader = () => {
      throw new Error("reader unavailable");
    };
    expect(() =>
      validateImpactMap(UIX694_IMPACT_MAP, { readText: throwingReader }),
    ).not.toThrow();
    expect(
      validateImpactMap(UIX694_IMPACT_MAP, { readText: throwingReader }).valid,
    ).toBe(false);
    expect(
      selectImpact(UIX694_IMPACT_MAP, ["tests/e2e/mocked-chat-app.ts"], {
        readText: throwingReader,
      }).reviewRequired,
    ).toBe(true);
  });

  it("rejects absent source references and unsupported evidence kinds", () => {
    const missing = cloneMap();
    missing.rules[0].journeys[0].spec = "tests/missing.spec.ts";
    expect(validateImpactMap(missing, { readText }).errors).toContain(
      "journey spec does not exist: tests/missing.spec.ts",
    );

    const unsupported = cloneMap();
    unsupported.rules[0].journeys[0].evidenceKind = "production";
    expect(validateImpactMap(unsupported, { readText }).errors).toContain(
      "journey evidenceKind is unsupported",
    );
  });

  it("rejects malformed identifiers, invariants, requirements, and literal case inventories", () => {
    const invalid = cloneMap();
    invalid.rules[0].invariant = "  ";
    invalid.rules[0].journeys[0].requirements = ["preserve", ""];
    invalid.rules[0].journeys[0].caseTitles[1] =
      invalid.rules[0].journeys[0].caseTitles[0];
    const result = validateImpactMap(invalid, { readText });
    expect(result.errors).toContain("rule invariant must be non-empty");
    expect(result.errors).toContain(
      "journey requirements must be a non-empty array of non-empty strings",
    );
    expect(result.errors).toContain("caseTitles must not contain duplicates");

    const duplicateIds = cloneMap();
    duplicateIds.rules[1].id = duplicateIds.rules[0].id;
    expect(validateImpactMap(duplicateIds, { readText }).errors).toContain(
      "rule ids must be unique",
    );

    const emptyRequirements = cloneMap();
    emptyRequirements.rules[0].journeys[0].requirements = [];
    expect(validateImpactMap(emptyRequirements, { readText }).valid).toBe(
      false,
    );
  });

  it("requires positive exact browser counts and validates the role-width matrix values", () => {
    for (const count of [0, -1, 4.5, undefined]) {
      const candidate = cloneMap();
      if (count === undefined)
        delete candidate.rules[0].journeys[0].expectedCaseCount;
      else candidate.rules[0].journeys[0].expectedCaseCount = count;
      expect(validateImpactMap(candidate, { readText }).valid).toBe(false);
    }

    const badMatrix = cloneMap();
    badMatrix.rules[0].journeys[1].parameterMatrix = {
      role: ["GM", "GM"],
      width: [1280, 360],
    };
    expect(validateImpactMap(badMatrix, { readText }).errors).toContain(
      "chat icon matrix must be GM/PLAYER by 1280/360 with exactly four cases",
    );

    const badTemplate = cloneMap();
    badTemplate.rules[0].journeys[1].titleTemplate = "not a source title";
    expect(validateImpactMap(badTemplate, { readText }).valid).toBe(false);

    const sourceBackedWidthReader = (path: string) => {
      const source = readText(path);
      return path === "tests/e2e/chat-icon-states.spec.ts" && source
        ? source.replace("[1280, 360]", "[1280, 390]")
        : source;
    };
    expect(
      sourceBackedWidthReader("tests/e2e/chat-icon-states.spec.ts"),
    ).not.toBe(readText("tests/e2e/chat-icon-states.spec.ts"));
    expect(
      validateImpactMap(UIX694_IMPACT_MAP, {
        readText: sourceBackedWidthReader,
      }).errors,
    ).toContain(
      "chat icon source loops must declare GM/PLAYER and widths 1280/360",
    );

    const sourceBackedRoleReader = (path: string) => {
      const source = readText(path);
      return path === "tests/e2e/chat-icon-states.spec.ts" && source
        ? source.replace('["GM", "PLAYER"] as const', '["GM", "GM"] as const')
        : source;
    };
    expect(
      sourceBackedRoleReader("tests/e2e/chat-icon-states.spec.ts"),
    ).not.toBe(readText("tests/e2e/chat-icon-states.spec.ts"));
    expect(
      validateImpactMap(UIX694_IMPACT_MAP, {
        readText: sourceBackedRoleReader,
      }).errors,
    ).toContain(
      "chat icon source loops must declare GM/PLAYER and widths 1280/360",
    );
  });

  it("requires a reader at the public selection boundary and preserves malformed inputs", () => {
    const result = selectImpact(UIX694_IMPACT_MAP, [
      "tests/e2e/mocked-chat-app.ts",
    ]);
    expect(result.reviewRequired).toBe(true);
    expect(result.unmatchedPaths).toEqual(["tests/e2e/mocked-chat-app.ts"]);
    expect(result.validationErrors).toContain("readText callback is required");

    const noncanonical = select(UIX694_IMPACT_MAP, [
      "tests\\..\\apps\\server\\chat.ts",
    ]);
    expect(noncanonical.reviewRequired).toBe(true);
    expect(noncanonical.unmatchedPaths).toEqual([
      "tests\\..\\apps\\server\\chat.ts",
    ]);
  });
});
