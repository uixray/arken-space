export const betaPlayers = [
  { name: "Эд", handle: "archinamon" },
  { name: "Ираклий", handle: "IRAKLY123" },
  { name: "Даша", handle: "DaryaSteel" },
  { name: "Леша", handle: "VeePeeK" },
  { name: "Миша", handle: "Zheludock" },
  { name: "Андрей", handle: "uixray" },
] as const;

export function betaPlayerByHandle(value: string) {
  return betaPlayers.find(
    (player) => player.handle.toLowerCase() === value.toLowerCase(),
  );
}

export function matchesBetaPlayerIdentity(
  player: (typeof betaPlayers)[number],
  candidate: { displayName: string | null; label: string | null },
) {
  const expected = new Set(
    [player.name, player.handle].map((value) => value.toLocaleLowerCase("ru")),
  );
  return [candidate.displayName, candidate.label].some(
    (value) => value != null && expected.has(value.toLocaleLowerCase("ru")),
  );
}
