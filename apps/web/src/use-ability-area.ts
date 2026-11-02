import { useCallback, useEffect, useRef, useState } from "react";
import { abilityAreaCircle, abilityAreaResultSchema, type AbilityAreaApply, type GameSnapshot, type SceneDto } from "@arken/contracts";
import { api, ApiError } from "./api";
import { useLatestRef } from "./use-latest-ref";

type Draft = {
  id: string;
  campaignId: string;
  membershipId: string;
  characterId: string;
  entryId: string;
  entryRevision: number;
  sceneId: string;
  name: string;
  radiusMeters: number;
  tokenId: string;
  request: AbilityAreaApply | null;
  failed: boolean;
};
type Context = {
  snapshot: GameSnapshot | null;
  scene: SceneDto | undefined;
  previewing: boolean;
  editingGrid: boolean;
  load: () => Promise<void>;
  setError: (message: string) => void;
  onOpen: () => void;
};

function viewOf(draft: Draft | null, context: Context) {
  const { snapshot, scene } = context;
  const sameActor = Boolean(draft && snapshot && draft.campaignId === snapshot.campaign.id &&
    draft.membershipId === snapshot.me.id);
  const character = sameActor ? snapshot?.characters.find((item) => item.id === draft?.characterId) : undefined;
  const entry = character?.entries.find((item) => item.id === draft?.entryId);
  const canControl = Boolean(snapshot && character && (snapshot.me.role === "GM" ||
    character.ownerMembershipId === snapshot.me.id || character.controllerMembershipIds.includes(snapshot.me.id)));
  const tokens = sameActor && scene && draft && scene.id === draft.sceneId ? (snapshot?.tokens ?? []).filter((token) =>
    token.sceneId === scene.id && token.characterId === draft?.characterId &&
    (snapshot?.me.role === "GM" || (token.visible && token.layer === "PLAYER"))) : [];
  const origin = tokens.find((token) => token.id === draft?.tokenId);
  const scopeValid = sameActor && !context.previewing && scene?.id === draft?.sceneId;
  const circle = scopeValid && canControl && character?.lifecycle === "ACTIVE" &&
    entry?.data.areaEffect && entry.revision === draft?.entryRevision && origin && scene && draft && scene.projection === "ORTHOGRAPHIC_2D" &&
    !context.editingGrid ? abilityAreaCircle(origin, draft.radiusMeters, scene.grid) : null;
  const blocked = !scopeValid ? "Сцена или режим просмотра изменились. Выберите способность заново."
    : snapshot?.campaign.paused ? "Игра на перерыве."
    : !canControl || character?.lifecycle !== "ACTIVE" ? "Персонаж больше недоступен."
    : !entry?.data.areaEffect || entry.revision !== draft?.entryRevision ? "Способность изменилась. Выберите её заново."
    : scene?.projection !== "ORTHOGRAPHIC_2D" ? "Область пока доступна только на обычной 2D-карте."
    : context.editingGrid ? "Завершите настройку сетки, чтобы увидеть точную область."
    : !scene?.grid.metersPerCell ? "Мастер должен указать «Метров в клетке» в настройках сцены."
    : tokens.length === 0 ? "На этой сцене нет доступной фигурки применяющего персонажа."
    : !origin ? "Выберите фигурку, от которой строится область."
    : !circle ? "Нельзя построить область: проверьте масштаб и размеры фигурки."
    : entry.data.uses && entry.data.uses.current < 1 ? "Не осталось использований способности."
    : "";
  return { sameActor, entry, tokens, origin, circle, blocked };
}

/** One local preview/command at a time. No preview traffic or client targets.
 * An ambiguous POST keeps its immutable action ID and body for explicit replay.
 */
