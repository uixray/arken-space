import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CatalogEntryDto } from "@arken/contracts";
import "@gravity-ui/uikit/styles/styles.css";
import "../src/design-system/tokens.generated.css";
import "../src/design-system/foundations.css";
import "../src/ui/gravity-foundation.css";
import "../src/styles.css";
import "../src/mobile-foundation.css";
import { CatalogEntryForm } from "../src/CatalogEntryForm";

function CatalogEntryFormBrowserHarness() {
  const attempts = useRef(0); const [attemptCount, setAttemptCount] = useState(0);
  const [status, setStatus] = useState("READY — isolated component; no API calls");
  const [payload, setPayload] = useState("none");
  const [legacyPayload, setLegacyPayload] = useState("none");
  const legacyActivation = {
    consumeUse: false,
    cost: { type: "magic", amount: 2 },
    legacyMetadata: { source: "imported", note: "retain untouched fields" },
  };
  const existingMixedEntry = {
    id: "browser-legacy-entry",
    kind: "ABILITY",
    name: "Старое имя",
    description: "Смешанная legacy-запись",
    revision: 1,
    data: {
      activation: legacyActivation,
      rollActions: [
        {
          id: "browser-legacy-roll",
          label: "Проверка",
          kind: "CHECK",
          dice: "1d20",
          modifiers: [],
          advantage: false,
          consumeUse: false,
          order: 0,
        },
      ],
    },
  } as unknown as CatalogEntryDto;

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: "0 0 8px" }}>Browser QA: CatalogEntryForm</h1>
        <p style={{ margin: 0 }}>
          Actual component with a synthetic callback only. No API, auth, or
          production data is used.
        </p>
      </header>
      <section className="panel-section arken-dialog" style={{ padding: 16 }}>
        <CatalogEntryForm
          statLabels={{ might: "Сила", reaction: "Реакция", awareness: "Внимательность" }}
          resourceLabels={{ physical: "Сила тела", magic: "Сила магии" }}
          onCancel={() => setStatus("CANCEL_CALLBACK — synthetic only")}
          onSubmit={async (input) => {
            attempts.current += 1; setAttemptCount(attempts.current);
            setPayload(JSON.stringify(input));
            if (attempts.current === 1) {
              setStatus("SYNTHETIC_REJECTION — intentionally no API request");
              throw new Error("QA synthetic callback rejection");
            }
            setStatus("SYNTHETIC_SUCCESS — payload captured locally; no API request");
          }}
        />
      </section>
      <section className="panel-section arken-dialog" style={{ padding: 16, marginTop: 16 }}>
        <h2>Legacy mixed-entry rename-only preservation</h2>
        <CatalogEntryForm
          existing={existingMixedEntry}
          statLabels={{}}
          resourceLabels={{ physical: "Сила тела", magic: "Сила магии" }}
          onCancel={() => undefined}
          onSubmit={(input) => setLegacyPayload(JSON.stringify(input))}
        />
        <output data-testid="legacy-payload">{legacyPayload}</output>
      </section>
      <aside
        aria-label="Synthetic callback results"
        style={{ marginTop: 16, padding: 12, background: "var(--surface-2)", overflowWrap: "anywhere" }}
      >
        <p data-testid="callback-status" style={{ margin: "0 0 8px" }}>{status}</p>
        <output data-testid="callback-payload">{payload}</output>
        <output data-testid="callback-attempts">{attemptCount}</output>
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<CatalogEntryFormBrowserHarness />);
