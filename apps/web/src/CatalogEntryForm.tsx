import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { AssetDto, CatalogEntryDto } from "@arken/contracts";
import { Button } from "./design-system/Button";
import { FormInput, FormSelect, FormTextArea } from "./ui/GravityFormControls";
import { ApiError } from "./api";
import { DiceFramePicker } from "./DiceFramePicker";

export type CatalogEntryFormInput = Pick<
  CatalogEntryDto,
  "kind" | "name" | "description" | "data"
> & { diceFrameAssetId?: string | null };

type RollAction = NonNullable<CatalogEntryDto["data"]["rollActions"]>[number];
type RollModifier = RollAction["modifiers"][number];
type ModifierChoice = "NONE" | "CHARACTERISTIC" | "ENTRY_VALUE";
export type SkillModifierOption = {
  scope: "CATALOG" | "CHARACTER_ENTRY" | "LEGACY";
  key: string;
  name: string;
  value?: number;
};
type BonusRow = {
  id: string;
  type: "CONSTANT" | "CHARACTERISTIC" | "SKILL";
  value: string;
  key: string;
  scope: SkillModifierOption["scope"];
};

type EditableRollAction = {
  id: string;
  label: string;
  kind: RollAction["kind"];
  dice: string;
  modifierSource: ModifierChoice;
  modifierKey: string;
  advantage: boolean;
  consumeUse: boolean;
  costType: "none" | "physical" | "magic";
  costAmount: number;
  order: number;
  original: RollAction;
  bonuses: BonusRow[];
};

type ValueRow = { id: string; key: string; value: string };
type FieldErrorMap = Record<string, string>;

function fieldErrorMessage(path: string): string | null {
  if (path === "name") return "Укажите название длиной до 120 символов.";
  if (path === "data.uses.current")
    return "Остаток должен быть от 0 до максимума.";
  if (path === "data.uses.max")
    return "Максимум должен быть целым числом больше нуля.";
  if (path === "data.activation.cost.amount")
    return "Стоимость должна быть целым числом от 1 до 100000.";
  if (path === "data.usageCost.amount")
    return "Стоимость должна быть целым числом от 1 до 100000.";
  if (/^data\.rollActions\.\d+\.label$/.test(path))
    return "Укажите название броска.";
  if (/^data\.rollActions\.\d+\.dice$/.test(path))
    return "Проверьте формулу, например 1d20 или 2d6.";
  if (/^data\.rollActions\.\d+\.cost\.amount$/.test(path))
    return "Количество должно быть целым числом от 1 до 100000.";
  return null;
}

function readFieldErrors(
  details: Record<string, unknown> | undefined,
): FieldErrorMap {
  const raw = details?.fieldErrors;
  if (!Array.isArray(raw)) return {};
  const result: FieldErrorMap = {};
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const path = (item as Record<string, unknown>).path;
    if (typeof path !== "string") continue;
    const message = fieldErrorMessage(path);
    if (message) result[path] = message;
  }
  return result;
}

function fieldErrorId(path: string) {
  return `catalog-field-error-${path.replace(/[^a-z0-9_-]/gi, "-")}`;
}

type Props = {
  existing?: CatalogEntryDto;
  /** The entry kind requested by the picker that opened this creation form. */
  initialKind?: CatalogEntryDto["kind"];
  /**
   * UIX-424: подписи характеристик из раскладки кампании. Раньше здесь лежал
   * собственный список, и он успел разойтись с остальными — предлагал восемь
   * характеристик из одиннадцати, молча лишая мастера реакции, внимательности
   * и силы магии.
   */
  statLabels: Record<string, string>;
  /**
   * UIX-424, шаг 9. Подписи стоимости в ресурсах — из раскладки кампании.
   * Ключи стоимости свои (`physical`/`magic`) и остаются: их понимает сервер,
   * когда списывает. Меняются только имена, которые видит мастер.
   */
  resourceLabels: { physical: string; magic: string };
  skillModifiers?: readonly SkillModifierOption[];
  /**
   * UIX-457: рамки кампании. Передаётся только для общего каталога: рамка
   * навыка живёт в шаблоне, копии у персонажей наследуют её через source.
   */
  diceFrames?: readonly AssetDto[];
  onSubmit: (input: CatalogEntryFormInput) => void | Promise<void>;
  onCancel: () => void;
};

