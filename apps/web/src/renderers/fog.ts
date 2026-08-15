/**
 * UIX-449: сами правила видимости переехали в контракт — их спрашивает и
 * сервер, когда решает, что вообще отправлять игроку. Здесь остаётся то, что
 * относится только к отрисовке, и реэкспорт, чтобы вызывающим не пришлось
 * знать, где именно живёт правило.
 */
export {
  isRectFullyRevealed,
  isRectFullyHidden,
  fogHiddenTokenIds,
  type FogOperation,
} from "@arken/contracts";

export function fogOpacity(role: "GM" | "PLAYER") {
  return role === "GM" ? 0.35 : 1;
}
