import { useEffect, useRef, useState } from "react";
import type { InitiativeParticipantDto } from "@arken/contracts";
import type { GameSnapshot } from "@arken/contracts";
import { InitiativePanel } from "./InitiativePanel";

type Props = {
  snapshot: GameSnapshot;
  selectedTokenIds: readonly string[];
  onUpdateInitiative: (
    participants: InitiativeParticipantDto[],
    revision: number,
  ) => Promise<void>;
  onSetOwnInitiative: (
    participantId: string,
    initiative: number | null,
    revision: number,
  ) => Promise<void>;
  onRollInitiative: (
    participants: readonly InitiativeParticipantDto[],
    participant: InitiativeParticipantDto,
    revision: number,
    isGm: boolean,
  ) => Promise<void>;
  onRecruitFromZone?: () => void;
};

function encounterScopeKey(snapshot: GameSnapshot): string {
  return (snapshot.encounters ?? [])
    .filter((encounter) => encounter.campaignId === snapshot.campaign.id)
    .map(
      ({
        id,
        campaignId,
        status,
        revision,
        mode,
        sourceSceneId,
        targetSceneId,
        locationId,
      }) =>
        `${id}:${campaignId}:${status}:${revision}:${mode}:${sourceSceneId}:${targetSceneId}:${locationId ?? "none"}`,
    )
    .sort()
    .join("|");
}

/** Shows campaign initiative in Activity whenever the current member is allowed to see it. */
export function ActivityInitiativePanel({
  snapshot,
  selectedTokenIds,
  onUpdateInitiative,
  onSetOwnInitiative,
  onRollInitiative,
  onRecruitFromZone,
}: Props) {
  const isGm = snapshot.me.role === "GM";
  const activeCampaignEncounter = (snapshot.encounters ?? []).some(
    (encounter) =>
      encounter.campaignId === snapshot.campaign.id &&
      encounter.status === "ACTIVE",
  );
  const visible = isGm || activeCampaignEncounter;
  const scopeKey = `${snapshot.campaign.id}:${snapshot.me.id}:${encounterScopeKey(snapshot)}`;
  const generation = useRef(0);
  const scopeRef = useRef(scopeKey);
  const inFlight = useRef<{ scope: string; generation: number } | null>(null);
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const [error, setError] = useState<{ scope: string; message: string } | null>(
    null,
  );

  // Invalidate synchronously during render as well as in the effect: a promise
  // settling between a new scope's commit and its passive effect must not leak
  // an old error into the new campaign/member/encounter view.
  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey;
    generation.current += 1;
    inFlight.current = null;
  }

  useEffect(() => {
    setPendingScope(null);
    setError(null);
    return () => {
      if (scopeRef.current === scopeKey) generation.current += 1;
    };
  }, [scopeKey]);

  const run = (action: () => Promise<void>) => {
    if (!visible || inFlight.current?.scope === scopeKey) return;
    const requestGeneration = ++generation.current;
    inFlight.current = { scope: scopeKey, generation: requestGeneration };
    setPendingScope(scopeKey);
    setError(null);
    void Promise.resolve()
      .then(() => {
        if (
          scopeRef.current !== scopeKey ||
          generation.current !== requestGeneration
        )
          return;
        return action();
      })
      .catch((reason: unknown) => {
        if (
          scopeRef.current !== scopeKey ||
          generation.current !== requestGeneration
        )
          return;
        setError({
          scope: scopeKey,
          message:
            reason instanceof Error && reason.message
              ? reason.message
              : "Не удалось обновить очередь инициативы. Повторите попытку.",
        });
      })
      .finally(() => {
        if (
          scopeRef.current !== scopeKey ||
          generation.current !== requestGeneration
        )
          return;
        inFlight.current = null;
        setPendingScope(null);
      });
  };

  if (!visible) return null;

  const revision = snapshot.campaign.revision;
  const participants = snapshot.campaign.initiative;
  return (
    <section className="activity-initiative-panel" aria-label="Очередь ходов">
      <InitiativePanel
        participants={participants}
        isGm={isGm}
        pending={pendingScope === scopeKey}
        selectedTokenIds={selectedTokenIds}
        onUpdate={(next) => run(() => onUpdateInitiative(next, revision))}
        onSetOwnInitiative={(participantId, initiative) =>
          run(() => onSetOwnInitiative(participantId, initiative, revision))
        }
        onRoll={(participant) =>
          run(() => onRollInitiative(participants, participant, revision, isGm))
        }
        onRecruitFromZone={
          onRecruitFromZone
            ? () => run(async () => onRecruitFromZone())
            : undefined
        }
      />
      {error?.scope === scopeKey && (
        <p className="composer-error" role="alert">
          {error.message}
        </p>
      )}
    </section>
  );
}
