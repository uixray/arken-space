import type { CatalogEntryDto, CharacterDto } from "@arken/contracts";

/**
 * UIX-391: the "add existing" catalog picker must never offer an entry the
 * character already has, since assigning it again is a duplicate. This is
 * the client-side half of duplicate-assignment prevention (the server also
 * rejects a genuine duplicate — see the `/api/characters/:id/catalog` POST
 * handler in apps/server/src/routes.ts, which checks
 * characterCatalogEntries for an existing row with the same
 * sourceCatalogEntryId and returns 409 CATALOG_ALREADY_ASSIGNED).
 *
 * Matching is by sourceCatalogEntryId (the link a character.entries row
 * keeps back to the catalog entry it was assigned from), not by name/kind,
 * so a renamed or re-described catalog entry is still recognized as already
 * assigned.
 */
export function selectableCatalogEntries(
  catalogEntries: CatalogEntryDto[],
  characterEntries: CharacterDto["entries"],
  kind: "SKILL" | "ABILITY",
): CatalogEntryDto[] {
  const assignedIds = new Set(
    characterEntries
      .map((entry) => entry.sourceCatalogEntryId)
      .filter((id): id is string => Boolean(id)),
  );
  return catalogEntries.filter(
    (entry) => entry.kind === kind && !assignedIds.has(entry.id),
  );
}
