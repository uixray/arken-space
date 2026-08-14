import { useState } from "react";
import { Button } from "@gravity-ui/uikit";
import { STAT_VALUE_RANGE } from "@arken/system";
import { FormInput } from "../ui/GravityFormControls";
import { TextPromptDialog } from "../ui/TextPromptDialog";

/**
 * UIX-424, шаг 5 — одна группа раскладки в карточке персонажа.
 *
 * Обе группы («Характеристики» и «Боевые характеристики») рисуются этим
 * компонентом. Раньше они отличались: у боевых были только кнопки броска, без
 * поля ввода, — то есть выставить инициативу или ближний бой было негде.
 * Отличались они не по замыслу, а потому что боевых строк с данными почти не
 * было; теперь есть, и разница исчезает.
 *
 * Правка раскладки — только мастеру: она общая на кампанию, и переименование
 * строки игроком поменяло бы подпись всем.
 */
export function StatLayoutCard({
  title,
  modifier,
  rows,
  values,
  valuesRevisionKey,
  editable,
  rollPending,
  canEditLayout,
  onChangeValue,
  onRoll,
  onRenameRow,
  onAddRow,
}: {
  title: string;
  modifier: string;
  rows: readonly { key: string; label: string }[];
  values: Record<string, number>;
  /**
   * Меняется при каждой ревизии персонажа и пересоздаёт поля ввода. Поля
   * неуправляемые (правка отправляется на `blur`), поэтому без этого чужая
   * правка не отобразилась бы у того, кто уже открыл карточку.
   */
  valuesRevisionKey: string;
  editable: boolean;
  rollPending: boolean;
  canEditLayout: boolean;
  onChangeValue: (key: string, value: number) => void;
  onRoll: (formula: string, label: string) => void;
  onRenameRow: (key: string, label: string) => Promise<void>;
  onAddRow: (label: string) => Promise<void>;
}) {
  // `null` — окно закрыто; `{ key: undefined }` — добавление новой строки.
  const [editing, setEditing] = useState<{ key?: string } | null>(null);
  const renamed = editing?.key
    ? rows.find((row) => row.key === editing.key)
    : undefined;

  return (
    <div className={`character-card character-card--${modifier}`}>
      <h3 className="character-card__header">{title}</h3>
      <div className="character-card__body">
        {rows.map((row) => (
          <label key={row.key} className="stat-field">
            <span>{row.label}</span>
            <FormInput
              key={`${valuesRevisionKey}-${row.key}`}
              type="number"
              defaultValue={values[row.key] ?? STAT_VALUE_RANGE.defaultValue}
              disabled={!editable}
              min={STAT_VALUE_RANGE.min}
              max={STAT_VALUE_RANGE.max}
              onBlur={(event) =>
                onChangeValue(row.key, Number(event.target.value))
              }
            />
            {/* Кнопки в одной полосе, а не одна под другой: строк в карточке
             * десяток, и второй ряд на каждой удвоил бы её высоту. */}
            <div className="stat-field__actions">
              <Button
                disabled={!editable || rollPending}
                onClick={() => onRoll(`1d20 + ${row.key}`, row.label)}
              >
                Бросок
              </Button>
              {canEditLayout && (
                <Button
                  view="flat"
                  className="stat-field__rename"
                  // Кнопка внутри `label`: без этого клик по ней считался бы
                  // кликом по подписи и уводил фокус в поле ввода.
                  onClick={(event) => {
                    event.preventDefault();
                    setEditing({ key: row.key });
                  }}
                  aria-label={`Переименовать «${row.label}»`}
                  title="Переименовать строку"
                >
                  <span aria-hidden="true">✎</span>
                </Button>
              )}
            </div>
          </label>
        ))}
        {canEditLayout && (
          <Button
            view="flat"
            className="stat-field__add"
            onClick={() => setEditing({})}
          >
            <span aria-hidden="true">＋</span> Добавить строку
          </Button>
        )}
      </div>
      <TextPromptDialog
        open={editing !== null}
        title={renamed ? "Переименовать строку" : `Новая строка — ${title}`}
        label="Название"
        initialValue={renamed?.label ?? ""}
        applyLabel="Сохранить"
        onClose={() => setEditing(null)}
        onApply={async (label) => {
          if (renamed) await onRenameRow(renamed.key, label);
          else await onAddRow(label);
          setEditing(null);
        }}
      />
    </div>
  );
}
