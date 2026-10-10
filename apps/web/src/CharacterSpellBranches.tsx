import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CharacterDto } from "@arken/contracts";
import { ApiError, formatApiError } from "./api";
import {
  createSchoolAssignmentEnvelope,
  loadAssignableSchools,
  loadCharacterSchoolBranches,
  reconcileSchoolAssignment,
  submitSchoolAssignment,
  type AssignableSpellSchool,
  type CharacterSpellBranch,
  type PendingSchoolAssignment,
} from "./character-spell-branches-client";
import "./CharacterSpellBranches.css";

type Props = {
  character: CharacterDto;
  isGm: boolean;
};

const schoolKey = (school: Pick<
  AssignableSpellSchool,
  "packId" | "packVersionId" | "schoolId"
>) => `${school.packId}:${school.packVersionId}:${school.schoolId}`;

export function CharacterSpellBranches({ character, isGm }: Props) {
  const activeCharacterId = useRef(character.id);
  useLayoutEffect(() => { activeCharacterId.current = character.id; }, [character.id]);
  const [branches, setBranches] = useState<CharacterSpellBranch[]>([]);
  const [assignableSchools, setAssignableSchools] = useState<
    AssignableSpellSchool[]
  >([]);
  const [loadedCharacterId, setLoadedCharacterId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [schoolLoading, setSchoolLoading] = useState(isGm);
  const [error, setError] = useState("");
  const [schoolError, setSchoolError] = useState("");
  const [selectedSchoolKey, setSelectedSchoolKey] = useState("");
  const [pending, setPending] = useState<PendingSchoolAssignment | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const loadBranches = async (requestedCharacterId: string) => {
    if (activeCharacterId.current !== requestedCharacterId) return false;
    setLoading(true);
    setError("");
    try {
      const result = await loadCharacterSchoolBranches(requestedCharacterId);
      if (activeCharacterId.current !== requestedCharacterId) return false;
      setBranches(result);
      setLoadedCharacterId(requestedCharacterId);
      return true;
    } catch (reason) {
      if (activeCharacterId.current === requestedCharacterId)
        setError(formatApiError(reason, "Не удалось загрузить доступные школы."));
      return false;
    } finally {
      if (activeCharacterId.current === requestedCharacterId)
        setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setBranches([]);
    setLoadedCharacterId(null);
    setError("");
    setNotice("");
    setPending(null);
    setSelectedSchoolKey("");
    setSaving(false);
    setLoading(character.lifecycle === "ACTIVE");
    setAssignableSchools([]);
    setSchoolError("");
    setSchoolLoading(isGm && character.lifecycle === "ACTIVE");
    if (character.lifecycle !== "ACTIVE") return;

    void loadBranches(character.id);

    if (isGm)
      void loadAssignableSchools()
        .then((result) => {
          if (!cancelled) setAssignableSchools(result);
        })
        .catch((reason) => {
          if (!cancelled)
            setSchoolError(
              formatApiError(reason, "Не удалось загрузить активные школы."),
            );
        })
        .finally(() => {
          if (!cancelled) setSchoolLoading(false);
        });

    return () => {
      cancelled = true;
    };
  }, [character.id, character.lifecycle, isGm]);

  const visibleBranches = useMemo(
    () =>
      [...branches].sort(
        (left, right) =>
          left.schoolName.localeCompare(right.schoolName) ||
          left.packId.localeCompare(right.packId) ||
          left.packVersion - right.packVersion,
      ),
    [branches],
  );
  const selectedSchool = assignableSchools.find(
    (school) => schoolKey(school) === selectedSchoolKey,
  );
  const showsCurrentCharacter = loadedCharacterId === character.id;

  const refreshBranches = () => loadBranches(character.id);

  const submit = async (command: PendingSchoolAssignment) => {
    const requestedCharacterId = character.id;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await submitSchoolAssignment(requestedCharacterId, command);
      if (activeCharacterId.current !== requestedCharacterId) return;
      setPending(null);
      setSelectedSchoolKey("");
      const refreshed = await refreshBranches();
      if (activeCharacterId.current !== requestedCharacterId) return;
      if (refreshed) setNotice("Школа выдана персонажу.");
      else setNotice("Выдача подтверждена, но список не обновлён. Повторите загрузку.");
    } catch (reason) {
      if (activeCharacterId.current !== requestedCharacterId) return;
      if (reason instanceof ApiError && reason.status === 409) {
        try {
          if (
            await reconcileSchoolAssignment(requestedCharacterId, command) &&
            activeCharacterId.current === requestedCharacterId
          ) {
            setPending(null);
            setSelectedSchoolKey("");
            await refreshBranches();
            if (activeCharacterId.current !== requestedCharacterId) return;
            setNotice("Эта школа уже выдана персонажу.");
            return;
          }
        } catch {
          // Keep the exact command and chosen school for a safe retry.
        }
      }
      setError(
        formatApiError(
          reason,
          "Не удалось подтвердить выдачу. Повторите ту же команду или обновите список.",
        ),
      );
    } finally {
      if (activeCharacterId.current === requestedCharacterId)
        setSaving(false);
    }
  };

  const assignSelected = () => {
    if (saving || !selectedSchool) return;
    const command = pending ?? createSchoolAssignmentEnvelope(selectedSchool);
    if (!pending) setPending(command);
    void submit(command);
  };

  if (character.lifecycle !== "ACTIVE")
    return (
      <section className="character-spell-branches" aria-label="Ветки заклинаний">
        <h3>Доступные ветки заклинаний</h3>
        <p className="character-spell-branches__empty">
          Архивный лист не показывает доступные ветки.
        </p>
      </section>
    );

  return (
    <section
      className="character-spell-branches"
      aria-labelledby={`spell-branches-title-${character.id}`}
      data-character-id={character.id}
    >
      <h3 id={`spell-branches-title-${character.id}`}>
        Доступные ветки заклинаний
      </h3>
      {loading ? (
        <p role="status">Загрузка веток…</p>
      ) : error ? (
        <div>
          <p className="character-spell-branches__error" role="alert">{error}</p>
          <button type="button" onClick={() => void refreshBranches()}>
            Повторить загрузку веток
          </button>
        </div>
      ) : !showsCurrentCharacter ? (
        <p role="status">Загрузка веток…</p>
      ) : visibleBranches.length === 0 ? (
        <p className="character-spell-branches__empty">
          Персонажу пока не выданы школы заклинаний.
        </p>
      ) : (
        <ul className="character-spell-branches__list">
          {visibleBranches.map((branch) => (
            <li key={schoolKey(branch)}>
              <strong>{branch.schoolName}</strong>
              <span>
                Набор …{branch.packId.slice(-6)} · версия {branch.packVersion}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isGm && (
        <div className="character-spell-branches__grant">
          <label>
            Выдать активную школу
            <select
              aria-label="Активная школа для выдачи"
              value={selectedSchoolKey}
              disabled={schoolLoading || saving || Boolean(pending)}
              onChange={(event) => setSelectedSchoolKey(event.target.value)}
            >
              <option value="">Выберите школу</option>
              {assignableSchools.map((school) => (
                <option key={schoolKey(school)} value={schoolKey(school)}>
                  {school.schoolName} — {school.packTitle} · v{school.packVersion}
                  {school.visibilityPolicy === "GM_ONLY"
                    ? " · только для мастера"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!selectedSchool || schoolLoading || saving || Boolean(pending)}
            onClick={assignSelected}
          >
            Выдать школу
          </button>
          {pending && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit(pending)}
            >
              Повторить ту же выдачу
            </button>
          )}
          {schoolLoading && <p role="status">Загрузка активных школ…</p>}
          {schoolError && (
            <p className="character-spell-branches__error" role="alert">
              {schoolError}
            </p>
          )}
          {!schoolLoading && !schoolError && assignableSchools.length === 0 && (
            <p className="character-spell-branches__empty">
              Нет активных школ. Сначала мастер должен явно активировать
              черновик в редакторе школ.
            </p>
          )}
        </div>
      )}
      {error && showsCurrentCharacter && !loading && (
        <button type="button" onClick={() => void refreshBranches()}>
          Повторить загрузку
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
