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
 *   DATABASE_URL=postgres://... corepack pnpm exec tsx scripts/measure-broadcast.ts
 *
 * Наружу печатаются только числа. Ни одного игрового значения — ни имён, ни
 * сообщений, ни заметок — в отчёт не попадает.
 */
// Пути относительные: пакеты воркспейса связаны внутри `apps/*` и `packages/*`,
// а `scripts/` в их зависимостях не значится.
import { createDatabase } from "../packages/db/src/index.js";
import { buildSnapshot } from "../apps/server/src/snapshot.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL обязателен");
  process.exit(1);
}

let queries = 0;
const { client, db } = createDatabase(connectionString, () => {
  queries += 1;
});

const bytesOf = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} КБ`;

try {
  // Прямые запросы через клиент, а не через построитель: скрипту нужны два
  // идентификатора, и тянуть ради них построитель запросов незачем.
  const [campaign] = await client<{ id: string }[]>`
    select id from campaigns order by created_at limit 1
  `;
  if (!campaign) throw new Error("в базе нет кампании");
  const members = await client<
    { id: string; role: "GM" | "PLAYER"; display_name: string }[]
  >`
    select id, role, display_name from memberships
    where campaign_id = ${campaign.id}
  `;

  const audience = members.map((member) => ({
    membershipId: member.id,
    campaignId: campaign.id,
    role: member.role,
    displayName: member.display_name,
  }));

  console.log(`кампания: ${campaign.id}`);
  console.log(`участников: ${audience.length}\n`);

  // Прогрев: первая сборка платит за соединения пула и разбор запросов, и без
  // прогрева она одна перекашивает и время, и счётчик.
  await buildSnapshot(db as never, audience[0] as never);

  queries = 0;
  const startedAt = performance.now();
  const perSocket: { role: string; bytes: number; ms: number }[] = [];
  const fieldTotals: Record<string, number> = {};
  for (const auth of audience) {
    const socketStartedAt = performance.now();
    const snapshot = await buildSnapshot(db as never, auth as never);
    const ms = performance.now() - socketStartedAt;
    const bytes = bytesOf(snapshot);
    perSocket.push({ role: auth.role, bytes, ms });
    for (const [key, value] of Object.entries(snapshot))
      fieldTotals[key] = (fieldTotals[key] ?? 0) + bytesOf(value);
  }
  const totalMs = performance.now() - startedAt;
  const totalBytes = perSocket.reduce((sum, item) => sum + item.bytes, 0);

  console.log("=== ТАБЛИЦА ПРИЁМКИ (до правок)");
  console.log(`запросов на рассылку: ${queries}`);
  console.log(`байт на рассылку: ${kb(totalBytes)}`);
  console.log(`время рассылки: ${totalMs.toFixed(0)} мс`);
  const gm = perSocket.find((item) => item.role === "GM");
  const player = perSocket.find((item) => item.role === "PLAYER");
  if (gm) console.log(`снапшот ГМ: ${kb(gm.bytes)} за ${gm.ms.toFixed(0)} мс`);
  if (player)
    console.log(
      `снапшот игрока: ${kb(player.bytes)} за ${player.ms.toFixed(0)} мс`,
    );
  console.log(
    `запросов на одну сборку: ${(queries / audience.length).toFixed(1)}`,
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
  console.log(
    `\nсумма по полям ${kb(sum)} против итога ${kb(totalBytes)} — расхождение ${(
      ((sum - totalBytes) / totalBytes) *
      100
    ).toFixed(1)}%`,
  );

  console.log("\n=== ПО СОКЕТАМ");
  for (const item of perSocket)
    console.log(
      `  ${item.role.padEnd(7)} ${kb(item.bytes).padStart(10)}  ${item.ms.toFixed(0)} мс`,
    );
} finally {
  await client.end();
}
