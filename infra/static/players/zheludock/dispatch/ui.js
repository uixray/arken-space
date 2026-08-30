import { mages, missions, statLabels } from "./game-data.js";
import {
  continueShift,
  currentMission,
  dispatchTeam,
  forecast,
  freshState,
  loadState,
  resolveChoice,
  saveState,
  toggleMage,
} from "./game-engine.js";

let state = loadState();
const $ = (selector) => document.querySelector(selector);
const mageById = (id) => mages.find((mage) => mage.id === id);
const outcomeCopy = {
  success: [
    "Чистый успех",
    "Команда возвращается с результатом и новым доверием к диспетчеру.",
  ],
  mixed: [
    "Цена решения",
    "Задача выполнена не полностью. Город запомнит и спасение, и ущерб.",
  ],
  failure: [
    "Связь потеряна",
    "План не выдержал осложнения. Команда вернулась, но последствия останутся.",
  ],
};

function statsMarkup(stats, requirements = {}) {
  return Object.entries(stats)
    .map(
      ([key, value]) =>
        `<span class="stat ${requirements[key] ? "stat--needed" : ""}" title="${statLabels[key]}"><i>${statLabels[key].slice(0, 1)}</i><b>${value}</b></span>`,
    )
    .join("");
}
function renderMarkers() {
  $("[data-markers]").innerHTML = missions
    .map(
      (mission, index) =>
        `<button class="marker ${index === state.missionIndex ? "is-current" : ""} ${index < state.missionIndex ? "is-done" : ""}" style="--x:${18 + ((index * 17) % 72)}%;--y:${22 + ((index * 29) % 58)}%" ${index !== state.missionIndex ? "disabled" : ""}><span>${index + 1}</span><strong>${mission.district}</strong></button>`,
    )
    .join("");
}
function renderRoster() {
  $("[data-mage-list]").innerHTML = mages
    .map((mage) => {
      const meta = state.mages[mage.id];
      const selected = state.selected.includes(mage.id);
      return `<button class="mage ${selected ? "is-selected" : ""}" style="--mage:${mage.color}" data-mage="${mage.id}" aria-pressed="${selected}"><span class="mage__token">${mage.glyph}</span><span class="mage__school">${mage.school}</span><strong>${mage.name}</strong><span class="mage__stats">${statsMarkup(mage.stats, currentMission(state)?.requirements)}</span><small>${mage.trait}</small><span class="mage__meta">Усталость ${meta.fatigue} · Доверие ${meta.trust >= 0 ? "+" : ""}${meta.trust}</span></button>`;
    })
    .join("");
  document
    .querySelectorAll("[data-mage]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        update(toggleMage(state, button.dataset.mage)),
      ),
    );
}
function renderBrief() {
  const mission = currentMission(state);
  const brief = $("[data-brief]");
  if (state.phase === "complete") {
    const successes = state.log.filter(
      (item) => item.outcome === "success",
    ).length;
    const rank =
      state.city >= 13 && successes >= 3
        ? "Архимаг координации"
        : state.city >= 8
          ? "Надёжный диспетчер"
          : "Стажёр после тяжёлой смены";
    brief.innerHTML = `<div class="complete"><span>Смена завершена</span><h2>${rank}</h2><p>Успехов: ${successes} из ${state.log.length}. Репутация: ${state.reputation}. Целостность города: ${state.city}.</p><ol>${state.log.map((item) => `<li><strong>${item.mission}</strong><span>${item.choice}</span></li>`).join("")}</ol><button data-restart>Начать новую смену</button></div>`;
    brief
      .querySelector("[data-restart]")
      .addEventListener("click", () => update(freshState()));
    return;
  }
  if (state.phase === "decision") {
    brief.innerHTML = `<div class="call"><span>Связь с командой</span><h2>${mission.complication}</h2><p>Команда: ${state.selected.map((id) => mageById(id).name).join(" + ")}</p><div class="choices">${mission.choices.map((choice) => `<button data-choice="${choice.id}">${choice.label}<small>Решение изменит риск и отношения</small></button>`).join("")}</div></div>`;
    brief
      .querySelectorAll("[data-choice]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          update(resolveChoice(state, button.dataset.choice)),
        ),
      );
    return;
  }
  if (state.phase === "result") {
    const [title, copy] = outcomeCopy[state.lastOutcome];
    brief.innerHTML = `<div class="result result--${state.lastOutcome}"><span>Отчёт миссии</span><h2>${title}</h2><p>${copy}</p><button data-continue>${state.missionIndex === missions.length - 1 ? "Завершить смену" : "Принять следующий вызов"}</button></div>`;
    brief
      .querySelector("[data-continue]")
      .addEventListener("click", () => update(continueShift(state)));
    return;
  }
  const prediction = forecast(state);
  brief.innerHTML = `<div class="briefing"><span>${mission.district}</span><h2>${mission.title}</h2><p>${mission.summary}</p><h3>Требования</h3><div class="requirements">${statsMarkup(mission.requirements, mission.requirements)}</div><div class="forecast"><span>Прогноз</span><strong>${prediction.label}</strong><small>Точная формула скрыта. Усталость снижает эффективность.</small></div><div class="team-slot">${state.selected.length ? state.selected.map((id) => `<span>${mageById(id).glyph} ${mageById(id).name}</span>`).join("") : "Назначьте команду"}</div><button class="dispatch" data-dispatch ${state.selected.length ? "" : "disabled"}>Отправить магов</button>`;
  brief
    .querySelector("[data-dispatch]")
    .addEventListener("click", () => update(dispatchTeam(state)));
}
function render() {
  $("[data-shift]").textContent =
    `${Math.min(state.missionIndex + 1, missions.length)}/${missions.length}`;
  $("[data-reputation]").textContent = state.reputation;
  $("[data-city]").textContent = state.city;
  const mission = currentMission(state);
  $("[data-signal-title]").textContent = mission?.title || "Смена завершена";
  $("[data-signal]").classList.toggle("is-quiet", state.phase === "complete");
  renderMarkers();
  renderRoster();
  renderBrief();
}
function update(next) {
  state = next;
  saveState(state);
  render();
}
$("[data-reset]").addEventListener("click", () => {
  if (confirm("Сбросить текущую смену и начать заново?")) update(freshState());
});
render();
