import { useMemo, useState } from "react";
import type { CatalogEntryDto } from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import { ArkenDialog } from "../ui/ArkenDialog";
import { FormInput } from "../ui/GravityFormControls";
import {
  CatalogEntryForm,
  type CatalogEntryFormInput,
} from "../CatalogEntryForm";
import { RollButton } from "./RollButton";
import { previewFormula } from "./catalog-entry-preview";

const KIND_LABEL: Record<"SKILL" | "ABILITY", string> = {
  SKILL: "навык",
  ABILITY: "способность",
};

/**
 * UIX-391: unified "Add" entry point for the skills and abilities sections
 * of the character sheet. Offers searching/reusing existing catalog entries
 * (already-assigned entries excluded by the caller — see the `options` doc
 * below) and creating a brand-new catalog entry inline via CatalogEntryForm,
 * which is immediately assigned to the character on success.
 */
export function CatalogEntryPicker({
  open,
  kind,
  options,
  statLabels,
  resourceLabels,
  onClose,
  onAssign,
  onCreate,
}: {
  open: boolean;
  kind: "SKILL" | "ABILITY";
  /** UIX-424: подписи характеристик из раскладки, для формы создания. */
  statLabels: Record<string, string>;
  resourceLabels: { physical: string; magic: string };
  /** Already filtered to this kind and excluding entries already assigned to the character. */
  options: CatalogEntryDto[];
  onClose: () => void;
  onAssign: (catalogEntryId: string) => Promise<void>;
  onCreate: (input: CatalogEntryFormInput) => Promise<CatalogEntryDto>;
}) {
  const [mode, setMode] = useState<"SELECT" | "CREATE">("SELECT");
  const [query, setQuery] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (entry) =>
        entry.name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q),
    );
  }, [options, query]);

  function reset() {
    setMode("SELECT");
    setQuery("");
    setAssigningId(null);
    setError("");
  }

  async function assign(entryId: string) {
    setAssigningId(entryId);
    setError("");
    try {
      await onAssign(entryId);
      reset();
      onClose();
    } catch {
      setError(
        "Не удалось назначить запись персонажу. Попробуйте выбрать её ещё раз.",
      );
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <ArkenDialog
      open={open}
      footer={false}
      title={
        mode === "CREATE"
          ? "Новая запись каталога"
          : `Добавить ${KIND_LABEL[kind]}`
      }
      onClose={() => {
        reset();
        onClose();
      }}
    >
      {mode === "SELECT" ? (
        <div className="catalog-entry-picker">
          <label className="field">
            Поиск
            <FormInput
              value={query}
              placeholder="Название или описание…"
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="catalog-entry-picker__list">
            {filtered.length === 0 && (
              <p className="muted">
                {options.length === 0
                  ? "Персонажу уже назначены все подходящие записи каталога."
                  : "Ничего не найдено."}
              </p>
            )}
            {filtered.map((entry) => (
              <RollButton
                key={entry.id}
                name={entry.name}
                formula={previewFormula(entry)}
                statLabels={statLabels}
                disabled={assigningId !== null}
                onClick={() => void assign(entry.id)}
              />
            ))}
          </div>
          <Button
            className="catalog-entry-picker__create"
            onClick={() => setMode("CREATE")}
          >
            + Создать новую запись
          </Button>
        </div>
      ) : (
        <CatalogEntryForm
          resourceLabels={resourceLabels}
          statLabels={statLabels}
          onCancel={() => setMode("SELECT")}
          onSubmit={async (input) => {
            // Creation itself may throw — CatalogEntryForm's own catch shows
            // that error and keeps CREATE mode open for retry, per the
            // "reuse CatalogEntryForm as-is" constraint. Note: input.kind is
            // whatever the form's own Type selector says, not necessarily
            // this picker's `kind` — CatalogEntryForm defaults it to SKILL
            // and lets the GM change it, and that choice is respected as-is
            // rather than silently overridden here.
            const created = await onCreate(input);
            // The entry now exists in the catalog regardless of what
            // happens next, so drop back to SELECT mode (where it will show
            // up once the parent's catalog snapshot refreshes) instead of
            // leaving the GM stuck on the create form.
            setMode("SELECT");
            try {
              await onAssign(created.id);
              reset();
              onClose();
            } catch {
              setError(
                "Запись сохранена в каталоге, но не удалось сразу назначить её персонажу. Найдите её в списке ниже и выберите ещё раз.",
              );
            }
          }}
        />
      )}
    </ArkenDialog>
  );
}
