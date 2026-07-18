import { useMemo, useState, type FormEvent } from "react";
import type { CatalogEntryDto } from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import { FormInput, FormSelect, FormTextArea } from "./ui/GravityFormControls";

export type CatalogEntryFormInput = Pick<
  CatalogEntryDto,
  "kind" | "name" | "description" | "data"
>;

type RollAction = NonNullable<CatalogEntryDto["data"]["rollActions"]>[number];
type RollModifier = RollAction["modifiers"][number];
type ModifierChoice = "NONE" | "CHARACTERISTIC" | "ENTRY_VALUE";

type EditableRollAction = {
  id: string;
  label: string;
  kind: RollAction["kind"];
  dice: string;
  modifierSource: ModifierChoice;
  modifierKey: string;
  advantage: boolean;
  consumeUse: boolean;
  order: number;
  original: RollAction;
};

type ValueRow = { id: string; key: string; value: string };

type Props = {
  existing?: CatalogEntryDto;
  onSubmit: (input: CatalogEntryFormInput) => void | Promise<void>;
  onCancel: () => void;
};

const characteristics = [
  ["strength", "Сила"],
  ["agility", "Ловкость"],
  ["endurance", "Выносливость"],
  ["vitality", "Живучесть"],
  ["knowledge", "Знания"],
  ["intelligence", "Интеллект"],
  ["willpower", "Сила воли"],
  ["charisma", "Харизма"],
] as const;

let localId = 0;
function nextId(prefix: string) {
  localId += 1;
  return `${prefix}_${Date.now().toString(36)}_${localId.toString(36)}`;
}

function editableAction(action: RollAction): EditableRollAction {
  const modifier = action.modifiers[0];
  const supported =
    modifier?.type === "CHARACTERISTIC" || modifier?.type === "ENTRY_VALUE"
      ? modifier
      : null;
  return {
    id: action.id,
    label: action.label,
    kind: action.kind,
    dice: action.dice,
    modifierSource: supported?.type ?? "NONE",
    modifierKey: supported?.key ?? "",
    advantage: action.advantage,
    consumeUse: action.consumeUse,
    order: action.order,
    original: action,
  };
}

function emptyAction(order: number): EditableRollAction {
  return {
    id: nextId("roll"),
    label: "",
    kind: "CUSTOM",
    dice: "1d20",
    modifierSource: "NONE",
    modifierKey: "",
    advantage: false,
    consumeUse: false,
    order,
    original: {
      id: "",
      label: "",
      kind: "CUSTOM",
      dice: "1d20",
      modifiers: [],
      advantage: false,
      consumeUse: false,
      order,
    },
  };
}

