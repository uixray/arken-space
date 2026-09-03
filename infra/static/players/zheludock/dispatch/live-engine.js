import {
  campaignChapters,
  campaignConsequences,
  interludes,
  mages,
  missions,
} from "./game-data.js";

export const STORAGE_KEY = "arken:misha-dispatch:live-v3";
const schedule = [0, 12, 25, 39, 54];

export const freshLiveState = (mode = "story", now = Date.now()) => ({
  version: 3,
  mode,
  startedAt: now,
  elapsed: 0,
  focusedCallId: null,
  reputation: 5,
  city: 10,
  score: 0,
  combo: 0,
  log: [],
  calls: [],
  campaign: {
    chapter: 0,
    flags: [],
    openLocations: [],
    closedLocations: [],
    interludeQueue: [],
    dialogue: null,
    complete: false,
  },
  heroes: Object.fromEntries(
    mages.map((mage) => [
      mage.id,
      {
        status: "ready",
        callId: null,
        fatigue: 0,
        trust: 0,
        missions: 0,
        morale: 0,
        benchedCalls: 0,
      },
    ]),
  ),
});

export function loadLiveState(storage = localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
    if (!saved?.version || saved.version !== 3) return freshLiveState();
    return {
      ...freshLiveState(saved.mode),
      ...saved,
      startedAt: Date.now() - saved.elapsed * 1000,
    };
  } catch {
    return freshLiveState();
  }
}
export const saveLiveState = (state, storage = localStorage) =>
  storage.setItem(STORAGE_KEY, JSON.stringify(state));

const templateFor = (number) => missions[number % missions.length];
function makeCall(number, now, mode, base = templateFor(number)) {
  const tier = mode === "arcade" ? Math.floor(number / missions.length) : 0;
  return {
    id: `call-${number}`,
    number,
    missionId: base.id,
    status: "waiting",
    spawnedAt: now,
    expiresAt: now + Math.max(20, 42 - tier * 3) * 1000,
    team: [],
    progress: 0,
    direction: null,
    outcome: null,
    requirements: Object.fromEntries(
      Object.entries(base.requirements).map(([key, value]) => [
        key,
        value + tier * 2,
      ]),
    ),
  };
}

export const missionForCall = (call) =>
  missions.find((mission) => mission.id === call.missionId) ||
  templateFor(call.number);
export const focusedCall = (state) =>
  state.calls.find((call) => call.id === state.focusedCallId) ||
  state.calls.find((call) => call.status === "waiting") ||
  state.calls[0] ||
  null;
export const availableHeroes = (state) =>
  mages.filter((mage) => state.heroes[mage.id].status === "ready");

export function resetCampaign(mode = "story", now = Date.now()) {
  return freshLiveState(mode, now);
}

function travelDuration(team, returning = false) {
  const mobility = Math.max(
    ...team.map((id) => mages.find((mage) => mage.id === id).stats.mobility),
  );
  return Math.max(
    returning ? 1500 : 1900,
    (returning ? 4600 : 5600) - mobility * 550,
  );
}

export function tickLiveState(state, now = Date.now()) {
  const next = structuredClone(state);
  next.elapsed = Math.floor((now - next.startedAt) / 1000);
  const chapter =
    campaignChapters[next.campaign.chapter] || campaignChapters[0];
  const storyTemplates = chapter.missionIds
    .map((id) => missions.find((mission) => mission.id === id))
    .filter(
      (mission) =>
        mission && !next.campaign.closedLocations.includes(mission.district),
    );
  const wanted =
    next.mode === "arcade"
      ? Math.floor(next.elapsed / 12) + 1
      : schedule.filter((second) => second <= next.elapsed).length;
  const storyLimit = storyTemplates.length;
  while (
    next.calls.length + next.log.length < wanted &&
    (next.mode === "arcade" || next.calls.length + next.log.length < storyLimit)
  ) {
    const number = next.calls.length + next.log.length;
    next.calls.push(
      makeCall(
        number,
        now,
        next.mode,
        next.mode === "story" ? storyTemplates[number] : undefined,
      ),
    );
  }
  for (const call of next.calls) {
    if (call.status === "waiting" && now >= call.expiresAt) {
      call.status = "expired";
      call.outcome = "failure";
      next.city = Math.max(0, next.city - 2);
      next.combo = 0;
    }
    if (!["outbound", "returning"].includes(call.status)) continue;
    call.progress = Math.min(
      1,
      (now - call.travelStartedAt) / call.travelDuration,
    );
    if (call.progress < 1) continue;
    if (call.status === "outbound") {
      call.status = "decision";
      call.progress = 1;
    } else {
      call.status = "resolved";
      for (const id of call.team) {
        next.heroes[id].status = "ready";
        next.heroes[id].callId = null;
      }
    }
  }
  const finished = next.calls.filter((call) =>
    ["resolved", "expired"].includes(call.status),
  );
  for (const call of finished) {
    for (const meta of Object.values(next.heroes))
      if (meta.benchedCalls > 0) meta.benchedCalls -= 1;
    next.log.push(call);
    next.calls = next.calls.filter((item) => item.id !== call.id);
  }
  if (
    next.mode === "story" &&
    next.log.length >= storyLimit &&
    !next.calls.length &&
    !next.campaign.dialogue &&
    !next.campaign.complete
  ) {
    next.campaign.interludeQueue = [...(chapter?.interludes || [])];
    next.campaign.dialogue = next.campaign.interludeQueue.shift() || null;
    if (!next.campaign.dialogue) next.campaign.complete = true;
  }
  if (
    !next.focusedCallId ||
    !next.calls.some((call) => call.id === next.focusedCallId)
  )
    next.focusedCallId = next.calls[0]?.id || null;
  return next;
}

