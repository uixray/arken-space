import {
  areaPendingKey,
  readAreaPending,
  writeAreaPending,
  clearAreaPending,
  type StoredAreaCommand,
} from "./ability-area-pending";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  abilityAreaCircle,
  abilityAreaResultSchema,
  type AbilityAreaApply,
  type GameSnapshot,
  type SceneDto,
} from "@arken/contracts";
import { api, formatApiError } from "./api";
import { useLatestRef } from "./use-latest-ref";

type Draft = {
  id: string;
  campaignId: string;
  membershipId: string;
  characterId: string;
  entryId: string;
  entryRevision: number;
  consumesItem?: boolean;
  cancellationRequested?: true;
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
  const sameActor = Boolean(
    draft &&
    snapshot &&
    draft.campaignId === snapshot.campaign.id &&
    draft.membershipId === snapshot.me.id,
  );
  const character = sameActor
    ? snapshot?.characters.find((item) => item.id === draft?.characterId)
    : undefined;
  const entry = character?.entries.find((item) => item.id === draft?.entryId);
  const canControl = Boolean(
    snapshot &&
    character &&
    (snapshot.me.role === "GM" ||
      character.ownerMembershipId === snapshot.me.id ||
      character.controllerMembershipIds.includes(snapshot.me.id)),
  );
  const tokens =
    sameActor && scene && draft && scene.id === draft.sceneId
      ? (snapshot?.tokens ?? []).filter(
          (token) =>
            token.sceneId === scene.id &&
            token.characterId === draft?.characterId &&
            (snapshot?.me.role === "GM" ||
              (token.visible && token.layer === "PLAYER")),
        )
      : [];
  const origin = tokens.find((token) => token.id === draft?.tokenId);
  const scopeValid =
    sameActor && !context.previewing && scene?.id === draft?.sceneId;
  const circle =
    scopeValid &&
    canControl &&
    character?.lifecycle === "ACTIVE" &&
    entry?.data.areaEffect &&
    entry.revision === draft?.entryRevision &&
    origin &&
    scene &&
    draft &&
    scene.projection === "ORTHOGRAPHIC_2D" &&
    !context.editingGrid
      ? abilityAreaCircle(origin, draft.radiusMeters, scene.grid)
      : null;
  const blocked = !scopeValid
    ? "Сцена или режим просмотра изменились. Выберите способность заново."
    : snapshot?.campaign.paused
      ? "Игра на перерыве."
      : !canControl || character?.lifecycle !== "ACTIVE"
        ? "Персонаж больше недоступен."
        : !entry?.data.areaEffect || entry.revision !== draft?.entryRevision
          ? "Способность изменилась. Выберите её заново."
          : scene?.projection !== "ORTHOGRAPHIC_2D"
            ? "Область пока доступна только на обычной 2D-карте."
            : context.editingGrid
              ? "Завершите настройку сетки, чтобы увидеть точную область."
              : !scene?.grid.metersPerCell
                ? "Мастер должен указать «Метров в клетке» в настройках сцены."
                : tokens.length === 0
                  ? "На этой сцене нет доступной фигурки применяющего персонажа."
                  : !origin
                    ? "Выберите фигурку, от которой строится область."
                    : !circle
                      ? "Нельзя построить область: проверьте масштаб и размеры фигурки."
                      : entry.data.uses && entry.data.uses.current < 1
                        ? "Не осталось использований способности."
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
  const [storageError, setStorageError] = useState("");
  const [notice, setNotice] = useState<{
    campaignId: string;
    membershipId: string;
    text: string;
  } | null>(null);
  const replaceDraft = useCallback((value: Draft | null) => {
    draftRef.current = value;
    setDraft(value);
  }, []);

  useEffect(() => {
    const campaignId = context.snapshot?.campaign.id,
      membershipId = context.snapshot?.me.id;
    if (!campaignId || !membershipId) {
      replaceDraft(null);
      setStorageError("");
      return;
    }
    const key = areaPendingKey(campaignId, membershipId);
    const sync = () => {
      try {
        const stored = readAreaPending(campaignId, membershipId);
        setStorageError("");
        if (stored) {
          replaceDraft({ ...stored, failed: false });
          setError("");
        } else {
          const old = draftRef.current;
          if (
            old?.request ||
            old?.campaignId !== campaignId ||
            old?.membershipId !== membershipId
          )
            replaceDraft(null);
        }
      } catch (e) {
        setStorageError(formatApiError(e));
      }
    };
    sync();
    const changed = (e: StorageEvent) => {
      if (e.key === key || e.key === null) sync();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [context.snapshot?.campaign.id, context.snapshot?.me.id, replaceDraft]);

  useEffect(() => {
    const value = draftRef.current;
    if (!value) return;
    if (
      value.campaignId !== context.snapshot?.campaign.id ||
      value.membershipId !== context.snapshot?.me.id ||
      (!value.request &&
        (context.previewing ||
          context.snapshot?.campaign.paused ||
          context.scene?.id !== value.sceneId))
    ) {
      replaceDraft(null);
      setError("");
    }
    // An already sent command is not cancelled by navigation/pause. Its receipt
    // is still reconciled, and no replacement action can slip in while pending.
  }, [
    context.snapshot?.campaign.id,
    context.snapshot?.me.id,
    context.snapshot?.campaign.paused,
    context.scene?.id,
    context.previewing,
    replaceDraft,
  ]);

  const prepare = useCallback(
    (characterId: string, entryId: string, entryRevision: number) => {
      const current = latest.current;
      const entry = current.snapshot?.characters
        .find((item) => item.id === characterId)
        ?.entries.find((item) => item.id === entryId);
      if (!entry?.data.areaEffect || entry.kind !== "ABILITY") return false;
      if (
        pendingRef.current ||
        (draftRef.current?.request && !draftRef.current.failed)
      )
        throw new Error(
          "Сначала подтвердите результат предыдущего применения области.",
        );
      if (
        !current.snapshot ||
        !current.scene ||
        current.previewing ||
        current.snapshot.campaign.paused
      )
        throw new Error(
          "Откройте игровую сцену без режима предпросмотра и перерыва.",
        );
      if (entry.revision !== entryRevision)
        throw new Error("Способность изменилась. Откройте её заново.");
      const saved = readAreaPending(
        current.snapshot.campaign.id,
        current.snapshot.me.id,
      );
      if (saved) {
        replaceDraft({ ...saved, failed: false });
        throw new Error("Сначала восстановите сохранённое применение области.");
      }
      const next: Draft = {
        id: crypto.randomUUID(),
        campaignId: current.snapshot.campaign.id,
        membershipId: current.snapshot.me.id,
        characterId,
        entryId,
        entryRevision,
        sceneId: current.scene.id,
        name: entry.name,
        radiusMeters: entry.data.areaEffect.radiusMeters,
        tokenId: "",
        request: null,
        failed: false,
      };
      const options = viewOf(next, current).tokens;
      if (options.length === 1) next.tokenId = options[0]!.id;
      replaceDraft(next);
      setError("");
      current.onOpen();
      return true;
    },
    [latest, replaceDraft],
  );

  const selectOrigin = useCallback(
    (tokenId: string) => {
      const value = draftRef.current;
      if (!value || value.request || pendingRef.current) return;
      if (
        !viewOf(value, latest.current).tokens.some(
          (token) => token.id === tokenId,
        )
      )
        return;
      replaceDraft({ ...value, tokenId });
      setError("");
    },
    [latest, replaceDraft],
  );
  const send = useCallback(
    async (cancelRequest: boolean) => {
      const value = draftRef.current,
        current = latest.current;
      const view = viewOf(value, current);
      if (!value || pendingRef.current || !view.sameActor) return;
      if (
        !value.request &&
        (cancelRequest ||
          current.previewing ||
          view.blocked ||
          !view.origin ||
          !current.scene)
      )
        return;
      const request: AbilityAreaApply = value.request ?? {
        actionId: value.id,
        characterId: value.characterId,
        entryId: value.entryId,
        entryRevision: value.entryRevision,
        sceneId: value.sceneId,
        sceneRevision: current.scene!.revision ?? 0,
        casterTokenId: view.origin!.id,
        casterTokenRevision: view.origin!.revision,
      };
      const { failed: _failed, ...metadata } = value;
      let command: StoredAreaCommand = {
        ...metadata,
        tokenId: request.casterTokenId,
        request,
      };
      const key = areaPendingKey(value.campaignId, value.membershipId);
      const sameActor = () =>
        latest.current.snapshot?.campaign.id === value.campaignId &&
        latest.current.snapshot?.me.id === value.membershipId;
      pendingRef.current = true;
      setPending(true);
      setError("");
      setNotice(null);
      try {
        if (!navigator.locks)
          throw new Error(
            "Для безопасного восстановления нужен браузер с Web Locks и HTTPS или localhost.",
          );
        await navigator.locks.request(
          `arken-area:${key}`,
          { mode: "exclusive", ifAvailable: true },
          async (lock) => {
            if (!lock)
              throw new Error(
                "Применение области выполняется в другой вкладке.",
              );
            if (!sameActor())
              throw new Error("Участник или кампания изменились.");
            const saved = readAreaPending(value.campaignId, value.membershipId);
            if (value.request && !saved) {
              // Another tab may already have reconciled this command. Do not
              // resurrect it from stale in-memory state; refresh the projection.
              replaceDraft(null);
              await current.load();
              return;
            }
            // Persist cancellation before sending it, and honor an intent saved by
            // another tab even when this tab still displays the older apply state.
            if (cancelRequest || saved?.cancellationRequested)
              command = { ...command, cancellationRequested: true };
            writeAreaPending(command);
            replaceDraft({ ...command, failed: false });
            setStorageError("");
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 30_000);
            try {
              const receipt = abilityAreaResultSchema.parse(
                await api(
                  `/api/abilities/area/${command.cancellationRequested ? "cancel" : "apply"}`,
                  {
                    method: "POST",
                    signal: controller.signal,
                    body: JSON.stringify(command.request),
                    headers: {
                      "x-action-id": command.id,
                      "x-entry-campaign": command.campaignId,
                      "x-entry-member": command.membershipId,
                    },
                  },
                ),
              );
              if (receipt.actionId !== command.id)
                throw new Error(
                  "Ответ не подтверждает сохранённую команду области.",
                );
              clearAreaPending(command);
              if (!sameActor()) return;
              if (draftRef.current?.id === command.id) replaceDraft(null);
              setNotice({
                campaignId: command.campaignId,
                membershipId: command.membershipId,
                text:
                  "cancelled" in receipt
                    ? "Команда области отменена сервером без применения."
                    : "Применение области подтверждено сервером.",
              });
              try {
                await current.load();
              } catch {
                latest.current.setError(
                  "Результат области подтверждён, но данные не обновились. Обновите страницу без нового применения.",
                );
              }
            } finally {
              window.clearTimeout(timeout);
            }
          },
        );
      } catch (reason) {
        if (!sameActor()) return;
        try {
          const saved = readAreaPending(value.campaignId, value.membershipId);
          if (saved) replaceDraft({ ...saved, failed: false });
        } catch (e) {
          setStorageError(formatApiError(e));
        }
        setError(formatApiError(reason));
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [latest, replaceDraft],
  );
  const confirm = useCallback(() => send(false), [send]);
  const cancel = useCallback(() => {
    if (pendingRef.current) return;
    if (draftRef.current?.request) {
      if (
        window.confirm(
          "Отменить только невыполненную команду области? Уже применённый эффект не будет отменён.",
        )
      )
        void send(true);
    } else {
      replaceDraft(null);
      setError("");
    }
  }, [send, replaceDraft]);

  const view = viewOf(draft, context);
  return {
    prepare,
    selectOrigin,
    cancel,
    confirm,
    pending,
    error,
    storageError,
    notice:
      notice?.campaignId === context.snapshot?.campaign.id &&
      notice?.membershipId === context.snapshot?.me.id
        ? (notice?.text ?? "")
        : "",
    dismissNotice: () => setNotice(null),
    draft: view.sameActor ? draft : null,
    tokens: view.tokens,
    blocked: view.blocked,
    canConfirm: Boolean(
      draft &&
      !pending &&
      !storageError &&
      view.sameActor &&
      (draft.request || (!context.previewing && !view.blocked)),
    ),
    canCancel: !pending && !storageError,
    preview:
      draft &&
      !draft.request &&
      view.circle &&
      !context.snapshot?.campaign.paused
        ? {
            sceneId: draft.sceneId,
            tokenId: draft.tokenId,
            radiusMeters: draft.radiusMeters,
            circle: view.circle,
          }
        : null,
  };
}
