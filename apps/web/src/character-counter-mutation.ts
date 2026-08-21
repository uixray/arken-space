import type { CharacterDto } from "@arken/contracts";
import type { ResourceCounterIntent } from "./resource-counter-intent";
import { clampResourceValue } from "./resource-regen";
import { normalizeWallet } from "./wallet";

export type CharacterCounterPatch = {
  wallet?: CharacterDto["wallet"];
  resources?: CharacterDto["resources"];
  rest?: "SHORT" | "LONG";
};

export type CharacterCounterMutationIntent = {
  walletDelta?: {
    key: keyof CharacterDto["wallet"];
    delta: number;
  };
  resource?: ResourceCounterIntent;
  resourceMapPatch?: {
    /** Resources visible when the editor started this save. */
    base: CharacterDto["resources"];
    /** Resources the editor deliberately requested. */
    desired: CharacterDto["resources"];
  };
};

type Resource = CharacterDto["resources"][string];
type ResourceField = keyof Resource;

const RESOURCE_FIELDS: readonly ResourceField[] = [
  "current",
  "maximum",
  "description",
  "imageAssetId",
  "recoverable",
];

/** Structural sheet edits preserve fractional custom resources while clamping. */
function clampResourceMapCurrent(resource: Resource): number {
  return Math.min(
    resource.maximum ?? resource.current,
    Math.max(0, resource.current),
  );
}

/**
 * Applies only the keys and fields changed in a character-sheet resource save.
 *
 * The sheet edits a full map, but that map may wait behind a quick DELTA in the
 * same character queue. Replacing the map would restore every unchanged
 * `current` captured by the editor. Diffing against the editor's captured base
 * lets metadata edits preserve those newer values while explicit current
 * changes, additions, deletions and renames still take effect.
 */
export function applyResourceMapPatch(
  latest: CharacterDto["resources"],
  intent: NonNullable<CharacterCounterMutationIntent["resourceMapPatch"]>,
): CharacterDto["resources"] {
  const rebased = { ...latest };
  const keys = new Set([
    ...Object.keys(intent.base),
    ...Object.keys(intent.desired),
  ]);

  for (const key of keys) {
    const baseHasKey = Object.hasOwn(intent.base, key);
    const desiredHasKey = Object.hasOwn(intent.desired, key);

    if (baseHasKey && !desiredHasKey) {
      delete rebased[key];
      continue;
    }
    if (!baseHasKey && desiredHasKey) {
      const added = { ...intent.desired[key]! };
      added.current = clampResourceMapCurrent(added);
      rebased[key] = added;
      continue;
    }
    if (!baseHasKey || !desiredHasKey) continue;

    // Key existence was not edited. If an earlier queued structural mutation
    // removed it, a metadata-only save must not resurrect it.
    const latestResource = rebased[key];
    if (!latestResource) continue;
    const capturedResource = intent.base[key]!;
    const desiredResource = intent.desired[key]!;
    const currentChanged = !Object.is(
      capturedResource.current,
      desiredResource.current,
    );
    const maximumChanged = !Object.is(
      capturedResource.maximum,
      desiredResource.maximum,
    );
    let changed = false;
    const nextResource: Resource = { ...latestResource };
    for (const field of RESOURCE_FIELDS) {
      if (Object.is(capturedResource[field], desiredResource[field])) continue;
      changed = true;
      Object.assign(nextResource, { [field]: desiredResource[field] });
    }
    if (changed && (currentChanged || maximumChanged)) {
      nextResource.current = clampResourceMapCurrent(nextResource);
    }
    if (changed) rebased[key] = nextResource;
  }

  return rebased;
}

function resourceMapsEqual(
  left: CharacterDto["resources"],
  right: CharacterDto["resources"],
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => {
    if (!Object.hasOwn(right, key)) return false;
    const leftResource = left[key]!;
    const rightResource = right[key]!;
    return RESOURCE_FIELDS.every((field) =>
      Object.is(leftResource[field], rightResource[field]),
    );
  });
}

/** True when a rebuilt command would not change counters on its base. */
export function isCharacterCounterPatchNoop(
  base: Pick<CharacterDto, "wallet" | "resources">,
  patch: CharacterCounterPatch,
): boolean {
  if (patch.rest) return false;
  if (patch.wallet) {
    const baseWallet = normalizeWallet(base.wallet);
    const nextWallet = normalizeWallet(patch.wallet);
    if (
      (Object.keys(baseWallet) as Array<keyof CharacterDto["wallet"]>).some(
        (key) => baseWallet[key] !== nextWallet[key],
      )
    )
      return false;
  }
  if (patch.resources && !resourceMapsEqual(base.resources, patch.resources))
    return false;
  return true;
}

/**
 * Rebuilds a counters command from the character at the head of its mutation
 * queue rather than from the render that produced the click.
 *
 * The counters endpoint replaces the whole `resources` object. Sending the
 * stale object captured by the sidebar can therefore undo another resource
 * mutation that completed earlier in the same queue. A resource intent names
 * just one key; this helper copies every other key from the latest base and
 * changes only the intended value.
 */
export function buildCharacterCounterPatch(
  base: Pick<CharacterDto, "wallet" | "resources">,
  patch: CharacterCounterPatch,
  intent?: CharacterCounterMutationIntent,
): CharacterCounterPatch {
  const nextPatch: CharacterCounterPatch = { ...patch };

  if (intent?.walletDelta) {
    const wallet = normalizeWallet(base.wallet);
    nextPatch.wallet = {
      ...wallet,
      [intent.walletDelta.key]: Math.max(
        0,
        wallet[intent.walletDelta.key] + intent.walletDelta.delta,
      ),
    };
  } else if (patch.wallet) {
    nextPatch.wallet = normalizeWallet(patch.wallet);
  }

  if (intent?.resourceMapPatch) {
    nextPatch.resources = applyResourceMapPatch(
      base.resources,
      intent.resourceMapPatch,
    );
  } else if (intent?.resource) {
    const currentResource = base.resources[intent.resource.key] ?? {
      current: 0,
      maximum: 0,
    };
    const maximum = currentResource.maximum ?? currentResource.current;
    const requestedValue =
      intent.resource.kind === "DELTA"
        ? currentResource.current + intent.resource.delta
        : intent.resource.value;
    nextPatch.resources = {
      ...base.resources,
      [intent.resource.key]: {
        ...currentResource,
        current: clampResourceValue(requestedValue, maximum),
      },
    };
  }

  return nextPatch;
}

/**
 * A standalone relative intent can be replayed against a freshly loaded
 * character without changing what the user asked for. Absolute SET and any
 * unrelated absolute field cannot: retrying them would silently overwrite a
 * concurrent edit.
 */
export function shouldRetryCharacterCounterConflict(
  intent?: CharacterCounterMutationIntent,
  patch: CharacterCounterPatch = {},
): boolean {
  if (intent?.resourceMapPatch) return false;
  if (intent?.resource?.kind === "SET") return false;
  if (intent?.walletDelta && !intent.resource)
    return !patch.resources && !patch.rest;
  if (intent?.resource?.kind === "DELTA" && !intent.walletDelta)
    return !patch.wallet && !patch.rest;
  return false;
}
