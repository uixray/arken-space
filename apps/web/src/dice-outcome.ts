import {
  DICE_FRAME_SOURCES,
  type DiceFrameChoice,
  type DiceFrameReference,
  type DiceFrameSource,
  type DiceSemanticOutcome,
} from "@arken/contracts";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function parseDiceSemanticOutcome(
  value: unknown,
): DiceSemanticOutcome | null {
  if (!record(value)) return null;
  const kind = value.kind;
  const kept = value.keptNaturalD20;
  if (kind === "CRITICAL_FAILURE" && kept === 1)
    return { kind, keptNaturalD20: 1 };
  if (kind === "CRITICAL_SUCCESS" && kept === 20)
    return { kind, keptNaturalD20: 20 };
  if (
    kind === "NORMAL" &&
    (kept === null ||
      (typeof kept === "number" &&
        Number.isInteger(kept) &&
        kept >= 1 &&
        kept <= 20))
  )
    return { kind, keptNaturalD20: kept };
  return null;
}

export function normalizeDiceFrameReference(
  value: unknown,
  outcome: DiceSemanticOutcome | null,
): DiceFrameReference | null {
  if (!record(value) || value.setKey !== "ARKEN_CRITICAL_V1") return null;
  const semantic = parseDiceSemanticOutcome(outcome);
  if (
    semantic?.kind === "CRITICAL_FAILURE" &&
    value.frameKey === "critical-failure"
  )
    return {
      setKey: "ARKEN_CRITICAL_V1",
      frameKey: "critical-failure",
    };
  if (
    semantic?.kind === "CRITICAL_SUCCESS" &&
    value.frameKey === "critical-success"
  )
    return {
      setKey: "ARKEN_CRITICAL_V1",
      frameKey: "critical-success",
    };
  return null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UIX-457: рамка-оформление из истории; чужая форма просто не рисуется. */
export function normalizeDiceStyleFrame(
  value: unknown,
): DiceFrameChoice | null {
  if (
    !record(value) ||
    typeof value.assetId !== "string" ||
    !UUID_PATTERN.test(value.assetId) ||
    !DICE_FRAME_SOURCES.includes(value.source as DiceFrameSource)
  )
    return null;
  return { assetId: value.assetId, source: value.source as DiceFrameSource };
}
