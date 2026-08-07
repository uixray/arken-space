import { useEffect, useState } from "react";
import type {
  EncounterFocusRegion,
  EncounterMode,
  EncounterPreflightResponse,
  GameSnapshot,
  SceneDto,
} from "@arken/contracts";
import { ArkenDialog } from "./ui/ArkenDialog";
import { formatApiError } from "./api";
import { fetchEncounterPreflight } from "./encounter-preflight";
import { startEncounter, type StartEncounterInput } from "./encounter-actions";

/**
 * UIX-311 Stage 4: the one real GM confirmation step both entry points
 * (tactical-canvas SCENE_REGION drag, world-map LINKED_SCENE scene picker)
 * funnel into before POST /api/encounters/start actually fires. Shows the
 * party roster plus the Stage 3 missing-token warning for the target scene,
 * so nothing starts silently.
 */
export interface EncounterDraft {
  mode: EncounterMode;
  /** The scene combat launches from — the campaign's currently active scene. */
  sourceScene: SceneDto;
  targetSceneId: string;
  targetSceneName: string;
  focusRegion?: EncounterFocusRegion;
  locationId?: string;
}

export function EncounterConfirmDialog({
  draft,
  snapshot,
  onClose,
  onStarted,
}: {
  draft: EncounterDraft | null;
  snapshot: GameSnapshot;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [preflight, setPreflight] = useState<EncounterPreflightResponse | null>(
    null,
  );
  const [preflightError, setPreflightError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPreflight(null);
    setPreflightError("");
    setError("");
    setLoading(false);
    if (!draft) return;
    let cancelled = false;
    void fetchEncounterPreflight(draft.targetSceneId, draft.locationId)
      .then((result) => {
        if (!cancelled) setPreflight(result);
      })
      .catch((reason) => {
        if (!cancelled)
          setPreflightError(
            formatApiError(reason, "Не удалось проверить токены."),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [draft]);

  if (!draft) return null;

  const participants = snapshot.members.filter(
    (member) => member.role === "PLAYER",
  );
  const missing = new Set(preflight?.missingTokenMembershipIds ?? []);

  const confirm = async () => {
    setLoading(true);
    setError("");
    try {
      const input: StartEncounterInput =
        draft.mode === "SCENE_REGION"
          ? {
              mode: "SCENE_REGION",
              sourceSceneId: draft.sourceScene.id,
              sourceSceneRevision: draft.sourceScene.revision ?? 0,
              focusRegion: draft.focusRegion!,
            }
          : {
              mode: "LINKED_SCENE",
              sourceSceneId: draft.sourceScene.id,
              sourceSceneRevision: draft.sourceScene.revision ?? 0,
              targetSceneId: draft.targetSceneId,
              locationId: draft.locationId,
            };
      await startEncounter(input);
      onStarted();
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось начать бой."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ArkenDialog
      open
      title="Начать бой"
      applyLabel="Начать бой"
      cancelLabel="Отмена"
      loading={loading}
      error={error}
      onApply={() => void confirm()}
      onClose={onClose}
    >
      <div className="encounter-confirm">
        <p className="arken-dialog-message">
          {draft.mode === "SCENE_REGION"
            ? `Область боя на текущей сцене «${draft.sourceScene.name}». Камеры игроков сфокусируются на выделенной области.`
            : `Переход со сцены «${draft.sourceScene.name}» на «${draft.targetSceneName}». Токены игроков переместятся автоматически.`}
        </p>
        <strong>Участники</strong>
        {participants.length ? (
          <ul className="encounter-confirm__participants">
            {participants.map((member) => (
              <li key={member.id}>
                {member.displayName}
                {missing.has(member.id) ? (
                  <span role="alert"> — нет токена на целевой сцене</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>В кампании пока нет игроков.</p>
        )}
        {preflightError ? <p role="alert">{preflightError}</p> : null}
      </div>
    </ArkenDialog>
  );
}
