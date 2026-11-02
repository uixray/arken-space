import { z } from "zod";

/** Orthographic screen axes: +x right, +y front (down on screen). */
export const tokenFacingSchema = z.enum(["FRONT", "BACK", "LEFT", "RIGHT"]);
export type TokenFacing = z.infer<typeof tokenFacingSchema>;
export const tokenSpritePoseSchema = z.enum(["IDLE", "PRONE", "FLYING"]);
export type TokenSpritePose = z.infer<typeof tokenSpritePoseSchema>;

export const tokenSpriteFrameSchema = z
  .object({
    pose: tokenSpritePoseSchema,
    direction: tokenFacingSchema,
    /** Campaign-owned, bounded derivative, never a URL or an original upload. */
    assetId: z.string().uuid(),
  })
  .strict();

/** Maximum three poses × four directions. All frames share a canvas and pivot. */
export const tokenSpriteSetSchema = z
  .object({
    version: z.literal(1),
    pivot: z
      .object({
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
      })
      .strict()
      .default({ x: 0.5, y: 1 }),
    frames: z.array(tokenSpriteFrameSchema).min(1).max(12),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.frames.forEach((frame, index) => {
      const key = `${frame.pose}:${frame.direction}`;
      if (seen.has(key))
        ctx.addIssue({
          code: "custom",
          path: ["frames", index],
          message: "Для каждой позы и направления допустим только один кадр",
        });
      seen.add(key);
    });
    if (!seen.has("IDLE:FRONT"))
      ctx.addIssue({
        code: "custom",
        path: ["frames"],
        message: "Нужен резервный кадр: стоит, лицом вперёд",
      });
  });
export type TokenSpriteSet = z.infer<typeof tokenSpriteSetSchema>;

/** Historical/corrupt manifests fail closed to the existing round token. */
export function normalizeTokenSpriteSet(value: unknown): TokenSpriteSet | null {
  const parsed = tokenSpriteSetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Resolve from authoritative coordinates; horizontal wins a diagonal tie. */
export function tokenFacingAfterMove(
  from: { x: number; y: number },
  to: { x: number; y: number },
  previous: TokenFacing = "FRONT",
): TokenFacing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Invalid coordinates must be rejected by the command schema. Do not let a
  // corrupt historical row manufacture a new facing while projecting it.
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0))
    return previous;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "RIGHT" : "LEFT";
  return dy > 0 ? "FRONT" : "BACK";
}

/** FLYING is presentation only. No movement, altitude or combat rules here. */
export function tokenSpritePose(
  conditions: readonly string[],
): TokenSpritePose {
  if (conditions.includes("UNCONSCIOUS") || conditions.includes("PRONE"))
    return "PRONE";
  return conditions.includes("FLYING") ? "FLYING" : "IDLE";
}

export function tokenSpriteAssetIds(
  set: TokenSpriteSet | null | undefined,
): string[] {
  return [...new Set(set?.frames.map((frame) => frame.assetId) ?? [])];
}

/** Missing/failed media is skipped in exactly the same order as missing poses. */
export function resolveTokenSpriteFrame(
  set: TokenSpriteSet | null | undefined,
  conditions: readonly string[],
  facing: TokenFacing = "FRONT",
  isAvailable: (assetId: string) => boolean = () => true,
): z.infer<typeof tokenSpriteFrameSchema> | null {
  if (!set) return null;
  const pose = tokenSpritePose(conditions);
  const candidates: [TokenSpritePose, TokenFacing][] = [
    [pose, facing],
    [pose, "FRONT"],
    ["IDLE", facing],
    ["IDLE", "FRONT"],
  ];
  for (const [candidatePose, direction] of candidates) {
    const frame = set.frames.find(
      (entry) => entry.pose === candidatePose && entry.direction === direction,
    );
    if (frame && isAvailable(frame.assetId)) return frame;
  }
  return null;
}

/** Sprite is anchored at the existing logical token's bottom centre. */
export function tokenSpriteBounds(
  token: { x: number; y: number; width: number; height: number },
  pivot: TokenSpriteSet["pivot"],
) {
  return {
    x: token.x + token.width / 2 - token.width * pivot.x,
    y: token.y + token.height - token.height * pivot.y,
    width: token.width,
    height: token.height,
  };
}
