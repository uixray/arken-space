import { useState } from "react";
import {
  sortByInitiative,
  type InitiativeParticipantDto,
} from "@arken/contracts";
import { Button, TextInput } from "@gravity-ui/uikit";

/**
 * UIX-431 — очередь ходов боя.
 *
 * Панель информационная: она показывает очерёдность и даёт мастеру её менять.
 * «Сейчас ходит такой-то, передать ход» задача явно не требует — очередь ведёт
 * мастер вслух, и панель не должна делать вид, что ведёт её сама.
 *
 * Ручная перестановка здесь — основной сценарий, а не запасной: часть бросков
 * делается физическими кубами за столом, и результат в систему не попадает.
 * Поэтому ввод числа порядок **не меняет** — иначе расстановка, собранная
 * руками, схлопывалась бы на каждом введённом броске. Пересортировка отдельной
 * кнопкой, по явному нажатию.
 *
 * Игрок видит список только для чтения, и в нём нет строк, которых он не видит
 * на карте: фильтрация происходит на сервере, сюда они просто не доезжают.
 */
export function InitiativePanel({
  participants,
  isGm,
  pending,
  selectedTokenIds,
  onUpdate,
  onRoll,
}: {
  participants: readonly InitiativeParticipantDto[];
  isGm: boolean;
  pending: boolean;
  /** Выделенные рамкой токены — из них собирается пополнение очереди. */
  selectedTokenIds: readonly string[];
  onUpdate: (next: InitiativeParticipantDto[]) => void;
  onRoll?: (participant: InitiativeParticipantDto) => void;
}) {
  const [newName, setNewName] = useState("");

  const move = (index: number, direction: -1 | 1) => {
    const next = [...participants];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onUpdate(next);
  };

  const alreadyInBattle = new Set(
    participants
      .map((participant) => participant.tokenId)
      .filter((tokenId): tokenId is string => Boolean(tokenId)),
  );
  const addable = selectedTokenIds.filter(
    (tokenId) => !alreadyInBattle.has(tokenId),
  );

  return (
    <section className="initiative-panel" aria-label="Очередь ходов">
      <h3>Очередь ходов</h3>
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
            {isGm ? (
              <>
                {/* `key` по значению: поле неуправляемое, и без пересоздания
                 * оно бы не показало число, приехавшее чужой правкой. */}
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
                    onUpdate(
                      participants.map((row) =>
                        row.id === participant.id
                          ? { ...row, initiative: value }
                          : row,
                      ),
                    );
                  }}
                />
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
                    disabled={pending || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Переместить «${participant.name}» выше`}
                    title="Переместить выше"
                  >
                    <span aria-hidden="true">↑</span>
                  </Button>
                  <Button
                    view="flat"
                    disabled={pending || index === participants.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Переместить «${participant.name}» ниже`}
                    title="Переместить ниже"
                  >
                    <span aria-hidden="true">↓</span>
                  </Button>
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
              </>
            ) : (
              <span className="initiative-panel__value-read">
                {participant.initiative ?? "—"}
              </span>
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
                })),
              ])
            }
            title="Добавить выделенные рамкой токены"
          >
            Ввести в бой{addable.length > 0 ? ` · ${addable.length}` : ""}
          </Button>
          <Button
            disabled={pending || participants.length < 2}
            onClick={() => onUpdate(sortByInitiative(participants))}
            title="Расставить по броскам, не трогая тех, кто ещё не бросал"
          >
            Пересортировать
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
    </section>
  );
}
