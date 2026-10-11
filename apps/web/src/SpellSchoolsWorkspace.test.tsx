// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpellProgressionGraph } from "@arken/contracts";
import { SpellSchoolsWorkspace } from "./SpellSchoolsWorkspace";
import {
  createEmptySpellDraft,
  createSpellNode,
  createSpellSchool,
  nextSpellDraftVersion,
} from "./spell-schools-editor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SpellSchoolsWorkspace", () => {
  it("retains a failed create draft and retries the identical action and payload", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let createAttempts = 0;
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === "/api/spell-packs" && (!init || init.method === "GET"))
          return new Response(JSON.stringify({ packs: [] }), { status: 200 });
        if (url === "/api/spell-packs/validate")
          return new Response(
            JSON.stringify({ valid: true, errors: [], warnings: [] }),
            { status: 200 },
          );
        if (url === "/api/spell-packs" && init?.method === "POST") {
          createAttempts += 1;
          if (createAttempts === 1)
            return new Response(
              JSON.stringify({ error: "TEMPORARY_FAILURE" }),
              { status: 503 },
            );
          const body = JSON.parse(String(init.body)) as {
            graph: SpellProgressionGraph;
          };
          const graph = body.graph;
          return new Response(
            JSON.stringify({
              packId: graph.packId,
              versionId: graph.versionId,
              version: 1,
              lifecycle: "DRAFT",
              graph,
              warnings: [],
              createdAt: "2026-10-09T00:00:00.000Z",
            }),
            { status: 201 },
          );
        }
        return new Response(JSON.stringify({ packs: [] }), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetch);

    render(<SpellSchoolsWorkspace />);
    await screen.findByText("Сохранённых наборов пока нет.");
    fireEvent.change(screen.getByLabelText("Название набора"), {
      target: { value: "Личный черновик" },
    });
    fireEvent.change(screen.getByLabelText("Название первой школы"), {
      target: { value: "Искры" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Создать черновик школы" }),
    );

    const save = screen.getByRole("button", {
      name: "Проверить и сохранить черновик",
    });
    fireEvent.click(save);
    await screen.findByRole("alert");
    expect(
      (screen.getAllByLabelText("Название набора")[0] as HTMLInputElement)
        .value,
    ).toBe("Личный черновик");

    expect(
      (screen.getByLabelText("Название первой школы") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Повторить тот же запрос" }),
    );
    await screen.findByRole("status");
    await waitFor(() => expect(createAttempts).toBe(2));

    const createBodies = calls
      .filter(
        (call) =>
          call.url === "/api/spell-packs" && call.init?.method === "POST",
      )
      .map((call) => JSON.parse(String(call.init?.body)));
    expect(createBodies).toHaveLength(2);
    expect(createBodies[1]).toEqual(createBodies[0]);
  });

  it("keeps a CAS-conflicted draft locked and offers deliberate latest-version recovery", async () => {
    const empty = createEmptySpellDraft("Конкурентный набор");
    const school = createSpellSchool(empty, "Искры");
    const node = createSpellNode(
      { ...empty, schools: [school] },
      school.id,
      "Свет",
    );
    const base: SpellProgressionGraph = {
      ...empty,
      schools: [school],
      nodes: [node],
    };
    const latest = nextSpellDraftVersion(
      base,
      "30000000-0000-4000-8000-000000000001",
    );
    latest.schools[0]!.description = "Изменение другого мастера";
    let listReads = 0;
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/spell-packs" && (!init || init.method === "GET")) {
          listReads += 1;
          const current = listReads === 1 ? base : latest;
          return new Response(
            JSON.stringify({
              packs: [
                {
                  id: current.packId,
                  latestVersionId: current.versionId,
                  latestVersion: current.version,
                  lifecycle: current.lifecycle,
                  title: current.title,
                  createdAt: "2026-10-09T00:00:00.000Z",
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === "/api/spell-packs/validate")
          return new Response(
            JSON.stringify({ valid: true, errors: [], warnings: [] }),
            { status: 200 },
          );
        if (
          url === `/api/spell-packs/${base.packId}/versions/${base.versionId}`
        )
          return new Response(
            JSON.stringify({ graph: base, version: base.version }),
            { status: 200 },
          );
        if (
          url ===
          `/api/spell-packs/${latest.packId}/versions/${latest.versionId}`
        )
          return new Response(
            JSON.stringify({ graph: latest, version: latest.version }),
            { status: 200 },
          );
        if (
          url === `/api/spell-packs/${base.packId}/versions` &&
          init?.method === "POST"
        )
          return new Response(
            JSON.stringify({ error: "SPELL_PACK_VERSION_CONFLICT" }),
            { status: 409 },
          );
        return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
          status: 404,
        });
      },
    );
    vi.stubGlobal("fetch", fetch);

    render(<SpellSchoolsWorkspace />);
    const packChoice = await screen.findByRole("button", {
      name: /Конкурентный набор/,
    });
    await waitFor(() =>
      expect((packChoice as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(packChoice);
    await waitFor(() =>
      expect(screen.getAllByLabelText("Описание")).toHaveLength(2),
    );
    const schoolDescription = screen.getAllByLabelText(
      "Описание",
    )[0] as HTMLTextAreaElement;
    await waitFor(() => expect(schoolDescription.value).toBe(""));
    fireEvent.change(schoolDescription, {
      target: { value: "Локальная правка" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Проверить и сохранить новую версию",
      }),
    );

    await screen.findByRole("alert");
    expect(schoolDescription.value).toBe("Локальная правка");
    expect(schoolDescription.matches(":disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Скачать копию экранного черновика" })
        .isConnected,
    ).toBe(true);
    expect(
      screen.getByRole("button", {
        name: "Загрузить актуальную версию (заменит экранный черновик)",
      }).isConnected,
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Загрузить актуальную версию (заменит экранный черновик)",
      }),
    );
    await screen.findByText(/Загружена серверная версия 2/);
    expect(
      (screen.getAllByLabelText("Описание")[0] as HTMLTextAreaElement).value,
    ).toBe("Изменение другого мастера");
    expect(
      (screen.getAllByLabelText("Описание")[0] as HTMLTextAreaElement).matches(
        ":disabled",
      ),
    ).toBe(false);
  });

  it("activates only after explicit confirmation and displays validation warnings", async () => {
    const draft = createEmptySpellDraft("Confirmed activation");
    const versionId = "30000000-0000-4000-8000-000000000002";
    const activated: SpellProgressionGraph = {
      ...draft,
      versionId,
      version: 2,
      lifecycle: "ACTIVE",
    };
    const activationCommands: unknown[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/spell-packs" && (!init || init.method === "GET"))
        return new Response(
          JSON.stringify({
            packs: [
              {
                id: draft.packId,
                latestVersionId: draft.versionId,
                latestVersion: draft.version,
                lifecycle: draft.lifecycle,
                title: draft.title,
                createdAt: "2026-10-09T00:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      if (
        url === `/api/spell-packs/${draft.packId}/versions/${draft.versionId}`
      )
        return new Response(
          JSON.stringify({
            packId: draft.packId,
            versionId: draft.versionId,
            version: draft.version,
            lifecycle: draft.lifecycle,
            graph: draft,
            warnings: [],
            createdAt: "2026-10-09T00:00:00.000Z",
          }),
          { status: 200 },
        );
      if (url === "/api/spell-packs/validate")
        return new Response(
          JSON.stringify({
            valid: true,
            errors: [],
            warnings: [
              {
                code: "CYCLE",
                path: "schools",
                message: "Review this non-blocking warning.",
              },
            ],
          }),
          { status: 200 },
        );
      if (url === `/api/spell-packs/${draft.packId}/lifecycle`) {
        const command = JSON.parse(String(init?.body));
        activationCommands.push(command);
        return new Response(
          JSON.stringify({
            packId: draft.packId,
            versionId,
            version: 2,
            lifecycle: "ACTIVE",
            graph: activated,
            warnings: [],
            createdAt: "2026-10-09T00:00:00.000Z",
          }),
          { status: 201 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);

    render(<SpellSchoolsWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Confirmed activation/ }),
    );
    await screen.findByLabelText("Название набора");
    fireEvent.click(
      screen.getByRole("button", { name: "Подготовить явную активацию" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Активировать выбранную версию?" }),
    ).toBeTruthy();
    expect(screen.getByText(/Review this non-blocking warning/)).toBeTruthy();
    expect(activationCommands).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Подтвердить создание ACTIVE-версии",
      }),
    );
    await screen.findByText(/Создана активная версия 2/);
    expect(activationCommands).toHaveLength(1);
    expect(activationCommands[0]).toMatchObject({
      expectedVersion: 1,
      lifecycle: "ACTIVE",
    });
    expect(activationCommands[0]).toHaveProperty("versionId");
    expect(activationCommands[0]).toHaveProperty("actionId");
  });

  it("does not activate persisted contents after the loaded draft has unsaved edits", async () => {
    const empty = createEmptySpellDraft("Saved draft");
    const graph = { ...empty, schools: [createSpellSchool(empty, "Custom school")] };
    const activationCalls: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/spell-packs" && (!init || init.method === "GET"))
        return new Response(JSON.stringify({ packs: [{ id: graph.packId, latestVersionId: graph.versionId, latestVersion: graph.version, lifecycle: "DRAFT", title: graph.title, createdAt: new Date(0).toISOString() }] }), { status: 200 });
      if (url === `/api/spell-packs/${graph.packId}/versions/${graph.versionId}`)
        return new Response(JSON.stringify({ graph, version: graph.version }), { status: 200 });
      if (url === "/api/spell-packs/validate")
        return new Response(JSON.stringify({ valid: true, errors: [], warnings: [] }), { status: 200 });
      if (url === `/api/spell-packs/${graph.packId}/lifecycle`) {
        activationCalls.push(url);
        return new Response(JSON.stringify({ error: "UNEXPECTED_ACTIVATION" }), { status: 500 });
      }
      return new Response(JSON.stringify({ packs: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);

    render(<SpellSchoolsWorkspace />);
    const packButton = await screen.findByRole("button", { name: /Saved draft/ });
    await waitFor(() => expect((packButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(packButton);
    const description = await screen.findAllByLabelText("Описание");
    fireEvent.change(description[0]!, { target: { value: "Unsaved change" } });
    const activateButton = screen.getByRole("button", { name: "Подготовить явную активацию" });
    expect((activateButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Сначала сохраните изменения новой версией/)).toBeTruthy();
    expect(activationCalls).toEqual([]);
  });
});