export function useAbilityArea(context: Context) {
  const latest = useLatestRef(context);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const replaceDraft = useCallback((value: Draft | null) => {
    draftRef.current = value;
    setDraft(value);
  }, []);

  useEffect(() => {
    const value = draftRef.current;
    if (!value) return;
    if (value.campaignId !== context.snapshot?.campaign.id || value.membershipId !== context.snapshot?.me.id ||
        (!value.request && (context.previewing || context.snapshot?.campaign.paused || context.scene?.id !== value.sceneId))) {
      replaceDraft(null);
      setError("");
    }
    // An already sent command is not cancelled by navigation/pause. Its receipt
    // is still reconciled, and no replacement action can slip in while pending.
  }, [context.snapshot?.campaign.id, context.snapshot?.me.id, context.snapshot?.campaign.paused,
    context.scene?.id, context.previewing, replaceDraft]);

  const prepare = useCallback((characterId: string, entryId: string, entryRevision: number) => {
    const current = latest.current;
    const entry = current.snapshot?.characters.find((item) => item.id === characterId)?.entries.find((item) => item.id === entryId);
    if (!entry?.data.areaEffect || entry.kind !== "ABILITY") return false;
    if (pendingRef.current || (draftRef.current?.request && !draftRef.current.failed))
      throw new Error("Сначала подтвердите результат предыдущего применения области.");
    if (!current.snapshot || !current.scene || current.previewing || current.snapshot.campaign.paused)
      throw new Error("Откройте игровую сцену без режима предпросмотра и перерыва.");
    if (entry.revision !== entryRevision) throw new Error("Способность изменилась. Откройте её заново.");
    const next: Draft = { id: crypto.randomUUID(), campaignId: current.snapshot.campaign.id,
      membershipId: current.snapshot.me.id, characterId, entryId, entryRevision,
      sceneId: current.scene.id, name: entry.name, radiusMeters: entry.data.areaEffect.radiusMeters,
      tokenId: "", request: null, failed: false };
    const options = viewOf(next, current).tokens;
    if (options.length === 1) next.tokenId = options[0]!.id;
    replaceDraft(next);
    setError("");
    current.onOpen();
    return true;
  }, [latest, replaceDraft]);

  const selectOrigin = useCallback((tokenId: string) => {
    const value = draftRef.current;
    if (!value || value.request || pendingRef.current) return;
    if (!viewOf(value, latest.current).tokens.some((token) => token.id === tokenId)) return;
    replaceDraft({ ...value, tokenId });
    setError("");
  }, [latest, replaceDraft]);
  const cancel = useCallback(() => {
    const value = draftRef.current;
    if (pendingRef.current || (value?.request && !value.failed)) return;
    replaceDraft(null);
    setError("");
  }, [replaceDraft]);

  const confirm = useCallback(async () => {
    const value = draftRef.current;
    const current = latest.current;
    const view = viewOf(value, current);
    if (!value || pendingRef.current || value.failed || !view.sameActor || current.previewing) return;
    if (!value.request && (view.blocked || !view.origin || !current.scene)) return;
    const request: AbilityAreaApply = value.request ?? {
      actionId: value.id, characterId: value.characterId, entryId: value.entryId,
      entryRevision: value.entryRevision, sceneId: value.sceneId,
      sceneRevision: current.scene!.revision ?? 0, casterTokenId: view.origin!.id,
      casterTokenRevision: view.origin!.revision,
    };
    pendingRef.current = true;
    setPending(true);
    replaceDraft({ ...value, request });
    setError("");
    const stillCurrent = () => draftRef.current?.id === value.id &&
      latest.current.snapshot?.campaign.id === value.campaignId && latest.current.snapshot?.me.id === value.membershipId;
    // Ending the wait is not cancelling the server mutation. A timeout remains
    // ambiguous and may only be followed by replay of this immutable command.
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      abilityAreaResultSchema.parse(await api("/api/abilities/area/apply", { method: "POST",
        signal: controller.signal, headers: { "x-action-id": request.actionId }, body: JSON.stringify(request) }));
      if (!stillCurrent()) return;
      replaceDraft(null);
      try { await current.load(); }
      catch { latest.current.setError("Способность применена, но данные не обновились. Обновите страницу; повторно применять не нужно."); }
    } catch (reason) {
      if (!stillCurrent()) return;
      const rejected = reason instanceof ApiError && reason.code !== "AREA_RETRY" &&
        (reason.details?.notApplied === true || (!value.request && [400, 401, 403, 404, 409].includes(reason.status)));
      replaceDraft({ ...value, request, failed: rejected });
      setError(reason instanceof ApiError ? reason.message : "Ответ не получен. Подтвердите результат повтором того же запроса.");
      if (rejected) {
        try { await current.load(); } catch { /* Keep the explicit rejection visible. */ }
      }
    } finally {
      window.clearTimeout(timeout);
      pendingRef.current = false;
      setPending(false);
    }
  }, [latest, replaceDraft]);

  const view = viewOf(draft, context);
  return {
    prepare, selectOrigin, cancel, confirm, pending, error,
    draft: view.sameActor ? draft : null,
    tokens: view.tokens,
    blocked: view.blocked,
    canConfirm: Boolean(draft && !pending && !draft.failed && !context.previewing && view.sameActor &&
      (draft.request || !view.blocked)),
    canCancel: !pending && (!draft?.request || draft.failed),
    preview: draft && !draft.request && view.circle && !context.snapshot?.campaign.paused ? {
      sceneId: draft.sceneId, tokenId: draft.tokenId, radiusMeters: draft.radiusMeters, circle: view.circle,
    } : null,
  };
}
