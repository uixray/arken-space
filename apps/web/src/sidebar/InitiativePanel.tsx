import { useState } from "react";
import type { InitiativeParticipantDto } from "@arken/contracts";
import { Button, TextInput } from "@gravity-ui/uikit";

/**
 * UIX-431 — очередь ходов боя.
 *
 * Панель информационная: она показывает очерёдность. «Сейчас ходит такой-то,
 * передать ход» задача явно не требует — очередь ведёт мастер вслух, и панель
 * не должна делать вид, что ведёт её сама.
 *
 * UIX-466 — порядок стал производным от введённых значений.
 *
 * Раньше расстановка собиралась руками, ввод числа порядок не менял, а
 * сортировка была отдельной кнопкой. На игре это не сработало: мастер вносил
 * броски и всё равно каждый раз нажимал «пересортировать», то есть ручной
 * порядок был не намерением, а лишней работой. Теперь очередь сортируется после
 * каждой правки — и сортирует **сервер**, чтобы порядок совпадал у всех
 * независимо от того, чей клиент прислал число. Кнопок ↑/↓ и «Пересортировать»
 * здесь больше нет: переставлять то, что вычисляется, нечем.
 *
 * Значение своей строки игрок вносит сам — право приходит с сервера строкой
 * `canEdit`. До этого броски игроков вносил мастер с их слов, то есть самое
 * частое действие боя шло через посредника.
 */
export function InitiativePanel({
  participants,
  isGm,
  pending,
  selectedTokenIds,
  onUpdate,
  onSetOwnInitiative,
  onRoll,
}: {
  participants: readonly InitiativeParticipantDto[];
  isGm: boolean;
  pending: boolean;
  /** Выделенные рамкой токены — из них собирается пополнение очереди. */
  selectedTokenIds: readonly string[];
  onUpdate: (next: InitiativeParticipantDto[]) => void;
  /**
   * Внести значение одной строки. Игроку доступен только этот путь: очередь он
   * видит отфильтрованной и отправить её целиком не может — там нет строк,
   * которые ему не показывают.
   */
  onSetOwnInitiative: (participantId: string, value: number | null) => void;
  onRoll?: (participant: InitiativeParticipantDto) => void;
}) {
  const [newName, setNewName] = useState("");

  const alreadyInBattle = new Set(
    participants
      .map((participant) => participant.tokenId)
      .filter((tokenId): tokenId is string => Boolean(tokenId)),
  );
  const addable = selectedTokenIds.filter(
    (tokenId) => !alreadyInBattle.has(tokenId),
  );

  /**
   * Мастер правит очередь целиком — он же её и собирает. Игрок отправляет одно
   * значение узкой операцией: полного состава у него нет.
   */
  const setInitiative = (id: string, value: number | null) => {
    if (!isGm) {
      onSetOwnInitiative(id, value);
      return;
    }
    onUpdate(
      participants.map((row) =>
        row.id === id ? { ...row, initiative: value } : row,
      ),
    );
  };

  return (
    // UIX-466: панель сворачивается. В бою она нужна постоянно, а между боями
    // занимает верх колонки списком, который уже ничего не решает.
    <details className="initiative-panel" open>
      <summary className="initiative-panel__summary">
        <span>Очередь ходов</span>
        {participants.length > 0 && (
          <span className="initiative-panel__summary-count">
            {participants.length}
          </span>
        )}
      </summary>
      {participants.length === 0 && (
        <p className="muted">
          {isGm
            ? "Выделите рамкой тех, кто вступает в бой, и нажмите «Ввести в бой»."
            : "Мастер ещё не собрал очередь."}
        </p>
      )}
      <ol className="initiative-panel__list">
        {participants.map((participant, index) => (
          <li key={participant.id} className="initiative-panel__row">
            <span className="initiative-panel__position">{index + 1}</span>
            <span className="initiative-panel__name">{participant.name}</span>
            {/* Бонус рядом с именем: мастер прибавляет к нему результат
                физического куба, брошенного за столом. */}
            {participant.initiativeBonus !== null && (
              <span
                className="initiative-panel__bonus"
                title={`Бонус к инициативе: ${participant.initiativeBonus}`}
              >
                {participant.initiativeBonus >= 0 ? "+" : ""}
                {participant.initiativeBonus}
              </span>
            )}
            {participant.canEdit ? (
              /* `key` по значению: поле неуправляемое, и без пересоздания оно
               * бы не показало число, приехавшее чужой правкой — а теперь ещё
               * и новый порядок после пересортировки. */
              <TextInput
                key={`${participant.id}-${participant.initiative ?? ""}`}
                className="initiative-panel__value"
                type="number"
                defaultValue={participant.initiative?.toString() ?? ""}
                placeholder="—"
                disabled={pending}
                aria-label={`Инициатива «${participant.name}»`}
                onBlur={(event) => {
                  const raw = event.target.value.trim();
                  const value = raw === "" ? null : Number(raw);
                  if (value !== null && !Number.isFinite(value)) return;
                  if (value === participant.initiative) return;
                  setInitiative(participant.id, value);
                }}
              />
            ) : (
              <span className="initiative-panel__value-read">
                {participant.initiative ?? "—"}
              </span>
            )}
            {isGm && (
              <div className="initiative-panel__actions">
                {onRoll && participant.tokenId && (
                  <Button
                    view="flat"
                    disabled={pending}
                    onClick={() => onRoll(participant)}
                    title="Бросить инициативу"
                    aria-label={`Бросить инициативу за «${participant.name}»`}
                  >
                    <span aria-hidden="true">🎲</span>
                  </Button>
                )}
                <Button
                  view="flat"
                  disabled={pending}
                  onClick={() =>
                    onUpdate(
                      participants.filter((row) => row.id !== participant.id),
                    )
                  }
                  aria-label={`Вывести «${participant.name}» из боя`}
                  title="Вывести из боя"
                >
                  <span aria-hidden="true">×</span>
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {isGm && (
        <div className="initiative-panel__controls">
          <Button
            disabled={pending || addable.length === 0}
            onClick={() =>
              onUpdate([
                ...participants,
                ...addable.map((tokenId) => ({
                  id: crypto.randomUUID(),
                  tokenId,
                  // Имя не копируется, а наследуется от токена — переименование
                  // дойдёт до очереди само (UIX-400).
                  name: "",
                  ownName: null,
                  initiative: null,
                  initiativeBonus: null,
                  canEdit: true,
                })),
              ])
            }
            title="Добавить выделенные рамкой токены"
          >
            Ввести в бой{addable.length > 0 ? ` · ${addable.length}` : ""}
          </Button>
          {/* Участник без токена — тот, кого на карте нет: «Волк №3», брошенный
           * физическим кубом за столом. */}
          <div className="initiative-panel__add-row">
            <TextInput
              value={newName}
              placeholder="Кто-то вне карты"
              disabled={pending}
              aria-label="Имя участника без токена"
              onUpdate={setNewName}
            />
            <Button
              disabled={pending || newName.trim() === ""}
              onClick={() => {
                onUpdate([
                  ...participants,
                  {
                    id: crypto.randomUUID(),
                    tokenId: null,
                    name: newName.trim(),
                    ownName: newName.trim(),
                    initiative: null,
                    initiativeBonus: null,
                    canEdit: true,
                  },
                ]);
                setNewName("");
              }}
            >
              Добавить
            </Button>
          </div>
        </div>
      )}
    </details>
  );
}
