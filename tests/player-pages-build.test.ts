import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { players } from "../infra/static/players/player-pages.data.mjs";

it("players:build воспроизводит закоммиченные страницы без форматирующего diff", () => {
  const files = players.map(
    (player) =>
      new URL(
        `../infra/static/players/${player.slug}/index.html`,
        import.meta.url,
      ),
  );
  const before = files.map((file) =>
    readFileSync(file, "utf8").replaceAll("\r\n", "\n"),
  );
  execFileSync(
    process.execPath,
    ["infra/static/players/build-player-pages.mjs"],
    {
      cwd: new URL("..", import.meta.url),
      timeout: 20000,
    },
  );
  files.forEach((file, index) =>
    expect(readFileSync(file, "utf8").replaceAll("\r\n", "\n")).toBe(
      before[index],
    ),
  );
});
