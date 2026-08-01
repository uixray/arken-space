export function normalizeCharacterControllerIds(
  controllerMembershipIds: readonly string[],
  ownerMembershipId: string | null,
): string[] {
  return [
    ...new Set([
      ...(ownerMembershipId ? [ownerMembershipId] : []),
      ...controllerMembershipIds,
    ]),
  ];
}
