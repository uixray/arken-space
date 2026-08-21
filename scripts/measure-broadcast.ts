/**
 * UIX-408/409, этап 0 — базовая линия рассылки на боевых данных.
 *
 * Считает то, что просит таблица приёмки плана: запросы, байты, состав по
 * полям и время. Сокеты не поднимаются: рассылка — это `buildSnapshot` на
 * каждого подключённого, и мерить надо именно её, а не транспорт.
 *
 * Запускать **только против изолированной копии** боевой базы. Причина не в
 * осторожности вообще, а в конкретном факте: `normalizeAudioTrackDeadlines`
 * пишет в БД внутри пути чтения, то есть «просто померить» на живой базе
 * означает в неё писать.
 *
 *   ARKEN_MEASURE_CONFIRM=isolated-copy \
 *   ARKEN_MEASURE_CAMPAIGN_ID=<uuid> \
 *   ARKEN_MEASURE_GM_VIEWED_SCENE_ID=<uuid> \
 *   DATABASE_URL=postgres://localhost/... \
 *   corepack pnpm exec tsx scripts/measure-broadcast.ts
 *
 * Наружу печатаются только числа. Ни одного игрового значения — ни имён, ни
 * сообщений, ни заметок — в отчёт не попадает.
 */
// Пути относительные: пакеты воркспейса связаны внутри `apps/*` и `packages/*`,
// а `scripts/` в их зависимостях не значится.
import { createDatabase } from "../packages/db/src/index.js";
import {
  buildSnapshot,
  loadCampaignReadSet,
} from "../apps/server/src/snapshot.js";
import {
  measureSnapshot,
  sumByField,
} from "../apps/server/src/snapshot-metrics.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL обязателен");
  process.exit(1);
}
if (process.env.ARKEN_MEASURE_CONFIRM !== "isolated-copy") {
  console.error("ARKEN_MEASURE_CONFIRM=isolated-copy обязателен");
  process.exit(1);
}

const campaignId = process.env.ARKEN_MEASURE_CAMPAIGN_ID;
const viewedSceneId = process.env.ARKEN_MEASURE_GM_VIEWED_SCENE_ID;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!campaignId || !uuidPattern.test(campaignId)) {
  console.error("ARKEN_MEASURE_CAMPAIGN_ID должен быть UUID");
  process.exit(1);
}
if (!viewedSceneId || !uuidPattern.test(viewedSceneId)) {
  console.error("ARKEN_MEASURE_GM_VIEWED_SCENE_ID должен быть UUID");
  process.exit(1);
}

const parsedConnection = new URL(connectionString);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
if (!loopbackHosts.has(parsedConnection.hostname)) {
  console.error(
    "Measurement разрешён только через loopback к изолированной копии БД",
  );
  process.exit(1);
}

const runCount = Number(process.env.ARKEN_MEASURE_RUNS ?? "5");
if (
  !Number.isInteger(runCount) ||
  runCount < 3 ||
  runCount > 19 ||
  runCount % 2 === 0
) {
  console.error(
    "ARKEN_MEASURE_RUNS должен быть нечётным целым числом от 3 до 19",
  );
  process.exit(1);
}

