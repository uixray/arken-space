import { spellActivationSchema, type SpellActivation, type SpellActivationTriggerKind } from "@arken/contracts";

/** Mirrors the shared contract, including its trimming and length semantics. */
export function spellActivationDraftError(value: SpellActivation): string | null {
  const result = spellActivationSchema.safeParse(value);
  if (result.success) return null;
  const issue = result.error.issues[0];
  if (!issue) return "Проверьте условия активации.";
  if (issue.message.includes("OTHER activation")) return "Для типа «Другое» укажите название или текст источника.";
  if (issue.message.includes("passive, triggered")) return "Узел должен быть пассивным или иметь хотя бы одно условие активации.";
  if (issue.code === "too_big" && issue.path.length === 1 && issue.path[0] === "triggers") return "У узла может быть не более 20 условий активации.";
  if (issue.path[0] === "triggers" && issue.path[2] === "label") return "Название условия должно содержать не более 240 символов.";
  if (issue.path[0] === "triggers" && issue.path[2] === "rawText") return "Текст источника должен содержать не более 2000 символов.";
  return "Проверьте тип, название и текст условия активации.";
}

export const SPELL_ACTIVATION_KINDS: SpellActivationTriggerKind[] = ["ACTION", "BONUS_ACTION", "REACTION", "RITUAL", "OTHER"];