export function CatalogEntryForm({ existing, onSubmit, onCancel }: Props) {
  const [kind, setKind] = useState<CatalogEntryDto["kind"]>(
    existing?.kind ?? "SKILL",
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [usesEnabled, setUsesEnabled] = useState(Boolean(existing?.data.uses));
  const [usesCurrent, setUsesCurrent] = useState(
    existing?.data.uses?.current ?? 0,
  );
  const [usesMax, setUsesMax] = useState(existing?.data.uses?.max ?? 1);
  const [recharge, setRecharge] = useState<"DAY" | "BATTLE" | "WEEK">(
    existing?.data.uses?.recharge ?? "DAY",
  );
  const [progressText, setProgressText] = useState(
    existing?.data.uses?.progressText ?? "",
  );
  const [actions, setActions] = useState<EditableRollAction[]>(() =>
    (existing?.data.rollActions ?? []).map(editableAction),
  );
  const [values, setValues] = useState<ValueRow[]>(() =>
    Object.entries(existing?.data.values ?? {}).map(([key, value]) => ({
      id: nextId("value"),
      key,
      value: String(value),
    })),
  );
  const [notes, setNotes] = useState(existing?.data.notes ?? "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const valueKeys = useMemo(
    () => values.map((row) => row.key.trim()).filter(Boolean),
    [values],
  );

  function updateAction(id: string, patch: Partial<EditableRollAction>) {
    setActions((current) =>
      current.map((action) =>
        action.id === id ? { ...action, ...patch } : action,
      ),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const cleanName = name.trim();
    if (!cleanName) return setError("Укажите название.");
    if (
      usesEnabled &&
      (usesMax < 1 || usesCurrent < 0 || usesCurrent > usesMax)
    )
      return setError(
        "Количество использований должно быть от 0 до максимума.",
      );
    if (actions.some((action) => !action.label.trim()))
      return setError("У каждого броска должно быть название.");
    if (
      actions.some(
        (action) =>
          action.modifierSource !== "NONE" && !action.modifierKey.trim(),
      )
    )
      return setError(
        "Для каждого модификатора выберите существующую зависимость.",
      );
    if (
      actions.some(
        (action) =>
          action.modifierSource === "CHARACTERISTIC" &&
          !characteristics.some(([key]) => key === action.modifierKey),
      )
    )
      return setError(
        "Выбранная характеристика больше не существует. Выберите актуальную.",
      );
    if (
      actions.some(
        (action) =>
          !/^\d{0,2}d(?:2|4|6|8|10|12|20|100)(?:kh1)?$/.test(action.dice),
      )
    )
      return setError("Проверьте формулу кубика, например 1d20 или 2d6.");
    if (new Set(valueKeys).size !== valueKeys.length)
      return setError("Ключи значений не должны повторяться.");
    if (
      values.some(
        (row) => !row.key.trim() || !Number.isFinite(Number(row.value)),
      )
    )
      return setError("У каждого значения должны быть ключ и число.");
    if (
      actions.some(
        (action) =>
          action.modifierSource === "ENTRY_VALUE" &&
          !valueKeys.includes(action.modifierKey),
      )
    )
      return setError(
        "Для модификатора из значения выберите существующий ключ.",
      );
    if (actions.some((action) => action.consumeUse && !usesEnabled))
      return setError(
        "Расход использования требует включённого лимита использований.",
      );

    const rollActions: RollAction[] = actions.map((action, index) => {
      const selectedModifier: RollModifier | null =
        action.modifierSource === "CHARACTERISTIC"
          ? {
              type: "CHARACTERISTIC",
              key: action.modifierKey as (typeof characteristics)[number][0],
            }
          : action.modifierSource === "ENTRY_VALUE"
            ? ({ type: "ENTRY_VALUE", key: action.modifierKey } as const)
            : null;
      const originalFirst = action.original.modifiers[0];
      const originalFirstIsEditable =
        originalFirst?.type === "CHARACTERISTIC" ||
        originalFirst?.type === "ENTRY_VALUE";
      const modifiers = selectedModifier
        ? [
            selectedModifier,
            ...(originalFirstIsEditable
              ? action.original.modifiers.slice(1)
              : action.original.modifiers),
          ]
        : action.modifierSource === "NONE"
          ? originalFirstIsEditable
            ? action.original.modifiers.slice(1)
            : action.original.modifiers
          : [];
      return {
        ...action.original,
        id: action.id,
        label: action.label.trim(),
        kind: action.kind,
        dice: action.dice,
        modifiers,
        advantage: action.advantage,
        consumeUse: action.consumeUse,
        order: Number.isInteger(action.order) ? action.order : index,
      };
    });
    const numericValues = Object.fromEntries(
      values.map((row) => [row.key.trim(), Number(row.value)]),
    );
    const data: CatalogEntryDto["data"] = {
      ...(existing?.data ?? {}),
      rollActions: rollActions.length ? rollActions : undefined,
      values: values.length ? numericValues : undefined,
      uses: usesEnabled
        ? {
            ...(existing?.data.uses ?? {}),
            current: usesCurrent,
            max: usesMax,
            recharge,
            progressText: progressText.trim() || undefined,
          }
        : undefined,
      notes: notes.trim() || undefined,
    };
    setSubmitting(true);
    try {
      await onSubmit({
        kind,
        name: cleanName,
        description: description.trim(),
        data,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось сохранить запись.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label={
        existing ? "Редактирование записи каталога" : "Новая запись каталога"
      }
    >
      <label>
        Тип
        <FormSelect
          value={kind}
          onChange={(event) =>
            setKind(event.target.value as CatalogEntryDto["kind"])
          }
        >
          <option value="SKILL">Навык</option>
          <option value="ABILITY">Способность</option>
        </FormSelect>
      </label>
      <label>
        Название
        <FormInput
          value={name}
          maxLength={120}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Описание
        <FormTextArea
          value={description}
          maxLength={10000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <fieldset>
        <legend>Использования</legend>
        <label>
          <FormInput
            type="checkbox"
            checked={usesEnabled}
            onChange={(event) => setUsesEnabled(event.target.checked)}
          />{" "}
          Ограничить количество использований
        </label>
        {usesEnabled && (
          <>
            <label>
              Осталось
              <FormInput
                type="number"
                min={0}
                max={usesMax}
                value={usesCurrent}
                onChange={(event) => setUsesCurrent(event.target.valueAsNumber)}
              />
            </label>
            <label>
              Максимум
              <FormInput
                type="number"
                min={1}
                value={usesMax}
                onChange={(event) => setUsesMax(event.target.valueAsNumber)}
              />
            </label>
            <label>
              Перезарядка
              <FormSelect
                value={recharge}
                onChange={(event) =>
                  setRecharge(event.target.value as typeof recharge)
                }
              >
                <option value="DAY">В день</option>
                <option value="BATTLE">В бой</option>
                <option value="WEEK">В неделю</option>
              </FormSelect>
            </label>
            <label>
              Прогресс
              <FormInput
                value={progressText}
                maxLength={200}
                placeholder="Например: прошёл 2-й день"
                onChange={(event) => setProgressText(event.target.value)}
              />
            </label>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Броски</legend>
        {actions.map((action, index) => (
          <fieldset key={action.id}>
            <legend>Бросок {index + 1}</legend>
            <label>
              Название
              <FormInput
                value={action.label}
                maxLength={100}
                onChange={(event) =>
                  updateAction(action.id, { label: event.target.value })
                }
              />
            </label>
            <label>
              Тип
              <FormSelect
                value={action.kind}
                onChange={(event) =>
                  updateAction(action.id, {
                    kind: event.target.value as RollAction["kind"],
                  })
                }
              >
                <option value="HIT">Попадание</option>
                <option value="DAMAGE">Урон</option>
                <option value="CUSTOM">Другой</option>
              </FormSelect>
            </label>
            <label>
              Кубики
              <FormInput
                value={action.dice}
                placeholder="1d20"
                onChange={(event) =>
                  updateAction(action.id, { dice: event.target.value })
                }
              />
            </label>
            <label>
              Источник модификатора
              <FormSelect
                value={action.modifierSource}
                onChange={(event) =>
                  updateAction(action.id, {
                    modifierSource: event.target.value as ModifierChoice,
                    modifierKey: "",
                  })
                }
              >
                <option value="NONE">Без модификатора</option>
                <option value="CHARACTERISTIC">Характеристика</option>
                <option value="ENTRY_VALUE">Значение записи</option>
              </FormSelect>
            </label>
            {action.modifierSource === "CHARACTERISTIC" && (
              <label>
                Характеристика
                <FormSelect
                  required
                  value={action.modifierKey}
                  onChange={(event) =>
                    updateAction(action.id, { modifierKey: event.target.value })
                  }
                >
                  <option value="">Выберите</option>
                  {characteristics.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </FormSelect>
              </label>
            )}
            {action.modifierSource === "ENTRY_VALUE" && (
              <label>
                Ключ значения
                <FormSelect
                  required
                  value={action.modifierKey}
                  onChange={(event) =>
                    updateAction(action.id, { modifierKey: event.target.value })
                  }
                >
                  <option value="">Выберите</option>
                  {valueKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </FormSelect>
              </label>
            )}
            <label>
              Порядок
              <FormInput
                type="number"
                min={0}
                max={1000}
                value={action.order}
                onChange={(event) =>
                  updateAction(action.id, { order: event.target.valueAsNumber })
                }
              />
            </label>
            <label>
              <FormInput
                type="checkbox"
                checked={action.advantage}
                onChange={(event) =>
                  updateAction(action.id, { advantage: event.target.checked })
                }
              />{" "}
              Преимущество
            </label>
            <label>
              <FormInput
                type="checkbox"
                checked={action.consumeUse}
                onChange={(event) =>
                  updateAction(action.id, { consumeUse: event.target.checked })
                }
              />{" "}
              Тратить использование
            </label>
            <Button
              type="button"
              onClick={() =>
                setActions((current) =>
                  current.filter((item) => item.id !== action.id),
                )
              }
            >
              Удалить бросок
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          onClick={() =>
            setActions((current) => [...current, emptyAction(current.length)])
          }
        >
          Добавить бросок
        </Button>
      </fieldset>

      <fieldset>
        <legend>Значения</legend>
        {values.map((row) => (
          <div key={row.id}>
            <label>
              Ключ
              <FormInput
                value={row.key}
                pattern="[a-z][a-z0-9_]{0,39}"
                placeholder="magic"
                onChange={(event) =>
                  setValues((current) =>
                    current.map((item) =>
                      item.id === row.id
                        ? { ...item, key: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
            <label>
              Значение
              <FormInput
                type="number"
                step="any"
                value={row.value}
                onChange={(event) =>
                  setValues((current) =>
                    current.map((item) =>
                      item.id === row.id
                        ? { ...item, value: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
            <Button
              type="button"
              onClick={() =>
                setValues((current) =>
                  current.filter((item) => item.id !== row.id),
                )
              }
            >
              Удалить значение
            </Button>
          </div>
        ))}
        <Button
          type="button"
          onClick={() =>
            setValues((current) => [
              ...current,
              { id: nextId("value"), key: "", value: "0" },
            ])
          }
        >
          Добавить значение
        </Button>
      </fieldset>

      <label>
        Заметки
        <FormTextArea
          value={notes}
          maxLength={10000}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Сохранение…" : "Сохранить"}
        </Button>
        <Button type="button" onClick={onCancel} disabled={submitting}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
