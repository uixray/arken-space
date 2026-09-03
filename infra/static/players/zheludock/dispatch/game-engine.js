import { mages, missions } from "./game-data.js";

export const STORAGE_KEY = "arken:misha-dispatch:v1";
export const freshState = (mode = "story") => ({
  version: 1,
  mode,
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
export const currentMission = (state) => {
  if (state.mode !== "arcade") return missions[state.missionIndex] ?? null;
  const base = missions[state.missionIndex % missions.length];
  const tier = Math.floor(state.missionIndex / missions.length);
  return {
    ...base,
    id: `${base.id}-${state.missionIndex}`,
    title: tier ? `${base.title} · угроза ${tier + 1}` : base.title,
    requirements: Object.fromEntries(
      Object.entries(base.requirements).map(([key, value]) => [
        key,
        value + tier * 2,
      ]),
    ),
  };
};
export function toggleMage(state, mageId) {
  if (state.phase !== "briefing") return state;
  const selected = state.selected.includes(mageId)
    ? state.selected.filter((id) => id !== mageId)
    : state.selected.length < 2
      ? [...state.selected, mageId]
      : [state.selected[1], mageId];
  const added = selected.includes(mageId) && !state.selected.includes(mageId);
  const mage = mages.find((item) => item.id === mageId);
  return {
    ...state,
    selected,
    notice: added
      ? `${mage.name}: «${mage.voice?.selected || "Принято."}»`
      : null,
  };
}
function teamStats(state) {
  const stats = { power: 0, control: 0, lore: 0, mobility: 0, empathy: 0 };
  for (const id of state.selected) {
    const mage = mages.find((item) => item.id === id);
    const fatigue = state.mages[id].fatigue;
    const levelBonus = Math.floor(state.mages[id].missions / 2);
    for (const key of Object.keys(stats))
      stats[key] += Math.max(
        0,
        mage.stats[key] + levelBonus - Math.floor(fatigue / 2),
      );
  }
  if (state.selected.includes("adora") && !state.selected.includes("rem"))
    for (const key of Object.keys(stats)) stats[key] += 1;
  if (state.selected.includes("makoto")) stats.mobility += 1;
  if (state.selected.includes("erkenvald") && state.missionIndex % 2 === 1)
    stats.lore = Math.max(0, stats.lore - 2);
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
  const mission = currentMission(state);
  if (
    state.selected.includes("rem") &&
    !mission?.requirements.power &&
    state.selected.length > 1
  )
    return {
      ...state,
      selected: state.selected.filter((id) => id !== "rem"),
      notice:
        "Рэм отказался: «Это задание ниже моего достоинства». Выберите замену.",
    };
  return !state.selected.length || state.phase !== "briefing"
    ? state
    : {
        ...state,
        phase: "traveling",
        notice: null,
        pendingScore: forecast(state).score,
        travel: {
          direction: "outbound",
          startedAt: Date.now(),
          duration: Math.max(
            1800,
            5200 -
              Math.max(
                ...state.selected.map(
                  (id) => mages.find((mage) => mage.id === id).stats.mobility,
                ),
              ) *
                500,
          ),
        },
      };
}
export function advanceTravel(state, now = Date.now()) {
  if (!state.travel || !["traveling", "returning"].includes(state.phase))
    return state;
  if (now - state.travel.startedAt < state.travel.duration) return state;
  if (state.phase === "traveling")
    return { ...state, phase: "decision", travel: null };
  return { ...state, phase: "result", travel: null };
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
    const memphisRelief = state.selected.includes("memphis") ? 1 : 0;
    mageState[id].fatigue += Math.max(
      0,
      1 + (choice.fatigue || 0) - memphisRelief,
    );
    mageState[id].trust +=
      (choice.trust || 0) +
      (outcome === "success" ? 1 : outcome === "failure" ? -1 : 0);
    mageState[id].missions += 1;
  }
  return {
    ...state,
    phase: "returning",
    reputation: Math.max(0, state.reputation + delta),
    city: Math.max(
      0,
      state.city +
        delta +
        (choice.city || 0) -
        (outcome === "failure" && state.selected.includes("fenser") ? 1 : 0),
    ),
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
    travel: {
      direction: "returning",
      startedAt: Date.now(),
      duration: Math.max(
        1400,
        4300 -
          Math.max(
            ...state.selected.map(
              (id) => mages.find((mage) => mage.id === id).stats.mobility,
            ),
          ) *
            420,
      ),
    },
  };
}
export function continueShift(state) {
  const nextIndex = state.missionIndex + 1;
  if (state.mode !== "arcade" && nextIndex >= missions.length)
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
