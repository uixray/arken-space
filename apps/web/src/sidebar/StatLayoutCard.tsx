import { useState } from "react";
import { Button } from "@gravity-ui/uikit";
import { STAT_VALUE_RANGE } from "@arken/system";
import { ApiError, formatApiError } from "../api";
import { FormInput } from "../ui/GravityFormControls";
import { useRemoteFieldValue } from "../ui/remote-field-value";
import { TextPromptDialog } from "../ui/TextPromptDialog";
import { ArkenDialog } from "../ui/ArkenDialog";

/** То, чем строка держится: сервер отвечает этим на попытку её удалить. */
export interface StatKeyReference {
  kind: string;
  name: string;
  owner?: string;
}

const REFERENCE_KIND_LABELS: Record<string, string> = {
  SKILL: "Навык",
  SPELL: "Заклинание",
  CATALOG_ENTRY: "Способность каталога",
  CHARACTER_ENTRY: "Способность персонажа",
};

/**
 * Разбирает отказ сервера. Список ссылок приходит только с
 * `STAT_ROW_REFERENCED`; всё остальное — обычная ошибка, и подавать её как
 * «строку кто-то держит» значило бы соврать о причине.
 */
function refusalOf(
  reason: unknown,
): { references: StatKeyReference[] } | { message: string } {
  if (reason instanceof ApiError && reason.code === "STAT_ROW_REFERENCED") {
    const references = reason.details?.references;
    if (Array.isArray(references))
      return { references: references as StatKeyReference[] };
  }
  return { message: formatApiError(reason, "Не удалось удалить строку") };
}

/**
 * UIX-532 — значение характеристики, переживающее чужую правку.
 *
 * Поле неуправляемое: правка уходит на `blur`, а пришедшее извне значение
 * доносится до живого элемента. Отдельным компонентом, потому что строк в
 * карточке десяток и они добавляются и удаляются — хук на каждую строку прямо
 * в цикле нарушил бы порядок вызовов при первом же удалении.
 */
function StatValueField({
  value,
  editable,
  onCommit,
}: {
  value: number;
  editable: boolean;
  onCommit: (value: number) => void;
}) {
  const controlRef = useRemoteFieldValue<HTMLInputElement>(String(value));
  return (
    <FormInput
      controlRef={controlRef}
      type="number"
      defaultValue={value}
      disabled={!editable}
      min={STAT_VALUE_RANGE.min}
      max={STAT_VALUE_RANGE.max}
      onBlur={(event) => onCommit(Number(event.target.value))}
    />
  );
}

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
  editable,
  rollPending,
  canEditLayout,
  onChangeValue,
  onRoll,
  onRenameRow,
  onAddRow,
  onDeleteRow,
  onMoveRow,
}: {
  title: string;
  modifier: string;
  rows: readonly { key: string; label: string }[];
  values: Record<string, number>;
  editable: boolean;
  rollPending: boolean;
  canEditLayout: boolean;
  onChangeValue: (key: string, value: number) => void;
  onRoll: (formula: string, label: string) => void;
  onRenameRow: (key: string, label: string) => Promise<void>;
  onAddRow: (label: string) => Promise<void>;
  onDeleteRow: (key: string) => Promise<void>;
  /**
   * UIX-424, шаг 7. Стрелки, а не перетаскивание: в проекте так уже
   * переставляются галерея персонажа и содержимое энциклопедии, они работают с
   * клавиатуры без отдельной поддержки, и их поведение проверяется тестом.
   * Перетаскивание можно добавить сверху той же чистой функцией, если мышью
   * окажется нужнее.
   */
  onMoveRow: (key: string, direction: "up" | "down") => Promise<void>;
}) {
  // `null` — окно закрыто; `{ key: undefined }` — добавление новой строки.
  const [editing, setEditing] = useState<{ key?: string } | null>(null);
  const renamed = editing?.key
    ? rows.find((row) => row.key === editing.key)
    : undefined;

  const [deleting, setDeleting] = useState<{
    key: string;
    label: string;
  } | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  /**
   * `null` — ещё не спрашивали. Список ссылок приходит только отказом сервера:
   * собирать его на клиенте значило бы завести вторую копию правила «что
   * считается ссылкой», и разошлись бы они там, где это дороже всего — клиент
   * сказал бы «можно», а сервер отказал.
   */
  const [refusal, setRefusal] = useState<ReturnType<typeof refusalOf> | null>(
    null,
  );

  const askToDelete = (row: { key: string; label: string }) => {
    setRefusal(null);
    setDeleting(row);
  };

  const remove = async () => {
    if (!deleting) return;
    setDeletePending(true);
    try {
      await onDeleteRow(deleting.key);
      setDeleting(null);
    } catch (reason) {
      setRefusal(refusalOf(reason));
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <div className={`character-card character-card--${modifier}`}>
      <h3 className="character-card__header">{title}</h3>
      <div className="character-card__body">
        {rows.map((row, index) => (
          <label key={row.key} className="stat-field">
            <span>{row.label}</span>
            <StatValueField
              value={values[row.key] ?? STAT_VALUE_RANGE.defaultValue}
              editable={editable}
              onCommit={(value: number) => onChangeValue(row.key, value)}
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
                <>
                  <Button
                    view="flat"
                    className="stat-field__rename"
                    disabled={index === 0}
                    onClick={(event) => {
                      event.preventDefault();
                      void onMoveRow(row.key, "up");
                    }}
                    aria-label={`Переместить «${row.label}» выше`}
                    title="Переместить выше"
                  >
                    <span aria-hidden="true">↑</span>
                  </Button>
                  <Button
                    view="flat"
                    className="stat-field__rename"
                    disabled={index === rows.length - 1}
                    onClick={(event) => {
                      event.preventDefault();
                      void onMoveRow(row.key, "down");
                    }}
                    aria-label={`Переместить «${row.label}» ниже`}
                    title="Переместить ниже"
                  >
                    <span aria-hidden="true">↓</span>
                  </Button>
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
                  <Button
                    view="flat"
                    className="stat-field__rename"
                    onClick={(event) => {
                      event.preventDefault();
                      askToDelete(row);
                    }}
                    aria-label={`Удалить «${row.label}»`}
                    title="Удалить строку"
                  >
                    <span aria-hidden="true">×</span>
                  </Button>
                </>
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
      <ArkenDialog
        open={deleting !== null}
        title={`Удалить «${deleting?.label ?? ""}»?`}
        applyLabel="Удалить"
        danger
        loading={deletePending}
        onApply={() => void remove()}
        onClose={() => setDeleting(null)}
      >
        {refusal === null ? (
          <p>
            Значения этой строки останутся в данных персонажей, но показывать её
            карточка перестанет.
          </p>
        ) : "references" in refusal ? (
          /* Отказ, а не предупреждение: строку держат формулы, и удалить её
           * можно только починив их. Список — это то, что мастеру предстоит
           * открыть, поэтому здесь имена, а не количество. */
          <div role="alert">
            <p>
              Удалить нельзя: на строку ссылаются броски. Сначала поправьте их
              формулы, иначе бросок откажет посреди игры.
            </p>
            <ul>
              {refusal.references.map((reference, index) => (
                <li key={`${reference.kind}-${reference.name}-${index}`}>
                  {`${REFERENCE_KIND_LABELS[reference.kind] ?? reference.kind}: ${reference.name}${
                    reference.owner ? ` — ${reference.owner}` : ""
                  }`}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p role="alert">{refusal.message}</p>
        )}
      </ArkenDialog>
    </div>
  );
}
