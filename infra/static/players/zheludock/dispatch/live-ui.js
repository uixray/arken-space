import { campaignChapters, interludes, mages, statLabels } from "./game-data.js";
import { answerInterlude, dispatchCall, focusCall, focusedCall, forecastCall, loadLiveState, missionForCall, resetCampaign, resolveLiveCall, saveLiveState, tickLiveState, toggleHero } from "./live-engine.js";

let state = loadLiveState();
let mobileView = ["map", "team", "brief"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "map";
const $ = (s) => document.querySelector(s);
const mage = (id) => mages.find((item) => item.id === id);
const statusLabels = { waiting: "Ожидает", outbound: "В пути", decision: "На месте", returning: "Возвращается" };

const stats = (values, needed = {}) => Object.entries(values).map(([key, value]) => `<span class="stat ${needed[key] ? "stat--needed" : ""}" title="${statLabels[key]}"><i>${statLabels[key][0]}</i><b>${value}</b></span>`).join("");
function update(next, view) { state = next; if (view) mobileView = view; saveLiveState(state); render(); }

function renderMap() {
  const focus = focusedCall(state);
  $("[data-markers]").innerHTML = state.calls.map((call) => {
    const mission = missionForCall(call); const left = Math.max(0, Math.ceil((call.expiresAt - Date.now()) / 1000));
    return `<button class="marker ${call.id === focus?.id ? "is-current" : ""}" style="--x:${mission.map.x}%;--y:${mission.map.y}%" data-call="${call.id}"><span>${left}</span><strong>${mission.district}<small>${statusLabels[call.status]}</small></strong></button>`;
  }).join("");
  $("[data-hero-tokens]").innerHTML = state.calls.flatMap((call) => {
    if (!call.team.length || !["outbound", "decision", "returning"].includes(call.status)) return [];
    const mission = missionForCall(call); const p = call.status === "decision" ? 1 : call.status === "returning" ? 1 - call.progress : call.progress;
    return call.team.map((id, i) => { const hero = mage(id); const x = 50 + (mission.map.x - 50) * p + (i ? 2 : -2); const y = 58 + (mission.map.y - 58) * p + (i ? 1 : -1); return `<span class="hero-token" style="--x:${x}%;--y:${y}%;--mage:${hero.color}"><img src="${hero.image}" alt="${hero.name}" /></span>`; });
  }).join("");
  const traveling = state.calls.find((call) => ["outbound", "returning"].includes(call.status)); const radio = $("[data-radio-line]");
  if (!traveling) radio.hidden = true; else { const hero = mage(traveling.team[0]); const situation = traveling.status === "returning" ? traveling.outcome : "travel"; radio.hidden = false; radio.innerHTML = `<img src="${hero.image}" alt=""/><p><strong>${hero.name}</strong>${hero.voice[situation] || hero.voice.travel}</p><span>${Math.round(traveling.progress * 100)}%</span>`; }
  document.querySelectorAll("[data-call]").forEach((button) => button.onclick = () => update(focusCall(state, button.dataset.call), "brief"));
  $("[data-location-state]").innerHTML = [
    ...state.campaign.openLocations.map((name) => `<span class="location-chip location-chip--open">Открыто: ${name}</span>`),
    ...state.campaign.closedLocations.map((name) => `<span class="location-chip location-chip--closed">Закрыто: ${name}</span>`),
  ].join("");
}

function renderRoster() {
  const call = focusedCall(state); $("[data-team-note]").textContent = call ? `Команда для вызова «${missionForCall(call).title}». Занятые герои недоступны.` : "Ожидайте новый вызов.";
  $("[data-mage-list]").innerHTML = mages.map((hero) => { const meta = state.heroes[hero.id]; const selected = call?.team.includes(hero.id); const benched = meta.benchedCalls > 0; const performance = meta.morale > 0 ? "Вдохновлён · +1" : meta.morale < 0 ? "Подавлен · −1" : "Настрой ровный"; return `<button class="mage ${selected ? "is-selected" : ""} ${benched ? "is-benched" : ""}" style="--mage:${hero.color}" data-mage="${hero.id}" ${(meta.status !== "ready" || benched) && !selected ? "disabled" : ""}><span class="mage__portrait"><img src="${hero.image}" alt=""/></span><span class="mage__school">${benched ? `Временно выбыл · ${meta.benchedCalls} выз.` : meta.status === "ready" ? hero.school : "На задании"}</span><strong>${hero.name}</strong><span class="mage__stats">${stats(hero.stats, call?.requirements)}</span><small>${hero.trait}</small><span class="mage__meta">${performance}<br>Усталость ${meta.fatigue} · ${meta.status === "ready" ? "Готов" : "Занят"}</span></button>`; }).join("");
  document.querySelectorAll("[data-mage]").forEach((button) => button.onclick = () => update(toggleHero(state, button.dataset.mage)));
}

function renderBrief() {
  const call = focusedCall(state); const el = $("[data-brief]");
  if (state.campaign.dialogue) { const scene = interludes[state.campaign.dialogue]; const hero = mage(scene.heroId); el.innerHTML = `<div class="interlude"><span>Между главами · личный разговор</span><img src="${hero.image}" alt="${hero.name}"><h2>${scene.title}</h2><p><strong>${hero.name}:</strong> «${scene.line}»</p><div class="choices">${scene.answers.map((answer) => `<button data-answer="${answer.id}">${answer.label}<small>${answer.morale > 0 ? "Может вдохновить" : "Может задеть"}</small></button>`).join("")}</div></div>`; el.querySelectorAll("[data-answer]").forEach((button) => button.onclick = () => update(answerInterlude(state, button.dataset.answer), "brief")); return; }
  if (state.campaign.complete) { el.innerHTML = `<div class="complete"><span>Кампания завершена</span><h2>История окончена</h2><p>Решения сохранены в этой партии. Можно начать заново и открыть другие локации, составы и финал.</p><button data-replay>Переиграть кампанию</button></div>`; el.querySelector("[data-replay]").onclick = () => update(resetCampaign("story"), "map"); return; }
  if (!call) { el.innerHTML = `<div><span>Эфир свободен</span><h2>Ждём вызов</h2><p>Смена идёт в реальном времени. Новый сигнал появится автоматически.</p></div>`; return; }
  const mission = missionForCall(call); const chance = forecastCall(state, call); const left = Math.max(0, Math.ceil((call.expiresAt - Date.now()) / 1000));
  if (call.status === "waiting") el.innerHTML = `<div><span>${mission.district} · ${left} сек.</span><h2>${mission.title}</h2><p>${mission.summary}</p><h3>Требования</h3><div class="requirements">${stats(call.requirements, call.requirements)}</div><div class="forecast"><span>Шанс успеха</span><strong>${chance.percent}% · ${chance.label}</strong></div><div class="team-slot">${call.team.length ? call.team.map((id) => `<span>${mage(id).name}</span>`).join("") : "Выберите команду"}</div><button class="dispatch" data-dispatch ${call.team.length ? "" : "disabled"}>Отправить команду</button></div>`;
  else if (call.status === "decision") el.innerHTML = `<div><span>Срочная связь</span><h2>${mission.complication}</h2><p>Команда ждёт решения. Остальные вызовы продолжают отсчёт.</p><div class="choices">${mission.choices.map((choice) => `<button data-choice="${choice.id}">${choice.label}</button>`).join("")}</div></div>`;
  else el.innerHTML = `<div><span>${statusLabels[call.status]}</span><h2>${mission.title}</h2><p>${call.status === "outbound" ? "Токены движутся к месту вызова." : "Задание завершено. Команда возвращается и скоро снова будет доступна."}</p><div class="route-progress"><i style="width:${Math.round(call.progress * 100)}%"></i></div></div>`;
  el.querySelector("[data-dispatch]")?.addEventListener("click", () => update(dispatchCall(state), "map"));
  el.querySelectorAll("[data-choice]").forEach((button) => button.onclick = () => update(resolveLiveCall(state, button.dataset.choice), "map"));
}

function render() {
  $("[data-mode-label]").childNodes[0].textContent = state.mode === "arcade" ? "Бесконечная смена " : `${campaignChapters[state.campaign.chapter]?.title || "Кампания"} `; $("[data-mode]").textContent = state.mode === "arcade" ? "Кампания" : "Аркада";
  $("[data-shift]").textContent = `${Math.floor(state.elapsed / 60)}:${String(state.elapsed % 60).padStart(2,"0")}`; $("[data-reputation]").textContent = state.reputation; $("[data-city]").textContent = state.city;
  const call = focusedCall(state); $("[data-signal-title]").textContent = call ? missionForCall(call).title : "Эфир свободен";
  renderMap(); renderRoster(); renderBrief(); document.body.dataset.mobileView = mobileView; $("[data-team-count]").textContent = `${state.calls.filter((c) => c.status === "waiting").length} выз.`;
  document.querySelectorAll("[data-mobile-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.mobileView === mobileView));
}
$("[data-reset]").onclick = () => confirm("Стереть прогресс этой кампании и начать с первой главы? Это действие нельзя отменить.") && update(resetCampaign(state.mode), "map");
$("[data-mode]").onclick = () => confirm("Сменить режим и начать новую игру?") && update(resetCampaign(state.mode === "arcade" ? "story" : "arcade"), "map");
document.querySelectorAll("[data-mobile-view]").forEach((button) => button.onclick = () => { mobileView = button.dataset.mobileView; location.hash = mobileView; render(); });
setInterval(() => { state = tickLiveState(state); saveLiveState(state); render(); }, 250);
render();
