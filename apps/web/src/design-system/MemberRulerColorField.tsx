import { useState } from "react";
import type { MembershipDto, RulerColorKey } from "@arken/contracts";
import { api, formatApiError } from "../api";
import { FormSelect } from "../ui/GravityFormControls";

const RULER_COLOR_LABELS: Record<RulerColorKey, string> = {
  green: "Зелёный",
  lilac: "Лиловый",
  orange: "Оранжевый",
  purple: "Фиолетовый",
  black: "Чёрный",
  blue: "Синий",
};

/**
 * UIX-509: the GM picks each member's ruler colour. Members without one keep
 * the automatic per-member colour; peers see a change on the next ruler move.
 */
export function MemberRulerColors({
  members,
}: {
  members: readonly MembershipDto[];
}) {
  return (
    <section className="member-ruler-colors" aria-label="Цвета линеек">
      <h3>Цвета линеек</h3>
      {members.map((member) => (
        <MemberRulerColorField key={member.id} member={member} />
      ))}
    </section>
  );
}

function MemberRulerColorField({ member }: { member: MembershipDto }) {
  const [saved, setSaved] = useState<RulerColorKey | null>(
    member.rulerColor ?? null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const save = async (next: RulerColorKey | null) => {
    if (pending || next === saved) return;
    setPending(true);
    setError("");
    try {
      const updated = await api<{ rulerColor: RulerColorKey | null }>(
        `/api/members/${encodeURIComponent(member.id)}/ruler-color`,
        { method: "PATCH", body: JSON.stringify({ rulerColor: next }) },
      );
      setSaved(updated.rulerColor);
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось сохранить цвет линейки."));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="field" aria-busy={pending}>
      <label>
        {member.displayName}
        <FormSelect
          value={saved ?? ""}
          disabled={pending}
          onChange={(event) =>
            void save((event.target.value || null) as RulerColorKey | null)
          }
        >
          <option value="">Автоматический</option>
          {(Object.keys(RULER_COLOR_LABELS) as RulerColorKey[]).map((key) => (
            <option key={key} value={key}>
              {RULER_COLOR_LABELS[key]}
            </option>
          ))}
        </FormSelect>
      </label>
      {error ? <div role="alert">{error}</div> : null}
    </div>
  );
}
