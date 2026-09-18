import { useState } from "react";
import { Button } from "./Button";

import { api, ApiError, formatApiError } from "../api";
import { FormSelect } from "../ui/GravityFormControls";
import { isPlayerThemeId, type PlayerThemeDefinition } from "./player-themes";

type MemberThemeProjection = {
  id: string;
  defaultThemeId: string;
  revision: number;
};

export function MemberDefaultThemeField({
  membership,
  publishedThemes,
}: {
  membership: MemberThemeProjection;
  publishedThemes: readonly PlayerThemeDefinition[];
}) {
  const themes = publishedThemes.filter(({ id }) => isPlayerThemeId(id));
  const initialThemeId = themes.some(
    ({ id }) => id === membership.defaultThemeId,
  )
    ? membership.defaultThemeId
    : (themes[0]?.id ?? "");
  const [saved, setSaved] = useState({
    themeId: initialThemeId,
    revision: membership.revision,
  });
  const [draft, setDraft] = useState(initialThemeId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (themes.length === 0) return null;

  const submit = async () => {
    if (pending || draft === saved.themeId) return;
    setPending(true);
    setError("");
    try {
      const updated = await api<MemberThemeProjection>(
        `/api/members/${encodeURIComponent(membership.id)}/theme-default`,
        {
          method: "PATCH",
          body: JSON.stringify({
            defaultThemeId: draft,
            expectedRevision: saved.revision,
          }),
        },
      );
      setSaved({ themeId: updated.defaultThemeId, revision: updated.revision });
      setDraft(updated.defaultThemeId);
    } catch (reason) {
      const conflict =
        reason instanceof ApiError &&
        reason.status === 409 &&
        reason.code === "THEME_DEFAULT_CONFLICT"
          ? (reason.details?.membership as MemberThemeProjection | undefined)
          : undefined;
      if (conflict?.id === membership.id) {
        setSaved({
          themeId: conflict.defaultThemeId,
          revision: conflict.revision,
        });
        setDraft(conflict.defaultThemeId);
        setError("Тема игрока уже изменена в другом окне.");
      } else {
        setError(formatApiError(reason, "Не удалось назначить тему игроку."));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="field" aria-busy={pending}>
      <label>
        Тема игрока по умолчанию
        <FormSelect
          value={draft}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
        >
          {themes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </FormSelect>
      </label>
      <Button
        view="outlined"
        loading={pending}
        disabled={pending || draft === saved.themeId}
        onClick={() => void submit()}
      >
        Назначить тему
      </Button>
      {error ? <div role="alert">{error}</div> : null}
    </div>
  );
}
