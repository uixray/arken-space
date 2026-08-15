/**
 * UIX-454 — заглушка аватара для персонажа без портрета.
 *
 * Отдельным модулем, а не рядом с `RollAvatar`: файл, экспортирующий и
 * компонент, и функцию, ломает горячую перезагрузку — на это ругается линтер,
 * и ругается по делу.
 */
export function rollInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
