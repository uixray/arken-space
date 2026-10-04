import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { request } from "@playwright/test";

// Deliberately restricted to the isolated local manual-QA service.
const baseURL = "http://127.0.0.1:15180";
const workspace = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(workspace, "../..", "media/stickers");
const statePath = join(workspace, ".data/local-qa-sticker-import.json");
const sourceFolders = ["pack-v1-manual-2026-09-09", "generated"];
const apply = process.argv.includes("--apply");
async function pngFiles(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) result.push(...(await pngFiles(path)));
    else if (/\.png$/i.test(entry.name)) result.push(path);
  }
  return result;
}
const files = (
  await Promise.all(
    sourceFolders.map((folder) => pngFiles(join(sourceRoot, folder))),
  )
).flat();
const unique = new Map();
for (const path of files) {
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length > 5 * 1024 * 1024)
    throw new Error(`Source exceeds upload limit: ${basename(path)}`);
  if (!unique.has(sha256)) unique.set(sha256, { path, bytes });
}
console.log(
  JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    files: files.length,
    unique: unique.size,
    target: baseURL,
  }),
);
if (!apply) process.exit(0);
let state = { target: baseURL, packId: null, imported: {}, published: false };
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (state.target !== baseURL) throw new Error("QA state target mismatch");
const token = (
  await readFile(join(workspace, ".data/manual-qa-token.txt"), "utf8")
).trim();
const client = await request.newContext({ baseURL });
async function checked(response) {
  if (!response.ok())
    throw new Error(
      `QA request failed: ${response.status()} ${await response.text()}`,
    );
  return response.json();
}
async function save() {
  await mkdir(join(workspace, ".data"), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
}
try {
  await checked(await client.post("/api/auth/gm", { data: { token } }));
  if (!state.packId) {
    const pack = await checked(
      await client.post("/api/sticker-packs", {
        data: {
          name: "Локальная коллекция Аркен-Хара",
          subject: "NPC",
          subjectLabel: "Смешанная коллекция",
          audience: "CAMPAIGN",
          sendPolicy: "ALL_MEMBERS",
        },
      }),
    );
    state.packId = pack.id;
    await save();
  }
  if (!state.published) {
    for (const [sha256, { path, bytes }] of unique) {
      if (state.imported[sha256]) continue;
      const name = basename(path, ".png").slice(0, 80);
      const metadata = new URLSearchParams({
        name,
        altText: `Стикер: ${name}`,
        provenanceType: "IMPORTED",
        sourceReference: `local:${path};sha256:${sha256}`,
        authorCredit: "Коллекция пользователя UIXRay",
        licenseNote:
          "Пользователь подтвердил права и разрешил использование всех локальных стикеров в текущем чате. Импорт только в изолированный QA.",
      });
      const sticker = await checked(
        await client.post(
          `/api/sticker-packs/${state.packId}/stickers?${metadata}`,
          {
            multipart: {
              file: {
                name: basename(path),
                mimeType: "image/png",
                buffer: bytes,
              },
            },
          },
        ),
      );
      state.imported[sha256] = { id: sticker.id, source: path };
      await save();
    }
    await checked(
      await client.post(`/api/sticker-packs/${state.packId}/publish`),
    );
    state.published = true;
    await save();
  }
  const packs = await checked(await client.get("/api/stickers"));
  const pack = packs.find((item) => item.id === state.packId);
  if (!pack?.canSend || pack.stickers.length !== unique.size)
    throw new Error("QA sticker visibility/count mismatch");
  const media = await client.get(pack.stickers[0].url);
  if (!media.ok() || !media.headers()["content-type"]?.startsWith("image/webp"))
    throw new Error("QA sticker media verification failed");
  console.log(
    JSON.stringify({
      imported: Object.keys(state.imported).length,
      published: state.published,
      visible: pack.stickers.length,
      mediaVerified: true,
    }),
  );
} finally {
  await client.dispose();
}
