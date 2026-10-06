import type { TokenDto } from "@arken/contracts";

/** Mutation routes may return a raw placement row, not a bootstrap projection. */
export function mergeTokenPlacementUpdate(
  previous: TokenDto,
  update: Partial<TokenDto>,
): TokenDto {
  return { ...previous, ...update };
}
