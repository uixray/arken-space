import { useState } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import { formatApiError } from "../api";
import { ArkenDialog } from "../ui/ArkenDialog";

export type CampaignClockUiCommand =
  "ADVANCE_DAY" | "LONG_REST" | "RESET_CLOCK";

export interface CampaignClockDialogProps {
  open: boolean;
  snapshot: Pick<GameSnapshot, "campaign" | "characters" | "me">;
  onCommand: (
    command: CampaignClockUiCommand,
    revision: number,
  ) => Promise<void>;
  onClose: () => void;
}

export function CampaignClockDialog({
  open,
  snapshot,
  onCommand,
  onClose,
}: CampaignClockDialogProps) {
  const [pendingCommand, setPendingCommand] =
    useState<CampaignClockUiCommand | null>(null);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [error, setError] = useState("");
  const { campaign } = snapshot;
  const rechargeAnchorsAtBaseline = snapshot.characters.every((character) =>
    character.entries.every((entry) => {
      const uses = entry.data.uses;
      if (!uses) return true;
      return uses.recharge === "BATTLE"
        ? (uses.lastBattleCounter ?? 0) === 0
        : (uses.lastRechargeDay ?? 1) === 1;
    }),
  );
  const resetAtBaseline =
    campaign.day === 1 &&
    campaign.battleCounter === 0 &&
    campaign.initiative.length === 0 &&
    rechargeAnchorsAtBaseline;
  const resetDisabled = campaign.battleActive || resetAtBaseline;

  if (snapshot.me.role !== "GM") return null;

  const close = () => {
    if (pendingCommand) return;
    setError("");
    setResetConfirmationOpen(false);
    onClose();
  };

  const runCommand = async (command: CampaignClockUiCommand) => {
    if (pendingCommand) return;
    setPendingCommand(command);
    setError("");
    try {
      await onCommand(command, campaign.revision);
      if (command === "RESET_CLOCK") setResetConfirmationOpen(false);
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось изменить время кампании."));
    } finally {
      setPendingCommand(null);
    }
  };

  return (
    <>
      <ArkenDialog
        open={open}
        title="Время кампании"
        footer={false}
        onClose={close}
      >
        <p aria-live="polite">
          <strong>День {campaign.day}</strong>
        </p>
        <p className="muted">
          Здесь можно перевести календарь и провести общий отдых.
        </p>
        {error && !resetConfirmationOpen ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="entity-form">
          <Button
            disabled={Boolean(pendingCommand)}
            loading={pendingCommand === "ADVANCE_DAY"}
            title="Перевести календарь на следующий день"
            onClick={() => void runCommand("ADVANCE_DAY")}
          >
            Следующий день
          </Button>
          <Button
            disabled={Boolean(pendingCommand)}
            loading={pendingCommand === "LONG_REST"}
            title="Перевести календарь на следующий день и восстановить ресурсы персонажей"
            onClick={() => void runCommand("LONG_REST")}
          >
            Длинный отдых
          </Button>
          <Button
            view="outlined-danger"
            disabled={Boolean(pendingCommand) || resetDisabled}
            title={
              campaign.battleActive
                ? "Сброс недоступен для сохранённого состояния кампании"
                : resetAtBaseline
                  ? "Время уже находится в исходной точке"
                  : "Вернуть время кампании в исходную точку"
            }
            onClick={() => {
              setError("");
              setResetConfirmationOpen(true);
            }}
          >
            Сбросить время
          </Button>
        </div>
        {campaign.battleActive ? (
          <p className="muted">
            Сброс недоступен для сохранённого состояния кампании.
          </p>
        ) : resetAtBaseline ? (
          <p className="muted">Время уже находится в исходной точке.</p>
        ) : null}
      </ArkenDialog>
      <ArkenDialog
        open={resetConfirmationOpen}
        title="Сбросить время кампании?"
        applyLabel="Подтвердить сброс"
        danger
        loading={pendingCommand === "RESET_CLOCK"}
        error={resetConfirmationOpen ? error : ""}
        onApply={() => void runCommand("RESET_CLOCK")}
        onClose={() => {
          if (pendingCommand) return;
          setError("");
          setResetConfirmationOpen(false);
        }}
      >
        <p className="arken-dialog-message">
          День станет 1, служебные счётчики времени сбросятся. Текущие значения
          ресурсов персонажей не изменятся.
        </p>
      </ArkenDialog>
    </>
  );
}
