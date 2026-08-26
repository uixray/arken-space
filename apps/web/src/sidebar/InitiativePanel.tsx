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
 * независимо от того, чей клиент прислал число. Кнопки «Пересортировать» здесь
 * больше нет: она стала лишней работой.
 *
 * UIX-466 п. 9 — но переставить руками мастер обязан уметь.
 *
 * Кнопки ↑/↓ вернулись в новом смысле: они не «двигают строку в списке», а
 * закрепляют её на месте. Обмен закрепляет **обе** участвовавшие строки —
 * закрепив одну, вторую мы отпустили бы в общий пул, откуда сортировка унесла
 * бы её не туда, где её только что оставили руками. Закрепление снимается
 * кнопкой-булавкой, иначе к автоматике было бы не вернуться.
 *
 * Перетаскивание намеренно не делалось: кнопки работают с клавиатуры и на
 * планшете, и их поведение проверяется тестом — а имитация drag в jsdom
 * проверяла бы саму имитацию.
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
  onRecruitFromZone,
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
  /**
   * UIX-466 п. 3 — подтянуть тех, кто сейчас в зоне боя. `undefined`, когда
   * зона не задана: кнопка, которая всегда отвечает отказом, хуже отсутствующей.
   */
  onRecruitFromZone?: () => void;
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

  /**
   * Обмен соседей. Закрепляются оба: порядок этой пары мастер только что задал
   * руками, и следующий чужой бросок не должен его расталкивать.
   */
  const swap = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= participants.length) return;
    const next = participants.map((row) => ({ ...row }));
    next[index] = { ...participants[target]!, pinned: true };
    next[target] = { ...participants[index]!, pinned: true };
    onUpdate(next);
  };

  const unpin = (id: string) =>
    onUpdate(
      participants.map((row) =>
        row.id === id ? { ...row, pinned: false } : row,
      ),
    );

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
            ? "Обведите зону боя на карте или выделите рамкой тех, кто вступает в бой."
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
            <div className="initiative-panel__actions">
              {/* Булавка только у закреплённых: у остальных ей нечего снимать,
                  а ряд одинаковых серых кнопок мешал бы найти нужную. Игрок её
                  видит, но не нажимает — это объяснение, а не ручка. */}
              {participant.pinned &&
                (isGm ? (
                  <Button
                    view="flat"
                    disabled={pending}
                    onClick={() => unpin(participant.id)}
                    title="Открепить: строка снова встанет по броску"
                    aria-label={`Открепить «${participant.name}»`}
                  >
                    <span aria-hidden="true">📌</span>
                  </Button>
                ) : (
                  <span
                    className="initiative-panel__pinned"
                    title="Место задано мастером"
                    aria-label={`«${participant.name}» — место задано мастером`}
                  >
                    <span aria-hidden="true">📌</span>
                  </span>
                ))}
              {isGm && (
                <>
                  <Button
                    view="flat"
                    disabled={pending || index === 0}
                    onClick={() => swap(index, -1)}
                    title="Поставить выше и закрепить"
                    aria-label={`Переместить «${participant.name}» выше`}
                  >
                    <span aria-hidden="true">↑</span>
                  </Button>
                  <Button
                    view="flat"
                    disabled={pending || index === participants.length - 1}
                    onClick={() => swap(index, 1)}
                    title="Поставить ниже и закрепить"
                    aria-label={`Переместить «${participant.name}» ниже`}
                  >
                    <span aria-hidden="true">↓</span>
                  </Button>
                </>
              )}
              {/* Бросок доступен по тому же праву, что и ввод значения: игрок
                  бросает за себя, мастер — за любого. Кубик и перенос числа
                  руками были двумя действиями там, где смысл один. */}
              {onRoll && participant.tokenId && participant.canEdit && (
                <Button
                  view="flat"
                  disabled={pending}
                  onClick={() => onRoll(participant)}
                  title="Бросить инициативу и записать в строку"
                  aria-label={`Бросить инициативу за «${participant.name}»`}
                >
                  <span aria-hidden="true">🎲</span>
                </Button>
              )}
              {isGm && (
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
              )}
            </div>
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
                  pinned: false,
                })),
              ])
            }
            title="Добавить выделенные рамкой токены"
          >
            Ввести в бой{addable.length > 0 ? ` · ${addable.length}` : ""}
          </Button>
          {/* UIX-466 п. 3: пополнение по зоне — рядом с ручным вводом, потому
              что это тот же вопрос «кто в бою», решённый рамкой на карте
              вместо выделения. Показывается только когда зона задана. */}
          {onRecruitFromZone && (
            <Button
              disabled={pending}
              onClick={onRecruitFromZone}
              title="Добавить всех, кто сейчас в зоне боя; уже введённых не тронет"
            >
              Обновить по зоне
            </Button>
          )}
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
                    pinned: false,
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
