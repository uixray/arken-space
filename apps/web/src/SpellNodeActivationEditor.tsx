import type { SpellActivation, SpellActivationTrigger, SpellActivationTriggerKind } from "@arken/contracts";

type Props = { value: SpellActivation; disabled?: boolean; onChange: (value: SpellActivation) => void };
const kinds: SpellActivationTriggerKind[] = ["ACTION", "BONUS_ACTION", "REACTION", "RITUAL", "OTHER"];
const names: Record<SpellActivationTriggerKind, string> = { ACTION: "Действие", BONUS_ACTION: "Бонусное действие", REACTION: "Реакция", RITUAL: "Ритуал", OTHER: "Другое" };

export function SpellNodeActivationEditor({ value, disabled = false, onChange }: Props) {
  const update = (index: number, patch: Partial<SpellActivationTrigger>) => onChange({ ...value, triggers: value.triggers.map((row, i) => i === index ? { ...row, ...patch } : row) });
  const invalidEmpty = !value.passive && value.triggers.length === 0;
  return <section className="spell-activation-editor" aria-label="Условия активации">
    <h4>Условия активации</h4>
    <label className="spell-activation-passive"><input type="checkbox" checked={value.passive} disabled={disabled} onChange={(e) => onChange({ ...value, passive: e.target.checked })} />Пассивная способность</label>
    {value.triggers.map((trigger, index) => <fieldset className="spell-activation-trigger" key={index}>
      <legend>Условие {index + 1}</legend>
      <label>Тип активации<select aria-label={`Тип активации ${index + 1}`} value={trigger.kind} disabled={disabled} onChange={(e) => update(index, { kind: e.target.value as SpellActivationTriggerKind })}>{kinds.map((kind) => <option value={kind} key={kind}>{names[kind]}</option>)}</select></label>
      <label>Название условия (до 240 символов)<input aria-label={`Название условия ${index + 1}`} maxLength={240} value={trigger.label ?? ""} disabled={disabled} onChange={(e) => update(index, { label: e.target.value || undefined })} /></label>
      <label>Текст источника (до 2000 символов)<textarea aria-label={`Текст источника ${index + 1}`} maxLength={2000} value={trigger.rawText ?? ""} disabled={disabled} onChange={(e) => update(index, { rawText: e.target.value || undefined })} /></label>
      {trigger.kind === "OTHER" && !trigger.label?.trim() && !trigger.rawText?.trim() && <p role="alert">Для типа «Другое» укажите название или текст источника.</p>}
      <button type="button" disabled={disabled} onClick={() => onChange({ ...value, triggers: value.triggers.filter((_, i) => i !== index) })}>Удалить условие</button>
    </fieldset>)}
    {invalidEmpty && <p role="alert">Узел должен быть пассивным или иметь хотя бы одно условие активации.</p>}
    <button type="button" disabled={disabled || value.triggers.length >= 20} onClick={() => onChange({ ...value, triggers: [...value.triggers, { kind: "ACTION" }] })}>Добавить условие ({value.triggers.length}/20)</button>
  </section>;
}
