import { useRef, useState } from "react";
import type { GameSnapshot, StatLayout } from "@arken/contracts";
import { useCampaignActions } from "../campaign-actions-context";
import { formatApiError } from "../api";
import { moveStatRow, statKeyFromLabel, uniqueStatKey } from "../stat-keys";
import { StatLayoutCard } from "./StatLayoutCard";

/** Campaign-owned layout: no character values or second catalog source. */
export function CampaignStatLayoutEditor({
  snapshot,
}: {
  snapshot: GameSnapshot;
}) {
  const { statLayout } = useCampaignActions();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const layout = snapshot.campaign.statLayout;
  if (snapshot.me.role !== "GM") return null;
  const save = async (next: StatLayout | null) => {
    if (!next) return;
    if (pendingRef.current)
      throw new Error("Дождитесь сохранения предыдущей правки.");
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      await statLayout.onUpdateStatLayout(next, snapshot.campaign.revision);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  const reorder = async (key: string, targetKey: string) => {
    const group = layout.find((item) =>
      item.rows.some((row) => row.key === key),
    );
    if (!group) return;
    const rows = group.rows.filter((row) => row.source !== "RESOURCE");
    const from = rows.findIndex((row) => row.key === key);
    const to = rows.findIndex((row) => row.key === targetKey);
    if (from < 0 || to < 0 || from === to) return;
    rows.splice(to, 0, rows.splice(from, 1)[0]!);
    let cursor = 0;
    try {
      await save(
        layout.map((item) =>
          item.id === group.id
            ? {
                ...item,
                rows: item.rows.map((row) =>
                  row.source === "RESOURCE" ? row : rows[cursor++]!,
                ),
              }
            : item,
        ),
      );
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось сохранить порядок строк."));
    }
  };
  return (
    <section
      className="campaign-stat-layout-editor"
      aria-label="Характеристики кампании"
      aria-busy={pending}
    >
      <p className="muted">
        Общая раскладка для всех персонажей. Изменение подписи не меняет ключ в
        формулах.
      </p>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {layout.map((group) => (
        <StatLayoutCard
          key={group.id}
          title={group.label}
          modifier="layout"
          layoutOnly
          rows={group.rows.filter((row) => row.source !== "RESOURCE")}
          values={{}}
          editable={false}
          rollPending={false}
          canEditLayout={!pending}
          onChangeValue={() => {}}
          onRoll={() => {}}
          onRenameRow={(key, label) =>
            save(
              layout.map((item) => ({
                ...item,
                rows: item.rows.map((row) =>
                  row.key === key ? { ...row, label } : row,
                ),
              })),
            )
          }
          onDeleteRow={(key) =>
            save(
              layout.map((item) => ({
                ...item,
                rows: item.rows.filter((row) => row.key !== key),
              })),
            )
          }
          onAddRow={(label) => {
            const key = uniqueStatKey(
              statKeyFromLabel(label),
              layout.flatMap((item) => item.rows.map((row) => row.key)),
            );
            if (!key)
              throw new Error(
                "Добавьте в название буквы: нужен пригодный для формул ключ.",
              );
            return save(
              layout.map((item) =>
                item.id === group.id
                  ? {
                      ...item,
                      rows: [...item.rows, { key, label, source: "STAT" }],
                    }
                  : item,
              ),
            );
          }}
          onMoveRow={async (key, direction) => {
            try {
              await save(
                moveStatRow(
                  layout,
                  key,
                  direction,
                  (row) => row.source !== "RESOURCE",
                ),
              );
            } catch (reason) {
              setError(
                formatApiError(reason, "Не удалось сохранить порядок строк."),
              );
            }
          }}
          onReorderRow={reorder}
        />
      ))}
    </section>
  );
}
