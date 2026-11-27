import { z } from "zod";
import type { LocalPeerResponse } from "@arken/contracts";
import { postgresErrorCode } from "./database-errors.js";
export class LocalPeerRejection extends Error {
  constructor(
    readonly failure: NonNullable<LocalPeerResponse["commandError"]>,
  ) {
    super(failure.code);
  }
}
/** Only fixed public domain codes cross the peer boundary. Database failures,
 * raw exceptions, receipts and audit/private targets never become a response. */
export async function localAbilityCommand<T>(
  kind: "AREA_APPLY" | "AREA_CANCEL" | "APPLICATION_UNDO",
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const forbidden =
      kind === "APPLICATION_UNDO" ? "UNDO_FORBIDDEN" : "AREA_FORBIDDEN";
    const statuses: Record<string, 400 | 403 | 409> = {
      ACTION_CONFLICT: 409,
      [forbidden]: 403,
    };
    if (kind === "APPLICATION_UNDO")
      Object.assign(statuses, { UNDO_NOT_AVAILABLE: 409, UNDO_CONFLICT: 409 });
    if (kind === "AREA_APPLY") {
      for (const value of [
        "CAMPAIGN_PAUSED",
        "AREA_SCENE_UNAVAILABLE",
        "AREA_SCENE_CHANGED",
        "AREA_ORIGIN_UNAVAILABLE",
        "AREA_ORIGIN_CHANGED",
        "ENTRY_CONFLICT",
        "CREATION_CONSUMPTION_UNAVAILABLE",
        "CREATION_APPROVAL_REQUIRED",
        "CREATION_OBJECT_UNAVAILABLE",
        "CREATION_DATA_UNAVAILABLE",
        "AREA_SCALE_REQUIRED",
        "ABILITY_USES_EXHAUSTED",
        "INSUFFICIENT_CHARACTER_RESOURCE",
        "AREA_TARGETS_EMPTY",
      ])
        statuses[value] = 409;
      for (const value of [
        "AREA_PROJECTION_UNSUPPORTED",
        "AREA_EFFECT_REQUIRED",
        "ABILITY_ACTION_COST_MISMATCH",
        "AREA_CAMPAIGN_LIMIT",
        "AREA_SCENE_LIMIT",
      ])
        statuses[value] = 400;
    }
    if (Object.hasOwn(statuses, code))
      throw new LocalPeerRejection({
        status: statuses[code]!,
        code,
        ...(kind === "AREA_APPLY" &&
        code !== "AREA_FORBIDDEN" &&
        code !== "ACTION_CONFLICT"
          ? { notApplied: true as const }
          : {}),
      });
    if (kind === "AREA_APPLY" && error instanceof z.ZodError)
      throw new LocalPeerRejection({
        status: 400,
        code: "AREA_CONFIGURATION_INVALID",
        notApplied: true,
      });
    const retry = localAbilityTransactionFailure(kind, error);
    if (retry) throw retry;
    throw error;
  }
}

/** The outer authority COMMIT can abort after the nested domain function returns.
 * Never turn that into notApplied: an earlier identical attempt may have committed. */
export function localAbilityTransactionFailure(
  kind: "AREA_APPLY" | "AREA_CANCEL" | "APPLICATION_UNDO",
  error: unknown,
) {
  const dbCode = postgresErrorCode(error);
  if (["40001", "40P01", "23505"].includes(dbCode ?? ""))
    return new LocalPeerRejection({
      status: 409,
      code:
        kind === "APPLICATION_UNDO"
          ? dbCode === "23505"
            ? "ACTION_CONFLICT"
            : "UNDO_CONFLICT"
          : "AREA_RETRY",
    });
  return undefined;
}

export {LocalPeerRejection as LocalAbilityRejection};