let queries = 0;
const { client, db } = createDatabase(connectionString, () => {
  queries += 1;
});

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} КБ`;
const sortedNumbers = (values: readonly number[]) =>
  [...values].sort((left, right) => left - right);
const median = (values: readonly number[]) => {
  const sorted = sortedNumbers(values);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const range = (values: readonly number[], digits = 0) => {
  const sorted = sortedNumbers(values);
  return `${sorted[0]!.toFixed(digits)}–${sorted.at(-1)!.toFixed(digits)}`;
};

try {
  // Прямые запросы через клиент, а не через построитель: скрипту нужны два
  // идентификатора, и тянуть ради них построитель запросов незачем.
  const [campaign] = await client<
    { id: string; active_scene_id: string | null }[]
  >`
    select id, active_scene_id from campaigns where id = ${campaignId} limit 1
  `;
  if (!campaign)
    throw new Error("выбранной кампании нет в изолированной копии");
  if (!campaign.active_scene_id)
    throw new Error("у выбранной кампании должна быть активная сцена");
  const [viewedScene] = await client<{ id: string }[]>`
    select id from scenes
    where id = ${viewedSceneId}
      and campaign_id = ${campaign.id}
      and id is distinct from ${campaign.active_scene_id}
    limit 1
  `;
  if (!viewedScene)
    throw new Error(
      "просматриваемая GM сцена должна быть неактивной сценой выбранной кампании",
    );
  const members = await client<
    { id: string; role: "GM" | "PLAYER"; display_name: string }[]
  >`
    select id, role, display_name from memberships
    where campaign_id = ${campaign.id}
    order by role, id
  `;

  const gmCount = members.filter((member) => member.role === "GM").length;
  const playerCount = members.filter(
    (member) => member.role === "PLAYER",
  ).length;
  if (gmCount !== 1 || playerCount !== 6)
    throw new Error(
      `сценарий должен содержать 1 GM + 6 PLAYER, получено ${gmCount} + ${playerCount}`,
    );

  const audience = members.map((member) => ({
    membershipId: member.id,
    campaignId: campaign.id,
    role: member.role,
    displayName: member.display_name,
  }));

  console.log("изолированная кампания: выбрана явно");
  console.log(`аудитория: 1 GM + 6 PLAYER; прогонов: ${runCount}\n`);

  // Прогрев: первая сборка платит за соединения пула и разбор запросов, и без
  // прогрева она одна перекашивает и время, и счётчик.
  type MeasuredSocket = {
    role: "GM" | "PLAYER";
    bytes: number;
    ms: number;
    byField: Record<string, number>;
  };
  type MeasuredRun = {
    queries: number;
    totalMs: number;
    sockets: MeasuredSocket[];
  };
  const measureOnce = async (): Promise<MeasuredRun> => {
    queries = 0;
    const startedAt = performance.now();
    /** UIX-409: один общий read set, затем параллельные персональные проекции. */
    const readSet = await loadCampaignReadSet(db as never, campaign.id);
    const sockets = await Promise.all(
      audience.map(async (auth) => {
        const socketStartedAt = performance.now();
        const snapshot = await buildSnapshot(
          db as never,
          auth as never,
          auth.role === "GM" ? [viewedScene.id] : [],
          readSet,
        );
        const ms = performance.now() - socketStartedAt;
        const { bytes, byField } = measureSnapshot(snapshot);
        return { role: auth.role, bytes, ms, byField };
      }),
    );
    return { queries, totalMs: performance.now() - startedAt, sockets };
  };

  // Первый цикл прогревает пул и normalizer; его числа не входят в отчёт.
  await measureOnce();
  const runs: MeasuredRun[] = [];
  for (let index = 0; index < runCount; index += 1)
    runs.push(await measureOnce());

  const medianTotalMs = median(runs.map((run) => run.totalMs));
  const representative = [...runs].sort(
    (left, right) =>
      Math.abs(left.totalMs - medianTotalMs) -
      Math.abs(right.totalMs - medianTotalMs),
  )[0]!;
  const fieldTotals = sumByField(
    representative.sockets.map((item) => item.byField),
  );
  const totalBytes = representative.sockets.reduce(
    (sum, item) => sum + item.bytes,
    0,
  );
  const totalBytesByRun = runs.map((run) =>
    run.sockets.reduce((sum, item) => sum + item.bytes, 0),
  );
  if (new Set(totalBytesByRun).size !== 1)
    throw new Error("размер снапшота меняется между измерительными прогонами");
  const gmRuns = runs.map((run) =>
    run.sockets.find((item) => item.role === "GM")!,
  );
  const representativeGm = representative.sockets.find(
    (item) => item.role === "GM",
  )!;
  const playerBytes = representative.sockets
    .filter((item) => item.role === "PLAYER")
    .map((item) => item.bytes);
  const playerMedianTimes = audience
    .map((auth, index) => ({ auth, index }))
    .filter(({ auth }) => auth.role === "PLAYER")
    .map(({ index }) => median(runs.map((run) => run.sockets[index]!.ms)));

  console.log("=== ТАБЛИЦА ПРИЁМКИ (текущая реализация)");
  console.log(
    `запросов на рассылку: median ${median(runs.map((run) => run.queries)).toFixed(0)} (range ${range(runs.map((run) => run.queries))})`,
  );
  console.log(`байт на рассылку: ${kb(totalBytes)}`);
  console.log(
    `время рассылки: median ${median(runs.map((run) => run.totalMs)).toFixed(0)} мс (range ${range(runs.map((run) => run.totalMs))} мс)`,
  );
  console.log(
    `снапшот GM: ${kb(representativeGm.bytes)}; время median ${median(gmRuns.map((item) => item.ms)).toFixed(0)} мс`,
  );
  console.log(
    `снапшоты PLAYER: ${kb(Math.min(...playerBytes))} / ${kb(median(playerBytes))} / ${kb(Math.max(...playerBytes))} (min/median/max)`,
  );
  console.log(
    `время PLAYER: ${Math.min(...playerMedianTimes).toFixed(0)} / ${median(playerMedianTimes).toFixed(0)} / ${Math.max(...playerMedianTimes).toFixed(0)} мс (min/median/max персональных median)`,
  );

  console.log("\n=== СОСТАВ ПО ПОЛЯМ (сумма по всем сокетам)");
  const sorted = Object.entries(fieldTotals).sort((a, b) => b[1] - a[1]);
  const sum = sorted.reduce((total, [, bytes]) => total + bytes, 0);
  for (const [field, bytes] of sorted.slice(0, 12))
    console.log(
      `  ${field.padEnd(22)} ${kb(bytes).padStart(10)}  ${((bytes / sum) * 100).toFixed(1)}%`,
    );
  // Проверка того самого расхождения из разбора: сумма по полям обязана
  // сходиться с итогом, иначе мерили разными способами.
  const envelopeOverhead = totalBytes - sum;
  console.log(
    `\nenvelope overhead: ${kb(envelopeOverhead)} (${((envelopeOverhead / totalBytes) * 100).toFixed(1)}%)`,
  );

  console.log("\n=== ПО СОКЕТАМ");
  for (const [index, item] of representative.sockets.entries())
    console.log(
      `  ${(item.role === "GM" ? "GM" : `PLAYER ${index}`).padEnd(10)} ${kb(item.bytes).padStart(10)}  ${item.ms.toFixed(0)} мс`,
    );
} finally {
  await client.end();
}
