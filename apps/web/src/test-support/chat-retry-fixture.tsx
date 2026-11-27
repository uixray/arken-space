import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GameSnapshot } from "@arken/contracts";
import { useChatActions } from "../use-chat-actions";
const params = new URLSearchParams(location.search);
const snapshot = {
  campaign: { id: params.get("campaign") },
  me: { id: params.get("member"), characterId: null },
} as unknown as GameSnapshot;
function Fixture() {
  const [status, setStatus] = useState("Готово");
  const [, setSnapshot] = useState<GameSnapshot | null>(null);
  const snapshotRef = useRef<GameSnapshot | null>(snapshot),
    knownChatMessageIdsRef = useRef(new Set<string>()),
    activeChatThreadIdRef = useRef<string | null>(null);
  const actions = useChatActions({
    run: async (action) => {
      await action();
    },
    setSnapshot,
    snapshotRef,
    knownChatMessageIdsRef,
    activeChatThreadIdRef,
  });
  return (
    <>
      <button
        onClick={() =>
          void actions
            .onChat("Синтетическое сообщение", "PUBLIC", "TABLE")
            .then(
              () => setStatus("Подтверждено"),
              () => setStatus("Не подтверждено"),
            )
        }
      >
        Отправить или повторить
      </button>
      <p role="status">{status}</p>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
