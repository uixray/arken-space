import { useEffect, useRef, useState } from "react";
import {
  tokenFacingSchema,
  tokenSpritePoseSchema,
  tokenSpriteSetSchema,
  type AssetDto,
  type TokenDefinitionDto,
  type TokenSpriteSet,
} from "@arken/contracts";
import { api, ApiError, formatApiError } from "../api";

const directions = {
  FRONT: "Спереди",
  BACK: "Сзади",
  LEFT: "Слева",
  RIGHT: "Справа",
};
const poses = { IDLE: "Стоит", PRONE: "Лежит / без сознания", FLYING: "Летит" };
const messages: Record<string, string> = {
  TOKEN_DEFINITION_CONFLICT:
    "Токен изменён. Закройте и снова откройте набор, чтобы загрузить актуальную версию.",
  SPRITE_TRANSPARENT_IMAGE_REQUIRED: "Нужен PNG или WebP с прозрачностью.",
  SPRITE_STATIC_SQUARE_REQUIRED:
    "Нужен квадратный статичный кадр с альфа-каналом, без анимации.",
  SPRITE_DERIVATIVE_TOO_LARGE: "Кадр слишком тяжёлый даже после уменьшения.",
  SPRITE_DERIVATIVE_REQUIRED:
    "Кадр изменён или не подготовлен для фигурки. Загрузите его заново.",
};

/** Mounted only while editing; parent keys by campaign/member/definition. */
export function TokenSpriteEditor({
  definition,
  refresh,
  onClose,
}: {
  definition: TokenDefinitionDto;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TokenSpriteSet>(
    () =>
      definition.spriteSet ?? {
        version: 1,
        pivot: { x: 0.5, y: 1 },
        frames: [],
      },
  );
  const [revision] = useState(definition.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(false);
  const attempt = useRef<{ signature: string; actionId: string } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const report = (reason: unknown) =>
    setError(
      reason instanceof ApiError
        ? (messages[reason.code] ?? formatApiError(reason))
        : formatApiError(reason),
    );

  async function upload(
    file: File,
    pose: TokenSpriteSet["frames"][number]["pose"],
    direction: TokenSpriteSet["frames"][number]["direction"],
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const asset = await api<AssetDto>("/api/assets/sprite-frame", {
        method: "POST",
        headers: { "x-action-id": crypto.randomUUID() },
        body: form,
      });
      if (alive.current)
        setDraft((current) => ({
          ...current,
          frames: [
            ...current.frames.filter(
              (frame) => frame.pose !== pose || frame.direction !== direction,
            ),
            { pose, direction, assetId: asset.id },
          ],
        }));
    } catch (reason) {
      if (alive.current) report(reason);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function save(remove: boolean) {
    if (pending.current) return;
    const parsed = tokenSpriteSetSchema.safeParse(draft);
    if (!remove && !parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте набор");
      return;
    }
    const spriteSet = remove ? null : parsed.success ? parsed.data : null;
    const signature = JSON.stringify({ revision, spriteSet });
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, actionId: crypto.randomUUID() };
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/api/token-definitions/${definition.id}/sprite-set`, {
        method: "PUT",
        body: JSON.stringify({
          actionId: attempt.current.actionId,
          revision,
          spriteSet,
        }),
      });
      if (alive.current) await refresh();
      if (alive.current) onClose();
    } catch (reason) {
      if (alive.current) report(reason);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      aria-label={`Фигурка ${definition.name}`}
      draggable={false}
      onDragStart={(event) => event.stopPropagation()}
    >
      <p>
        Квадратные PNG/WebP с прозрачностью, одинаковым холстом и опорой у ног.
        На карту идут кадры 512×512. Обязателен «Стоит — Спереди». Пропуски
        используют резервные кадры. Полёт не меняет высоту или правила.
      </p>
      <fieldset disabled={busy}>
        <legend>Кадры фигурки</legend>
        {tokenSpritePoseSchema.options.map((pose) => (
          <div key={pose}>
            <strong>{poses[pose]}</strong>
            {tokenFacingSchema.options.map((direction) => {
              const frame = draft.frames.find(
                (item) => item.pose === pose && item.direction === direction,
              );
              return (
                <div key={direction}>
                  <label>
                    {directions[direction]} —{" "}
                    {frame ? "кадр задан" : "резервный кадр"}
                    <input
                      type="file"
                      accept="image/png,image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void upload(file, pose, direction);
                      }}
                    />
                  </label>
                  {frame && (
                    <img
                      src={`/api/assets/${frame.assetId}/content`}
                      alt={`${poses[pose]} — ${directions[direction]}`}
                      width={72}
                      height={72}
                      loading="lazy"
                      style={{ objectFit: "contain" }}
                    />
                  )}
                  {frame && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          frames: current.frames.filter(
                            (item) =>
                              item.pose !== pose ||
                              item.direction !== direction,
                          ),
                        }))
                      }
                    >
                      Убрать кадр {poses[pose]} — {directions[direction]}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {(["x", "y"] as const).map((axis) => (
          <label key={axis}>
            Опора {axis} (0–1)
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={draft.pivot[axis]}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  pivot: {
                    ...current.pivot,
                    [axis]: event.target.valueAsNumber,
                  },
                }))
              }
            />
          </label>
        ))}
        <button type="button" onClick={() => void save(false)}>
          Сохранить набор
        </button>
        {definition.spriteSet && (
          <button type="button" onClick={() => void save(true)}>
            Вернуть круглый токен
          </button>
        )}
        <button type="button" onClick={onClose}>
          Закрыть без сохранения
        </button>
      </fieldset>
      <p className="muted">
        Загрузка кадров сама по себе не меняет токен. Неиспользованные файлы
        остаются в медиатеке.
      </p>
      {busy && <p role="status">Сохранение…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
