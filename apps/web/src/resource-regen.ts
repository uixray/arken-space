import { RESOURCE_REGEN_STAT } from "@arken/system";

/**
 * UIX-468 — на сколько восстанавливается ресурс за одно нажатие.
 *
 * Величина берётся из `RESOURCE_REGEN_STAT` — того же места, откуда её берёт
 * отдых (`applyCharacterRest` на сервере). Второго правила заводить нельзя:
 * разойдясь, кнопка и отдых восстанавливали бы разное, и никто бы не сказал,
 * какое из чисел правильное.
 *
 * Ресурс без строки регена не восстанавливается вовсе — у него нет величины, а
 * подставить «до максимума» значило бы выдумать правило, которого в системе нет.
 */
export function resourceRegenAmount(
  key: string,
  stats: Record<string, number>,
): number {
  const regenStat = RESOURCE_REGEN_STAT[key];
  if (!regenStat) return 0;
  const regen = stats[regenStat] ?? 0;
  // Отрицательный реген — это не «отнять при восстановлении»: сервер такой
  // ресурс отдыхом просто не трогает, и кнопка ведёт себя так же.
  return regen > 0 ? regen : 0;
}

/** Держит значение в границах ресурса; дробное и текстовое приводит к целому. */
export function clampResourceValue(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, Math.round(value)));
}

/**
 * Пауза перед отправкой накопленных нажатий ±1.
 *
 * Существует затем, что тратят ресурс сериями: три удара подряд — это три
 * нажатия, и каждое отдельным запросом поднимает ревизию персонажа, а значит
 * рассылает всем за столом три обновления вместо одного и открывает окно для
 * конфликта ревизий между собственными же нажатиями.
 */
export const RESOURCE_ADJUST_DELAY_MS = 600;
