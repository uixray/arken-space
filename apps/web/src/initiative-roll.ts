/**
 * UIX-466 — бросок на инициативу за участника очереди.
 *
 * Формула собирается здесь, а не в обработчике нажатия, чтобы её можно было
 * проверить без React: «1d20 + 0» разбирается сервером, но в ленте выглядит
 * мусором, а отрицательный бонус обязан стать минусом, а не «+ -2».
 */
export function initiativeRollFormula(bonus: number): string {
  if (!Number.isFinite(bonus) || bonus === 0) return "1d20";
  return bonus > 0 ? `1d20 + ${bonus}` : `1d20 - ${Math.abs(bonus)}`;
}

/** Подпись броска в ленте: по ней видно, чей ход считают. */
export function initiativeRollLabel(name: string): string {
  return `Инициатива: ${name}`;
}
