import type {
  DrawingDto,
  FogRevealDto,
  Role,
  TokenDto,
} from "@arken/contracts";
import { isRectFullyRevealed } from "./fog";

export type WorldBounds = { width: number; height: number };
export type MapObjectBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export interface MapObjectSelectionContext {
  role: Role;
  membershipId: string;
  fogReveals: readonly FogRevealDto[];
  world: WorldBounds;
  showGmLayer?: boolean;
}

const isFiniteNumber = (value: number) => Number.isFinite(value);

export function tokenBounds(token: TokenDto): MapObjectBounds | null {
  if (
    !isFiniteNumber(token.x) ||
    !isFiniteNumber(token.y) ||
    !isFiniteNumber(token.width) ||
    !isFiniteNumber(token.height) ||
    token.width <= 0 ||
    token.height <= 0
  )
    return null;
  return { x: token.x, y: token.y, width: token.width, height: token.height };
}

export function drawingBounds(drawing: DrawingDto): MapObjectBounds | null {
  if (
    !isFiniteNumber(drawing.x) ||
    !isFiniteNumber(drawing.y) ||
    drawing.points.length < 2 ||
    drawing.points.length % 2 !== 0 ||
    drawing.points.some((point) => !isFiniteNumber(point))
  )
    return null;

  const xs = drawing.points.filter((_, index) => index % 2 === 0);
  const ys = drawing.points.filter((_, index) => index % 2 === 1);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: drawing.x + minX,
    y: drawing.y + minY,
    // A straight horizontal or vertical stroke still has a hittable area.
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function intersectsWorld(bounds: MapObjectBounds, world: WorldBounds) {
  if (
    !isFiniteNumber(world.width) ||
    !isFiniteNumber(world.height) ||
    world.width <= 0 ||
    world.height <= 0
  )
    return false;
  return (
    bounds.x + bounds.width > 0 &&
    bounds.y + bounds.height > 0 &&
    bounds.x < world.width &&
    bounds.y < world.height
  );
}

export function canSelectToken(
  token: TokenDto,
  context: MapObjectSelectionContext,
) {
  const bounds = tokenBounds(token);
  if (!bounds || !intersectsWorld(bounds, context.world)) return false;

  if (context.role === "GM")
    return token.layer !== "GM" || context.showGmLayer !== false;

  if (token.layer !== "PLAYER" || !token.visible) return false;
  const ownsToken =
    Boolean(context.membershipId) &&
    (token.ownerMembershipId === context.membershipId ||
      token.controllerMembershipIds.includes(context.membershipId));
  return (
    ownsToken &&
    (token.controllerMembershipIds.includes(context.membershipId) ||
      isRectFullyRevealed(bounds, context.fogReveals))
  );
}

export function canSelectDrawing(
  drawing: DrawingDto,
  context: MapObjectSelectionContext,
) {
  const bounds = drawingBounds(drawing);
  if (!bounds || !intersectsWorld(bounds, context.world)) return false;
  if (context.role === "GM") return true;
  return (
    Boolean(context.membershipId) &&
    drawing.authorMembershipId === context.membershipId &&
    isRectFullyRevealed(bounds, context.fogReveals)
  );
}

export function selectMapObjects(
  tokens: readonly TokenDto[],
  drawings: readonly DrawingDto[],
  context: MapObjectSelectionContext,
) {
  return {
    tokens: tokens.filter((token) => canSelectToken(token, context)),
    drawings: drawings.filter((drawing) => canSelectDrawing(drawing, context)),
  };
}
