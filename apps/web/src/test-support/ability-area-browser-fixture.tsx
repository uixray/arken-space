import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AbilityAreaPanel } from "../AbilityAreaPanel";
import { ArkenDialog } from "../ui/ArkenDialog";

function Fixture() {
  const [draft, setDraft] = useState(true);
  const [dialog, setDialog] = useState(false);
  const area = {
    draft: draft
      ? {
          id: "fixture",
          name: "Лучезарный",
          radiusMeters: 15,
          tokenId: "one",
          request: null,
          consumesItem: false,
        }
      : null,
    tokens: [{ id: "one", name: "Герой", x: 0, y: 0 }],
    canCancel: true,
    canConfirm: true,
    pending: false,
    cancel: () => setDraft(false),
    confirm: () => {},
    selectOrigin: () => {},
  } as unknown as Parameters<typeof AbilityAreaPanel>[0]["area"];
  return (
    <>
      <AbilityAreaPanel area={area} isGm={false} />
      <button onClick={() => setDialog(true)}>Другое окно</button>
      <ArkenDialog
        open={dialog}
        variant="workspace"
        title="Тестовое окно"
        footer={false}
        onClose={() => setDialog(false)}
      >
        <button>Действие в окне</button>
      </ArkenDialog>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
