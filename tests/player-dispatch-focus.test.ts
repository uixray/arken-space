// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { renderMarkup } from "../infra/static/players/zheludock/dispatch/render-markup.js";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  document.body.innerHTML = "";
});

it("сохраняет кнопку и фокус при изменении таймера и удалении соседнего вызова", () => {
  document.body.innerHTML = "<main></main>";
  const host = document.querySelector("main")!;
  renderMarkup(
    host,
    '<button data-call="a">42</button><button data-call="b">42</button>',
  );
  const button = host.lastChild as HTMLButtonElement;
  button.focus();
  renderMarkup(host, '<button data-call="b">41</button>');
  expect(host.firstChild).toBe(button);
  expect(document.activeElement).toBe(button);
  expect(button.textContent).toBe("41");
});

it("UIX-619 реальный диспетчер сохраняет фокус ответа и досье между игровыми тиками", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { freshLiveState, STORAGE_KEY } =
    await import("../infra/static/players/zheludock/dispatch/live-engine.js");
  const { interludes } =
    await import("../infra/static/players/zheludock/dispatch/game-data.js");
  const state = freshLiveState();
  state.campaign.dialogue = Object.keys(interludes)[0];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  document.documentElement.innerHTML = readFileSync(
    "infra/static/players/zheludock/dispatch/index.html",
    "utf8",
  );
  await import("../infra/static/players/zheludock/dispatch/live-ui.js");
  const answer = document.querySelector<HTMLButtonElement>("[data-answer]")!;
  expect(answer).not.toBeNull();
  answer.focus();
  vi.advanceTimersByTime(1250);
  expect(document.activeElement).toBe(answer);
  expect(document.querySelector("[data-answer]")).toBe(answer);
  answer.click();
  expect(document.querySelector("[data-answer]")).toBeNull();
  const dossier = document.querySelector<HTMLButtonElement>("[data-details]")!;
  dossier.focus();
  vi.advanceTimersByTime(1250);
  expect(document.activeElement).toBe(dossier);
});
