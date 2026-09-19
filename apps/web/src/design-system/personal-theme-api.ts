import type { PersonalThemeDto } from "@arken/contracts";

import { api } from "../api";

type ThemeRequest = (
  path: string,
  init?: RequestInit,
) => Promise<PersonalThemeDto>;

/** Authenticated self-preference boundary; target membership IDs never enter it. */
export async function patchPersonalThemePreference({
  source,
  selectedThemeId,
  signal,
  request = api,
}: {
  source: PersonalThemeDto;
  selectedThemeId: string | null;
  signal: AbortSignal;
  request?: ThemeRequest;
}): Promise<PersonalThemeDto> {
  const updated = await request("/api/me/theme", {
    method: "PATCH",
    signal,
    body: JSON.stringify({
      selectedThemeId,
      expectedRevision: source.revision,
    }),
  });
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (updated.scopeKey !== source.scopeKey)
    throw new Error("Сервер вернул настройки темы для другого игрока.");
  return updated;
}
