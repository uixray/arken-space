import type {
  CharacterDto,
  SpellProgressionGraph,
  SpellPackVersionDto,
} from "@arken/contracts";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";
import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";

for (const width of [390, 1280]) {
  test(`UIX-458 custom school explicit activation and branch display ${width}px (mock API)`, async ({ page }) => {
    const snapshot = buildGameSnapshot("GM", { schemaVersion: 2 });
    const gmId = snapshot.me.id;
    const playerId = "member-branch-player";
    const characterId = "69500000-0000-4000-8000-000000004580";
    const emptyCharacterId = "69500000-0000-4000-8000-000000004581";
    const makeCharacter = (id: string, name: string): CharacterDto => ({
      id,
      name,
      ownerMembershipId: playerId,
      controllerMembershipIds: [],
      portraitAssetId: null,
      stats: {}, skills: [], spells: [], entries: [], notes: "", backstory: "",
      inventory: [], resources: {}, wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
      revision: 1, lifecycle: "ACTIVE", archivedAt: null, archivedByMembershipId: null,
    });
    snapshot.characters = [makeCharacter(characterId, "Испытатель"), makeCharacter(emptyCharacterId, "Без школы")];
    snapshot.members = [...snapshot.members, { ...snapshot.me, id: playerId, role: "PLAYER", displayName: "Игрок", characterId }];
    snapshot.me.characterId = characterId;

    let role: "GM" | "PLAYER" = "GM";
    let draft: SpellProgressionGraph | null = null;
    let active: SpellProgressionGraph | null = null;
    let branches: Array<Record<string, unknown>> = [];
    let assignmentWrites = 0;

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === "/api/bootstrap") {
        snapshot.me.role = role;
        snapshot.me.id = role === "GM" ? gmId : playerId;
        snapshot.me.characterId = characterId;
        return route.fulfill({ json: snapshot });
      }
      if (pathname === "/api/soundpad") return route.fulfill({ json: { packs: [], playerPlaybackEnabled: true } });
      if (pathname === "/api/client-logs") return route.fulfill({ json: { ok: true } });
      if (pathname === "/api/spell-packs/validate") return route.fulfill({ json: { valid: true, errors: [], warnings: [] } });
      if (pathname === "/api/spell-packs" && request.method() === "GET") return route.fulfill({ json: { packs: draft ? [{ id: draft.packId, latestVersionId: draft.versionId, latestVersion: draft.version, lifecycle: draft.lifecycle, title: draft.title, createdAt: new Date(0).toISOString() }] : [] } });
      if (pathname === "/api/spell-packs" && request.method() === "POST") {
        const body = request.postDataJSON() as { graph: SpellProgressionGraph };
        draft = body.graph;
        return route.fulfill({ status: 201, json: { packId: draft.packId, versionId: draft.versionId, version: draft.version, lifecycle: "DRAFT", graph: draft, warnings: [], createdAt: new Date(0).toISOString() } });
      }
      if (pathname === `/api/spell-packs/${draft?.packId}/versions/${draft?.versionId}` && request.method() === "GET") return route.fulfill({ json: { packId: draft!.packId, versionId: draft!.versionId, version: draft!.version, lifecycle: draft!.lifecycle, graph: draft, warnings: [], createdAt: new Date(0).toISOString() } });
      if (pathname === `/api/spell-packs/${draft?.packId}/lifecycle` && request.method() === "POST") {
        const command = request.postDataJSON() as { versionId: string };
        active = { ...draft!, version: draft!.version + 1, versionId: command.versionId, lifecycle: "ACTIVE" };
        return route.fulfill({ json: { packId: active.packId, versionId: active.versionId, version: active.version, lifecycle: "ACTIVE", graph: active, warnings: [], createdAt: new Date(0).toISOString() } satisfies SpellPackVersionDto });
      }
      if (pathname === "/api/spell-assignable-schools" && request.method() === "GET") return route.fulfill({ json: { schools: active ? [{ packId: active.packId, packVersionId: active.versionId, packVersion: active.version, packTitle: active.title, schoolId: "custom-school-id", schoolName: "Школа северного ветра", visibilityPolicy: "PUBLIC" }] : [], nextCursor: null } });
      if (pathname === `/api/characters/${characterId}/spell-branches` && request.method() === "GET") return route.fulfill({ json: { branches, nextCursor: null } });
      if (pathname === `/api/characters/${emptyCharacterId}/spell-branches` && request.method() === "GET") return route.fulfill({ json: { branches: [], nextCursor: null } });
      if (pathname === `/api/characters/${characterId}/spell-assignments` && request.method() === "POST") {
        assignmentWrites++;
        branches = [{ packId: active!.packId, packVersionId: active!.versionId, packVersion: active!.version, schoolId: "custom-school-id", schoolName: "Школа северного ветра" }];
        return route.fulfill({ status: 201, json: { ok: true } });
      }
      return route.fulfill({ json: [] });
    });

    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await openWorkspaceSection(page, "Школы заклинаний");
    await page.getByLabel("Название набора").fill("Кастомная школа");
    await page.getByLabel("Название первой школы").fill("Школа северного ветра");
    await page.getByRole("button", { name: "Создать черновик школы" }).click();
    await page.getByRole("button", { name: "Проверить и сохранить черновик" }).click();
    await expect(page.getByText("Сохранена версия 1")).toBeVisible();
    await page.getByRole("button", { name: "Подготовить явную активацию" }).click();
    await expect(page.getByRole("heading", { name: "Активировать выбранную версию?" })).toBeVisible();
    expect(active).toBeNull();
    await page.getByRole("button", { name: "Подтвердить создание ACTIVE-версии" }).click();
    await expect(page.getByText(/Создана активная версия/)).toBeVisible();

    await openWorkspaceSection(page, "Персонажи");
    const sheet = page.getByRole("article", { name: "Лист персонажа Испытатель", exact: true });
    const selector = sheet.getByLabel("Активная школа для выдачи");
    await selector.selectOption({ label: "Школа северного ветра — Кастомная школа · v2" });
    await sheet.getByRole("button", { name: "Выдать школу" }).click();
    await expect(sheet.getByText("Школа северного ветра", { exact: true })).toBeVisible();
    expect(assignmentWrites).toBe(1);

    role = "PLAYER";
    await page.reload();
    await openWorkspaceSection(page, "Персонажи");
    const playerSheet = page.getByRole("article", { name: "Лист персонажа Испытатель", exact: true });
    await expect(playerSheet.getByText("Школа северного ветра", { exact: true })).toBeVisible();
    await expect(playerSheet.getByText(/версия 2/)).toBeVisible();
    await expect(playerSheet.getByLabel("Активная школа для выдачи")).toHaveCount(0);
    snapshot.me.characterId = emptyCharacterId;
    snapshot.members = snapshot.members.map((member) =>
      member.id === playerId ? { ...member, characterId: emptyCharacterId } : member,
    );
    await page.reload();
    await openWorkspaceSection(page, "Персонажи");
    await page.getByRole("button", { name: "Без школы", exact: true }).click();
    const emptySheet = page.getByRole("article", { name: "Лист персонажа Без школы", exact: true });
    await expect(emptySheet.getByText(/пока не выданы школы заклинаний/)).toBeVisible();
    await expect(emptySheet.getByText("Школа северного ветра", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