let localId = 0;
function nextId(prefix: string) {
  localId += 1;
  return `${prefix}_${Date.now().toString(36)}_${localId.toString(36)}`;
}

function editableAction(action: RollAction): EditableRollAction {
  const modifier = action.modifiers[0];
  const supported = modifier?.type === "ENTRY_VALUE" ? modifier : null;
  return {
    id: action.id,
    label: action.label,
    kind: action.kind,
    dice: action.dice,
    modifierSource: supported?.type ?? "NONE",
    modifierKey: supported?.key ?? "",
    advantage: action.advantage,
    consumeUse: action.consumeUse,
    costType: action.cost?.type ?? "none",
    costAmount: action.cost?.amount ?? 1,
    order: action.order,
    original: action,
    bonuses: action.modifiers.flatMap<BonusRow>((source, index) => {
      const id = `bonus_${action.id}_${index}`;
      if (source.type === "CONSTANT")
        return [
          {
            id,
            type: "CONSTANT" as const,
            value: String(source.value),
            key: "",
            scope: "CATALOG" as const,
          },
        ];
      if (source.type === "CHARACTERISTIC")
        return [
          {
            id,
            type: "CHARACTERISTIC" as const,
            value: "1",
            key: source.key,
            scope: "CATALOG" as const,
          },
        ];
      if (source.type === "SKILL")
        return [
          {
            id,
            type: "SKILL" as const,
            value: "1",
            key: source.key,
            scope: source.scope,
          },
        ];
      return [];
    }),
  };
}

function emptyAction(order: number, label = ""): EditableRollAction {
  return {
    id: nextId("roll"),
    label,
    kind: "CUSTOM",
    dice: "1d20",
    modifierSource: "NONE",
    modifierKey: "",
    advantage: false,
    consumeUse: false,
    costType: "none",
    costAmount: 1,
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
    bonuses: [],
  };
}

