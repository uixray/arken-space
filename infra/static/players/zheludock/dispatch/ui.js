import { mages, missions, statLabels } from "./game-data.js";
import {
  advanceTravel,
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
const allowedViews = ["map", "team", "brief"];
let mobileView = allowedViews.includes(location.hash.slice(1))
  ? location.hash.slice(1)
  : "map";
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
  const activeIndex = state.missionIndex % missions.length;
  $("[data-markers]").innerHTML = missions
    .map(
      (mission, index) =>
        `<button class="marker ${index === activeIndex ? "is-current" : ""} ${state.mode !== "arcade" && index < state.missionIndex ? "is-done" : ""}" style="--x:${mission.map.x}%;--y:${mission.map.y}%" ${index !== activeIndex ? "disabled" : ""}><span>${index + 1}</span><strong>${mission.district}</strong></button>`,
    )
    .join("");
}
function voiceFor(mage, situation) {
  return mage.voice?.[situation] || mage.voice?.idle || "Принято.";
}
function travelProgress() {
  if (!state.travel) return 0;
  return Math.min(1, Math.max(0, (Date.now() - state.travel.startedAt) / state.travel.duration));
}
function renderTravel() {
  const mission = currentMission(state);
  const layer = $("[data-hero-tokens]");
  const radio = $("[data-radio-line]");
  if (!mission || !state.travel || !state.selected.length) {
    layer.innerHTML = "";
    radio.hidden = true;
    return;
  }
  const raw = travelProgress();
  const progress = state.travel.direction === "returning" ? 1 - raw : raw;
  const home = { x: 50, y: 58 };
  layer.innerHTML = state.selected.map((id, index) => {
    const mage = mageById(id);
    const x = home.x + (mission.map.x - home.x) * progress + (index ? 2 : -2);
    const y = home.y + (mission.map.y - home.y) * progress + (index ? 1 : -1);
    return `<span class="hero-token" style="--x:${x}%;--y:${y}%;--mage:${mage.color}" title="${mage.name}"><img src="${mage.image}" alt="${mage.name}" /></span>`;
  }).join("");
  const speaker = mageById(state.selected[0]);
  radio.hidden = false;
  const situation = state.travel.direction === "returning" ? state.lastOutcome : "travel";
  radio.innerHTML = `<img src="${speaker.image}" alt="" /><p><strong>${speaker.name}</strong>${voiceFor(speaker, situation)}</p><span>${state.travel.direction === "returning" ? "Возвращается" : "В пути"} · ${Math.round(raw * 100)}%</span>`;
}
function renderRoster() {
  $("[data-team-note]").textContent =
    state.notice || "Выберите до двух героев. Состав влияет на решения и последствия.";
  $("[data-mage-list]").innerHTML = mages
    .map((mage) => {
      const meta = state.mages[mage.id];
      const selected = state.selected.includes(mage.id);
      const level = 1 + Math.floor(meta.missions / 2);
      return `<button class="mage ${selected ? "is-selected" : ""}" style="--mage:${mage.color}" data-mage="${mage.id}" aria-pressed="${selected}"><span class="mage__portrait"><img src="${mage.image}" alt="" /></span><span class="mage__school">${mage.school}</span><strong>${mage.name}</strong><span class="mage__stats">${statsMarkup(mage.stats, currentMission(state)?.requirements)}</span><small>${mage.trait}</small><span class="mage__meta">Ур. ${level} · Усталость ${meta.fatigue} · Доверие ${meta.trust >= 0 ? "+" : ""}${meta.trust}</span></button>`;
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
      .addEventListener("click", () => update(freshState(), "map"));
    return;
  }
  if (state.phase === "decision") {
    brief.innerHTML = `<div class="call"><span>Связь с командой</span><h2>${mission.complication}</h2><p>Команда: ${state.selected.map((id) => mageById(id).name).join(" + ")}</p><div class="choices">${mission.choices.map((choice) => `<button data-choice="${choice.id}">${choice.label}<small>Решение изменит риск и отношения</small></button>`).join("")}</div></div>`;
    brief
      .querySelectorAll("[data-choice]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          update(resolveChoice(state, button.dataset.choice), "brief"),
        ),
      );
    return;
  }
  if (state.phase === "traveling" || state.phase === "returning") {
    const outbound = state.phase === "traveling";
    brief.innerHTML = `<div class="en-route"><span>${outbound ? "Команда выдвинулась" : "Возвращение на базу"}</span><h2>${mission.title}</h2><p>${outbound ? "Токены показывают путь героев к заданию. По прибытии откроется канал решения." : "Герои возвращаются после задания. Итоговый отчёт появится на базе."}</p><div class="route-progress"><i style="width:${Math.round(travelProgress() * 100)}%"></i></div><strong>${Math.round(travelProgress() * 100)}%</strong></div>`;
    return;
  }
  if (state.phase === "result") {
    const [title, copy] = outcomeCopy[state.lastOutcome];
    brief.innerHTML = `<div class="result result--${state.lastOutcome}"><span>Отчёт миссии</span><h2>${title}</h2><p>${copy}</p><button data-continue>${state.mode !== "arcade" && state.missionIndex === missions.length - 1 ? "Завершить главу" : "Принять следующий вызов"}</button></div>`;
    brief
      .querySelector("[data-continue]")
      .addEventListener("click", () => update(continueShift(state), "map"));
    return;
  }
  const prediction = forecast(state);
  brief.innerHTML = `<div class="briefing"><span>${mission.district}</span><h2>${mission.title}</h2><p>${mission.summary}</p><h3>Требования</h3><div class="requirements">${statsMarkup(mission.requirements, mission.requirements)}</div><div class="forecast"><span>Прогноз</span><strong>${prediction.label}</strong><small>Точная формула скрыта. Усталость снижает эффективность.</small></div><div class="team-slot">${state.selected.length ? state.selected.map((id) => `<span>${mageById(id).glyph} ${mageById(id).name}</span>`).join("") : "Назначьте команду"}</div><button class="dispatch" data-dispatch ${state.selected.length ? "" : "disabled"}>Отправить магов</button>`;
  brief
    .querySelector("[data-dispatch]")
    .addEventListener("click", () => {
      const next = dispatchTeam(state);
      update(next, next.phase === "decision" ? "brief" : "team");
    });
}
function render() {
  $("[data-shift]").textContent = state.mode === "arcade"
    ? `Вызов ${state.missionIndex + 1}`
    : `${Math.min(state.missionIndex + 1, missions.length)}/${missions.length}`;
  $("[data-mode-label]").childNodes[0].textContent =
    state.mode === "arcade" ? "Бесконечная аркада " : "Глава I ";
  $("[data-mode]").textContent = state.mode === "arcade" ? "Сюжет" : "Аркада";
  $("[data-reputation]").textContent = state.reputation;
  $("[data-city]").textContent = state.city;
  const mission = currentMission(state);
  $("[data-signal-title]").textContent = mission?.title || "Смена завершена";
  $("[data-signal]").classList.toggle("is-quiet", state.phase === "complete");
  renderMarkers();
  renderTravel();
  renderRoster();
  renderBrief();
  syncMobileView();
}
function syncMobileView() {
  document.body.dataset.mobileView = mobileView;
  document.querySelectorAll("[data-mobile-view]").forEach((button) => {
    const active = button.dataset.mobileView === mobileView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  $("[data-team-count]").textContent = `${state.selected.length}/2`;
}
function setMobileView(view) {
  mobileView = view;
  history.replaceState(null, "", `#${view}`);
  syncMobileView();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function update(next, nextView) {
  state = next;
  if (nextView) mobileView = nextView;
  saveState(state);
  render();
}
$("[data-reset]").addEventListener("click", () => {
  if (confirm("Сбросить текущий прогресс и начать заново?"))
    update(freshState(state.mode), "map");
});
$("[data-mode]").addEventListener("click", () => {
  const nextMode = state.mode === "arcade" ? "story" : "arcade";
  const label = nextMode === "arcade" ? "бесконечную аркаду" : "сюжетную главу";
  if (confirm(`Перейти в ${label}? Текущий забег начнётся заново.`))
    update(freshState(nextMode), "map");
});
document.querySelectorAll("[data-mobile-view]").forEach((button) =>
  button.addEventListener("click", () => setMobileView(button.dataset.mobileView)),
);
render();
setInterval(() => {
  if (!["traveling", "returning"].includes(state.phase)) return;
  const next = advanceTravel(state);
  if (next !== state) update(next, next.phase === "decision" ? "brief" : mobileView);
  else {
    renderTravel();
    renderBrief();
  }
}, 100);