export function focusCall(state, callId) {
  return { ...state, focusedCallId: callId };
}
export function toggleHero(state, heroId) {
  const call = focusedCall(state);
  if (
    !call ||
    call.status !== "waiting" ||
    state.heroes[heroId].status !== "ready" ||
    state.heroes[heroId].benchedCalls > 0
  )
    return state;
  const next = structuredClone(state);
  const target = next.calls.find((item) => item.id === call.id);
  target.team = target.team.includes(heroId)
    ? target.team.filter((id) => id !== heroId)
    : target.team.length < 2
      ? [...target.team, heroId]
      : [target.team[1], heroId];
  return next;
}
export function dispatchCall(state, now = Date.now()) {
  const call = focusedCall(state);
  if (!call?.team.length || call.status !== "waiting") return state;
  const next = structuredClone(state);
  const target = next.calls.find((item) => item.id === call.id);
  target.status = "outbound";
  target.direction = "outbound";
  target.travelStartedAt = now;
  target.travelDuration = travelDuration(target.team);
  for (const id of target.team) {
    next.heroes[id].status = "busy";
    next.heroes[id].callId = target.id;
  }
  return next;
}

function teamScore(state, call) {
  const sum = { power: 0, control: 0, lore: 0, mobility: 0, empathy: 0 };
  for (const id of call.team) {
    const mage = mages.find((item) => item.id === id);
    const meta = state.heroes[id];
    const level = Math.floor(meta.missions / 2);
    const morale = meta.morale || 0;
    for (const key of Object.keys(sum))
      sum[key] += Math.max(
        0,
        mage.stats[key] + level + morale - Math.floor(meta.fatigue / 2),
      );
  }
  return (
    Object.entries(call.requirements).reduce(
      (total, [key, value]) => total + Math.min(sum[key] / value, 1.25),
      0,
    ) / Object.keys(call.requirements).length
  );
}
export function forecastCall(state, call = focusedCall(state)) {
  if (!call?.team.length) return { percent: 0, label: "Нет команды" };
  const percent = Math.round(
    Math.max(15, Math.min(99, teamScore(state, call) * 82)),
  );
  return {
    percent,
    label: percent >= 76 ? "Надёжно" : percent >= 48 ? "Рискованно" : "Опасно",
  };
}
export function resolveLiveCall(
  state,
  choiceId,
  random = Math.random,
  now = Date.now(),
) {
  const call = focusedCall(state);
  if (!call || call.status !== "decision") return state;
  const mission = missionForCall(call);
  const choice = mission.choices.find((item) => item.id === choiceId);
  if (!choice) return state;
  const next = structuredClone(state);
  const target = next.calls.find((item) => item.id === call.id);
  const chance = forecastCall(state, call).percent;
  const success = chance >= 76 || random() * 100 < chance;
  target.outcome = success ? "success" : chance >= 45 ? "mixed" : "failure";
  target.choice = choice.label;
  target.status = "returning";
  target.direction = "returning";
  target.progress = 0;
  target.travelStartedAt = now;
  target.travelDuration = travelDuration(target.team, true);
  const delta =
    target.outcome === "success" ? 2 : target.outcome === "mixed" ? 0 : -2;
  next.city = Math.max(0, next.city + delta + (choice.city || 0));
  next.reputation = Math.max(0, next.reputation + delta);
  next.combo = target.outcome === "success" ? next.combo + 1 : 0;
  next.score += Math.max(10, 100 + next.combo * 25 + delta * 20);
  for (const id of target.team) {
    next.heroes[id].fatigue += 1;
    next.heroes[id].missions += 1;
    next.heroes[id].trust +=
      target.outcome === "success" ? 1 : target.outcome === "failure" ? -1 : 0;
  }
  const consequence = campaignConsequences[`${mission.id}:${choiceId}`];
  if (next.mode === "story" && consequence) {
    next.campaign.flags.push(`${mission.id}:${choiceId}`);
    next.campaign.openLocations = [
      ...new Set([...next.campaign.openLocations, ...consequence.open]),
    ];
    next.campaign.closedLocations = [
      ...new Set([...next.campaign.closedLocations, ...consequence.close]),
    ];
    if (consequence.bench)
      next.heroes[consequence.bench.heroId].benchedCalls =
        consequence.bench.calls + 1;
  }
  return next;
}

export function answerInterlude(state, answerId) {
  const key = state.campaign?.dialogue;
  const scene = interludes[key];
  const answer = scene?.answers.find((item) => item.id === answerId);
  if (!answer) return state;
  const next = structuredClone(state);
  const hero = next.heroes[scene.heroId];
  hero.morale = Math.max(-1, Math.min(1, (hero.morale || 0) + answer.morale));
  next.campaign.lastDialogue = { key, answerId, reply: answer.reply };
  next.campaign.dialogue = next.campaign.interludeQueue.shift() || null;
  if (!next.campaign.dialogue) {
    if (next.campaign.chapter + 1 < campaignChapters.length) {
      next.campaign.chapter += 1;
      next.startedAt = Date.now();
      next.elapsed = 0;
      next.log = [];
      next.calls = [];
    } else next.campaign.complete = true;
  }
  return next;
}
