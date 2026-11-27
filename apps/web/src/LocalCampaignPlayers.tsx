import { useEffect, useRef, useState } from "react";
import { Button } from "./design-system/Button";
import {
  listLocalCampaignPlayers,
  revokeLocalCampaignPlayer,
  type LocalCampaignPlayer,
} from "./account-campaign-client";

/** Only mounted for local GM campaigns. Authorization is enforced on the server. */
export function LocalCampaignPlayers({
  campaignId,
  campaignName,
  csrfToken,
}: {
  campaignId: string;
  campaignName: string;
  csrfToken: string;
}) {
  const [players, setPlayers] = useState<LocalCampaignPlayer[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const busy = useRef(false);
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current += 1;
    },
    [],
  );
  async function perform(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    const generation = epoch.current;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch {
      if (generation === epoch.current)
        setError(
          "Не удалось подтвердить результат. Обновите список; при необходимости повторите отзыв — повтор безопасен.",
        );
    } finally {
      busy.current = false;
      if (generation === epoch.current) setPending(false);
    }
  }
  return (
    <section aria-label={`Доступ игроков: ${campaignName}`} aria-busy={pending}>
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          void perform(async () => {
            const generation = epoch.current;
            const result = await listLocalCampaignPlayers(campaignId);
            if (generation === epoch.current) {
              setPlayers(result.players);
              setConfirmation(null);
            }
          })
        }
      >
        {players ? "Обновить список игроков" : "Управлять доступом игроков"}
      </Button>
      {players && (
        <>
          <p>
            Отзыв закрывает только эту кампанию. Аккаунт, персонажи, история и
            другие кампании сохраняются.
          </p>
          {players.length === 0 && (
            <p>Игроки с локальными аккаунтами ещё не присоединились.</p>
          )}
          <ul>
            {players.map((player) => (
              <li key={player.membershipId}>
                <strong>{player.displayName}</strong>
                {player.accessRevokedAt ? (
                  <span> — доступ отозван</span>
                ) : confirmation === player.membershipId ? (
                  <>
                    <p>
                      Отозвать у «{player.displayName}» доступ к «{campaignName}
                      » и завершить сессии этой кампании?
                    </p>
                    <Button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        void perform(async () => {
                          const generation = epoch.current;
                          await revokeLocalCampaignPlayer(
                            campaignId,
                            player.membershipId,
                            csrfToken,
                          );
                          if (generation !== epoch.current) return;
                          setPlayers(
                            (rows) =>
                              rows?.map((row) =>
                                row.membershipId === player.membershipId
                                  ? {
                                      ...row,
                                      accessRevokedAt: new Date().toISOString(),
                                    }
                                  : row,
                              ) ?? null,
                          );
                          setConfirmation(null);
                          setNotice("Доступ к этой кампании отозван.");
                        })
                      }
                    >
                      Подтвердить отзыв
                    </Button>
                    <Button
                      type="button"
                      disabled={pending}
                      onClick={() => setConfirmation(null)}
                    >
                      Отмена
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirmation(player.membershipId)}
                  >
                    Отозвать доступ
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
