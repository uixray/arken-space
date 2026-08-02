import type {
  CharacterDto,
  PlayerRequestAudience,
  PlayerRequestDto,
  PlayerRequestHorizon,
  PlayerRequestListState,
} from "@arken/contracts";

export const requestLabels = {
  audience: { PUBLIC: "Всем участникам", GM_ONLY: "Автору и всем мастерам" },
  horizon: { NOW: "Сейчас", BEFORE_BREAK: "До перерыва", NEXT_SESSION: "К следующей сессии" },
  status: { SUBMITTED: "Отправлена", ACKNOWLEDGED: "Принята", RESOLVED: "Решена", DECLINED: "Отклонена", CANCELLED: "Отменена" },
} as const;

export type PlayerRequestFilters = {
  state: PlayerRequestListState | "ALL";
  horizon: PlayerRequestHorizon | "ALL";
  audience: PlayerRequestAudience | "ALL";
};

export function visiblePlayerRequests(
  requests: readonly PlayerRequestDto[],
  membershipId: string,
  role: "GM" | "PLAYER",
  filters: PlayerRequestFilters,
) {
  return requests.filter((request) => {
    if (role === "PLAYER" && request.authorMembershipId !== membershipId) return false;
    const open = request.status === "SUBMITTED" || request.status === "ACKNOWLEDGED";
    if (filters.state !== "ALL" && (filters.state === "OPEN") !== open) return false;
    if (filters.horizon !== "ALL" && request.horizon !== filters.horizon) return false;
    return filters.audience === "ALL" || request.audience === filters.audience;
  });
}

export function requestCharacters(characters: readonly CharacterDto[], membershipId: string, activeCharacterId: string | null) {
  return characters.filter(
    (character) =>
      character.ownerMembershipId === membershipId ||
      character.controllerMembershipIds.includes(membershipId) ||
      character.id === activeCharacterId,
  );
}

export const canEditRequest = (request: PlayerRequestDto, membershipId: string) =>
  request.authorMembershipId === membershipId && request.status === "SUBMITTED";
export const canCancelRequest = (request: PlayerRequestDto, membershipId: string) =>
  request.authorMembershipId === membershipId &&
  (request.status === "SUBMITTED" || request.status === "ACKNOWLEDGED");

export function createRequestPayload(input: {
  title: string; body: string; horizon: PlayerRequestHorizon;
  audience: PlayerRequestAudience; characterId: string;
}) {
  return {
    title: input.title.trim(), body: input.body.trim(), horizon: input.horizon,
    audience: input.audience, characterId: input.characterId || null,
  };
}
