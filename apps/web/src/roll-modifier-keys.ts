import type { RollMode } from "./roll-mode";

/**
 * UIX-456 — преимущество и помеха зажатой клавишей.
 *
 * Ctrl — преимущество, Alt — помеха. Клавиша **не** заменяет переключатель
 * режима, а перекрывает его на один бросок: у лотка костей переключатель
 * остаётся, и тому, кто выставил там «помеху», не нужно помнить про клавиши.
 *
 * Cmd приравнен к Ctrl: на маке Ctrl+клик система показывает как контекстное
 * меню, и требовать его значило бы требовать невозможного.
 *
 * Две клавиши разом — это не «преимущество важнее» и не «помеха важнее», а
 * противоречие, о котором нечего угадывать: берётся режим переключателя.
 * Молча выбрать одну из двух — значит сделать бросок, которого человек не
 * заказывал, и заметит он это только по результату.
 *
 * Клавиатуре это доступно: нажатие Enter или Пробела на кнопке в фокусе даёт
 * событие клика с теми же флагами модификаторов, поэтому Ctrl+Enter работает
 * так же, как Ctrl+клик.
 */
export function rollModeFromEvent(
  event: Pick<MouseEvent, "ctrlKey" | "metaKey" | "altKey">,
  fallback: RollMode = "NORMAL",
): RollMode {
  const advantage = event.ctrlKey || event.metaKey;
  const disadvantage = event.altKey;
  if (advantage && disadvantage) return fallback;
  if (advantage) return "ADVANTAGE";
  if (disadvantage) return "DISADVANTAGE";
  return fallback;
}

/**
 * Как объяснить это тому, кто про клавиши не знает.
 *
 * Подсказкой на кнопке, а не отдельной строкой в интерфейсе: строка занимала бы
 * место на каждом экране ради того, что читают один раз.
 */
export const ROLL_MODIFIER_HINT = "Ctrl — с преимуществом, Alt — с помехой";

/** Как назвать режим в тексте физического броска. */
export function rollModeLabel(mode: RollMode): string | null {
  if (mode === "ADVANTAGE") return "с преимуществом";
  if (mode === "DISADVANTAGE") return "с помехой";
  return null;
}
