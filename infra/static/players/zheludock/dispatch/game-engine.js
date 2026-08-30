import { mages, missions } from "./game-data.js";

export const STORAGE_KEY = "arken:misha-dispatch:v1";
export const freshState = () => ({
  version: 1,
  phase: "briefing",
  missionIndex: 0,
  selected: [],
  reputation: 5,
  city: 10,
  log: [],
  mages: Object.fromEntries(
    mages.map((mage) => [mage.id, { fatigue: 0, trust: 0, missions: 0 }]),
  ),
  pendingScore: null,
});
export function loadState(storage = localStorage) {
  try {
    return {
      ...freshState(),
      ...JSON.parse(storage.getItem(STORAGE_KEY) || "null"),
    };
  } catch {
    return freshState();
  }
}
export const saveState = (state, storage = localStorage) =>
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
export const currentMission = (state) => missions[state.missionIndex] ?? null;
export function toggleMage(state, mageId) {
  if (state.phase !== "briefing") return state;
  const selected = state.selected.includes(mageId)
    ? state.selected.filter((id) => id !== mageId)
    : state.selected.length < 2
      ? [...state.selected, mageId]
      : [state.selected[1], mageId];
  return { ...state, selected };
}
function teamStats(state) {
  const stats = { power: 0, control: 0, lore: 0, mobility: 0, empathy: 0 };
  for (const id of state.selected) {
    const mage = mages.find((item) => item.id === id);
    const fatigue = state.mages[id].fatigue;
    for (const key of Object.keys(stats))
      stats[key] += Math.max(0, mage.stats[key] - Math.floor(fatigue / 2));
  }
  return stats;
}
export function forecast(state) {
  const mission = currentMission(state);
  if (!mission || !state.selected.length)
    return { label: "Нет команды", score: 0 };
  const stats = teamStats(state);
  const coverage =
    Object.entries(mission.requirements).reduce(
      (sum, [key, value]) => sum + Math.min(stats[key] / value, 1.2),
      0,
    ) / Object.keys(mission.requirements).length;
  return coverage >= 1.05
    ? { label: "Идеальное соответствие", score: coverage }
    : coverage >= 0.78
      ? { label: "Надёжный план", score: coverage }
      : { label: "Высокий риск", score: coverage };
}
export function dispatchTeam(state) {
  return !state.selected.length || state.phase !== "briefing"
    ? state
    : { ...state, phase: "decision", pendingScore: forecast(state).score };
}
export function resolveChoice(state, choiceId) {
  const mission = currentMission(state);
  const choice = mission?.choices.find((item) => item.id === choiceId);
  if (!choice) return state;
  const stats = teamStats(state);
  const bonus =
    Object.entries(choice.bonus).reduce(
      (sum, [key, value]) => sum + Math.min(stats[key], value),
      0,
    ) / 10;
  const score = state.pendingScore + bonus;
  const outcome =
    score >= 1.35 ? "success" : score >= 0.92 ? "mixed" : "failure";
  const delta = outcome === "success" ? 2 : outcome === "mixed" ? 0 : -2;
  const mageState = structuredClone(state.mages);
  for (const id of state.selected) {
    mageState[id].fatigue += 1 + (choice.fatigue || 0);
    mageState[id].trust +=
      (choice.trust || 0) +
      (outcome === "success" ? 1 : outcome === "failure" ? -1 : 0);
    mageState[id].missions += 1;
  }
  return {
    ...state,
    phase: "result",
    reputation: Math.max(0, state.reputation + delta),
    city: Math.max(0, state.city + delta + (choice.city || 0)),
    mages: mageState,
    log: [
      ...state.log,
      {
        mission: mission.title,
        outcome,
        team: [...state.selected],
        choice: choice.label,
      },
    ],
    lastOutcome: outcome,
  };
}
export function continueShift(state) {
  const nextIndex = state.missionIndex + 1;
  if (nextIndex >= missions.length)
    return { ...state, phase: "complete", selected: [] };
  const mageState = structuredClone(state.mages);
  for (const id of Object.keys(mageState))
    mageState[id].fatigue = Math.max(0, mageState[id].fatigue - 1);
  return {
    ...state,
    missionIndex: nextIndex,
    phase: "briefing",
    selected: [],
    pendingScore: null,
    mages: mageState,
  };
}
