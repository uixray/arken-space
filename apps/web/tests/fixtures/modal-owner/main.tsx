import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Button,
  configure,
  ThemeProvider,
  ToasterComponent,
  ToasterProvider,
} from "@gravity-ui/uikit";
import "@gravity-ui/uikit/styles/fonts.css";
import "@gravity-ui/uikit/styles/styles.css";
import "../../../src/random-uuid-polyfill";
import { AppErrorBoundary } from "../../../src/AppErrorBoundary";
import { ArkenDialog } from "../../../src/ui/ArkenDialog";
import { FormSelect } from "../../../src/ui/GravityFormControls";
import { appToaster } from "../../../src/ui/toaster";
import "../../../src/design-system/tokens.generated.css";
import "../../../src/ui/gravity-foundation.css";
import "../../../src/styles.css";
import "../../../src/mobile-foundation.css";

// Test-only HTML entry; neither production index.html nor App imports this file.
// No UI mocks, forced Select open state, custom focus management, portal target
// or layer override. Only fixture state and an asynchronous response are owned here.
configure({ lang: "ru" });

const topology = new URLSearchParams(window.location.search).get("topology");
if (topology !== "sibling" && topology !== "nested")
  throw new Error("Specify the modal-owner fixture topology.");

function ModalOwnerFixture() {
  const [aOpen, setAOpen] = useState(false);
  const [bOpen, setBOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const [aValue, setAValue] = useState("a-one");
  const [bValue, setBValue] = useState("b-one");
  const [aSelections, setASelections] = useState(0);
  const [bSelections, setBSelections] = useState(0);
  const [bPointerActions, setBPointerActions] = useState(0);

  const requestSecondModal = async () => {
    setWaiting(true);
    setError("");
    try {
      // Playwright holds this fixture-only GET until A's real popup is open.
      // Resolving the response is not a setter or hidden action in the real App.
      const response = await fetch("/__modal_owner_fixture__/complete");
      if (!response.ok) throw new Error("Не завершена тестовая проверка.");
      const result = (await response.json()) as { complete?: boolean };
      if (result.complete !== true)
        throw new Error("Неверный результат тестовой проверки.");
      setBOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWaiting(false);
    }
  };

  const secondModal = (
    <ArkenDialog
      open={bOpen}
      title="Второе окно"
      onClose={() => setBOpen(false)}
    >
      <div className="gravity-preview__dialog-fields">
        <div>
          <span>B: вариант</span>
          <FormSelect
            aria-label="B: вариант"
            value={bValue}
            onChange={(event) => {
              setBValue(event.target.value);
              setBSelections((count) => count + 1);
            }}
          >
            <option value="b-one">B — первый</option>
            <option value="b-two">B — второй</option>
            <option value="b-three">B — третий</option>
          </FormSelect>
        </div>
        <Button onClick={() => setBPointerActions((count) => count + 1)}>
          Проверить действие B
        </Button>
        <label>
          B: заметка
          <input aria-label="B: заметка" defaultValue="Текст второго окна" />
        </label>
      </div>
    </ArkenDialog>
  );

  return (
    <main
      className="gravity-preview"
      data-testid="fixture"
      data-topology={topology}
    >
      <h1>Проверка владельцев modal</h1>
      <Button onClick={() => setAOpen(true)}>Открыть первое окно</Button>
      <dl>
        <dt>Первое значение</dt>
        <dd data-testid="a-value">{aValue}</dd>
        <dt>Выборы первого окна</dt>
        <dd data-testid="a-selections">{aSelections}</dd>
        <dt>Второе значение</dt>
        <dd data-testid="b-value">{bValue}</dd>
        <dt>Выборы второго окна</dt>
        <dd data-testid="b-selections">{bSelections}</dd>
        <dt>Нажатия второго окна</dt>
        <dd data-testid="b-pointer-actions">{bPointerActions}</dd>
      </dl>
      {error ? <p role="alert">{error}</p> : null}
      <ArkenDialog
        open={aOpen}
        title="Первое окно"
        onClose={() => setAOpen(false)}
      >
        <div className="gravity-preview__dialog-fields">
          <div>
            <span>A: вариант</span>
            <FormSelect
              aria-label="A: вариант"
              value={aValue}
              onChange={(event) => {
                setAValue(event.target.value);
                setASelections((count) => count + 1);
              }}
            >
              <option value="a-one">A — первый</option>
              <option value="a-two">A — второй</option>
              <option value="a-three">A — третий</option>
              <option value="a-four">A — четвёртый</option>
              <option value="a-five">A — пятый</option>
              <option value="a-six">A — шестой</option>
            </FormSelect>
          </div>
          <Button
            disabled={waiting || bOpen}
            onClick={() => void requestSecondModal()}
          >
            Открыть после проверки
          </Button>
          <label>
            A: заметка
            <input aria-label="A: заметка" defaultValue="Текст первого окна" />
          </label>
        </div>
        {topology === "nested" ? secondModal : null}
      </ArkenDialog>
      {topology === "sibling" ? secondModal : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme="dark" lang="ru">
      <ToasterProvider toaster={appToaster}>
        <AppErrorBoundary>
          <ModalOwnerFixture />
        </AppErrorBoundary>
        <ToasterComponent />
      </ToasterProvider>
    </ThemeProvider>
  </StrictMode>,
);