export function CatalogEntryForm({
  existing,
  initialKind,
  statLabels,
  resourceLabels,
  skillModifiers = [],
  diceFrames,
  onSubmit,
  onCancel,
}: Props) {
  const characteristics = Object.entries(statLabels);
  const [kind, setKind] = useState<CatalogEntryDto["kind"]>(
    existing?.kind ?? initialKind ?? "SKILL",
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [skillValue, setSkillValue] = useState(
    existing?.data.skillValue !== undefined
      ? String(existing.data.skillValue)
      : existing
        ? ""
        : "0",
  );
  const [diceFrameAssetId, setDiceFrameAssetId] = useState<string | null>(
    existing?.diceFrameAssetId ?? null,
  );
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const control = descriptionRef.current;
    if (!control) return;
    control.style.height = "auto";
    const maxHeight = Math.max(240, window.innerHeight / 2);
    control.style.height = `${Math.min(control.scrollHeight, maxHeight)}px`;
    control.style.overflowY =
      control.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [description]);
  const [usesEnabled, setUsesEnabled] = useState(Boolean(existing?.data.uses));
  const [usesCurrent, setUsesCurrent] = useState(
    existing?.data.uses?.current ?? 0,
  );
  const [usesMax, setUsesMax] = useState(existing?.data.uses?.max ?? 1);
  const [recharge, setRecharge] = useState<
    "DAY" | "BATTLE" | "WEEK" | "SHORT_REST"
  >(existing?.data.uses?.recharge ?? "DAY");
  const [progressText, setProgressText] = useState(
    existing?.data.uses?.progressText ?? "",
  );
  const [activationConsumesUse, setActivationConsumesUse] = useState(
    existing?.data.activation?.consumeUse ?? Boolean(existing?.data.uses),
  );
  const [activationCostType, setActivationCostType] = useState<
    "none" | "physical" | "magic"
  >(existing?.data.activation?.cost?.type ?? "none");
  const [activationCostAmount, setActivationCostAmount] = useState(
    existing?.data.activation?.cost?.amount ?? 1,
  );
  const [usageCostType, setUsageCostType] = useState<
    "legacy" | "none" | "physical" | "magic"
  >(
    existing?.data.usageCost === undefined
      ? existing
        ? "legacy"
        : "none"
      : existing.data.usageCost === null
        ? "none"
        : existing.data.usageCost.type,
  );
  const [usageCostAmount, setUsageCostAmount] = useState(
    existing?.data.usageCost && typeof existing.data.usageCost === "object"
      ? existing.data.usageCost.amount
      : 1,
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});
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

  function addBonus(actionId: string) {
    updateAction(actionId, {
      bonuses: [
        ...(actions.find((action) => action.id === actionId)?.bonuses ?? []),
        {
          id: nextId("bonus"),
          type: "CONSTANT",
          value: "1",
          key: "",
          scope: "CATALOG",
        },
      ],
    });
  }

  function updateBonus(
    actionId: string,
    bonusId: string,
    patch: Partial<BonusRow>,
  ) {
    updateAction(actionId, {
      bonuses:
        actions
          .find((action) => action.id === actionId)
          ?.bonuses.map((bonus) =>
            bonus.id === bonusId ? { ...bonus, ...patch } : bonus,
          ) ?? [],
    });
  }

  function renderFieldError(path: string) {
    const message = fieldErrors[path];
    return message ? (
      <p id={fieldErrorId(path)} role="alert">
        {message}
      </p>
    ) : null;
  }

  function fieldErrorProps(path: string) {
    return fieldErrors[path]
      ? {
          "aria-invalid": true as const,
          "aria-describedby": fieldErrorId(path),
        }
      : {};
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    const cleanName = name.trim();
    if (!cleanName) {
      setFieldErrors({ name: "Укажите название." });
      return setError("Проверьте обязательные поля.");
    }
    if (
      usesEnabled &&
      (usesMax < 1 || usesCurrent < 0 || usesCurrent > usesMax)
    )
      return setError(
        "Количество использований должно быть от 0 до максимума.",
      );
    if (
      kind === "SKILL" &&
      ((!existing && !skillValue.trim()) ||
        (skillValue.trim() &&
          (!Number.isInteger(Number(skillValue)) ||
            Number(skillValue) < -1000 ||
            Number(skillValue) > 1000)))
    )
      return setError("Укажите целое значение навыка от −1000 до 1000.");
    if (
      actions.some((action) =>
        action.bonuses.some((bonus) =>
          bonus.type === "CONSTANT"
            ? !bonus.value.trim() ||
              !Number.isInteger(Number(bonus.value)) ||
              Number(bonus.value) < -1000 ||
              Number(bonus.value) > 1000
            : bonus.type === "CHARACTERISTIC"
              ? !characteristics.some(([key]) => key === bonus.key)
              : !skillModifiers.some(
                  (option) =>
                    option.scope === bonus.scope && option.key === bonus.key,
                ) &&
                !action.original.modifiers.some(
                  (source) =>
                    source.type === "SKILL" &&
                    source.scope === bonus.scope &&
                    source.key === bonus.key,
                ),
        ),
      )
    )
      return setError("Проверьте дополнительные бонусы броска.");
    if (
      actions.some((action) => {
        const preservedModifiers = action.original.modifiers.filter(
          (source, index) =>
            source.type !== "CONSTANT" &&
            source.type !== "CHARACTERISTIC" &&
            source.type !== "SKILL" &&
            !(index === 0 && source.type === "ENTRY_VALUE"),
        ).length;
        const selectedModifier = action.modifierSource === "NONE" ? 0 : 1;
        return (
          action.bonuses.length + preservedModifiers + selectedModifier > 12
        );
      })
    )
      return setError("Для одного броска доступно не более 12 бонусов.");
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
    if (
      kind === "ABILITY" &&
      usageCostType !== "legacy" &&
      usageCostType !== "none" &&
      (!Number.isInteger(usageCostAmount) ||
        usageCostAmount < 1 ||
        usageCostAmount > 100000)
    ) {
      setFieldErrors({
        "data.usageCost.amount":
          "Стоимость должна быть целым числом от 1 до 100000.",
      });
      return setError("Проверьте стоимость применения.");
    }

    const rollActions: RollAction[] = actions.map((action, index) => {
      const selectedModifier: RollModifier | null =
        action.modifierSource === "CHARACTERISTIC"
          ? {
              type: "CHARACTERISTIC",
              key: action.modifierKey,
            }
          : action.modifierSource === "ENTRY_VALUE"
            ? ({ type: "ENTRY_VALUE", key: action.modifierKey } as const)
            : null;
      const modifiers = action.original.modifiers.filter(
        (source, index) =>
          source.type !== "CONSTANT" &&
          source.type !== "CHARACTERISTIC" &&
          source.type !== "SKILL" &&
          !(index === 0 && source.type === "ENTRY_VALUE"),
      );
      const additionalModifiers = action.bonuses.map((bonus) => {
        if (bonus.type === "CONSTANT")
          return { type: "CONSTANT" as const, value: Number(bonus.value) };
        if (bonus.type === "CHARACTERISTIC")
          return { type: "CHARACTERISTIC" as const, key: bonus.key };
        return {
          type: "SKILL" as const,
          scope: bonus.scope,
          key: bonus.key,
        };
      });
      return {
        ...action.original,
        id: action.id,
        label:
          action.label.trim() ||
          (action.original.id
            ? action.original.label
            : cleanName.slice(0, 100)),
        kind: action.kind,
        dice: action.dice,
        modifiers: [
          ...modifiers,
          ...(selectedModifier ? [selectedModifier] : []),
          ...additionalModifiers,
        ],
        advantage: action.advantage,
        consumeUse: usesEnabled && action.consumeUse,
        cost:
          action.costType === "none"
            ? undefined
            : { type: action.costType, amount: Math.max(1, action.costAmount) },
        order: Number.isInteger(action.order) ? action.order : index,
      };
    });
    const numericValues = Object.fromEntries(
      values.map((row) => [row.key.trim(), Number(row.value)]),
    );
    const data: CatalogEntryDto["data"] = {
      ...(existing?.data ?? {}),
      rollActions: rollActions.length ? rollActions : undefined,
      skillValue:
        kind === "SKILL" && skillValue.trim()
          ? Number(skillValue)
          : existing?.data.skillValue,
      usageCost:
        kind !== "ABILITY" || usageCostType === "legacy"
          ? existing?.data.usageCost
          : usageCostType === "none"
            ? null
            : { type: usageCostType, amount: usageCostAmount },
      activation:
        kind === "ABILITY" &&
        usageCostType === "legacy" &&
        rollActions.length === 0
          ? {
              consumeUse: usesEnabled && activationConsumesUse,
              cost:
                activationCostType === "none"
                  ? undefined
                  : {
                      type: activationCostType,
                      amount: Math.max(1, activationCostAmount),
                    },
            }
          : existing?.data.activation,
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
        ...(diceFrames ? { diceFrameAssetId } : {}),
      });
    } catch (cause) {
      const mapped =
        cause instanceof ApiError ? readFieldErrors(cause.details) : {};
      setFieldErrors(mapped);
      setError(
        cause instanceof ApiError && Object.keys(mapped).length > 0
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "Не удалось сохранить запись.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="catalog-entry-form"
      onSubmit={submit}
      aria-label={
        existing ? "Редактирование записи каталога" : "Новая запись каталога"
      }
    >
      {showAdvanced && (
        <label>
          Тип записи
          <FormSelect
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as CatalogEntryDto["kind"])
            }
          >
            <option value="SKILL">Навык</option>
            <option value="ABILITY">Способность / заклинание</option>
          </FormSelect>
        </label>
      )}
      <label>
        Название *
        <FormInput
          {...fieldErrorProps("name")}
          value={name}
          maxLength={120}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {renderFieldError("name")}
      <label>
        Описание (необязательно)
        <FormTextArea
          controlRef={descriptionRef}
          rows={1}
          value={description}
          maxLength={10000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      {kind === "SKILL" && (
        <label>
          Числовой бонус навыка (необязательно для сохранённых старых записей)
          <FormInput
            type="number"
            min={-1000}
            max={1000}
            step={1}
            value={skillValue}
            onChange={(event) => setSkillValue(event.target.value)}
          />
        </label>
      )}

      {kind === "ABILITY" && (
        <fieldset>
          <legend>Стоимость применения</legend>
          <p className="muted">
            Списывается один раз при выполнении способности, независимо от того,
            есть ли у неё бросок. Показ без выполнения стоимость не тратит.
          </p>
          <label>
            Стоимость
            <FormSelect
              value={usageCostType}
              onChange={(event) =>
                setUsageCostType(event.target.value as typeof usageCostType)
              }
            >
              {existing?.data.usageCost === undefined && (
                <option value="legacy">
                  Сохранить старые правила стоимости
                </option>
              )}
              <option value="none">Без стоимости</option>
              <option value="physical">{resourceLabels.physical}</option>
              <option value="magic">{resourceLabels.magic}</option>
            </FormSelect>
          </label>
          {usageCostType !== "legacy" && usageCostType !== "none" && (
            <label>
              Количество ресурса
              <FormInput
                type="number"
                {...fieldErrorProps("data.usageCost.amount")}
                min={1}
                max={100000}
                step={1}
                required
                value={usageCostAmount}
                onChange={(event) =>
                  setUsageCostAmount(event.target.valueAsNumber)
                }
              />
            </label>
          )}
          {renderFieldError("data.usageCost.amount")}
        </fieldset>
      )}

      {diceFrames ? (
        <DiceFramePicker
          legend="Рамка бросков навыка"
          noneLabel="Рамка игрока"
          frames={diceFrames}
          value={diceFrameAssetId}
          disabled={submitting}
          onChange={setDiceFrameAssetId}
        />
      ) : null}

      {showAdvanced && (
        <fieldset>
          <legend>Лимит использований</legend>
          <p className="muted">
            Не нужен лимит — оставьте переключатель выключенным. Это не влияет
            на стоимость применения.
          </p>
          <FormInput
            className="catalog-entry-form__toggle"
            type="checkbox"
            checked={usesEnabled}
            onChange={(event) => setUsesEnabled(event.target.checked)}
          >
            Ограничить количество использований
          </FormInput>
          {usesEnabled && (
            <>
              <label>
                Осталось
                <FormInput
                  type="number"
                  {...fieldErrorProps("data.uses.current")}
                  min={0}
                  max={usesMax}
                  value={usesCurrent}
                  onChange={(event) =>
                    setUsesCurrent(event.target.valueAsNumber)
                  }
                />
              </label>
              {renderFieldError("data.uses.current")}
              <label>
                Максимум
                <FormInput
                  type="number"
                  {...fieldErrorProps("data.uses.max")}
                  min={1}
                  value={usesMax}
                  onChange={(event) => setUsesMax(event.target.valueAsNumber)}
                />
              </label>
              {renderFieldError("data.uses.max")}
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
                  <option value="SHORT_REST">За короткий отдых</option>
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
      )}

      {showAdvanced &&
        kind === "ABILITY" &&
        actions.length === 0 &&
        existing?.data.activation && (
          <fieldset>
            <legend>Стоимость применения без броска</legend>
            <p className="muted">
              Независимо от лимита использований. Создание записи ничего не
              списывает.
            </p>
            <FormInput
              type="checkbox"
              checked={activationConsumesUse}
              disabled={!usesEnabled}
              onChange={(event) =>
                setActivationConsumesUse(event.target.checked)
              }
            >
              Списывать одно использование
            </FormInput>
            <label>
              Стоимость
              <FormSelect
                value={activationCostType}
                onChange={(event) =>
                  setActivationCostType(
                    event.target.value as typeof activationCostType,
                  )
                }
              >
                <option value="none">Без стоимости</option>
                <option value="physical">{resourceLabels.physical}</option>
                <option value="magic">{resourceLabels.magic}</option>
              </FormSelect>
            </label>
            {activationCostType !== "none" && (
              <>
                <label>
                  Количество ресурса
                  <FormInput
                    type="number"
                    {...fieldErrorProps("data.activation.cost.amount")}
                    min={1}
                    max={100000}
                    step={1}
                    required
                    value={activationCostAmount}
                    onChange={(event) =>
                      setActivationCostAmount(event.target.valueAsNumber)
                    }
                  />
                </label>
                {renderFieldError("data.activation.cost.amount")}
              </>
            )}
          </fieldset>
        )}

      {(kind === "ABILITY" || showAdvanced) && (
        <fieldset>
          <legend>Броски</legend>
          <p className="muted">
            Добавьте бросок только если он нужен для применения. Стоимость и
            лимит задаются отдельно.
          </p>
          {(showAdvanced
            ? actions
            : kind === "ABILITY"
              ? actions.slice(0, 1)
              : []
          ).map((action, index) => (
            <fieldset key={action.id}>
              <legend>Бросок {index + 1}</legend>
              {showAdvanced && (
                <label>
                  Название броска
                  {kind === "ABILITY"
                    ? " (по умолчанию — имя способности)"
                    : ""}
                  <FormInput
                    {...fieldErrorProps(`data.rollActions.${index}.label`)}
                    value={action.label}
                    maxLength={100}
                    required={kind === "SKILL"}
                    onChange={(event) =>
                      updateAction(action.id, { label: event.target.value })
                    }
                  />
                </label>
              )}
              {showAdvanced &&
                renderFieldError(`data.rollActions.${index}.label`)}
              {showAdvanced && (
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
              )}
              <label>
                Кубики
                <FormInput
                  {...fieldErrorProps(`data.rollActions.${index}.dice`)}
                  value={action.dice}
                  placeholder="1d20"
                  onChange={(event) =>
                    updateAction(action.id, { dice: event.target.value })
                  }
                />
              </label>
              {renderFieldError(`data.rollActions.${index}.dice`)}
              {showAdvanced && (
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
              )}
              {showAdvanced && action.modifierSource === "CHARACTERISTIC" && (
                <label>
                  Характеристика
                  <FormSelect
                    required
                    value={action.modifierKey}
                    onChange={(event) =>
                      updateAction(action.id, {
                        modifierKey: event.target.value,
                      })
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
              {showAdvanced && action.modifierSource === "ENTRY_VALUE" && (
                <label>
                  Ключ значения
                  <FormSelect
                    required
                    value={action.modifierKey}
                    onChange={(event) =>
                      updateAction(action.id, {
                        modifierKey: event.target.value,
                      })
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
              {action.bonuses.map((bonus) => (
                <fieldset key={bonus.id}>
                  <legend>Дополнительный бонус</legend>
                  <label>
                    Тип бонуса
                    <FormSelect
                      value={bonus.type}
                      onChange={(event) =>
                        updateBonus(action.id, bonus.id, {
                          type: event.target.value as BonusRow["type"],
                          key: "",
                          value: "1",
                        })
                      }
                    >
                      <option value="CONSTANT">Число</option>
                      <option value="CHARACTERISTIC">Характеристика</option>
                      {skillModifiers.length > 0 && (
                        <option value="SKILL">Навык</option>
                      )}
                    </FormSelect>
                  </label>
                  {bonus.type === "CONSTANT" ? (
                    <label>
                      Бонус
                      <FormInput
                        type="number"
                        step={1}
                        min={-1000}
                        max={1000}
                        value={bonus.value}
                        onChange={(event) =>
                          updateBonus(action.id, bonus.id, {
                            value: event.target.value,
                          })
                        }
                      />
                    </label>
                  ) : bonus.type === "CHARACTERISTIC" ? (
                    <label>
                      Характеристика
                      <FormSelect
                        value={bonus.key}
                        onChange={(event) =>
                          updateBonus(action.id, bonus.id, {
                            key: event.target.value,
                          })
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
                  ) : (
                    <label>
                      Навык
                      <FormSelect
                        value={`${bonus.scope}:${bonus.key}`}
                        onChange={(event) => {
                          const selected = skillModifiers.find(
                            (option) =>
                              `${option.scope}:${option.key}` ===
                              event.target.value,
                          );
                          updateBonus(action.id, bonus.id, {
                            scope: selected?.scope ?? "CATALOG",
                            key: selected?.key ?? "",
                          });
                        }}
                      >
                        <option value="CATALOG:">Выберите</option>
                        {!skillModifiers.some(
                          (option) =>
                            option.scope === bonus.scope &&
                            option.key === bonus.key,
                        ) &&
                          bonus.key && (
                            <option value={`${bonus.scope}:${bonus.key}`}>
                              Недоступный навык {bonus.key} (сохранён)
                            </option>
                          )}
                        {skillModifiers
                          .filter(
                            (option) =>
                              !(
                                existing?.kind === "SKILL" &&
                                option.scope === "CATALOG" &&
                                option.key === existing.id
                              ) &&
                              !(
                                existing?.kind === "SKILL" &&
                                option.scope === "CHARACTER_ENTRY" &&
                                option.key === existing.id
                              ),
                          )
                          .map((option) => (
                            <option
                              key={`${option.scope}:${option.key}`}
                              value={`${option.scope}:${option.key}`}
                            >
                              {option.name}
                              {typeof option.value === "number" &&
                              Number.isFinite(option.value)
                                ? ` (${option.value > 0 ? "+" : ""}${option.value})`
                                : ""}
                            </option>
                          ))}
                      </FormSelect>
                    </label>
                  )}
                  <Button
                    type="button"
                    onClick={() =>
                      updateAction(action.id, {
                        bonuses: action.bonuses.filter(
                          (item) => item.id !== bonus.id,
                        ),
                      })
                    }
                  >
                    Удалить бонус
                  </Button>
                </fieldset>
              ))}
              <Button type="button" onClick={() => addBonus(action.id)}>
                Добавить числовой или навыковый бонус
              </Button>
              {showAdvanced && (
                <label>
                  Порядок
                  <FormInput
                    type="number"
                    min={0}
                    max={1000}
                    value={action.order}
                    onChange={(event) =>
                      updateAction(action.id, {
                        order: event.target.valueAsNumber,
                      })
                    }
                  />
                </label>
              )}
              {showAdvanced && (
                <label>
                  <FormInput
                    type="checkbox"
                    checked={action.advantage}
                    onChange={(event) =>
                      updateAction(action.id, {
                        advantage: event.target.checked,
                      })
                    }
                  />{" "}
                  Преимущество
                </label>
              )}
              {(kind !== "ABILITY" || existing) && showAdvanced && (
                <>
                  <label>
                    Ресурс
                    <FormSelect
                      value={action.costType}
                      onChange={(event) =>
                        updateAction(action.id, {
                          costType: event.target
                            .value as EditableRollAction["costType"],
                        })
                      }
                    >
                      {/* UIX-424, шаг 9: подписи ресурсов — из раскладки кампании.
                       * Здесь стояли «Physical Power» и «Magic Power»: английские
                       * строки в русском интерфейсе, да ещё и прежние имена, от
                       * которых мастер отказался. Ключи стоимости при этом свои
                       * (`physical`/`magic`) и не меняются — их знает сервер. */}
                      <option value="none">Без стоимости</option>
                      <option value="physical">
                        {resourceLabels.physical}
                      </option>
                      <option value="magic">{resourceLabels.magic}</option>
                    </FormSelect>
                  </label>
                  {action.costType !== "none" && (
                    <>
                      <label>
                        Количество
                        <FormInput
                          type="number"
                          min={1}
                          max={100000}
                          step={1}
                          required
                          {...fieldErrorProps(
                            `data.rollActions.${index}.cost.amount`,
                          )}
                          value={action.costAmount}
                          onChange={(event) =>
                            updateAction(action.id, {
                              costAmount: event.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                      {renderFieldError(
                        `data.rollActions.${index}.cost.amount`,
                      )}
                    </>
                  )}
                </>
              )}
              {showAdvanced && (
                <label>
                  <FormInput
                    type="checkbox"
                    checked={action.consumeUse}
                    onChange={(event) =>
                      updateAction(action.id, {
                        consumeUse: event.target.checked,
                      })
                    }
                  />{" "}
                  Тратить использование
                </label>
              )}
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
          {(showAdvanced || (kind === "ABILITY" && actions.length === 0)) && (
            <Button
              type="button"
              onClick={() =>
                setActions((current) => [
                  ...current,
                  emptyAction(current.length, name.trim().slice(0, 100)),
                ])
              }
            >
              {kind === "ABILITY"
                ? showAdvanced
                  ? "Добавить бросок"
                  : "Добавить необязательный бросок"
                : "Добавить дополнительный бросок"}
            </Button>
          )}
        </fieldset>
      )}

      <Button
        type="button"
        aria-expanded={showAdvanced}
        onClick={() => setShowAdvanced((value) => !value)}
      >
        {showAdvanced
          ? "Скрыть дополнительные настройки"
          : "Дополнительные настройки"}
      </Button>

      {showAdvanced && (
        <details>
          <summary>Дополнительные числовые параметры</summary>
          <p className="muted">
            Обычно заполнять не нужно. Добавляйте параметр, только если бросок
            использует модификатор «Значение записи». Это число прибавляется к
            броску, а не списывается как ресурс. Например,{" "}
            <code>might = 2</code> даст <code>+2</code>.
          </p>
          <fieldset>
            <legend>Параметры</legend>
            {values.map((row) => (
              <div key={row.id}>
                <label>
                  Ключ
                  <FormInput
                    value={row.key}
                    pattern="[a-z][a-z0-9_]{0,39}"
                    placeholder="Код латиницей"
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
            Заметка (необязательно)
            <FormTextArea
              value={notes}
              maxLength={10000}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </details>
      )}
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
