import type { GameSnapshot } from "@arken/contracts";
import { api } from "./api";
import {
  optimisticPlacementToken,
  type OptimisticTokenMutations,
  type TokenPlacementOptions,
  type TokenPlacementOutcome,
  type TokenPlacementRequest,
} from "./optimistic-token-mutations";

export type OptimisticTokenPlacer = (
  request: TokenPlacementRequest,
  options?: TokenPlacementOptions,
) => Promise<
  | TokenPlacementOutcome
  | { status: "skipped"; reason: "not-ready" | "paused" | "missing-scene" }
>;

/** Shared production adapter; reads current state only when a user places a token. */
export function createOptimisticTokenPlacer(dependencies: {
  readSnapshot: () => GameSnapshot | null;
  tokenMutations: OptimisticTokenMutations;
  clearError: () => void;
}): OptimisticTokenPlacer {
  return (request, options) => {
    const current = dependencies.readSnapshot();
    if (!current)
      return Promise.resolve({ status: "skipped", reason: "not-ready" });
    if (current.campaign.paused)
      return Promise.resolve({ status: "skipped", reason: "paused" });
    request = {
      ...request,
      body: { ...request.body, placementId: request.body.actionId },
    };
    const temporary = optimisticPlacementToken(current, request);
    if (!temporary)
      return Promise.resolve({ status: "skipped", reason: "missing-scene" });
    if (options?.errorOwner !== "caller") dependencies.clearError();
    return dependencies.tokenMutations.place(
      temporary,
      () =>
        api(request.path, {
          method: "POST",
          body: JSON.stringify(request.body),
        }),
      options,
    );
  };
}
