export type RollMode = "NORMAL" | "ADVANTAGE" | "DISADVANTAGE";

export const rollModeOptions: ReadonlyArray<{
  value: RollMode;
  label: string;
}> = [
  { value: "DISADVANTAGE", label: "Помеха" },
  { value: "NORMAL", label: "Обычно" },
  {
    value: "ADVANTAGE",
    label: "Преимущество",
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
