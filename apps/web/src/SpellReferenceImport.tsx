import { useState } from "react";
import type {
  SpellReferenceImportPreviewResponse,
  SpellReferenceImportSource,
} from "@arken/contracts";
import { formatApiError } from "./api";
import {
  createSpellPackDraft,
  previewSpellReferenceImport,
  type SpellPackSummary,
} from "./spell-schools-client";

/** UIX-458: title the server gives the bundled Arken Khar reference pack. */
export const ARKEN_REFERENCE_PACK_TITLE =
  "Школы магии Аркен-Хара — референс 2024";

/** Loaded on demand: the reference is ~130 KB and only the GM ever needs it. */
const loadReferenceSource = async () =>
  (await import("../../../docs/content/magic-schools.json"))
    .default as unknown as SpellReferenceImportSource;

/**
 * GM-only: load the 13 transcribed magic schools of Arken Khar as an
 * immutable REFERENCE pack. Preview first (server-side transcription and
 * validation), then one explicit save. Hidden once the pack exists.
 */
export function SpellReferenceImport({
  packs,
  disabled,
  onImported,
}: {
  packs: readonly SpellPackSummary[];
  disabled: boolean;
  onImported: (packId: string, versionId: string) => Promise<void>;
}) {
  const [preview, setPreview] =
    useState<SpellReferenceImportPreviewResponse | null>(null);
  const [actionId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState("");

  if (packs.some((pack) => pack.title === ARKEN_REFERENCE_PACK_TITLE))
    return null;

  async function runPreview() {
    setPending("preview");
    setError("");
    try {
      setPreview(
        await previewSpellReferenceImport({
          packId: crypto.randomUUID(),
          versionId: crypto.randomUUID(),
          version: 1,
          source: await loadReferenceSource(),
        }),
      );
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось подготовить справочник."));
    } finally {
      setPending(null);
    }
  }

  async function save() {
    if (!preview) return;
    setPending("save");
    setError("");
    try {
      const saved = await createSpellPackDraft(preview.graph, actionId);
      await onImported(saved.packId, saved.versionId);
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось сохранить справочник."));
    } finally {
      setPending(null);
    }
  }

  const graph = preview?.graph;
  const openWarnings = graph?.importWarnings?.length ?? 0;
  return (
    <section
      className="spell-schools-new-pack"
      aria-label="Справочник школ Аркен-Хара"
    >
      <h3>Справочник Аркен-Хара</h3>
      {!graph ? (
        <>
          <p className="muted">
            13 школ из документов мастера: узлы, стоимость, частота и связи со
            схем. Сохраняется как неизменяемый референс.
          </p>
          <button
            type="button"
            disabled={disabled || pending !== null}
            onClick={() => void runPreview()}
          >
            {pending === "preview" ? "Готовим…" : "Посмотреть справочник"}
          </button>
        </>
      ) : (
        <>
          <p>
            {`Школ: ${graph.schools.length}, узлов: ${graph.nodes.length}, связей: ${graph.edges.length}.`}
          </p>
          {openWarnings > 0 && (
            <p className="muted">
              {`Требуют уточнения: ${openWarnings} (узлы без стоимости или частоты). До их разбора набор нельзя перевести в рабочий.`}
            </p>
          )}
          {!preview.validation.valid && (
            <p className="field-error" role="alert">
              Справочник не прошёл проверку графа.
            </p>
          )}
          <button
            type="button"
            disabled={disabled || pending !== null || !preview.validation.valid}
            onClick={() => void save()}
          >
            {pending === "save" ? "Сохраняем…" : "Загрузить справочник"}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => setPreview(null)}
          >
            Отмена
          </button>
        </>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
