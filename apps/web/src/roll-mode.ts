export type RollMode = "NORMAL" | "ADVANTAGE" | "DISADVANTAGE";

export const rollModeOptions: ReadonlyArray<{
  value: RollMode;
  label: string;
}> = [
  { value: "DISADVANTAGE", label: "\u041f\u043e\u043c\u0435\u0445\u0430" },
  { value: "NORMAL", label: "\u041e\u0431\u044b\u0447\u043d\u043e" },
  {
    value: "ADVANTAGE",
    label: "\u041f\u0440\u0435\u0438\u043c\u0443\u0449\u0435\u0441\u0442\u0432\u043e",
  },
];

export function nextRollMode(
  value: RollMode | undefined,
  key: string,
): RollMode | null {
  const selectedIndex = rollModeOptions.findIndex(
    (option) => option.value === value,
  );
  const currentIndex = selectedIndex === -1 ? 1 : selectedIndex;
  if (key === "Home") return rollModeOptions[0]!.value;
  if (key === "End") return rollModeOptions.at(-1)!.value;
  const direction =
    key === "ArrowLeft" || key === "ArrowUp"
      ? -1
      : key === "ArrowRight" || key === "ArrowDown"
        ? 1
        : 0;
  if (direction === 0) return null;
  return rollModeOptions[
    (currentIndex + direction + rollModeOptions.length) % rollModeOptions.length
  ]!.value;
}
